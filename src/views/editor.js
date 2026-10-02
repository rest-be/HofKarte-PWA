/**
 * Editor zum Anlegen/Bearbeiten eines Hofladens (siehe Vorgehensplan
 * Phase 4, Schritt 35/36).
 *
 * Bewusste Vereinfachungen gegenüber `hofkarte-panel.js` (der
 * Home-Assistant-eigenen Verwaltungsoberfläche):
 * - Sonderöffnungszeiten (Ferien/Feiertage) werden hier nicht
 *   bearbeitet – dafür weiterhin die HA-eigene Oberfläche nutzen.
 * - Bilder werden nur als externe URL erfasst; ein eigener Bild-Upload
 *   aus der PWA (`image_upload`) ist nicht Teil dieses MVP.
 * Beides ändert nichts an den gespeicherten Daten selbst – nur an dem,
 * was aus der PWA heraus direkt editierbar ist.
 */

import { escapeHtml } from "./list.js";

const WOCHENTAGE = [
  { wert: 1, label: "Montag" },
  { wert: 2, label: "Dienstag" },
  { wert: 3, label: "Mittwoch" },
  { wert: 4, label: "Donnerstag" },
  { wert: 5, label: "Freitag" },
  { wert: 6, label: "Samstag" },
  { wert: 7, label: "Sonntag" },
];

function leererHofladen() {
  return {
    id: "",
    name: "",
    beschreibung: "",
    bemerkung: "",
    adresse: "",
    plz: "",
    ort: "",
    land: "",
    website: "",
    mobilnummer: "",
    email: "",
    latitude: "",
    longitude: "",
    bewertung: 0,
    oeffnungszeiten: [],
    angebote: [],
    zahlungsarten: [],
    bilder: [],
  };
}

function neueId(praefix) {
  return `${praefix}-${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))}`;
}

function tagsZuText(liste) {
  return (liste || []).map((e) => e.name).join(", ");
}

function textZuTags(text, praefix) {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => ({ id: neueId(praefix), name }));
}

export function renderEditor(container, app, hofladenId) {
  const bestehender = hofladenId ? app.hofladenMitId(hofladenId) : null;
  if (hofladenId && !bestehender) {
    container.innerHTML = `<p class="hinweis-leiste">Hofladen nicht gefunden.</p>`;
    return;
  }

  const daten = bestehender
    ? {
        ...leererHofladen(),
        ...bestehender,
        latitude: bestehender.latitude ?? "",
        longitude: bestehender.longitude ?? "",
      }
    : leererHofladen();

  // Lokaler Arbeitszustand für Listenfelder (Öffnungszeiten, Bilder),
  // damit Zeilen ohne vollständiges Neuzeichnen hinzugefügt/entfernt
  // werden können.
  const oeffnungszeiten = (daten.oeffnungszeiten || []).map((o) => ({ ...o }));
  const bilder = (daten.bilder || []).map((b) => ({ ...b }));
  let bewertung = Number(daten.bewertung) || 0;

  function zeichneOeffnungszeiten() {
    const box = container.querySelector("#oeffnungszeiten-liste");
    box.innerHTML =
      oeffnungszeiten
        .map(
          (o, i) => `
      <div class="oeffnungszeit-zeile" data-index="${i}">
        <select class="oz-wochentag">
          ${WOCHENTAGE.map(
            (w) => `<option value="${w.wert}" ${w.wert === o.wochentag ? "selected" : ""}>${w.label}</option>`
          ).join("")}
        </select>
        <input type="time" class="oz-beginn" value="${o.beginn || ""}" />
        <input type="time" class="oz-ende" value="${o.ende || ""}" />
        <button type="button" class="entfernen-btn" data-remove="${i}">✕</button>
      </div>`
        )
        .join("") || `<p class="ort">Keine regelmässigen Öffnungszeiten.</p>`;

    box.querySelectorAll(".oz-wochentag").forEach((el, i) => {
      el.addEventListener("change", (e) => (oeffnungszeiten[i].wochentag = Number(e.target.value)));
    });
    box.querySelectorAll(".oz-beginn").forEach((el, i) => {
      el.addEventListener("change", (e) => (oeffnungszeiten[i].beginn = e.target.value));
    });
    box.querySelectorAll(".oz-ende").forEach((el, i) => {
      el.addEventListener("change", (e) => (oeffnungszeiten[i].ende = e.target.value));
    });
    box.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        oeffnungszeiten.splice(Number(btn.dataset.remove), 1);
        zeichneOeffnungszeiten();
      });
    });
  }

  function zeichneBilder() {
    const box = container.querySelector("#bilder-liste");
    box.innerHTML = bilder
      .map(
        (b, i) => `
      <div class="liste-zeile" data-index="${i}">
        <input type="url" class="bild-url" placeholder="https://…" value="${escapeHtml(b.url || "")}" />
        <button type="button" class="entfernen-btn" data-remove="${i}">✕</button>
      </div>`
      )
      .join("");

    box.querySelectorAll(".bild-url").forEach((el, i) => {
      el.addEventListener("change", (e) => (bilder[i].url = e.target.value));
    });
    box.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        bilder.splice(Number(btn.dataset.remove), 1);
        zeichneBilder();
      });
    });
  }

  function zeichneSterne() {
    const box = container.querySelector("#bewertung-sterne");
    let html = "";
    for (let i = 1; i <= 5; i++) {
      html += `<button type="button" class="stern-btn${i <= bewertung ? " stern-gefuellt" : ""}" data-stern="${i}">★</button>`;
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-stern]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wert = Number(btn.dataset.stern);
        bewertung = bewertung === wert ? 0 : wert;
        zeichneSterne();
      });
    });
  }

  container.innerHTML = `
    <h2>${bestehender ? "Hofladen bearbeiten" : "Neuer Hofladen"}</h2>
    <div id="editor-fehler" class="hinweis-leiste fehler" hidden></div>

    <form id="editor-form">
      <section class="formular-abschnitt">
        <h2>Allgemeine Informationen</h2>
        <div class="feld-gruppe">
          <label for="f-name">Name *</label>
          <input type="text" id="f-name" required value="${escapeHtml(daten.name)}" />
        </div>

        <div class="feld-gruppe">
          <label for="f-beschreibung">Beschreibung</label>
          <textarea id="f-beschreibung">${escapeHtml(daten.beschreibung || "")}</textarea>
        </div>

        <div class="feld-gruppe">
          <label for="f-bemerkung">Bemerkung (intern)</label>
          <textarea id="f-bemerkung">${escapeHtml(daten.bemerkung || "")}</textarea>
        </div>
      </section>

      <section class="formular-abschnitt">
        <h2>Adresse</h2>
        <div class="feld-gruppe">
          <label for="f-adresse">Adresse</label>
          <input type="text" id="f-adresse" value="${escapeHtml(daten.adresse || "")}" />
        </div>
        <div class="feld-zeile">
          <div class="feld-gruppe">
            <label for="f-plz">PLZ</label>
            <input type="text" id="f-plz" value="${escapeHtml(daten.plz || "")}" />
          </div>
          <div class="feld-gruppe">
            <label for="f-ort">Ort</label>
            <input type="text" id="f-ort" value="${escapeHtml(daten.ort || "")}" />
          </div>
        </div>
        <div class="feld-gruppe">
          <label for="f-land">Land</label>
          <input type="text" id="f-land" value="${escapeHtml(daten.land || "")}" />
        </div>
      </section>

      <section class="formular-abschnitt">
        <h2>Standort / Koordinaten</h2>
        <div class="feld-zeile">
          <div class="feld-gruppe">
            <label for="f-latitude">Breitengrad</label>
            <input type="text" id="f-latitude" inputmode="decimal" value="${escapeHtml(String(daten.latitude ?? ""))}" />
          </div>
          <div class="feld-gruppe">
            <label for="f-longitude">Längengrad</label>
            <input type="text" id="f-longitude" inputmode="decimal" value="${escapeHtml(String(daten.longitude ?? ""))}" />
          </div>
        </div>
        <button type="button" class="hinzufuegen-btn" id="standort-uebernehmen-btn">📍 Aktuellen Standort übernehmen</button>
      </section>

      <section class="formular-abschnitt">
        <h2>Kontakt &amp; Webseite</h2>
        <div class="feld-gruppe">
          <label for="f-mobilnummer">Mobilnummer</label>
          <input type="tel" id="f-mobilnummer" value="${escapeHtml(daten.mobilnummer || "")}" />
        </div>
        <div class="feld-gruppe">
          <label for="f-email">E-Mail</label>
          <input type="email" id="f-email" value="${escapeHtml(daten.email || "")}" />
        </div>
        <div class="feld-gruppe">
          <label for="f-website">Website</label>
          <input type="url" id="f-website" value="${escapeHtml(daten.website || "")}" />
        </div>
      </section>

      <section class="formular-abschnitt">
        <h2>Automatisch ausfüllen</h2>
        <p class="muted">Übernimmt Name, Beschreibung, Adresse, Mobilnummer und E-Mail von der oben eingetragenen Website, sofern dort auffindbar.</p>
        <button type="button" class="hinzufuegen-btn" id="webseite-info-btn">🔎 Infos von Website ermitteln</button>
      </section>

      <section class="formular-abschnitt">
        <h2>Öffnungszeiten</h2>
        <div id="oeffnungszeiten-liste"></div>
        <button type="button" class="hinzufuegen-btn" id="oz-hinzufuegen-btn">+ Öffnungszeit hinzufügen</button>
      </section>

      <section class="formular-abschnitt">
        <h2>Angebote und Zahlungsarten</h2>
        <div class="feld-gruppe">
          <label for="f-angebote">Angebote (durch Komma getrennt)</label>
          <input type="text" id="f-angebote" value="${escapeHtml(tagsZuText(daten.angebote))}" />
        </div>
        <div class="feld-gruppe">
          <label for="f-zahlungsarten">Zahlungsarten (durch Komma getrennt)</label>
          <input type="text" id="f-zahlungsarten" value="${escapeHtml(tagsZuText(daten.zahlungsarten))}" />
        </div>
      </section>

      <section class="formular-abschnitt">
        <h2>Bilder</h2>
        <div id="bilder-liste"></div>
        <button type="button" class="hinzufuegen-btn" id="bild-hinzufuegen-btn">+ Bild hinzufügen</button>
      </section>

      <section class="formular-abschnitt">
        <h2>Bewertung</h2>
        <div class="feld-gruppe">
          <div class="sterne-reihe" id="bewertung-sterne"></div>
        </div>
      </section>

      <button type="submit" class="speichern-btn" id="speichern-btn">Speichern</button>
    </form>
  `;

  zeichneOeffnungszeiten();
  zeichneBilder();
  zeichneSterne();

  container.querySelector("#oz-hinzufuegen-btn").addEventListener("click", () => {
    oeffnungszeiten.push({ wochentag: 1, beginn: "08:00", ende: "18:00" });
    zeichneOeffnungszeiten();
  });
  container.querySelector("#bild-hinzufuegen-btn").addEventListener("click", () => {
    bilder.push({ url: "", hochgeladen: false });
    zeichneBilder();
  });

  container.querySelector("#standort-uebernehmen-btn").addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      alert("Dieser Browser unterstützt keine Standortabfrage.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        container.querySelector("#f-latitude").value = pos.coords.latitude.toFixed(6);
        container.querySelector("#f-longitude").value = pos.coords.longitude.toFixed(6);
      },
      () => alert("Standort konnte nicht ermittelt werden."),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  });

  container.querySelector("#webseite-info-btn").addEventListener("click", async () => {
    const website = container.querySelector("#f-website").value.trim();
    if (!website) {
      alert("Bitte zuerst eine Website-Adresse eintragen.");
      return;
    }
    const btn = container.querySelector("#webseite-info-btn");
    btn.disabled = true;
    btn.textContent = "Ermittle …";
    try {
      app._pruefeVerbindung();
      const info = await app.haClient.webseiteInfo(website);
      if (info.name && !container.querySelector("#f-name").value) container.querySelector("#f-name").value = info.name;
      if (info.beschreibung) container.querySelector("#f-beschreibung").value = info.beschreibung;
      if (info.adresse) container.querySelector("#f-adresse").value = info.adresse;
      if (info.mobilnummer) container.querySelector("#f-mobilnummer").value = info.mobilnummer;
      if (info.email) container.querySelector("#f-email").value = info.email;
    } catch (err) {
      alert(`Konnte keine Infos ermitteln: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "🔎 Infos von Website ermitteln";
    }
  });

  container.querySelector("#editor-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fehlerBox = container.querySelector("#editor-fehler");
    fehlerBox.hidden = true;

    const wert = (id) => container.querySelector(id).value.trim();
    const zuSpeichern = {
      id: daten.id || undefined,
      name: wert("#f-name"),
      beschreibung: wert("#f-beschreibung") || null,
      bemerkung: wert("#f-bemerkung") || null,
      adresse: wert("#f-adresse") || null,
      plz: wert("#f-plz") || null,
      ort: wert("#f-ort") || null,
      land: wert("#f-land") || null,
      website: wert("#f-website") || null,
      mobilnummer: wert("#f-mobilnummer") || null,
      email: wert("#f-email") || null,
      latitude: wert("#f-latitude") ? Number(wert("#f-latitude")) : null,
      longitude: wert("#f-longitude") ? Number(wert("#f-longitude")) : null,
      bewertung,
      oeffnungszeiten: oeffnungszeiten.filter((o) => o.beginn && o.ende),
      angebote: textZuTags(wert("#f-angebote"), "angebot"),
      zahlungsarten: textZuTags(wert("#f-zahlungsarten"), "zahlungsart"),
      bilder: bilder.filter((b) => b.url).map((b) => ({ url: b.url, hochgeladen: false })),
    };

    const submitBtn = container.querySelector("#speichern-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Speichert …";

    try {
      const gespeichert = await app.speichereHofladen(zuSpeichern);
      app.navigate(`#/hofladen/${gespeichert.id}`);
    } catch (err) {
      fehlerBox.textContent = err.message;
      fehlerBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Speichern";
    }
  });
}
