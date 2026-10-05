/**
 * Übersicht: Suche/Sortierung, "Hofläden in der Nähe"-Karte und die
 * Liste aller Hofläden als Karten (siehe Vorgehensplan Phase 4,
 * Schritt 35 – Listen-/Kachelnansicht aus hofkarte-panel.js, auf die
 * Standalone-Navigation der PWA angepasst).
 */

import { hoflaedenInNaeheDesGeraets, STANDARD_RADIUS_METER } from "../naehe.js";

const SORT_SPALTEN = [
  { wert: "name", label: "Name" },
  { wert: "adresse", label: "Adresse" },
  { wert: "geoeffnet", label: "Status" },
  { wert: "bewertung", label: "Bewertung" },
];

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

function sortiereUndFiltere(hoflaeden, suchbegriff, sortSpalte, sortRichtung) {
  let ergebnis = hoflaeden;
  if (suchbegriff) {
    const begriff = suchbegriff.toLowerCase();
    ergebnis = ergebnis.filter((h) =>
      [h.name, h.beschreibung, h.ort].some((feld) => feld?.toLowerCase().includes(begriff))
    );
  }

  const faktor = sortRichtung === "desc" ? -1 : 1;
  ergebnis = [...ergebnis].sort((a, b) => {
    let av, bv;
    if (sortSpalte === "geoeffnet") {
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

export function renderListe(container, app) {
  const einstellungen = app.state.einstellungen || {};
  let suchbegriff = "";
  let sortSpalte = einstellungen.listen_sort_spalte || "name";
  let sortRichtung = einstellungen.listen_sort_richtung || "asc";

  function zeichneListe() {
    const gefiltert = sortiereUndFiltere(
      app.state.hoflaeden,
      suchbegriff,
      sortSpalte,
      sortRichtung
    );

    const listeHtml = gefiltert.length
      ? gefiltert
          .map(
            (h) => `
        <div class="hofladen-karte" data-id="${h.id}">
          ${
            h.hauptbild_url
              ? `<img class="miniatur" src="${h.hauptbild_url}" alt="" loading="lazy" />`
              : `<div class="miniatur" aria-hidden="true"></div>`
          }
          <div class="info">
            <p class="name">${escapeHtml(h.name)}${h._synchronisierungAusstehend ? ` <span title="Noch nicht synchronisiert">⌁</span>` : ""}${app.konfliktFuer && app.konfliktFuer(h.id) ? ` <span title="Versionskonflikt">⚠</span>` : ""}</p>
            <p class="ort">${escapeHtml(h.ort || "")}</p>
            ${statusBadge(h.geoeffnet)} ${bewertungSterne(h.bewertung)}
          </div>
        </div>`
          )
          .join("")
      : `<p class="hinweis-leiste">Keine Hofläden gefunden.</p>`;

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
          ${SORT_SPALTEN.map(
            (s) => `<option value="${s.wert}" ${s.wert === sortSpalte ? "selected" : ""}>${s.label}</option>`
          ).join("")}
        </select>
        <button id="sort-richtung" title="Sortierrichtung umkehren" aria-label="${
          sortRichtung === "asc" ? "Aufsteigend sortiert, umkehren für absteigend" : "Absteigend sortiert, umkehren für aufsteigend"
        }">${sortRichtung === "asc" ? "↑" : "↓"}</button>
      </div>

      <div id="hofladen-liste" class="gruppe">${listeHtml}</div>
    `;

    container.querySelector("#such-feld").addEventListener("input", (e) => {
      suchbegriff = e.target.value;
      zeichneListe();
    });
    container.querySelector("#sort-spalte").addEventListener("change", (e) => {
      sortSpalte = e.target.value;
      zeichneListe();
    });
    container.querySelector("#sort-richtung").addEventListener("click", () => {
      sortRichtung = sortRichtung === "asc" ? "desc" : "asc";
      zeichneListe();
    });
    container.querySelectorAll(".hofladen-karte").forEach((karte) => {
      karte.addEventListener("click", () => app.navigate(`#/hofladen/${karte.dataset.id}`));
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
    try {
      app._pruefeVerbindung();
      const { treffer } = await hoflaedenInNaeheDesGeraets(app.haClient, {
        radiusMeter: STANDARD_RADIUS_METER,
        nurGeoeffnet: true,
      });
      if (!treffer.length) {
        ergebnisBox.innerHTML = `<p class="ort">Kein geöffneter Hofladen im Umkreis von ${STANDARD_RADIUS_METER} m.</p>
          <button class="aktualisieren" id="naehe-suchen-btn">Erneut prüfen</button>`;
      } else {
        ergebnisBox.innerHTML =
          treffer
            .map(
              (t) => `
            <div class="naehe-eintrag" data-id="${t.id}">
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
      <div class="naehe-karte">
        <h2>📍 Hofläden in der Nähe</h2>
        <div id="naehe-ergebnis">
          <button class="aktualisieren" id="naehe-suchen-btn">Standort abfragen</button>
        </div>
      </div>
    `;

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

export function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
