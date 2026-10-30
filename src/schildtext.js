/**
 * Schildtext – macht aus dem erkannten Text eines Hofladen-Schildes einen
 * Vorschlag für «Angaben ergänzen» (2.1.0). Reine Logik ohne DOM.
 *
 * Das Ergebnis hat dieselbe Form wie die Antwort der Webseiten-Auswertung
 * (`{daten, quellen, abweichungen, vermutungen}`), damit der Vergleich in
 * `ergaenzen.js` unverändert genutzt werden kann. Die Herkunft heisst
 * «schild» (angezeigt als «Schild (Foto)»).
 *
 * Es wird nur übernommen, was formal passt (Telefonnummer, E-Mail, Adresse
 * mit Postleitzahl, Wochentage mit Uhrzeiten, bekannte Angebote). Nichts wird
 * geraten; alles bleibt ein Vorschlag, den die Person im Vergleich wählt.
 */

import { parseZeittext } from "./zeittext.js";
import { sichereHttpUrl } from "./html.js";

export const QUELLE_SCHILD = "schild";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Bekannte Angebote (Schlüssel = deutscher Name wie im Editor) mit Wörtern in DE/FR/IT/EN. */
const ANGEBOTE = {
  Eier: ["eier", "oeufs", "uova", "eggs"],
  "Gemüse": ["gemuese", "legumes", "verdura", "ortaggi", "vegetables"],
  Obst: ["obst", "fruits", "fruit", "frutta"],
  Kartoffeln: ["kartoffeln", "pommes de terre", "patate", "potatoes"],
  Milch: ["milch", "lait", "latte", "milk"],
  "Käse": ["kaese", "fromage", "fromages", "formaggio", "formaggi", "cheese"],
  Fleisch: ["fleisch", "viande", "carne", "meat"],
  Honig: ["honig", "miel", "miele", "honey"],
  Brot: ["brot", "pain", "pane", "bread"],
  Blumen: ["blumen", "fleurs", "fiori", "flowers"],
};

const ZAHLUNGEN = {
  TWINT: /(?<![a-z])twint(?![a-z])/,
  Bargeld: /(?<![a-z])(bargeld|cash|especes|contanti|contante)(?![a-z])/,
  Karte: /(?<![a-z])(kartenzahlung|ec-?karte|visa|mastercard|maestro|postfinance[ -]?card|carte bancaire|carta di credito|credit card|debit card)(?![a-z])/,
};

const WOERTER_KOPF = /(oeffnungszeit|horaire|orari|opening|hours|selbstbedienung|libre[- ]service|self[- ]service|willkommen|bienvenue|benvenuti|welcome)/;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const WEB = /(?<![@\w.-])(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:ch|com|net|org|swiss|bio|li|de|fr|it)(?![a-z0-9])(?:\/[^\s,;]*)?/gi;
const TELEFON = /(?<![\d])(?:\+|00)?\d[\d ()./-]{7,17}\d(?![\d])/g;
const PLZ_ORT = /(?<![\d])([1-9]\d{3})\s+([A-ZÄÖÜÉÈ][A-Za-zÄÖÜäöüéèàçô.'-]*(?:[ -][A-Za-zÄÖÜäöüéèàçô.'-]+){0,3})/;
const STRASSE = /^[A-Za-zÄÖÜäöüéèàçô][A-Za-zÄÖÜäöüéèàçô.' -]{2,}\s\d{1,3}\s?[a-z]?$/;

/** Schweizer Telefonnummer in lesbarer Form («031 123 45 67», «+41 31 123 45 67») oder null. */
export function normalisiereTelefon(roh) {
  const plus = /^\s*(\+|00)/.test(roh);
  let z = String(roh).replace(/\(0\)/g, "").replace(/\D/g, "");
  if (plus) {
    z = z.replace(/^(00)?/, "");
    if (!/^41\d{9}$/.test(z)) return null;
    return `+41 ${z.slice(2, 4)} ${z.slice(4, 7)} ${z.slice(7, 9)} ${z.slice(9, 11)}`;
  }
  if (/^0\d{9}$/.test(z)) return `${z.slice(0, 3)} ${z.slice(3, 6)} ${z.slice(6, 8)} ${z.slice(8, 10)}`;
  return null;
}

function webadresse(roh) {
  const w = String(roh).replace(/[.,;:)]+$/, "");
  const url = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return sichereHttpUrl(url) ? url.replace(/^http:\/\//i, "https://") : null;
}

/**
 * @param {string} text  erkannter Text (auch mehrzeilig, auch fehlerhaft)
 * @param {string[]} [sprachen]  Sprachen des Schildes («de», «fr», «it», «en»), die erste gilt für zweibuchstabige Kürzel
 */
export function leseSchildtext(text, sprachen = ["de"]) {
  const roh = String(text || "");
  const daten = {};
  let rest = roh;

  // E-Mail zuerst (enthält Punkte und Domains), danach Webadresse.
  const email = (roh.match(EMAIL) || [])[0];
  if (email) {
    daten.email = email.toLowerCase();
    rest = rest.replace(EMAIL, " ");
  }
  const web = (rest.match(WEB) || []).map(webadresse).find(Boolean);
  if (web) {
    daten.website = web;
    rest = rest.replace(WEB, " ");
  }

  // Adresse: «Strasse 12, 3000 Bern» in einer Zeile oder Strasse in der Zeile davor.
  const zeilen = rest.split(/\r?\n/).map((z) => z.trim());
  for (let i = 0; i < zeilen.length && !daten.plz; i++) {
    const m = PLZ_ORT.exec(zeilen[i]);
    if (!m || /(tel|fax|mobil|natel)/i.test(zeilen[i])) continue;
    const vor = zeilen[i].slice(0, m.index).replace(/[,\s]+$/, "").trim();
    const strasse = STRASSE.test(vor) ? vor : STRASSE.test(zeilen[i - 1] || "") ? zeilen[i - 1] : "";
    daten.plz = m[1];
    daten.ort = m[2].replace(/[.,]+$/, "").trim();
    if (strasse) daten.adresse = strasse;
    zeilen[i] = (zeilen[i].slice(0, m.index) + " " + zeilen[i].slice(m.index + m[0].length)).trim();
    if (strasse && STRASSE.test(zeilen[i - 1] || "")) zeilen[i - 1] = "";
  }
  rest = zeilen.join("\n");

  // Telefon (nur Schweizer Formate), aus dem Rest entfernen, damit die Ziffern nicht als Uhrzeit gelesen werden.
  for (const m of rest.match(TELEFON) || []) {
    const nr = normalisiereTelefon(m);
    if (nr) {
      if (!daten.mobilnummer) daten.mobilnummer = nr;
      rest = rest.replace(m, " ");
    }
  }

  // Öffnungszeiten: je Sprache lesen, das ergiebigste Ergebnis gilt.
  const codes = (sprachen && sprachen.length ? sprachen : ["de"]).map((s) => String(s).slice(0, 2));
  let beste = null;
  for (const c of codes) {
    const r = parseZeittext(rest, c);
    if (!beste || r.zeiten.length + r.geschlossen.length > beste.zeiten.length + beste.geschlossen.length) beste = r;
  }
  if (beste.zeiten.length) daten.oeffnungszeiten = beste.zeiten;

  // Angebote und Zahlungsarten: nur bekannte Wörter.
  const n = norm(roh);
  const angebote = Object.keys(ANGEBOTE).filter((name) =>
    ANGEBOTE[name].some((w) => new RegExp(`(?<![a-z])${w}(?![a-z])`).test(n))
  );
  if (angebote.length) daten.angebote = angebote;
  const zahlungen = Object.keys(ZAHLUNGEN).filter((name) => ZAHLUNGEN[name].test(n));
  if (zahlungen.length) daten.zahlungsarten = zahlungen;

  // Name: erste Zeile, die wie ein Name aussieht (Buchstaben, kein Kopfwort, keine Zahlen/Kontaktangaben).
  for (const zeile of roh.split(/\r?\n/).map((z) => z.trim()).filter(Boolean).slice(0, 4)) {
    const ohneLeer = zeile.replace(/\s/g, "");
    const buchstaben = (ohneLeer.match(/[A-Za-zÄÖÜäöüéèàçô]/g) || []).length;
    if (zeile.length < 3 || zeile.length > 60 || buchstaben / ohneLeer.length < 0.8) continue;
    if (WOERTER_KOPF.test(norm(zeile)) || /@|www\.|https?:/i.test(zeile)) continue;
    if (daten.adresse && zeile.includes(daten.adresse)) continue;
    daten.name = zeile;
    break;
  }

  const quellen = Object.keys(daten).flatMap((feld) => (feld === "name" || feld === "adresse" || feld === "plz" || feld === "ort" || feld === "mobilnummer" || feld === "email" || feld === "website" || feld === "oeffnungszeiten" || feld === "angebote" || feld === "zahlungsarten" ? [{ feld, quelle: QUELLE_SCHILD, status: "confirmed", url: null, lizenz: null }] : []));
  return {
    daten,
    quellen,
    abweichungen: {},
    vermutungen: {},
    hinweise: { geschlossen: beste.geschlossen, ungelesen: beste.ungelesen },
  };
}
