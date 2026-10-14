/**
 * Übersicht: Suche/Sortierung, "Hofläden in der Nähe"-Karte und die
 * Liste aller Hofläden als Karten (siehe Vorgehensplan Phase 4,
 * Schritt 35 – Listen-/Kachelnansicht aus hofkarte-panel.js, auf die
 * Standalone-Navigation der PWA angepasst).
 */

import { hoflaedenInNaeheDesGeraets, aktuellerStandort, entfernungMeter as distanzMeter, STANDARD_RADIUS_METER } from "../naehe.js";
import { offeneGruppen } from "../gruppen.js";
import { ladeNaeheRadius } from "../storage.js";
import { escapeHtml } from "../html.js";
import { vorschauUrl } from "../bilder.js";
import { icon } from "../icons.js";

// Re-Export: editor/detail/konflikt importierten escapeHtml früher von hier.
export { escapeHtml };

const SUCHE_VERZOEGERUNG_MS = 150;

const SORT_SPALTEN = [
  { wert: "name", label: "Name" },
  { wert: "adresse", label: "Adresse" },
  { wert: "geoeffnet", label: "Status" },
  { wert: "bewertung", label: "Bewertung" },
];

export function formatDistanz(meter) {
  if (meter == null || !Number.isFinite(meter)) return "";
  if (meter < 1000) return `${Math.round(meter / 10) * 10 || 10} m`;
  return `${(meter / 1000).toLocaleString("de-CH", { maximumFractionDigits: 1 })} km`;
}

function statusBadge(geoeffnet) {
  if (geoeffnet === true) return `<span class="status-badge offen">Geöffnet</span>`;
  if (geoeffnet === false) return `<span class="status-badge geschlossen">Geschlossen</span>`;
  return `<span class="status-badge unbekannt">Unbekannt</span>`;
}

function bewertungSterne(wert) {
  const n = Math.max(0, Math.min(5, Number(wert) || 0));
  if (n === 0) return "";
  return `<span class="bewertung-sterne">${"★".repeat(n)}</span>`;
}

function relativeZeit(isoZeitpunkt) {
  if (!isoZeitpunkt) return "";
  const diffMs = Date.now() - new Date(isoZeitpunkt).getTime();
  const minuten = Math.round(diffMs / 60000);
  if (minuten < 1) return "gerade eben";
  if (minuten < 60) return `vor ${minuten} Min.`;
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return `vor ${stunden} Std.`;
  return new Date(isoZeitpunkt).toLocaleString("de-CH");
}

/**
 * Filter: `{nurOffen, unvollstaendig}`; `position` ({latitude, longitude}) nur
 * im Speicher, nie gespeichert. Mit Position wird `entfernung` pro Eintrag
 * berechnet und kann als Sortierspalte dienen.
 */
export function sortiereUndFiltere(hoflaeden, suchbegriff, sortSpalte, sortRichtung, filter = {}, position = null) {
  let ergebnis = hoflaeden;
  if (filter.nurOffen) ergebnis = ergebnis.filter((h) => h.geoeffnet === true);
  if (filter.unvollstaendig) ergebnis = ergebnis.filter((h) => offeneGruppen(h).length > 0);
  const distanz = (h) =>
    position && h.latitude != null && h.longitude != null
      ? distanzMeter(position.latitude, position.longitude, h.latitude, h.longitude)
      : null;
  if (suchbegriff) {
    const begriff = suchbegriff.toLowerCase();
    ergebnis = ergebnis.filter((h) =>
      [h.name, h.beschreibung, h.ort].some((feld) => feld?.toLowerCase().includes(begriff))
    );
  }

  const faktor = sortRichtung === "desc" ? -1 : 1;
  ergebnis = [...ergebnis].sort((a, b) => {
    let av, bv;
    if (sortSpalte === "entfernung") {
      // Ohne Koordinaten immer ans Ende, unabhängig von der Richtung.
      const da = distanz(a);
      const db = distanz(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return (da - db) * faktor;
    } else if (sortSpalte === "geoeffnet") {
      av = a.geoeffnet === true ? 2 : a.geoeffnet === false ? 0 : 1;
      bv = b.geoeffnet === true ? 2 : b.geoeffnet === false ? 0 : 1;
    } else if (sortSpalte === "bewertung") {
      av = Number(a.bewertung) || 0;
      bv = Number(b.bewertung) || 0;
    } else {
      av = (a[sortSpalte] || "").toString().toLowerCase();
      bv = (b[sortSpalte] || "").toString().toLowerCase();
    }
    if (av < bv) return -1 * faktor;
    if (av > bv) return 1 * faktor;
    return 0;
  });

  return ergebnis;
}

/** Eingeklappt als Standard: braucht so möglichst wenig Platz. */
let naeheOffen = false;
const gemerkt = { suchbegriff: "", sortSpalte: null, sortRichtung: null, nurOffen: false, unvollstaendig: false };
/** Standort nur im Speicher, nur nach Tipp auf «In der Nähe»; wird nie gespeichert. */
let position = null;

export function renderListe(container, app) {
  const einstellungen = app.state.einstellungen || {};
  // Suche/Sortierung überleben ein Neuzeichnen (z. B. nach Daten-Refresh).
  if (gemerkt.sortSpalte == null) {
    gemerkt.sortSpalte = einstellungen.listen_sort_spalte || "name";
    gemerkt.sortRichtung = einstellungen.listen_sort_richtung || "asc";
  }
  let { suchbegriff, sortSpalte, sortRichtung, nurOffen, unvollstaendig } = gemerkt;
  if (sortSpalte === "entfernung" && !position) {
    sortSpalte = "name";
    sortRichtung = "asc";
  }
  const merke = () => Object.assign(gemerkt, { suchbegriff, sortSpalte, sortRichtung, nurOffen, unvollstaendig });
  const sortOptionen = () =>
    position ? [{ wert: "entfernung", label: "Entfernung" }, ...SORT_SPALTEN] : SORT_SPALTEN;

  function eintraegeHtml() {
    const gefiltert = sortiereUndFiltere(
      app.state.hoflaeden,
      suchbegriff,
      sortSpalte,
      sortRichtung,
      { nurOffen, unvollstaendig },
      position
    );

    return gefiltert.length
      ? gefiltert
          .map(
            (h) => `
        <div class="hofladen-karte" data-id="${escapeHtml(h.id)}">
          ${
            h.hauptbild_url
              ? `<img class="miniatur" src="${escapeHtml(vorschauUrl(h.hauptbild_url, 256))}" alt="" loading="lazy" decoding="async" />`
              : `<div class="miniatur" aria-hidden="true"></div>`
          }
          <div class="info">
            <p class="name">${escapeHtml(h.name)}${h._synchronisierungAusstehend ? ` <span title="Noch nicht synchronisiert" aria-label="Noch nicht synchronisiert">${icon("offline", { klein: true })}</span>` : ""}${app.konfliktFuer && app.konfliktFuer(h.id) ? ` <span title="Versionskonflikt" aria-label="Versionskonflikt">${icon("warnung", { klein: true })}</span>` : ""}</p>
            <p class="ort">${escapeHtml(h.ort || "")}</p>
            ${statusBadge(h.geoeffnet)} ${bewertungSterne(h.bewertung)}${entfernungHtml(h)}
          </div>
        </div>`
          )
          .join("")
      : `<p class="hinweis-leiste">Keine Hofläden gefunden.</p>`;
  }

  function entfernungHtml(h) {
    if (!position || h.latitude == null || h.longitude == null) return "";
    const text = formatDistanz(distanzMeter(position.latitude, position.longitude, h.latitude, h.longitude));
    return ` <span class="entfernung">${icon("standort", { klein: true })} ${escapeHtml(text)}</span>`;
  }

  /** Aktualisiert nur die Trefferliste - Suchfeld und Fokus bleiben unberührt. */
  function zeichneEintraege() {
    const box = container.querySelector("#hofladen-liste");
    if (box) box.innerHTML = eintraegeHtml();
    const zaehler = container.querySelector("#treffer-zaehler");
    if (zaehler) zaehler.textContent = zaehlerText();
  }

  function zaehlerText() {
    const n = sortiereUndFiltere(app.state.hoflaeden, suchbegriff, sortSpalte, sortRichtung, { nurOffen, unvollstaendig }, position).length;
    return n === 1 ? "1 Hofladen" : `${n} Hofläden`;
  }

  function zeichneSortOptionen() {
    const sel = container.querySelector("#sort-spalte");
    if (!sel) return;
    sel.innerHTML = sortOptionen()
      .map((s) => `<option value="${s.wert}" ${s.wert === sortSpalte ? "selected" : ""}>${s.label}</option>`)
      .join("");
  }

  async function schalteNaehe(btn) {
    const meldung = container.querySelector("#filter-meldung");
    meldung.textContent = "";
    if (position) {
      position = null;
      if (sortSpalte === "entfernung") {
        sortSpalte = "name";
        sortRichtung = "asc";
      }
    } else {
      btn.disabled = true;
      meldung.textContent = "Standort wird ermittelt …";
      try {
        position = await aktuellerStandort();
        sortSpalte = "entfernung";
        sortRichtung = "asc";
        meldung.textContent = "";
      } catch (err) {
        meldung.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    }
    merke();
    btn.setAttribute("aria-pressed", String(!!position));
    zeichneSortOptionen();
    richtungBeschriftung();
    zeichneEintraege();
  }

  function richtungBeschriftung() {
    const btn = container.querySelector("#sort-richtung");
    if (!btn) return;
    btn.textContent = sortRichtung === "asc" ? "↑" : "↓";
    btn.setAttribute(
      "aria-label",
      sortRichtung === "asc"
        ? "Aufsteigend sortiert, umkehren für absteigend"
        : "Absteigend sortiert, umkehren für aufsteigend"
    );
  }

  /** Baut das Gerüst (Suchleiste, Nähe-Karte) genau einmal auf. */
  function zeichneListe() {
    const listeHtml = eintraegeHtml();

    container.innerHTML = `
      <div id="naehe-platzhalter"></div>

      ${
        app.state.ausCache
          ? `<div class="hinweis-leiste">
               Zuletzt aktualisiert: ${relativeZeit(app.state.zuletztAktualisiert)}
               ${app.offlineModus ? " – keine Verbindung" : ""}
             </div>`
          : ""
      }

      <div class="such-leiste">
        <input type="search" id="such-feld" placeholder="Suchen …" aria-label="Hofläden suchen" value="${escapeHtml(
          suchbegriff
        )}" />
        <select id="sort-spalte" aria-label="Sortieren nach">
          ${sortOptionen()
            .map((s) => `<option value="${s.wert}" ${s.wert === sortSpalte ? "selected" : ""}>${s.label}</option>`)
            .join("")}
        </select>
        <button id="sort-richtung" title="Sortierrichtung umkehren" aria-label="${
          sortRichtung === "asc" ? "Aufsteigend sortiert, umkehren für absteigend" : "Absteigend sortiert, umkehren für aufsteigend"
        }">${sortRichtung === "asc" ? "↑" : "↓"}</button>
      </div>

      <div class="chip-liste filter-chips" role="group" aria-label="Filter">
        <button type="button" class="chip" id="chip-naehe" aria-pressed="${!!position}">${icon("standort", { klein: true })} In der Nähe</button>
        <button type="button" class="chip" id="chip-offen" aria-pressed="${nurOffen}">Geöffnet</button>
        <button type="button" class="chip" id="chip-unvollstaendig" aria-pressed="${unvollstaendig}">Unvollständig</button>
      </div>
      <p class="ort filter-meldung" id="filter-meldung" role="status"></p>
      <p class="ort" id="treffer-zaehler" aria-live="polite">${zaehlerText()}</p>

      <div id="hofladen-liste" class="gruppe">${listeHtml}</div>
    `;

    let suchTimer = null;
    container.querySelector("#such-feld").addEventListener("input", (e) => {
      suchbegriff = e.target.value;
      merke();
      clearTimeout(suchTimer);
      suchTimer = setTimeout(zeichneEintraege, SUCHE_VERZOEGERUNG_MS);
    });
    container.querySelector("#chip-naehe").addEventListener("click", (e) => schalteNaehe(e.currentTarget));
    for (const [id, setze] of [
      ["#chip-offen", (v) => (nurOffen = v)],
      ["#chip-unvollstaendig", (v) => (unvollstaendig = v)],
    ]) {
      container.querySelector(id).addEventListener("click", (e) => {
        const an = e.currentTarget.getAttribute("aria-pressed") !== "true";
        e.currentTarget.setAttribute("aria-pressed", String(an));
        setze(an);
        merke();
        zeichneEintraege();
      });
    }
    container.querySelector("#sort-spalte").addEventListener("change", (e) => {
      sortSpalte = e.target.value;
      merke();
      zeichneEintraege();
    });
    container.querySelector("#sort-richtung").addEventListener("click", () => {
      sortRichtung = sortRichtung === "asc" ? "desc" : "asc";
      merke();
      richtungBeschriftung();
      zeichneEintraege();
    });
    // Event-Delegation: bleibt gültig, wenn die Trefferliste neu gezeichnet wird.
    container.querySelector("#hofladen-liste").addEventListener("click", (e) => {
      const karte = e.target.closest(".hofladen-karte");
      if (karte) app.navigate(`#/hofladen/${karte.dataset.id}`);
    });
    if (app.offlineModus) {
      const hinweis = container.querySelector(".hinweis-leiste");
      if (hinweis) {
        hinweis.insertAdjacentHTML(
          "beforeend",
          ` <button class="aktualisieren" id="erneut-verbinden-btn">Erneut verbinden</button>`
        );
        container.querySelector("#erneut-verbinden-btn").addEventListener("click", () => {
          app.versucheErneutZuVerbinden();
        });
      }
    }

    zeichneNaeheKarte();
  }

  async function sucheNaehe(ergebnisBox) {
    ergebnisBox.innerHTML = `<p class="ort">Standort wird ermittelt …</p>`;
    const radiusMeter = (await ladeNaeheRadius().catch(() => null)) ?? STANDARD_RADIUS_METER;
    try {
      app._pruefeVerbindung();
      const { treffer } = await hoflaedenInNaeheDesGeraets(app.haClient, {
        radiusMeter,
        nurGeoeffnet: true,
      });
      if (!treffer.length) {
        ergebnisBox.innerHTML = `<p class="ort">Kein geöffneter Hofladen im Umkreis von ${radiusMeter} m (Umkreis in den Einstellungen änderbar).</p>
          <button class="aktualisieren" id="naehe-suchen-btn">Erneut prüfen</button>`;
      } else {
        ergebnisBox.innerHTML =
          treffer
            .map(
              (t) => `
            <div class="naehe-eintrag" data-id="${escapeHtml(t.id)}">
              <span>${escapeHtml(t.name)}</span>
              <span>${Math.round(t.entfernung_meter)} m</span>
            </div>`
            )
            .join("") +
          `<button class="aktualisieren" id="naehe-suchen-btn">Erneut prüfen</button>`;
      }
    } catch (err) {
      ergebnisBox.innerHTML = `<p class="ort">${escapeHtml(err.message)}</p>
        <button class="aktualisieren" id="naehe-suchen-btn">Erneut versuchen</button>`;
    }
  }

  function zeichneNaeheKarte() {
    const platzhalter = container.querySelector("#naehe-platzhalter");
    if (!platzhalter) return;
    platzhalter.innerHTML = `
      <details class="naehe-karte"${naeheOffen ? " open" : ""}>
        <summary>${icon("standort", { klein: true })} Hofläden in der Nähe</summary>
        <div id="naehe-ergebnis">
          <button class="aktualisieren" id="naehe-suchen-btn">Standort abfragen</button>
        </div>
      </details>
    `;
    // Zustand (offen/eingeklappt) merken, damit ein Neuzeichnen der Liste
    // (z. B. beim Tippen im Suchfeld) die Karte nicht wieder einklappt.
    platzhalter.querySelector("details").addEventListener("toggle", (e) => {
      naeheOffen = e.target.open;
    });

    // Event-Delegation auf den stabilen Container, statt Listener direkt
    // auf den Button: der Button wird bei jedem Suchlauf neu erzeugt
    // (innerHTML-Ersetzung), ein direkt daran gebundener Listener ginge
    // dabei verloren.
    const ergebnisBox = platzhalter.querySelector("#naehe-ergebnis");
    ergebnisBox.addEventListener("click", (event) => {
      if (event.target.id === "naehe-suchen-btn") {
        sucheNaehe(ergebnisBox);
      }
      const eintrag = event.target.closest(".naehe-eintrag");
      if (eintrag) {
        app.navigate(`#/hofladen/${eintrag.dataset.id}`);
      }
    });
  }

  zeichneListe();
}
