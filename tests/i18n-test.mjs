/**
 * Prüft die Mehrsprachigkeit ohne Browser (siehe src/i18n.js):
 * - jeder Text in `t("…")`/`tn(n, "…", "…")` hat eine Übersetzung in FR, IT und EN,
 * - Platzhalter ({n}, {name} …) stimmen mit dem deutschen Text überein,
 * - Nachschlagetabellen (Statustexte, Wochentage, Gruppentitel …) sind übersetzt,
 * - Mehrzahl, Platzhalter und Rückfall auf Deutsch funktionieren.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(WURZEL, "src");

let bestanden = 0;
const fehler = [];
function check(label, ok) {
  if (ok) bestanden++;
  else fehler.push(label);
}

async function dateien(dir) {
  const ergebnis = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "i18n" || e.name === "vendor") continue;
      ergebnis.push(...(await dateien(p)));
    } else if (e.name.endsWith(".js") && e.name !== "version.js" && e.name !== "i18n.js") ergebnis.push(p);
  }
  return ergebnis;
}

const LIT = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const platzhalter = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

export async function fuehreI18nTestsAus() {
  const i18n = await import(path.join(SRC, "i18n.js"));
  const buecher = i18n.woerterbuecher();

  // 1. Alle Literale in t()/tn() einsammeln.
  const schluessel = new Map();
  const merke = (roh, datei) => {
    try {
      schluessel.set(JSON.parse(`"${roh}"`), datei);
    } catch {
      fehler.push(`Nicht lesbares Literal in ${datei}: ${roh.slice(0, 40)}`);
    }
  };
  for (const datei of await dateien(SRC)) {
    const text = await readFile(datei, "utf8");
    const kurz = path.relative(WURZEL, datei);
    for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.])t\(\s*${LIT}`, "g"))) merke(m[1], kurz);
    for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.])tn\([^,()]+,\s*${LIT}\s*,\s*${LIT}`, "g"))) {
      merke(m[1], kurz);
      merke(m[2], kurz);
    }
  }
  check(`Es wurden t()-Texte gefunden (${schluessel.size})`, schluessel.size > 300);

  // Texte, die über Nachschlagetabellen laufen (kein Literal in t(…)).
  const tabellen = [
    "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag",
    "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So",
    "Name", "Adresse", "Status", "Bewertung", "Entfernung",
    "Fehlt noch", "Wird ergänzt", "Weicht ab", "Schon gleich",
    "Geöffnet", "Geschlossen", "Status unbekannt",
    "✔ hohe Sicherheit", "• mittlere Sicherheit", "○ niedrige Sicherheit",
    "Sehr wahrscheinlich", "Möglich", "Unsicher",
    "Grunddaten", "Adresse & Standort", "Kontakt & Webseite", "Öffnungszeiten", "Angebote & Zahlungsarten", "Bilder", "Herkunft der Angaben",
    "Grün", "Blau", "Karotte", "Violett", "Graphit",
  ];
  for (const k of tabellen) schluessel.set(k, "Nachschlagetabelle");

  const fehlend = { fr: [], it: [], en: [] };
  for (const [k, datei] of schluessel) {
    for (const sprache of ["fr", "it", "en"]) {
      const uebersetzt = buecher[sprache][k];
      if (typeof uebersetzt !== "string" || uebersetzt === "") fehlend[sprache].push(`${k} (${datei})`);
      else if (platzhalter(uebersetzt) !== platzhalter(k)) fehler.push(`Platzhalter ${sprache}: «${k.slice(0, 50)}»`);
    }
  }
  for (const sprache of ["fr", "it", "en"]) {
    check(`Wörterbuch ${sprache}: alle ${schluessel.size} Texte übersetzt (fehlend: ${fehlend[sprache].slice(0, 99).join(" | ")}${fehlend[sprache].length > 5 ? ` … +${fehlend[sprache].length - 5}` : ""})`, fehlend[sprache].length === 0);
  }

  // 2. Platzhalter in allen Wörterbüchern identisch zum Schlüssel (auch unbenutzte Einträge).
  let platzhalterFalsch = 0;
  for (const sprache of ["fr", "it", "en"]) {
    for (const [k, v] of Object.entries(buecher[sprache])) if (platzhalter(k) !== platzhalter(v)) platzhalterFalsch++;
  }
  check(`Platzhalter in allen Einträgen gleich (${platzhalterFalsch} abweichend)`, platzhalterFalsch === 0);

  // 3. Funktionsprüfung.
  i18n.setzeSprache("de");
  check("de: t() gibt den deutschen Text zurück", i18n.t("Speichern") === "Speichern");
  check("de: Platzhalter", i18n.t("{n} Hofläden", { n: 3 }) === "3 Hofläden");
  check("de: tn Einzahl/Mehrzahl", i18n.tn(1, "1 Hofladen", "{n} Hofläden") === "1 Hofladen" && i18n.tn(2, "1 Hofladen", "{n} Hofläden") === "2 Hofläden");
  i18n.setzeSprache("fr");
  check("fr: Übersetzung und Platzhalter", i18n.t("Speichern") === "Enregistrer" && i18n.tn(2, "1 Hofladen", "{n} Hofläden") === "2 fermes" && i18n.tn(1, "1 Hofladen", "{n} Hofläden") === "1 ferme");
  check("fr: unbekannter Text fällt auf Deutsch zurück", i18n.t("Völlig unbekannter Text") === "Völlig unbekannter Text");
  i18n.setzeSprache("it");
  check("it: Begriff «negozio agricolo»", /negozio agricolo/.test(i18n.tn(1, "1 Hofladen", "{n} Hofläden")));
  i18n.setzeSprache("en");
  check("en: Begriff «farm shop»", i18n.tn(2, "1 Hofladen", "{n} Hofläden") === "2 farm shops");
  check("Locale je Sprache", ["de-CH", "fr-CH", "it-CH", "en-GB"].every((l, i) => (i18n.setzeSprache(["de", "fr", "it", "en"][i]), i18n.aktuelleLocale() === l)));
  check("Browsersprache: fr-CH → fr, ru → de", i18n.browserSprache(["fr-CH"]) === "fr" && i18n.browserSprache(["ru-RU", "it-IT"]) === "it" && i18n.browserSprache(["ru-RU"]) === "de");

  // 4. Nachschlagetabellen aus finden.js sind übersetzt (und deutsch in «de»).
  const finden = await import(path.join(SRC, "finden.js"));
  i18n.setzeSprache("de");
  const deutsch = finden.FINDEN_FEHLERMELDUNGEN.unreachable;
  const deutschTabellen = [
    ...Object.values(finden.FINDEN_WEBSITE_STATUS), ...Object.values(finden.FINDEN_KI_STATUS), ...Object.values(finden.FINDEN_QUELLEN_LABEL),
    ...finden.FINDEN_ZEILEN.map((z) => z.label), ...finden.FINDEN_VERMUTUNGEN.map((z) => z.label),
  ];
  check("finden.js: deutsche Tabellen unverändert", /Overpass/.test(deutsch) && finden.FINDEN_QUELLEN_LABEL.openstreetmap === "OpenStreetMap");
  for (const sprache of ["fr", "it", "en"]) {
    i18n.setzeSprache(sprache);
    check(`finden.js: Fehlermeldung in ${sprache} übersetzt`, finden.FINDEN_FEHLERMELDUNGEN.unreachable !== deutsch);
    const dieseTabellen = [
      ...Object.values(finden.FINDEN_WEBSITE_STATUS), ...Object.values(finden.FINDEN_KI_STATUS), ...Object.values(finden.FINDEN_QUELLEN_LABEL),
      ...finden.FINDEN_ZEILEN.map((z) => z.label), ...finden.FINDEN_VERMUTUNGEN.map((z) => z.label),
    ];
    check(`finden.js: Tabellenwerte in ${sprache} (${dieseTabellen.length}) vorhanden`, dieseTabellen.length === deutschTabellen.length && dieseTabellen.every((v) => typeof v === "string" && v));
    check(`finden.js: Zeilen-Labels in ${sprache} übersetzt`, finden.FINDEN_ZEILEN.find((z) => z.key === "oeffnungszeiten").label !== "Öffnungszeiten");
  }
  i18n.setzeSprache("de");

  console.log(`i18n: ${bestanden} bestanden, ${fehler.length} fehlgeschlagen`);
  if (fehler.length) console.log("Fehlgeschlagen:", fehler);
  return fehler.length === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit((await fuehreI18nTestsAus()) ? 0 : 1);
}
