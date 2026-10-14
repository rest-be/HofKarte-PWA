# GUI-Überarbeitung 2.0.0 – Inventar und Ausgangslage (Phase 0)

Stand: 2026-10-14, Ausgangsversion 1.12.0 (Branch `feature/gui-2.0`).

## Ausgangslage Tests
- Smoke-Tests vor Beginn: **108 bestanden, 0 fehlgeschlagen**.
- Nach Phase 1 (2.0.0-dev.1): **117 bestanden, 0 fehlgeschlagen** (9 neue Prüfungen zu Markenfarbe, Kontrast und Symbolen; 1 angepasst: Einstellungen-Reihenfolge, Versionsmuster).
- Die Tests prüfen Selektoren (`#f-name`, `.farb-wahl`, `details.naehe-karte`, `#oeffnungszeiten-abschnitt` …); diese bleiben in den Phasen 2–8 stabil, bei Änderung wird der Test im selben Schritt angepasst.

## Betroffene Dateien (Überblick)
| Bereich | Dateien |
|---|---|
| Gestaltung | `src/styles.css`, `index.html`, `manifest.json` |
| Neu in Phase 1 | `src/icons.js`, `src/design.js`, `storage.js` (Markenfarbe) |
| Ansichten | `views/detail.js`, `editor.js`, `finden.js`, `list.js`, `konflikt.js`, `einstellungen.js` |
| Kern | `app.js`, `version.js`, `service-worker.js` |

## Prüfpunkte (offen, vor der jeweiligen Phase zu klären)
1. **Foto ohne Netz** – Empfehlung: Foto später ergänzen, mit Hinweis „Foto später ergänzen“ (Upload läuft über die HA-Verbindung). Entscheidung vor Phase 4 (Schnellerfassung).
2. **iPhone im Standalone-Modus** – Verhalten von Standortfreigabe und Kamera-Auswahl auf einem echten Gerät prüfen (Phase 3/4).
3. **`status_wechsel` in der Listenantwort** – serverseitig vorhanden; Nutzung in der Liste (Phase 2) klären.

## Abweichungen vom Plan
- Komponenten (Chips, Gruppen-Kopf usw.) werden erst eingeführt, wenn die erste Ansicht sie braucht, nicht vorab auf Vorrat.
- Dunkle Fläche neu `#181f1b` (statt iOS-Grau), damit die Kontrastberechnung der Markenfarbe zu den echten Flächen passt.
