/**
 * Aktualisierung der App (ab 2.0.0-dev.4).
 *
 * Installierte PWAs laden neue Versionen nicht von selbst nach: Der Service
 * Worker liefert die App aus dem Cache, bis er selbst erneuert wird, und die
 * geöffnete Seite läuft mit dem alten Code weiter. Dieses Modul
 * - sucht beim Start, beim Zurückkehren in die App und stündlich nach einer
 *   neuen Version,
 * - meldet über `onUpdateBereit`, wenn eine neue Version installiert ist
 *   (die App zeigt dann „Neue Version verfügbar – Jetzt aktualisieren“; neu
 *   geladen wird erst auf Tipp, damit keine Eingaben verloren gehen),
 * - bietet in den Einstellungen „Nach Update suchen“ und als Notlösung
 *   „App zurücksetzen“ (Zwischenspeicher leeren, Anmeldedaten bleiben).
 *
 * Zugangsdaten und Einstellungen liegen in IndexedDB und werden hier nie
 * angetastet.
 */

import { APP_VERSION } from "./version.js";
import { t } from "./i18n.js";

const STUENDLICH_MS = 60 * 60 * 1000;

/** Liest APP_VERSION aus dem Text von version.js; `null`, wenn nicht gefunden. */
export function versionAusText(text) {
  const treffer = /APP_VERSION\s*=\s*"([^"]+)"/.exec(String(text));
  return treffer ? treffer[1] : null;
}

function teile(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(dev|rc)\.(\d+))?$/.exec(String(version).trim());
  if (!m) return null;
  // dev < rc < Endversion
  const stufe = m[4] === "dev" ? 0 : m[4] === "rc" ? 1 : 2;
  return [Number(m[1]), Number(m[2]), Number(m[3]), stufe, Number(m[5] || 0)];
}

/** `-1`, `0` oder `1` wie bei einem Vergleich; unbekannte Schreibweisen gelten als gleich (0). */
export function vergleicheVersionen(a, b) {
  const x = teile(a);
  const y = teile(b);
  if (!x || !y) return 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

async function registrierung() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) || null;
  } catch {
    return null;
  }
}

/** Fragt beim Server nach der neuesten Version (am Service Worker vorbei, nie aus dem Cache). */
export async function neuesteVersion() {
  const antwort = await fetch(`src/version.js?nocache=${Date.now()}`, { cache: "no-store" });
  if (!antwort.ok) throw new Error(t("Version konnte nicht abgefragt werden."));
  return versionAusText(await antwort.text());
}

/**
 * Vergleicht die laufende mit der neuesten Version:
 * `{ installiert, neueste, verfuegbar }`. Wirft einen Fehler, wenn der Server nicht erreichbar ist.
 */
export async function pruefeAufUpdate() {
  const neueste = await neuesteVersion();
  return {
    installiert: APP_VERSION,
    neueste,
    verfuegbar: !!neueste && vergleicheVersionen(APP_VERSION, neueste) < 0,
  };
}

/**
 * Richtet die automatische Suche ein. `onUpdateBereit` wird aufgerufen, sobald
 * eine neue Version installiert ist und die Seite neu geladen werden sollte.
 */
export function initialisiereUpdates(onUpdateBereit) {
  if (!("serviceWorker" in navigator)) return;
  const hatteSteuerung = !!navigator.serviceWorker.controller;
  let gemeldet = false;
  const melden = () => {
    if (gemeldet) return;
    gemeldet = true;
    onUpdateBereit();
  };

  // Ein neuer Service Worker übernimmt (skipWaiting + claim): die Seite läuft noch mit altem Code.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hatteSteuerung) melden();
  });

  const suchen = async () => {
    const reg = await registrierung();
    try {
      await reg?.update();
    } catch {
      // Offline o. Ä.: beim nächsten Mal wieder.
    }
  };

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("service-worker.js")
      .then(() => suchen())
      .catch((err) => console.error("Service Worker Registrierung fehlgeschlagen:", err));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") suchen();
  });
  setInterval(suchen, STUENDLICH_MS);
}

/**
 * „Nach Update suchen“: lässt den Service Worker neu laden und lädt die Seite
 * neu, sobald die neue Version bereit ist. Liefert `"aktuell"` oder `"geladen"`
 * (die Seite wird dann neu geladen).
 */
export async function aktualisiereJetzt() {
  const stand = await pruefeAufUpdate();
  if (!stand.verfuegbar) return "aktuell";
  const reg = await registrierung();
  if (reg) {
    await reg.update();
    const worker = reg.installing || reg.waiting;
    if (worker && worker.state !== "activated") {
      await new Promise((resolve) => {
        const fertig = () => {
          if (worker.state === "activated") resolve();
        };
        worker.addEventListener("statechange", fertig);
        setTimeout(resolve, 15000);
        fertig();
      });
    }
  }
  window.location.reload();
  return "geladen";
}

/**
 * Notlösung: Service Worker abmelden und alle App-Zwischenspeicher löschen,
 * danach neu laden. Anmeldedaten, Einstellungen und die Warteschlange (IndexedDB) bleiben erhalten.
 */
export async function appZuruecksetzen() {
  const reg = await registrierung();
  try {
    await reg?.unregister();
  } catch {
    // weiter
  }
  if ("caches" in window) {
    const namen = await caches.keys();
    await Promise.all(namen.map((n) => caches.delete(n)));
  }
  window.location.reload();
}

/** Zeigt den Hinweis „Neue Version verfügbar“ (einmalig) am oberen Rand. */
export function zeigeUpdateHinweis() {
  if (document.getElementById("update-hinweis")) return;
  const box = document.createElement("div");
  box.id = "update-hinweis";
  box.className = "update-hinweis";
  box.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = t("Neue Version verfügbar.");
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.id = "update-jetzt-btn";
  knopf.textContent = t("Jetzt aktualisieren");
  knopf.addEventListener("click", () => window.location.reload());
  const zu = document.createElement("button");
  zu.type = "button";
  zu.className = "update-spaeter";
  zu.setAttribute("aria-label", t("Später"));
  zu.textContent = t("Später");
  zu.addEventListener("click", () => box.remove());
  box.append(text, knopf, zu);
  document.body.appendChild(box);
}
