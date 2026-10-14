/**
 * Fokusführung (Zugänglichkeit): Bei Seiten- und Schrittwechseln wird der
 * Fokus auf die neue Überschrift bzw. Statusmeldung gesetzt, damit
 * Screenreader (VoiceOver) und Tastatur nicht im alten Inhalt hängen bleiben.
 */

/** Fokussiert ein Element programmatisch (ohne Scrollen). */
export function fokussiere(el) {
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/** Fokus auf das Schritt-Element (`[data-fokus]`) im Container. */
export function fokussiereSchritt(container) {
  fokussiere(container.querySelector("[data-fokus]"));
}
