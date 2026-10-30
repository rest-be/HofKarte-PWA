# HofKarte-PWA 2.1.0 (Release Candidate)

Drei Neuerungen für schnelleres und vollständigeres Erfassen. Voraussetzung
unverändert: **HofKarte-HA ab 2026.10.1**, für den Schalter «24h-Automat» ab
`2026.10.2`. An der Integration ändert sich nichts.

## Neu

- **Schild lesen.** Du fotografierst das Schild eines Hofladens (oder wählst ein
  Foto), die App liest Name, Adresse, Telefon, E-Mail, Webadresse,
  Öffnungszeiten, bekannte Angebote und Zahlungsarten. Das passiert direkt auf
  dem Gerät: ohne KI, ohne Upload, nach dem ersten Laden (rund 6 MB) auch
  offline. Du siehst «Aktuell · Gefunden · Status»; Lücken sind vorgewählt,
  Abweichungen nie; Herkunft «Schild (Foto)». Der erkannte Text bleibt sichtbar
  und lässt sich korrigieren. Einstiege: «Erfassen» → «Schild lesen» und Menü ⋯
  eines Hofladens.
- **Öffnungszeiten schneller erfassen.** Vorlagen (Mo–Fr 8–12 / 14–18, Mo–Sa
  8–18, Täglich 7–20), «Wie Vortag», «Auf alle Tage kopieren» und Eingabe als
  Text, z. B. «Mo-Fr 8-12, 14-18; Sa 8-12; So geschlossen» (Deutsch, Französisch,
  Italienisch, Englisch) mit Vorschau.
- **Sonderöffnungszeiten bearbeiten.** Ferien, Feiertage und besondere Zeiten
  lassen sich im Editor hinzufügen, ändern und löschen, mit Prüfung der Eingaben
  und Hinweis bei Überschneidungen.

## Unverändert

Datenmodell, Offline-Warteschlange, Versionskonflikte und Sicherheitsregeln.
Gespeichert wird weiterhin nur im Editor; nichts wird überschrieben, ohne dass du
es wählst. Der Standort wird nur auf ausdrücklichen Tipp abgefragt.

## Hinweise

- **Grösse:** Das Repository wächst um rund 18 MB (Texterkennung). Auf dem Gerät
  werden nur etwa 6 MB und erst beim ersten Gebrauch geladen.
- **Sicherheit:** Die Content-Security-Policy erlaubt zusätzlich `'wasm-unsafe-eval'`
  (nur WebAssembly), siehe `SECURITY.md`.
- **Grenzen der Texterkennung:** Handschrift, stark gestaltete oder schräg
  fotografierte Schilder werden schlecht gelesen. Jede Angabe mit dem Schild
  vergleichen.
- **Update:** Die App aktualisiert sich selbst («Neue Version verfügbar»).
