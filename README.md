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
bleiben lokal in IndexedDB gespeichert, bis sie über „Einrichtung
zurücksetzen“ (geplant) oder durch Löschen der App entfernt werden.

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

Siehe Projekt-Dokument `PWA-HA-Vorgehensplan.md`:

- HofKarte-HA-Integration installiert und konfiguriert.
- Dedizierter Admin-Benutzer `hofkarte` mit Long-Lived Access Token pro
  Gerät.
- HA extern/intern per HTTPS erreichbar (z. B. via DuckDNS-Add-on).
- **`cors_allowed_origins`** in `configuration.yaml`, damit der Browser
  Anfragen von `https://rest-be.github.io` akzeptiert – sowohl für die
  WebSocket-Verbindung selbst als auch für den Foto-Upload (`POST
  /api/image/upload`, siehe unten). Ohne diese Einstellung schlagen
  Verbindungsaufbau bzw. Upload mit einem CORS-Fehler fehl.

## Fotos hinzufügen

Im Editor können Bilder auf zwei Arten direkt aus der PWA heraus
hinzugefügt werden, zusätzlich zur bisherigen Möglichkeit, eine externe
Bild-Adresse einzutragen:

- **📷 Foto aufnehmen** – öffnet die Kamera direkt.
- **🖼️ Aus Fotos wählen** – öffnet die Fotobibliothek des Geräts.

Beides läuft über Home Assistants eigene `image_upload`-Komponente
(`POST /api/image/upload`, Ausliefern unter
`/api/image/serve/<id>/original`) – dieselbe, die auch die native
HA-Verwaltungsoberfläche nutzt. Es gibt dafür keinen eigenen
HofKarte-PWA-Speicher; die Bilder liegen wie gewohnt in Home Assistant.

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
`PWA-HA-Vorgehensplan.md`, Phase 8a, für die Begründung. Ebenso noch
offen: eine echte Konflikterkennung, falls zwei Geräte denselben Hofladen
offline ändern (aktuell gewinnt schlicht die zuletzt erfolgreich
synchronisierte Version) – das ist Phase 8b und setzt eine kleine
Erweiterung der Home-Assistant-Integration voraus.

## Bekannte Einschränkungen (MVP)

- Sonderöffnungszeiten werden in der PWA nicht bearbeitet (nur angezeigt) –
  dafür die native HA-Verwaltungsoberfläche verwenden.
- Fotos hinzufügen/entfernen erfordert eine aktive Verbindung zu Home
  Assistant (siehe Abschnitt „Offline-Betrieb“ oben).
- Keine Konflikterkennung, falls zwei Geräte denselben Hofladen offline
  ändern (siehe Abschnitt „Offline-Betrieb“ oben) – geplant für Phase 8b.
