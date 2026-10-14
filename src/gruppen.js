/**
 * Gruppenmodell der Hofladen-Daten (ab 2.0.0, ohne DOM, damit testbar).
 *
 * Detail und Bearbeiten zeigen dieselben sieben Gruppen in derselben
 * Reihenfolge wie das Home-Assistant-Panel:
 * Grunddaten, Adresse & Standort, Kontakt & Webseite, Öffnungszeiten,
 * Angebote & Zahlungsarten, Bilder, Herkunft der Angaben.
 *
 * Jede Gruppe kennt
 * - `offenDetail` / `offenEditor`: ob sie auf dem Handy zunächst offen ist,
 * - `fortschritt(h)`: wie viele ihrer Angaben vorhanden sind (`{da, von}`),
 * - `kurzinfo(h)`: eine Zeile für den eingeklappten Zustand.
 */

const gefuellt = (wert) => wert != null && String(wert).trim() !== "";
const zahl = (wert) => wert != null && wert !== "" && Number.isFinite(Number(wert));

export function formatZeit(zeit) {
  return zeit ? String(zeit).slice(0, 5) : "";
}

function heuteIso(jetzt) {
  return `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, "0")}-${String(jetzt.getDate()).padStart(2, "0")}`;
}

/** Kurzinfo für die Öffnungszeiten: heutige Zeiten (Sonderzeiten haben Vorrang). */
export function heuteKurzinfo(h, jetzt = new Date()) {
  const iso = heuteIso(jetzt);
  const sonder = (h.sonderoeffnungszeiten || []).find((x) => x.datum_von <= iso && iso <= x.datum_bis);
  if (sonder) {
    return sonder.geschlossen ? "Heute geschlossen" : `Heute ${formatZeit(sonder.beginn)}–${formatZeit(sonder.ende)}`;
  }
  const wochentag = ((jetzt.getDay() + 6) % 7) + 1; // 1 = Montag
  const zeiten = (h.oeffnungszeiten || [])
    .filter((oz) => Number(oz.wochentag) === wochentag)
    .map((oz) => `${formatZeit(oz.beginn)}–${formatZeit(oz.ende)}`);
  if (zeiten.length) return `Heute ${zeiten.join(", ")}`;
  return (h.oeffnungszeiten || []).length ? "Heute geschlossen" : "";
}

function anzahl(liste, einzahl, mehrzahl) {
  const n = Array.isArray(liste) ? liste.length : 0;
  return n === 0 ? "" : n === 1 ? `1 ${einzahl}` : `${n} ${mehrzahl}`;
}

export const HOF_GRUPPEN = [
  {
    id: "grunddaten",
    titel: "Grunddaten",
    offenDetail: false,
    offenEditor: true,
    fortschritt: (h) => ({ da: [h.name, h.beschreibung].filter(gefuellt).length + (Number(h.bewertung) > 0 ? 1 : 0), von: 3 }),
    kurzinfo: (h) => (Number(h.bewertung) > 0 ? `${"★".repeat(Math.min(5, Number(h.bewertung)))}` : ""),
  },
  {
    id: "adresse",
    titel: "Adresse & Standort",
    offenDetail: false,
    offenEditor: true,
    fortschritt: (h) => ({
      da: [gefuellt(h.adresse), gefuellt(h.plz) || gefuellt(h.ort), zahl(h.latitude) && zahl(h.longitude)].filter(Boolean).length,
      von: 3,
    }),
    kurzinfo: (h) => [h.plz, h.ort].filter(gefuellt).join(" "),
  },
  {
    id: "kontakt",
    titel: "Kontakt & Webseite",
    offenDetail: false,
    offenEditor: false,
    // Zwei von drei Angaben gelten als vollständig (nicht jeder Hof hat eine E-Mail).
    fortschritt: (h) => {
      const da = [h.mobilnummer, h.email, h.website].filter(gefuellt).length;
      return { da: Math.min(da, 2), von: 2 };
    },
    kurzinfo: (h) => [h.mobilnummer, h.email, h.website].filter(gefuellt).length + " von 3",
  },
  {
    id: "oeffnungszeiten",
    titel: "Öffnungszeiten",
    offenDetail: true,
    offenEditor: false,
    fortschritt: (h) => ({ da: (h.oeffnungszeiten || []).length || (h.sonderoeffnungszeiten || []).length ? 1 : 0, von: 1 }),
    kurzinfo: (h) => heuteKurzinfo(h),
  },
  {
    id: "angebote",
    titel: "Angebote & Zahlungsarten",
    offenDetail: true,
    offenEditor: true,
    fortschritt: (h) => ({ da: [h.angebote, h.zahlungsarten].filter((l) => Array.isArray(l) && l.length).length, von: 2 }),
    kurzinfo: (h) => [anzahl(h.angebote, "Angebot", "Angebote"), anzahl(h.zahlungsarten, "Zahlungsart", "Zahlungsarten")].filter(Boolean).join(" · "),
  },
  {
    id: "bilder",
    titel: "Bilder",
    offenDetail: false,
    offenEditor: false,
    fortschritt: (h) => ({ da: (h.bilder || []).length || gefuellt(h.hauptbild_url) ? 1 : 0, von: 1 }),
    kurzinfo: (h) => anzahl(h.bilder, "Bild", "Bilder"),
  },
  {
    id: "herkunft",
    titel: "Herkunft der Angaben",
    offenDetail: false,
    offenEditor: false,
    // Reine Information, zählt nicht zur Vollständigkeit.
    informativ: true,
    fortschritt: (h) => ({ da: Array.isArray(h.quellen) && h.quellen.length ? 1 : 0, von: 1 }),
    kurzinfo: (h) => anzahl(h.quellen, "Quelle", "Quellen"),
  },
];

/** `"voll"`, `"halb"` oder `"leer"` für eine Gruppe. */
export function vollstaendigkeit(gruppe, h) {
  const { da, von } = gruppe.fortschritt(h || {});
  if (da <= 0) return "leer";
  return da >= von ? "voll" : "halb";
}

export const VOLLSTAENDIGKEIT_TEXT = {
  voll: "vollständig",
  halb: "teilweise ausgefüllt",
  leer: "noch leer",
};

/** Gruppen (ohne rein informative), die noch nicht vollständig sind. */
export function offeneGruppen(h) {
  return HOF_GRUPPEN.filter((g) => !g.informativ && vollstaendigkeit(g, h) !== "voll");
}
