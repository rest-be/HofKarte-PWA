# Sicherheit und Datenschutz – HofKarte-PWA

## Über dieses Projekt

Die HofKarte-PWA ist ein **privates, nicht kommerzielles** Projekt als Begleit-App
der Home-Assistant-Integration [HofKarte](https://github.com/rest-be/HofKarte).
Es gibt kein Support-Team und keine zugesicherte Reaktionszeit.

## Unterstützte Versionen

Sicherheitskorrekturen gibt es nur für die **jeweils neueste veröffentlichte
Version** (aktuell `2.0.0`). Die App
aktualisiert sich über «Nach Update suchen» bzw. den Hinweis «Neue Version
verfügbar».

## Meldeweg

Sicherheitsrelevante Probleme bitte **nicht** als öffentliches Issue melden,
sondern über ein privates
[Security Advisory](https://github.com/rest-be/HofKarte-PWA/security/advisories/new)
in diesem Repository oder direkt beim Codeowner (`@rest-be`) auf GitHub.
Bitte angeben: App-Version (Einstellungen), HofKarte-HA-Version, Gerät und
Browser, Schritte zur Reproduktion, erwartetes und tatsächliches Verhalten –
**ohne** Tokens oder persönliche Daten.

## Sicherheitsmodell

**Reiner Client.** Die PWA hat kein eigenes Backend und keine eigene
Datenhaltung. Alle Hofladen-Daten liegen in Home Assistant; die App spricht
ausschliesslich mit deiner eigenen Instanz.

**Zugang.**
- Authentifizierung über ein **Long-Lived Access Token pro Gerät** eines
  dedizierten Home-Assistant-Benutzers. Geht ein Gerät verloren, wird nur dessen
  Token widerrufen.
- Das Token liegt nur in IndexedDB auf dem Gerät und wird nie im Service-Worker-
  Cache abgelegt, in URLs übergeben oder protokolliert. «Abmelden» entfernt es.
- Die Home-Assistant-Adresse muss `https://` verwenden (`http://` nur für
  `localhost`); die WebSocket-Verbindung ist damit verschlüsselt.
- Schreibende Befehle sowie «Hofladen finden», «Angaben ergänzen» und die
  KI-Auswertung erfordern Administratorrechte; dies erzwingt die Integration auf
  dem Server, nicht die App.

**Schutz vor eingeschleusten Inhalten (XSS).**
- Alle Daten aus Home Assistant, aus Importen und aus Webseiten werden vor der
  Anzeige maskiert (`escapeHtml`); Karten-Popups nutzen DOM-Knoten statt HTML-Text.
- Webseiten-Links werden nur mit `http(s)` übernommen (`sichereHttpUrl`).
- **Content-Security-Policy** in `index.html`: `default-src 'none'`,
  Skripte und Stile nur vom eigenen Ursprung (keine Inline-Skripte, keine
  Inline-Stile), keine Formularübermittlung, `base-uri 'none'`.
  Seit 2.1.0-dev.3 steht in `script-src` zusätzlich `'wasm-unsafe-eval'`: Es
  erlaubt ausschliesslich das Ausführen von WebAssembly (Texterkennung), kein
  `eval` und keine Inline-Skripte. In Chromium wäre es nicht nötig (der Worker
  unterliegt der Seiten-CSP nicht); es steht als Vorsicht für Safari/iOS da und
  wird nach der Abnahme auf dem iPhone überprüft. Der OCR-Worker startet aus
  einer Datei (`worker-src 'self'`), nicht aus einem `blob:`-URL.
- Texte, die von Webseiten oder von einer KI stammen, gelten als unvertrauenswürdig:
  Sie werden maskiert, nur als Vorschlag angezeigt und nie ohne ausdrückliche
  Auswahl übernommen. KI-Vermutungen sind nie vorausgewählt.

**Lieferkette.**
- Keine Drittanbieter-Skripte zur Laufzeit und kein CDN. `home-assistant-js-websocket`
  (Apache-2.0) und Leaflet (BSD-2-Clause) liegen unverändert unter `vendor/`
  (Herkunft und Update-Ablauf: `vendor/README.md`). Seit 2.1.0 kommen
  tesseract.js und tesseract.js-core (Apache-2.0) sowie die Sprachdaten
  (tessdata_best, Apache-2.0) hinzu, ebenfalls lokal und ohne Netzzugriff.
- Texterkennung: Das Foto wird nur im Browser ausgewertet und nicht hochgeladen.
- Kein Build-Schritt: Das Repository wird 1:1 über GitHub Pages ausgeliefert.
- Die App enthält keine Werbung, keine Statistik und keine Fremd-Tracker.

**Debug-Zugriff.** `window.hofkarteApp` ist nur auf `localhost` oder mit
`?debug=1` verfügbar.

## Datenschutz

| Daten | Wo | Wohin |
|---|---|---|
| Hofladen-Daten | Home Assistant | nur zu/von deiner Instanz |
| Verbindungsdaten (Adresse, Token) | IndexedDB auf dem Gerät | nur an deine Instanz |
| Lesecache, Offline-Warteschlange | IndexedDB auf dem Gerät | – |
| Sprache, Navigationsdienst, Markenfarbe, Kartenfilter | `localStorage` auf dem Gerät | nie auf einen Server |
| **Gerätestandort** | nur im Arbeitsspeicher, nach ausdrücklichem Tipp | nur an deine Instanz (Suche in der Nähe); **nie gespeichert** |

Externe Dienste werden **nur nach einem Tipp** des Benutzers kontaktiert:

- **OpenStreetMap/Nominatim:** «Adresse aus Koordinaten» sendet die Koordinaten
  des Hofladens. Karten-Kacheln lädt der Browser von OpenStreetMap
  (Daten © OpenStreetMap-Mitwirkende, ODbL).
- **Google Maps oder Apple Karten:** «Route» bzw. «Auf der Karte öffnen» öffnet
  einen Link mit Adresse bzw. Koordinaten des Hofladens; der Standort des Geräts
  wird nicht übergeben.
- **Teilen:** Name, Adresse, Öffnungszeiten und Kartenlink gehen an die vom
  Benutzer im Teilen-Menü gewählte App.
- Website-Abruf und OpenStreetMap-Suche für «Hofladen finden» laufen über die
  Integration in Home Assistant, nicht vom Gerät aus. Die Integration beachtet
  `robots.txt` und ruft nur öffentliche Adressen ab (siehe `SECURITY.md` der
  Integration).
- Die optionale **KI-Auswertung** ist nur aktiv, wenn in Home Assistant eine
  «AI Task»-Entität gewählt ist, und nie vorangekreuzt. Bei einem Cloud-Anbieter
  verlässt der Seitentext das eigene Netzwerk; die App weist darauf hin.

## Bekannte Grenzen

- Wer Zugriff auf ein entsperrtes Gerät hat, kann die App mit dem darin
  gespeicherten Token nutzen. Geräte mit Bildschirmsperre schützen, bei Verlust das
  Token in Home Assistant widerrufen.
- Der Service Worker cached nur die App-Shell, keine Hofladen-Daten; der Lesecache
  in IndexedDB enthält jedoch die zuletzt geladenen Hofladen-Daten (auch
  Kontaktdaten) unverschlüsselt.
- Der Offline-Lesecache und die Warteschlange werden bei «Abmelden» nicht
  gelöscht, ebenso wenig bei «App zurücksetzen» (das leert nur den App-Cache und
  den Service Worker). Sie verschwinden beim Löschen der App bzw. der Websitedaten
  (iOS: Einstellungen → Safari → Verlauf und Websitedaten löschen).
