/**
 * Anbindung an Home Assistant über die offizielle
 * `home-assistant-js-websocket`-Bibliothek (siehe Vorgehensplan Phase 4,
 * Schritt 33) – statt einer eigenen WebSocket-/Reconnect-Logik.
 *
 * Kapselt zusätzlich:
 * - die HofKarte-eigenen WebSocket-Befehle (`hofkarte/management/*`,
 *   siehe `custom_components/hofkarte/management.py` im HofKarte-HA-Repo),
 * - die Action `hofkarte.hoflaeden_in_naehe` (siehe `src/naehe.js`),
 * - einen Stale-while-revalidate-Lesecache für `hoflaedenListe()`, damit
 *   die Liste auch offline mit dem zuletzt bekannten Stand angezeigt
 *   werden kann (Service Worker cached nur die App-Shell selbst, siehe
 *   service-worker.js – WebSocket-Daten laufen nicht über ihn).
 *
 * Es werden bewusst **keine** Standortdaten durch diese Datei an HA
 * übertragen ausser dort, wo der Aufrufer sie explizit für die
 * Nähe-Funktion mitgibt (siehe `naehe.js`) – konsistent mit dem
 * Grundsatz "keine Standortdaten persistieren" der HofKarte-Integration
 * selbst.
 */

// Direkt als natives ES-Modul von jsDelivr geladen: das Paket hat keine
// externen Abhängigkeiten und verwendet in `dist/index.js` ausschliesslich
// relative Imports mit expliziter ".js"-Endung - funktioniert daher ohne
// Bundler direkt im Browser (kein esm.sh/unpkg-"Bundle"-Proxy nötig).
import {
  createConnection,
  createLongLivedTokenAuth,
  ERR_INVALID_AUTH,
} from "https://cdn.jsdelivr.net/npm/home-assistant-js-websocket@9.7.0/dist/index.js";

import { ladeCache, speichereCache } from "./storage.js";

const CACHE_KEY_LISTE = "hoflaeden-liste";

/**
 * Wird von `HaClient.hofladenSpeichern()` geworfen, wenn Home Assistant
 * eine Änderung wegen eines Versionskonflikts abgelehnt hat (Phase 8b):
 * ein anderes Gerät hat denselben Hofladen zwischenzeitlich bereits
 * geändert. Trägt den aktuellen Serverstand, damit die PWA eine
 * Konflikt-Ansicht (lokaler vs. Server-Stand) zeigen kann, statt eine der
 * beiden Änderungen stillschweigend zu verlieren.
 *
 * `code` ist bewusst derselbe Mechanismus wie bei den übrigen
 * HA-Fehlern ("connection_lost", "invalid_auth"), damit Aufrufer
 * einheitlich über `err.code` unterscheiden können.
 */
export class VersionskonfliktFehler extends Error {
  constructor(aktuellerHofladen) {
    super("Der Hofladen wurde zwischenzeitlich von einem anderen Gerät geändert (Versionskonflikt).");
    this.name = "VersionskonfliktFehler";
    this.code = "version_conflict";
    this.aktuellerHofladen = aktuellerHofladen;
  }
}

/** Bild-ID aus einer von bildHochladen() erzeugten Serve-URL extrahieren
 * (für bildLoeschen()). Liefert `null` für extern verlinkte Bilder (die
 * haben kein zugehöriges, in HA zu löschendes Bild-Objekt). */
export function extractImageId(url) {
  const treffer = /\/api\/image\/serve\/([^/]+)\//.exec(url || "");
  return treffer ? treffer[1] : null;
}

/** Wird ausgelöst (CustomEvent auf `window`), wenn die Verbindung
 * dauerhaft verloren geht bzw. das Token ungültig ist – die App zeigt
 * dann den Einrichtungsbildschirm wieder an. */
const EVENT_AUTH_FEHLER = "hofkarte:auth-fehler";

export class HaClient {
  constructor(haUrl, token) {
    this._haUrl = haUrl.replace(/\/+$/, "");
    this._token = token;
    this._connection = null;
  }

  /** Verbindung aufbauen. Wirft bei ungültigem Token/nicht erreichbarer
   * Instanz einen Fehler mit `code` ("invalid_auth"/"connection_lost"). */
  async verbinden() {
    const auth = createLongLivedTokenAuth(this._haUrl, this._token);
    try {
      this._connection = await createConnection({ auth });
    } catch (err) {
      if (err === ERR_INVALID_AUTH) {
        const fehler = new Error("Ungültiges Long-Lived Access Token.");
        fehler.code = "invalid_auth";
        throw fehler;
      }
      const fehler = new Error(
        "Home Assistant unter dieser Adresse nicht erreichbar."
      );
      fehler.code = "connection_lost";
      throw fehler;
    }

    this._connection.addEventListener("disconnected", () => {
      // home-assistant-js-websocket versucht selbstständig, die
      // Verbindung wiederherzustellen (exponentielles Backoff) - hier
      // wird nur bei endgültigem Auth-Verlust reagiert.
    });
    this._connection.addEventListener("reconnect-error", (_conn, err) => {
      if (err === ERR_INVALID_AUTH) {
        window.dispatchEvent(new CustomEvent(EVENT_AUTH_FEHLER));
      }
    });
  }

  trennen() {
    this._connection?.close();
    this._connection = null;
  }

  /** Dauerhaft gespeicherte Einstellungen (Sortierung/OSM-Radius-Vorgabe,
   * siehe `hofkarte/management/settings`). */
  async einstellungen() {
    const antwort = await this._connection.sendMessagePromise({
      type: "hofkarte/management/settings",
    });
    return antwort.einstellungen;
  }

  /**
   * Alle Hofläden laden – Stale-while-revalidate: liefert sofort den
   * zuletzt gecachten Stand (falls vorhanden) über `onZwischenergebnis`
   * und aktualisiert anschliessend im Hintergrund von HA.
   *
   * Gibt `{hoflaeden, zuletztAktualisiert, ausCache}` zurück (vom
   * tatsächlichen, finalen Abruf - frisch von HA, ausser dieser schlägt
   * fehl, dann bleibt der Cache-Stand bestehen, siehe unten).
   */
  async hoflaedenListe(onZwischenergebnis) {
    const gecached = await ladeCache(CACHE_KEY_LISTE);
    if (gecached && onZwischenergebnis) {
      onZwischenergebnis({
        hoflaeden: gecached.daten,
        zuletztAktualisiert: gecached.zeitpunkt,
        ausCache: true,
      });
    }

    try {
      const antwort = await this._connection.sendMessagePromise({
        type: "hofkarte/management/list",
      });
      await speichereCache(CACHE_KEY_LISTE, antwort.hoflaeden);
      return {
        hoflaeden: antwort.hoflaeden,
        zuletztAktualisiert: new Date().toISOString(),
        ausCache: false,
      };
    } catch (err) {
      if (gecached) {
        // Offline bzw. Verbindung gerade weg: beim zuletzt bekannten
        // Stand bleiben, statt eine leere/fehlerhafte Ansicht zu zeigen.
        return {
          hoflaeden: gecached.daten,
          zuletztAktualisiert: gecached.zeitpunkt,
          ausCache: true,
        };
      }
      throw err;
    }
  }

  /**
   * Hofladen anlegen/ändern. Enthält `hofladen` eine `version` (die
   * zuletzt von Home Assistant gelieferte), prüft HA auf einen
   * Versionskonflikt und antwortet in diesem Fall nicht mit einem
   * WebSocket-Fehler, sondern mit `{ konflikt: true, aktueller_hofladen }`
   * (siehe `ws_save` in HofKarte-HA, `management.py`). Das wird hier in
   * einen `VersionskonfliktFehler` übersetzt. Bei Erfolg enthält die
   * Antwort den gespeicherten Hofladen inkl. der neu vergebenen `version`.
   */
  async hofladenSpeichern(hofladen) {
    const antwort = await this._connection.sendMessagePromise({
      type: "hofkarte/management/save",
      hofladen,
    });
    if (antwort.konflikt) {
      throw new VersionskonfliktFehler(antwort.aktueller_hofladen);
    }
    return antwort.hofladen;
  }

  async hofladenLoeschen(hofladenId) {
    await this._connection.sendMessagePromise({
      type: "hofkarte/management/delete",
      hofladen_id: hofladenId,
    });
  }

  /** "🔎 Infos ermitteln" aus einer Website-Adresse (siehe
   * `hofkarte/management/webseite_info`). Liefert nur Vorschlagsdaten,
   * speichert nichts. */
  async webseiteInfo(website) {
    const antwort = await this._connection.sendMessagePromise({
      type: "hofkarte/management/webseite_info",
      website,
    });
    return antwort.info;
  }

  /** Orte in der Nähe via OpenStreetMap vorschlagen (siehe
   * `hofkarte/management/osm_info`). */
  async osmInfo(latitude, longitude, radius) {
    const msg = {
      type: "hofkarte/management/osm_info",
      latitude,
      longitude,
    };
    if (radius) {
      msg.radius = radius;
    }
    const antwort = await this._connection.sendMessagePromise(msg);
    return antwort.orte;
  }

  /**
   * Bild hochladen über Home Assistants eigene `image_upload`-Komponente
   * (`POST /api/image/upload`, Ausliefern unter
   * `/api/image/serve/<id>/original`) – dieselbe Komponente, die auch
   * die HA-eigene Verwaltungsoberfläche (hofkarte-panel.js,
   * `uploadBild()`) nutzt, statt eines eigenen Upload-Endpunkts.
   *
   * Anders als im HA-Panel (dort `window.location.origin`, da von HA
   * selbst ausgeliefert) muss hier die volle HA-Adresse verwendet
   * werden, da die PWA von einer anderen Origin (GitHub Pages) läuft –
   * das erfordert `cors_allowed_origins` in der HA-`configuration.yaml`
   * (siehe README, Abschnitt „Voraussetzungen auf HA-Seite“), ohne das
   * blockiert der Browser die Anfrage mit einem CORS-Fehler.
   *
   * Die Authentifizierung läuft über das ohnehin gespeicherte
   * Long-Lived Access Token als Bearer-Token (REST-Endpunkte akzeptieren
   * dieses genau wie ein per OAuth erhaltenes Zugriffstoken) - kein
   * eigener Token-Refresh nötig.
   *
   * Gibt `{url, hochgeladen: true}` zurück (passend zum `bilder`-Feld
   * des Hofladens, siehe editor.js).
   */
  async bildHochladen(file) {
    const formData = new FormData();
    formData.append("file", file);

    let response;
    try {
      response = await fetch(`${this._haUrl}/api/image/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this._token}` },
        body: formData,
      });
    } catch (netzwerkFehler) {
      throw new Error(
        "Upload fehlgeschlagen - Home Assistant nicht erreichbar (VPN/Heimnetz prüfen) " +
          "oder die HA-Instanz lässt Anfragen von dieser Adresse nicht zu " +
          "(cors_allowed_origins in configuration.yaml prüfen)."
      );
    }

    if (response.status === 401) {
      throw new Error("Anmeldung abgelaufen/ungültig. Bitte Token in den Einstellungen prüfen.");
    }
    if (!response.ok) {
      throw new Error(
        response.status === 413 ? "Datei ist zu gross (maximal 10 MB)." : `Upload fehlgeschlagen (${response.status}).`
      );
    }

    const ergebnis = await response.json();
    const url = `${this._haUrl}/api/image/serve/${ergebnis.id}/original`;
    return { url, hochgeladen: true };
  }

  /** Über bildHochladen() erzeugtes Bild wieder entfernen (WS-Befehl
   * `image/delete` der HA-eigenen `image_upload`-Komponente). */
  async bildLoeschen(imageId) {
    await this._connection.sendMessagePromise({
      type: "image/delete",
      image_id: imageId,
    });
  }

  /**
   * Action `hofkarte.hoflaeden_in_naehe` aufrufen (siehe HofKarte-HA,
   * Phase 3) – Grundlage für die "Hofläden in der Nähe"-Anzeige in der
   * PWA (src/naehe.js). Der Standort wird bei jedem Aufruf frisch
   * mitgegeben, nicht gespeichert.
   */
  async hoflaedenInNaehe({ latitude, longitude, radiusMeter, nurGeoeffnet }) {
    const antwort = await this._connection.sendMessagePromise({
      type: "call_service",
      domain: "hofkarte",
      service: "hoflaeden_in_naehe",
      service_data: {
        latitude,
        longitude,
        radius_meter: radiusMeter,
        ...(nurGeoeffnet !== undefined ? { nur_geoeffnet: nurGeoeffnet } : {}),
      },
      return_response: true,
    });
    return antwort.response;
  }
}

export { EVENT_AUTH_FEHLER };
