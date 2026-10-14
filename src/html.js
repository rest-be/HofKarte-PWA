/**
 * Hilfsfunktionen gegen HTML-/URL-Injection (Phase 10, Code-Review S1–S3).
 *
 * Grundregel: Alles, was aus Home Assistant, aus Importen (OSM, Websites)
 * oder aus Nutzereingaben stammt, wird vor dem Einsetzen in `innerHTML`
 * mit `escapeHtml` behandelt (Text UND Attributwerte), und Links aus
 * Daten werden nur über `sichereHttpUrl` zu klickbaren Adressen.
 */

/** Maskiert Text für HTML-Inhalt und Attributwerte (in Anführungszeichen). */
export function escapeHtml(text) {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Gibt die URL nur zurück, wenn sie ein absolutes `http:`/`https:`-Ziel
 * ist (sonst `null`) - verhindert `javascript:`-, `data:`- und andere
 * Schemata in `href`/`src`. Liefert die normalisierte Form von `URL`.
 */
export function sichereHttpUrl(wert) {
  if (typeof wert !== "string") return null;
  const text = wert.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
