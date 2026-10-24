/**
 * Einfache Textsuche über die bereits geladenen Hofläden (offlinefähig, ohne
 * Netz). Durchsucht Name, Beschreibung und Ort; Gross-/Kleinschreibung und
 * Akzente (é/e) sind egal. Treffer, die mit dem Begriff beginnen, stehen vorn.
 */

function normiert(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function suchHoflaeden(hoflaeden, begriff) {
  const b = normiert(begriff).trim();
  if (!b) return [];
  const treffer = hoflaeden.filter((h) => [h.name, h.beschreibung, h.ort].some((f) => normiert(f).includes(b)));
  const rang = (h) => (normiert(h.name).startsWith(b) ? 0 : normiert(h.name).includes(b) ? 1 : 2);
  return treffer.sort((a, c) => rang(a) - rang(c) || normiert(a.name).localeCompare(normiert(c.name)));
}
