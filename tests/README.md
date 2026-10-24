# Tests

Playwright-Smoke-Tests für die HofKarte-PWA (Phase 8d im Vorgehensplan:
Testdisziplin formalisieren). Laufen automatisch bei jedem Pull Request
gegen `develop` (siehe `.github/workflows/test.yml`) und lokal über:

```bash
npm install
npx playwright install chromium --with-deps
npm run test:smoke
```

## Funktionsweise

`run-smoke-tests.mjs` erstellt eine temporäre Kopie der App, ersetzt in
dieser Kopie den jsDelivr-Import von `home-assistant-js-websocket` in
`src/ha-client.js` durch `ha-ws-stub.js` (diesen Ordner), liefert die
Kopie über einen minimalen lokalen HTTP-Server aus und führt
`smoke-test.js` mit Playwright (Chromium, headless) dagegen aus. Die
echte PWA (das eigentliche Repo) bleibt davon unberührt – es wird nur
eine Kopie zum Testen angepasst, kein Build-Schritt für die Auslieferung.

`smoke-test.js` erzwingt den für die Testfälle benötigten App-Zustand
direkt über `window.hofkarteApp` (z. B. Offline-Modus mit einem
Beispiel-Hofladen), statt einen echten Verbindungsaufbau zu Home
Assistant zu durchlaufen – das Stub-Modul liefert für den eigentlichen
Verbindungsversuch bewusst immer einen `connection_lost`-Fehler.

## Abdeckung

- Grundrendering/Routing (Einrichtungsbildschirm beim ersten Start).
- **Phase 8a** (Offline-Schreib-Outbox): Hofladen offline anlegen/
  ändern/löschen, Sync-Status-Anzeige, erfolgreicher Sync inkl.
  ID-Remapping der lokalen Platzhalter-ID.
- **Phase 8c** (iOS-/Accessibility-Lücken): Touch-Target-Grössen
  (≥ 44×44px), ARIA-Attribute (Sterne-Bewertung, Öffnungszeiten-Felder,
  Such-/Sortier-Steuerelemente, aktiver Tab), Label-Verknüpfungen.
- **Phase 7 (Discovery)**: „Hofladen finden“ (Gerätestandort, Suche,
  Auswahl, Prüfen mit Herkunft, KI-Vermutung nie vorausgewählt, XSS-
  Maskierung, Übernahme in den Editor, Herkunft nur für unveränderte
  Felder) mit Fake-HA-Client; Detailansicht „Herkunft der Angaben“.

Ein echter VoiceOver-Durchgang auf einem iPhone bleibt davon unabhängig
und ist nicht automatisierbar – siehe Vorgehensplan, Phase 8c, Punkt 10.

## Einschränkung in isolierten Sandbox-Umgebungen

Leaflet liegt seit Phase 10 lokal unter `vendor/`; es wird kein CDN mehr
geladen. Die Kartenkacheln stammen weiterhin von OpenStreetMap. In Umgebungen
ohne Zugriff darauf (z. B. Sandboxes mit eingeschränktem Netzwerk) bleiben die
Kacheln leer; Netzwerkfehler dieser Kachel-Anfragen filtert die
Konsolenfehler-Prüfung heraus. Testbilder immer als `data:`-URI einbinden,
sonst schlägt die Konsolenfehler-Prüfung bei einem 404 an.

## Stand (2.0.0-rc.1)

305 Tests. Zusätzlich zur oben genannten Abdeckung prüfen sie die
Überarbeitung 2.0: Erfassen (Vor Ort, Schnellerfassung, Webseite), «Angaben
ergänzen», Filter und Suche in Liste und Karte, Leerzustände, Teilen (mit
simuliertem `navigator.share`), Navigationsdienst (Standard je Gerät, iPhone-
Simulation, Zurücksetzen), Startbild gegen `APP_VERSION`, Überlauf bei 28 px
Schrift auf sieben Ansichten, Kontraste in Hell und Dunkel sowie die vier
Sprachen. Nicht automatisierbar bleiben VoiceOver, Dynamic Type, der echte
Teilen-Dialog, der Apple-Karten-Link und die Safe Areas auf einem iPhone
(Checkliste im README).

## Sprachtests (ab 2.0.0-dev.8)

`npm run test:i18n` (läuft auch zu Beginn von `test:smoke`) prüft ohne Browser, dass alle `t()`-Texte in den Wörterbüchern FR/IT/EN stehen. Die Smoke-Tests laufen mit deutscher Browsersprache (`locale: "de-CH"`) und prüfen am Ende FR/IT/EN auf deutsche Reste.
