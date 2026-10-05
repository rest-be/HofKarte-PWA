# vendor/

Drittanbieter-Bibliotheken, bewusst direkt im Repo statt per CDN geladen
(Phase 10): kein Fremd-Code mit Zugriff auf das Token, keine Abhängigkeit
von einem CDN beim Offline-Start, Updates nur durch bewusstes Ändern hier.
Der Service Worker legt alle Dateien in den App-Shell-Cache.

| Bibliothek | Version | Herkunft | Lizenz |
|---|---|---|---|
| home-assistant-js-websocket | 9.7.0 | npm, `dist/*.js` (ES-Module, unverändert) | Apache-2.0 |
| Leaflet | 1.9.4 | npm, `dist/leaflet.js`, `leaflet.css`, `images/` (unverändert) | BSD-2-Clause |

Aktualisieren: neue Version per `npm pack` holen, die Dateien ersetzen,
Version hier und in `service-worker.js` (`CACHE_VERSION`) anpassen.
