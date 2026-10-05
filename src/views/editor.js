/**
 * Editor zum Anlegen/Bearbeiten eines Hofladens (siehe Vorgehensplan
 * Phase 4, Schritt 35/36).
 *
 * Bewusste Vereinfachung gegenüber `hofkarte-panel.js` (der
 * Home-Assistant-eigenen Verwaltungsoberfläche): Sonderöffnungszeiten
 * (Ferien/Feiertage) werden hier nicht bearbeitet – dafür weiterhin die
 * HA-eigene Oberfläche nutzen. Bilder können dagegen wie im HA-Panel
 * sowohl per geführtem Upload (Kamera/Fotobibliothek, über Home
 * Assistants `image_upload`-Komponente) als auch per externer
 * Bild-Adresse hinzugefügt werden (siehe zeichneBilder()).
 */

import { escapeHtml } from "./list.js";
import { extractImageId } from "../ha-client.js";

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

function holeStandort(optionen) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, optionen);
  });
}

function standortFehlermeldung(err) {
  switch (err?.code) {
    case 1: // PERMISSION_DENIED
      return (
        "Standortzugriff wurde verweigert. Bitte in den iPhone-Einstellungen " +
        "unter „HofKarte“ (bzw. „Safari“ → „Websites“, falls die App nicht im " +
        "Home-Bildschirm installiert ist) den Standortzugriff erlauben und " +
        "erneut versuchen."
      );
    case 2: // POSITION_UNAVAILABLE
      return "Standort konnte nicht ermittelt werden (Position aktuell nicht verfügbar).";
    case 3: // TIMEOUT
      return "Zeitüberschreitung beim Ermitteln des Standorts. Am besten im Freien bzw. bei gutem GPS-/WLAN-Empfang erneut versuchen.";
    default:
      return "Standort konnte nicht ermittelt werden.";
  }
}

/** "📍 Aktuellen Standort übernehmen": erster Versuch mit hoher
 * Genauigkeit (GPS), bei Zeitüberschreitung/nicht verfügbarer Position
 * ein zweiter, grosszügigerer Versuch ohne High-Accuracy (WLAN-/
 * Mobilfunk-Ortung) - viele Fehlschläge in der Praxis sind reine
 * GPS-Timeouts (z. B. in Gebäuden), kein grundsätzliches Problem. */
async function standortUebernehmen(container) {
  const btn = container.querySelector("#standort-uebernehmen-btn");
  if (!("geolocation" in navigator)) {
    alert("Dieser Browser unterstützt keine Standortabfrage.");
    return;
  }

  btn.disabled = true;
  btn.textContent = "📍 Ermittle Standort …";

  try {
    let pos;
    try {
      pos = await holeStandort({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
    } catch (err) {
      if (err?.code === 1) throw err; // Berechtigung verweigert: kein zweiter Versuch sinnvoll
      btn.textContent = "📍 Erneuter Versuch …";
      pos = await holeStandort({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
    }
    container.querySelector("#f-latitude").value = pos.coords.latitude.toFixed(6);
    container.querySelector("#f-longitude").value = pos.coords.longitude.toFixed(6);
  } catch (err) {
    alert(standortFehlermeldung(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Aktuellen Standort übernehmen";
  }
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
        <select class="oz-wochentag" aria-label="Wochentag">
          ${WOCHENTAGE.map(
            (w) => `<option value="${w.wert}" ${w.wert === o.wochentag ? "selected" : ""}>${w.label}</option>`
          ).join("")}
        </select>
        <input type="time" class="oz-beginn" value="${o.beginn || ""}" aria-label="Beginn" />
        <input type="time" class="oz-ende" value="${o.ende || ""}" aria-label="Ende" />
        <button type="button" class="entfernen-btn" data-remove="${i}" title="Öffnungszeit entfernen" aria-label="Öffnungszeit entfernen">✕</button>
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

  function setUploadStatus(text, art = "") {
    const el = container.querySelector("#upload-status");
    if (!el) return;
    el.textContent = text;
    el.className = `upload-status muted${art ? " " + art : ""}`;
  }

  /** Bild an Index `i` als Hauptbild festlegen (= an den Anfang der
   * Liste verschieben, siehe images.py:get_main_image_url - das erste
   * Bild mit gültiger URL ist das Hauptbild). */
  function alsHauptbildFestlegen(i) {
    const [b] = bilder.splice(i, 1);
    bilder.unshift(b);
    zeichneBilder();
  }

  async function bildEntfernen(i) {
    const bild = bilder[i];
    if (!bild) return;
    if (bild.hochgeladen) {
      const imageId = extractImageId(bild.url);
      if (imageId && app.haClient) {
        try {
          await app.haClient.bildLoeschen(imageId);
        } catch (err) {
          // Zugrunde liegende Datei liess sich nicht bereinigen (z. B.
          // bereits anderweitig gelöscht) - Bild trotzdem aus der Liste
          // entfernen, um nicht zu blockieren; kein Datenverlust an
          // Hofladen-Seite dadurch.
          console.warn("Hochgeladenes Bild konnte nicht bereinigt werden:", err);
        }
      }
    }
    bilder.splice(i, 1);
    zeichneBilder();
  }

  function zeichneBilder() {
    const box = container.querySelector("#bilder-liste");
    box.innerHTML = bilder.length
      ? bilder
          .map(
            (b, i) => `
      <div class="bild-zeile" data-index="${i}">
        <img src="${escapeHtml(b.url || "")}" alt="" loading="lazy" />
        <div class="bild-zeile-felder">
          <input type="text" class="bild-beschreibung" placeholder="Beschreibung (optional)" value="${escapeHtml(b.beschreibung || "")}" />
          <div class="bild-zeile-meta">${i === 0 ? "Hauptbild · " : ""}${b.hochgeladen ? "hochgeladen" : "externe Adresse"}</div>
        </div>
        <div class="bild-zeile-aktionen">
          ${i !== 0 ? `<button type="button" class="sekundaer-btn" data-hauptbild="${i}" title="Als Hauptbild festlegen" aria-label="Als Hauptbild festlegen">⭐</button>` : ""}
          <button type="button" class="entfernen-btn" data-remove="${i}" title="Bild entfernen" aria-label="Bild entfernen">✕</button>
        </div>
      </div>`
          )
          .join("")
      : `<p class="muted">Noch keine Bilder hinterlegt.</p>`;

    box.querySelectorAll(".bild-beschreibung").forEach((el, i) => {
      el.addEventListener("change", (e) => (bilder[i].beschreibung = e.target.value || null));
    });
    box.querySelectorAll("[data-hauptbild]").forEach((btn) => {
      btn.addEventListener("click", () => alsHauptbildFestlegen(Number(btn.dataset.hauptbild)));
    });
    box.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => bildEntfernen(Number(btn.dataset.remove)));
    });
  }

  const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // entspricht image_upload.MAX_SIZE in HA
  const UPLOAD_ERLAUBTE_TYPEN = ["image/jpeg", "image/png", "image/gif"];

  async function fotoHochladen(file) {
    if (!file) return;
    if (!UPLOAD_ERLAUBTE_TYPEN.includes(file.type)) {
      setUploadStatus("Nicht unterstütztes Dateiformat. Erlaubt: JPEG, PNG, GIF.", "error");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadStatus("Datei ist zu gross (maximal 10 MB erlaubt).", "error");
      return;
    }
    try {
      app._pruefeVerbindung();
    } catch (err) {
      setUploadStatus(err.message, "error");
      return;
    }

    setUploadStatus(`„${file.name}“ wird hochgeladen …`);
    try {
      const bild = await app.haClient.bildHochladen(file);
      bilder.push({ url: bild.url, beschreibung: null, hochgeladen: true });
      setUploadStatus(`„${file.name}“ erfolgreich hochgeladen.`, "success");
      zeichneBilder();
    } catch (err) {
      setUploadStatus(err?.message || "Upload fehlgeschlagen.", "error");
    }
  }

  function zeichneSterne() {
    const box = container.querySelector("#bewertung-sterne");
    let html = "";
    for (let i = 1; i <= 5; i++) {
      html += `<button type="button" class="stern-btn${i <= bewertung ? " stern-gefuellt" : ""}" data-stern="${i}" aria-label="${i} von 5 Sternen" aria-pressed="${i <= bewertung}">★</button>`;
    }
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Bewertung in Sternen");
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
        <p class="muted">Das erste Bild in der Liste ist das Hauptbild.</p>
        <div id="bilder-liste"></div>
        <div class="upload-row">
          <button type="button" class="hinzufuegen-btn" id="foto-aufnehmen-btn">📷 Foto aufnehmen</button>
          <button type="button" class="hinzufuegen-btn" id="foto-bibliothek-btn">🖼️ Aus Fotos wählen</button>
        </div>
        <input type="file" id="foto-kamera-input" accept="image/jpeg,image/png,image/gif" capture="environment" hidden />
        <input type="file" id="foto-bibliothek-input" accept="image/jpeg,image/png,image/gif" hidden />
        <span class="upload-status muted" id="upload-status"></span>
        <details style="margin-top:10px">
          <summary class="muted" style="cursor:pointer">Oder externe Bild-Adresse manuell hinzufügen</summary>
          <div class="liste-zeile" style="margin-top:8px">
            <input type="url" id="externe-bild-url" placeholder="https://…" />
            <button type="button" class="hinzufuegen-btn" id="bild-hinzufuegen-btn" style="width:auto">Hinzufügen</button>
          </div>
        </details>
      </section>

      <section class="formular-abschnitt">
        <h2>Bewertung</h2>
        <div class="feld-gruppe">
          <div class="sterne-reihe" id="bewertung-sterne"></div>
        </div>
      </section>

      <div class="aktions-reihe">
        <button type="button" class="abbrechen-btn" id="abbrechen-btn">Abbrechen</button>
        <button type="submit" class="primaer" id="speichern-btn">Speichern</button>
      </div>
    </form>
  `;

  zeichneOeffnungszeiten();
  zeichneBilder();
  zeichneSterne();

  container.querySelector("#abbrechen-btn").addEventListener("click", () => {
    if (bestehender) {
      app.navigate(`#/hofladen/${bestehender.id}`);
    } else {
      app.navigate("#/");
    }
  });

  container.querySelector("#oz-hinzufuegen-btn").addEventListener("click", () => {
    oeffnungszeiten.push({ wochentag: 1, beginn: "08:00", ende: "18:00" });
    zeichneOeffnungszeiten();
  });
  container.querySelector("#bild-hinzufuegen-btn").addEventListener("click", () => {
    const urlFeld = container.querySelector("#externe-bild-url");
    const url = urlFeld.value.trim();
    if (!url) return;
    bilder.push({ url, beschreibung: null, hochgeladen: false });
    urlFeld.value = "";
    zeichneBilder();
  });

  container.querySelector("#foto-aufnehmen-btn").addEventListener("click", () => {
    container.querySelector("#foto-kamera-input").click();
  });
  container.querySelector("#foto-bibliothek-btn").addEventListener("click", () => {
    container.querySelector("#foto-bibliothek-input").click();
  });
  container.querySelector("#foto-kamera-input").addEventListener("change", (e) => {
    fotoHochladen(e.target.files[0]);
    e.target.value = "";
  });
  container.querySelector("#foto-bibliothek-input").addEventListener("change", (e) => {
    fotoHochladen(e.target.files[0]);
    e.target.value = "";
  });

  container.querySelector("#standort-uebernehmen-btn").addEventListener("click", () => {
    standortUebernehmen(container);
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
      // Für die Konflikterkennung (Phase 8b): Stand, auf dem bearbeitet wurde
      version: daten.version,
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
      bilder: bilder
        .filter((b) => b.url)
        .map((b) => ({ url: b.url, beschreibung: b.beschreibung || null, hochgeladen: !!b.hochgeladen })),
    };

    const submitBtn = container.querySelector("#speichern-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Speichert …";

    try {
      const gespeichert = await app.speichereHofladen(zuSpeichern);
      app.navigate(`#/hofladen/${gespeichert.id}`);
    } catch (err) {
      if (err.code === "version_conflict" && zuSpeichern.id) {
        app.navigate(`#/konflikt/${zuSpeichern.id}`);
        return;
      }
      fehlerBox.textContent = err.message;
      fehlerBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Speichern";
    }
  });
}
