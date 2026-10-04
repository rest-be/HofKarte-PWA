/**
 * Service Worker für die HofKarte-PWA.
 *
 * Zwei Strategien, je nach Anfrage (siehe Vorgehensplan Phase 4,
 * Schritt 32):
 *
 * - App-Shell (HTML/CSS/JS/Icons dieses Repos, inkl. der über CDN
 *   geladenen Drittbibliotheken wie home-assistant-js-websocket und
 *   Leaflet): "Cache-first" – einmal geladen, funktioniert die App
 *   auch offline, Updates kommen erst beim nächsten Deploy (neue
 *   CACHE_VERSION) zum Tragen.
 * - Home-Assistant-WebSocket-Verbindung selbst: läuft **nicht** über
 *   den Service Worker (WebSocket-Verbindungen werden von Service
 *   Workern nicht abgefangen) – die "Stale-while-revalidate"-Logik für
 *   Hofladen-Daten lebt daher in src/ha-client.js (Anzeige des zuletzt
 *   bekannten Stands aus dem Cache, während im Hintergrund neu
 *   geladen wird), nicht hier.
 *
 * Es werden bewusst **keine** Zugangsdaten (HA-Adresse, Long-Lived
 * Access Token) über den Service Worker oder den Cache gespeichert –
 * diese liegen ausschliesslich in IndexedDB (siehe src/storage.js).
 */

const CACHE_VERSION = "hofkarte-pwa-v6";

const APP_SHELL_DATEIEN = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/styles.css",
  "./src/app.js",
  "./src/version.js",
  "./src/storage.js",
  "./src/sync-worker.js",
  "./src/ha-client.js",
  "./src/naehe.js",
  "./src/views/setup.js",
  "./src/views/list.js",
  "./src/views/detail.js",
  "./src/views/editor.js",
  "./src/views/einstellungen.js",
  "./src/views/map.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_DATEIEN))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((namen) =>
        Promise.all(
          namen
            .filter((name) => name !== CACHE_VERSION)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nur GET-Anfragen behandeln (WebSocket-Upgrades/andere Methoden
  // unverändert durchlassen).
  if (event.request.method !== "GET") {
    return;
  }

  // Anfragen an die Home-Assistant-Instanz selbst (REST-Fallbacks,
  // Bilder aus image_upload) nie aus dem App-Shell-Cache bedienen –
  // das sind live Daten, keine App-Shell-Dateien.
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((gecached) => {
      if (gecached) {
        return gecached;
      }
      return fetch(event.request).then((antwort) => {
        // Nur erfolgreiche, gleich-originäre Antworten zusätzlich
        // cachen (z. B. neu hinzugekommene Chunk-Dateien).
        if (antwort && antwort.status === 200) {
          const kopie = antwort.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, kopie));
        }
        return antwort;
      });
    })
  );
});
