/**
 * Editor zum Anlegen/Bearbeiten eines Hofladens (ab 2.0.0 mit denselben
 * sieben Gruppen wie die Detailansicht und das Home-Assistant-Panel, siehe
 * src/gruppen.js; Chips für Angebote, Schalter für Zahlungsarten,
 * Wochentage-Editor, feste Fussleiste mit Ungespeichert-Anzeige).
 *
 * Bewusste Vereinfachung gegenüber `hofkarte-panel.js` (der
 * Home-Assistant-eigenen Verwaltungsoberfläche): Sonderöffnungszeiten
 * (Ferien/Feiertage) werden hier nicht bearbeitet – dafür weiterhin die
 * HA-eigene Oberfläche nutzen. Bilder können dagegen wie im HA-Panel
 * sowohl per geführtem Upload (Kamera/Fotobibliothek, über Home
 * Assistants `image_upload`-Komponente) als auch per externer
 * Bild-Adresse hinzugefügt werden (siehe zeichneBilder()).
 */

import { escapeHtml } from "../html.js";
import { bildVerkleinern } from "../bilder.js";
import { extractImageId } from "../ha-client.js";
import { bereinigteQuellen, quelleFuerSpeichern, quellenSchnappschuss } from "../finden.js";
import { icon, setzeSchaltflaeche } from "../icons.js";
import { HOF_GRUPPEN, VOLLSTAENDIGKEIT_TEXT, vollstaendigkeit } from "../gruppen.js";
import { herkunftHtml } from "./detail.js";

/** Merkt sich pro Gruppe, ob sie aufgeklappt ist (bis zum Neuladen). */
const gruppenZustand = new Map();

/** Öffnet eine Gruppe beim nächsten Aufruf des Editors (z. B. aus „Noch offen“). */
export function oeffneEditorGruppe(id) {
  gruppenZustand.set(id, true);
}

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

export function holeStandort(optionen) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, optionen);
  });
}

export function standortFehlermeldung(err) {
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
  setzeSchaltflaeche(btn, "standort", "Ermittle Standort …");

  try {
    let pos;
    try {
      pos = await holeStandort({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
    } catch (err) {
      if (err?.code === 1) throw err; // Berechtigung verweigert: kein zweiter Versuch sinnvoll
      setzeSchaltflaeche(btn, "standort", "Erneuter Versuch …");
      pos = await holeStandort({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
    }
    container.querySelector("#f-latitude").value = pos.coords.latitude.toFixed(6);
    container.querySelector("#f-longitude").value = pos.coords.longitude.toFixed(6);
  } catch (err) {
    alert(standortFehlermeldung(err));
  } finally {
    btn.disabled = false;
    setzeSchaltflaeche(btn, "standort", "Aktuellen Standort übernehmen");
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

  // Entwurf aus „Hofladen finden“ (einmalig verbrauchen): füllt das Formular
  // vor; gespeichert wird erst hier im Editor.
  const entwurf = !hofladenId ? app.entwurf : null;
  if (!hofladenId) app.entwurf = null;
  if (entwurf?.daten) Object.assign(daten, entwurf.daten);

  // Ergänzung aus „Angaben ergänzen“ (einmalig verbrauchen): ergänzt/ersetzt die
  // gewählten Angaben des bestehenden Hofladens; gespeichert wird erst hier.
  const ergaenzung = bestehender && app.ergaenzung && app.ergaenzung.hofladenId === bestehender.id ? app.ergaenzung : null;
  if (bestehender) app.ergaenzung = null;
  if (ergaenzung?.daten) Object.assign(daten, ergaenzung.daten);

  // Herkunft der Angaben („quellen“): bei bestehenden Hofläden erhalten,
  // beim Speichern nur für Felder behalten, die nicht von Hand geändert
  // wurden (siehe finden.js, bereinigteQuellen).
  const quellen = (ergaenzung?.quellen || bestehender?.quellen || entwurf?.quellen || []).map((q) => ({ ...q }));
  const quellenStand = quellenSchnappschuss(quellen, daten);

  // Lokaler Arbeitszustand für Listenfelder (Öffnungszeiten, Angebote,
  // Zahlungsarten, Bilder), damit Zeilen ohne vollständiges Neuzeichnen
  // hinzugefügt/entfernt werden können.
  const oeffnungszeiten = (daten.oeffnungszeiten || []).map((o) => ({ ...o, wochentag: Number(o.wochentag) }));
  const bilder = (daten.bilder || []).map((b) => ({ ...b }));
  const angebote = (daten.angebote || []).map((a) => a.name).filter(Boolean);
  const zahlungsarten = (daten.zahlungsarten || []).map((z) => z.name).filter(Boolean);
  let bewertung = Number(daten.bewertung) || 0;
  let anfangsStand = null; // wird nach dem ersten Zeichnen gesetzt

  const ANGEBOT_VORSCHLAEGE = ["Eier", "Gemüse", "Obst", "Kartoffeln", "Milch", "Käse", "Fleisch", "Honig", "Brot", "Blumen"];
  const ZAHLUNG_STANDARD = ["Bargeld", "TWINT", "Karte"];

  const gleichNamig = (liste, name) => liste.some((x) => x.toLowerCase() === name.toLowerCase());

  function fuegeNamenHinzu(liste, text) {
    for (const name of String(text).split(",").map((t) => t.trim()).filter(Boolean)) {
      if (!gleichNamig(liste, name)) liste.push(name);
    }
  }

  function zeichneTage() {
    const box = container.querySelector("#oeffnungszeiten-liste");
    box.innerHTML = WOCHENTAGE.map((w) => {
      const zeilen = oeffnungszeiten
        .map((o, i) => ({ o, i }))
        .filter(({ o }) => o.wochentag === w.wert)
        .map(
          ({ o, i }) => `
        <div class="oeffnungszeit-zeile" data-index="${i}">
          <input type="time" class="oz-beginn" value="${escapeHtml(o.beginn || "")}" aria-label="Beginn ${w.label}" />
          <span aria-hidden="true">–</span>
          <input type="time" class="oz-ende" value="${escapeHtml(o.ende || "")}" aria-label="Ende ${w.label}" />
          <button type="button" class="entfernen-btn" data-remove="${i}" title="Zeit entfernen" aria-label="Öffnungszeit ${w.label} entfernen">${icon("schliessen", { klein: true })}</button>
        </div>`
        )
        .join("");
      const hatZeiten = zeilen !== "";
      const kopierbar = hatZeiten && w.wert <= 5;
      return `<div class="oz-tag" data-tag="${w.wert}">
        <div class="oz-tag-kopf">
          <strong>${w.label}</strong>
          ${hatZeiten ? "" : `<span class="muted">geschlossen</span>`}
          <span class="grow"></span>
          ${kopierbar ? `<button type="button" class="link-btn oz-kopieren" data-kopieren="${w.wert}">Auf Mo–Fr kopieren</button>` : ""}
          <button type="button" class="link-btn oz-plus" data-plus="${w.wert}" aria-label="Zeit für ${w.label} hinzufügen">+ Zeit</button>
        </div>
        ${zeilen}
      </div>`;
    }).join("");

    box.querySelectorAll(".oz-beginn").forEach((el) => {
      const i = Number(el.closest("[data-index]").dataset.index);
      el.addEventListener("change", (e) => {
        oeffnungszeiten[i].beginn = e.target.value;
        aktualisiere();
      });
    });
    box.querySelectorAll(".oz-ende").forEach((el) => {
      const i = Number(el.closest("[data-index]").dataset.index);
      el.addEventListener("change", (e) => {
        oeffnungszeiten[i].ende = e.target.value;
        aktualisiere();
      });
    });
    box.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        oeffnungszeiten.splice(Number(btn.dataset.remove), 1);
        zeichneTage();
        aktualisiere();
      });
    });
    box.querySelectorAll("[data-plus]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tag = Number(btn.dataset.plus);
        const letzte = oeffnungszeiten.filter((o) => o.wochentag === tag).pop();
        oeffnungszeiten.push(
          letzte && letzte.ende && letzte.ende < "18:00"
            ? { wochentag: tag, beginn: letzte.ende, ende: "18:00" }
            : { wochentag: tag, beginn: "08:00", ende: "18:00" }
        );
        zeichneTage();
        aktualisiere();
      });
    });
    box.querySelectorAll("[data-kopieren]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const quelle = Number(btn.dataset.kopieren);
        const vorlage = oeffnungszeiten.filter((o) => o.wochentag === quelle && o.beginn && o.ende);
        const ziele = [1, 2, 3, 4, 5].filter((t) => t !== quelle);
        const ueberschreibt = oeffnungszeiten.some((o) => ziele.includes(o.wochentag) && (o.beginn || o.ende));
        if (ueberschreibt && !confirm("Die Zeiten der anderen Tage von Montag bis Freitag werden ersetzt. Fortfahren?")) return;
        for (let i = oeffnungszeiten.length - 1; i >= 0; i--) {
          if (ziele.includes(oeffnungszeiten[i].wochentag)) oeffnungszeiten.splice(i, 1);
        }
        for (const t of ziele) vorlage.forEach((o) => oeffnungszeiten.push({ wochentag: t, beginn: o.beginn, ende: o.ende }));
        zeichneTage();
        aktualisiere();
      });
    });
  }

  function zeichneAngebote() {
    const box = container.querySelector("#angebote-chips");
    box.innerHTML = angebote.length
      ? angebote
          .map((a, i) => `<span class="chip"><span>${escapeHtml(a)}</span><button type="button" data-chip-weg="${i}" aria-label="${escapeHtml(a)} entfernen">${icon("schliessen", { klein: true })}</button></span>`)
          .join("")
      : `<span class="muted">Noch keine Angebote.</span>`;
    box.querySelectorAll("[data-chip-weg]").forEach((btn) =>
      btn.addEventListener("click", () => {
        angebote.splice(Number(btn.dataset.chipWeg), 1);
        zeichneAngebote();
        aktualisiere();
      })
    );
    const vorschlaege = ANGEBOT_VORSCHLAEGE.filter((v) => !gleichNamig(angebote, v));
    const vBox = container.querySelector("#angebote-vorschlaege");
    vBox.innerHTML = vorschlaege.map((v) => `<button type="button" class="chip chip-vorschlag" data-vorschlag="${escapeHtml(v)}">+ ${escapeHtml(v)}</button>`).join("");
    vBox.querySelectorAll("[data-vorschlag]").forEach((btn) =>
      btn.addEventListener("click", () => {
        fuegeNamenHinzu(angebote, btn.dataset.vorschlag);
        zeichneAngebote();
        aktualisiere();
      })
    );
    container.querySelector("#f-angebote").value = angebote.join(", ");
  }

  function zeichneZahlungen() {
    const box = container.querySelector("#zahlungen-schalter");
    const alle = [...ZAHLUNG_STANDARD, ...zahlungsarten.filter((z) => !gleichNamig(ZAHLUNG_STANDARD, z))];
    box.innerHTML = alle
      .map((z) => {
        const an = gleichNamig(zahlungsarten, z);
        return `<button type="button" class="schalter" role="switch" aria-checked="${an}" data-zahlung="${escapeHtml(z)}"><span class="schalter-name">${escapeHtml(z)}</span><span class="schalter-knopf" aria-hidden="true"></span><span class="nur-sr">${an ? "an" : "aus"}</span></button>`;
      })
      .join("");
    box.querySelectorAll("[data-zahlung]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const name = btn.dataset.zahlung;
        const i = zahlungsarten.findIndex((x) => x.toLowerCase() === name.toLowerCase());
        if (i >= 0) zahlungsarten.splice(i, 1);
        else zahlungsarten.push(name);
        zeichneZahlungen();
        aktualisiere();
      })
    );
    container.querySelector("#f-zahlungsarten").value = zahlungsarten.join(", ");
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
          ${i !== 0 ? `<button type="button" class="sekundaer-btn" data-hauptbild="${i}" title="Als Hauptbild festlegen" aria-label="Als Hauptbild festlegen">${icon("funkeln", { klein: true })}</button>` : ""}
          <button type="button" class="entfernen-btn" data-remove="${i}" title="Bild entfernen" aria-label="Bild entfernen">${icon("schliessen", { klein: true })}</button>
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
    aktualisiere();
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
      const zuLaden = await bildVerkleinern(file);
      const bild = await app.haClient.bildHochladen(zuLaden);
      bilder.push({ url: bild.url, beschreibung: null, hochgeladen: true });
      setUploadStatus(`„${file.name}“ erfolgreich hochgeladen.`, "success");
      zeichneBilder();
    } catch (err) {
      setUploadStatus(err?.message || "Upload fehlgeschlagen.", "error");
    }
  }

  const GRUPPEN_FELDER = {
    grunddaten: `
        <div class="feld-gruppe">
          <label for="f-name">Name *</label>
          <input type="text" id="f-name" required value="${escapeHtml(daten.name)}" />
          <p class="feld-fehler" id="f-name-fehler" role="alert" hidden></p>
        </div>
        <div class="feld-gruppe">
          <label for="f-beschreibung">Beschreibung</label>
          <textarea id="f-beschreibung">${escapeHtml(daten.beschreibung || "")}</textarea>
        </div>
        <div class="feld-gruppe">
          <label id="bewertung-label">Bewertung</label>
          <div class="sterne-zeile">
            <div class="sterne-reihe" id="bewertung-sterne"></div>
            <button type="button" class="link-btn" id="bewertung-reset" hidden>Zurücksetzen</button>
          </div>
        </div>
        <div class="feld-gruppe">
          <label for="f-bemerkung">Bemerkung (intern)</label>
          <textarea id="f-bemerkung">${escapeHtml(daten.bemerkung || "")}</textarea>
        </div>`,
    adresse: `
        <div class="feld-gruppe">
          <label for="f-adresse">Adresse</label>
          <input type="text" id="f-adresse" value="${escapeHtml(daten.adresse || "")}" />
        </div>
        <div class="feld-zeile">
          <div class="feld-gruppe">
            <label for="f-plz">PLZ</label>
            <input type="text" id="f-plz" inputmode="numeric" value="${escapeHtml(daten.plz || "")}" />
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
        <div class="feld-zeile">
          <div class="feld-gruppe">
            <label for="f-latitude">Breitengrad</label>
            <input type="text" id="f-latitude" inputmode="decimal" value="${escapeHtml(String(daten.latitude ?? ""))}" />
            <p class="feld-fehler" id="f-latitude-fehler" role="alert" hidden></p>
          </div>
          <div class="feld-gruppe">
            <label for="f-longitude">Längengrad</label>
            <input type="text" id="f-longitude" inputmode="decimal" value="${escapeHtml(String(daten.longitude ?? ""))}" />
            <p class="feld-fehler" id="f-longitude-fehler" role="alert" hidden></p>
          </div>
        </div>
        <button type="button" class="hinzufuegen-btn" id="standort-uebernehmen-btn">${icon("standort", { klein: true })} Aktuellen Standort übernehmen</button>`,
    kontakt: `
        <div class="feld-gruppe">
          <label for="f-mobilnummer">Mobilnummer</label>
          <input type="tel" id="f-mobilnummer" value="${escapeHtml(daten.mobilnummer || "")}" />
        </div>
        <div class="feld-gruppe">
          <label for="f-email">E-Mail</label>
          <input type="email" id="f-email" value="${escapeHtml(daten.email || "")}" />
          <p class="feld-fehler" id="f-email-fehler" role="alert" hidden></p>
        </div>
        <div class="feld-gruppe">
          <label for="f-website">Website</label>
          <input type="url" id="f-website" value="${escapeHtml(daten.website || "")}" />
        </div>`,
    oeffnungszeiten: `
        <div id="oeffnungszeiten-liste"></div>`,
    angebote: `
        <div class="gruppen-label">Angebote</div>
        <div class="chip-liste" id="angebote-chips"></div>
        <div class="chip-liste" id="angebote-vorschlaege"></div>
        <div class="liste-zeile liste-zeile-abstand">
          <input type="text" id="angebot-neu" placeholder="Angebot hinzufügen" aria-label="Neues Angebot" enterkeyhint="done" />
          <button type="button" class="hinzufuegen-btn" id="angebot-hinzufuegen-btn">Hinzufügen</button>
        </div>
        <input type="hidden" id="f-angebote" value="" />
        <div class="gruppen-label">Zahlungsarten</div>
        <div class="schalter-liste" id="zahlungen-schalter"></div>
        <div class="liste-zeile liste-zeile-abstand">
          <input type="text" id="zahlung-neu" placeholder="Weitere Zahlungsart" aria-label="Weitere Zahlungsart" enterkeyhint="done" />
          <button type="button" class="hinzufuegen-btn" id="zahlung-hinzufuegen-btn">Hinzufügen</button>
        </div>
        <input type="hidden" id="f-zahlungsarten" value="" />`,
    bilder: `
        <p class="muted">Das erste Bild in der Liste ist das Hauptbild.</p>
        <div id="bilder-liste"></div>
        <div class="upload-row">
          <button type="button" class="hinzufuegen-btn" id="foto-aufnehmen-btn">${icon("kamera", { klein: true })} Foto aufnehmen</button>
          <button type="button" class="hinzufuegen-btn" id="foto-bibliothek-btn">${icon("bild", { klein: true })} Aus Fotos wählen</button>
        </div>
        <input type="file" id="foto-kamera-input" accept="image/jpeg,image/png,image/gif" capture="environment" hidden />
        <input type="file" id="foto-bibliothek-input" accept="image/jpeg,image/png,image/gif" hidden />
        <span class="upload-status muted" id="upload-status"></span>
        <details class="manuell-bild">
          <summary class="muted klickbar">Oder externe Bild-Adresse manuell hinzufügen</summary>
          <div class="liste-zeile liste-zeile-abstand">
            <input type="url" id="externe-bild-url" placeholder="https://…" />
            <button type="button" class="hinzufuegen-btn" id="bild-hinzufuegen-btn">Hinzufügen</button>
          </div>
        </details>`,
    herkunft: `${herkunftHtml({ quellen })}<p class="muted">Die Herkunft wird beim Speichern automatisch angepasst, wenn du eine Angabe von Hand änderst.</p>`,
  };

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
        aktualisiere();
      });
    });
    const reset = container.querySelector("#bewertung-reset");
    if (reset) reset.hidden = bewertung === 0;
  }

  const wert = (id) => container.querySelector(id).value.trim();

  /** Aktueller Stand des Formulars im Format, das gespeichert wird (ohne Herkunft). */
  function sammle() {
    return {
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
      latitude: wert("#f-latitude") ? Number(wert("#f-latitude").replace(",", ".")) : null,
      longitude: wert("#f-longitude") ? Number(wert("#f-longitude").replace(",", ".")) : null,
      bewertung,
      oeffnungszeiten: oeffnungszeiten.filter((o) => o.beginn && o.ende).map((o) => ({ ...o })),
      angebote: textZuTags(angebote.join(","), "angebot"),
      zahlungsarten: textZuTags(zahlungsarten.join(","), "zahlungsart"),
      bilder: bilder
        .filter((b) => b.url)
        .map((b) => ({ url: b.url, beschreibung: b.beschreibung || null, hochgeladen: !!b.hochgeladen })),
    };
  }

  /** Vergleichbarer Text des Standes (ohne zufällige Tag-IDs). */
  function stand() {
    const d = sammle();
    return JSON.stringify({ ...d, angebote: angebote, zahlungsarten: zahlungsarten });
  }

  const gruppenHtml = HOF_GRUPPEN.filter((g) => g.id !== "herkunft" || quellen.length).map((g) => {
    const offen = gruppenZustand.has(g.id) ? gruppenZustand.get(g.id) : g.offenEditor;
    return `<details class="detail-abschnitt einklappbar gruppe" id="gruppe-${g.id}" data-gruppe="${g.id}"${offen ? " open" : ""}>
      <summary>
        <span class="vollst leer"><span class="nur-sr" data-vollst-text></span></span>
        <span class="titel">${escapeHtml(g.titel)}</span>
        <span class="kurzinfo" data-kurzinfo></span>
      </summary>
      <div class="gruppen-inhalt">${GRUPPEN_FELDER[g.id]}</div>
    </details>`;
  }).join("");

  const zeigeFinden = !hofladenId && app.haClient;

  container.innerHTML = `
    <div id="editor-fehler" class="hinweis-leiste fehler" role="alert" hidden></div>

    <div class="auto-leiste">
      <div class="auto-titel">Angaben automatisch ergänzen</div>
      <div class="auto-knoepfe">
        <button type="button" class="chip chip-knopf" id="webseite-info-btn">${icon("weltkugel", { klein: true })} Von der Webseite</button>
        ${zeigeFinden ? `<button type="button" class="chip chip-knopf" id="finden-btn">${icon("suche", { klein: true })} Hofladen finden</button>` : ""}
      </div>
      <p class="muted" id="auto-status">Liest Name, Beschreibung, Adresse, Telefon und E-Mail von der eingetragenen Webseite.</p>
    </div>

    <div class="gruppen-leiste"><button type="button" class="link-btn" id="alle-btn">Alle ausklappen</button></div>

    <form id="editor-form" novalidate>
      ${gruppenHtml}

      <div class="fussleiste" id="fussleiste">
        <span class="ungespeichert" id="ungespeichert" role="status" hidden>${icon("info", { klein: true })} Ungespeichert</span>
        <span class="grow"></span>
        <button type="button" class="abbrechen-btn" id="abbrechen-btn">Abbrechen</button>
        <button type="submit" class="primaer" id="speichern-btn">Speichern</button>
      </div>
    </form>
  `;

  zeichneTage();
  zeichneBilder();
  zeichneSterne();
  zeichneAngebote();
  zeichneZahlungen();

  // Ein Entwurf aus „Hofladen finden“/„Angaben ergänzen“ ist noch nicht gespeichert und gilt daher als geändert.
  anfangsStand = entwurf || ergaenzung ? "" : stand();
  aktualisiere();

  /** Vollständigkeit, Kurzinfo und Ungespeichert-Anzeige neu berechnen. */
  function aktualisiere() {
    if (anfangsStand === null) return;
    const aktuell = sammle();
    container.querySelectorAll("details.gruppe").forEach((d) => {
      const g = HOF_GRUPPEN.find((x) => x.id === d.dataset.gruppe);
      const st = vollstaendigkeit(g, g.id === "herkunft" ? { quellen } : aktuell);
      const punkt = d.querySelector(".vollst");
      punkt.className = `vollst ${st}`;
      d.querySelector("[data-vollst-text]").textContent = `${VOLLSTAENDIGKEIT_TEXT[st]}: `;
      d.querySelector("[data-kurzinfo]").textContent = g.kurzinfo(g.id === "herkunft" ? { quellen } : aktuell);
    });
    container.querySelector("#ungespeichert").hidden = stand() === anfangsStand;
  }
  const istGeaendert = () => stand() !== anfangsStand;

  container.querySelectorAll("details.gruppe").forEach((d) => {
    d.addEventListener("toggle", () => gruppenZustand.set(d.dataset.gruppe, d.open));
  });
  container.querySelector("#alle-btn").addEventListener("click", (e) => {
    const gruppen = [...container.querySelectorAll("details.gruppe")];
    const auf = gruppen.some((d) => !d.open);
    gruppen.forEach((d) => (d.open = auf));
    e.currentTarget.textContent = auf ? "Alle einklappen" : "Alle ausklappen";
  });
  container.querySelector("#editor-form").addEventListener("input", aktualisiere);
  container.querySelector("#editor-form").addEventListener("change", aktualisiere);

  container.querySelector("#abbrechen-btn").addEventListener("click", () => {
    if (istGeaendert() && !confirm("Änderungen verwerfen?")) return;
    if (bestehender) {
      app.navigate(`#/hofladen/${bestehender.id}`);
    } else {
      app.navigate("#/");
    }
  });

  container.querySelector("#bewertung-reset").addEventListener("click", () => {
    bewertung = 0;
    zeichneSterne();
    aktualisiere();
  });

  container.querySelector("#angebot-hinzufuegen-btn").addEventListener("click", () => {
    const feld = container.querySelector("#angebot-neu");
    fuegeNamenHinzu(angebote, feld.value);
    feld.value = "";
    zeichneAngebote();
    aktualisiere();
  });
  container.querySelector("#angebot-neu").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      container.querySelector("#angebot-hinzufuegen-btn").click();
    }
  });
  container.querySelector("#zahlung-hinzufuegen-btn").addEventListener("click", () => {
    const feld = container.querySelector("#zahlung-neu");
    fuegeNamenHinzu(zahlungsarten, feld.value);
    feld.value = "";
    zeichneZahlungen();
    aktualisiere();
  });
  container.querySelector("#zahlung-neu").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      container.querySelector("#zahlung-hinzufuegen-btn").click();
    }
  });

  container.querySelector("#bild-hinzufuegen-btn").addEventListener("click", () => {
    const urlFeld = container.querySelector("#externe-bild-url");
    const url = urlFeld.value.trim();
    if (!url) return;
    bilder.push({ url, beschreibung: null, hochgeladen: false });
    urlFeld.value = "";
    zeichneBilder();
    aktualisiere();
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

  container.querySelector("#standort-uebernehmen-btn").addEventListener("click", async () => {
    await standortUebernehmen(container);
    aktualisiere();
  });

  container.querySelector("#webseite-info-btn").addEventListener("click", async () => {
    const status = container.querySelector("#auto-status");
    const website = container.querySelector("#f-website").value.trim();
    if (!website) {
      // Kontakt-Gruppe öffnen, damit das Feld sichtbar ist.
      container.querySelector("#gruppe-kontakt").open = true;
      container.querySelector("#f-website").focus();
      status.textContent = "Bitte zuerst eine Webseite eintragen.";
      status.classList.add("fehlertext");
      return;
    }
    status.classList.remove("fehlertext");
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
      status.textContent = "Angaben von der Webseite übernommen. Bitte prüfen und speichern.";
    } catch (err) {
      status.textContent = `Konnte keine Infos ermitteln: ${err.message}`;
      status.classList.add("fehlertext");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("weltkugel", { klein: true })}<span>Von der Webseite</span>`;
      aktualisiere();
    }
  });

  container.querySelector("#finden-btn")?.addEventListener("click", () => app.navigate("#/finden"));

  /** Fehler an einem Feld anzeigen, die Gruppe öffnen und das Feld fokussieren. */
  function feldFehler(feldId, text) {
    const feld = container.querySelector(feldId);
    const gruppe = feld.closest("details.gruppe");
    if (gruppe) gruppe.open = true;
    const meldung = container.querySelector(`#${feld.id}-fehler`);
    if (meldung) {
      meldung.textContent = text;
      meldung.hidden = false;
      feld.setAttribute("aria-describedby", meldung.id);
    }
    feld.setAttribute("aria-invalid", "true");
    feld.focus();
  }

  function fehlerZuruecksetzen() {
    container.querySelectorAll(".feld-fehler").forEach((m) => (m.hidden = true));
    container.querySelectorAll("[aria-invalid]").forEach((f) => f.removeAttribute("aria-invalid"));
  }

  /** Prüft das Formular; liefert `true`, wenn alles gültig ist (sonst wurde das erste fehlerhafte Feld fokussiert). */
  function pruefe() {
    fehlerZuruecksetzen();
    if (!wert("#f-name")) {
      feldFehler("#f-name", "Bitte einen Namen eintragen.");
      return false;
    }
    const breite = wert("#f-latitude");
    const laenge = wert("#f-longitude");
    const b = Number(breite.replace(",", "."));
    const l = Number(laenge.replace(",", "."));
    if (breite && (!Number.isFinite(b) || b < -90 || b > 90)) {
      feldFehler("#f-latitude", "Der Breitengrad muss eine Zahl zwischen -90 und 90 sein.");
      return false;
    }
    if (laenge && (!Number.isFinite(l) || l < -180 || l > 180)) {
      feldFehler("#f-longitude", "Der Längengrad muss eine Zahl zwischen -180 und 180 sein.");
      return false;
    }
    if (breite && !laenge) {
      feldFehler("#f-longitude", "Bitte auch den Längengrad eintragen.");
      return false;
    }
    if (laenge && !breite) {
      feldFehler("#f-latitude", "Bitte auch den Breitengrad eintragen.");
      return false;
    }
    const mail = wert("#f-email");
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      feldFehler("#f-email", "Bitte eine gültige E-Mail-Adresse eintragen.");
      return false;
    }
    return true;
  }

  container.querySelector("#editor-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fehlerBox = container.querySelector("#editor-fehler");
    fehlerBox.hidden = true;
    if (!pruefe()) return;

    const zuSpeichern = sammle();
    zuSpeichern.quellen = bereinigteQuellen(quellen, quellenStand, zuSpeichern).map(quelleFuerSpeichern);

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
      fehlerBox.scrollIntoView?.({ block: "center" });
      submitBtn.disabled = false;
      submitBtn.textContent = "Speichern";
    }
  });
}
