# HofKarte-PWA 2.0.0 – Überarbeitung der Oberfläche
## Umsetzungsplan

Stand: 2026-10-14 · Basis: `feature/discovery-pwa` (1.12.0) · Branch: `feature/gui-2.0`
Entwurf: Artifact «HofKarte PWA – Entwurf» (klickbar, 10 Tafeln) · Vorbild: Umsetzungsplan der HA-Integration (`HofKarte-HA/docs/detail-erfassung-umsetzungsplan.md`)

## 1. Ziel und Entscheide

**Ziel:** Erscheinung modernisieren, Bedienung intuitiv machen. Detail und Bearbeiten gleich gruppiert wie im HA-Panel. Erfassen vor Ort so schnell wie möglich; Hofläden finden mit dem aktuellen Standort, aber nur auf ausdrücklichen Tipp. Liste und Karte bleiben im Kern, mit kleinen Optimierungen.

**Entschieden (2026-10-14)**
1. **Markenfarbe:** Grün ist der Standard. Zusätzlich wählt der Benutzer in den Einstellungen eine eigene Markenfarbe (Voreinstellungen und freie Farbe, pro Gerät).
2. **Tab «Erfassen»:** Der Tab heisst neu «Erfassen» und zeigt eine Einstiegsseite mit drei Wegen (vor Ort, Webseite, von Hand).
3. **Offene Gruppen mobil:** Detail: Öffnungszeiten und Angebote offen. Bearbeiten: Grunddaten, Adresse, Angebote offen. Der Rest ist eingeklappt, mit Kurzinfo und Vollständigkeitspunkt.
4. **Version:** Endstand `2.0.0`. Zwischenstände heissen `2.0.0-dev.N` (eine Nummer pro Phase), danach `2.0.0-rc.N`.

**Leitplanken (unverändert aus den bisherigen Phasen)**
- Bundlerfrei: reine ES-Module, keine neuen Abhängigkeiten, keine CDN-Aufrufe (Drittcode liegt unter `vendor/`).
- CSP bleibt `style-src 'self'`: keine Inline-Styles im Markup. Laufzeitwerte wie die Markenfarbe werden per CSSOM gesetzt (`documentElement.style.setProperty`, wie bei `--kopf-h`).
- Standort nur auf ausdrücklichen Tipp, nie gespeichert. Gerätestandort wird nur für die Suche an die eigene HA-Instanz gesendet.
- Nichts wird ohne ausdrückliche Wahl überschrieben. Lücken vorgewählt, Abweichungen nie, Listen werden ergänzt statt ersetzt. KI nie vorausgewählt, KI-Vermutungen getrennt und nie vorgewählt.
- Gespeichert wird nur im Editor. Offline-Warteschlange, Versionskonflikte und das Datenmodell bleiben unverändert.
- Escaping (`escapeHtml`, `sichereHttpUrl`); Touch-Ziele ≥ 44 px; Status nie nur über Farbe; `prefers-reduced-motion`; Hell/Dunkel.
- Pro Phase: Smoke-Tests grün (Baseline 108), `APP_VERSION` und `CACHE_VERSION` (Service Worker) erhöht, README/Release Notes nachgezogen, ZIP an Reto.

## 2. Zielbild

**Navigation:** Tabs `Hofläden · Karte · Erfassen`. Einstellungen über das Symbol oben rechts.

**Gemeinsame Gruppen (Detail und Bearbeiten, gleiche Reihenfolge wie im HA-Panel)**

| # | Gruppe | Inhalt | Mobil offen (Detail / Bearbeiten) |
|---|---|---|---|
| 1 | Grunddaten | Name, Beschreibung, Bewertung, interne Bemerkung | zu / offen |
| 2 | Adresse & Standort | Adresse, PLZ/Ort, Koordinaten, «Aktuellen Standort übernehmen» | zu / offen |
| 3 | Kontakt & Webseite | Telefon, E-Mail, Webseite | zu / zu |
| 4 | Öffnungszeiten | Wochentage, Sonderzeiten; Detail: «heute» hervorgehoben | offen / zu |
| 5 | Angebote & Zahlungsarten | Detail: Pillen; Bearbeiten: Chips, Zahlungsarten als Schalter | offen / offen |
| 6 | Bilder | Hauptbild, Aufnahme, Auswahl, externe Adresse | zu / zu |
| 7 | Herkunft der Angaben | Quellentabelle, OSM-Hinweis (ODbL), im Editor nur lesend | zu / zu |

Jede Gruppe: Titel, Kurzinfo im eingeklappten Zustand, Vollständigkeitspunkt (voll, halb, leer, immer mit Text für Screenreader), «Alle ausklappen». Zustand pro Sitzung.

**Detail:** Foto-Kopf, Name, Status («Offen bis 18:30»), Sterne, Entfernung (nur wenn ein Standort vorliegt), Schnellaktionen Route · Anrufen · Webseite · E-Mail, Hinweis «Noch unvollständig … Jetzt ergänzen». ⋮-Menü: Bearbeiten, Angaben ergänzen, Löschen (mit Bestätigung).
**Bearbeiten:** Leiste «Angaben automatisch ergänzen» (Webseite, OpenStreetMap), dieselben Gruppen, feste Fussleiste «Ungespeichert · Abbrechen · Speichern», Abbrechen mit Rückfrage bei Änderungen.
**Erfassen:** Einstieg mit drei Wegen. Vor Ort: Standort auf Tipp, Umkreis 100/250/500 m, «Schon erfasst» zuoberst, neue Treffer aus OpenStreetMap, dann Schnellerfassung (Name, Standort, Foto, Webseite) und «Noch offen». Webseite: Link, Auslesen, Prüfen. Von Hand: leeres Formular. Der bisherige Suchdialog bleibt als «Erweiterte Suche».
**Liste:** Filter-Chips (In der Nähe, Geöffnet, Unvollständig, Sortierung), Entfernung nach Tipp auf «In der Nähe».
**Karte:** Marker-Tipp öffnet eine Vorschau (Route, Details), Knopf «Mein Standort» (auf Tipp), Marker mit Form statt nur Farbe.
**Einstellungen:** neue Gruppe «Darstellung» mit der Markenfarbe.

**Routen (Hash-Router)**
`#/erfassen`, `#/erfassen/vorort`, `#/erfassen/schnell`, `#/erfassen/gespeichert/<id>`, `#/erfassen/webseite`, `#/hofladen/<id>/ergaenzen`. Bestehend bleiben: `#/`, `#/karte`, `#/hofladen/<id>`, `#/hofladen/<id>/bearbeiten`, `#/neu` (Von Hand), `#/finden` (Erweiterte Suche), `#/einstellungen`, `#/konflikt/<id>`.

## 3. Technische Entscheide

1. **Neue Module:** `src/gruppen.js` (Gruppenmodell `HOF_GRUPPEN`, `vollstaendigkeit()`, Kurzinfos; ohne DOM, testbar), `src/icons.js` (Inline-SVG statt Emojis), `src/design.js` (Markenfarbe), `src/views/erfassen.js` (Einstieg, Vor Ort, Schnell, Gespeichert), `src/views/ergaenzen.js`. Bestehende Module bleiben.
2. **Markenfarbe:** Voreinstellungen Grün (Standard), Blau, Karotte, Violett, Graphit sowie freie Farbe (`<input type="color">`). `design.js` berechnet aus der gewählten Farbe `--tint` (bzw. `--accent`), `--accent-deep`, `--accent-soft` und die Schriftfarbe darauf (hell oder dunkel, damit mindestens 4,5:1 erreicht wird); im Dunkelmodus wird der Ton aufgehellt. Gespeichert in IndexedDB über `storage.js` (`ladeMarkenfarbe`/`speichereMarkenfarbe`), angewendet vor dem ersten Rendern (kein Aufblitzen). «Zurücksetzen» stellt Grün her.
3. **Stylesheet:** bleibt eine Datei `src/styles.css`, neu nach Tokens und Bausteinen geordnet (Chip, Pille, Karte, Gruppe, Fussleiste, Sheet). Klassennamen und `data-`/`id`-Selektoren der Smoke-Tests bleiben, wo möglich; absichtliche Änderungen werden in der Phase mit dem Test angepasst und im Changelog vermerkt.
4. **«Offen bis …»:** aus dem Serverfeld `status_wechsel` (HofKarte-HA ab 2026.10.1); fehlt das Feld, bleibt «Geöffnet/Geschlossen».
5. **Standort:** `aktuellerStandort()` aus `naehe.js` bleibt die einzige Stelle mit Geolocation. Neue Aufrufer: Liste («In der Nähe»), Karte («Mein Standort»), Erfassen (Vor Ort), Editor (Standort übernehmen), jeweils nur auf Tipp.
6. **Foto ohne Netz (offen):** Die Warteschlange kennt heute keine Fotos (Upload nur online). Für die Schnellerfassung ohne Empfang gibt es zwei Wege: Foto erst nach der Verbindung ergänzen (einfach), oder das Foto als Blob in der Warteschlange ablegen (mehr Aufwand). Empfehlung: zuerst der einfache Weg mit klarem Hinweis «Foto später ergänzen»; Entscheid in Phase 0.
7. **Branch und Versionen:** `feature/gui-2.0` ab `feature/discovery-pwa`. Jede Phase erhöht `APP_VERSION` auf `2.0.0-dev.N`, ergänzt `RELEASE_NOTES` und erhöht `CACHE_VERSION`.
8. **Tests:** Playwright-Smoke-Tests wachsen mit; neue Abläufe mit dem Stub (Geolocation, Netz) wie bei «Hofladen finden». Baseline: 108 bestanden.

## 4. Phasen

### Phase 0 – Vorbereitung (0,5 Tag)
- Branch anlegen, Baseline dokumentieren (108 grün).
- Inventar: alle Selektoren und Texte aus `tests/smoke-test.js` zu Liste, Detail, Editor, Finden, Karte, Einstellungen (`docs/gui-inventar.md`).
- Prüfpunkte: Verhalten von Standort und Kamera als Home-Bildschirm-App auf dem iPhone, Foto ohne Netz (Entscheid 6), `status_wechsel` in der Listenantwort.
- **Ergebnis:** Inventar und bestätigte Entscheide.

### Phase 1 – Design-Grundlagen und Markenfarbe (1 Tag) → 2.0.0-dev.1
- Tokens (Grün), Hell/Dunkel, `icons.js`, Bausteine (Chip, Pille mit Form, Karte, Fussleiste, Sheet).
- `design.js`, Einstellungen «Darstellung» mit Farbwahl, Kontrastprüfung, Zurücksetzen, Speicherung pro Gerät.
- Bestehende Ansichten übernehmen die neuen Tokens und Symbole (noch ohne Umbau).
- Tests: Standardfarbe, Wechsel, Persistenz, Kontrastregel, Zurücksetzen.

### Phase 2 – Gruppenmodell und Detail (1,5 Tage) → 2.0.0-dev.2
- `gruppen.js` mit Vollständigkeit und Kurzinfos; Akkordeon mit `aria-expanded`, Tastatur, «Alle ausklappen».
- Detail neu: Kopf, Schnellaktionen (`tel:`, `mailto:`, nur http(s), Route), Hinweis «Noch unvollständig», ⋮-Menü, Löschen mit Bestätigung.
- Tests: Gruppen, Standard offen/zu, Schnellaktionen, Escaping, Konflikt- und Sync-Hinweise bleiben.

### Phase 3 – Bearbeiten (2 Tage) → 2.0.0-dev.3
- Editor mit denselben Gruppen; Chips für Angebote, Schalter für Zahlungsarten; Wochentage-Editor mit «Auf Mo–Fr kopieren»; Sterne mit Zurücksetzen.
- Fussleiste mit Ungespeichert-Anzeige, Abbrechen mit Rückfrage; Fokus auf das erste fehlerhafte Feld.
- Tests: Roundtrip (gleiches Payload wie vor dem Umbau), Chips, Zeiten kopieren, Abbrechen-Rückfrage, Offline-Speichern.

### Phase 4 – Erfassen: Einstieg, vor Ort, gespeichert (2 Tage) → 2.0.0-dev.4
- Tab «Erfassen» mit Einstiegsseite; Duplikatprüfung vor dem Speichern.
- Vor Ort: Standort auf Tipp, Umkreis-Chips, «Schon erfasst», Treffer aus OpenStreetMap (`hofladenSuchen`), «Keiner davon».
- Schnellerfassung (Name Pflicht, Standort, Foto, Webseite), danach «Noch offen» mit Sprung in den Editor oder zum Auslesen.
- Tests: Stub für Geolocation und Netz, Standort verweigert, keine Treffer, Duplikatwarnung, Pflichtfeld.

### Phase 5 – Webseite prüfen und Angaben ergänzen (1,5 Tage) → 2.0.0-dev.5
- Weg «Webseite» mit Schritten Webseite → Auslesen → Prüfen; Wiederverwendung von `finden.js` (`baueEntwurf`, Quellen, Abweichungen).
- «Angaben ergänzen» für Bestehendes: Vergleich Aktuell · Gefunden · Status, Lücken vorgewählt, Abweichungen nie, Listen ergänzt; Übernahme öffnet den Editor.
- «Erweiterte Suche» bleibt (`#/finden`).
- Tests: Vorauswahl, nichts überschrieben ohne Wahl, KI-Vermutungen nie vorgewählt, Übernahme in den Editor.

### Phase 6 – Liste und Karte (1 Tag) → 2.0.0-dev.6
- Liste: Filter-Chips, Entfernung nach Tipp, Status mit Form und Text.
- Karte: Vorschau-Sheet, «Mein Standort», Marker mit Form, Filter «Nur geöffnet».
- Tests: Filter, Sortierung nach Entfernung, Sheet, Escaping.

### Phase 7 – Zugänglichkeit, Geräte-Test, Doku (1 Tag) → 2.0.0-dev.7
- Tastatur, Fokusführung bei Schrittwechseln, VoiceOver-Beschriftungen, Kontraste in beiden Modi, `prefers-reduced-motion`.
- Test auf iPhone (Home-Bildschirm-App) und Mac; Cache-Hinweis.
- README, `RELEASE_NOTES`, Aufräumen nicht mehr genutzter Teile.

### Phase 8 – Release (später)
- `2.0.0-rc.1` zum Testen, danach `2.0.0`. Tag und Merge nach `main` durch Reto (Push aus dieser Umgebung ist nicht möglich).

## 5. Aufwand und Reihenfolge

| Phase | Inhalt | Aufwand | Version |
|---|---|---|---|
| 0 | Vorbereitung, Inventar | 0,5 T | – |
| 1 | Design-Grundlagen, Markenfarbe | 1 T | 2.0.0-dev.1 |
| 2 | Gruppenmodell, Detail | 1,5 T | 2.0.0-dev.2 |
| 3 | Bearbeiten | 2 T | 2.0.0-dev.3 |
| 4 | Erfassen vor Ort | 2 T | 2.0.0-dev.4 |
| 5 | Webseite, Ergänzen | 1,5 T | 2.0.0-dev.5 |
| 6 | Liste, Karte | 1 T | 2.0.0-dev.6 |
| 7 | Zugänglichkeit, Test, Doku | 1 T | 2.0.0-dev.7 |
| 8 | Release | – | 2.0.0-rc.1, 2.0.0 |

Zwischenstände sind lauffähig. Nach jeder Phase ZIP und Statustabelle; Abnahme durch Reto vor der nächsten. Phasen 2 und 3 bringen den grössten Nutzen im Alltag, Phase 4 den grössten vor Ort.

## 6. Risiken

| Risiko | Gegenmassnahme |
|---|---|
| Smoke-Tests hängen an DOM von Liste, Editor und Finden | Inventar in Phase 0, Selektoren behalten, Anpassungen pro Phase |
| Editor-Umbau ändert das Speicherformat unbemerkt | Roundtrip-Test mit identischem Payload |
| Standort oder Kamera als Home-Bildschirm-App auf iOS eingeschränkt | früh auf dem Gerät testen, Fallback Koordinaten von Hand und Dateiwahl |
| Eigene Markenfarbe mit zu wenig Kontrast | Schriftfarbe automatisch, Mindestkontrast 4,5:1, «Zurücksetzen» |
| Service Worker liefert alte Dateien | `CACHE_VERSION` pro Phase, Version in den Einstellungen sichtbar |
| `status_wechsel` fehlt auf älterer Integration | Fallback «Geöffnet/Geschlossen» |
| Foto ohne Netz | Entscheid 6, Hinweis «Foto später ergänzen» |
| Überschreiben bestehender Daten | Regeln aus Abschnitt 1, expliziter Test je Feldtyp |

## 7. Abnahmekriterien
- Detail und Bearbeiten zeigen dieselben 7 Gruppen in derselben Reihenfolge, einklappbar, mit Vollständigkeit.
- Alle drei Erfassungswege über «Erfassen» erreichbar; Duplikatprüfung vor dem Speichern; vor Ort in zwei Schritten erfassbar.
- Markenfarbe wählbar, bleibt nach Neustart erhalten, Standard ist Grün, Kontrast gesichert.
- Keine bestehende Angabe wird ohne ausdrückliche Auswahl verändert; KI-Vermutungen nie vorgewählt.
- Alle bisherigen Funktionen bleiben erreichbar (Offline-Warteschlange, Konflikte, Löschen, Bilder, Sonderzeiten, Einstellungen).
- Bedienung per Touch und Tastatur, Hell/Dunkel lesbar, iPhone und Mac getestet.
- Smoke-Tests grün, Doku und Release Notes aktuell.
