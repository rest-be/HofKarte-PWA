/**
 * Zentrale Versionsnummer der HofKarte-PWA – eine einzige Quelle der
 * Wahrheit, damit sich auf einem Gerät nachvollziehen lässt, welcher
 * Stand installiert ist (z. B. für den Support: "welche Version hast
 * du?"). Wird angezeigt in der Einstellungen-Ansicht
 * (`views/einstellungen.js`) und im README auf der GitHub-Seite des
 * Repos.
 *
 * Unabhängig von `CACHE_VERSION` in `service-worker.js`: Letztere
 * steuert nur, wann der Service Worker seinen App-Shell-Cache
 * invalidiert (muss bei jeder inhaltlichen Änderung an gecachten
 * Dateien erhöht werden, siehe Vorgehensplan Phase 7). `APP_VERSION`
 * ist rein informativ für Menschen und wird nur bei für Reto/Familie
 * sichtbaren, nennenswerten Änderungen erhöht (einfaches Schema
 * `MAJOR.MINOR.PATCH`, kein strenges SemVer nötig für eine
 * Einzelhaushalt-App).
 *
 * Beim Erhöhen bitte auch im README (Abschnitt "Version") und im
 * Vorgehensplan nachziehen.
 */
export const APP_VERSION = "2.0.0-dev.7";

/**
 * Release Notes (neueste zuerst), angezeigt auf dem Einrichtungsbildschirm
 * (`views/setup.js`). Beim Erhöhen von APP_VERSION hier einen Eintrag
 * ergänzen (und die Tabelle im README nachziehen).
 */
export const RELEASE_NOTES = [
  {
    version: "2.0.0-dev.7",
    datum: "2026-10-14",
    punkte: [
      "Zugänglichkeit: Fokus folgt Seiten- und Schrittwechseln, „Zum Inhalt“, sichtbarer Tastaturfokus, genau eine Hauptüberschrift pro Ansicht.",
      "Kontraste in Hell und Dunkel auf mindestens 4,5:1 angehoben (Gedämpft, Erfolg, Fehler).",
      "„Erweiterte Suche“ fragt den Standort nur noch auf Tipp („Mein Standort“).",
    ],
  },
  {
    version: "2.0.0-dev.6",
    datum: "2026-10-14",
    punkte: [
      "Liste: Filter-Chips „In der Nähe“, „Geöffnet“ und „Unvollständig“. Die Entfernung erscheint erst nach Tipp auf „In der Nähe“ (Standort nur im Speicher) und kann als Sortierung gewählt werden.",
      "Karte: Tipp auf einen Marker öffnet eine Vorschau mit Status, Heute-Zeiten, Route und Details; „Mein Standort“ nur auf Tipp; Marker mit Form (Kreis, Quadrat, Ring) statt nur Farbe; Filter „Nur geöffnet“.",
    ],
  },
  {
    version: "2.0.0-dev.5",
    datum: "2026-10-14",
    punkte: [
      "Erfassen „Von der Webseite“: Webadresse eintragen, auslesen, Angaben prüfen und ins Formular übernehmen (optional mit KI, nie vorgewählt).",
      "„Angaben ergänzen“ für bestehende Hofläden (im ⋮-Menü der Detailansicht): Vergleich Aktuell · Gefunden · Status. Lücken sind vorgewählt, Abweichungen nie, Listen werden ergänzt, KI-Vermutungen stehen getrennt. Gespeichert wird erst im Formular.",
    ],
  },
  {
    version: "2.0.0-dev.4",
    datum: "2026-10-14",
    punkte: [
      "Neuer Tab „Erfassen“ mit Einstieg und drei Wegen: Vor Ort, Von der Webseite, Von Hand („Erweiterte Suche“ bleibt erreichbar).",
      "Vor Ort: Standort nur auf Tipp (wird nie gespeichert), Umkreis 100/250/500 m, „Schon erfasst“ zuoberst, neue Treffer aus OpenStreetMap, „Keiner davon“.",
      "Schnellerfassung mit Name, Webseite, Standort und Foto; Warnung vor Doppelten; danach „Noch offen“ mit Sprung in die passende Gruppe. Ohne Verbindung: „Foto später ergänzen“.",
      "Update-Funktion: die App sucht selbst nach neuen Versionen und zeigt „Neue Version verfügbar“; in den Einstellungen „Nach Update suchen“ und „App zurücksetzen“ (Anmeldung bleibt erhalten).",
    ],
  },
  {
    version: "2.0.0-dev.3",
    datum: "2026-10-14",
    punkte: [
      "Bearbeiten neu: dieselben sieben Gruppen wie in der Detailansicht (Grunddaten, Adresse & Standort, Kontakt & Webseite, Öffnungszeiten, Angebote & Zahlungsarten, Bilder, Herkunft), mit Vollständigkeitspunkt, der sich beim Eingeben aktualisiert.",
      "Angebote als Chips mit Vorschlägen, Zahlungsarten als Schalter, Öffnungszeiten pro Wochentag mit „Auf Mo–Fr kopieren“, Bewertung mit „Zurücksetzen“.",
      "Feste Fussleiste mit „Ungespeichert“, Abbrechen fragt bei Änderungen zurück; fehlende oder ungültige Angaben öffnen die Gruppe und markieren das Feld.",
      "Leiste „Angaben automatisch ergänzen“ (Webseite, Hofladen finden).",
    ],
  },
  {
    version: "2.0.0-dev.2",
    datum: "2026-10-14",
    punkte: [
      "Detailansicht neu: Kopf mit Status und Bewertung, Schnellaktionen (Route, Anrufen, Webseite, E-Mail), Hinweis „Noch unvollständig“ mit Sprung zum Bearbeiten.",
      "Sieben Gruppen wie im Home-Assistant-Panel (Grunddaten, Adresse & Standort, Kontakt & Webseite, Öffnungszeiten, Angebote & Zahlungsarten, Bilder, Herkunft), einklappbar, mit Vollständigkeitspunkt und Kurzinfo; „Alle ausklappen“.",
      "Löschen liegt im ⋮-Menü und verlangt weiterhin eine Bestätigung.",
    ],
  },
  {
    version: "2.0.0-dev.1",
    datum: "2026-10-14",
    punkte: [
      "Entwicklungsstand der Überarbeitung 2.0.0: neues Grundgerüst der Oberfläche.",
      "App standardmässig in Grün; in den Einstellungen unter „Darstellung“ lässt sich die Markenfarbe pro Gerät wählen (Voreinstellungen oder eigene Farbe, Schrift bleibt gut lesbar).",
      "Eigene Symbole statt Emojis; der Öffnungsstatus zeigt zusätzlich zur Farbe eine Form.",
    ],
  },
  {
    version: "1.12.0",
    datum: "2026-10-09",
    punkte: [
      "Neu: „Hofladen finden“ unter „Neu“ – sucht Hofläden in der Nähe (OpenStreetMap, Standort des Geräts, max. 5 km), liest deren Website aus und übernimmt die gewählten Angaben samt Herkunft ins Formular (benötigt HofKarte-HA ab 2026.10.1 und Administratorrechte).",
      "Optional mit KI-Auswertung (nur wenn in Home Assistant eine AI-Task-Entität gewählt ist; nie vorausgewählt, Vermutungen werden getrennt und ungeprüft markiert).",
      "Detailansicht: „Herkunft der Angaben“.",
    ],
  },
  {
    version: "1.11.0",
    datum: "2026-10-06",
    punkte: [
      "Foto-Upload (Kamera/Fotobibliothek) läuft über die bestehende Home-Assistant-Verbindung und braucht kein CORS mehr (benötigt aktualisierte HofKarte-HA-Integration; sonst Fallback wie bisher).",
      "Karte: Schalter „Geschlossene ausblenden“ (wird pro Gerät gemerkt).",
    ],
  },
  {
    version: "1.10.0",
    datum: "2026-10-05",
    punkte: [
      "Suchfeld behält beim Tippen den Fokus; Eingaben im Editor gehen bei der automatischen Wiederverbindung nicht mehr verloren.",
      "Sicherheit: Inhalte aus Home Assistant werden durchgehend maskiert, Webseiten-Links nur noch mit http/https, Content-Security-Policy aktiv, https-Adresse für Home Assistant Pflicht.",
      "Karte und Verbindungsbibliothek liegen lokal in der App (kein CDN) – Kaltstart auch offline.",
      "Schneller: verkleinerte Vorschaubilder in Liste und Galerie, Fotos werden vor dem Upload verkleinert.",
    ],
  },
  {
    version: "1.9.0",
    datum: "2026-10-05",
    punkte: [
      "Einstellungen: Umkreis für „Hofläden in der Nähe“ einstellbar (neue Gruppe ganz oben).",
      "Standard-Umkreis neu 500 Meter (bisher 1000).",
    ],
  },
  {
    version: "1.8.2",
    datum: "2026-10-05",
    punkte: ["Detailansicht: Öffnungszeiten sind einklappbar und zeigen eingeklappt die heutigen Zeiten."],
  },
  {
    version: "1.8.1",
    datum: "2026-10-05",
    punkte: ["Detailansicht: „Auf der Karte öffnen“ öffnet jetzt Google Maps."],
  },
  {
    version: "1.8.0",
    datum: "2026-10-05",
    punkte: [
      "Einstellungen neu geordnet: Verbindung, Token ändern, Abmelden, Version (nur die Nummer).",
      "Liste: „Hofläden in der Nähe“ ist einklappbar und standardmässig eingeklappt.",
      "Einrichtungsbildschirm zeigt Versionsnummer und Release Notes.",
    ],
  },
  {
    version: "1.7.0",
    datum: "2026-10-05",
    punkte: [
      "iOS-Optik: System-Schrift und -Farben, Dark Mode, Large Title, Blur-Leisten, Tab-Icons.",
      "Gruppierte Listen und Formulare, Seitenübergänge, Swipe-back.",
    ],
  },
  {
    version: "1.6.0",
    datum: "2026-10-05",
    punkte: [
      "Versionskonflikte erkennen: Konfliktansicht mit „Meine Version übernehmen“ / „Server-Version übernehmen“.",
    ],
  },
  {
    version: "1.5.0",
    datum: "2026-10-04",
    punkte: ["Versionsanzeige in den Einstellungen."],
  },
  {
    version: "1.4.0",
    datum: "2026-10-04",
    punkte: ["Automatische Smoke-Tests (Playwright) und CI-Workflow."],
  },
  {
    version: "1.3.0",
    datum: "2026-10-04",
    punkte: ["Bedienbarkeit: grössere Touch-Flächen, „Bewegung reduzieren“, Beschriftungen für VoiceOver."],
  },
  {
    version: "1.2.0",
    datum: "2026-10-04",
    punkte: ["Offline-Betrieb: Anlegen, Ändern und Löschen auch ohne Verbindung, automatische Synchronisation."],
  },
  {
    version: "1.1.0",
    datum: "2026-10-04",
    punkte: ["Neue Oberfläche mit Einstellungen, neues Icon, Foto-Upload."],
  },
  {
    version: "1.0.0",
    datum: "2026-10-02",
    punkte: ["Erster produktiver Stand: Liste, Karte, Detail, Editor, Anbindung an Home Assistant."],
  },
];
