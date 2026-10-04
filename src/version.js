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
export const APP_VERSION = "1.5.0";
