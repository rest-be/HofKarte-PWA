/**
 * Übersicht: Suche/Sortierung, "Hofläden in der Nähe"-Karte und die
 * Liste aller Hofläden als Karten (siehe Vorgehensplan Phase 4,
 * Schritt 35 – Listen-/Kachelnansicht aus hofkarte-panel.js, auf die
 * Standalone-Navigation der PWA angepasst).
 */

import { hoflaedenInNaeheDesGeraets, aktuellerStandort, entfernungMeter as distanzMeter, STANDARD_RADIUS_METER } from "../naehe.js";
import { leerzustandHtml } from "../leerzustand.js";
import { fotoFehlt, offeneGruppen } from "../gruppen.js";
import { ladeNaeheRadius } from "../storage.js";
import { escapeHtml } from "../html.js";
import { vorschauUrl } from "../bilder.js";
import { icon } from "../icons.js";
import { t, tn, aktuelleLocale } from "../i18n.js";

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
  return `${(meter / 1000).toLocaleString(aktuelleLocale(), { maximumFractionDigits: 1 })} km`;
}

function statusBadge(geoeffnet) {
  if (geoeffnet === true) return `<span class="status-badge offen">${escapeHtml(t("Geöffnet"))}</span>`;
  if (geoeffnet === false) return `<span class="status-badge geschlossen">${escapeHtml(t("Geschlossen"))}</span>`;
  return `<span class="status-badge unbekannt">${escapeHtml(t("Unbekannt"))}</span>`;
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
  if (minuten < 1) return t("gerade eben");
  if (minuten < 60) return t("vor {n} Min.", { n: minuten });
  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return t("vor {n} Std.", { n: stunden });
  return new Date(isoZeitpunkt).toLocaleString(aktuelleLocale());
}

/**
 * Filter: `{nurOffen, unvollstaendig}`; `position` ({latitude, longitude}) nur
 * im Speicher, nie gespeichert. Mit Position wird `entfernung` pro Eintrag
 * berechnet und kann als Sortierspalte dienen.
 */
export function sortiereUndFiltere(hoflaeden, suchbegriff, sortSpalte, sortRichtung, filter = {}, position = null) {
  let ergebnis = hoflaeden;
  if (filter.nurOffen) ergebnis = ergebnis.filter((h) => h.geoeffnet === true);
  if (filter.ohneFoto) ergebnis = ergebnis.filter((h) => fotoFehlt(h));
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
const gemerkt = { suchbegriff: "", sortSpalte: null, sortRichtung: null, nurOffen: false, unvollstaendig: false, ohneFoto: false };
/** Standort nur im Speicher, nur nach Tipp auf «In der Nähe»; wird nie gespeichert. */
let position = null;
/** Filter-Bereich auf- oder eingeklappt (eingeklappt als Standard, spart Platz). */
let filterOffen = false;

export function renderListe(container, app) {
  const einstellungen = app.state.einstellungen || {};
  // Suche/Sortierung überleben ein Neuzeichnen (z. B. nach Daten-Refresh).
  if (gemerkt.sortSpalte == null) {
    gemerkt.sortSpalte = einstellungen.listen_sort_spalte || "name";
    gemerkt.sortRichtung = einstellungen.listen_sort_richtung || "asc";
  }
  let { suchbegriff, sortSpalte, sortRichtung, nurOffen, unvollstaendig, ohneFoto } = gemerkt;
  if (sortSpalte === "entfernung" && !position) {
    sortSpalte = "name";
    sortRichtung = "asc";
  }
  const merke = () => Object.assign(gemerkt, { suchbegriff, sortSpalte, sortRichtung, nurOffen, unvollstaendig, ohneFoto });
  const sortOptionen = () =>
    position ? [{ wert: "entfernung", label: "Entfernung" }, ...SORT_SPALTEN] : SORT_SPALTEN;

  function eintraegeHtml() {
    const gefiltert = sortiereUndFiltere(
      app.state.hoflaeden,
      suchbegriff,
      sortSpalte,
      sortRichtung,
      { nurOffen, unvollstaendig, ohneFoto },
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
            <p class="name">${escapeHtml(h.name)}${h._synchronisierungAusstehend ? ` <span title="${escapeHtml(t("Noch nicht synchronisiert"))}" aria-label="${escapeHtml(t("Noch nicht synchronisiert"))}">${icon("offline", { klein: true })}</span>` : ""}${app.konfliktFuer && app.konfliktFuer(h.id) ? ` <span title="${escapeHtml(t("Versionskonflikt"))}" aria-label="${escapeHtml(t("Versionskonflikt"))}">${icon("warnung", { klein: true })}</span>` : ""}</p>
            <p class="ort">${escapeHtml(h.ort || "")}</p>
            ${statusBadge(h.geoeffnet)} ${bewertungSterne(h.bewertung)}${entfernungHtml(h)}${fotoFehlt(h) ? ` <span class="foto-fehlt">${icon("kamera", { klein: true })} ${escapeHtml(t("Foto fehlt"))}</span>` : ""}
          </div>
        </div>`
          )
          .join("")
      : app.state.hoflaeden.length
      ? leerzustandHtml({
          symbol: "suche",
          titel: t("Keine Treffer"),
          text: t("Passe die Suche oder die Filter an."),
          aktion: { id: "filter-zuruecksetzen", label: t("Suche und Filter zurücksetzen") },
        })
      : leerzustandHtml({
          symbol: "hof",
          titel: t("Noch keine Hofläden"),
          text: t("Erfasse den ersten Hofladen: vor Ort oder von einer Webseite."),
          aktion: { href: "#/erfassen", id: "leer-erfassen", label: t("Hofladen erfassen") },
        });
  }

  function entfernungHtml(h) {
    if (!position || h.latitude == null || h.longitude == null) return "";
    const text = formatDistanz(distanzMeter(position.latitude, position.longitude, h.latitude, h.longitude));
    return ` <span class="entfernung">${icon("standort", { klein: true })} ${escapeHtml(text)}</span>`;
  }

  const FILTER_DEFS = () => [
    { id: "chip-naehe", name: t("In der Nähe"), aktiv: !!position },
    { id: "chip-offen", name: t("Geöffnet"), aktiv: nurOffen },
    { id: "chip-unvollstaendig", name: t("Unvollständig"), aktiv: unvollstaendig },
    { id: "chip-ohne-foto", name: t("Ohne Foto"), aktiv: ohneFoto },
  ];

  /** Zeigt aktive Filter als entfernbare Chips unter der Suche; Zähler am Filter-Knopf. */
  function zeichneAktiveFilter() {
    const aktiv = FILTER_DEFS().filter((f) => f.aktiv);
    const box = container.querySelector("#aktive-filter");
    const zahl = container.querySelector("#filter-zahl");
    const btn = container.querySelector("#filter-btn");
    if (!box) return;
    box.hidden = aktiv.length === 0;
    box.innerHTML = aktiv
      .map(
        (f) => `<button type="button" class="aktiver-filter" data-filter="${f.id}" aria-label="${escapeHtml(t("Filter entfernen: {name}", { name: f.name }))}"><span>${escapeHtml(f.name)}</span> ${icon("schliessen", { klein: true })}</button>`
      )
      .join("");
    zahl.hidden = aktiv.length === 0;
    zahl.textContent = String(aktiv.length);
    btn.setAttribute("aria-label", aktiv.length ? t("Filter, {n} aktiv", { n: aktiv.length }) : t("Filter"));
    for (const f of FILTER_DEFS()) container.querySelector(`#${f.id}`)?.setAttribute("aria-pressed", String(f.aktiv));
  }

  /** Aktualisiert nur die Trefferliste - Suchfeld und Fokus bleiben unberührt. */
  function zeichneEintraege() {
    const box = container.querySelector("#hofladen-liste");
    if (box) box.innerHTML = eintraegeHtml();
    const zaehler = container.querySelector("#treffer-zaehler");
    if (zaehler) zaehler.textContent = zaehlerText();
    zeichneAktiveFilter();
  }

  function zaehlerText() {
    const n = sortiereUndFiltere(app.state.hoflaeden, suchbegriff, sortSpalte, sortRichtung, { nurOffen, unvollstaendig, ohneFoto }, position).length;
    return tn(n, "1 Hofladen", "{n} Hofläden");
  }

  function zeichneSortOptionen() {
    const sel = container.querySelector("#sort-spalte");
    if (!sel) return;
    sel.innerHTML = sortOptionen()
      .map((s) => `<option value="${s.wert}" ${s.wert === sortSpalte ? "selected" : ""}>${escapeHtml(t(s.label))}</option>`)
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
      meldung.textContent = t("Standort wird ermittelt …");
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
        ? t("Aufsteigend sortiert, umkehren für absteigend")
        : t("Absteigend sortiert, umkehren für aufsteigend")
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
               ${escapeHtml(t("Zuletzt aktualisiert:"))} ${escapeHtml(relativeZeit(app.state.zuletztAktualisiert))}
               ${app.offlineModus ? ` – ${escapeHtml(t("keine Verbindung"))}` : ""}
             </div>`
          : ""
      }

      <div class="such-leiste">
        <input type="search" id="such-feld" placeholder="${escapeHtml(t("Suchen …"))}" aria-label="${escapeHtml(t("Hofläden suchen"))}" value="${escapeHtml(
          suchbegriff
        )}" />
        <button type="button" class="filter-btn" id="filter-btn" aria-expanded="${filterOffen}" aria-controls="filter-panel">${icon("filter", { klein: true })} <span>${escapeHtml(t("Filter"))}</span><span class="filter-zahl" id="filter-zahl" hidden></span></button>
      </div>

      <div class="filter-panel" id="filter-panel" role="group" aria-label="${escapeHtml(t("Filter und Sortierung"))}"${filterOffen ? "" : " hidden"}>
        <button type="button" class="filter-zeile" id="chip-naehe" aria-pressed="${!!position}">${icon("standort", { klein: true })} <span>${escapeHtml(t("In der Nähe"))}</span><span class="filter-schalter" aria-hidden="true"></span></button>
        <button type="button" class="filter-zeile" id="chip-offen" aria-pressed="${nurOffen}">${icon("uhr", { klein: true })} <span>${escapeHtml(t("Geöffnet"))}</span><span class="filter-schalter" aria-hidden="true"></span></button>
        <button type="button" class="filter-zeile" id="chip-unvollstaendig" aria-pressed="${unvollstaendig}">${icon("info", { klein: true })} <span>${escapeHtml(t("Unvollständig"))}</span><span class="filter-schalter" aria-hidden="true"></span></button>
        <button type="button" class="filter-zeile" id="chip-ohne-foto" aria-pressed="${ohneFoto}">${icon("kamera", { klein: true })} <span>${escapeHtml(t("Ohne Foto"))}</span><span class="filter-schalter" aria-hidden="true"></span></button>
        <div class="filter-sortierung">
          <select id="sort-spalte" aria-label="${escapeHtml(t("Sortieren nach"))}">
            ${sortOptionen()
              .map((s) => `<option value="${s.wert}" ${s.wert === sortSpalte ? "selected" : ""}>${escapeHtml(t(s.label))}</option>`)
              .join("")}
          </select>
          <button type="button" id="sort-richtung" title="${escapeHtml(t("Sortierrichtung umkehren"))}" aria-label="${escapeHtml(
            sortRichtung === "asc" ? t("Aufsteigend sortiert, umkehren für absteigend") : t("Absteigend sortiert, umkehren für aufsteigend")
          )}">${sortRichtung === "asc" ? "↑" : "↓"}</button>
        </div>
      </div>

      <div class="aktive-filter" id="aktive-filter" aria-label="${escapeHtml(t("Aktive Filter"))}" role="group" hidden></div>
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
    container.querySelector("#filter-btn").addEventListener("click", (e) => {
      filterOffen = !filterOffen;
      container.querySelector("#filter-panel").hidden = !filterOffen;
      e.currentTarget.setAttribute("aria-expanded", String(filterOffen));
    });
    container.querySelector("#aktive-filter").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      container.querySelector(`#${chip.dataset.filter}`).click();
      container.querySelector("#filter-btn").focus();
    });
    for (const [id, setze] of [
      ["#chip-offen", (v) => (nurOffen = v)],
      ["#chip-unvollstaendig", (v) => (unvollstaendig = v)],
      ["#chip-ohne-foto", (v) => (ohneFoto = v)],
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
      if (e.target.closest("#filter-zuruecksetzen")) {
        suchbegriff = "";
        nurOffen = false;
        unvollstaendig = false;
        ohneFoto = false;
        merke();
        zeichneListe();
        return;
      }
      const karte = e.target.closest(".hofladen-karte");
      if (karte) app.navigate(`#/hofladen/${karte.dataset.id}`);
    });
    if (app.offlineModus) {
      const hinweis = container.querySelector(".hinweis-leiste");
      if (hinweis) {
        hinweis.insertAdjacentHTML(
          "beforeend",
          ` <button class="aktualisieren" id="erneut-verbinden-btn">${escapeHtml(t("Erneut verbinden"))}</button>`
        );
        container.querySelector("#erneut-verbinden-btn").addEventListener("click", () => {
          app.versucheErneutZuVerbinden();
        });
      }
    }

    zeichneNaeheKarte();
    zeichneAktiveFilter();
  }

  async function sucheNaehe(ergebnisBox) {
    ergebnisBox.innerHTML = `<p class="ort">${escapeHtml(t("Standort wird ermittelt …"))}</p>`;
    const radiusMeter = (await ladeNaeheRadius().catch(() => null)) ?? STANDARD_RADIUS_METER;
    try {
      app._pruefeVerbindung();
      const { treffer } = await hoflaedenInNaeheDesGeraets(app.haClient, {
        radiusMeter,
        nurGeoeffnet: true,
      });
      if (!treffer.length) {
        ergebnisBox.innerHTML = `<p class="ort">${escapeHtml(t("Kein geöffneter Hofladen im Umkreis von {meter} m (Umkreis in den Einstellungen änderbar).", { meter: radiusMeter }))}</p>
          <button class="aktualisieren" id="naehe-suchen-btn">${escapeHtml(t("Erneut prüfen"))}</button>`;
      } else {
        ergebnisBox.innerHTML =
          treffer
            .map(
              (x) => `
            <div class="naehe-eintrag" data-id="${escapeHtml(x.id)}">
              <span>${escapeHtml(x.name)}</span>
              <span>${Math.round(x.entfernung_meter)} m</span>
            </div>`
            )
            .join("") +
          `<button class="aktualisieren" id="naehe-suchen-btn">${escapeHtml(t("Erneut prüfen"))}</button>`;
      }
    } catch (err) {
      ergebnisBox.innerHTML = `<p class="ort">${escapeHtml(err.message)}</p>
        <button class="aktualisieren" id="naehe-suchen-btn">${escapeHtml(t("Erneut versuchen"))}</button>`;
    }
  }

  function zeichneNaeheKarte() {
    const platzhalter = container.querySelector("#naehe-platzhalter");
    if (!platzhalter) return;
    platzhalter.innerHTML = `
      <details class="naehe-karte"${naeheOffen ? " open" : ""}>
        <summary>${icon("standort", { klein: true })} ${escapeHtml(t("Hofläden in der Nähe"))}</summary>
        <div id="naehe-ergebnis">
          <button class="aktualisieren" id="naehe-suchen-btn">${escapeHtml(t("Standort abfragen"))}</button>
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
