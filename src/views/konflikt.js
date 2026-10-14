/**
 * Konfliktansicht (Phase 8b): wird gezeigt, wenn ein Hofladen zwischenzeitlich
 * von einem anderen Gerät geändert wurde (Versionskonflikt, siehe
 * PWA-HA-Vorgehensplan.md Abschnitt 10.4). Bewusst einfach: Es werden nur die
 * unterschiedlichen Felder nebeneinander gezeigt, der Nutzer entscheidet
 * ganz für "meine" oder ganz für die Server-Version - kein Feld-Merge.
 */

import { escapeHtml } from "./list.js";

const FELDER = [
  ["name", "Name"],
  ["beschreibung", "Beschreibung"],
  ["bemerkung", "Bemerkung"],
  ["adresse", "Adresse"],
  ["plz", "PLZ"],
  ["ort", "Ort"],
  ["land", "Land"],
  ["website", "Website"],
  ["mobilnummer", "Mobilnummer"],
  ["email", "E-Mail"],
  ["latitude", "Breitengrad"],
  ["longitude", "Längengrad"],
  ["bewertung", "Bewertung"],
  ["oeffnungszeiten", "Öffnungszeiten"],
  ["angebote", "Angebote"],
  ["zahlungsarten", "Zahlungsarten"],
  ["bilder", "Bilder"],
];

function anzeige(wert, feld) {
  if (wert == null || wert === "" || (Array.isArray(wert) && wert.length === 0)) return "–";
  if (feld === "bilder") return `${wert.length} Bild(er)`;
  if (feld === "angebote" || feld === "zahlungsarten") {
    return wert.map((t) => (typeof t === "string" ? t : t.name || t.bezeichnung || JSON.stringify(t))).join(", ");
  }
  if (feld === "oeffnungszeiten") {
    return wert.map((o) => `${o.wochentag ?? ""} ${o.beginn ?? ""}–${o.ende ?? ""}`.trim()).join("; ");
  }
  return String(wert);
}

/** Liste der Felder, die sich zwischen meiner Fassung und dem Server unterscheiden. */
export function berechneUnterschiede(meine, server) {
  const norm = (v) => (v === "" || v === undefined ? null : v);
  return FELDER.filter(
    ([feld]) => JSON.stringify(norm(meine?.[feld])) !== JSON.stringify(norm(server?.[feld]))
  ).map(([feld, label]) => ({
    feld,
    label,
    meine: anzeige(meine?.[feld], feld),
    server: anzeige(server?.[feld], feld),
  }));
}

export function renderKonflikt(container, app, hofladenId) {
  const op = app.konfliktFuer(hofladenId);
  if (!op) {
    container.innerHTML = `<p class="hinweis-leiste">Kein offener Konflikt für diesen Hofladen.</p>
      <p><a href="#/hofladen/${encodeURIComponent(hofladenId)}">Zur Detailansicht</a></p>`;
    return;
  }
  const meine = op.daten;
  const server = op.serverStand;
  const unterschiede = berechneUnterschiede(meine, server);

  container.innerHTML = `
    <h2>Versionskonflikt: ${escapeHtml(meine.name || server?.name || "")}</h2>
    <p class="hinweis-leiste">⚠ Dieser Hofladen wurde auf einem anderen Gerät geändert, seit du ihn geöffnet hast. Bitte wähle, welche Version gelten soll.</p>
    ${
      unterschiede.length
        ? `<div class="konflikt-liste">${unterschiede
            .map(
              (u) => `<section class="formular-abschnitt konflikt-feld" data-feld="${u.feld}">
                <h3>${escapeHtml(u.label)}</h3>
                <p><strong>Meine Version:</strong> ${escapeHtml(u.meine)}</p>
                <p><strong>Server-Version:</strong> ${escapeHtml(u.server)}</p>
              </section>`
            )
            .join("")}</div>`
        : `<p>Die Inhalte sind identisch – nur die Versionsnummer weicht ab.</p>`
    }
    <p id="konflikt-fehler" class="hinweis-leiste fehler" hidden></p>
    <div class="aktions-reihe">
      <button type="button" class="primaer" id="konflikt-meine">Meine Version übernehmen</button>
      <button type="button" id="konflikt-server">Server-Version übernehmen</button>
    </div>
  `;

  const fehlerBox = container.querySelector("#konflikt-fehler");
  const ausfuehren = async (aktion) => {
    container.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await aktion();
      // Konnte "meine Version" erneut kollidieren (weitere Änderung), bleibt der Konflikt offen.
      if (app.konfliktFuer(hofladenId)) {
        app.navigate(`#/konflikt/${encodeURIComponent(hofladenId)}`);
        renderKonflikt(container, app, hofladenId);
        return;
      }
      app.navigate(`#/hofladen/${encodeURIComponent(hofladenId)}`);
    } catch (err) {
      fehlerBox.textContent = err.message;
      fehlerBox.hidden = false;
      container.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  container.querySelector("#konflikt-meine").addEventListener("click", () =>
    ausfuehren(() => app.loeseKonfliktMitMeiner(hofladenId))
  );
  container.querySelector("#konflikt-server").addEventListener("click", () =>
    ausfuehren(() => app.loeseKonfliktMitServer(hofladenId))
  );
}
