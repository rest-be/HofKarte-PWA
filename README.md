# HofKarte-PWA

**Version: 2.0.0-rc.1** (Release Candidate) – siehe Abschnitt [Version](#version) unten für die
installierte Version auf einem konkreten Gerät.

Progressive Web App für HofKarte – ein reiner, zustandsloser Client für die
[HofKarte-HA](https://github.com/rest-be/HofKarte) Home-Assistant-Integration.
Hofläden ansehen, auf der Karte finden, vor Ort erfassen, ergänzen und
bearbeiten – auf dem Smartphone wie eine App, in vier Sprachen
(Deutsch, Français, Italiano, English).

> **Status: Release Candidate `2.0.0-rc.1`.** Funktional abgeschlossen und
> automatisiert getestet (305 Smoke-Tests), aber noch nicht auf einem echten
> iPhone abgenommen (Dynamic Type, VoiceOver, Teilen-Dialog, Apple-Karten-Link,
> Startbild). Der produktive Release `2.0.0` folgt nach dieser Abnahme; dabei
> ändert sich nur die Versionsnummer. Fehler bitte als GitHub-Issue melden.
> Die Übersicht der Änderungen steht in [`CHANGELOG.md`](CHANGELOG.md) und
> [`RELEASE_NOTES_2.0.0.md`](RELEASE_NOTES_2.0.0.md).

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [`docs/benutzerhandbuch.md`](docs/benutzerhandbuch.md) | Bedienung für Endanwender:innen (Einrichten, Ansehen, Erfassen, Einstellungen, Fehlerbehebung) |
| [`CHANGELOG.md`](CHANGELOG.md) | Alle Änderungen je Version |
| [`RELEASE_NOTES_2.0.0.md`](RELEASE_NOTES_2.0.0.md) | Überblick über das Release 2.0.0 |
| [`SECURITY.md`](SECURITY.md) | Sicherheitsmodell, Datenschutz, Meldeweg |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Entwicklung, Tests, Versionierung, Release-Ablauf |
| [`docs/gui-umsetzungsplan.md`](docs/gui-umsetzungsplan.md), [`docs/gui-inventar.md`](docs/gui-inventar.md) | Entscheide und Bestandsaufnahme der Überarbeitung 2.0 |
| [`tests/README.md`](tests/README.md) | Testaufbau |

## Funktionsumfang (2.0.0)

- **Hofläden ansehen:** Liste mit Suche, Filter (In der Nähe, Geöffnet,
  Unvollständig, Ohne Foto) und Sortierung; Karte mit Suche, Vorschau und
  «Mein Standort»; Detailansicht mit Öffnungsstatus («Offen bis …»), sieben
  Gruppen, Herkunft der Angaben, Teilen und Route.
- **Route:** Google Maps oder Apple Karten, wählbar in den Einstellungen
  (Standard: Apple Karten auf iPhone/iPad, sonst Google Maps). Ein einziger
  Route-Knopf überall.
- **Erfassen:** Tab «Erfassen» mit drei Wegen – vor Ort (Standort auf Tipp,
  Schnellerfassung mit Foto), von der Webseite, von Hand; «Hofladen finden»
  und «Angaben ergänzen» (Webseite, OpenStreetMap, optional KI).
- **Bearbeiten:** sieben Gruppen wie im HA-Panel, Chips, Zahlungsarten als
  Schalter, Wochentage-Editor, 24h-Automat, Adresse aus Koordinaten,
  Ungespeichert-Anzeige. Gespeichert wird nur im Editor.
- **Offline:** Änderungen werden lokal vorgemerkt und synchronisiert, sobald
  die Verbindung wieder besteht; bei gleichzeitiger Bearbeitung durch zwei
  Geräte entscheidet eine Konfliktansicht.
- **Darstellung:** Hell/Dunkel, Markenfarbe wählbar, Schrift folgt der
  Gerätegrösse, Startbild mit Version.
- **Zugänglichkeit:** Fokusführung, Tastatur, Kontraste ≥ 4,5:1, Status nie
  nur durch Farbe, «Bewegung reduzieren».
- **Datenschutz:** Standort nur auf ausdrücklichen Tipp und nie gespeichert;
  keine Drittanbieter-Skripte (alle Bibliotheken liegen unter `vendor/`).

## Architektur

- **Keine eigene Datenhaltung.** Alle Hofladen-Daten (Namen, Adressen,
  Öffnungszeiten, Bewertung, Bilder, Angebote, Zahlungsarten …) leben
  ausschliesslich in der HofKarte-HA-Integration und werden live über deren
  WebSocket-Management-API (`hofkarte/management/*`) geladen und
  gespeichert. Die PWA speichert lokal nur:
  - die Verbindungsdaten (HA-URL + Long-Lived Access Token) in IndexedDB,
  - einen Lesecache der zuletzt geladenen Hofladen-Liste (stale-while-
    revalidate, für Offline-/Degraded-Anzeige) samt Zeitpunkt («Stand HH:MM»),
  - die Offline-Warteschlange noch nicht synchronisierter Änderungen,
  - Geräteeinstellungen (Sprache, Navigationsdienst, Markenfarbe, Karten-
    Filter) – nur auf diesem Gerät, nie auf dem Server.
- **Authentifizierung** über ein pro Gerät erzeugtes Long-Lived Access
  Token eines dedizierten `hofkarte`-Admin-Benutzers in Home Assistant
  (siehe Vorgehensplan, Phase 1) – kein gemeinsames Passwort.
- **Kommunikation** direkt per `home-assistant-js-websocket` (nativ als
  ES-Modul aus `vendor/` geladen, kein Bundler, kein CDN) gegen die intern per
  DuckDNS/HTTPS erreichbare HA-Instanz (Phase 2).
- **Kartenansicht** via Leaflet + OpenStreetMap, farbige Marker analog zum
  HA-Panel.
- **Hosting** als statische Seite über GitHub Pages aus diesem Repository,
  erreichbar unter **`https://rest-be.github.io/HofKarte-PWA/`**.

## Deployment (GitHub Pages)

Das Deployment läuft automatisch über `.github/workflows/deploy.yml` bei
jedem Push auf `develop` (kein Build-Schritt nötig, da kein Bundler
verwendet wird – der Repo-Inhalt wird 1:1 veröffentlicht). Einmalig
eingerichtet:

1. Repo-Settings → **Pages** → unter "Build and deployment" die Quelle auf
   **"GitHub Actions"** stellen (nicht "Deploy from a branch").
2. Push auf `develop` löst den Workflow automatisch aus (oder manuell unter
   "Actions" → "Deploy auf GitHub Pages" → "Run workflow" starten).
3. Die PWA ist unter `https://rest-be.github.io/HofKarte-PWA/` erreichbar
   – live seit 2026-10-02.

## Struktur

```
.github/workflows/deploy.yml  GitHub-Actions-Deploy auf GitHub Pages
index.html            App-Shell
manifest.json          PWA-Manifest (Icons, Standalone-Modus)
service-worker.js       Cache-first App-Shell-Cache (kein WebSocket-Caching)
src/
  app.js                Einstiegspunkt, Hash-Router, globaler App-State
  ha-client.js           Anbindung an Home Assistant (WebSocket)
  storage.js             IndexedDB-Wrapper (Verbindungsdaten + Lesecache)
  html.js                 escapeHtml / sichereHttpUrl (Injection-Schutz)
  bilder.js               Vorschau-URLs und Verkleinerung vor dem Upload
  naehe.js                „Hofläden in der Nähe“ (Geolocation + HA-Action), Entfernung (Haversine)
  navigation.js           Route/Karten-Link je Navigationsdienst (Google Maps, Apple Karten)
  teilen.js               Teilen (Web Share, Zwischenablage als Rückfall)
  suche.js                Suche/Normalisierung (Umlaute, Gross-/Kleinschreibung)
  leerzustand.js          Gemeinsame Leerzustände (Keine Treffer, Noch keine Hofläden)
  fokus.js                Fokusführung bei Seiten-/Schrittwechseln
  i18n.js, i18n/          Sprachen (DE/FR/IT/EN): t(), tn(), Wörterbücher fr/it/en
  adresse.js              Adresse aus Koordinaten (Nominatim, nur auf Tipp)
  design.js, gruppen.js   Markenfarbe/Kontraste; Gruppenmodell (Vollständigkeit)
  ergaenzen.js, update.js Vergleich „Angaben ergänzen“; Update-Funktion
  icons.js                Icon-Satz (SVG, ohne Fremdbibliothek)
  finden.js               „Hofladen finden“: Tabellen, Entwurf, Herkunft (ohne DOM)
  styles.css              Stylesheet
  views/
    setup.js              Einrichtung (HA-URL + Token)
    list.js                Listenansicht
    detail.js              Detailansicht
    editor.js              Erstellen/Bearbeiten
    finden.js              „Hofladen finden“ (Suche, Auswahl, Prüfen)
    erfassen.js            Tab „Erfassen“: Einstieg, Vor Ort, Schnellerfassung
    auslesen.js            „Von der Webseite“ und „Angaben ergänzen“
    map.js                 Kartenansicht (Vorschau-Sheet, Formmarker)
    einstellungen.js, konflikt.js  Einstellungen/Update; Versionskonflikte
vendor/                 Drittbibliotheken lokal (home-assistant-js-websocket, Leaflet; siehe vendor/README.md)
icons/                  App-Icons (192/512/Apple Touch/Favicon)
tests/                  Playwright-Smoke-Tests (siehe tests/README.md)
package.json            nur für die Test-Tooling-Installation, kein Build-Schritt
```

## Tests

Playwright-Smoke-Tests gegen eine Kopie der App mit einem Stub für die
Home-Assistant-Verbindung (aktuell **305 Tests**, davon ein Sprachtest ohne
Browser). Lokal:

```bash
npm install
npx playwright install chromium --with-deps
npm run test:smoke
```

Details siehe `tests/README.md`. Es gibt derzeit keinen automatischen
CI-Lauf für Tests (im Repository liegt nur der Deploy-Workflow); die Tests
werden vor jedem Merge und Release von Hand ausgeführt. Die PWA selbst bleibt
bundlerfrei; `package.json` dient ausschliesslich der Installation von
Playwright für diese Tests.

## Version

Die installierte App-Version ist seit Phase 8e in **Einstellungen**
(⚙️-Button in der Kopfzeile) sichtbar – nützlich, um bei mehreren
Geräten im Haushalt zu prüfen, ob alle denselben Stand haben, oder beim
Melden eines Problems die Version anzugeben.

Die einzige Quelle der Wahrheit ist `src/version.js`
(`export const APP_VERSION = "…"`). Bei einer für Nutzer sichtbaren,
nennenswerten Änderung (nicht bei jedem kleinen Fix) wird diese Nummer
erhöht – zusammen mit `CACHE_VERSION` in `service-worker.js`, falls
gecachte Dateien betroffen sind, mit der Version am Anfang dieses READMEs
und der Versionsangabe im Startbild (`index.html`, vom Test gegen
`APP_VERSION` geprüft).

| Version | Datum | Wesentliche Änderungen |
|---|---|---|
| 2.0.0-rc.1 | 2026-10-24 | Release Candidate: Funktionsstand von dev.16, Dokumentation vervollständigt (Benutzerhandbuch, Changelog, Sicherheit, Release Notes). |
| 2.0.0-dev.16 | 2026-10-17 | Navigation wählbar: Google Maps oder Apple Karten (Standard je Gerät). |
| 2.0.0-dev.15 | 2026-10-17 | Startbild (Splash) mit Titel, Icon und Versionsnummer. |
| 2.0.0-dev.14 | 2026-10-16 | Karte: Suche mit Trefferliste, Hinspringen und «Alle Treffer zeigen». |
| 2.0.0-dev.13 | 2026-10-16 | Liste: Filter und Sortierung hinter einem Filter-Knopf, aktive Filter als Chips. |
| 2.0.0-dev.12 | 2026-10-16 | Teilen, «Foto fehlt» + Filter, Stand der Daten offline, Leerzustände, Schrift folgt der Gerätegrösse. |
| 2.0.0-dev.11 | 2026-10-16 | Erscheinungsbild nach dem Entwurf «HofKarte PWA» (Karten, Pillen, Tableiste, Gruppen-Symbole, Dunkelmodus). |
| 2.0.0-dev.10 | 2026-10-16 | Sprachwahl als grosses Dropdown mit «Zurücksetzen»; «Zurücksetzen» bei der Farbe als Knopf. |
| 2.0.0-dev.9 | 2026-10-15 | Sprachwahl als eigene Gruppe mit grossen Zeilen; «Eigene Farbe» als runder Punkt. |
| 2.0.0-dev.8 | 2026-10-15 | Vier Sprachen (DE/FR/IT/EN), 24h-Automat, Adresse aus Koordinaten (OpenStreetMap), „Angaben ergänzen“ mit OpenStreetMap, runder Farbpunkt. |
| 2.0.0-dev.7 | 2026-10-14 | Zugänglichkeit (Fokusführung, „Zum Inhalt“, sichtbarer Tastaturfokus, Kontraste ≥ 4,5:1 hell und dunkel), „Erweiterte Suche“ fragt den Standort nur auf Tipp, Geräte-Test-Checkliste. |
| 2.0.0-dev.6 | 2026-10-14 | Liste mit Filter-Chips und Entfernung auf Tipp; Karte mit Vorschau-Sheet, „Mein Standort“, Formmarkern und Filter „Nur geöffnet“. |
| 2.0.0-dev.5 | 2026-10-14 | „Von der Webseite“ erfassen und „Angaben ergänzen“ für Bestehendes (Lücken vorgewählt, Abweichungen nie). |
| 2.0.0-dev.4 | 2026-10-14 | Tab „Erfassen“ (Vor Ort, Schnellerfassung, Gespeichert), Update-Funktion („Nach Update suchen“, Hinweis bei neuer Version). |
| 2.0.0-dev.3 | 2026-10-14 | Bearbeiten neu: sieben Gruppen, Chips, Schalter, Wochentage-Editor, Fussleiste mit Ungespeichert-Anzeige. |
| 2.0.0-dev.2 | 2026-10-14 | Detailansicht neu: sieben Gruppen wie im HA-Panel, Schnellaktionen, Hinweis „Noch unvollständig“, ⋮-Menü. |
| 2.0.0-dev.1 | 2026-10-14 | Entwicklungsstand der Überarbeitung 2.0.0: grüne Markenfarbe (in den Einstellungen wählbar), Symbole statt Emojis, Status mit Form. |
| 1.12.0 | 2026-10-09 | „Hofladen finden“ (Discovery aus HofKarte-HA 2026.10.1, optional mit KI), Herkunft der Angaben in der Detailansicht. |
| 1.11.0 | 2026-10-06 | Foto-Upload über WebSocket (ohne CORS), Karte: Geschlossene ausblenden. |
| 1.10.0 | 2026-10-05 | Phase 10: Sicherheit (Escaping, CSP, https-Pflicht), lokale Bibliotheken statt CDN, stabiles Suchfeld, Bild-Verkleinerung. |
| 1.9.0 | 2026-10-05 | Umkreis für „Hofläden in der Nähe“ in den Einstellungen einstellbar (Standard 500 m). |
| 1.8.2 | 2026-10-05 | Detailansicht: Öffnungszeiten einklappbar (eingeklappt mit heutigen Zeiten). |
| 1.8.1 | 2026-10-05 | Detailansicht: „Auf der Karte öffnen“ öffnet Google Maps. |
| 1.8.0 | 2026-10-05 | Einstellungen neu geordnet (Verbindung, Token, Abmelden, Version), „In der Nähe“ einklappbar, Version + Release Notes auf dem Einrichtungsbildschirm. |
| 1.7.0 | 2026-10-05 | iOS-Optik (Phase 9): System-Schrift/-Farben, Dark Mode, Navigationsleiste mit Large Title und Blur, Tab-Icons, Inset-Grouped-Listen, Seitenübergänge, Swipe-back. |
| 1.6.0 | 2026-10-05 | Versionskonflikt-Erkennung (Phase 8b): `version` wird mitgesendet, bei Konflikt Konfliktansicht mit „Meine Version übernehmen“ / „Server-Version übernehmen“. |
| 1.5.0 | 2026-10-04 | Versionsanzeige in Einstellungen + README eingeführt (Phase 8e). |
| 1.4.0 | 2026-10-04 | Testdisziplin formalisiert: Playwright-Smoke-Tests unter `tests/` + CI-Workflow (Phase 8d). |
| 1.3.0 | 2026-10-04 | iOS-/Accessibility-Lücken geschlossen: Touch-Targets, `prefers-reduced-motion`, ARIA-Attribute (Phase 8c). |
| 1.2.0 | 2026-10-04 | Offline-Schreib-Outbox für Anlegen/Ändern/Löschen (Phase 8a). |
| 1.1.0 | 2026-10-02 bis 2026-10-04 | GUI-Grundstruktur, Theming, Icon, Foto-Upload (Phase 7). |
| 1.0.0 | 2026-10-02 | Erster produktiver Stand (Phasen 0–6: MVP, CI/CD, Dokumentation). |

## Installation auf dem iPhone

1. **Im Heimnetz oder mit aktiver VPN-Verbindung** in Safari
   `https://rest-be.github.io/HofKarte-PWA/` öffnen (ohne eine der beiden
   Verbindungen kann die PWA keine Daten von Home Assistant laden – siehe
   Hinweis unten).
2. Auf das Teilen-Symbol tippen → **„Zum Home-Bildschirm“** auswählen →
   mit „Hofkarte“ als Namen bestätigen. Die App erscheint danach als
   eigenes Icon auf dem Home-Bildschirm und startet im Standalone-Modus
   (ohne Safari-Oberfläche).
3. Beim allerersten Start erscheint der Einrichtungsbildschirm:
   - **HA-Adresse:** ist bereits mit `https://hofkarte.duckdns.org:8123`
     vorausgefüllt.
   - **Long-Lived Access Token:** das für dieses Gerät erzeugte Token
     einfügen (siehe nächster Abschnitt).
   - Danach lädt die App automatisch die Hofladen-Liste.

Die Einrichtung ist pro Gerät nur einmal nötig – die Verbindungsdaten
bleiben lokal in IndexedDB gespeichert, bis sie über *Einstellungen →
Abmelden* oder durch Löschen der App entfernt werden.

### Eigenes Token pro Gerät/Person

Jedes Gerät bekommt sein **eigenes** Long-Lived Access Token unter dem
HA-Benutzer `hofkarte` (siehe Vorgehensplan, Phase 1):

1. In Home Assistant als `hofkarte`-Benutzer anmelden (oder als Admin im
   Benutzerprofil von `hofkarte`).
2. Profil → ganz unten **„Long-Lived Access Tokens“** → „Token erstellen“.
3. Sprechenden Namen vergeben, z. B. „HofKarte-PWA – iPhone Martina“.
4. Das angezeigte Token sofort in die PWA auf dem jeweiligen Gerät
   eintragen (wird danach nicht nochmal angezeigt).

Vorteil des Pro-Gerät-Ansatzes: Geht ein Gerät verloren, wird nur dessen
Token in Home Assistant widerrufen – alle anderen Geräte bleiben
unberührt, keine Neueinrichtung nötig.

### Wichtig: VPN unterwegs nicht vergessen

Die PWA ist aus Sicherheitsgründen nur aus dem Heimnetz oder per VPN mit
Home Assistant erreichbar (kein öffentlicher Zugriff). Wird die PWA
unterwegs **ohne aktive VPN-Verbindung** geöffnet, zeigt sie automatisch
den zuletzt gecachten Stand mit einem Offline-Hinweis an, statt aktuelle
Daten zu laden oder Änderungen zu ermöglichen. Vor dem Öffnen der App
unterwegs also kurz prüfen, ob das VPN aktiv ist.

## Voraussetzungen auf HA-Seite

Siehe auch den Abschnitt «Mobile PWA» im README von HofKarte-HA:

- HofKarte-HA-Integration installiert und konfiguriert. Zuordnung:
  PWA 2.0.0 benötigt HofKarte-HA **ab 2026.10.1** (Hofladen finden,
  Öffnungsstatus und Hauptbild vom Server) und **ab 2026.10.2** für den
  Schalter «24h-Automat». Zuerst die Integration aktualisieren, dann die PWA.
- Dedizierter Admin-Benutzer `hofkarte` mit Long-Lived Access Token pro
  Gerät.
- HA extern/intern per HTTPS erreichbar (z. B. via DuckDNS-Add-on).
- **`cors_allowed_origins`** in `configuration.yaml`, damit der Browser
  Anfragen von `https://rest-be.github.io` akzeptiert. Nur noch nötig für
  den REST-Fallback des Foto-Uploads (`POST /api/image/upload`, siehe
  unten): Mit der aktuellen HofKarte-HA-Integration läuft der Upload über
  die WebSocket-Verbindung (Befehl `hofkarte/management/upload_image`) und
  braucht **kein** CORS. Die WebSocket-Verbindung selbst unterliegt CORS nie.

## Fotos hinzufügen

Im Editor können Bilder auf zwei Arten direkt aus der PWA heraus
hinzugefügt werden, zusätzlich zur bisherigen Möglichkeit, eine externe
Bild-Adresse einzutragen:

- **📷 Foto aufnehmen** – öffnet die Kamera direkt.
- **🖼️ Aus Fotos wählen** – öffnet die Fotobibliothek des Geräts.

Beides läuft über Home Assistants eigene `image_upload`-Komponente
(bevorzugt per WebSocket-Befehl `hofkarte/management/upload_image`, Fallback `POST /api/image/upload`; Ausliefern unter
`/api/image/serve/<id>/original`) – dieselbe, die auch die native
HA-Verwaltungsoberfläche nutzt. Es gibt dafür keinen eigenen
HofKarte-PWA-Speicher; die Bilder liegen wie gewohnt in Home Assistant.

## Hofladen finden (Discovery, Phase 7)

Unter **Neu → 🔎 Hofladen finden**: nimmt den Standort des Geräts, sucht
im Umkreis (Standard 2 km, max. 5 km) über die HofKarte-Integration
(ab 2026.10.1, Administratorrechte nötig) in OpenStreetMap nach
Hofläden, liest bei Bedarf deren Website aus (robots.txt wird
beachtet) und zeigt die Angaben mit ihrer Herkunft. Gewählte Angaben
landen im normalen Formular; gespeichert wird erst dort. Die Herkunft
(„quellen“) wird mitgespeichert, solange ein Feld nicht von Hand
geändert wird, und in der Detailansicht angezeigt.

Die **KI-Auswertung** ist optional: Sie erscheint nur, wenn in Home
Assistant (HofKarte → Konfigurieren) eine „AI Task“-Entität gewählt ist,
ist nie vorausgewählt, und nicht im Website-Text belegte Vorschläge
werden getrennt als „Vermutungen“ angezeigt (nie vorausgewählt).
Daten © OpenStreetMap-Mitwirkende (ODbL).

## Offline-Betrieb (Phase 8a)

Hofläden anlegen, ändern und löschen funktioniert auch ohne aktive
Verbindung zu Home Assistant (z. B. gerade kein VPN/Heimnetz). Die
Änderung wird sofort lokal sichtbar und automatisch synchronisiert,
sobald die Verbindung wieder besteht – die App versucht dazu alle 30
Sekunden, sich erneut zu verbinden, solange sie im Vordergrund offen ist.

Die Kopfzeile zeigt den Sync-Status dezent an (nur bei Bedarf):

- **⌁ Offline (n ausstehend)** – keine Verbindung, n Änderungen warten.
- **↻ Wird synchronisiert …** – Verbindung besteht, Warteschlange wird
  gerade abgearbeitet.
- ohne Anzeige – alles synchronisiert, nichts zu tun.

Noch nicht synchronisierte Hofläden sind in der Liste mit ⌁ markiert und
zeigen in der Detailansicht einen entsprechenden Hinweis.

**Bewusst noch nicht Teil dieser Version:** Fotos hinzufügen/entfernen
(Kamera, Fotobibliothek) benötigt weiterhin eine aktive Verbindung und
zeigt ohne Verbindung eine Fehlermeldung – siehe
`PWA-HA-Vorgehensplan.md`, Phase 8a, für die Begründung.

## Sicherheit & Performance (Phase 10)

Umsetzung des Code-Reviews (Performance + Security):

- **Escaping**: alle Daten aus HA/Importen laufen über `escapeHtml`; Karten-Popups
  nutzen DOM-Knoten; Webseiten-Links nur mit `http(s)` (`sichereHttpUrl`).
- **Content-Security-Policy** in `index.html` (keine Inline-Skripte/-Styles, Skripte nur
  vom eigenen Ursprung). Der Service-Worker-Registrierungscode liegt daher in `app.js`.
- **Lokale Bibliotheken** unter `vendor/` (kein CDN): offlinefähiger Kaltstart,
  keine Drittserver-Abhängigkeit. Updates: siehe `vendor/README.md`.
- **https-Pflicht** für die Home-Assistant-Adresse (http nur für localhost).
- **Debug-Zugriff** `window.hofkarteApp` nur auf localhost oder mit `?debug=1`.
- **Performance**: Suchfeld wird nicht mehr neu gezeichnet (Fokus bleibt, Entprellung),
  Hintergrund-Refresh überschreibt keine Eingabeansichten, Vorschaubilder (256 px) statt
  Originale, Fotos werden vor dem Upload auf max. 1600 px verkleinert, eine gemeinsame
  IndexedDB-Verbindung, Service Worker cached nur die App-Shell.
- Bewusst nicht umgesetzt: Nicht-Admin-Rechte für HA-Verwaltungsbefehle (Entscheidung im HA-Repo).

## iOS-Optik (Phase 9)

Die App ist optisch an native iOS-Apps angelehnt (Human Interface
Guidelines), ohne Framework und ohne Build-Schritt:

- System-Schrift (SF) und iOS-System-Farben, automatisch hell/dunkel
  (`prefers-color-scheme`); die Akzentfarbe steht in `--tint`
  (`src/styles.css`) und lässt sich dort zentral ändern.
- Navigationsleiste mit Large Title (wird beim Scrollen klein, Blur),
  Zurück-Button mit Chevron auf Unterseiten, Einstellungen-Zahnrad auf
  der Tab-Ebene.
- Tab-Leiste unten mit Linien-Icons und Blur, Safe-Area-konform.
- Listen und Formulare als „Inset Grouped“-Gruppen mit Chevron,
  Trennlinien und Abschnittsüberschriften über der Gruppe.
- Seitenübergänge (Push/Pop) und Swipe-back vom linken Rand
  (abgeschaltet bei „Bewegung reduzieren“).
- Eingabefelder mit 17 px Schrift (verhindert das Auto-Zoomen in Safari).

Grenzen einer PWA: keine Haptik, Swipe-back ist nachgebaut (kein
nativer Navigationsstack). Die Kartenkacheln (Leaflet) bleiben hell.

## Versionskonflikte (Phase 8b)

Jeder Hofladen trägt eine `version`, die Home Assistant bei jeder
Änderung erhöht. Die App sendet beim Speichern die Version mit, auf der
bearbeitet wurde (auch aus der Offline-Warteschlange). Hat inzwischen ein
anderes Gerät gespeichert, lehnt Home Assistant die Änderung ab, statt
sie stillschweigend zu überschreiben.

- Die eigene Fassung geht nicht verloren: sie bleibt als Konflikt
  gespeichert, die Kopfzeile zeigt **⚠ Konflikt**, in Liste und Detail
  erscheint ein Hinweis.
- Die Konfliktansicht (`#/konflikt/<id>`) zeigt die abweichenden Felder
  nebeneinander. Entscheidung ganz oder gar nicht, kein Feld-Merge:
  **Meine Version übernehmen** (wird auf dem aktuellen Server-Stand
  erneut gesendet) oder **Server-Version übernehmen** (eigene Änderungen
  werden verworfen).
- Konflikt-Operationen werden nicht automatisch wiederholt und blockieren
  weitere Änderungen am selben Hofladen, bis entschieden ist.

**Einschränkungen:** Löschen prüft keine Version (ein Löschen gewinnt
immer). Bilder werden nicht zusammengeführt – bei „Meine Version“ gilt
die Bilderliste der eigenen Fassung (Last-Writer-Wins). Voraussetzung ist
eine HA-Integration mit Versionsunterstützung (HofKarte-HA, Phase 8b);
ältere Stände ignorieren die Version einfach.

## iOS-/Accessibility-Feinschliff (Phase 8c)

- Alle interaktiven Elemente (Buttons, Eingabefelder) sind mindestens
  44×44px gross (WCAG 2.2 / iOS-Empfehlung für Touch-Targets).
- Die Kartenansicht respektiert `prefers-reduced-motion`: ist das in den
  iOS-/Browser-Einstellungen aktiviert, werden Leaflets Zoom-/Fade-
  Animationen abgeschaltet.
- Icon-only-Bedienelemente (Sterne-Bewertung, Öffnungszeiten entfernen,
  Sortierrichtung, Bild-Aktionen) haben `aria-label`/`title` für
  Screenreader; der aktive Tab in der unteren Navigation ist per
  `aria-current` ausgezeichnet.
- Schriftgrössen sind durchgehend in `rem` definiert und folgen damit
  automatisch der iOS-Systemschriftgrösse (Dynamic Type).

## Zugänglichkeit und Geräte-Test (ab 2.0.0-dev.7)

Umgesetzt und per Smoke-Test abgesichert:

- **Fokusführung:** Nach einem Seitenwechsel steht der Fokus auf der Überschrift
  (genau eine `h1` pro Ansicht), bei Schrittwechseln („Hofladen finden“, „Von der
  Webseite“) auf der Schrittüberschrift bzw. der Statusmeldung. Der Seitentitel
  folgt der Ansicht.
- **Tastatur:** „Zum Inhalt“ (erstes Element beim Tabben) und ein überall sichtbarer
  Fokusrahmen (3 px). Die Karten-Vorschau schliesst mit Escape.
- **Kontraste:** Text, Gedämpft, Links, Schrift auf Akzent, Erfolg, Fehler und
  Warnung erreichen in Hell und Dunkel mindestens 4,5:1 (Test rechnet nach).
  Die Markenfarbe wird bei jeder Wahl gleich geprüft.
- **Status nie nur durch Farbe:** Badge mit Form + Text, Kartenmarker mit Form
  (Kreis = geöffnet, Quadrat = geschlossen, Ring = unbekannt).
- **Bewegung:** `prefers-reduced-motion` schaltet Seitenübergänge, Sheet-Animation
  und Leaflet-Animationen ab.
- **Standort nur auf Tipp:** Liste („In der Nähe“), Karte („Mein Standort“),
  „Vor Ort“, „Hofladen finden“. Er wird nie gespeichert.

**Checkliste für den Test auf dem Gerät** (nicht automatisierbar, bitte von Hand):

1. iPhone, Home-Bildschirm-App: App einmal über den Link neu laden bzw. in den
   Einstellungen „Nach Update suchen“; Version prüfen (Einstellungen).
2. Standort: „Vor Ort“ → „Standort abfragen“ (iOS fragt beim ersten Mal; bei
   Ablehnung erscheint die Anleitung). Danach Liste → „In der Nähe“.
3. Kamera/Foto in der Schnellerfassung; ohne Netz erscheint „Foto später ergänzen“.
4. VoiceOver: Tab „Erfassen“ → Einstieg → „Von der Webseite“ durchgehen; Schritt-
   und Statusansagen prüfen; Karte: Marker werden mit Name und Status vorgelesen.
5. Dunkelmodus und grosse Schrift (Einstellungen → Anzeige) ansehen.
6. Mac (Safari/Chrome): Tastatur-Durchgang mit Tab/Enter/Escape.

**Cache-Hinweis:** Die App aktualisiert sich nicht von selbst auf der
Home-Bildschirm-Verknüpfung, wenn die installierte Version vor 2.0.0-dev.4 ist
(sie kennt die Update-Funktion noch nicht). Einmalig den Link im Browser öffnen
und die Verknüpfung neu anlegen; danach genügt „Nach Update suchen“ bzw. der
Hinweis „Neue Version verfügbar“. Im Notfall „App zurücksetzen“ (die Anmeldung
bleibt erhalten).

## Sprachen, 24h-Automat und OpenStreetMap (ab 2.0.0-dev.8)

- **Sprachen:** Deutsch, Français, Italiano, English. Gewählt wird unter
  *Einstellungen → Sprache*; ohne Wahl gilt die Browsersprache (sonst Deutsch).
  Die Wahl gilt pro Gerät (`localStorage`, nie auf dem Server). Der deutsche Text ist
  zugleich der Schlüssel (`t("Speichern")`, `tn(n, "1 Hofladen", "{n} Hofläden")`);
  fehlt eine Übersetzung, erscheint Deutsch. Begriffe: FR «ferme», IT «negozio agricolo»,
  EN «farm shop». Nicht übersetzt werden Release Notes sowie Texte, die aus Home
  Assistant kommen (Namen, Beschreibungen, Hinweise der Integration).
  `tests/i18n-test.mjs` prüft, dass jeder `t()`-Text in allen drei Wörterbüchern steht und
  die Platzhalter übereinstimmen; ein Smoke-Test durchläuft zwölf Ansichten in FR/IT/EN
  und sucht nach deutschen Resten.
- **24h-Automat:** Schalter in der Gruppe «Öffnungszeiten». Dann gilt der Hofladen
  rund um die Uhr als geöffnet (ausser an Tagen mit Sonder-Schliessung); die
  Wochenzeiten werden ausgeblendet und nicht verwendet. Das Feld `automat_24h` gibt es
  ab HofKarte-HA **2026.10.2**; ältere Versionen speichern es nicht.
- **Adresse aus Koordinaten:** Schaltfläche in der Gruppe «Adresse & Standort». Nur auf
  Tipp werden die Koordinaten (nichts sonst) an Nominatim (OpenStreetMap, ODbL)
  gesendet. Lücken sind vorgewählt, Abweichungen nie; übernommen wird erst nach
  «Übernehmen», gespeichert erst im Editor.
- **Angaben ergänzen mit OpenStreetMap:** Quelle wählbar (Webseite und/oder
  OpenStreetMap). OpenStreetMap wird am gespeicherten Standort (300 m) durchsucht, der
  eigene Standort wird nicht abgefragt.

## Bekannte Einschränkungen (2.0.0-rc.1)

- **Nicht auf einem echten Gerät abgenommen:** Dynamic Type, VoiceOver,
  Teilen-Dialog, Apple-Karten-Link und Startbild (Safe Areas) sind nur
  automatisiert geprüft. Checkliste siehe Abschnitt «Zugänglichkeit und
  Geräte-Test».
- **Sonderöffnungszeiten** werden in der PWA angezeigt, aber nicht
  bearbeitet – dafür das Panel in Home Assistant verwenden.
- **Fotos** hinzufügen/entfernen erfordert eine aktive Verbindung zu Home
  Assistant; offline lässt sich das Foto später ergänzen.
- **Versionskonflikte:** Löschen prüft keine Version (ein Löschen gewinnt
  immer); Bilder werden nicht zusammengeführt (siehe «Versionskonflikte»).
- **Übersetzungen** (FR/IT/EN) wurden noch nicht von Muttersprachler:innen
  geprüft. Texte aus Home Assistant (Namen, Beschreibungen, Hinweise) sind nicht
  übersetzt.
- **CarPlay** ist mit einer PWA nicht möglich; die Route lässt sich in Apple
  Karten öffnen.
- **Standort** liefert das Gerät nur über HTTPS und nach Zustimmung; bei
  Ablehnung zeigt die App eine Anleitung.
- Die **KI-Auswertung** ist nur verfügbar, wenn in Home Assistant eine
  «AI Task»-Entität gewählt ist, und wurde mit lokalen Modellen noch nicht im
  Feld gemessen.
