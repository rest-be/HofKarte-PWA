# HofKarte-PWA – Benutzerhandbuch

Für Version **2.0.0**. Die App zeigt und
bearbeitet die Hofläden aus deiner Home-Assistant-Integration
[HofKarte](https://github.com/rest-be/HofKarte). Sie hat keinen eigenen
Datenspeicher: Alle Hofläden liegen in Home Assistant.

## Inhalt

1. [Was du brauchst](#1-was-du-brauchst)
2. [Installieren und einrichten](#2-installieren-und-einrichten)
3. [Die App im Überblick](#3-die-app-im-überblick)
4. [Hofläden ansehen: Liste, Karte, Detail](#4-hofläden-ansehen-liste-karte-detail)
5. [Hofladen erfassen](#5-hofladen-erfassen)
6. [Hofladen bearbeiten und ergänzen](#6-hofladen-bearbeiten-und-ergänzen)
7. [Unterwegs und offline](#7-unterwegs-und-offline)
8. [Einstellungen](#8-einstellungen)
9. [Datenschutz](#9-datenschutz)
10. [Fehlerbehebung](#10-fehlerbehebung)

## 1. Was du brauchst

- Die Integration **HofKarte** in Home Assistant, mindestens Version
  `2026.10.1` (für den Schalter «24h-Automat» `2026.10.2`). Bitte zuerst die
  Integration aktualisieren, dann die App.
- Einen Zugang zu Home Assistant über **HTTPS** (zu Hause oder per VPN). Die
  App akzeptiert keine reine `http://`-Adresse.
- Ein **Long-Lived Access Token** für dieses Gerät. Zum Erfassen und Bearbeiten
  braucht das Konto Administratorrechte.
- Ein Smartphone mit aktuellem Browser (iPhone: Safari). Auf dem Computer
  funktioniert die App ebenfalls.

## 2. Installieren und einrichten

### Auf dem iPhone

1. Mit Heimnetz oder aktivem VPN in Safari `https://rest-be.github.io/HofKarte-PWA/` öffnen.
2. Teilen-Symbol → **Zum Home-Bildschirm** → Namen bestätigen. Die App startet
   danach ohne Safari-Leiste.

### Token erzeugen

Jedes Gerät bekommt sein **eigenes** Token. Geht ein Gerät verloren, widerrufst
du nur dieses eine Token, alle anderen Geräte funktionieren weiter.

1. In Home Assistant als der Benutzer `hofkarte` anmelden (oder als
   Administrator dessen Profil öffnen).
2. Profil → ganz unten **Long-Lived Access Tokens** → **Token erstellen**.
3. Einen sprechenden Namen vergeben, z. B. «HofKarte-PWA – iPhone Martina».
4. Das Token sofort kopieren. Es wird danach nicht mehr angezeigt.

### Erster Start

1. Es erscheint kurz das Startbild mit Titel, Icon und Versionsnummer.
2. Beim ersten Mal öffnet sich die **Einrichtung**: Home-Assistant-Adresse
   prüfen und das Token einfügen. Hier siehst du auch die Neuigkeiten der
   aktuellen Version.
3. Danach lädt die App die Hofläden. Die Einrichtung ist pro Gerät nur einmal
   nötig; die Verbindungsdaten bleiben auf dem Gerät.

## 3. Die App im Überblick

Unten findest du drei Tabs:

| Tab | Wofür |
|---|---|
| **Liste** | Alle Hofläden als Karten, mit Suche und Filtern |
| **Karte** | Alle Hofläden auf der Karte, mit Suche |
| **Erfassen** | Neuen Hofladen aufnehmen (vor Ort, von der Webseite, von Hand) |

Oben rechts öffnet das Zahnrad die **Einstellungen**. Oben in der Kopfzeile
erscheint bei Bedarf der Verbindungsstatus (siehe Kapitel 7).

**Öffnungsstatus** erkennst du an Form *und* Text, nicht nur an der Farbe:
Geöffnet (Punkt), Geschlossen (Strich), Unbekannt (Ring). Wo möglich steht
dabei, bis wann der Hofladen offen ist («Offen bis 18:30»).

## 4. Hofläden ansehen: Liste, Karte, Detail

### Liste

- **Suche:** Tippe Name, Ort oder einen Teil der Beschreibung. Gross-/
  Kleinschreibung und Akzente spielen keine Rolle.
- **Filter:** Der Knopf **Filter** neben der Suche (mit Zähler) klappt die
  Auswahl auf: *In der Nähe*, *Geöffnet*, *Unvollständig*, *Ohne Foto* und die
  **Sortierung**. Aktive Filter erscheinen als kleine Chips unter der Suche;
  ein Tipp darauf entfernt den Filter.
- **In der Nähe:** Erst nach deinem Tipp fragt die App den Standort deines
  Geräts ab (Standort wird nur im Speicher gehalten). Dann erscheint die
  Entfernung, und du kannst danach sortieren. Den Umkreis stellst du in den
  Einstellungen ein.
- Eine Karte zeigt Vorschaubild, Name, Ort, Status und Bewertung. «Foto fehlt»
  markiert Hofläden ohne Bild, «Unvollständig» solche mit Lücken.
- Hast du noch keine Hofläden oder passt nichts zu deiner Suche, siehst du eine
  Hinweisseite mit der passenden nächsten Aktion («Filter zurücksetzen» bzw.
  «Hofladen erfassen»).

### Karte

- Tippe einen **Marker**, um die Vorschau zu öffnen (Status, Zeiten von heute,
  Route, Details). Die Form des Markers zeigt den Status: Kreis = geöffnet,
  Quadrat = geschlossen, Ring = unbekannt.
- **Suche oben auf der Karte:** Treffer erscheinen als Liste. Ein Tipp springt
  auf den Hofladen und öffnet die Vorschau; **Alle Treffer zeigen** begrenzt die
  Karte auf alle Treffer. Ein Chip setzt die Suche zurück. Bedienbar auch mit
  Pfeiltasten, Enter und Escape.
- **Mein Standort** zeigt dich auf der Karte (nur nach Tipp).
- **Geschlossene ausblenden** zeigt nur, was gerade offen ist (wird auf diesem
  Gerät gemerkt).
- Die Zoom-Tasten sitzen unten rechts.

### Detail

Tippe einen Hofladen in Liste oder Karte.

- **Oben:** Foto, Name, Status, Sterne und (falls bekannt) Entfernung. Darunter
  die Schnellaktionen **Route**, **Anrufen**, **Webseite**, **E-Mail** (nur wenn
  die Angabe vorhanden ist). Fehlen wichtige Angaben, weist «Noch unvollständig»
  darauf hin, mit dem Knopf «Jetzt ergänzen».
- **Sieben Gruppen:** Grunddaten, Adresse & Standort, Kontakt & Webseite,
  Öffnungszeiten, Angebote & Zahlungsarten, Bilder, Herkunft. Eingeklappt zeigt
  jede Gruppe eine Kurzinfo und einen Vollständigkeitspunkt (voll, halb, leer –
  immer auch als Text). «Alle ausklappen» öffnet alles.
- **Route:** öffnet Google Maps oder Apple Karten, je nach Einstellung
  (Kapitel 8). Es gibt in der ganzen App nur diesen einen Knopf.
- **⋮-Menü:** *Bearbeiten*, *Teilen*, *Angaben ergänzen*, *Löschen …* (mit
  Rückfrage).
- **Teilen:** teilt Name, Adresse, Öffnungszeiten und einen Kartenlink über das
  Teilen-Menü deines Geräts. Gibt es keines, wird der Text in die
  Zwischenablage kopiert.
- **Herkunft:** zeigt, woher einzelne Angaben stammen (Webseite,
  OpenStreetMap, KI-Vermutung) samt Lizenzhinweis. Daten von OpenStreetMap:
  © OpenStreetMap-Mitwirkende (ODbL).
- **24h-Automat:** Statt der Wochenzeiten steht «Rund um die Uhr (24h-Automat)».

## 5. Hofladen erfassen

Tab **Erfassen** → «Wie möchtest du vorgehen?»

### Vor Ort

Für den Moment, in dem du vor dem Hofladen stehst.

1. **Standort verwenden** antippen und in iOS zustimmen. Der Standort wird nicht
   gespeichert. Den **Umkreis** wählst du mit 100, 250 oder 500 m.
2. Die App zeigt oben **Schon erfasst** (damit nichts doppelt entsteht), darunter
   neue Treffer aus OpenStreetMap. Wähle einen Treffer oder **Keiner davon:
   neuen Hofladen erfassen**.
3. **Schnellerfassung:** Name, Webseite, Standort («Aktuellen Standort
   übernehmen») und Foto («Foto aufnehmen» oder «Aus Fotos wählen»). Vor dem
   Speichern prüft die App auf Doppelte.
4. Danach zeigt «Noch offen», was fehlt, mit einem Sprung in die passende Gruppe.

Ohne Verbindung gibt es keine OpenStreetMap-Treffer und kein Foto-Hochladen; du
kannst den Hofladen trotzdem erfassen und das Foto später ergänzen.

### Von der Webseite

1. Webadresse oder Namen eintragen und **auslesen**.
2. Die gefundenen Angaben prüfen. Jede Angabe zeigt ihre Herkunft. Du wählst,
   was übernommen wird.
3. Die Auswahl landet im normalen Formular. **Gespeichert wird erst dort.**

Die Website wird nur gelesen, wenn ihre `robots.txt` es erlaubt (höchstens vier
Seiten desselben Hosts). Der Abruf läuft über deine Home-Assistant-Instanz.

### Von Hand

Ein leeres Formular mit allen Angaben (Kapitel 6).

### Erweiterte Suche

Sucht Hofläden in einem Umkreis bis 5 km (OpenStreetMap), liest deren Webseite
aus und übernimmt die gewählten Angaben samt Herkunft ins Formular. Benötigt
Administratorrechte. Den Standort fragt die App nur nach Tipp ab.

### Optionale KI-Auswertung

Erscheint nur, wenn in Home Assistant unter *HofKarte → Konfigurieren* eine
«AI Task»-Entität gewählt ist. Das Kästchen ist **nie vorausgewählt**, und es
erscheint ein Datenschutzhinweis (bei einem Cloud-Anbieter verlässt der
Seitentext dein Netzwerk). Angaben, die nicht wörtlich im Seitentext stehen,
erscheinen getrennt als **Vermutungen** und sind nie vorausgewählt.

## 6. Hofladen bearbeiten und ergänzen

### Bearbeiten

Detail → ⋮ → **Bearbeiten**, oder **Von Hand** im Tab Erfassen.

- Dieselben **sieben Gruppen** wie in der Detailansicht und im
  Home-Assistant-Panel. Grunddaten, Adresse und Angebote sind geöffnet; den Rest
  klappst du bei Bedarf auf. Der Vollständigkeitspunkt aktualisiert sich beim
  Eingeben.
- **Angebote** gibst du als Chips ein (mit Vorschlägen). **Zahlungsarten** sind
  Schalter. Die **Öffnungszeiten** stellst du pro Wochentag ein (geschlossen,
  24 Stunden, Zeiten), mit «Auf Mo–Fr kopieren». Die **Bewertung** hat ein
  «Zurücksetzen».
- **24h-Automat:** Schalter bei den Öffnungszeiten. Der Hofladen gilt dann rund
  um die Uhr als geöffnet, ausser an Tagen mit einer Sonder-Schliessung. Die
  Wochenzeiten werden nicht verwendet. Benötigt HofKarte `2026.10.2`.
- **Adresse aus Koordinaten:** In der Gruppe «Adresse & Standort». Nur nach Tipp
  werden die Koordinaten (und nichts sonst) an OpenStreetMap (Nominatim)
  gesendet. Lücken sind vorgewählt, Abweichungen nie; übernommen wird erst nach
  «Übernehmen».
- Die feste Fussleiste zeigt **Ungespeichert**. «Abbrechen» fragt bei
  Änderungen zurück. Fehlende oder ungültige Angaben öffnen die Gruppe und
  markieren das Feld.
- **Schild lesen:** Mit einem Foto vom Hofladen-Schild füllst Du Angaben
  automatisch vor. Neuer Hofladen: «Erfassen» → «Schild lesen». Bestehender
  Hofladen: Menü ⋯ → «Schild lesen». Sprache des Schildes wählen, Foto
  aufnehmen oder aus der Mediathek wählen. Das Foto wird nur auf Deinem Gerät
  ausgewertet (ohne KI, ohne Upload); beim ersten Mal werden rund 6 MB geladen,
  danach geht es auch offline. Im Vergleich siehst Du «Aktuell · Gefunden ·
  Status»: Lücken sind vorgewählt, Abweichungen nie. Der erkannte Text steht
  darunter und lässt sich korrigieren («Neu auswerten»). Die Erkennung kann sich
  irren, vergleiche jede Angabe mit dem Schild. Gespeichert wird erst im Editor.
  Das Foto selbst wird nicht als Bild des Hofladens übernommen.
- **Öffnungszeiten schneller erfassen:** Unter «Schnell erfassen» findest Du
  drei Vorlagen und «Als Text eingeben» (z. B. «Mo-Fr 8-12, 14-18; Sa 8-12;
  So geschlossen»; Kürzel in Deutsch, Französisch, Italienisch, Englisch). Die
  Vorschau zeigt, was gelesen wurde; erst «Zeiten übernehmen» ersetzt die
  Wochenzeiten (mit Rückfrage). Bei jedem Tag gibt es «Wie Vortag», «Auf Mo–Fr
  kopieren» und «Auf alle Tage kopieren».
- **Sonderöffnungszeiten** (Ferien, Feiertage) bearbeitest Du unter
  «Öffnungszeiten» mit «+ Sonderzeit hinzufügen»: Von- und Bis-Datum wählen,
  entweder «Geschlossen» lassen oder den Schalter ausschalten und Beginn/Ende
  eintragen. Mit dem ✕ entfernst Du einen Eintrag. Ein Enddatum vor dem
  Startdatum oder gleiche Beginn- und Endzeit werden beim Speichern
  beanstandet; Überschneidungen sind erlaubt und nur mit einem Hinweis markiert.

### Angaben ergänzen

Detail → ⋮ → **Angaben ergänzen**.

1. Quelle wählen: Webseite und/oder OpenStreetMap (am gespeicherten Standort,
   300 m; dein eigener Standort wird nicht abgefragt).
2. Die Tabelle vergleicht **Aktuell · Gefunden · Status**. **Lücken** (bei dir
   leer, gefunden vorhanden) sind vorgewählt. **Abweichungen** sind nie
   vorgewählt. Angebote und Zahlungsarten werden ergänzt, nie ersetzt.
3. «Übernehmen» trägt die Auswahl ins Formular ein. **Gespeichert wird erst im
   Formular.** Nichts wird ohne deine Wahl überschrieben.

### Löschen

Detail → ⋮ → **Löschen …** und bestätigen.

## 7. Unterwegs und offline

- **Ohne Verbindung** (kein VPN, kein Heimnetz) zeigt die App den zuletzt
  geladenen Stand und merkt sich Änderungen. Die Kopfzeile nennt den Zustand:
  - «Offline (n ausstehend) · Stand 14:32» – keine Verbindung, n Änderungen
    warten; die Daten sind von 14:32.
  - «Wird synchronisiert …» – Verbindung steht, die Warteschlange wird
    abgearbeitet.
  - keine Anzeige – alles synchron.
- Die App versucht alle 30 Sekunden, sich wieder zu verbinden, solange sie
  geöffnet ist. Noch nicht synchronisierte Hofläden sind in der Liste markiert.
- **Fotos** hinzufügen oder entfernen braucht eine Verbindung.
- **Konflikt:** Haben zwei Geräte denselben Hofladen geändert, lehnt Home
  Assistant die spätere Änderung ab, statt etwas zu überschreiben. Die Kopfzeile
  zeigt «Konflikt», die Konfliktansicht stellt die abweichenden Felder
  nebeneinander. Du entscheidest ganz oder gar nicht: **Meine Version
  übernehmen** oder **Server-Version übernehmen**. Bis dahin sind weitere
  Änderungen an diesem Hofladen gesperrt. Löschen prüft keine Version.

## 8. Einstellungen

Zahnrad oben rechts. Alle Einstellungen ausser Verbindung und Token gelten
**nur auf diesem Gerät**.

| Bereich | Was du einstellst |
|---|---|
| **Darstellung** | Markenfarbe (Voreinstellungen oder eigene Farbe, «Zurücksetzen» = Grün). Die Schrift auf der Farbe bleibt automatisch gut lesbar. Hell/Dunkel folgt dem Gerät. |
| **Sprache** | Automatisch (Browsersprache), Deutsch, Français, Italiano, English. |
| **Navigation** | Google Maps oder Apple Karten für den Knopf «Route». Standard: Apple Karten auf iPhone/iPad, sonst Google Maps. «Zurücksetzen» stellt den Standard wieder her. |
| **Hofläden in der Nähe** | Umkreis in Metern für die Funktion «In der Nähe» in der Liste (Standard 500). |
| **Verbindung** | Zeigt die Home-Assistant-Adresse (nicht änderbar; dafür abmelden). |
| **Token ändern** | Neues Token hinterlegen, z. B. nach Widerruf des alten. |
| **Abmelden** | Entfernt Adresse und Token von diesem Gerät. Danach erscheint die Einrichtung. |
| **Version** | Installierte Version, **Nach Update suchen**, **App zurücksetzen** (die Anmeldung bleibt erhalten). |

Die **Schriftgrösse** folgt der Textgrösse deines Geräts (iPhone:
Einstellungen → Anzeige & Helligkeit → Textgrösse).

**Updates:** Die App prüft selbst auf neue Versionen und zeigt «Neue Version
verfügbar». Wenn die Anzeige hängt, hilft «Nach Update suchen», im Notfall «App
zurücksetzen».

## 9. Datenschutz

- **Standort:** Wird nur nach deinem ausdrücklichen Tipp abgefragt (Liste «In der
  Nähe», Karte «Mein Standort», «Vor Ort», «Erweiterte Suche», «Aktuellen
  Standort übernehmen») und **nie gespeichert**. Er geht nur an deine eigene
  Home-Assistant-Instanz, zur Suche von OpenStreetMap-Treffern in der Nähe.
- **Daten:** Alle Hofläden liegen in deiner Home-Assistant-Instanz. Auf dem Gerät
  liegen nur Verbindungsdaten, ein Lesecache, die Warteschlange und
  Geräteeinstellungen.
- **Externe Dienste, nur nach Tipp:** OpenStreetMap/Nominatim («Adresse aus
  Koordinaten»: nur die Koordinaten), Google Maps oder Apple Karten (beim Tippen
  auf «Route»: Adresse bzw. Koordinaten des Hofladens als Link-Parameter). Die
  Kartenkacheln lädt der Browser von OpenStreetMap.
- **Keine Fremdskripte:** Alle Bibliotheken liegen in der App selbst. Es gibt
  keine Werbung und keine Statistik.
- Mehr dazu in [`SECURITY.md`](../SECURITY.md).

## 10. Fehlerbehebung

| Problem | Lösung |
|---|---|
| «Offline» oder keine Daten | VPN bzw. Heimnetz prüfen. Die App zeigt den letzten Stand und synchronisiert, sobald die Verbindung wieder da ist. |
| Einrichtung lehnt die Adresse ab | Die Adresse muss mit `https://` beginnen (`http://` nur für `localhost`). |
| «Verbindung abgelehnt» / Anmeldung schlägt fehl | Token prüfen oder neu erzeugen (Einstellungen → Token ändern). |
| Speichern nicht möglich | Das Token braucht Administratorrechte. Bei einer älteren Integration einen Fehler beim Speichern neuer Felder (z. B. 24h-Automat): zuerst die Integration aktualisieren. |
| «Hofladen finden» fehlt oder meldet einen Fehler | Benötigt HofKarte-HA `2026.10.1` oder neuer und Administratorrechte. |
| Standort funktioniert nicht | In iOS die Standortfreigabe für Safari/die App erlauben (Einstellungen → Datenschutz & Sicherheit → Ortungsdienste). Ohne Zustimmung bleibt die Funktion aus; die App zeigt eine Anleitung. |
| Foto lässt sich nicht hochladen | Verbindung prüfen; erlaubt sind JPEG, PNG, GIF bis 10 MB (grosse Bilder verkleinert die App vor dem Hochladen). |
| Alte Version nach Update | «Nach Update suchen». Stammt die installierte Version von vor `2.0.0-dev.4`, einmal den Link im Browser öffnen und die Verknüpfung neu anlegen. |
| Alles hängt | Einstellungen → «App zurücksetzen» (Anmeldung bleibt erhalten). |
| Teilen geht nicht | Der Browser bietet kein Teilen-Menü; die App kopiert den Text dann in die Zwischenablage. |
| CarPlay | Nicht möglich mit einer PWA. «Route» öffnet Apple Karten, die auch in CarPlay navigieren können. |

Fehler bitte als GitHub-Issue melden und die Version aus den Einstellungen
angeben.
