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
export const APP_VERSION = "1.8.0";

/**
 * Release Notes (neueste zuerst), angezeigt auf dem Einrichtungsbildschirm
 * (`views/setup.js`). Beim Erhöhen von APP_VERSION hier einen Eintrag
 * ergänzen (und die Tabelle im README nachziehen).
 */
export const RELEASE_NOTES = [
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
