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

function markerFarbe(geoeffnet) {
  if (geoeffnet === true) return "#2e7d32";
  if (geoeffnet === false) return "#c62828";
  return "#9e9e9e";
}

function erzeugeMarkerIcon(L, geoeffnet) {
  const farbe = markerFarbe(geoeffnet);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${farbe}"/>
      <circle cx="15" cy="15" r="6" fill="white"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -38],
  });
}

/** Popup als DOM-Knoten mit textContent - Hofladennamen sind nie HTML. */
function popupInhalt(name) {
  const strong = document.createElement("strong");
  strong.textContent = name == null ? "" : String(name);
  return strong;
}

export async function renderKarte(container, app) {
  container.innerHTML = `
    <div class="karte-huelle">
      <div id="leaflet-karte"></div>
      <label class="karten-filter">
        <input type="checkbox" id="filter-geschlossen" />
        <span>Geschlossene ausblenden</span>
      </label>
    </div>`;
  const ausblenden = await ladeKarteGeschlosseneAusblenden().catch(() => false);
  const filterBox = container.querySelector("#filter-geschlossen");
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

  /** Zeichnet die Marker neu; geschlossene (geoeffnet === false) optional ausgeblendet.
   * Hofläden ohne bekannten Status bleiben sichtbar. */
  function zeichneMarker({ anpassen }) {
    markerEbene.clearLayers();
    const nurOffene = !!filterBox?.checked;
    const sichtbar = hoflaeden.filter((h) => !(nurOffene && h.geoeffnet === false));
    const marker = sichtbar.map((h) =>
      L.marker([h.latitude, h.longitude], { icon: erzeugeMarkerIcon(L, h.geoeffnet) })
        .bindPopup(popupInhalt(h.name))
        .on("click", () => app.navigate(`#/hofladen/${encodeURIComponent(h.id)}`))
        .addTo(markerEbene)
    );
    if (anpassen && marker.length > 1) {
      karte.fitBounds(L.featureGroup(marker).getBounds().pad(0.2));
    }
  }

  zeichneMarker({ anpassen: true });
  filterBox?.addEventListener("change", () => {
    speichereKarteGeschlosseneAusblenden(filterBox.checked).catch(() => {});
    zeichneMarker({ anpassen: false });
  });
}
