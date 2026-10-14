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
import { ladeKarteGeschlosseneAusblenden, speichereKarteGeschlosseneAusblenden } from "../storage.js";

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
    script.onerror = () => reject(new Error("Leaflet konnte nicht geladen werden."));
    document.head.appendChild(script);
  });

  return leafletLadenPromise;
}

const STATUS_TEXT = { true: "Geöffnet", false: "Geschlossen", null: "Status unbekannt" };

function statusText(geoeffnet) {
  return STATUS_TEXT[geoeffnet === true ? "true" : geoeffnet === false ? "false" : "null"];
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
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${h.latitude},${h.longitude}`)}`;
}

export async function renderKarte(container, app) {
  container.innerHTML = `
    <div class="karte-huelle">
      <div id="leaflet-karte"></div>
      <div class="karten-knoepfe">
        <label class="karten-filter">
          <input type="checkbox" id="filter-offen" />
          <span>Nur geöffnet</span>
        </label>
        <button type="button" class="karten-knopf" id="mein-standort-btn">Mein Standort</button>
      </div>
      <p class="karten-meldung" id="karten-meldung" role="status"></p>
      <section class="karten-sheet" id="karten-sheet" role="dialog" aria-label="Hofladen-Vorschau" hidden></section>
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
    zoomAnimation: !reduzierteBewegung,
    fadeAnimation: !reduzierteBewegung,
    markerZoomAnimation: !reduzierteBewegung,
  }).setView(mitte, hoflaeden.length ? 12 : 8);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap-Mitwirkende",
    maxZoom: 19,
  }).addTo(karte);

  const markerEbene = L.layerGroup().addTo(karte);

  const sheet = container.querySelector("#karten-sheet");
  const meldung = container.querySelector("#karten-meldung");

  function schliesseSheet() {
    sheet.hidden = true;
    sheet.replaceChildren();
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
    zu.setAttribute("aria-label", "Vorschau schliessen");
    zu.addEventListener("click", schliesseSheet);
    const titel = el("h2", h.name == null ? "" : String(h.name));
    const badge = el("span", statusText(h.geoeffnet), `status-badge ${h.geoeffnet === true ? "offen" : h.geoeffnet === false ? "geschlossen" : "unbekannt"}`);
    const ort = el("p", [h.adresse, h.ort].filter(Boolean).join(", "), "ort");
    const heute = heuteKurzinfo(h);
    const aktionen = el("div", null, "sheet-aktionen");
    const route = el("a", "Route", "chip-knopf");
    route.id = "sheet-route";
    route.href = routeUrl(h);
    route.target = "_blank";
    route.rel = "noopener noreferrer";
    const details = el("button", "Details", "chip-knopf");
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
    const nurOffene = !!filterBox?.checked;
    const sichtbar = hoflaeden.filter((h) => !nurOffene || h.geoeffnet === true);
    const marker = sichtbar.map((h) =>
      L.marker([h.latitude, h.longitude], {
        icon: erzeugeMarkerIcon(L, h.geoeffnet),
        title: `${h.name ?? ""} – ${statusText(h.geoeffnet)}`,
        alt: `${h.name ?? ""}, ${statusText(h.geoeffnet)}`,
      })
        .on("click", () => zeigeSheet(h))
        .addTo(markerEbene)
    );
    if (!sheet.hidden && nurOffene) schliesseSheet();
    if (anpassen && marker.length > 1) {
      karte.fitBounds(L.featureGroup(marker).getBounds().pad(0.2));
    }
  }

  zeichneMarker({ anpassen: true });
  filterBox?.addEventListener("change", () => {
    speichereKarteGeschlosseneAusblenden(filterBox.checked).catch(() => {});
    zeichneMarker({ anpassen: false });
  });

  // «Mein Standort»: nur nach Tipp, nur im Speicher, nie gespeichert.
  let standortMarker = null;
  const standortBtn = container.querySelector("#mein-standort-btn");
  standortBtn.addEventListener("click", async () => {
    standortBtn.disabled = true;
    meldung.textContent = "Standort wird ermittelt …";
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
