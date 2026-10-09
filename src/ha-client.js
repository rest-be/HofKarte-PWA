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

// Phase 10: die Bibliothek liegt lokal unter vendor/ (siehe vendor/README.md)
// statt auf einem CDN - die App startet damit auch offline kalt und ist
// nicht von einem Drittserver abhängig.
import {
  createConnection,
  createLongLivedTokenAuth,
  ERR_INVALID_AUTH,
} from "../vendor/home-assistant-js-websocket/index.js";

import { ladeCache, speichereCache } from "./storage.js";

/**
 * Prüft die eingegebene Home-Assistant-Adresse: Das Long-Lived Token wird
 * im Klartext-Header übertragen, daher ist `https://` Pflicht. Unverschlüsseltes
 * `http://` wird nur für lokale Entwicklung (localhost/127.0.0.1) erlaubt.
 * Gibt die bereinigte Adresse zurück oder wirft einen Error mit Hinweistext.
 */
export function pruefeHaAdresse(eingabe) {
  let url;
  try {
    url = new URL(String(eingabe || "").trim());
  } catch {
    throw new Error("Ungültige Adresse. Beispiel: https://hofkarte.duckdns.org:8123");
  }
  const lokal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && lokal)) {
    throw new Error("Aus Sicherheitsgründen ist nur eine verschlüsselte Adresse (https://) erlaubt.");
  }
  return url.origin;
}

/** Obergrenze für den WebSocket-Upload (HA begrenzt Nachrichten auf 4 MiB; Base64 ≈ +33 %). */
const WS_UPLOAD_MAX_BYTES = 2_500_000;

/** Datei als Base64-Text (ohne `data:`-Präfix). */
async function dateiAlsBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) {
    text += String.fromCharCode(...bytes.subarray(i, i + block));
  }
  return btoa(text);
}

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

  /** Im Options Flow gewählte KI-Entität (`ai_task.…`) oder `null`
   * (siehe `hofkarte/management/settings`, Feld `ki_entitaet`). */
  async kiEntitaet() {
    const antwort = await this._connection.sendMessagePromise({
      type: "hofkarte/management/settings",
    });
    const wert = antwort.ki_entitaet;
    return typeof wert === "string" && wert.startsWith("ai_task.") ? wert : null;
  }

  /** „Hofladen finden“, Schritt 1: Kandidaten in der Umgebung suchen
   * (`hofkarte/management/discover`, nur Vorschläge, speichert nichts). */
  async hofladenSuchen({ latitude, longitude, radius, erweitert = false, name, website }) {
    const msg = {
      type: "hofkarte/management/discover",
      latitude,
      longitude,
      radius,
      erweitert: !!erweitert,
    };
    if (name) msg.name = name;
    if (website) msg.website = website;
    const antwort = await this._connection.sendMessagePromise(msg);
    return antwort.kandidaten || [];
  }

  /** „Hofladen finden“, Schritt 3: Kandidat/Website anreichern
   * (`hofkarte/management/enrich`, Subscription). `onEreignis` erhält
   * `{phase: "osm"|"website"|"ki"|"fertig", …}`. Gibt die Abmelde-Funktion
   * zurück. */
  async hofladenAnreichern({ kandidat, website, ki = false }, onEreignis) {
    const msg = { type: "hofkarte/management/enrich" };
    if (kandidat) msg.kandidat = kandidat;
    if (website) msg.website = website;
    if (ki) msg.ki = true;
    return this._connection.subscribeMessage(onEreignis, msg);
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
    // 1) Bevorzugt über die bestehende WebSocket-Verbindung (HofKarte-HA
    //    ab dem Befehl `hofkarte/management/upload_image`): braucht kein
    //    CORS. 2) Fallback: REST `POST /api/image/upload` (braucht
    //    `cors_allowed_origins`) - für grosse Dateien oder ältere HA-Version.
    if (file.size <= WS_UPLOAD_MAX_BYTES) {
      try {
        return await this._bildPerWebSocketHochladen(file);
      } catch (err) {
        const fallbackCodes = ["unknown_command", "too_large"];
        if (!fallbackCodes.includes(err?.code)) {
          throw new Error(
            err?.message ? `Upload fehlgeschlagen: ${err.message}` : "Upload fehlgeschlagen."
          );
        }
      }
    }
    return this._bildPerRestHochladen(file);
  }

  async _bildPerWebSocketHochladen(file) {
    const daten = await dateiAlsBase64(file);
    const ergebnis = await this._connection.sendMessagePromise({
      type: "hofkarte/management/upload_image",
      filename: file.name || "foto.jpg",
      content_type: file.type,
      data: daten,
    });
    return { url: `${this._haUrl}/api/image/serve/${ergebnis.id}/original`, hochgeladen: true };
  }

  async _bildPerRestHochladen(file) {
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
          "(cors_allowed_origins in configuration.yaml prüfen; alternativ HofKarte-HA aktualisieren, " +
          "dann läuft der Upload ohne CORS)."
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
