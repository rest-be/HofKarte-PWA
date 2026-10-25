/**
 * Adresse aus Koordinaten (ab 2.0.0-dev.8): Rückwärtssuche bei OpenStreetMap
 * (Nominatim). Reine Logik ohne DOM; die Oberfläche steht im Editor.
 *
 * Regeln: nur auf Tipp, es werden nur die Koordinaten gesendet; Lücken sind
 * vorgewählt, abweichende Angaben nie; gespeichert wird erst im Editor.
 * Die Daten stammen von OpenStreetMap-Mitwirkenden (ODbL).
 */

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

/** Felder, die der Vorschlag füllen kann (Reihenfolge der Anzeige). */
export const ADRESS_FELDER = ["adresse", "plz", "ort"];

/** URL der Rückwärtssuche; `sprache` ist der Sprachcode der Oberfläche. */
export function reverseUrl(latitude, longitude, sprache = "de") {
  const p = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    zoom: "18",
    "accept-language": sprache,
    lat: String(latitude),
    lon: String(longitude),
  });
  return `${NOMINATIM_URL}?${p.toString()}`;
}

/** Koordinaten prüfen: `{latitude, longitude}` oder `null`. */
export function gueltigeKoordinaten(latitude, longitude) {
  const text = (v) => (v === null || v === undefined ? "" : String(v).trim().replace(",", "."));
  if (text(latitude) === "" || text(longitude) === "") return null;
  const lat = Number(text(latitude));
  const lon = Number(text(longitude));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: lat, longitude: lon };
}

/**
 * Antwort von Nominatim → `{adresse, plz, ort, land, osmUrl}` (leere Felder
 * als `""`) oder `null`, wenn nichts Brauchbares gefunden wurde.
 */
export function adresseAusAntwort(antwort) {
  const a = antwort && typeof antwort === "object" ? antwort.address : null;
  if (!a || typeof a !== "object") return null;
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const strasse = text(a.road) || text(a.pedestrian) || text(a.footway) || text(a.path) || text(a.hamlet) || text(a.neighbourhood);
  const nummer = text(a.house_number);
  const ort = text(a.city) || text(a.town) || text(a.village) || text(a.municipality) || text(a.hamlet);
  const ergebnis = {
    adresse: [strasse, nummer].filter(Boolean).join(" "),
    plz: text(a.postcode),
    ort,
    land: text(a.country),
    osmUrl: antwort.osm_type && antwort.osm_id ? `https://www.openstreetmap.org/${encodeURIComponent(antwort.osm_type)}/${encodeURIComponent(antwort.osm_id)}` : "https://www.openstreetmap.org/copyright",
  };
  if (!ergebnis.adresse && !ergebnis.plz && !ergebnis.ort) return null;
  return ergebnis;
}

const leer = (w) => w == null || String(w).trim() === "";
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Vergleicht Vorschlag und aktuelle Eingabe je Feld.
 * `status`: "luecke" (Feld leer → vorgewählt), "abweichung" (anderer Wert →
 * nie vorgewählt) oder "gleich" (nichts zu tun, nicht angeboten).
 */
export function vergleicheAdresse(aktuell, vorschlag) {
  const zeilen = [];
  for (const feld of ADRESS_FELDER) {
    const neu = vorschlag?.[feld];
    if (leer(neu)) continue;
    const alt = aktuell?.[feld];
    let status;
    if (leer(alt)) status = "luecke";
    else if (norm(alt) === norm(neu)) status = "gleich";
    else status = "abweichung";
    zeilen.push({ feld, alt: leer(alt) ? "" : String(alt), neu: String(neu), status, vorgewaehlt: status === "luecke" });
  }
  return zeilen;
}

/** Fragt Nominatim ab; wirft `Error` mit Meldungsschlüssel in `code`. */
export async function ermittleAdresse(latitude, longitude, { sprache = "de", fetchFn = globalThis.fetch, signal } = {}) {
  const koordinaten = gueltigeKoordinaten(latitude, longitude);
  if (!koordinaten) {
    const e = new Error("koordinaten");
    e.code = "koordinaten";
    throw e;
  }
  let antwort;
  try {
    antwort = await fetchFn(reverseUrl(koordinaten.latitude, koordinaten.longitude, sprache), { headers: { Accept: "application/json" }, signal });
  } catch {
    const e = new Error("netz");
    e.code = "netz";
    throw e;
  }
  if (!antwort.ok) {
    const e = new Error("dienst");
    e.code = "dienst";
    throw e;
  }
  const treffer = adresseAusAntwort(await antwort.json().catch(() => null));
  if (!treffer) {
    const e = new Error("nichts");
    e.code = "nichts";
    throw e;
  }
  return treffer;
}
