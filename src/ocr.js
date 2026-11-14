/**
 * OCR im Browser (2.1.0): Text aus einem Foto lesen, ohne KI und ohne
 * Server. Grundlage für «Schild fotografieren» (Phase 4).
 *
 * Verwendet tesseract.js (vendor/tesseract/) mit WebAssembly. Alles liegt
 * lokal im Repository (kein CDN): Worker, Rechenkern (vendor/tesseract-core/)
 * und Sprachdaten (vendor/tesseract-lang/). Die Bibliothek und die rund
 * 4 MB Rechenkern werden erst beim ersten Gebrauch geladen; der Service
 * Worker legt sie dann in einen eigenen Cache, damit die Erkennung auch
 * offline läuft (siehe service-worker.js, OCR_CACHE).
 *
 * Das Foto verlässt das Gerät nie. Die Erkennung läuft in einem Web Worker
 * und lässt sich abbrechen (der Worker wird dann beendet).
 */

export const OCR_SPRACHEN = ["deu", "fra", "ita", "eng"];

const PFAD = {
  skript: "./vendor/tesseract/tesseract.min.js",
  worker: "./vendor/tesseract/worker.min.js",
  kern: "./vendor/tesseract-core",
  sprachen: "./vendor/tesseract-lang",
};

let ladeVersprechen = null;

/** Läuft die Erkennung in diesem Browser (Web Worker und WebAssembly)? */
export function ocrVerfuegbar() {
  return typeof Worker === "function" && typeof WebAssembly === "object";
}

/** Lädt tesseract.min.js einmalig (als normales Skript, passend zur CSP `script-src 'self'`). */
function ladeBibliothek() {
  if (typeof window.Tesseract !== "undefined") return Promise.resolve(window.Tesseract);
  if (!ladeVersprechen) {
    ladeVersprechen = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PFAD.skript;
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR-Bibliothek nicht verfügbar")));
      s.onerror = () => reject(new Error("OCR-Bibliothek konnte nicht geladen werden"));
      document.head.appendChild(s);
    }).catch((e) => {
      ladeVersprechen = null; // nächster Versuch darf neu laden
      throw e;
    });
  }
  return ladeVersprechen;
}

/**
 * Liest den Text eines Bildes.
 *
 * @param {Blob|File|HTMLCanvasElement|string} bild  Foto (Blob/Datei, Canvas oder data:-URL)
 * @param {object} [optionen]
 * @param {string[]} [optionen.sprachen]  Teilmenge von OCR_SPRACHEN, Standard: deu
 * @param {(f: {status: string, anteil: number}) => void} [optionen.onFortschritt]  anteil 0…1
 * @param {AbortSignal} [optionen.signal]  bricht ab und beendet den Worker
 * @returns {Promise<{text: string, vertrauen: number}>}  vertrauen 0…100
 */
export async function erkenneText(bild, { sprachen = ["deu"], onFortschritt, signal } = {}) {
  if (!ocrVerfuegbar()) throw new Error("OCR wird in diesem Browser nicht unterstützt");
  const gewaehlt = sprachen.filter((s) => OCR_SPRACHEN.includes(s));
  if (!gewaehlt.length) throw new Error("Keine gültige Sprache gewählt");
  if (signal?.aborted) throw abbruch();

  const Tesseract = await ladeBibliothek();
  if (signal?.aborted) throw abbruch();

  let worker = null;
  const beenden = () => worker?.terminate().catch(() => {});
  const aufAbbruch = () => beenden();
  signal?.addEventListener("abort", aufAbbruch, { once: true });
  try {
    worker = await Tesseract.createWorker(gewaehlt.join("+"), 1 /* nur LSTM */, {
      workerPath: PFAD.worker,
      corePath: PFAD.kern,
      langPath: PFAD.sprachen,
      workerBlobURL: false, // kein blob:-Worker, damit `worker-src 'self'` genügt
      gzip: true,
      cacheMethod: "none", // zwischengespeichert wird vom Service Worker
      logger: (m) => {
        if (onFortschritt && typeof m.progress === "number") onFortschritt({ status: String(m.status || ""), anteil: m.progress });
      },
    });
    if (signal?.aborted) throw abbruch();
    const { data } = await worker.recognize(bild);
    if (signal?.aborted) throw abbruch();
    return { text: String(data.text || ""), vertrauen: Number(data.confidence) || 0 };
  } catch (e) {
    if (signal?.aborted) throw abbruch();
    throw e;
  } finally {
    signal?.removeEventListener("abort", aufAbbruch);
    await beenden();
  }
}

function abbruch() {
  const e = new Error("Abgebrochen");
  e.name = "AbortError";
  return e;
}
