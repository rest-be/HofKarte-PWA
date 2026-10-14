/**
 * Service Worker für die HofKarte-PWA.
 *
 * Zwei Strategien, je nach Anfrage (siehe Vorgehensplan Phase 4,
 * Schritt 32):
 *
 * - App-Shell (HTML/CSS/JS/Icons dieses Repos, inkl. der lokal unter
 *   vendor/ liegenden Drittbibliotheken home-assistant-js-websocket und
 *   Leaflet - seit Phase 10 kein CDN mehr): "Cache-first" – einmal geladen, funktioniert die App
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

const CACHE_VERSION = "hofkarte-pwa-v15";

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
  "./src/finden.js",
  "./src/html.js",
  "./src/bilder.js",
  "./src/views/setup.js",
  "./src/views/list.js",
  "./src/views/detail.js",
  "./src/views/konflikt.js",
  "./src/views/editor.js",
  "./src/views/einstellungen.js",
  "./src/views/finden.js",
  "./src/views/map.js",
  // Drittbibliotheken (lokal, siehe vendor/README.md)
  "./vendor/home-assistant-js-websocket/auth.js",
  "./vendor/home-assistant-js-websocket/collection.js",
  "./vendor/home-assistant-js-websocket/commands.js",
  "./vendor/home-assistant-js-websocket/config.js",
  "./vendor/home-assistant-js-websocket/connection.js",
  "./vendor/home-assistant-js-websocket/entities.js",
  "./vendor/home-assistant-js-websocket/errors.js",
  "./vendor/home-assistant-js-websocket/index.js",
  "./vendor/home-assistant-js-websocket/messages.js",
  "./vendor/home-assistant-js-websocket/services.js",
  "./vendor/home-assistant-js-websocket/socket.js",
  "./vendor/home-assistant-js-websocket/store.js",
  "./vendor/home-assistant-js-websocket/types.js",
  "./vendor/home-assistant-js-websocket/util.js",
  "./vendor/leaflet/images/layers-2x.png",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./icons/icon-192.png",
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

  // Nur die App-Shell wird aus dem Cache bedient. Alles andere (auch
  // unbekannte Same-Origin-Pfade) geht unverändert ans Netz und wird nicht
  // zusätzlich gespeichert - der Cache wächst so nicht unkontrolliert.
  // `ignoreSearch`: "index.html?debug=1" o. ä. trifft trotzdem den Eintrag.
  event.respondWith(
    caches
      .match(event.request, { ignoreSearch: true })
      .then((gecached) => gecached || fetch(event.request))
  );
});
