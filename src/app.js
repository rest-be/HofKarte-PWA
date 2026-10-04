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

import { ladeVerbindung, speichereVerbindung, loescheVerbindung, ladeCache } from "./storage.js";
import { HaClient, EVENT_AUTH_FEHLER } from "./ha-client.js";
import { renderSetup } from "./views/setup.js";
import { renderListe } from "./views/list.js";
import { renderKarte } from "./views/map.js";
import { renderDetail } from "./views/detail.js";
import { renderEditor } from "./views/editor.js";
import { renderEinstellungen } from "./views/einstellungen.js";

const appContainer = document.getElementById("app");

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

  async speichereHofladen(daten) {
    this._pruefeVerbindung();
    const gespeichert = await this.haClient.hofladenSpeichern(daten);
    await this.aktualisiereListe();
    return gespeichert;
  },

  async loescheHofladen(id) {
    this._pruefeVerbindung();
    await this.haClient.hofladenLoeschen(id);
    await this.aktualisiereListe();
  },

  async versucheErneutZuVerbinden() {
    await starteApp();
  },

  async abmelden() {
    this.haClient?.trennen();
    this.haClient = null;
    this.haUrl = null;
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
    await speichereVerbindung(this.haUrl, neuesToken);

    this.state.einstellungen = await neuerClient.einstellungen().catch(() => null);
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

/** Gemeinsamer Rahmen (Kopfzeile + Tableiste) um die eigentliche View. Kopf-
 * und Fusszeile sind fix positioniert und damit immer sichtbar, nur der
 * dazwischenliegende Inhaltsbereich (.inhalt) scrollt (siehe styles.css). */
function renderMitRahmen(viewRender, aktiverTab) {
  appContainer.innerHTML = `
    <header class="kopfzeile">
      <h1>🥕 HofKarte</h1>
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
  await speichereVerbindung(haUrl, token);

  app.state.einstellungen = await client.einstellungen().catch(() => null);
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
    app.state.einstellungen = await client.einstellungen().catch(() => null);
    await app.aktualisiereListe();
  } catch (err) {
    if (err.code === "invalid_auth") {
      // Token wurde widerrufen/ist ungültig - zurück zum Einrichtungsbildschirm.
      await loescheVerbindung();
    } else {
      // "connection_lost" (z. B. gerade kein VPN aktiv): eingerichtet
      // bleiben, aber mit dem Lesecache weiterarbeiten, statt zum
      // Einrichtungsbildschirm zurückzufallen.
      app.offlineModus = true;
      app.haUrl = gespeichert.haUrl;
      await app.aktualisiereListe();
    }
  }
  route();
}

starteApp();
