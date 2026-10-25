/**
 * Leer- und Fehlerzustände im Look des Entwurfs: Symbol-Kachel, Titel,
 * kurzer Text und höchstens eine Aktion. `titel`, `text` und `aktion.label`
 * müssen bereits übersetzt sein; alles wird hier maskiert.
 */
import { escapeHtml } from "./html.js";
import { icon } from "./icons.js";

export function leerzustandHtml({ symbol = "info", titel, text = "", aktion = null }) {
  const knopf = aktion
    ? aktion.href
      ? `<a class="leerzustand-aktion" href="${escapeHtml(aktion.href)}"${aktion.id ? ` id="${escapeHtml(aktion.id)}"` : ""}>${escapeHtml(aktion.label)}</a>`
      : `<button type="button" class="leerzustand-aktion" id="${escapeHtml(aktion.id || "")}">${escapeHtml(aktion.label)}</button>`
    : "";
  return `<div class="leerzustand">
    <span class="leerzustand-icon" aria-hidden="true">${icon(symbol)}</span>
    <h2 class="leerzustand-titel">${escapeHtml(titel)}</h2>
    ${text ? `<p class="leerzustand-text">${escapeHtml(text)}</p>` : ""}
    ${knopf}
  </div>`;
}
