/**
 * Zeittext – liest Öffnungszeiten aus freiem Text und erzeugt Vorlagen.
 *
 * Reine Logik ohne DOM, deshalb einzeln testbar. Wird vom Editor
 * («Zeiten als Text eingeben») und später von der Schilderkennung genutzt.
 *
 * Beispiele (alle ergeben Montag bis Freitag 08:00–12:00 und 14:00–18:00):
 *   «Mo-Fr 8-12, 14-18»
 *   «Mo–Fr: 08:00–12:00 / 14:00–18:00 Uhr»
 *   «lun au ven 8h-12h 14h-18h»   (Französisch)
 *   «lun-ven 8.00-12.00 e 14.00-18.00»   (Italienisch)
 *   «Mon-Fri 8-12, 14-18» (Englisch); es werden nur 24-Stunden-Zeiten gelesen.
 *
 * Wochentage zählen wie im Datenmodell: 1 = Montag … 7 = Sonntag.
 * Der Parser rät nicht: Was er nicht sicher lesen kann, landet in `ungelesen`.
 */

const TAGE_LANG = {
  de: { montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 7, mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6, so: 7 },
  fr: { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7, lu: 1, ma: 2, me: 3, je: 4, ve: 5, sa: 6, di: 7 },
  it: { lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6, domenica: 7, lu: 1, ma: 2, me: 3, gi: 4, ve: 5, sa: 6, do: 7 },
  en: { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 7 },
};

/** Gemeinsame Kürzel mit drei und mehr Buchstaben, in jeder Sprache lesbar. */
const TAGE_LANG_KURZ = {
  mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7,
  lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6, dim: 7,
  gio: 4, sab: 6, dom: 7,
};

const GESCHLOSSEN = new Set([
  "geschlossen", "ruhetag", "zu", "ferme", "fermee", "fermes", "repos", "chiuso", "chiusa", "riposo", "closed",
]);

/** Trennwörter zwischen zwei Angaben («Mo bis Fr», «8 à 12»). */
const BIS = new Set(["bis", "a", "au", "al", "alle", "to", "till", "until", "through", "thru"]);

const TAEGLICH = /(taeglich|täglich|tous les jours|tutti i giorni|ogni giorno|every day|everyday|daily|7\/7)/g;

function ohneAkzente(s) {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function tagFuerWort(wort, sprache) {
  const w = wort.replace(/\.$/, "");
  const lang = TAGE_LANG[sprache] || TAGE_LANG.de;
  if (w in lang) return lang[w];
  // Volle Wochentagsnamen sind in allen Sprachen eindeutig.
  for (const k of Object.keys(TAGE_LANG)) {
    if (w.length > 2 && w in TAGE_LANG[k]) return TAGE_LANG[k][w];
  }
  if (w in TAGE_LANG_KURZ) return TAGE_LANG_KURZ[w];
  return null;
}

function zeitText(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Liest eine Uhrzeit wie «8», «8.30», «08:00», «8h», «8h30»; sonst null. */
export function liesUhrzeit(text) {
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?h?$/.exec(String(text).trim().toLowerCase());
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return zeitText(h === 24 ? 0 : h, min);
}

function tagBereich(von, bis) {
  const tage = [];
  let d = von;
  for (let n = 0; n < 7; n++) {
    tage.push(d);
    if (d === bis) break;
    d = d === 7 ? 1 : d + 1;
  }
  return tage;
}

/**
 * @param {string} text
 * @param {"de"|"fr"|"it"|"en"} [sprache] für zweibuchstabige Kürzel
 * @returns {{zeiten: {wochentag:number, beginn:string, ende:string}[], geschlossen:number[], ungelesen:string[]}}
 */
export function parseZeittext(text, sprache = "de") {
  const ergebnis = { zeiten: [], geschlossen: [], ungelesen: [] };
  let s = ohneAkzente(String(text || "")).replace(TAEGLICH, " @taeglich ");
  s = s.replace(/[–—−]/g, "-");

  const muster = /(?<![\d])(\d{1,2})(?:[:.h](\d{2}))?(?![\d])|(@taeglich)|([a-z]+\.?)|(-)/g;
  const tokens = [];
  let m;
  while ((m = muster.exec(s)) !== null) {
    if (m[1] !== undefined) {
      const z = liesUhrzeit(m[2] === undefined ? m[1] : `${m[1]}:${m[2]}`);
      tokens.push(z ? { t: "zeit", v: z } : { t: "unbekannt", v: m[0] });
    } else if (m[3]) {
      tokens.push({ t: "tage", v: [1, 2, 3, 4, 5, 6, 7] });
    } else if (m[5]) {
      tokens.push({ t: "bis" });
    } else if (m[4]) {
      const w = m[4].replace(/\.$/, "");
      const tag = tagFuerWort(m[4], sprache);
      if (tag !== null) tokens.push({ t: "tag", v: tag });
      else if (GESCHLOSSEN.has(w)) tokens.push({ t: "zu" });
      else if (BIS.has(w)) tokens.push({ t: "bis" });
      // alle anderen Wörter (Uhr, und, et, ab, von, Hofladen …) werden übergangen
    }
  }

  let tage = [];
  let intervalle = [];
  let zu = false;
  let offeneZeit = null; // Uhrzeit, auf die ein Bis-Zeichen folgen kann
  let bisOffen = false;
  let letzter = null;
  const verworfen = [];

  const fertig = () => {
    if (tage.length) {
      if (zu) ergebnis.geschlossen.push(...tage);
      else if (intervalle.length) {
        for (const tg of tage) for (const [b, e] of intervalle) ergebnis.zeiten.push({ wochentag: tg, beginn: b, ende: e });
      } else verworfen.push(tage);
    } else if (intervalle.length) verworfen.push(null);
    if (offeneZeit) verworfen.push(null);
    tage = [];
    intervalle = [];
    zu = false;
    offeneZeit = null;
    bisOffen = false;
  };

  for (const tok of tokens) {
    if (tok.t === "tag" || tok.t === "tage") {
      if (intervalle.length || zu || offeneZeit) fertig();
      if (tok.t === "tage") tage.push(...tok.v);
      else if (bisOffen === "tag") {
        const von = tage.pop();
        tage.push(...tagBereich(von, tok.v));
      } else tage.push(tok.v);
      bisOffen = false;
    } else if (tok.t === "zeit") {
      if (bisOffen === "zeit" && offeneZeit) {
        if (offeneZeit !== tok.v) intervalle.push([offeneZeit, tok.v]);
        offeneZeit = null;
      } else {
        if (offeneZeit) verworfen.push(null);
        offeneZeit = tok.v;
      }
      bisOffen = false;
    } else if (tok.t === "bis") {
      bisOffen = letzter && (letzter.t === "tag" || letzter.t === "zeit") ? letzter.t : false;
    } else if (tok.t === "zu") {
      if (intervalle.length) fertig();
      zu = true;
    } else if (tok.t === "unbekannt") {
      verworfen.push(null);
    }
    letzter = tok;
  }
  fertig();

  const tageSortiert = (a, b) => a.wochentag - b.wochentag || a.beginn.localeCompare(b.beginn);
  const gesehen = new Set();
  ergebnis.zeiten = ergebnis.zeiten
    .filter((z) => {
      const k = `${z.wochentag}${z.beginn}${z.ende}`;
      if (gesehen.has(k)) return false;
      gesehen.add(k);
      return true;
    })
    .sort(tageSortiert);
  ergebnis.geschlossen = [...new Set(ergebnis.geschlossen)].sort((a, b) => a - b);
  // Nur Tage melden, die nirgends vorkommen (Mehrfachnennungen wären kein Fehler).
  const verwendet = new Set([...ergebnis.zeiten.map((z) => z.wochentag), ...ergebnis.geschlossen]);
  for (const v of verworfen) {
    if (Array.isArray(v)) ergebnis.ungelesen.push(...v.filter((d) => !verwendet.has(d)));
    else ergebnis.ungelesen.push(0);
  }
  ergebnis.ungelesen = [...new Set(ergebnis.ungelesen)];
  return ergebnis;
}

/**
 * Vorlagen für häufige Wochenpläne. `zeiten` hat dieselbe Form wie das
 * Ergebnis von `parseZeittext`.
 */
export const VORLAGEN = [
  { id: "mo-fr-geteilt", tage: [1, 2, 3, 4, 5], intervalle: [["08:00", "12:00"], ["14:00", "18:00"]] },
  { id: "mo-sa-durchgehend", tage: [1, 2, 3, 4, 5, 6], intervalle: [["08:00", "18:00"]] },
  { id: "taeglich", tage: [1, 2, 3, 4, 5, 6, 7], intervalle: [["07:00", "20:00"]] },
];

export function zeitenAusVorlage(vorlage) {
  const liste = [];
  for (const tg of vorlage.tage) for (const [b, e] of vorlage.intervalle) liste.push({ wochentag: tg, beginn: b, ende: e });
  return liste;
}
