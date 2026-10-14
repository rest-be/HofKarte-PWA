/**
 * Detailansicht eines Hofladens (ab 2.0.0): Kopf mit Bild, Name, Status und
 * Bewertung, Schnellaktionen (Route, Anrufen, Webseite, E-Mail), Hinweis auf
 * fehlende Angaben und die sieben Gruppen wie im Home-Assistant-Panel
 * (siehe src/gruppen.js). Bearbeiten und Löschen liegen im Kopfbereich bzw.
 * im ⋮-Menü, Löschen verlangt eine Bestätigung.
 */

import { escapeHtml, sichereHttpUrl } from "../html.js";
import { vorschauUrl } from "../bilder.js";
import { FINDEN_QUELLEN_LABEL, FINDEN_ZEILEN } from "./../finden.js";
import { icon } from "../icons.js";
import { HOF_GRUPPEN, VOLLSTAENDIGKEIT_TEXT, formatZeit, offeneGruppen, vollstaendigkeit } from "../gruppen.js";

const WOCHENTAGE = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Merkt sich pro Gruppe, ob sie aufgeklappt ist (bis zum Neuladen); ohne Eintrag gilt der Standard der Gruppe. */
const gruppenZustand = new Map();

function oeffnungszeitenHtml(h) {
  if (!h.oeffnungszeiten?.length && !h.sonderoeffnungszeiten?.length) {
    return `<p class="ort">Keine Öffnungszeiten hinterlegt.</p>`;
  }

  const heute = ((new Date().getDay() + 6) % 7) + 1; // 1 = Montag
  const nachTag = {};
  for (const oz of h.oeffnungszeiten || []) {
    (nachTag[oz.wochentag] ||= []).push(`${formatZeit(oz.beginn)}–${formatZeit(oz.ende)}`);
  }

  const regel = Object.keys(nachTag)
    .sort((a, b) => a - b)
    .map((tag) => {
      const istHeute = Number(tag) === heute;
      return `<div class="kontakt-zeile${istHeute ? " heute" : ""}"><strong>${escapeHtml(WOCHENTAGE[tag])}:</strong> ${escapeHtml(nachTag[tag].join(", "))}${istHeute ? ` <span class="heute-marke">heute</span>` : ""}</div>`;
    })
    .join("");

  const sonder = (h.sonderoeffnungszeiten || [])
    .map((s) => {
      const zeitraum = s.datum_von === s.datum_bis ? s.datum_von : `${s.datum_von} – ${s.datum_bis}`;
      const info = s.geschlossen ? "geschlossen" : `${formatZeit(s.beginn)}–${formatZeit(s.ende)}`;
      return `<div class="kontakt-zeile">${escapeHtml(zeitraum)}: ${escapeHtml(info)}</div>`;
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

/** „Herkunft der Angaben“: aus welcher Quelle ein Feld stammt (nur wenn
 * der Hofladen über „Hofladen finden“ erfasst wurde). Vermutungen der KI
 * sind als solche gekennzeichnet. */
export function herkunftHtml(h) {
  const quellen = Array.isArray(h.quellen) ? h.quellen : [];
  if (!quellen.length) return "";
  const zeilen = [];
  const gesehen = new Set();
  for (const zeile of FINDEN_ZEILEN) {
    const q = zeile.felder.map((f) => quellen.find((x) => x.feld === f)).find(Boolean);
    if (!q || gesehen.has(zeile.key)) continue;
    gesehen.add(zeile.key);
    const label = FINDEN_QUELLEN_LABEL[q.quelle] || q.quelle;
    const vermutet = q.status === "inferred" ? " (vermutet)" : "";
    const url = sichereHttpUrl(q.url);
    const text = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
      : escapeHtml(label);
    zeilen.push(`<div class="kontakt-zeile"><strong>${escapeHtml(zeile.label)}:</strong> ${text}${escapeHtml(vermutet)}</div>`);
  }
  if (!zeilen.length) return "";
  const osm = quellen.some((q) => q.quelle === "openstreetmap");
  return `${zeilen.join("")}${osm ? `<p class="muted">© OpenStreetMap-Mitwirkende (ODbL)</p>` : ""}`;
}

function leer(text) {
  return `<p class="ort">${escapeHtml(text)}</p>`;
}

/** Inhalt der einzelnen Gruppen; leere Gruppen zeigen einen kurzen Hinweis. */
function gruppenInhalt(id, h) {
  switch (id) {
    case "grunddaten": {
      const teile = [];
      if (h.beschreibung) teile.push(`<p class="gruppen-text">${escapeHtml(h.beschreibung)}</p>`);
      teile.push(`<div class="kontakt-zeile"><strong>Bewertung:</strong> ${bewertungSternenHtml(h.bewertung)}</div>`);
      if (h.bemerkung) teile.push(`<div class="kontakt-zeile"><strong>Bemerkung:</strong> ${escapeHtml(h.bemerkung)}</div>`);
      return teile.join("");
    }
    case "adresse": {
      const adresseZeile = [h.adresse, [h.plz, h.ort].filter(Boolean).join(" "), h.land].filter(Boolean).join(", ");
      const hatKoordinaten = h.latitude != null && h.longitude != null;
      const kartenLink = hatKoordinaten
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.latitude)},${encodeURIComponent(h.longitude)}`
        : null;
      if (!adresseZeile && !hatKoordinaten) return leer("Keine Adresse hinterlegt.");
      return (
        (adresseZeile ? `<div class="kontakt-zeile">${escapeHtml(adresseZeile)}</div>` : "") +
        (hatKoordinaten ? `<div class="kontakt-zeile">${escapeHtml(h.latitude)}, ${escapeHtml(h.longitude)}</div>` : "") +
        (kartenLink
          ? `<div class="kontakt-zeile"><a href="${escapeHtml(kartenLink)}" target="_blank" rel="noopener noreferrer">${icon("standort", { klein: true })} Auf der Karte öffnen</a></div>`
          : "")
      );
    }
    case "kontakt": {
      const zeilen = [];
      if (h.mobilnummer) {
        zeilen.push(
          `<div class="kontakt-zeile"><a href="tel:${escapeHtml(h.mobilnummer.replace(/[^\d+]/g, ""))}">${icon("telefon", { klein: true })} ${escapeHtml(h.mobilnummer)}</a></div>`
        );
      }
      if (h.email) {
        zeilen.push(`<div class="kontakt-zeile"><a href="mailto:${escapeHtml(h.email)}">${icon("mail", { klein: true })} ${escapeHtml(h.email)}</a></div>`);
      }
      if (h.website) {
        const websiteUrl = sichereHttpUrl(h.website);
        zeilen.push(
          websiteUrl
            ? `<div class="kontakt-zeile"><a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${icon("weltkugel", { klein: true })} ${escapeHtml(h.website)}</a></div>`
            : `<div class="kontakt-zeile">${icon("weltkugel", { klein: true })} ${escapeHtml(h.website)}</div>`
        );
      }
      return zeilen.length ? zeilen.join("") : leer("Kein Kontakt hinterlegt.");
    }
    case "oeffnungszeiten":
      return oeffnungszeitenHtml(h);
    case "angebote": {
      const teile = [];
      if (h.angebote?.length) {
        teile.push(`<div class="gruppen-label">Angebote</div><div class="tag-liste">${h.angebote.map((a) => `<span class="tag">${escapeHtml(a.name)}</span>`).join("")}</div>`);
      }
      if (h.zahlungsarten?.length) {
        teile.push(`<div class="gruppen-label">Zahlungsarten</div><div class="tag-liste">${h.zahlungsarten.map((z) => `<span class="tag">${escapeHtml(z.name)}</span>`).join("")}</div>`);
      }
      return teile.length ? teile.join("") : leer("Noch keine Angebote oder Zahlungsarten.");
    }
    case "bilder":
      return h.bilder?.length
        ? `<div class="tag-liste galerie">${h.bilder
            .map(
              (b) =>
                `<img class="galerie-bild" src="${escapeHtml(vorschauUrl(b.url, 256))}" alt="${escapeHtml(b.beschreibung || "")}" loading="lazy" decoding="async" />`
            )
            .join("")}</div>`
        : leer("Noch keine Bilder.");
    case "herkunft":
      return herkunftHtml(h);
    default:
      return "";
  }
}

function gruppeHtml(gruppe, h) {
  const inhalt = gruppenInhalt(gruppe.id, h);
  // Die Herkunft erscheint nur, wenn es Quellen gibt.
  if (gruppe.id === "herkunft" && !inhalt) return "";
  const stand = vollstaendigkeit(gruppe, h);
  const gespeichert = gruppenZustand.get(gruppe.id);
  const offen = gespeichert === undefined ? gruppe.offenDetail : gespeichert;
  const htmlId = gruppe.id === "oeffnungszeiten" ? "oeffnungszeiten-abschnitt" : `gruppe-${gruppe.id}`;
  const kurz = gruppe.kurzinfo(h);
  return `<details class="detail-abschnitt einklappbar gruppe" id="${htmlId}" data-gruppe="${gruppe.id}"${offen ? " open" : ""}>
      <summary>
        <span class="vollst ${stand}"><span class="nur-sr">${VOLLSTAENDIGKEIT_TEXT[stand]}: </span></span>
        <span class="titel">${escapeHtml(gruppe.titel)}</span>
        <span class="kurzinfo">${escapeHtml(kurz)}</span>
      </summary>
      ${inhalt}
    </details>`;
}

function schnellaktionenHtml(h) {
  const aktionen = [];
  if (h.latitude != null && h.longitude != null) {
    const ziel = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.latitude)},${encodeURIComponent(h.longitude)}`;
    aktionen.push(`<a class="schnellaktion" href="${escapeHtml(ziel)}" target="_blank" rel="noopener noreferrer">${icon("route")}<span>Route</span></a>`);
  }
  if (h.mobilnummer) {
    aktionen.push(`<a class="schnellaktion" href="tel:${escapeHtml(h.mobilnummer.replace(/[^\d+]/g, ""))}">${icon("telefon")}<span>Anrufen</span></a>`);
  }
  const websiteUrl = h.website ? sichereHttpUrl(h.website) : null;
  if (websiteUrl) {
    aktionen.push(`<a class="schnellaktion" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${icon("weltkugel")}<span>Webseite</span></a>`);
  }
  if (h.email) {
    aktionen.push(`<a class="schnellaktion" href="mailto:${escapeHtml(h.email)}">${icon("mail")}<span>E-Mail</span></a>`);
  }
  return aktionen.length ? `<div class="schnellaktionen">${aktionen.join("")}</div>` : "";
}

export function renderDetail(container, app, hofladenId) {
  const h = app.hofladenMitId(hofladenId);

  if (!h) {
    container.innerHTML = `<p class="hinweis-leiste">Hofladen nicht gefunden.</p>`;
    return;
  }

  const konflikt = app.konfliktFuer ? app.konfliktFuer(h.id) : null;
  const luecken = offeneGruppen(h);
  const bearbeitenHash = `#/hofladen/${encodeURIComponent(h.id)}/bearbeiten`;
  const alleOffen = HOF_GRUPPEN.every((g) => (gruppenZustand.get(g.id) ?? g.offenDetail) === true || (g.id === "herkunft" && !h.quellen?.length));

  container.innerHTML = `
    ${
      konflikt
        ? `<p class="hinweis-leiste konflikt-hinweis">${icon("warnung", { klein: true })} Versionskonflikt: Dieser Hofladen wurde auf einem anderen Gerät geändert. <a href="#/konflikt/${encodeURIComponent(h.id)}">Konflikt lösen</a></p>`
        : ""
    }
    ${
      h._synchronisierungAusstehend
        ? `<p class="hinweis-leiste">${icon("offline", { klein: true })} Noch nicht synchronisiert - wird automatisch übernommen, sobald wieder eine Verbindung zu Home Assistant besteht.</p>`
        : ""
    }

    ${h.hauptbild_url ? `<img class="detail-bild" src="${escapeHtml(h.hauptbild_url)}" alt="" decoding="async" />` : ""}

    <div class="detail-kopf">
      <h2>${escapeHtml(h.name)}</h2>
      <div class="kopf-aktionen">
        <button type="button" class="kopf-btn" id="bearbeiten-btn">Bearbeiten</button>
        <details class="aktionsmenue" id="aktionsmenue">
          <summary aria-label="Weitere Aktionen" title="Weitere Aktionen">${icon("mehr")}</summary>
          <div class="menue-liste">
            <button type="button" class="gefahr" id="loeschen-btn">Löschen …</button>
          </div>
        </details>
      </div>
    </div>
    <div class="status-zeile">
      ${
        h.geoeffnet === true
          ? `<span class="status-badge offen">Geöffnet</span>`
          : h.geoeffnet === false
          ? `<span class="status-badge geschlossen">Geschlossen</span>`
          : `<span class="status-badge unbekannt">Unbekannt</span>`
      }
      ${Number(h.bewertung) > 0 ? bewertungSternenHtml(h.bewertung) : ""}
    </div>

    ${schnellaktionenHtml(h)}

    ${
      luecken.length
        ? `<p class="hinweis-leiste unvollstaendig" id="unvollstaendig-hinweis">${icon("info", { klein: true })} Noch unvollständig: ${escapeHtml(luecken.map((g) => g.titel).join(", "))}. <a href="${bearbeitenHash}">Jetzt ergänzen</a></p>`
        : ""
    }

    <div class="gruppen-leiste"><button type="button" class="link-btn" id="alle-btn" aria-pressed="${alleOffen}">${alleOffen ? "Alle einklappen" : "Alle ausklappen"}</button></div>

    ${HOF_GRUPPEN.map((g) => gruppeHtml(g, h)).join("")}
  `;

  container.querySelectorAll("details.gruppe").forEach((d) => {
    d.addEventListener("toggle", () => {
      gruppenZustand.set(d.dataset.gruppe, d.open);
    });
  });
  container.querySelector("#alle-btn").addEventListener("click", () => {
    const gruppen = [...container.querySelectorAll("details.gruppe")];
    const aufklappen = gruppen.some((d) => !d.open);
    gruppen.forEach((d) => {
      d.open = aufklappen;
    });
    const btn = container.querySelector("#alle-btn");
    btn.textContent = aufklappen ? "Alle einklappen" : "Alle ausklappen";
    btn.setAttribute("aria-pressed", String(aufklappen));
  });
  container.querySelector("#bearbeiten-btn").addEventListener("click", () => {
    app.navigate(bearbeitenHash);
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
