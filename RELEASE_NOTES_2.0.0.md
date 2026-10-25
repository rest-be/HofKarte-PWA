# HofKarte-PWA 2.0.0

Eine grundlegend überarbeitete Oberfläche, schnelleres Erfassen vor Ort und vier
Sprachen. Voraussetzung: **HofKarte-HA ab 2026.10.1**; für den Schalter
«24h-Automat» ab `2026.10.2`. Bitte zuerst die Integration aktualisieren, dann die
App.

## Neu

- **Neues Erscheinungsbild** in Grün (Markenfarbe wählbar), Karten, Statuspillen,
  Tableiste, Symbole statt Emojis, Dunkelmodus. Ein Startbild zeigt Titel, Icon
  und Version.
- **Erfassen vor Ort in einer Minute:** Standort auf Tipp, Treffer aus
  OpenStreetMap, Schnellerfassung mit Foto, Warnung vor Doppelten.
- **Von der Webseite erfassen** und **Angaben ergänzen** (Webseite,
  OpenStreetMap, optional KI). Lücken sind vorgewählt, Abweichungen nie, KI nie.
- **Detail und Bearbeiten** mit denselben sieben Gruppen wie im Home-Assistant-
  Panel, mit Vollständigkeitsanzeige.
- **Liste:** Suche, Filter (In der Nähe, Geöffnet, Unvollständig, Ohne Foto) hinter
  einem Knopf, aktive Filter als Chips. **Karte:** Suche mit «Alle Treffer zeigen»,
  Vorschau, «Mein Standort».
- **Route mit Wahl:** Google Maps oder Apple Karten, zentral in den Einstellungen.
  Standard auf iPhone/iPad: Apple Karten.
- **Teilen** eines Hofladens (Name, Adresse, Öffnungszeiten, Kartenlink).
- **Vier Sprachen:** Deutsch, Français, Italiano, English.
- **24h-Automat** und **Adresse aus Koordinaten** im Editor.
- **Offline-Anzeige** mit Stand der Daten («Stand 14:32»), neue Leerzustände,
  «Foto fehlt» mit Filter.
- **Zugänglichkeit:** Fokusführung, Tastatur, Kontraste ≥ 4,5:1, Schrift folgt der
  Gerätegrösse, «Bewegung reduzieren».

## Unverändert

Datenmodell, Offline-Warteschlange, Versionskonflikte und Sicherheitsmassnahmen
(Escaping, Content-Security-Policy, https-Pflicht, lokale Bibliotheken). Der
Standort wird weiterhin nur auf ausdrücklichen Tipp abgefragt und nie gespeichert.

## Hinweise zum Update

- Die App aktualisiert sich selbst: «Neue Version verfügbar» antippen oder in den
  Einstellungen «Nach Update suchen». Stammt die installierte Version von vor
  `2.0.0-dev.4`, einmal den Link im Browser öffnen und die Verknüpfung neu anlegen.
- Sprache und Navigationsdienst stellst du neu unter *Einstellungen* ein; ohne
  Wahl gelten die Browsersprache bzw. der Standard je Gerät.

## Bekannte Einschränkungen

- Nicht auf einem echten Gerät abgenommen: Dynamic Type, VoiceOver, Teilen-Dialog,
  Apple-Karten-Link, Startbild (Safe Areas).
- Übersetzungen FR/IT/EN noch nicht von Muttersprachler:innen geprüft.
- Sonderöffnungszeiten werden angezeigt, aber nicht bearbeitet (Panel in Home
  Assistant verwenden). Fotos brauchen eine Verbindung.
- CarPlay ist mit einer PWA nicht möglich.

Vollständige Anleitung: [`docs/benutzerhandbuch.md`](docs/benutzerhandbuch.md),
alle Änderungen: [`CHANGELOG.md`](CHANGELOG.md).
