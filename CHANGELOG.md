# Changelog

Alle nennenswerten Änderungen an der HofKarte-PWA. Das Format orientiert sich
an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

**Versionierung:** `MAJOR.MINOR.PATCH`. Während der Entwicklung einer Version
heissen die Zwischenstände `<Version>-dev.<N>`, Release Candidates
`<Version>-rc.<N>`. Die einzige Quelle der Wahrheit ist `src/version.js`
(`APP_VERSION`); die Release Notes in der App stehen ebenfalls dort. Die
Zuordnung zur Integration HofKarte-HA steht im README.

## [Unreleased]

Noch keine Änderungen seit `2.0.0`.

## [2.0.0] - 2026-10-25

Produktiver Release. Gegenüber `2.0.0-rc.1` ändert sich nur die Versionsnummer
(Startbild, `version.js`, Service Worker); es gibt keine funktionalen
Änderungen. Der Deploy-Workflow veröffentlicht seit `rc.1` nur noch die
auslieferbaren Dateien (`index.html`, `manifest.json`, `service-worker.js`,
`src/`, `vendor/`, `icons/`). Der Inhalt ist der von `2.0.0-rc.1` (unten).

**Voraussetzung:** HofKarte-HA ab `2026.10.1`; für den Schalter «24h-Automat»
ab `2026.10.2`.

## [2.0.0-rc.1] - 2026-10-24

> Release Candidate, Stand `2.0.0-dev.16`, automatisiert getestet (305
> Smoke-Tests). Wurde unverändert zu `2.0.0`.
>
> **Voraussetzung:** HofKarte-HA ab `2026.10.1`; für den Schalter «24h-Automat»
> ab `2026.10.2`.

Fasst die Entwicklungsstände `2.0.0-dev.1` bis `2.0.0-dev.16` zusammen: neue
Oberfläche, neue Erfassungswege, vier Sprachen, bessere Zugänglichkeit.

### Hinzugefügt

- **Erfassen:** Tab «Erfassen» mit drei Wegen – *Vor Ort* (Standort auf Tipp,
  Umkreis 100/250/500 m, «Schon erfasst» zuoberst, Treffer aus OpenStreetMap,
  Schnellerfassung mit Name, Webseite, Standort und Foto, Warnung vor Doppelten,
  «Noch offen» mit Sprung in die Gruppe), *Von der Webseite* (auslesen, prüfen,
  übernehmen, optional KI – nie vorgewählt) und *Von Hand*. Die bisherige Suche
  bleibt als «Erweiterte Suche» (`dev.4`, `dev.5`, `dev.7`).
- **Angaben ergänzen** für bestehende Hofläden (Vergleich Aktuell · Gefunden ·
  Status; Lücken vorgewählt, Abweichungen nie; Listen werden ergänzt; KI-Vermutungen
  getrennt), wahlweise mit Webseite und/oder OpenStreetMap (`dev.5`, `dev.8`).
- **Vier Sprachen:** Deutsch, Français, Italiano, English
  (Einstellungen → Sprache; Standard: Browsersprache). Der Test prüft, dass
  jeder Text in allen Wörterbüchern steht (`dev.8`, `dev.9`, `dev.10`).
- **24h-Automat:** Schalter bei den Öffnungszeiten (benötigt HofKarte-HA
  `2026.10.2`) (`dev.8`).
- **Adresse aus Koordinaten** (OpenStreetMap/Nominatim, nur auf Tipp, nichts
  wird ohne Auswahl überschrieben) (`dev.8`).
- **Navigation wählbar:** Der Knopf «Route» öffnet Google Maps oder Apple Karten,
  zentral einstellbar; Standard auf iPhone/iPad Apple Karten, sonst Google Maps
  (`dev.16`).
- **Teilen** im ⋮-Menü (Name, Adresse, Öffnungszeiten, Kartenlink; ohne
  Teilen-Menü wird der Text kopiert) (`dev.12`).
- **Karte:** Suche mit Trefferliste, Hinspringen und «Alle Treffer zeigen»
  (`dev.14`); Vorschau-Sheet, «Mein Standort», Marker mit Form statt nur Farbe,
  Filter «Nur geöffnet» (`dev.6`).
- **Liste:** Filter «In der Nähe», «Geöffnet», «Unvollständig», «Ohne Foto» hinter
  einem Filter-Knopf, aktive Filter als Chips (`dev.6`, `dev.12`, `dev.13`).
- **«Foto fehlt»**-Markierung, **«Stand HH:MM»** der Offline-Daten, neue
  **Leer- und Fehlerzustände** (`dev.12`).
- **Startbild** mit Titel, Icon und Versionsnummer (`dev.15`).
- **Update-Funktion:** «Nach Update suchen», Hinweis «Neue Version verfügbar»,
  «App zurücksetzen» (Anmeldung bleibt erhalten) (`dev.4`).
- **Markenfarbe** wählbar (Voreinstellungen oder eigene Farbe, Schrift bleibt
  lesbar) (`dev.1`).
- Dokumentation: Benutzerhandbuch, Changelog, Sicherheit, Beitragen,
  Release Notes (`rc.1`).

### Geändert

- **Neues Erscheinungsbild** nach dem Entwurf «HofKarte PWA»: Karten mit feinem
  Rahmen, Statuspillen, Tableiste, Symbole statt Emojis, Dunkelmodus angepasst
  (`dev.1`, `dev.11`).
- **Detail und Bearbeiten** mit denselben sieben Gruppen wie im HA-Panel
  (Grunddaten, Adresse & Standort, Kontakt & Webseite, Öffnungszeiten,
  Angebote & Zahlungsarten, Bilder, Herkunft), Kurzinfo und Vollständigkeits-
  punkt; Chips für Angebote, Zahlungsarten als Schalter, Wochentage-Editor,
  feste Fussleiste mit «Ungespeichert» (`dev.2`, `dev.3`).
- **Einstellungen** neu geordnet: Darstellung, Sprache, Navigation, Hofläden in
  der Nähe, Verbindung, Token ändern, Abmelden, Version (`dev.9`, `dev.10`,
  `dev.16`).
- **Schrift folgt der Gerätegrösse** (Dynamic Type); Zeilen und Titel umbrechen
  (`dev.12`).
- Der Standort wird überall nur auf ausdrücklichen Tipp abgefragt, auch in der
  «Erweiterten Suche» (`dev.7`).

### Behoben

- Editor lief bei 165 % Textgrösse seitlich über (`dev.12`).
- Karte: Zoom-Tasten verdeckten die neue Suche – jetzt unten rechts (`dev.14`).
- Farbpunkt in den Einstellungen war auf dem iPhone oval (`dev.8`, `dev.9`).

### Zugänglichkeit

- Fokus folgt Seiten- und Schrittwechseln, «Zum Inhalt», sichtbarer
  Tastaturfokus, genau eine Hauptüberschrift je Ansicht, Statusmeldungen für
  Screenreader (`dev.7`).
- Kontraste in Hell und Dunkel mindestens 4,5:1 (vom Test nachgerechnet),
  auch für jede gewählte Markenfarbe (`dev.1`, `dev.7`).
- Status nie nur durch Farbe (Form und Text), «Bewegung reduzieren» wird
  beachtet, Touch-Ziele mindestens 44 px.

### Unverändert

Datenmodell, Offline-Warteschlange und Versionskonflikt-Erkennung, Sicherheits-
massnahmen (Escaping, Content-Security-Policy, https-Pflicht, lokale
Bibliotheken) und die Schnittstelle zu Home Assistant.

## [1.12.0] - 2026-10-09

- Neu: «Hofladen finden» (Discovery aus HofKarte-HA `2026.10.1`, optional mit
  KI), Herkunft der Angaben in der Detailansicht.

## [1.11.0] - 2026-10-06

- Foto-Upload über die WebSocket-Verbindung (ohne CORS); Karte: «Geschlossene
  ausblenden».

## [1.10.0] - 2026-10-05

- Sicherheit und Leistung: Escaping, Content-Security-Policy, https-Pflicht,
  lokale Bibliotheken statt CDN, stabiles Suchfeld, Bild-Verkleinerung.

## Frühere Versionen

`1.0.0` bis `1.9.0` (2026-10-02 bis 2026-10-05): MVP, Offline-Warteschlange,
Versionskonflikte, Testdisziplin, iOS-Optik, Einstellungen, Umkreis «in der
Nähe». Die vollständige Liste steht in der Versionstabelle des README und in
`src/version.js`.
