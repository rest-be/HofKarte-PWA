# HofKarte-PWA

Progressive Web App für HofKarte – ein reiner, zustandsloser Client für die
[HofKarte-HA](https://github.com/rest-be/HofKarte-HA) Home-Assistant-Integration.

## Architektur

- **Keine eigene Datenhaltung.** Alle Hofladen-Daten (Namen, Adressen,
  Öffnungszeiten, Bewertung, Bilder, Angebote, Zahlungsarten …) leben
  ausschliesslich in der HofKarte-HA-Integration und werden live über deren
  WebSocket-Management-API (`hofkarte/management/*`) geladen und
  gespeichert. Die PWA speichert lokal nur:
  - die Verbindungsdaten (HA-URL + Long-Lived Access Token) in IndexedDB,
  - einen Lesecache der zuletzt geladenen Hofladen-Liste (stale-while-
    revalidate, für Offline-/Degraded-Anzeige).
- **Authentifizierung** über ein pro Gerät erzeugtes Long-Lived Access
  Token eines dedizierten `hofkarte`-Admin-Benutzers in Home Assistant
  (siehe Vorgehensplan, Phase 1) – kein gemeinsames Passwort.
- **Kommunikation** direkt per `home-assistant-js-websocket` (nativ als
  ES-Modul von jsDelivr geladen, kein Bundler) gegen die intern per
  DuckDNS/HTTPS erreichbare HA-Instanz (Phase 2).
- **Kartenansicht** via Leaflet + OpenStreetMap, farbige Marker analog zum
  HA-Panel.
- **Hosting** als statische Seite über GitHub Pages aus diesem Repository,
  erreichbar unter **`https://rest-be.github.io/HofKarte-PWA/`**.

## Deployment (GitHub Pages)

Das Deployment läuft automatisch über `.github/workflows/deploy.yml` bei
jedem Push auf `main` (kein Build-Schritt nötig, da kein Bundler verwendet
wird – der Repo-Inhalt wird 1:1 veröffentlicht). Einmalig einzurichten:

1. Repo-Settings → **Pages** → unter "Build and deployment" die Quelle auf
   **"GitHub Actions"** stellen (nicht "Deploy from a branch").
2. Danach einen Push auf `main` auslösen (oder den Workflow manuell unter
   "Actions" → "Deploy auf GitHub Pages" → "Run workflow" starten).
3. Die PWA ist danach unter `https://rest-be.github.io/HofKarte-PWA/`
   erreichbar.

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
  naehe.js                „Hofläden in der Nähe“ (Geolocation + HA-Action)
  styles.css              Stylesheet
  views/
    setup.js              Einrichtung (HA-URL + Token)
    list.js                Listenansicht
    detail.js              Detailansicht
    editor.js              Erstellen/Bearbeiten
    map.js                 Kartenansicht
icons/                  App-Icons (192/512/Apple Touch/Favicon)
```

## Voraussetzungen auf HA-Seite

Siehe Projekt-Dokument `PWA-HA-Vorgehensplan.md`:

- HofKarte-HA-Integration installiert und konfiguriert.
- Dedizierter Admin-Benutzer `hofkarte` mit Long-Lived Access Token pro
  Gerät.
- HA extern/intern per HTTPS erreichbar (z. B. via DuckDNS-Add-on).

## Bekannte Einschränkungen (MVP)

- Sonderöffnungszeiten werden in der PWA nicht bearbeitet (nur angezeigt) –
  dafür die native HA-Verwaltungsoberfläche verwenden.
- Bilder werden nur als URL hinterlegt, kein direkter Upload aus der PWA.
