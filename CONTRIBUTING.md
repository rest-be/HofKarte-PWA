# Beitragen zur HofKarte-PWA

Die PWA ist ein privates Projekt; Beiträge sind willkommen, sollten aber vorher
als Issue besprochen werden. Zusammen mit der Integration
[HofKarte](https://github.com/rest-be/HofKarte) bildet sie ein Gespann: Die PWA
hat keine eigene Datenhaltung (siehe README, «Architektur»).

## Leitplanken

- **Bundlerfrei:** reine ES-Module, kein Build-Schritt, keine neuen Abhängigkeiten.
  Drittbibliotheken liegen unter `vendor/` (kein CDN).
- **Content-Security-Policy** `style-src 'self'`: keine Inline-Stile im Markup.
  Laufzeitwerte werden per CSSOM gesetzt (`style.setProperty`).
- **Standort** nur auf ausdrücklichen Tipp und nie gespeichert. Einzige Stelle mit
  Geolocation: `aktuellerStandort()` in `src/naehe.js`.
- **Nichts wird ohne Wahl überschrieben:** Lücken vorgewählt, Abweichungen nie,
  KI nie vorgewählt. Gespeichert wird nur im Editor.
- **Escaping:** alles aus Home Assistant, Importen und Webseiten über `escapeHtml`,
  Links über `sichereHttpUrl`.
- **Zugänglichkeit:** Touch-Ziele ≥ 44 px, Status nie nur durch Farbe,
  `prefers-reduced-motion`, Kontraste ≥ 4,5:1 in Hell und Dunkel.
- Datenmodell, Offline-Warteschlange und Versionskonflikt-Erkennung nur nach
  Absprache ändern.

## Texte und Sprachen

Der deutsche Text ist zugleich der Schlüssel: `t("Speichern")`,
`tn(n, "1 Hofladen", "{n} Hofläden")`. Jeder Text muss in den Wörterbüchern
`src/i18n/fr.js`, `it.js` und `en.js` stehen (bei `tn` Einzahl und Mehrzahl) –
mit denselben Platzhaltern. `npm run test:i18n` prüft das. Begriffe: FR «ferme»,
IT «negozio agricolo», EN «farm shop»; FR in der «vous»-Form.

## Tests

```bash
npm install
npx playwright install chromium --with-deps
npm run test:smoke      # inkl. Sprachtest; aktuell 305 Tests
```

Jede Änderung bekommt Tests. Der Test schlägt bei jedem Konsolenfehler fehl –
Testbilder deshalb als `data:`-URI einbinden. Es gibt derzeit keinen
automatischen CI-Lauf für Tests; sie werden vor Merge und Release von Hand
ausgeführt (siehe `tests/README.md`).

## Branches und Versionen

- Aktive Entwicklung auf `develop` (bzw. einem `feature/…`-Branch davon);
  `main` bildet nur den veröffentlichten Stand ab. Ein Push auf `develop` löst
  das Deployment auf GitHub Pages aus (`.github/workflows/deploy.yml`).
- Versionsschema: `<Version>-dev.<N>` während der Entwicklung,
  `<Version>-rc.<N>` für Release Candidates, danach die reine Version.
- Bei einer Versionserhöhung gemeinsam anpassen:
  1. `src/version.js` (`APP_VERSION` und ein Eintrag in `RELEASE_NOTES`)
  2. `service-worker.js` (`CACHE_VERSION`)
  3. `index.html` (Version im Startbild; der Test vergleicht sie mit `APP_VERSION`)
  4. `README.md` (Kopfzeile und Versionstabelle) und `CHANGELOG.md`
- Commit-Nachrichten: kurze erste Zeile auf Deutsch im Imperativ.

## Release-Ablauf

1. Release Candidate (`-rc.N`) auf `develop`: Dokumentation nachführen,
   Metadaten prüfen, keine funktionalen Änderungen. Test auf dem Gerät mit der
   Checkliste im README («Zugänglichkeit und Geräte-Test»).
2. Nach der Abnahme: Version auf die reine Nummer (z. B. `2.0.0`), Abschnitt im
   `CHANGELOG.md` datieren, `develop` nach `main` mergen, Tag und GitHub Release
   erstellen.
3. Zusammen mit der Integration: in README und Release Notes festhalten, welche
   HofKarte-HA-Version die PWA mindestens braucht.
