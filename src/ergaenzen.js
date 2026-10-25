/**
 * „Angaben ergänzen“ (ab 2.0.0-dev.5): Vergleich eines Auslese-Vorschlags
 * (OpenStreetMap, Webseite, KI) mit dem, was schon erfasst ist – reine Logik
 * ohne DOM, die Oberfläche steht in src/views/auslesen.js.
 *
 * Regeln:
 * - Lücken sind vorgewählt: was bisher fehlt, wird ergänzt.
 * - Abweichungen sind nie vorgewählt: Bestehendes wird nur nach ausdrücklicher Wahl ersetzt.
 * - Listen (Angebote, Zahlungsarten) werden ergänzt, nie ersetzt.
 * - Vermutungen der KI stehen getrennt und sind nie vorgewählt.
 * - Gespeichert wird nichts: das Ergebnis ist ein Entwurf für den Editor.
 */

import { FINDEN_ZEILEN, FINDEN_VERMUTUNGEN, quellenListe, quelleFuerSpeichern, zeileWert } from "./finden.js";

/** Status einer Vergleichszeile. */
export const STATUS = {
  luecke: "luecke", // bisher leer → ergänzen (vorgewählt)
  ergaenzen: "ergaenzen", // Liste mit neuen Einträgen → ergänzen (vorgewählt)
  abweichung: "abweichung", // anderer Wert → nur nach Wahl ersetzen (nie vorgewählt)
  gleich: "gleich", // nichts zu tun
};

const COORD_TOLERANZ = 0.0005; // ca. 50 m

const leer = (w) => w == null || (typeof w === "string" && w.trim() === "") || (Array.isArray(w) && w.length === 0);
const klein = (s) => String(s ?? "").trim().toLowerCase();
const zeit = (z) => String(z ?? "").slice(0, 5);
const namen = (liste) => (Array.isArray(liste) ? liste : []).map((x) => String(x?.name ?? x).trim()).filter(Boolean);

function stunden(liste) {
  return JSON.stringify(
    (Array.isArray(liste) ? liste : []).map((z) => [Number(z.wochentag), zeit(z.beginn), zeit(z.ende)]).sort()
  );
}

function gleicherSkalar(feld, a, b) {
  if (feld === "latitude" || feld === "longitude") {
    return Math.abs(Number(a) - Number(b)) <= COORD_TOLERANZ;
  }
  return klein(a) === klein(b);
}

/**
 * Vergleicht Vorschlag und Bestehendes.
 * `aktuell` ist der Hofladen (oder `{}` für einen neuen), `vorschlag` die Antwort des Servers
 * (`{daten, quellen, abweichungen, vermutungen}`).
 * Liefert `{zeilen, vermutungen}`; Zeilen ohne gefundenen Wert fehlen.
 */
export function vergleiche(aktuell, vorschlag) {
  const bestehend = aktuell || {};
  const gefunden = vorschlag?.daten || {};
  const abweichungen = vorschlag?.abweichungen || {};
  const quellen = quellenListe(vorschlag?.quellen);
  const zeilen = [];

  for (const zeile of FINDEN_ZEILEN) {
    const gefundenText = zeileWert(zeile, gefunden);
    if (!gefundenText) continue;
    const q = zeile.felder.map((f) => quellen.find((x) => x.feld === f)).find(Boolean) || null;
    const abwQuelle = zeile.felder.map((f) => abweichungen[f]).find(Boolean) || null;
    const basis = {
      key: zeile.key,
      label: zeile.label,
      felder: zeile.felder,
      aktuell: zeileWert(zeile, bestehend),
      gefunden: gefundenText,
      quelle: q,
      abweichungVon: abwQuelle,
    };

    if (zeile.key === "angebote" || zeile.key === "zahlungsarten") {
      const vorhanden = namen(bestehend[zeile.key]);
      const neu = namen(gefunden[zeile.key]).filter((n) => !vorhanden.some((v) => klein(v) === klein(n)));
      const status = !neu.length ? STATUS.gleich : vorhanden.length ? STATUS.ergaenzen : STATUS.luecke;
      zeilen.push({ ...basis, status, neu, vorgewaehlt: status === STATUS.luecke || status === STATUS.ergaenzen });
      continue;
    }

    if (zeile.key === "oeffnungszeiten") {
      const hat = Array.isArray(bestehend.oeffnungszeiten) && bestehend.oeffnungszeiten.length > 0;
      const status = !hat ? STATUS.luecke : stunden(bestehend.oeffnungszeiten) === stunden(gefunden.oeffnungszeiten) ? STATUS.gleich : STATUS.abweichung;
      zeilen.push({ ...basis, status, vorgewaehlt: status === STATUS.luecke });
      continue;
    }

    // Einzelne oder mehrere Felder (Adresse, Koordinaten): feldweise vergleichen.
    const gefFelder = zeile.felder.filter((f) => !leer(gefunden[f]));
    const unterschied = gefFelder.some((f) => !leer(bestehend[f]) && !gleicherSkalar(f, bestehend[f], gefunden[f]));
    const fehlend = gefFelder.some((f) => leer(bestehend[f]));
    const status = unterschied ? STATUS.abweichung : fehlend ? STATUS.luecke : STATUS.gleich;
    zeilen.push({ ...basis, status, vorgewaehlt: status === STATUS.luecke });
  }

  const vermutungen = [];
  const roh = vorschlag?.vermutungen || {};
  for (const v of FINDEN_VERMUTUNGEN) {
    const werte = namen(roh[v.key]);
    if (!werte.length) continue;
    const vorhanden = namen(bestehend[v.key]);
    const neu = werte.filter((n) => !vorhanden.some((x) => klein(x) === klein(n)));
    if (!neu.length) continue;
    vermutungen.push({ key: v.key, label: v.label, neu, vorgewaehlt: false });
  }

  return { zeilen, vermutungen };
}

/** Vorauswahl: Lücken und Ergänzungen an, Abweichungen und Vermutungen aus. */
export function vorauswahl(vergleich) {
  const auswahl = {};
  for (const z of vergleich.zeilen) auswahl[z.key] = !!z.vorgewaehlt;
  for (const v of vergleich.vermutungen) auswahl[`vermutung:${v.key}`] = false;
  return auswahl;
}

function tags(werte, praefix) {
  return werte.map((n, i) => ({ id: `${praefix}-${klein(n).replace(/\s+/g, "-")}-${i}`, name: n }));
}

/**
 * Baut aus der Auswahl den Entwurf für den Editor: `{daten, quellen, geaendert}`.
 * `daten` enthält nur Felder, die sich ändern (Listen vollständig, mit Bestehendem);
 * `quellen` ist die Herkunft nach der Übernahme (Bestehendes bleibt, ersetzte Felder bekommen die neue Quelle).
 */
export function baueErgaenzung(aktuell, vorschlag, vergleich, auswahl) {
  const bestehend = aktuell || {};
  const gefunden = vorschlag?.daten || {};
  const quellenNeu = quellenListe(vorschlag?.quellen);
  const daten = {};
  const geaendert = [];
  const neueHerkunft = new Map(); // feld → Eintrag
  const entfernen = new Set(); // Felder, deren alte Herkunft nicht mehr stimmt

  const merkeQuelle = (feld) => {
    const q = quellenNeu.find((x) => x.feld === feld);
    if (q) neueHerkunft.set(feld, quelleFuerSpeichern(q));
  };

  for (const z of vergleich.zeilen) {
    if (!auswahl[z.key] || z.status === STATUS.gleich) continue;

    if (z.key === "angebote" || z.key === "zahlungsarten") {
      const vorhanden = namen(bestehend[z.key]);
      daten[z.key] = [...(bestehend[z.key] || []), ...tags(z.neu, z.key === "angebote" ? "angebot" : "zahlungsart")];
      if (vorhanden.length) entfernen.add(z.key);
      else merkeQuelle(z.key);
      geaendert.push(z.label);
      continue;
    }

    if (z.key === "oeffnungszeiten") {
      daten.oeffnungszeiten = (gefunden.oeffnungszeiten || []).map((o) => ({ ...o }));
      merkeQuelle("oeffnungszeiten");
      geaendert.push(z.label);
      continue;
    }

    const ersetzen = z.status === STATUS.abweichung;
    for (const f of z.felder) {
      if (leer(gefunden[f])) continue;
      if (!ersetzen && !leer(bestehend[f])) continue; // Lücke: nur leere Felder füllen
      daten[f] = gefunden[f];
      merkeQuelle(f);
    }
    geaendert.push(z.label);
  }

  for (const v of vergleich.vermutungen) {
    if (!auswahl[`vermutung:${v.key}`]) continue;
    const vorhanden = namen(daten[v.key] ?? bestehend[v.key]);
    daten[v.key] = [...(daten[v.key] ?? bestehend[v.key] ?? []), ...tags(v.neu, v.key === "angebote" ? "angebot" : "zahlungsart")];
    if (!vorhanden.length) neueHerkunft.set(v.key, { feld: v.key, quelle: "ki", status: "inferred", url: null, lizenz: null });
    else entfernen.add(v.key);
    geaendert.push(`${v.label} (vermutet)`);
  }

  const behalten = (bestehend.quellen || [])
    .filter((q) => !neueHerkunft.has(q.feld) && !entfernen.has(q.feld))
    .map((q) => quelleFuerSpeichern(q));
  return { daten, quellen: [...behalten, ...neueHerkunft.values()], geaendert };
}
