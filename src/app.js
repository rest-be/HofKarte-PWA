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
  aktualisiereInWarteschlange,
} from "./storage.js";
import { HaClient, EVENT_AUTH_FEHLER, VersionskonfliktFehler, pruefeHaAdresse } from "./ha-client.js";
import { verarbeiteWarteschlange } from "./sync-worker.js";
import { renderSetup } from "./views/setup.js";
import { renderListe } from "./views/list.js";
import { renderKarte } from "./views/map.js";
import { renderDetail } from "./views/detail.js";
import { renderKonflikt } from "./views/konflikt.js";
import { renderEditor } from "./views/editor.js";
import { renderEinstellungen } from "./views/einstellungen.js";
import { renderFinden } from "./views/finden.js";

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
  /** Entwurf aus „Hofladen finden“ (`{daten, quellen}`), den der Editor
   * unter `#/neu` einmalig übernimmt (siehe views/finden.js). */
  entwurf: null,
  state: {
    hoflaeden: [],
    zuletztAktualisiert: null,
    ausCache: false,
    einstellungen: null,
    /** Anzahl Operationen in der Warteschlange (Phase 8a) - für die
     * Sync-Status-Anzeige in der Kopfzeile, siehe renderMitRahmen(). */
    ausstehendeAnzahl: 0,
    /** Operationen mit ungelöstem Versionskonflikt (Phase 8b) - werden
     * nicht automatisch wiederholt und zählen nicht als "ausstehend". */
    konflikte: [],
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
    this.state.konflikte = warteschlange.filter((op) => op.konflikt);
    this.state.ausstehendeAnzahl = warteschlange.length - this.state.konflikte.length;
  },

  /** Konfliktoperation zu einem Hofladen (Phase 8b) oder null. */
  konfliktFuer(hofladenId) {
    return this.state.konflikte.find((op) => op.hofladenId === hofladenId) || null;
  },

  /** Online erkannter Versionskonflikt: die eigene Fassung wird als
   * Konflikt-Operation abgelegt (nicht gesendet), damit sie nicht verloren
   * geht und in der Konfliktansicht entschieden werden kann. */
  async _registriereKonflikt(daten, fehler) {
    const bestehend = this.konfliktFuer(daten.id);
    if (bestehend) {
      await aktualisiereInWarteschlange(bestehend.id, { daten, serverStand: fehler.aktuellerHofladen });
    } else {
      const op = await fuegeOperationZurWarteschlangeHinzu({ art: "aendern", hofladenId: daten.id, daten });
      await aktualisiereInWarteschlange(op.id, {
        konflikt: true,
        serverStand: fehler.aktuellerHofladen,
        letzterFehler: fehler.message,
      });
    }
    await this._aktualisiereAusstehendeAnzahl();
  },

  /** Konflikt lösen mit "Meine Version übernehmen": eigene Fassung auf der
   * aktuellen Server-Version erneut senden. */
  async loeseKonfliktMitMeiner(hofladenId) {
    const op = this.konfliktFuer(hofladenId);
    if (!op) return;
    const serverVersion = op.serverStand && op.serverStand.version;
    await aktualisiereInWarteschlange(op.id, {
      konflikt: false,
      serverStand: null,
      versuchCount: 0,
      letzterFehler: null,
      daten: { ...op.daten, version: serverVersion },
    });
    await this._aktualisiereAusstehendeAnzahl();
    if (this.haClient) {
      await verarbeiteWarteschlange(this);
      await this.aktualisiereListe();
    }
  },

  /** Konflikt lösen mit "Server-Version übernehmen": eigene Änderungen
   * (auch weitere offline gemachte desselben Hofladens) verwerfen. */
  async loeseKonfliktMitServer(hofladenId) {
    const op = this.konfliktFuer(hofladenId);
    if (!op) return;
    const serverStand = op.serverStand;
    for (const o of await ladeWarteschlange()) {
      if (o.hofladenId === hofladenId) await entferneAusWarteschlange(o.id);
    }
    if (serverStand) await this._uebernehmeLokal(serverStand);
    await this._aktualisiereAusstehendeAnzahl();
    if (this.haClient) await this.aktualisiereListe();
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
      aktualisiereAnsicht();
      return;
    }

    const ergebnis = await this.haClient.hoflaedenListe((zwischenstand) => {
      this.state.hoflaeden = zwischenstand.hoflaeden;
      this.state.zuletztAktualisiert = zwischenstand.zuletztAktualisiert;
      this.state.ausCache = true;
      aktualisiereAnsicht();
    });
    this.state.hoflaeden = ergebnis.hoflaeden;
    this.state.zuletztAktualisiert = ergebnis.zuletztAktualisiert;
    this.state.ausCache = ergebnis.ausCache;
    aktualisiereAnsicht();
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
      try {
        const gespeichert = await this.haClient.hofladenSpeichern(daten);
        await this.aktualisiereListe();
        return gespeichert;
      } catch (err) {
        if (err instanceof VersionskonfliktFehler && daten.id) {
          await this._registriereKonflikt(daten, err);
        }
        throw err;
      }
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
    await starteApp({ wiederverbindung: true });
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

// Debug-Zugriff nur lokal bzw. explizit per ?debug=1 (Phase 10, Review S4):
// sonst läge der Client samt Token für jedes Skript auf der Seite offen.
if (
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
  new URLSearchParams(window.location.search).get("debug") === "1"
) {
  window.hofkarteApp = app;
}

function parsePfad() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const teile = hash.split("/").filter(Boolean);
  return teile;
}

/** Name der aktuell gezeichneten Ansicht ("setup", "liste", "editor" ...). */
let aktuelleAnsicht = null;

/** Ansichten mit Nutzereingaben: ein Hintergrund-Refresh darf sie nicht
 * neu zeichnen, sonst gehen Eingaben verloren (Review P-Befund Editor). */
const EINGABE_ANSICHTEN = new Set(["setup", "editor", "neu", "finden", "konflikt", "einstellungen"]);

/** Neu zeichnen nach Datenänderung (Refresh/Wiederverbindung) - lässt
 * Eingabeansichten unangetastet und aktualisiert nur die Sync-Anzeige. */
function aktualisiereAnsicht() {
  const brauchtSetup = !app.haClient && !app.offlineModus;
  if (brauchtSetup !== (aktuelleAnsicht === "setup") || !EINGABE_ANSICHTEN.has(aktuelleAnsicht)) {
    route();
    return;
  }
  aktualisiereSyncLeiste();
}

function route() {
  if (!app.haClient && !app.offlineModus) {
    aktuelleAnsicht = "setup";
    renderSetup(appContainer, verbinden);
    return;
  }

  const teile = parsePfad();
  aktuelleAnsicht =
    teile[0] === "hofladen" && teile[1] && teile[2] === "bearbeiten" ? "editor"
    : teile[0] === "konflikt" && teile[1] ? "konflikt"
    : teile[0] === "neu" ? "neu"
    : teile[0] === "finden" ? "finden"
    : teile[0] === "hofladen" && teile[1] ? "detail"
    : teile[0] === "karte" ? "karte"
    : teile[0] === "einstellungen" ? "einstellungen"
    : "liste";

  const detailHash = (id) => `#/hofladen/${id}`;

  if (teile[0] === "hofladen" && teile[1] && teile[2] === "bearbeiten") {
    renderMitRahmen(() => renderEditor(appContainer.querySelector(".inhalt"), app, teile[1]), null, {
      titel: "Bearbeiten",
      tiefe: 2,
      zurueck: detailHash(teile[1]),
    });
    return;
  }
  if (teile[0] === "konflikt" && teile[1]) {
    renderMitRahmen(() => renderKonflikt(appContainer.querySelector(".inhalt"), app, teile[1]), null, {
      titel: "Konflikt",
      tiefe: 2,
      zurueck: detailHash(teile[1]),
    });
    return;
  }
  if (teile[0] === "finden") {
    renderMitRahmen(() => renderFinden(appContainer.querySelector(".inhalt"), app), "neu", {
      titel: "Hofladen finden",
      tiefe: 1,
      zurueck: "#/neu",
    });
    return;
  }
  if (teile[0] === "neu") {
    renderMitRahmen(() => renderEditor(appContainer.querySelector(".inhalt"), app, null), "neu", {
      titel: "Neuer Hofladen",
      tiefe: 0,
    });
    return;
  }
  if (teile[0] === "hofladen" && teile[1]) {
    renderMitRahmen(() => renderDetail(appContainer.querySelector(".inhalt"), app, teile[1]), null, {
      titel: "Details",
      tiefe: 1,
      zurueck: "#/",
    });
    return;
  }
  if (teile[0] === "karte") {
    renderMitRahmen(() => renderKarte(appContainer.querySelector(".inhalt"), app), "karte", {
      titel: "Karte",
      tiefe: 0,
    });
    return;
  }
  if (teile[0] === "einstellungen") {
    renderMitRahmen(() => renderEinstellungen(appContainer.querySelector(".inhalt"), app), null, {
      titel: "Einstellungen",
      gross: true,
      tiefe: 1,
      zurueck: "#/",
    });
    return;
  }

  renderMitRahmen(() => renderListe(appContainer.querySelector(".inhalt"), app), "liste", {
    titel: "Hofläden",
    gross: true,
    tiefe: 0,
  });
}

/** Sync-Status für die Kopfzeile (Phase 8a): bewusst dezent - erscheint
 * nur, wenn es etwas Nennenswertes zu zeigen gibt (offline und/oder
 * ausstehende Operationen), nicht im unauffälligen Normalzustand (siehe
 * PWA-HA-Vorgehensplan.md Abschnitt 10.3, Punkt 4). */
function syncStatusHtml() {
  const anzahl = app.state.ausstehendeAnzahl || 0;
  const konflikte = app.state.konflikte || [];
  if (konflikte.length) {
    return `<a class="sync-status konflikt" href="#/konflikt/${encodeURIComponent(konflikte[0].hofladenId)}">⚠ ${konflikte.length === 1 ? "1 Konflikt" : `${konflikte.length} Konflikte`}</a>`;
  }
  if (!app.haClient) {
    return `<span class="sync-status offline">⌁ Offline${anzahl ? ` (${anzahl} ausstehend)` : ""}</span>`;
  }
  if (anzahl > 0) {
    return `<span class="sync-status wird-synchronisiert">↻ Wird synchronisiert …</span>`;
  }
  return "";
}

/* Tab-Icons als Inline-SVG (SF-Symbols-ähnlich, Strich + dezente Füllung). */
const TAB_ICONS = {
  liste:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4.5" cy="6.5" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="17.5" r="1" /><path d="M9 6.5h11M9 12h11M9 17.5h11" /></svg>',
  karte:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></svg>',
  neu: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v9M7.5 12h9" /></svg>',
};
const ICON_ZURUECK =
  '<svg viewBox="0 0 13 22" aria-hidden="true"><path d="M11 2L2 11l9 9" /></svg>';
const ICON_EINSTELLUNGEN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>';

let letzteTiefe = 0;
let letzterHash = null;
let aktuelleKopfzeile = null;
let aktuellerGrosserTitel = null;
let aktuelleGrenze = 0;

/** Large-Title-Verhalten: Navigationsleiste blendet beim Scrollen ein
 * (Blur + kleiner Titel), sobald der grosse Titel aus dem Blick ist. */
function aktualisiereKopfzeilenZustand() {
  if (!aktuelleKopfzeile) return;
  aktuelleKopfzeile.classList.toggle("gescrollt", window.scrollY > Math.max(aktuelleGrenze, 4));
}
window.addEventListener("scroll", aktualisiereKopfzeilenZustand, { passive: true });

/** Wischen vom linken Rand zurück (wie iOS): die Seite folgt dem Finger, ab
 * ~35 % Breite oder schnellem Wischen wird zurücknavigiert. */
function aktiviereSwipeZurueck(seite, zielHash) {
  let start = null;
  seite.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      start = t.clientX <= 24 ? { x: t.clientX, y: t.clientY, zeit: Date.now(), aktiv: false } : null;
    },
    { passive: true }
  );
  seite.addEventListener(
    "touchmove",
    (e) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (!start.aktiv && dx > 10 && dx > dy * 1.5) start.aktiv = true;
      if (start.aktiv) {
        seite.style.transition = "none";
        seite.style.transform = `translateX(${Math.max(0, dx)}px)`;
      }
    },
    { passive: true }
  );
  seite.addEventListener("touchend", (e) => {
    if (!start || !start.aktiv) {
      start = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - start.x;
    const schnell = dx / Math.max(1, Date.now() - start.zeit) > 0.5;
    start = null;
    if (dx > window.innerWidth * 0.35 || (schnell && dx > 60)) {
      seite.style.transition = "transform 0.2s ease-out";
      seite.style.transform = `translateX(${window.innerWidth}px)`;
      setTimeout(() => app.navigate(zielHash), 180);
    } else {
      seite.style.transition = "transform 0.2s ease-out";
      seite.style.transform = "";
    }
  });
}

/** Aktualisiert nur die Sync-Kapsel in der Kopfzeile (ohne Neuaufbau der Seite). */
function aktualisiereSyncLeiste() {
  const kopf = appContainer.querySelector(".kopfzeile");
  if (!kopf) return;
  const status = syncStatusHtml();
  let leiste = kopf.querySelector(".sync-leiste");
  if (status) {
    if (!leiste) {
      leiste = document.createElement("div");
      leiste.className = "sync-leiste";
      kopf.appendChild(leiste);
    }
    leiste.innerHTML = status;
  } else {
    leiste?.remove();
  }
  document.documentElement.style.setProperty("--kopf-h", `${kopf.offsetHeight}px`);
}

/** Gemeinsamer Rahmen (Navigationsleiste + Tableiste) um die eigentliche
 * View, im Stil einer iOS-App. Leiste und Tableiste sind fix positioniert
 * (mit Blur), dazwischen scrollt die Seite.
 * opts: { titel, gross (Large Title), tiefe (0 = Tab-Ebene), zurueck (Hash) } */
function renderMitRahmen(viewRender, aktiverTab, opts = {}) {
  const { titel = "HofKarte", gross = false, tiefe = 0, zurueck = null } = opts;
  const richtung = tiefe > letzteTiefe ? "slide-vor" : tiefe < letzteTiefe ? "slide-zurueck" : "";
  letzteTiefe = tiefe;

  appContainer.innerHTML = `
    <header class="kopfzeile${gross ? "" : " ohne-gross"}">
      <div class="nav-zeile">
        <div class="nav-links">
          ${zurueck ? `<button type="button" class="nav-btn zurueck" id="zurueck-btn" aria-label="Zurück">${ICON_ZURUECK}Zurück</button>` : ""}
        </div>
        <h1 class="nav-titel">${titel}</h1>
        <div class="nav-rechts">
          ${
            tiefe === 0 || opts.einstellungenBtn
              ? `<button type="button" class="nav-btn" id="einstellungen-btn" title="Einstellungen" aria-label="Einstellungen">${ICON_EINSTELLUNGEN}</button>`
              : ""
          }
        </div>
      </div>
      ${(() => {
        const status = syncStatusHtml();
        return status ? `<div class="sync-leiste">${status}</div>` : "";
      })()}
    </header>
    <div class="seite ${richtung}">
      ${gross ? `<h1 class="grosser-titel">${titel}</h1>` : ""}
      <main class="inhalt"></main>
    </div>
    <nav class="tableiste" aria-label="Hauptnavigation">
      <button data-tab="liste"><span class="icon">${TAB_ICONS.liste}</span>Liste</button>
      <button data-tab="karte"><span class="icon">${TAB_ICONS.karte}</span>Karte</button>
      <button data-tab="neu"><span class="icon">${TAB_ICONS.neu}</span>Neu</button>
    </nav>
  `;

  const kopfzeile = appContainer.querySelector(".kopfzeile");
  aktuelleKopfzeile = kopfzeile;
  aktuellerGrosserTitel = appContainer.querySelector(".grosser-titel");
  // Schwelle einmal messen (kein Layout-Zwang bei jedem Scroll-Event).
  aktuelleGrenze = aktuellerGrosserTitel ? aktuellerGrosserTitel.offsetHeight - 6 : 0;
  // Höhe der (evtl. durch die Sync-Kapsel höheren) Leiste für das Seiten-Padding.
  document.documentElement.style.setProperty("--kopf-h", `${kopfzeile.offsetHeight}px`);
  if (window.location.hash !== letzterHash) window.scrollTo(0, 0);
  letzterHash = window.location.hash;
  aktualisiereKopfzeilenZustand();

  appContainer.querySelector("#einstellungen-btn")?.addEventListener("click", () => {
    app.navigate("#/einstellungen");
  });
  appContainer.querySelector("#zurueck-btn")?.addEventListener("click", () => app.navigate(zurueck));
  if (zurueck) aktiviereSwipeZurueck(appContainer.querySelector(".seite"), zurueck);

  const tabZiele = { liste: "#/", karte: "#/karte", neu: "#/neu" };
  appContainer.querySelectorAll(".tableiste button").forEach((btn) => {
    const tab = btn.dataset.tab;
    if (tab === aktiverTab) {
      btn.classList.add("aktiv");
      btn.setAttribute("aria-current", "page");
    }
    btn.addEventListener("click", () => app.navigate(tabZiele[tab]));
  });

  viewRender();
}

async function verbinden(eingabeUrl, token) {
  const haUrl = pruefeHaAdresse(eingabeUrl);
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

let starteLaeuft = false;

async function starteApp({ wiederverbindung = false } = {}) {
  // Kein paralleler Start (z. B. Timer + Button gleichzeitig).
  if (starteLaeuft) return;
  starteLaeuft = true;
  try {
    await starteAppIntern(wiederverbindung);
  } finally {
    starteLaeuft = false;
  }
}

async function starteAppIntern(wiederverbindung) {
  app.haClient?.trennen();
  app.haClient = null;
  // Beim stillen Wiederverbindungsversuch bleibt der Offline-Modus bis zum
  // Ergebnis bestehen - sonst würde kurz die Einrichtung gezeigt.
  if (!wiederverbindung) app.offlineModus = false;

  const gespeichert = await ladeVerbindung();
  if (!gespeichert) {
    app.offlineModus = false;
    route();
    return;
  }

  try {
    const client = new HaClient(gespeichert.haUrl, gespeichert.token);
    await client.verbinden();
    app.haClient = client;
    app.offlineModus = false;
    app.haUrl = gespeichert.haUrl;
    app._stoppeOfflineRetry();
    app.state.einstellungen = await client.einstellungen().catch(() => null);
    await verarbeiteWarteschlange(app);
    await app.aktualisiereListe();
  } catch (err) {
    if (err.code === "invalid_auth") {
      // Token wurde widerrufen/ist ungültig - zurück zum Einrichtungsbildschirm.
      app._stoppeOfflineRetry();
      app.offlineModus = false;
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
  aktualisiereAnsicht();
}

starteApp();

// Service Worker (zuvor Inline-Skript in index.html - entfällt wegen CSP).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.error("Service Worker Registrierung fehlgeschlagen:", err));
  });
}
