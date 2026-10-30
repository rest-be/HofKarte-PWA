# HofKarte-PWA 2.1.0 – Umsetzungsplan

Stand: 2026-10-30 · Basis: 2.0.0 · Version: `2.1.0`, Zwischenstände `2.1.0-dev.N`, danach `2.1.0-rc.N`.
Umsetzung phasenweise: nach jeder Phase ein ZIP, Freigabe vor der nächsten Phase. Tag, Merge und Push macht Reto.

## 1. Entschieden (2026-10-30)

1. **Version:** alle drei Punkte zusammen als `2.1.0` (kein `2.0.1` dazwischen).
2. **Foto vom Schild auslesen:** per **OCR im Browser, ohne KI** (Tesseract.js, lokal gebündelt). Keine Daten verlassen das Gerät.
3. **Übernahme:** wie «Angaben ergänzen» (Vergleich Aktuell · Gefunden · Status; Lücken vorgewählt, Abweichungen nie; gespeichert wird erst im Editor).
4. **Öffnungszeiten schneller:** Vorlagen und Kopieren im Wochentage-Editor.
5. **Sonderöffnungszeiten:** in der PWA bearbeiten (Datenmodell und HA-Integration unverändert, kein HA-Update nötig).

Leitplanken unverändert (siehe `CONTRIBUTING.md`): bundlerfrei, keine CDN-Aufrufe, CSP `style-src 'self'`, Standort nur auf Tipp, nichts ohne Wahl überschreiben, Escaping, Touch-Ziele ≥ 44 px, Status nie nur durch Farbe, Kontraste ≥ 4,5:1, vier Sprachen.

## 2. Phasen

| Phase | Version | Inhalt |
|---|---|---|
| 1 | dev.1 | **Sonderöffnungszeiten bearbeiten:** Gruppe «Öffnungszeiten» im Editor erhält die Liste der Sonderzeiten (Datum von/bis, «Geschlossen» oder Zeiten), hinzufügen, ändern, entfernen, Prüfung (bis ≥ von, Ende ≠ Beginn, keine Überschneidung), Anzeige in Detail unverändert. |
| 2 | dev.2 | **Zeiten schneller:** Vorlagen («Mo–Fr 8–12 / 14–18», «Mo–Sa 8–18», «Täglich 7–20»), «Wie Vortag», «Auf alle Wochentage kopieren», Zeittext-Parser (`src/zeittext.js`, DE/FR/IT/EN, ohne DOM, testbar). Der Parser dient auch der OCR. |
| 3 | dev.3 | **OCR-Grundlage:** Tesseract.js lokal unter `vendor/ocr/` (Worker, Kern, Sprachdaten DE/FR/IT/EN), Laden erst bei der ersten Nutzung, Cache für Offline, Vorverarbeitung des Fotos (Verkleinern, Graustufen), Fortschrittsanzeige, Abbruch, Test mit einem erzeugten Schild-Bild. |
| 4 | dev.4 | **Schild lesen:** «Schild fotografieren» in «Angaben ergänzen» und in «Erfassen» (Quelle neben Webseite und OpenStreetMap). Textanalyse (`src/schildtext.js`): Name, Telefon, E-Mail, Webseite, Öffnungszeiten, Adresse/PLZ/Ort, Zahlungsarten und Angebote aus bekannten Wörtern. Vergleichstabelle, Herkunft «Schild (Foto)» pro Feld. |
| 5 | dev.5 → rc.1 | Texte FR/IT/EN, Zugänglichkeit, Tests, Benutzerhandbuch, CHANGELOG, Release Notes, SECURITY (Datenschutzaussage OCR), Version. Danach `2.1.0-rc.1`, nach Abnahme `2.1.0`. |

## 3. Technische Entscheide und Risiken

### Sonderöffnungszeiten
- Format unverändert: `{ datum_von, datum_bis, geschlossen, beginn, ende }` (`YYYY-MM-DD`, `HH:MM`). Bei `geschlossen: true` gibt es keine Zeiten. Die HA-Integration prüft: `bis ≥ von`, `Ende ≠ Beginn`.
- Der Editor behält bereits vorhandene Sonderzeiten beim Speichern bei (heute nur durchgereicht).
- Überschneidungen: Die Integration lässt sie zu (erste passende gilt); die PWA warnt, blockiert aber nicht.

### OCR im Browser
- **Bibliothek:** Tesseract.js 7 (Apache-2.0) mit `tesseract.js-core` (LSTM, SIMD und ohne SIMD) und den Sprachdaten `best_int` für `deu`, `fra`, `ita`, `eng` (je ca. 1,3 MB gezippt). Insgesamt ca. 12 MB im Repository, ca. 7 MB Übertragung bei der ersten Nutzung (GitHub Pages liefert gezippt). **Kein CDN**, alle Dateien unter `vendor/ocr/`.
- **Laden bei Bedarf:** Die Dateien kommen nicht in den App-Shell-Cache (Kaltstart bleibt klein). Beim ersten Gebrauch lädt die App sie und legt sie in einen eigenen Cache (Service Worker, `hofkarte-ocr-v1`); danach funktioniert das Auslesen auch offline. Es wird vorher angezeigt, wie viel geladen wird.
- **Content-Security-Policy:** Der Worker darf nicht aus einem `blob:`-URL starten (`workerBlobURL: false`), `worker-src 'self'` genügt. Ob für WebAssembly zusätzlich `'wasm-unsafe-eval'` nötig ist, wird in Phase 3 mit Chromium geprüft; wenn ja, nur im kleinstmöglichen Umfang und in `SECURITY.md` begründet.
- **iPhone:** Fotos werden vor der Erkennung auf höchstens 1600 px verkleinert (Speicher). Die Erkennung läuft im Worker, die Oberfläche bleibt bedienbar, mit Abbruch.
- **Grenzen von OCR:** Handschrift und stark gestaltete Schilder werden schlecht erkannt; die Qualität hängt von Licht, Winkel und Schrift ab. Deshalb gilt: nichts wird ohne Auswahl übernommen, alle Funde sind Vorschläge mit Herkunft «Schild (Foto)», die erkannte Rohschrift ist sichtbar und korrigierbar. Telefonnummern und Zeiten werden zusätzlich formal geprüft.
- **Datenschutz:** Das Foto wird nur auf dem Gerät ausgewertet und nicht hochgeladen (ausser, du übernimmst es ausdrücklich als Bild des Hofladens).

### Zeittext-Parser
- Eingabe, z. B. «Mo-Fr 8-12 & 14-18.30, Sa 8–12, So geschlossen» (auch «Lundi–Vendredi 8h–12h», «lun-ven 8:00-12:00», «Mon–Fri 8am–6pm»). Ausgabe: Wochentage-Liste im bestehenden Format `{ wochentag, beginn, ende }`.
- Unklares wird **nicht geraten**, sondern als «nicht erkannt» gemeldet.

## 4. Nicht Teil von 2.1.0

Doppelte erkennen, Fotos offline hinzufügen, «ohne Home Assistant», Hoflädeli.ch als Quelle (weitere Punkte folgen später).
