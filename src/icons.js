/**
 * Symbole der Oberfläche als Inline-SVG (ab 2.0.0): ersetzen die früheren
 * Emojis (📞 ✉️ 🔗 📍 📷 …), die je nach Gerät unterschiedlich aussehen
 * und sich nicht einfärben lassen. Die Symbole nutzen `currentColor`,
 * folgen also der Textfarbe und der Markenfarbe, und sind für
 * Screenreader ausgeblendet (`aria-hidden`): die Bedeutung steht immer im
 * Text oder im `aria-label` der Schaltfläche.
 *
 * Alle Pfade sind feste Texte aus diesem Modul (keine Benutzerdaten),
 * daher ist die Verwendung per `innerHTML` unbedenklich.
 */

const PFADE = {
  liste: `<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>`,
  karte: `<path d="M9 4 3 6.5v13L9 17l6 3 6-2.5v-13L15 7 9 4zM9 4v13M15 7v13"/>`,
  plus: `<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`,
  einstellungen: `<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>`,
  zurueck: `<path d="m15 5-7 7 7 7"/>`,
  weiter: `<path d="m9 5 7 7-7 7"/>`,
  suche: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
  standort: `<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>`,
  fadenkreuz: `<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`,
  route: `<path d="M4 11.5 20 4l-7.5 16-2-6.5L4 11.5z"/>`,
  telefon: `<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>`,
  weltkugel: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>`,
  kamera: `<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>`,
  bild: `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>`,
  haken: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>`,
  warnung: `<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4.5M12 17.5h.01"/>`,
  offline: `<path d="M3 3l18 18M8.5 8.5A8 8 0 0 0 4 11M20 11a8 8 0 0 0-5-3M12 17.5h.01M9 14.5a4.5 4.5 0 0 1 3-1.2"/>`,
  schliessen: `<path d="m6 6 12 12M18 6 6 18"/>`,
  uhr: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  korb: `<path d="M3 9h18l-2 11H5L3 9zM8 9l3-5M16 9l-3-5"/>`,
  hof: `<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>`,
  verknuepfung: `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>`,
  stift: `<path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/>`,
  mehr: `<path d="M12 5h.01M12 12h.01M12 19h.01"/>`,
  funkeln:`<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2"/>`,
};

/** Alle verfügbaren Symbolnamen (für Tests). */
export const ICON_NAMEN = Object.keys(PFADE);

/**
 * SVG-Text für ein Symbol. `klein` zeichnet es in Schriftgrösse (18 px),
 * sonst in 24 px. Unbekannte Namen liefern einen leeren Text statt eines Fehlers.
 */
export function icon(name, { klein = false } = {}) {
  const pfad = PFADE[name];
  if (!pfad) return "";
  return `<svg class="ic${klein ? " ic-klein" : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${pfad}</svg>`;
}

/**
 * Setzt Symbol und Beschriftung einer Schaltfläche neu (z. B. wenn ein
 * Vorgang läuft). Der Text wird als Textknoten eingesetzt, nie als HTML.
 */
export function setzeSchaltflaeche(button, name, text) {
  button.innerHTML = icon(name, { klein: true });
  const span = document.createElement("span");
  span.textContent = text;
  button.appendChild(span);
}
