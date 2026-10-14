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
export const APP_VERSION = "1.12.0";

/**
 * Release Notes (neueste zuerst), angezeigt auf dem Einrichtungsbildschirm
 * (`views/setup.js`). Beim Erhöhen von APP_VERSION hier einen Eintrag
 * ergänzen (und die Tabelle im README nachziehen).
 */
export const RELEASE_NOTES = [
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
