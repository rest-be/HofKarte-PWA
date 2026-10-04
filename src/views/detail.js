/**
 * Detailansicht eines Hofladens: Hauptbild, Kontakt, Öffnungszeiten,
 * Angebote/Zahlungsarten, Bewertung (siehe Vorgehensplan Phase 4,
 * Schritt 35/36 – Bewertungsanzeige über den geteilten Wert aus
 * HofKarte-HA, keine Personenauswahl).
 */

import { escapeHtml } from "./list.js";

const WOCHENTAGE = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

function formatZeit(zeit) {
  return zeit ? zeit.slice(0, 5) : "";
}

function oeffnungszeitenHtml(h) {
  if (!h.oeffnungszeiten?.length && !h.sonderoeffnungszeiten?.length) {
    return `<p class="ort">Keine Öffnungszeiten hinterlegt.</p>`;
  }

  const nachTag = {};
  for (const oz of h.oeffnungszeiten || []) {
    (nachTag[oz.wochentag] ||= []).push(`${formatZeit(oz.beginn)}–${formatZeit(oz.ende)}`);
  }

  const regel = Object.keys(nachTag)
    .sort((a, b) => a - b)
    .map((tag) => `<div class="kontakt-zeile"><strong>${WOCHENTAGE[tag]}:</strong> ${nachTag[tag].join(", ")}</div>`)
    .join("");

  const sonder = (h.sonderoeffnungszeiten || [])
    .map((s) => {
      const zeitraum = s.datum_von === s.datum_bis ? s.datum_von : `${s.datum_von} – ${s.datum_bis}`;
      const info = s.geschlossen ? "geschlossen" : `${formatZeit(s.beginn)}–${formatZeit(s.ende)}`;
      return `<div class="kontakt-zeile">${zeitraum}: ${info}</div>`;
    })
    .join("");

  return regel + sonder;
}

function bewertungSternenHtml(wert) {
  const n = Math.max(0, Math.min(5, Number(wert) || 0));
  let html = "";
  for (let i = 1; i <= 5; i++) {
    html += `<span class="stern-btn${i <= n ? " stern-gefuellt" : ""}">★</span>`;
  }
  return `<div class="sterne-reihe" role="img" aria-label="Bewertung: ${n} von 5 Sternen">${html}</div>`;
}

export function renderDetail(container, app, hofladenId) {
  const h = app.hofladenMitId(hofladenId);

  if (!h) {
    container.innerHTML = `<p class="hinweis-leiste">Hofladen nicht gefunden.</p>`;
    return;
  }

  const kontaktZeilen = [];
  if (h.mobilnummer) {
    kontaktZeilen.push(
      `<div class="kontakt-zeile"><a href="tel:${escapeHtml(h.mobilnummer.replace(/[^\d+]/g, ""))}">📞 ${escapeHtml(h.mobilnummer)}</a></div>`
    );
  }
  if (h.email) {
    kontaktZeilen.push(`<div class="kontakt-zeile"><a href="mailto:${escapeHtml(h.email)}">✉️ ${escapeHtml(h.email)}</a></div>`);
  }
  if (h.website) {
    kontaktZeilen.push(
      `<div class="kontakt-zeile"><a href="${escapeHtml(h.website)}" target="_blank" rel="noopener">🔗 ${escapeHtml(h.website)}</a></div>`
    );
  }

  const adresseZeile = [h.adresse, [h.plz, h.ort].filter(Boolean).join(" "), h.land]
    .filter(Boolean)
    .join(", ");
  const kartenLink =
    h.latitude != null && h.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${h.latitude}&mlon=${h.longitude}#map=17/${h.latitude}/${h.longitude}`
      : null;

  container.innerHTML = `
    ${h.hauptbild_url ? `<img class="detail-bild" src="${h.hauptbild_url}" alt="" />` : ""}

    <h2>${escapeHtml(h.name)}</h2>
    ${
      h.geoeffnet === true
        ? `<span class="status-badge offen">Geöffnet</span>`
        : h.geoeffnet === false
        ? `<span class="status-badge geschlossen">Geschlossen</span>`
        : `<span class="status-badge unbekannt">Unbekannt</span>`
    }

    ${h.beschreibung ? `<p>${escapeHtml(h.beschreibung)}</p>` : ""}

    ${h.bemerkung ? `<div class="detail-abschnitt"><h3>Bemerkung</h3><p>${escapeHtml(h.bemerkung)}</p></div>` : ""}

    ${
      adresseZeile
        ? `<div class="detail-abschnitt">
             <h3>Adresse</h3>
             <div class="kontakt-zeile">${escapeHtml(adresseZeile)}</div>
           </div>`
        : ""
    }

    ${
      kontaktZeilen.length
        ? `<div class="detail-abschnitt"><h3>Kontakt</h3>${kontaktZeilen.join("")}</div>`
        : ""
    }

    ${
      h.latitude != null && h.longitude != null
        ? `<div class="detail-abschnitt">
             <h3>Standort / Koordinaten</h3>
             <div class="kontakt-zeile">${h.latitude}, ${h.longitude}</div>
             ${kartenLink ? `<div class="kontakt-zeile"><a href="${kartenLink}" target="_blank" rel="noopener">📍 Auf der Karte öffnen</a></div>` : ""}
           </div>`
        : ""
    }

    <div class="detail-abschnitt">
      <h3>Öffnungszeiten</h3>
      ${oeffnungszeitenHtml(h)}
    </div>

    ${
      h.angebote?.length
        ? `<div class="detail-abschnitt">
             <h3>Angebote</h3>
             <div class="tag-liste">${h.angebote.map((a) => `<span class="tag">${escapeHtml(a.name)}</span>`).join("")}</div>
           </div>`
        : ""
    }

    ${
      h.zahlungsarten?.length
        ? `<div class="detail-abschnitt">
             <h3>Zahlungsarten</h3>
             <div class="tag-liste">${h.zahlungsarten.map((z) => `<span class="tag">${escapeHtml(z.name)}</span>`).join("")}</div>
           </div>`
        : ""
    }

    ${
      h.bilder?.length
        ? `<div class="detail-abschnitt">
             <h3>Bilder</h3>
             <div class="tag-liste">${h.bilder
               .map(
                 (b) =>
                   `<img class="miniatur" src="${escapeHtml(b.url)}" alt="${escapeHtml(b.beschreibung || "")}" loading="lazy" style="width:72px;height:72px;object-fit:cover;border-radius:8px" />`
               )
               .join("")}</div>
           </div>`
        : ""
    }

    <div class="detail-abschnitt">
      <h3>Bewertung</h3>
      ${bewertungSternenHtml(h.bewertung)}
    </div>

    <div class="aktions-reihe">
      <button class="primaer" id="bearbeiten-btn">Bearbeiten</button>
      <button class="gefahr" id="loeschen-btn">Löschen</button>
    </div>
  `;

  container.querySelector("#bearbeiten-btn").addEventListener("click", () => {
    app.navigate(`#/hofladen/${h.id}/bearbeiten`);
  });

  container.querySelector("#loeschen-btn").addEventListener("click", async () => {
    if (!confirm(`"${h.name}" wirklich löschen?`)) return;
    try {
      await app.loescheHofladen(h.id);
      app.navigate("#/");
    } catch (err) {
      alert(err.message);
    }
  });
}
