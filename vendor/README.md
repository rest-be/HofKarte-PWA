# vendor/

Drittanbieter-Bibliotheken, bewusst direkt im Repo statt per CDN geladen
(Phase 10): kein Fremd-Code mit Zugriff auf das Token, keine Abhängigkeit
von einem CDN beim Offline-Start, Updates nur durch bewusstes Ändern hier.
Der Service Worker legt alle Dateien in den App-Shell-Cache.

| Bibliothek | Version | Herkunft | Lizenz |
|---|---|---|---|
| home-assistant-js-websocket | 9.7.0 | npm, `dist/*.js` (ES-Module, unverändert) | Apache-2.0 |
| Leaflet | 1.9.4 | npm, `dist/leaflet.js`, `leaflet.css`, `images/` (unverändert) | BSD-2-Clause |

| tesseract.js | 7.0.0 | npm, `dist/tesseract.min.js`, `worker.min.js` (unverändert) → `vendor/tesseract/` | Apache-2.0 |
| tesseract.js-core | 7.0.0 | npm, nur `tesseract-core-lstm.wasm.js`, `…-simd-lstm.wasm.js`, `…-relaxedsimd-lstm.wasm.js` (je ca. 3,9 MB, geladen wird nur eine) → `vendor/tesseract-core/` | Apache-2.0 |
| Sprachdaten (tessdata_best, 8 Bit) | 4.0.0 | npm `@tesseract.js-data/{deu,fra,ita,eng}`, `4.0.0_best_int/*.traineddata.gz` → `vendor/tesseract-lang/` | Apache-2.0 |

Die OCR-Dateien (ca. 18 MB im Repository) gehören **nicht** zum App-Shell-Cache:
Der Service Worker lädt sie erst bei der ersten Texterkennung in den eigenen
Cache `hofkarte-ocr-v1` (`OCR_CACHE` in `service-worker.js`). Auf dem Gerät
werden nur Bibliothek, ein Rechenkern und die gewählte Sprache geladen
(rund 6 MB). Die Standardadressen auf jsdelivr in `tesseract.min.js` werden
nie benutzt, `src/ocr.js` setzt alle Pfade; ein Test prüft, dass keine Anfrage
das Gerät verlässt.

Aktualisieren: neue Version per `npm pack` holen, die Dateien ersetzen,
Version hier und in `service-worker.js` (`CACHE_VERSION`, bei OCR-Dateien auch `OCR_CACHE`) anpassen.
