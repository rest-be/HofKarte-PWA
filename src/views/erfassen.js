/**
 * Erfassen (ab 2.0.0-dev.4): ein Einstieg mit drei Wegen statt eines leeren
 * Formulars.
 *
 * - Einstieg (`#/erfassen`): Vor Ort · Von der Webseite · Von Hand
 * - Vor Ort (`#/erfassen/vorort`): Standort nur auf Tipp, Umkreis-Chips,
 *   „Schon erfasst“ zuoberst, neue Treffer aus OpenStreetMap, „Keiner davon“
 * - Schnellerfassung (`#/erfassen/schnell`): Name (Pflicht), Foto, Standort, Webseite
 * - Gespeichert (`#/erfassen/gespeichert/<id>`): „Noch offen“ mit Sprung in den Editor
 *
 * Der Standort wird nur nach einem Tipp abgefragt und nie gespeichert (nur im
 * Arbeitsspeicher dieses Ablaufs); gespeichert werden erst die Koordinaten des
 * Hofladens selbst. Vor dem Speichern wird auf Doppelte geprüft.
 */

import { entfernungMeter } from "../naehe.js";
import { escapeHtml, sichereHttpUrl } from "../html.js";
import { icon } from "../icons.js";
import { bildVerkleinern } from "../bilder.js";
import { findeBestehenden, kandidatGruende, istHttpUrl, FINDEN_FEHLERMELDUNGEN } from "../finden.js";
import { offeneGruppen, VOLLSTAENDIGKEIT_TEXT, vollstaendigkeit } from "../gruppen.js";
import { holeStandort, standortFehlermeldung, oeffneEditorGruppe } from "./editor.js";

export const UMKREISE = [100, 250, 500];

/** Zustand des laufenden Ablaufs (nur Arbeitsspeicher, wird beim Einstieg zurückgesetzt). */
const zustand = {
  standort: null, // { latitude, longitude, genauigkeit }
  radius: 250,
  kandidat: null,
  treffer: null, // OSM-Kandidaten (ohne bereits Erfasste)
  suchFehler: "",
  standortFehler: "",
};

export function setzeErfassenZurueck() {
  zustand.standort = null;
  zustand.radius = 250;
  zustand.kandidat = null;
  zustand.treffer = null;
  zustand.suchFehler = "";
  zustand.standortFehler = "";
}

/** Bereits erfasste Hofläden im Umkreis, nächste zuerst: `[{hofladen, meter}]`. */
export function erfassteInNaehe(hoflaeden, latitude, longitude, radius) {
  return (hoflaeden || [])
    .map((h) => {
      const lat = Number(h.latitude);
      const lon = Number(h.longitude);
      if (h.latitude == null || h.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { hofladen: h, meter: entfernungMeter(latitude, longitude, lat, lon) };
    })
    .filter((e) => e && e.meter <= radius)
    .sort((a, b) => a.meter - b.meter);
}

const meterText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Standort einmalig ermitteln: erst genau (GPS), bei Zeitüberschreitung gröber. */
async function standortErmitteln() {
  let pos;
  try {
    pos = await holeStandort({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
  } catch (err) {
    if (err?.code === 1) throw err;
    pos = await holeStandort({ enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 });
  }
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, genauigkeit: pos.coords.accuracy };
}

function statusBadge(geoeffnet) {
  if (geoeffnet === true) return `<span class="status-badge offen">Geöffnet</span>`;
  if (geoeffnet === false) return `<span class="status-badge geschlossen">Geschlossen</span>`;
  return `<span class="status-badge unbekannt">Unbekannt</span>`;
}

// --- Einstieg -----------------------------------------------------------------

export function renderErfassenEinstieg(container, app) {
  setzeErfassenZurueck();
  app.entwurf = null;
  container.innerHTML = `
    <h2 class="erfassen-titel">Hofladen erfassen</h2>
    <p class="muted">Wie möchtest du vorgehen?</p>
    <a class="weg-karte weg-haupt" href="#/erfassen/vorort" id="weg-vorort">
      <span class="weg-icon">${icon("fadenkreuz")}</span>
      <span class="weg-text"><strong>Vor Ort</strong><span>Du stehst am Hofladen: Standort verwenden, Treffer wählen, in einer Minute erfasst.</span></span>
      <span class="weg-pfeil">${icon("weiter")}</span>
    </a>
    <a class="weg-karte" href="#/erfassen/webseite" id="weg-webseite">
      <span class="weg-icon">${icon("weltkugel")}</span>
      <span class="weg-text"><strong>Von der Webseite</strong><span>Du hast die Adresse der Webseite oder den Namen: Angaben werden ausgelesen.</span></span>
      <span class="weg-pfeil">${icon("weiter")}</span>
    </a>
    <a class="weg-karte" href="#/neu" id="weg-hand">
      <span class="weg-icon">${icon("stift")}</span>
      <span class="weg-text"><strong>Von Hand</strong><span>Leeres Formular mit allen Angaben.</span></span>
      <span class="weg-pfeil">${icon("weiter")}</span>
    </a>
    <p class="erfassen-fuss"><a href="#/finden" id="erweiterte-suche-link">Erweiterte Suche</a></p>
  `;
}

// --- Vor Ort ------------------------------------------------------------------

export function renderVorOrt(container, app) {
  let suchId = 0;

  container.innerHTML = `
    <p class="muted">Tippe auf «Standort verwenden», um Hofläden in deiner Nähe zu sehen. Der Standort wird nicht gespeichert.</p>
    <button type="button" class="gross-btn" id="standort-btn">${icon("fadenkreuz", { klein: true })}<span>Standort verwenden</span></button>
    <p class="muted" id="standort-status" role="status"></p>
    <div class="chip-liste" role="group" aria-label="Umkreis" id="umkreis-chips">
      ${UMKREISE.map((m) => `<button type="button" class="chip" data-radius="${m}" aria-pressed="${m === zustand.radius}">${m} m</button>`).join("")}
    </div>
    <div id="vorort-ergebnis"></div>
  `;

  const statusEl = container.querySelector("#standort-status");
  const ergebnis = container.querySelector("#vorort-ergebnis");
  const standortBtn = container.querySelector("#standort-btn");

  function zeichneErgebnis() {
    if (!zustand.standort) {
      ergebnis.innerHTML = "";
      return;
    }
    const { latitude, longitude } = zustand.standort;
    const erfasst = erfassteInNaehe(app.state.hoflaeden, latitude, longitude, zustand.radius);
    const erfasstHtml = erfasst.length
      ? `<section class="vorort-abschnitt" id="schon-erfasst">
          <h3>Schon erfasst (${erfasst.length})</h3>
          ${erfasst
            .map(
              ({ hofladen: h, meter }) => `<a class="treffer-zeile" href="#/hofladen/${encodeURIComponent(h.id)}" data-erfasst="${escapeHtml(h.id)}">
              <span class="treffer-text"><strong>${escapeHtml(h.name)}</strong><span class="muted">${meterText(meter)} entfernt</span></span>
              ${statusBadge(h.geoeffnet)}
            </a>`
            )
            .join("")}
        </section>`
      : "";

    let treffer = "";
    if (zustand.treffer === null) {
      treffer = app.haClient
        ? `<p class="muted" role="status">Suche in OpenStreetMap …</p>`
        : `<p class="hinweis-leiste">${icon("offline", { klein: true })} Ohne Verbindung gibt es keine Treffer aus OpenStreetMap. Du kannst den Hofladen hier trotzdem erfassen.</p>`;
    } else if (zustand.suchFehler) {
      treffer = `<p class="hinweis-leiste fehler" role="alert">${escapeHtml(zustand.suchFehler)}</p>`;
    } else if (zustand.treffer.length) {
      treffer = `<section class="vorort-abschnitt" id="osm-treffer">
          <h3>Neue Treffer (${zustand.treffer.length})</h3>
          ${zustand.treffer
            .map(
              (k, i) => `<div class="treffer-zeile">
              <span class="treffer-text"><strong>${escapeHtml(k.name || "(ohne Namen)")}</strong>
                <span class="muted">${escapeHtml(kandidatGruende(k))}</span>
                ${k.adresse ? `<span class="muted">${escapeHtml([k.adresse, [k.plz, k.ort].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</span>` : ""}</span>
              <button type="button" class="treffer-btn" data-kandidat="${i}">Erfassen</button>
            </div>`
            )
            .join("")}
        </section>`;
    } else {
      treffer = `<p class="muted">In OpenStreetMap wurde im Umkreis nichts Neues gefunden.</p>`;
    }

    ergebnis.innerHTML = `${erfasstHtml}${treffer}
      <button type="button" class="gross-btn zweit" id="keiner-btn">${icon("plus", { klein: true })}<span>Keiner davon: neuen Hofladen erfassen</span></button>`;

    ergebnis.querySelectorAll("[data-kandidat]").forEach((btn) =>
      btn.addEventListener("click", () => {
        zustand.kandidat = zustand.treffer[Number(btn.dataset.kandidat)];
        app.navigate("#/erfassen/schnell");
      })
    );
    ergebnis.querySelector("#keiner-btn").addEventListener("click", () => {
      zustand.kandidat = null;
      app.navigate("#/erfassen/schnell");
    });
  }

  async function sucheTreffer() {
    if (!zustand.standort) return;
    const id = ++suchId;
    zustand.treffer = null;
    zustand.suchFehler = "";
    zeichneErgebnis();
    if (!app.haClient) return;
    try {
      const kandidaten = await app.haClient.hofladenSuchen({
        latitude: zustand.standort.latitude,
        longitude: zustand.standort.longitude,
        radius: zustand.radius,
      });
      if (id !== suchId) return;
      // Schon erfasste Hofläden stehen oben in „Schon erfasst“ und erscheinen nicht noch einmal als neu.
      zustand.treffer = kandidaten.filter((k) => !findeBestehenden(k, app.state.hoflaeden));
    } catch (err) {
      if (id !== suchId) return;
      zustand.treffer = [];
      zustand.suchFehler =
        FINDEN_FEHLERMELDUNGEN[err?.code] || "Die Suche in OpenStreetMap hat nicht geklappt. Du kannst den Hofladen trotzdem erfassen.";
    }
    zeichneErgebnis();
  }

  standortBtn.addEventListener("click", async () => {
    standortBtn.disabled = true;
    statusEl.classList.remove("fehlertext");
    statusEl.textContent = "Standort wird ermittelt …";
    try {
      zustand.standort = await standortErmitteln();
      const genau = zustand.standort.genauigkeit;
      statusEl.textContent = Number.isFinite(genau) ? `Standort gefunden (auf etwa ${Math.round(genau)} m genau).` : "Standort gefunden.";
      await sucheTreffer();
    } catch (err) {
      zustand.standort = null;
      statusEl.textContent = standortFehlermeldung(err);
      statusEl.classList.add("fehlertext");
      ergebnis.innerHTML = `<button type="button" class="gross-btn zweit" id="keiner-btn">${icon("plus", { klein: true })}<span>Ohne Standort erfassen</span></button>`;
      ergebnis.querySelector("#keiner-btn").addEventListener("click", () => {
        zustand.kandidat = null;
        app.navigate("#/erfassen/schnell");
      });
    } finally {
      standortBtn.disabled = false;
    }
  });

  container.querySelectorAll("[data-radius]").forEach((btn) =>
    btn.addEventListener("click", () => {
      zustand.radius = Number(btn.dataset.radius);
      container.querySelectorAll("[data-radius]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      if (zustand.standort) sucheTreffer();
    })
  );

  if (zustand.standort) {
    statusEl.textContent = "Standort gefunden.";
    zeichneErgebnis();
  }
}

// --- Schnellerfassung ---------------------------------------------------------

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_ERLAUBTE_TYPEN = ["image/jpeg", "image/png", "image/gif"];

export function renderSchnell(container, app) {
  const k = zustand.kandidat;
  // Koordinaten des Hofladens: die des Treffers, sonst der eigene Standort (nur im Arbeitsspeicher).
  let position = k
    ? { latitude: k.latitude, longitude: k.longitude }
    : zustand.standort
      ? { latitude: zustand.standort.latitude, longitude: zustand.standort.longitude }
      : null;
  const bilder = [];
  const vorgabe = {
    name: k?.name || "",
    website: k?.website || "",
    adresse: k?.adresse || "",
    plz: k?.plz || "",
    ort: k?.ort || "",
  };
  const kannHochladen = !!app.haClient && !app.offlineModus;

  container.innerHTML = `
    <div id="schnell-fehler" class="hinweis-leiste fehler" role="alert" hidden></div>
    ${k ? `<p class="hinweis-leiste">${icon("info", { klein: true })} Angaben aus OpenStreetMap sind schon eingetragen. Bitte kurz prüfen.</p>` : ""}
    <form id="schnell-form" novalidate>
      <section class="formular-abschnitt schnell-abschnitt">
        <div class="feld-gruppe">
          <label for="s-name">Name *</label>
          <input type="text" id="s-name" autocomplete="off" value="${escapeHtml(vorgabe.name)}" />
          <p class="feld-fehler" id="s-name-fehler" role="alert" hidden></p>
        </div>
        <div class="feld-gruppe">
          <label for="s-website">Webseite</label>
          <input type="url" id="s-website" autocomplete="off" placeholder="https://…" value="${escapeHtml(vorgabe.website)}" />
        </div>
      </section>

      <section class="formular-abschnitt schnell-abschnitt">
        <div class="feld-gruppe">
          <label>Standort</label>
          <p id="s-standort-text" class="schnell-wert"></p>
          <button type="button" class="hinzufuegen-btn" id="s-standort-btn">${icon("standort", { klein: true })} <span>Aktuellen Standort übernehmen</span></button>
        </div>
      </section>

      <section class="formular-abschnitt schnell-abschnitt">
        <div class="feld-gruppe">
          <label>Foto</label>
          <div id="s-bilder" class="tag-liste galerie"></div>
          <div class="upload-row">
            <button type="button" class="hinzufuegen-btn" id="s-foto-kamera-btn" ${kannHochladen ? "" : "disabled"}>${icon("kamera", { klein: true })} Foto aufnehmen</button>
            <button type="button" class="hinzufuegen-btn" id="s-foto-bibliothek-btn" ${kannHochladen ? "" : "disabled"}>${icon("bild", { klein: true })} Aus Fotos wählen</button>
          </div>
          <input type="file" id="s-foto-kamera-input" accept="image/jpeg,image/png,image/gif" capture="environment" hidden />
          <input type="file" id="s-foto-bibliothek-input" accept="image/jpeg,image/png,image/gif" hidden />
          <p class="muted" id="s-foto-status" role="status">${kannHochladen ? "" : "Ohne Verbindung kann kein Foto hochgeladen werden. Foto später ergänzen."}</p>
        </div>
      </section>

      <div class="fussleiste" id="fussleiste">
        <span class="grow"></span>
        <button type="button" class="abbrechen-btn" id="s-abbrechen-btn">Abbrechen</button>
        <button type="submit" class="primaer" id="s-speichern-btn">Speichern</button>
      </div>
    </form>
  `;

  const nameFeld = container.querySelector("#s-name");
  const standortText = container.querySelector("#s-standort-text");

  function zeigeStandort() {
    standortText.textContent = position
      ? `${Number(position.latitude).toFixed(5)}, ${Number(position.longitude).toFixed(5)}`
      : "Noch kein Standort.";
  }
  zeigeStandort();

  function zeichneBilder() {
    const box = container.querySelector("#s-bilder");
    box.innerHTML = bilder
      .map((b) => `<img class="galerie-bild" src="${escapeHtml(b.url)}" alt="Aufgenommenes Foto" />`)
      .join("");
  }

  async function fotoHochladen(file) {
    const status = container.querySelector("#s-foto-status");
    status.classList.remove("fehlertext");
    if (!file) return;
    if (!UPLOAD_ERLAUBTE_TYPEN.includes(file.type)) {
      status.textContent = "Nicht unterstütztes Dateiformat. Erlaubt: JPEG, PNG, GIF.";
      status.classList.add("fehlertext");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      status.textContent = "Datei ist zu gross (maximal 10 MB erlaubt).";
      status.classList.add("fehlertext");
      return;
    }
    status.textContent = "Foto wird hochgeladen …";
    try {
      app._pruefeVerbindung();
      const bild = await app.haClient.bildHochladen(await bildVerkleinern(file));
      bilder.push({ url: bild.url, beschreibung: null, hochgeladen: true });
      status.textContent = "Foto hochgeladen.";
      zeichneBilder();
    } catch (err) {
      status.textContent = `${err?.message || "Upload fehlgeschlagen."} Du kannst das Foto später ergänzen.`;
      status.classList.add("fehlertext");
    }
  }

  container.querySelector("#s-foto-kamera-btn").addEventListener("click", () => container.querySelector("#s-foto-kamera-input").click());
  container.querySelector("#s-foto-bibliothek-btn").addEventListener("click", () => container.querySelector("#s-foto-bibliothek-input").click());
  for (const id of ["#s-foto-kamera-input", "#s-foto-bibliothek-input"]) {
    container.querySelector(id).addEventListener("change", (e) => {
      fotoHochladen(e.target.files[0]);
      e.target.value = "";
    });
  }

  container.querySelector("#s-standort-btn").addEventListener("click", async () => {
    const btn = container.querySelector("#s-standort-btn");
    btn.disabled = true;
    standortText.textContent = "Standort wird ermittelt …";
    try {
      const pos = await standortErmitteln();
      position = { latitude: pos.latitude, longitude: pos.longitude };
      zeigeStandort();
    } catch (err) {
      zeigeStandort();
      const box = container.querySelector("#schnell-fehler");
      box.textContent = standortFehlermeldung(err);
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector("#s-abbrechen-btn").addEventListener("click", () => {
    if ((nameFeld.value.trim() !== vorgabe.name || bilder.length) && !confirm("Eingaben verwerfen?")) return;
    app.navigate("#/erfassen/vorort");
  });

  container.querySelector("#schnell-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fehlerBox = container.querySelector("#schnell-fehler");
    fehlerBox.hidden = true;
    const meldung = container.querySelector("#s-name-fehler");
    meldung.hidden = true;
    nameFeld.removeAttribute("aria-invalid");

    const name = nameFeld.value.trim();
    if (!name) {
      meldung.textContent = "Bitte einen Namen eintragen.";
      meldung.hidden = false;
      nameFeld.setAttribute("aria-invalid", "true");
      nameFeld.setAttribute("aria-describedby", meldung.id);
      nameFeld.focus();
      return;
    }
    let website = container.querySelector("#s-website").value.trim();
    if (website && !istHttpUrl(website)) website = `https://${website}`;
    if (website && !sichereHttpUrl(website)) {
      fehlerBox.textContent = "Bitte eine gültige Webadresse eintragen.";
      fehlerBox.hidden = false;
      container.querySelector("#s-website").focus();
      return;
    }

    // Doppelte vermeiden: gleicher Name oder höchstens 100 m entfernt.
    const doppelt = findeBestehenden(
      { name, latitude: position?.latitude ?? NaN, longitude: position?.longitude ?? NaN, weitere_namen: [] },
      app.state.hoflaeden
    );
    if (doppelt && !confirm(`Möglicherweise schon erfasst: «${doppelt.name}». Trotzdem als neuen Hofladen speichern?`)) return;

    const quellen = [];
    if (k) {
      const merke = (feld, wertNeu, wertOsm) => {
        if (wertOsm && String(wertNeu ?? "") === String(wertOsm)) quellen.push({ feld, quelle: "openstreetmap", status: "confirmed", url: null, lizenz: null });
      };
      merke("name", name, vorgabe.name);
      merke("website", website, vorgabe.website);
      merke("adresse", vorgabe.adresse, vorgabe.adresse);
      merke("plz", vorgabe.plz, vorgabe.plz);
      merke("ort", vorgabe.ort, vorgabe.ort);
      if (position && position.latitude === k.latitude && position.longitude === k.longitude) {
        merke("latitude", k.latitude, k.latitude);
        merke("longitude", k.longitude, k.longitude);
      }
    }

    const btn = container.querySelector("#s-speichern-btn");
    btn.disabled = true;
    btn.textContent = "Speichert …";
    try {
      const gespeichert = await app.speichereHofladen({
        name,
        website: website || null,
        adresse: vorgabe.adresse || null,
        plz: vorgabe.plz || null,
        ort: vorgabe.ort || null,
        latitude: position ? Number(position.latitude) : null,
        longitude: position ? Number(position.longitude) : null,
        bewertung: 0,
        oeffnungszeiten: [],
        angebote: [],
        zahlungsarten: [],
        bilder: bilder.map((b) => ({ url: b.url, beschreibung: null, hochgeladen: true })),
        quellen,
      });
      zustand.kandidat = null;
      app.navigate(`#/erfassen/gespeichert/${encodeURIComponent(gespeichert.id)}`);
    } catch (err) {
      fehlerBox.textContent = err.message;
      fehlerBox.hidden = false;
      btn.disabled = false;
      btn.textContent = "Speichern";
    }
  });
}

// --- Gespeichert --------------------------------------------------------------

export function renderGespeichert(container, app, hofladenId) {
  const h = app.hofladenMitId(hofladenId);
  if (!h) {
    container.innerHTML = `<p class="hinweis-leiste">Hofladen nicht gefunden.</p><p><a href="#/">Zur Liste</a></p>`;
    return;
  }
  const luecken = offeneGruppen(h);
  const fotoFehlt = !(h.bilder && h.bilder.length);
  const offlineHinweis = h._synchronisierungAusstehend
    ? `<p class="hinweis-leiste">${icon("offline", { klein: true })} Noch nicht synchronisiert – wird automatisch übernommen, sobald wieder eine Verbindung besteht.</p>`
    : "";

  container.innerHTML = `
    <div class="gespeichert-kopf">
      <span class="gespeichert-haken">${icon("haken")}</span>
      <div><h2>Gespeichert</h2><p class="muted" id="gespeichert-name">${escapeHtml(h.name)}</p></div>
    </div>
    ${offlineHinweis}
    ${
      luecken.length
        ? `<section class="vorort-abschnitt" id="noch-offen">
            <h3>Noch offen</h3>
            ${luecken
              .map((g) => {
                const st = vollstaendigkeit(g, h);
                const zusatz = g.id === "bilder" && fotoFehlt ? "Foto später ergänzen" : VOLLSTAENDIGKEIT_TEXT[st];
                return `<div class="treffer-zeile">
                  <span class="vollst ${st}"></span>
                  <span class="treffer-text"><strong>${escapeHtml(g.titel)}</strong><span class="muted">${escapeHtml(zusatz)}</span></span>
                  <button type="button" class="treffer-btn" data-gruppe="${g.id}">Ergänzen</button>
                </div>`;
              })
              .join("")}
          </section>`
        : `<p class="hinweis-leiste">${icon("haken", { klein: true })} Alle wichtigen Angaben sind vorhanden.</p>`
    }
    <div class="aktions-reihe aktions-stapel">
      <button type="button" class="primaer" id="weiterer-btn">Weiteren Hofladen erfassen</button>
      ${h.website && app.haClient ? `<button type="button" id="ergaenzen-btn">Von der Webseite ergänzen</button>` : ""}
      <button type="button" id="ansehen-btn">Hofladen ansehen</button>
      <button type="button" id="fertig-btn">Fertig</button>
    </div>
  `;

  container.querySelectorAll("[data-gruppe]").forEach((btn) =>
    btn.addEventListener("click", () => {
      oeffneEditorGruppe(btn.dataset.gruppe);
      app.navigate(`#/hofladen/${encodeURIComponent(h.id)}/bearbeiten`);
    })
  );
  container.querySelector("#weiterer-btn").addEventListener("click", () => app.navigate("#/erfassen/vorort"));
  container.querySelector("#ergaenzen-btn")?.addEventListener("click", () => app.navigate(`#/hofladen/${encodeURIComponent(h.id)}/ergaenzen`));
  container.querySelector("#ansehen-btn").addEventListener("click", () => app.navigate(`#/hofladen/${encodeURIComponent(h.id)}`));
  container.querySelector("#fertig-btn").addEventListener("click", () => app.navigate("#/"));
}
