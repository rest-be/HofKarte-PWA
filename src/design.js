/**
 * Markenfarbe (ab 2.0.0): Die App ist standardmässig grün; in den
 * Einstellungen kann pro Gerät eine andere Farbe gewählt werden
 * (Voreinstellungen oder freie Farbe).
 *
 * Aus der gewählten Farbe werden die Akzent-Variablen der Oberfläche
 * berechnet, so dass Text immer lesbar bleibt:
 * - `--accent`        Füllfarbe für Schaltflächen und Auswahl
 * - `--accent-ink`    Schriftfarbe auf der Füllfarbe (weiss oder fast schwarz)
 * - `--tint`          Farbe für Links und Textschaltflächen auf der Fläche
 * - `--tint-pressed`  gedrückter Zustand von `--tint`
 * - `--accent-soft`   dezente Hintergrundfarbe (Auswahl, Hinweise)
 *
 * Kontrast-Regeln (WCAG): Text auf Fläche und Schrift auf Füllfarbe
 * mindestens 4,5:1, Füllfarbe gegen die Fläche mindestens 3:1.
 *
 * Die Werte werden per CSSOM auf `<html>` gesetzt (nicht als Inline-Style im
 * Markup), das ist mit der CSP `style-src 'self'` vereinbar. Für die
 * Standardfarbe werden keine Werte gesetzt: dann gelten die Vorgaben aus
 * styles.css (auch ohne JavaScript).
 *
 * Gespeichert wird in IndexedDB (storage.js); zusätzlich wird die Farbe in
 * localStorage gespiegelt, damit sie beim Start ohne Aufblitzen sofort
 * gesetzt werden kann.
 */

import { ladeMarkenfarbe, speichereMarkenfarbe } from "./storage.js";

export const STANDARD_FARBE = "#2e7d4f";

/** Voreinstellungen in der Reihenfolge der Auswahl. */
export const FARBEN = [
  { id: "gruen", name: "Grün", farbe: "#2e7d4f" },
  { id: "blau", name: "Blau", farbe: "#1f65c0" },
  { id: "karotte", name: "Karotte", farbe: "#e8750f" },
  { id: "violett", name: "Violett", farbe: "#6b4fbb" },
  { id: "graphit", name: "Graphit", farbe: "#3a4540" },
];

/** Flächen, auf denen Text steht (Karten): muss zu styles.css passen. */
const FLAECHE_HELL = "#ffffff";
const FLAECHE_DUNKEL = "#181f1b";
const TEXT_DUNKEL = "#0b0f0c";

const EIGENSCHAFTEN = ["--accent", "--accent-ink", "--accent-soft", "--tint", "--tint-pressed"];
const SPIEGEL_KEY = "hofkarte-markenfarbe";

// --- Farbrechnen ----------------------------------------------------------

/** "#rgb" oder "#rrggbb" (beliebige Schreibweise) -> "#rrggbb" in Kleinbuchstaben, sonst `null`. */
export function normalisiereHex(wert) {
  if (typeof wert !== "string") return null;
  let text = wert.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(text)) {
    text = "#" + text[1] + text[1] + text[2] + text[2] + text[3] + text[3];
  }
  return /^#[0-9a-f]{6}$/.test(text) ? text : null;
}

function hexZuRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function rgbZuHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** Relative Leuchtdichte nach WCAG. */
export function leuchtdichte(hex) {
  const [r, g, b] = hexZuRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis zweier Farben (1 bis 21). */
export function kontrast(a, b) {
  const la = leuchtdichte(a);
  const lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mischt `a` mit `b`; `anteilB` von 0 (nur a) bis 1 (nur b). */
function mische(a, b, anteilB) {
  const ra = hexZuRgb(a);
  const rb = hexZuRgb(b);
  return rgbZuHex(ra.map((v, i) => v + (rb[i] - v) * anteilB));
}

/** Macht `hex` schrittweise dunkler (`richtung` -1) bzw. heller (+1), bis `test(farbe)` gilt. */
function verschiebe(hex, richtung, test) {
  const ziel = richtung < 0 ? "#000000" : "#ffffff";
  let farbe = hex;
  for (let anteil = 0.02; anteil <= 1.0001 && !test(farbe); anteil += 0.02) {
    farbe = mische(hex, ziel, anteil);
  }
  return farbe;
}

/**
 * Berechnet alle Akzentwerte für eine Basisfarbe im hellen oder dunklen Modus.
 * Garantiert: Schrift auf `fuell` >= 4,5:1, `tint` auf der Fläche >= 4,5:1,
 * `fuell` gegen die Fläche >= 3:1.
 */
export function akzentFarben(hex, dunkel = false) {
  const basis = normalisiereHex(hex) || STANDARD_FARBE;
  const flaeche = dunkel ? FLAECHE_DUNKEL : FLAECHE_HELL;
  const richtung = dunkel ? 1 : -1; // auf heller Fläche abdunkeln, auf dunkler aufhellen

  // Füllfarbe: als Bedienelement gegen die Fläche gut erkennbar (3:1).
  let fuell = verschiebe(basis, richtung, (f) => kontrast(f, flaeche) >= 3);

  // Schrift auf der Füllfarbe: weiss oder fast schwarz, je nachdem was besser lesbar ist.
  let ink = kontrast(fuell, "#ffffff") >= kontrast(fuell, TEXT_DUNKEL) ? "#ffffff" : TEXT_DUNKEL;
  if (kontrast(fuell, ink) < 4.5) {
    // Mittlere Farbtöne: Füllfarbe so weit verschieben, bis die Schrift lesbar ist.
    const mitWeiss = dunkel ? false : true;
    ink = mitWeiss ? "#ffffff" : TEXT_DUNKEL;
    fuell = verschiebe(fuell, mitWeiss ? -1 : 1, (f) => kontrast(f, ink) >= 4.5);
  }

  const tint = verschiebe(basis, richtung, (f) => kontrast(f, flaeche) >= 4.5);
  const tintPressed = mische(tint, dunkel ? "#ffffff" : "#000000", 0.18);
  const soft = mische(basis, flaeche, dunkel ? 0.78 : 0.88);
  return { fuell, ink, tint, tintPressed, soft };
}

// --- Anwenden und Speichern -----------------------------------------------

function istDunkel() {
  return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Setzt die Akzentwerte auf `<html>`; `null` oder die Standardfarbe entfernt sie (Vorgaben aus styles.css). */
export function wendeMarkenfarbeAn(hex, { dunkel = istDunkel(), ziel = document.documentElement } = {}) {
  const farbe = normalisiereHex(hex);
  const stil = ziel.style;
  if (!farbe || farbe === STANDARD_FARBE) {
    EIGENSCHAFTEN.forEach((name) => stil.removeProperty(name));
    return;
  }
  const f = akzentFarben(farbe, dunkel);
  stil.setProperty("--accent", f.fuell);
  stil.setProperty("--accent-ink", f.ink);
  stil.setProperty("--accent-soft", f.soft);
  stil.setProperty("--tint", f.tint);
  stil.setProperty("--tint-pressed", f.tintPressed);
}

let aktuelleFarbe = null;

/** Aktuell gewählte Markenfarbe (`null` = Standard). */
export function aktuelleMarkenfarbe() {
  return aktuelleFarbe;
}

function spiegeln(hex) {
  try {
    if (hex) localStorage.setItem(SPIEGEL_KEY, hex);
    else localStorage.removeItem(SPIEGEL_KEY);
  } catch {
    // Privater Modus o. Ä.: die Spiegelung ist nur eine Hilfe gegen Aufblitzen.
  }
}

/**
 * Wählt die Markenfarbe (`null` = Standard zurücksetzen). Mit `speichern: false`
 * wird sie nur angezeigt (Vorschau beim Ziehen im Farbwähler).
 */
export async function setzeMarkenfarbe(hex, { speichern = true } = {}) {
  const farbe = normalisiereHex(hex);
  const wert = farbe && farbe !== STANDARD_FARBE ? farbe : null;
  aktuelleFarbe = wert;
  wendeMarkenfarbeAn(wert);
  if (speichern) {
    spiegeln(wert);
    await speichereMarkenfarbe(wert);
  }
  return wert;
}

/**
 * Beim Start aufrufen: setzt die gespiegelte Farbe sofort (kein Aufblitzen),
 * gleicht danach mit IndexedDB ab und folgt dem Wechsel Hell/Dunkel.
 */
export function initialisiereDesign() {
  let gespiegelt = null;
  try {
    gespiegelt = normalisiereHex(localStorage.getItem(SPIEGEL_KEY));
  } catch {
    gespiegelt = null;
  }
  aktuelleFarbe = gespiegelt;
  wendeMarkenfarbeAn(aktuelleFarbe);

  const modus = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  if (modus && modus.addEventListener) {
    modus.addEventListener("change", () => wendeMarkenfarbeAn(aktuelleFarbe));
  }

  return ladeMarkenfarbe()
    .then((gespeichert) => {
      const wert = normalisiereHex(gespeichert);
      if (wert !== aktuelleFarbe) {
        aktuelleFarbe = wert;
        wendeMarkenfarbeAn(wert);
        spiegeln(wert);
      }
    })
    .catch(() => {});
}
