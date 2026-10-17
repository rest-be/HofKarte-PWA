/**
 * Kartenansicht via Leaflet + OpenStreetMap (siehe Vorgehensplan Phase
 * 4, Schritt 35), analog zu `hofkarte-panel.js`: farbige Marker je nach
 * Öffnungsstatus, Klick öffnet die Detailansicht.
 *
 * Leaflet liegt lokal unter vendor/ (Phase 10: kein CDN, offlinefähig) und wird nur
 * einmal eingebunden, auch wenn die Kartenansicht mehrfach aufgerufen
 * wird.
 */

import { escapeHtml } from "../html.js";
import { aktuellerStandort } from "../naehe.js";
import { heuteKurzinfo } from "../gruppen.js";
import { routenLink } from "../navigation.js";
import { suchHoflaeden } from "../suche.js";
import { icon } from "../icons.js";
import { ladeKarteGeschlosseneAusblenden, speichereKarteGeschlosseneAusblenden } from "../storage.js";
import { t, tn } from "../i18n.js";

let leafletLadenPromise = null;

function ladeLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLadenPromise) return leafletLadenPromise;

  leafletLadenPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "./vendor/leaflet/leaflet.css";
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = "./vendor/leaflet/leaflet.js";
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error(t("Leaflet konnte nicht geladen werden.")));
    document.head.appendChild(script);
  });

  return leafletLadenPromise;
}

const STATUS_TEXT = { true: "Geöffnet", false: "Geschlossen", null: "Status unbekannt" };

function statusText(geoeffnet) {
  return t(STATUS_TEXT[geoeffnet === true ? "true" : geoeffnet === false ? "false" : "null"]);
}

function markerFarbe(geoeffnet) {
  if (geoeffnet === true) return "#2e7d32";
  if (geoeffnet === false) return "#c62828";
  return "#757575";
}

/** Innenform je Status, damit der Status nie nur an der Farbe hängt:
 * offen = Kreis, geschlossen = Quadrat, unbekannt = Ring. */
function innenForm(geoeffnet) {
  if (geoeffnet === true) return `<circle cx="15" cy="15" r="6" fill="white"/>`;
  if (geoeffnet === false) return `<rect x="9" y="9" width="12" height="12" fill="white"/>`;
  return `<circle cx="15" cy="15" r="5" fill="none" stroke="white" stroke-width="2.5"/>`;
}

export function erzeugeMarkerIcon(L, geoeffnet) {
  const farbe = markerFarbe(geoeffnet);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${farbe}"/>
      ${innenForm(geoeffnet)}
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [30, 42],
    iconAnchor: [15, 42],
  });
}

function routeUrl(h) {
  return routenLink(h);
}

export async function renderKarte(container, app) {
  container.innerHTML = `
    <div class="karte-huelle">
      <div id="leaflet-karte"></div>
      <div class="karten-suche">
        <div class="karten-suchfeld">
          ${icon("suche", { klein: true })}
          <input type="search" id="karten-suche" role="combobox" aria-expanded="false" aria-controls="karten-treffer" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="${escapeHtml(t("Suchen …"))}" aria-label="${escapeHtml(t("Hofläden suchen"))}" />
          <button type="button" class="suche-loeschen" id="karten-suche-loeschen" aria-label="${escapeHtml(t("Suche löschen"))}" hidden>${icon("schliessen", { klein: true })}</button>
        </div>
        <ul class="karten-treffer" id="karten-treffer" role="listbox" aria-label="${escapeHtml(t("Suchtreffer"))}" hidden></ul>
        <p class="nur-leser" id="karten-suche-status" role="status" aria-live="polite"></p>
      </div>
      <div class="karten-knoepfe">
        <button type="button" class="karten-suchchip" id="karten-suchchip" hidden></button>
        <label class="karten-filter">
          <input type="checkbox" id="filter-offen" />
          <span>${escapeHtml(t("Nur geöffnet"))}</span>
        </label>
        <button type="button" class="karten-knopf" id="mein-standort-btn">${escapeHtml(t("Mein Standort"))}</button>
      </div>
      <p class="karten-meldung" id="karten-meldung" role="status"></p>
      <section class="karten-sheet" id="karten-sheet" role="dialog" aria-label="${escapeHtml(t("Hofladen-Vorschau"))}" hidden></section>
    </div>`;
  const ausblenden = await ladeKarteGeschlosseneAusblenden().catch(() => false);
  const filterBox = container.querySelector("#filter-offen");
  if (filterBox) filterBox.checked = ausblenden;

  let L;
  try {
    L = await ladeLeaflet();
  } catch (err) {
    container.innerHTML = `<p class="hinweis-leiste fehler">${escapeHtml(err.message)}</p>`;
    return;
  }

  // Falls der Benutzer während des Ladens bereits weiternavigiert hat.
  if (!container.isConnected || !document.getElementById("leaflet-karte")) return;

  const hoflaeden = app.state.hoflaeden.filter(
    (h) => h.latitude != null && h.longitude != null
  );

  const mitte = hoflaeden.length
    ? [hoflaeden[0].latitude, hoflaeden[0].longitude]
    : [46.8182, 8.2275]; // Schweiz-Mittelpunkt als Fallback ohne Daten

  // Phase 8c (Accessibility): Leaflets eigene Zoom-/Fade-Animationen
  // respektieren `prefers-reduced-motion` nicht von sich aus - hier
  // explizit abschalten, wenn der Nutzer reduzierte Bewegung bevorzugt.
  const reduzierteBewegung =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const karte = L.map("leaflet-karte", {
    zoomControl: false, // sitzt unten rechts, oben liegt die Suche
    zoomAnimation: !reduzierteBewegung,
    fadeAnimation: !reduzierteBewegung,
    markerZoomAnimation: !reduzierteBewegung,
  }).setView(mitte, hoflaeden.length ? 12 : 8);

  L.control.zoom({ position: "bottomright" }).addTo(karte);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: `&copy; ${escapeHtml(t("OpenStreetMap-Mitwirkende"))}`,
    maxZoom: 19,
  }).addTo(karte);

  const markerEbene = L.layerGroup().addTo(karte);
  /** Marker je Hofladen-ID, damit die Suche einen Marker hervorheben kann. */
  const markerNachId = new Map();
  /** IDs der Suchtreffer, auf die die Karte begrenzt ist («Alle Treffer zeigen»); null = alle. */
  let trefferIds = null;
  let aktiverMarker = null;

  const sheet = container.querySelector("#karten-sheet");
  const meldung = container.querySelector("#karten-meldung");

  function hebeHervor(marker) {
    aktiverMarker?.getElement()?.classList.remove("marker-aktiv");
    aktiverMarker = marker || null;
    aktiverMarker?.getElement()?.classList.add("marker-aktiv");
  }

  function schliesseSheet() {
    sheet.hidden = true;
    sheet.replaceChildren();
    hebeHervor(null);
  }

  /** Vorschau als DOM-Knoten (textContent): Hofladendaten sind nie HTML. */
  function zeigeSheet(h) {
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text != null) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    sheet.replaceChildren();
    const zu = el("button", "×", "sheet-zu");
    zu.type = "button";
    zu.setAttribute("aria-label", t("Vorschau schliessen"));
    zu.addEventListener("click", schliesseSheet);
    const titel = el("h2", h.name == null ? "" : String(h.name));
    const badge = el("span", statusText(h.geoeffnet), `status-badge ${h.geoeffnet === true ? "offen" : h.geoeffnet === false ? "geschlossen" : "unbekannt"}`);
    const ort = el("p", [h.adresse, h.ort].filter(Boolean).join(", "), "ort");
    const heute = heuteKurzinfo(h);
    const aktionen = el("div", null, "sheet-aktionen");
    const route = el("a", t("Route"), "chip-knopf");
    route.id = "sheet-route";
    route.href = routeUrl(h);
    route.target = "_blank";
    route.rel = "noopener noreferrer";
    const details = el("button", t("Details"), "chip-knopf");
    details.type = "button";
    details.id = "sheet-details";
    details.addEventListener("click", () => app.navigate(`#/hofladen/${encodeURIComponent(h.id)}`));
    aktionen.append(route, details);
    sheet.append(zu, titel, badge, ort);
    if (heute) sheet.append(el("p", heute));
    sheet.append(aktionen);
    sheet.hidden = false;
    details.focus({ preventScroll: true });
  }

  document.addEventListener("keydown", function esc(e) {
    if (!container.isConnected) return document.removeEventListener("keydown", esc);
    if (e.key === "Escape" && !sheet.hidden) schliesseSheet();
  });
  karte.on("click", schliesseSheet);

  /** Zeichnet die Marker neu; mit Filter nur geöffnete (geoeffnet === true). */
  function zeichneMarker({ anpassen }) {
    markerEbene.clearLayers();
    markerNachId.clear();
    aktiverMarker = null;
    const nurOffene = !!filterBox?.checked;
    const sichtbar = hoflaeden.filter((h) => (!nurOffene || h.geoeffnet === true) && (!trefferIds || trefferIds.has(h.id)));
    const marker = sichtbar.map((h) => {
      const m = L.marker([h.latitude, h.longitude], {
        icon: erzeugeMarkerIcon(L, h.geoeffnet),
        title: `${h.name ?? ""} – ${statusText(h.geoeffnet)}`,
        alt: `${h.name ?? ""}, ${statusText(h.geoeffnet)}`,
      })
        .on("click", () => {
          zeigeSheet(h);
          hebeHervor(m);
        })
        .addTo(markerEbene);
      markerNachId.set(h.id, m);
      return m;
    });
    if (!sheet.hidden && nurOffene) schliesseSheet();
    if (anpassen && marker.length > 1) {
      karte.fitBounds(L.featureGroup(marker).getBounds().pad(0.2));
    } else if (anpassen && marker.length === 1) {
      karte.setView(marker[0].getLatLng(), Math.max(karte.getZoom(), 15), { animate: !reduzierteBewegung });
    }
  }

  zeichneMarker({ anpassen: true });
  filterBox?.addEventListener("change", () => {
    speichereKarteGeschlosseneAusblenden(filterBox.checked).catch(() => {});
    zeichneMarker({ anpassen: false });
  });


  // --- Suche (2.0.0-dev.14): Hinspringen und «Alle Treffer zeigen» -------------------
  const suchFeld = container.querySelector("#karten-suche");
  const suchListe = container.querySelector("#karten-treffer");
  const suchLoeschen = container.querySelector("#karten-suche-loeschen");
  const suchStatus = container.querySelector("#karten-suche-status");
  const suchChip = container.querySelector("#karten-suchchip");
  const MAX_TREFFER = 5;
  let aktuelleTreffer = [];
  let aktivIndex = -1;

  const optionen = () => [...suchListe.querySelectorAll('[role="option"]')];

  function setzeAktiv(index) {
    const ops = optionen();
    aktivIndex = ops.length ? (index + ops.length) % ops.length : -1;
    ops.forEach((o, i) => o.setAttribute("aria-selected", String(i === aktivIndex)));
    if (aktivIndex >= 0) suchFeld.setAttribute("aria-activedescendant", ops[aktivIndex].id);
    else suchFeld.removeAttribute("aria-activedescendant");
  }

  function schliesseListe() {
    suchListe.hidden = true;
    suchFeld.setAttribute("aria-expanded", "false");
    setzeAktiv(-1);
  }

  function zeichneTreffer() {
    const begriff = suchFeld.value;
    suchLoeschen.hidden = !begriff;
    aktuelleTreffer = suchHoflaeden(app.state.hoflaeden, begriff);
    if (!begriff.trim()) {
      suchListe.replaceChildren();
      suchStatus.textContent = "";
      schliesseListe();
      return;
    }
    suchListe.replaceChildren();
    const el = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text != null) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    if (!aktuelleTreffer.length) {
      const leer = el("li", t("Keine Treffer"), "treffer-leer");
      suchListe.append(leer);
      suchStatus.textContent = t("Keine Treffer");
    } else {
      aktuelleTreffer.slice(0, MAX_TREFFER).forEach((h, i) => {
        const li = el("li", null, "treffer-zeile");
        li.id = `karten-treffer-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", "false");
        li.dataset.id = h.id;
        const text = el("span", null, "treffer-text");
        text.append(el("span", h.name == null ? "" : String(h.name), "treffer-name"));
        const hatPosition = h.latitude != null && h.longitude != null;
        text.append(el("span", hatPosition ? h.ort || "" : t("Keine Position"), "treffer-ort"));
        const badge = el("span", statusText(h.geoeffnet), `status-badge ${h.geoeffnet === true ? "offen" : h.geoeffnet === false ? "geschlossen" : "unbekannt"}`);
        li.append(text, badge);
        suchListe.append(li);
      });
      const alle = el("li", t("Alle Treffer zeigen ({n})", { n: aktuelleTreffer.length }), "treffer-alle");
      alle.id = "karten-treffer-alle";
      alle.setAttribute("role", "option");
      alle.setAttribute("aria-selected", "false");
      suchListe.append(alle);
      suchStatus.textContent = tn(aktuelleTreffer.length, "1 Treffer", "{n} Treffer");
    }
    suchListe.hidden = false;
    suchFeld.setAttribute("aria-expanded", "true");
    setzeAktiv(-1);
  }

  /** Springt zum Hofladen und öffnet die Vorschau; ohne Position geht es ins Detail. */
  function springeZu(h) {
    schliesseListe();
    suchFeld.blur();
    if (h.latitude == null || h.longitude == null) {
      app.navigate(`#/hofladen/${encodeURIComponent(h.id)}`);
      return;
    }
    if (!markerNachId.has(h.id)) {
      // Der Hofladen ist durch «Nur geöffnet» oder eine frühere Trefferauswahl ausgeblendet.
      trefferIds = null;
      suchChip.hidden = true;
      if (filterBox?.checked) {
        filterBox.checked = false;
        speichereKarteGeschlosseneAusblenden(false).catch(() => {});
        meldung.textContent = t("Filter «Nur geöffnet» aufgehoben, damit der Hofladen sichtbar ist.");
      }
      zeichneMarker({ anpassen: false });
    }
    karte.setView([h.latitude, h.longitude], Math.max(karte.getZoom(), 15), { animate: !reduzierteBewegung });
    const marker = markerNachId.get(h.id);
    zeigeSheet(h);
    hebeHervor(marker);
  }

  function zeigeAlleTreffer() {
    const mitPosition = aktuelleTreffer.filter((h) => h.latitude != null && h.longitude != null);
    const ohne = aktuelleTreffer.length - mitPosition.length;
    trefferIds = new Set(mitPosition.map((h) => h.id));
    schliesseListe();
    suchFeld.blur();
    schliesseSheet();
    meldung.textContent = ohne ? t("{n} Treffer ohne Position werden nicht auf der Karte gezeigt.", { n: ohne }) : "";
    suchChip.textContent = `${t("Suche: «{begriff}»", { begriff: suchFeld.value.trim() })} ×`;
    suchChip.setAttribute("aria-label", t("Suche zurücksetzen: {begriff}", { begriff: suchFeld.value.trim() }));
    suchChip.hidden = false;
    zeichneMarker({ anpassen: true });
  }

  function loescheSuche({ fokus = false } = {}) {
    suchFeld.value = "";
    trefferIds = null;
    suchChip.hidden = true;
    meldung.textContent = "";
    zeichneTreffer();
    zeichneMarker({ anpassen: true });
    if (fokus) suchFeld.focus();
  }

  suchFeld.addEventListener("input", zeichneTreffer);
  suchFeld.addEventListener("focus", () => {
    if (suchFeld.value.trim()) zeichneTreffer();
  });
  suchFeld.addEventListener("keydown", (e) => {
    const offen = !suchListe.hidden;
    if (e.key === "ArrowDown" && offen) {
      e.preventDefault();
      setzeAktiv(aktivIndex + 1);
    } else if (e.key === "ArrowUp" && offen) {
      e.preventDefault();
      setzeAktiv(aktivIndex - 1);
    } else if (e.key === "Enter" && offen) {
      e.preventDefault();
      const ops = optionen();
      const op = ops[aktivIndex >= 0 ? aktivIndex : 0];
      if (!op) return;
      if (op.id === "karten-treffer-alle") zeigeAlleTreffer();
      else springeZu(aktuelleTreffer.find((h) => h.id === op.dataset.id));
    } else if (e.key === "Escape" && offen) {
      e.stopPropagation();
      schliesseListe();
    }
  });
  suchListe.addEventListener("pointerdown", (e) => e.preventDefault()); // Fokus bleibt im Feld
  suchListe.addEventListener("click", (e) => {
    const zeile = e.target.closest("[role='option']");
    if (!zeile) return;
    if (zeile.id === "karten-treffer-alle") zeigeAlleTreffer();
    else springeZu(aktuelleTreffer.find((h) => h.id === zeile.dataset.id));
  });
  suchLoeschen.addEventListener("click", () => loescheSuche({ fokus: true }));
  suchChip.addEventListener("click", () => loescheSuche());
  karte.on("click", schliesseListe);

  // «Mein Standort»: nur nach Tipp, nur im Speicher, nie gespeichert.
  let standortMarker = null;
  const standortBtn = container.querySelector("#mein-standort-btn");
  standortBtn.addEventListener("click", async () => {
    standortBtn.disabled = true;
    meldung.textContent = t("Standort wird ermittelt …");
    try {
      const { latitude, longitude } = await aktuellerStandort();
      if (!container.isConnected) return;
      if (standortMarker) standortMarker.remove();
      standortMarker = L.circleMarker([latitude, longitude], { radius: 9, weight: 3, color: "#ffffff", fillColor: "#0a66d6", fillOpacity: 1 }).addTo(karte);
      karte.setView([latitude, longitude], Math.max(karte.getZoom(), 14), { animate: !reduzierteBewegung });
      meldung.textContent = "";
    } catch (err) {
      meldung.textContent = err.message;
    } finally {
      standortBtn.disabled = false;
    }
  });
}
