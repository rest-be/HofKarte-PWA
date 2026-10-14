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

Die Kartenansicht lädt Leaflet weiterhin über ein CDN (bewusst, kein
Bundler). In Umgebungen ohne Zugriff auf dieses CDN (z. B. manche
CI-Sandboxes mit eingeschränktem Netzwerk-Egress) kann die Karte nicht
vollständig rendern; der Test prüft in diesem Fall nur, dass das Modul
korrekt exportiert und ladbar ist, und filtert reine CDN-Netzwerkfehler
aus der Konsolenfehler-Prüfung heraus. In GitHub Actions (voller
Internetzugriff) rendert die Karte normal.
