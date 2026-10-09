/**
 * „Hofladen finden“ – reine Logik ohne DOM (Gegenstück zum Dialog im
 * HA-Verwaltungs-Panel, hofkarte-panel.js). Die Oberfläche steht in
 * src/views/finden.js; hier liegen Tabellen, Textaufbereitung, die
 * Übernahme der gewählten Angaben als Entwurf für den Editor und die
 * Pflege der Herkunftsangaben („quellen“).
 */

export const FINDEN_STANDARD_RADIUS_METER = 2000;
export const FINDEN_MIN_RADIUS_METER = 50;
export const FINDEN_MAX_RADIUS_METER = 5000;

export const FINDEN_FEHLERMELDUNGEN = {
  invalid_coordinates: "Bitte gültige Latitude-/Longitude-Werte eintragen.",
  unreachable:
    "Die Overpass API (OpenStreetMap) konnte nicht erreicht werden. Bitte später erneut versuchen.",
  not_ready: "HofKarte ist noch nicht bereit.",
  invalid_format: "Es fehlen Angaben für die Anreicherung.",
  unauthorized: "Für „Hofladen finden“ sind Administratorrechte in Home Assistant nötig.",
};

export const FINDEN_WEBSITE_STATUS = {
  ok: "Website ausgewertet",
  robots_gesperrt: "Die Website verbietet automatisches Auslesen (robots.txt) – nicht abgerufen",
  robots_nicht_lesbar: "robots.txt der Website nicht lesbar – Website nicht abgerufen",
  nicht_erreichbar: "Website nicht erreichbar",
  keine_informationen: "Auf der Website wurde nichts Verwertbares gefunden",
  ungueltige_url: "Ungültige Website-Adresse",
  uebersprungen: "Keine Website angegeben",
};

export const FINDEN_KI_STATUS = {
  ok: "KI-Auswertung abgeschlossen",
  keine_ergebnisse: "Die KI hat nichts Belegbares gefunden",
  keine_texte: "Kein Seitentext für die KI vorhanden",
  zeitueberschreitung: "Die KI hat zu lange gebraucht – ohne KI fortgefahren",
  fehler: "Die KI-Entität ist fehlgeschlagen – ohne KI fortgefahren",
  ungueltige_antwort: "Unbrauchbare Antwort der KI – ohne KI fortgefahren",
  nicht_konfiguriert: "Keine KI-Entität gewählt",
};

export const FINDEN_QUELLEN_LABEL = {
  openstreetmap: "OpenStreetMap",
  website: "Website",
  website_ki: "Website (KI-gestützt)",
  ki: "KI-Vermutung, nicht belegt",
  angabe: "Eigene Angabe",
};

export const FINDEN_ZEILEN = [
  { key: "name", label: "Name", felder: ["name"] },
  { key: "adresse", label: "Adresse", felder: ["adresse", "plz", "ort"] },
  { key: "land", label: "Land", felder: ["land"] },
  { key: "website", label: "Webseite", felder: ["website"] },
  { key: "mobilnummer", label: "Telefon", felder: ["mobilnummer"] },
  { key: "email", label: "E-Mail", felder: ["email"] },
  { key: "oeffnungszeiten", label: "Öffnungszeiten", felder: ["oeffnungszeiten"] },
  { key: "angebote", label: "Angebote", felder: ["angebote"] },
  { key: "zahlungsarten", label: "Zahlungsarten", felder: ["zahlungsarten"] },
  { key: "koordinaten", label: "Koordinaten", felder: ["latitude", "longitude"] },
];

/** Zeilen für KI-Vermutungen (im Text nicht belegt, nie vorausgewählt). */
export const FINDEN_VERMUTUNGEN = [
  { key: "angebote", label: "Angebote" },
  { key: "zahlungsarten", label: "Zahlungsarten" },
];

const TAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export function istHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

export function radiusText(meter) {
  return meter >= 1000
    ? `${(meter / 1000).toFixed(meter % 1000 ? 1 : 0)} km`
    : `${meter} m`;
}

/** Zahl aus einem Eingabefeld ("" → NaN, Komma als Dezimaltrenner erlaubt). */
export function koordinatenZahl(wert) {
  return String(wert ?? "").trim() === "" ? NaN : Number(String(wert).replace(",", "."));
}

export function istGueltigeKoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** `quellen` des Vorschlags als Liste (Server liefert Liste; Objektform
 * `{feld: {...}}` wird toleriert). */
export function quellenListe(quellen) {
  if (Array.isArray(quellen)) return quellen;
  return Object.entries(quellen || {}).map(([feld, q]) => ({ feld, ...q }));
}

/** Lesbarer Text der Werte einer Prüfzeile ("" = nichts gefunden). */
export function zeileWert(zeile, daten) {
  const d = daten || {};
  if (zeile.key === "adresse") {
    return [d.adresse, [d.plz, d.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  if (zeile.key === "koordinaten") {
    return d.latitude != null && d.longitude != null && Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude))
      ? `${Number(d.latitude).toFixed(5)}, ${Number(d.longitude).toFixed(5)}`
      : "";
  }
  if (zeile.key === "oeffnungszeiten") {
    const proTag = new Map();
    for (const z of Array.isArray(d.oeffnungszeiten) ? d.oeffnungszeiten : []) {
      proTag.set(z.wochentag, [...(proTag.get(z.wochentag) || []), `${z.beginn}–${z.ende}`]);
    }
    return [...proTag.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tag, zeiten]) => `${TAGE_KURZ[tag - 1] || ""} ${zeiten.join(", ")}`)
      .join("; ");
  }
  const wert = d[zeile.key];
  if (Array.isArray(wert)) return wert.map((x) => x.name || x).join(", ");
  return wert ? String(wert) : "";
}

/** Gründe für die Einstufung eines Kandidaten (Entfernung, Name, Website). */
export function kandidatGruende(k) {
  const s = k.signale || {};
  const teile = [];
  const m = Math.round(k.entfernung_meter ?? 0);
  teile.push(m <= 25 ? `sehr nah (${m} m)` : `${m} m entfernt`);
  if (s.name != null) teile.push(s.name >= 0.85 ? "Name stimmt" : s.name >= 0.5 ? "Name ähnlich" : "Name weicht ab");
  if (s.website) teile.push("Website stimmt überein");
  return teile.join(" · ");
}

/** Gibt es schon einen Hofladen mit gleichem Namen oder (<= 100 m) an
 * derselben Stelle? Rein informativ. */
export function findeBestehenden(kandidat, hoflaeden) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const namen = [kandidat.name, ...(kandidat.weitere_namen || [])].map(norm).filter(Boolean);
  return (
    (hoflaeden || []).find((item) => {
      if (namen.includes(norm(item.name))) return true;
      const lat = Number(item.latitude);
      const lon = Number(item.longitude);
      if (item.latitude == null || item.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      const dLat = (lat - kandidat.latitude) * 111195;
      const dLon = (lon - kandidat.longitude) * 111195 * Math.cos((kandidat.latitude * Math.PI) / 180);
      return Math.hypot(dLat, dLon) <= 100;
    }) || null
  );
}

function slug(wert) {
  return String(wert ?? "").trim().toLowerCase();
}

function leer(wert) {
  return wert == null || wert === "" || (Array.isArray(wert) && !wert.length);
}

/** Vergleichswert eines Feldes, um zu erkennen, ob es nach der Übernahme
 * von Hand geändert wurde (Pendant zu `quellenWert()` im HA-Panel). */
export function quellenWert(feld, daten) {
  const v = daten?.[feld];
  if (feld === "angebote" || feld === "zahlungsarten") {
    return JSON.stringify((v || []).map((x) => slug(x.name ?? x)).sort());
  }
  if (feld === "oeffnungszeiten") {
    return JSON.stringify((v || []).map((z) => [Number(z.wochentag), z.beginn, z.ende]).sort());
  }
  if (feld === "latitude" || feld === "longitude") {
    return v === null || v === undefined || v === "" ? "" : String(Number(v));
  }
  return String(v ?? "").trim();
}

export function quellenSchnappschuss(quellen, daten) {
  const snap = {};
  for (const q of quellen || []) snap[q.feld] = quellenWert(q.feld, daten);
  return snap;
}

/** Behält nur die Herkunftsangaben von Feldern, die seit dem Schnappschuss
 * unverändert sind (sonst wäre die Angabe falsch). */
export function bereinigteQuellen(quellen, schnappschuss, daten) {
  return (quellen || []).filter(
    (q) => !(q.feld in (schnappschuss || {})) || schnappschuss[q.feld] === quellenWert(q.feld, daten)
  );
}

/** Nur die bekannten Felder der Herkunft an den Server geben. */
export function quelleFuerSpeichern(q) {
  return {
    feld: q.feld,
    quelle: q.quelle,
    status: q.status || "confirmed",
    url: q.url || null,
    lizenz: q.lizenz || null,
  };
}

function tags(werte, praefix) {
  return werte.map((w, i) => ({ id: `${praefix}-${slug(w.name ?? w).replace(/\s+/g, "-")}-${i}`, name: String(w.name ?? w) }));
}

/**
 * Wählt aus dem Vorschlag die angehakten Zeilen aus und baut den Entwurf
 * für den Editor: `{daten, quellen}`. `felder` ist die Auswahl
 * (`zeilenKey` → bool, `vermutung:<key>` → bool). Unbelegte KI-Vermutungen
 * werden nur übernommen, wenn angehakt; das Feld gilt dann als vermutet
 * (`ki`/`inferred`).
 */
export function baueEntwurf(vorschlag, felder, { name = "", website = "" } = {}) {
  const quellen = quellenListe(vorschlag?.quellen);
  const vorgabe = vorschlag?.daten || {};
  const daten = {};
  const uebernommen = [];
  for (const zeile of FINDEN_ZEILEN) {
    if (!felder[zeile.key]) continue;
    for (const feld of zeile.felder) {
      if (!leer(vorgabe[feld])) {
        daten[feld] = vorgabe[feld];
        uebernommen.push(feld);
      }
    }
  }
  const vermutungen = vorschlag?.vermutungen || {};
  const vermutet = [];
  for (const v of FINDEN_VERMUTUNGEN) {
    const werte = Array.isArray(vermutungen[v.key]) ? vermutungen[v.key] : [];
    if (!felder[`vermutung:${v.key}`] || !werte.length) continue;
    const vorhanden = Array.isArray(daten[v.key]) ? daten[v.key] : [];
    const alle = [...vorhanden.map((x) => x.name ?? x), ...werte.map((x) => x.name ?? x)];
    daten[v.key] = [...new Set(alle)];
    vermutet.push(v.key);
  }
  for (const k of ["angebote", "zahlungsarten"]) {
    if (Array.isArray(daten[k])) daten[k] = tags(daten[k], k === "angebote" ? "angebot" : "zahlungsart");
  }
  if (!daten.name && name) daten.name = name;
  if (!daten.website && website) daten.website = website;

  const herkunft = quellen
    .filter((q) => uebernommen.includes(q.feld) && !vermutet.includes(q.feld))
    .map(quelleFuerSpeichern);
  for (const feld of vermutet) {
    herkunft.push({ feld, quelle: "ki", status: "inferred", url: null, lizenz: null });
  }
  return { daten, quellen: herkunft };
}
