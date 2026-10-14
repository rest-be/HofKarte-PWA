/**
 * Bild-Hilfen (Phase 10, Code-Review P4/P5): Vorschaubilder statt
 * Originale laden und Fotos vor dem Upload verkleinern.
 */

const SERVE_PFAD = /(\/api\/image\/serve\/[^/]+\/)original(?=$|[?#])/;

/**
 * Für von Home Assistant ausgelieferte Bilder (`image_upload`) die
 * skalierte Variante anfordern (`…/256x256`; HA erlaubt nur 256 und 512).
 * Alle anderen URLs (externe Bilder) bleiben unverändert.
 */
export function vorschauUrl(url, groesse = 256) {
  if (typeof url !== "string") return url;
  const kante = groesse > 256 ? 512 : 256;
  return url.replace(SERVE_PFAD, `$1${kante}x${kante}`);
}

/** Längste Kante und Qualität für hochgeladene Fotos. */
export const MAX_KANTE_PX = 1600;
export const JPEG_QUALITAET = 0.82;
/** Dateien unterhalb dieser Grösse (und Abmessung) werden nicht angefasst. */
const UNVERAENDERT_BIS_BYTES = 400 * 1024;

/**
 * Verkleinert ein Foto auf höchstens MAX_KANTE_PX Kantenlänge (JPEG/PNG).
 * GIFs (Animation) und Dateien, die bereits klein genug sind, bleiben
 * unverändert. Bei jedem Fehler (kein Canvas, nicht dekodierbar) wird die
 * Originaldatei zurückgegeben - der Upload darf daran nie scheitern.
 * Die EXIF-Ausrichtung wird beim Dekodieren angewendet.
 */
export async function bildVerkleinern(datei, { maxKante = MAX_KANTE_PX, qualitaet = JPEG_QUALITAET } = {}) {
  try {
    if (!datei || !/^image\/(jpeg|png)$/.test(datei.type)) return datei;
    const bitmap = await createImageBitmap(datei, { imageOrientation: "from-image" });
    const groesste = Math.max(bitmap.width, bitmap.height);
    if (groesste <= maxKante && datei.size <= UNVERAENDERT_BIS_BYTES) {
      bitmap.close?.();
      return datei;
    }
    const faktor = Math.min(1, maxKante / groesste);
    const breite = Math.max(1, Math.round(bitmap.width * faktor));
    const hoehe = Math.max(1, Math.round(bitmap.height * faktor));
    const canvas = document.createElement("canvas");
    canvas.width = breite;
    canvas.height = hoehe;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, breite, hoehe);
    bitmap.close?.();
    const typ = datei.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, typ, qualitaet));
    if (!blob || blob.size >= datei.size) return datei;
    const endung = typ === "image/png" ? "png" : "jpg";
    const name = (datei.name || "foto").replace(/\.[^.]+$/, "") + "." + endung;
    return new File([blob], name, { type: typ, lastModified: Date.now() });
  } catch {
    return datei;
  }
}
