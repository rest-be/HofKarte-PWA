/**
 * Mehrsprachigkeit (ab 2.0.0-dev.8): Deutsch, Französisch, Italienisch, Englisch.
 *
 * Der deutsche Text ist zugleich der Schlüssel: `t("Speichern")`. Deutsch
 * braucht damit kein Wörterbuch und fehlende Übersetzungen fallen auf
 * Deutsch zurück. Platzhalter: `t("{n} Treffer", { n: 3 })`.
 * Einzahl/Mehrzahl: `tn(n, "1 Hofladen", "{n} Hofläden")`.
 *
 * Die Sprache gilt pro Gerät (localStorage, nie auf dem Server). Ohne Wahl
 * richtet sie sich nach der Browsersprache, sonst Deutsch.
 */

import fr from "./i18n/fr.js";
import it from "./i18n/it.js";
import en from "./i18n/en.js";

export const SPRACHEN = [
  { code: "de", name: "Deutsch", locale: "de-CH" },
  { code: "fr", name: "Français", locale: "fr-CH" },
  { code: "it", name: "Italiano", locale: "it-CH" },
  { code: "en", name: "English", locale: "en-GB" },
];

const WOERTERBUECHER = { fr, it, en };
const SPEICHER_KEY = "hofkarte-sprache";

let aktuell = "de";

function gueltig(code) {
  return SPRACHEN.some((s) => s.code === code) ? code : null;
}

/** Sprache aus der Browserkonfiguration (erste passende, sonst Deutsch). */
export function browserSprache(sprachen = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || []) {
  for (const s of sprachen) {
    const code = gueltig(String(s || "").slice(0, 2).toLowerCase());
    if (code) return code;
  }
  return "de";
}

export function gespeicherteSprache() {
  try {
    return gueltig(localStorage.getItem(SPEICHER_KEY));
  } catch {
    return null;
  }
}

export function aktuelleSprache() {
  return aktuell;
}

export function aktuelleLocale() {
  return SPRACHEN.find((s) => s.code === aktuell).locale;
}

function setzeHtmlSprache() {
  if (typeof document !== "undefined") document.documentElement.lang = aktuelleLocale();
}

/** Beim Start: gespeicherte Wahl, sonst Browsersprache. */
export function initialisiereSprache() {
  aktuell = gespeicherteSprache() || browserSprache();
  setzeHtmlSprache();
  return aktuell;
}

/** Sprache wählen (`null` = automatisch nach Browser). Speichert nur auf diesem Gerät. */
export function setzeSprache(code) {
  const wahl = gueltig(code);
  try {
    if (wahl) localStorage.setItem(SPEICHER_KEY, wahl);
    else localStorage.removeItem(SPEICHER_KEY);
  } catch {
    /* Speicher nicht verfügbar: gilt nur für diese Sitzung */
  }
  aktuell = wahl || browserSprache();
  setzeHtmlSprache();
  return aktuell;
}

function einsetzen(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Übersetzt einen deutschen Text (Fallback: der deutsche Text selbst). */
export function t(deutsch, params) {
  const text = aktuell === "de" ? deutsch : WOERTERBUECHER[aktuell]?.[deutsch] ?? deutsch;
  return einsetzen(text, params);
}

/** Einzahl/Mehrzahl; `{n}` wird mit der Zahl ersetzt. */
export function tn(n, einzahl, mehrzahl) {
  return t(n === 1 ? einzahl : mehrzahl, { n });
}

/** Für Tests: alle Wörterbücher. */
export function woerterbuecher() {
  return WOERTERBUECHER;
}
