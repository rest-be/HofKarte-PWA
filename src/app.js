/**
 * Einstiegspunkt der HofKarte-PWA: einfacher Hash-Router + zentraler
 * Zustand, der an die Views weitergereicht wird.
 *
 * Views (jeweils `render(container, app)`):
 * - setup         → src/views/setup.js         (Einrichtungsbildschirm)
 * - liste         → src/views/list.js          (Übersicht + "Hofläden in der Nähe")
 * - karte         → src/views/map.js           (Leaflet-Kartenansicht)
 * - detail        → src/views/detail.js        (Detailansicht eines Hofladens)
 * - editor        → src/views/editor.js        (Neu anlegen/Bearbeiten)
 * - einstellungen → src/views/einstellungen.js (Token ändern, Abmelden)
 */

import {
  ladeVerbindung,
  speichereVerbindung,
  loescheVerbindung,
  ladeCache,
  speichereCache,
  ladeWarteschlange,
  fuegeOperationZurWarteschlangeHinzu,
  entferneAusWarteschlange,
  aktualisiereHofladenIdInWarteschlange,
} from "./storage.js";
import { HaClient, EVENT_AUTH_FEHLER } from "./ha-client.js";
import { verarbeiteWarteschlange } from "./sync-worker.js";
import { renderSetup } from "./views/setup.js";
import { renderListe } from "./views/list.js";
import { renderKarte } from "./views/map.js";
import { renderDetail } from "./views/detail.js";
import { renderEditor } from "./views/editor.js";
import { renderEinstellungen } from "./views/einstellungen.js";

const appContainer = document.getElementById("app");
const CACHE_KEY_LISTE = "hoflaeden-liste";

/** Präfix für Hofladen-IDs, die offline (ohne Verbindung zu Home
 * Assistant) neu angelegt wurden - siehe speichereHofladen() und
 * sync-worker.js. Nach erfolgreichem Sync wird die Platzhalter-ID durch
 * die von Home Assistant vergebene echte ID ersetzt. */
const LOKALES_ID_PRAEFIX = "lokal-";

function neueLokaleId() {
  const zufall = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${LOKALES_ID_PRAEFIX}${zufall}`;
}

/**
 * Zentrales App-Objekt, das den Views als zweites Argument übergeben
 * wird. Hält den aktuellen Zustand (Hofladen-Liste, Einstellungen) und
 * bietet Navigation sowie Schreibzugriffe über den HaClient.
 */
const app = {
  haClient: null,
  /** Zuletzt verwendete HA-Adresse (für Foto-Upload-URLs und die
   * Einstellungen-View, siehe aktualisiereToken()). */
  haUrl: null,
  /** true, wenn keine Live-Verbindung besteht, aber zuvor erfolgreich
   * eingerichtet wurde (z. B. VPN gerade nicht aktiv) - dann wird der
   * Lesecache angezeigt statt des Einrichtungsbildschirms. */
  offlineModus: false,
  state: {
    hoflaeden: [],
    zuletztAktualisiert: null,
    ausCache: false,
    einstellungen: null,
    /** Anzahl Operationen in der Warteschlange (Phase 8a) - für die
     * Sync-Status-Anzeige in der Kopfzeile, siehe renderMitRahmen(). */
    ausstehendeAnzahl: 0,
  },

  /** Regelmässiger Wiederverbindungsversuch, solange offlineModus aktiv
   * ist (siehe starteApp()) - nur während die App im Vordergrund läuft,
   * ein Service Worker kann im Hintergrund keinen Timer ausführen. */
  _offlineRetryTimer: null,

  _starteOfflineRetry() {
    if (this._offlineRetryTimer) return;
    this._offlineRetryTimer = setInterval(() => {
      this.versucheErneutZuVerbinden();
    }, 30_000);
  },

  _stoppeOfflineRetry() {
    if (this._offlineRetryTimer) {
      clearInterval(this._offlineRetryTimer);
      this._offlineRetryTimer = null;
    }
  },

  async _aktualisiereAusstehendeAnzahl() {
    const warteschlange = await ladeWarteschlange();
    this.state.ausstehendeAnzahl = warteschlange.length;
  },

  /** Optimistisches lokales Übernehmen einer Änderung (Phase 8a): aktualisiert
   * sowohl den In-Memory-Zustand als auch den persistierten Lesecache, damit
   * die Änderung auch nach einem Neuladen der Seite sichtbar bleibt, bis sie
   * synchronisiert ist. */
  async _uebernehmeLokal(hofladen) {
    const index = this.state.hoflaeden.findIndex((h) => h.id === hofladen.id);
    if (index >= 0) {
      this.state.hoflaeden[index] = hofladen;
    } else {
      this.state.hoflaeden.push(hofladen);
    }
    await speichereCache(CACHE_KEY_LISTE, this.state.hoflaeden);
  },

  async _entferneLokal(id) {
    this.state.hoflaeden = this.state.hoflaeden.filter((h) => h.id !== id);
    await speichereCache(CACHE_KEY_LISTE, this.state.hoflaeden);
  },

  /** Nach erfolgreichem Sync einer "anlegen"-Operation (sync-worker.js):
   * die lokale Platzhalter-ID im Zustand, im Lesecache und in noch
   * ausstehenden Folge-Operationen durch die echte, von Home Assistant
   * vergebene ID ersetzen. */
  async _ersetzeLokaleId(alteId, neueId, serverHofladen) {
    this.state.hoflaeden = this.state.hoflaeden.filter((h) => h.id !== alteId);
    this.state.hoflaeden.push(serverHofladen);
    await speichereCache(CACHE_KEY_LISTE, this.state.hoflaeden);
    await aktualisiereHofladenIdInWarteschlange(alteId, neueId);
    // Falls gerade die Detailansicht/der Editor des lokalen Hofladens
    // offen ist, auf die echte ID weiterleiten, statt auf einer toten
    // Platzhalter-ID sitzen zu bleiben.
    const aktuellerHash = window.location.hash;
    if (aktuellerHash.includes(`/${alteId}`)) {
      window.location.hash = aktuellerHash.replace(alteId, neueId);
    }
  },

  navigate(pfad) {
    window.location.hash = pfad;
  },

  hofladenMitId(id) {
    return this.state.hoflaeden.find((h) => h.id === id) || null;
  },

  _pruefeVerbindung() {
    if (!this.haClient) {
      throw new Error(
        "Keine Verbindung zu Home Assistant. Bitte VPN/Heimnetz prüfen und erneut versuchen."
      );
    }
  },

  /** Liste neu laden (Stale-while-revalidate, siehe ha-client.js). Die
   * aktuell gerenderte View wird nach jedem Zwischenstand neu
   * gezeichnet, damit Offline-Daten sofort sichtbar sind. */
  async aktualisiereListe() {
    if (!this.haClient) {
      const gecached = await ladeCache("hoflaeden-liste");
      if (gecached) {
        this.state.hoflaeden = gecached.daten;
        this.state.zuletztAktualisiert = gecached.zeitpunkt;
        this.state.ausCache = true;
      }
      route();
      return;
    }

    const ergebnis = await this.haClient.hoflaedenListe((zwischenstand) => {
      this.state.hoflaeden = zwischenstand.hoflaeden;
      this.state.zuletztAktualisiert = zwischenstand.zuletztAktualisiert;
      this.state.ausCache = true;
      route();
    });
    this.state.hoflaeden = ergebnis.hoflaeden;
    this.state.zuletztAktualisiert = ergebnis.zuletztAktualisiert;
    this.state.ausCache = ergebnis.ausCache;
    route();
  },

  /**
   * Hofladen anlegen/ändern. Besteht eine Verbindung zu Home Assistant,
   * läuft das wie bisher direkt über den HaClient. Ohne Verbindung
   * (Phase 8a - "Offline ist ein normaler Betriebszustand", siehe
   * PWA-HA-Vorgehensplan.md Abschnitt 10.2) wird die Änderung sofort
   * lokal übernommen (optimistisches UI-Update) und zur späteren
   * Synchronisation in die Warteschlange gelegt, statt einen Fehler zu
   * werfen.
   */
  async speichereHofladen(daten) {
    if (this.haClient) {
      const gespeichert = await this.haClient.hofladenSpeichern(daten);
      await this.aktualisiereListe();
      return gespeichert;
    }

    const istNeu = !daten.id;
    const lokalerHofladen = {
      ...daten,
      id: daten.id || neueLokaleId(),
      _synchronisierungAusstehend: true,
    };
    await this._uebernehmeLokal(lokalerHofladen);
    await fuegeOperationZurWarteschlangeHinzu({
      art: istNeu ? "anlegen" : "aendern",
      hofladenId: lokalerHofladen.id,
      daten: lokalerHofladen,
    });
    await this._aktualisiereAusstehendeAnzahl();
    return lokalerHofladen;
  },

  /**
   * Hofladen löschen - ebenfalls offline-fähig (siehe speichereHofladen()
   * oben). Ein Hofladen, der lokal angelegt und noch nie synchronisiert
   * wurde, wird beim Löschen einfach aus der Warteschlange entfernt
   * (die ausstehende "anlegen"-Operation entfällt), statt unnötig eine
   * "loeschen"-Operation für etwas zu queuen, das bei Home Assistant nie
   * existiert hat.
   */
  async loescheHofladen(id) {
    if (this.haClient) {
      await this.haClient.hofladenLoeschen(id);
      await this.aktualisiereListe();
      return;
    }

    await this._entferneLokal(id);
    if (id.startsWith(LOKALES_ID_PRAEFIX)) {
      const warteschlange = await ladeWarteschlange();
      for (const op of warteschlange) {
        if (op.hofladenId === id) {
          await entferneAusWarteschlange(op.id);
        }
      }
    } else {
      await fuegeOperationZurWarteschlangeHinzu({ art: "loeschen", hofladenId: id, daten: null });
    }
    await this._aktualisiereAusstehendeAnzahl();
  },

  async versucheErneutZuVerbinden() {
    await starteApp();
  },

  async abmelden() {
    this.haClient?.trennen();
    this.haClient = null;
    this.haUrl = null;
    this._stoppeOfflineRetry();
    await loescheVerbindung();
    this.navigate("#/");
    starteApp();
  },

  /** Token ändern (Einstellungen-View, src/views/einstellungen.js): baut
   * zuerst eine neue Verbindung mit dem neuen Token auf, ohne die
   * bestehende zu kappen - schlägt das fehl (z. B. Tippfehler), bleibt
   * die alte Verbindung unangetastet nutzbar. Erst bei Erfolg wird die
   * alte Verbindung getrennt und die neue dauerhaft gespeichert. */
  async aktualisiereToken(neuesToken) {
    if (!this.haUrl) {
      throw new Error("Keine bestehende Verbindung - bitte die App neu einrichten.");
    }
    const neuerClient = new HaClient(this.haUrl, neuesToken);
    await neuerClient.verbinden();

    this.haClient?.trennen();
    this.haClient = neuerClient;
    this._stoppeOfflineRetry();
    await speichereVerbindung(this.haUrl, neuesToken);

    this.state.einstellungen = await neuerClient.einstellungen().catch(() => null);
    await verarbeiteWarteschlange(this);
    await this.aktualisiereListe();
  },
};

window.hofkarteApp = app; // für einfaches Debugging in der Konsole

function parsePfad() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const teile = hash.split("/").filter(Boolean);
  return teile;
}

function route() {
  if (!app.haClient && !app.offlineModus) {
    renderSetup(appContainer, verbinden);
    return;
  }

  const teile = parsePfad();

  if (teile[0] === "hofladen" && teile[1] && teile[2] === "bearbeiten") {
    renderMitRahmen(() => renderEditor(appContainer.querySelector(".inhalt"), app, teile[1]));
    return;
  }
  if (teile[0] === "neu") {
    renderMitRahmen(() => renderEditor(appContainer.querySelector(".inhalt"), app, null));
    return;
  }
  if (teile[0] === "hofladen" && teile[1]) {
    renderMitRahmen(() => renderDetail(appContainer.querySelector(".inhalt"), app, teile[1]));
    return;
  }
  if (teile[0] === "karte") {
    renderMitRahmen(() => renderKarte(appContainer.querySelector(".inhalt"), app), "karte");
    return;
  }
  if (teile[0] === "einstellungen") {
    renderMitRahmen(() => renderEinstellungen(appContainer.querySelector(".inhalt"), app));
    return;
  }

  renderMitRahmen(() => renderListe(appContainer.querySelector(".inhalt"), app), "liste");
}

/** Sync-Status für die Kopfzeile (Phase 8a): bewusst dezent - erscheint
 * nur, wenn es etwas Nennenswertes zu zeigen gibt (offline und/oder
 * ausstehende Operationen), nicht im unauffälligen Normalzustand (siehe
 * PWA-HA-Vorgehensplan.md Abschnitt 10.3, Punkt 4). */
function syncStatusHtml() {
  const anzahl = app.state.ausstehendeAnzahl || 0;
  if (!app.haClient) {
    return `<span class="sync-status offline">⌁ Offline${anzahl ? ` (${anzahl} ausstehend)` : ""}</span>`;
  }
  if (anzahl > 0) {
    return `<span class="sync-status wird-synchronisiert">↻ Wird synchronisiert …</span>`;
  }
  return "";
}

/** Gemeinsamer Rahmen (Kopfzeile + Tableiste) um die eigentliche View. Kopf-
 * und Fusszeile sind fix positioniert und damit immer sichtbar, nur der
 * dazwischenliegende Inhaltsbereich (.inhalt) scrollt (siehe styles.css). */
function renderMitRahmen(viewRender, aktiverTab) {
  appContainer.innerHTML = `
    <header class="kopfzeile">
      <h1>🥕 HofKarte</h1>
      ${syncStatusHtml()}
      <button id="einstellungen-btn" title="Einstellungen">⚙️ Einstellungen</button>
    </header>
    <main class="inhalt"></main>
    <nav class="tableiste">
      <button data-tab="liste"><span class="icon">📋</span>Liste</button>
      <button data-tab="karte"><span class="icon">🗺️</span>Karte</button>
      <button data-tab="neu"><span class="icon">➕</span>Neu</button>
    </nav>
  `;

  appContainer.querySelector("#einstellungen-btn").addEventListener("click", () => {
    app.navigate("#/einstellungen");
  });

  const tabZiele = { liste: "#/", karte: "#/karte", neu: "#/neu" };
  appContainer.querySelectorAll(".tableiste button").forEach((btn) => {
    const tab = btn.dataset.tab;
    if (tab === aktiverTab) btn.classList.add("aktiv");
    btn.addEventListener("click", () => app.navigate(tabZiele[tab]));
  });

  viewRender();
}

async function verbinden(haUrl, token) {
  const client = new HaClient(haUrl, token);
  await client.verbinden();

  app.haClient = client;
  app.haUrl = haUrl;
  app._stoppeOfflineRetry();
  await speichereVerbindung(haUrl, token);

  app.state.einstellungen = await client.einstellungen().catch(() => null);
  await verarbeiteWarteschlange(app);
  await app.aktualisiereListe();
  app.navigate("#/");
  route();
}

window.addEventListener(EVENT_AUTH_FEHLER, () => {
  app.haClient = null;
  route();
});

window.addEventListener("hashchange", route);

async function starteApp() {
  app.haClient?.trennen();
  app.haClient = null;
  app.offlineModus = false;

  const gespeichert = await ladeVerbindung();
  if (!gespeichert) {
    route();
    return;
  }

  try {
    const client = new HaClient(gespeichert.haUrl, gespeichert.token);
    await client.verbinden();
    app.haClient = client;
    app.haUrl = gespeichert.haUrl;
    app._stoppeOfflineRetry();
    app.state.einstellungen = await client.einstellungen().catch(() => null);
    await verarbeiteWarteschlange(app);
    await app.aktualisiereListe();
  } catch (err) {
    if (err.code === "invalid_auth") {
      // Token wurde widerrufen/ist ungültig - zurück zum Einrichtungsbildschirm.
      app._stoppeOfflineRetry();
      await loescheVerbindung();
    } else {
      // "connection_lost" (z. B. gerade kein VPN aktiv): eingerichtet
      // bleiben, aber mit dem Lesecache weiterarbeiten, statt zum
      // Einrichtungsbildschirm zurückzufallen. Ausstehende, offline
      // erfasste Änderungen (Phase 8a) bleiben dabei erhalten und
      // sichtbar - automatischer Wiederverbindungsversuch alle 30s,
      // solange die App im Vordergrund offen ist.
      app.offlineModus = true;
      app.haUrl = gespeichert.haUrl;
      await app._aktualisiereAusstehendeAnzahl();
      await app.aktualisiereListe();
      app._starteOfflineRetry();
    }
  }
  route();
}

starteApp();
