/**
 * Sonderöffnungszeiten (ab 2.1.0 in der PWA bearbeitbar).
 *
 * Format wie in HofKarte-HA (`models.Sonderoeffnungszeit`):
 *   { datum_von: "YYYY-MM-DD", datum_bis: "YYYY-MM-DD", geschlossen: bool,
 *     beginn: "HH:MM" | null, ende: "HH:MM" | null }
 * Bei `geschlossen: true` gibt es keine Zeiten. Reine Funktionen ohne DOM,
 * damit sie testbar sind.
 */

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const ZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Ein leerer Eintrag, vorbelegt mit «Geschlossen» (Ferien sind der häufigste Fall). */
export function neueSonderzeit(heuteIso) {
  const tag = DATUM.test(heuteIso || "") ? heuteIso : "";
  return { datum_von: tag, datum_bis: tag, geschlossen: true, beginn: null, ende: null };
}

/** Übernimmt die Felder aus Home Assistant (unbekannte Felder werden verworfen). */
export function normalisiereSonderzeit(x) {
  const geschlossen = x?.geschlossen === true;
  return {
    datum_von: String(x?.datum_von || ""),
    datum_bis: String(x?.datum_bis || ""),
    geschlossen,
    beginn: geschlossen ? null : String(x?.beginn || "").slice(0, 5) || null,
    ende: geschlossen ? null : String(x?.ende || "").slice(0, 5) || null,
  };
}

/** Nach Beginn-Datum sortiert (stabil), ohne die Eingabe zu verändern. */
export function sortiereSonderzeiten(liste) {
  return liste
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x.datum_von < b.x.datum_von ? -1 : a.x.datum_von > b.x.datum_von ? 1 : a.i - b.i))
    .map(({ x }) => x);
}

/**
 * Prüft eine Liste. Liefert Fehler als `{ index, feld, code }` mit
 * `feld` ∈ datum_von | datum_bis | beginn | ende und `code` ∈
 * fehlt | ungueltig | bis_vor_von | ende_gleich_beginn.
 */
export function pruefeSonderzeiten(liste) {
  const fehler = [];
  liste.forEach((x, index) => {
    if (!x.datum_von) fehler.push({ index, feld: "datum_von", code: "fehlt" });
    else if (!DATUM.test(x.datum_von)) fehler.push({ index, feld: "datum_von", code: "ungueltig" });
    if (!x.datum_bis) fehler.push({ index, feld: "datum_bis", code: "fehlt" });
    else if (!DATUM.test(x.datum_bis)) fehler.push({ index, feld: "datum_bis", code: "ungueltig" });
    if (DATUM.test(x.datum_von) && DATUM.test(x.datum_bis) && x.datum_bis < x.datum_von) {
      fehler.push({ index, feld: "datum_bis", code: "bis_vor_von" });
    }
    if (!x.geschlossen) {
      if (!x.beginn) fehler.push({ index, feld: "beginn", code: "fehlt" });
      else if (!ZEIT.test(x.beginn)) fehler.push({ index, feld: "beginn", code: "ungueltig" });
      if (!x.ende) fehler.push({ index, feld: "ende", code: "fehlt" });
      else if (!ZEIT.test(x.ende)) fehler.push({ index, feld: "ende", code: "ungueltig" });
      if (ZEIT.test(x.beginn || "") && ZEIT.test(x.ende || "") && x.beginn === x.ende) {
        fehler.push({ index, feld: "ende", code: "ende_gleich_beginn" });
      }
    }
  });
  return fehler;
}

/** Index-Paare `[i, j]` gültiger Einträge, deren Zeiträume sich überschneiden (nur Warnung). */
export function ueberschneidungen(liste) {
  const gueltig = liste
    .map((x, index) => ({ x, index }))
    .filter(({ x }) => DATUM.test(x.datum_von) && DATUM.test(x.datum_bis) && x.datum_bis >= x.datum_von);
  const paare = [];
  for (let a = 0; a < gueltig.length; a++) {
    for (let b = a + 1; b < gueltig.length; b++) {
      if (gueltig[a].x.datum_von <= gueltig[b].x.datum_bis && gueltig[b].x.datum_von <= gueltig[a].x.datum_bis) {
        paare.push([gueltig[a].index, gueltig[b].index]);
      }
    }
  }
  return paare;
}

/** Format für `hofkarte/management/save`: ohne Zeiten bei «geschlossen», sortiert. */
export function fuerSpeichern(liste) {
  return sortiereSonderzeiten(liste).map((x) => ({
    datum_von: x.datum_von,
    datum_bis: x.datum_bis,
    geschlossen: !!x.geschlossen,
    ...(x.geschlossen ? {} : { beginn: x.beginn, ende: x.ende }),
  }));
}
