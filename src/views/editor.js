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
import { t, aktuelleSprache } from "../i18n.js";
import { ermittleAdresse, vergleicheAdresse } from "../adresse.js";
import { bildVerkleinern } from "../bilder.js";
import { extractImageId } from "../ha-client.js";
import { bereinigteQuellen, quelleFuerSpeichern, quellenSchnappschuss, quellenWert } from "../finden.js";
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
  { wert: 1, get label() { return t("Montag"); } },
  { wert: 2, get label() { return t("Dienstag"); } },
  { wert: 3, get label() { return t("Mittwoch"); } },
  { wert: 4, get label() { return t("Donnerstag"); } },
  { wert: 5, get label() { return t("Freitag"); } },
  { wert: 6, get label() { return t("Samstag"); } },
  { wert: 7, get label() { return t("Sonntag"); } },
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
    automat_24h: false,
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
      return t("Standortzugriff wurde verweigert. Bitte in den iPhone-Einstellungen unter „HofKarte“ (bzw. „Safari“ → „Websites“, falls die App nicht im Home-Bildschirm installiert ist) den Standortzugriff erlauben und erneut versuchen.");
    case 2: // POSITION_UNAVAILABLE
      return t("Standort konnte nicht ermittelt werden (Position aktuell nicht verfügbar).");
    case 3: // TIMEOUT
      return t("Zeitüberschreitung beim Ermitteln des Standorts. Am besten im Freien bzw. bei gutem GPS-/WLAN-Empfang erneut versuchen.");
    default:
      return t("Standort konnte nicht ermittelt werden.");
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
    alert(t("Dieser Browser unterstützt keine Standortabfrage."));
    return;
  }

  btn.disabled = true;
  setzeSchaltflaeche(btn, "standort", t("Ermittle Standort …"));

  try {
    let pos;
    try {
      pos = await holeStandort({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
    } catch (err) {
      if (err?.code === 1) throw err; // Berechtigung verweigert: kein zweiter Versuch sinnvoll
      setzeSchaltflaeche(btn, "standort", t("Erneuter Versuch …"));
      pos = await holeStandort({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
    }
    container.querySelector("#f-latitude").value = pos.coords.latitude.toFixed(6);
    container.querySelector("#f-longitude").value = pos.coords.longitude.toFixed(6);
  } catch (err) {
    alert(standortFehlermeldung(err));
  } finally {
    btn.disabled = false;
    setzeSchaltflaeche(btn, "standort", t("Aktuellen Standort übernehmen"));
  }
}

function textZuTags(text, praefix) {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ id: neueId(praefix), name }));
}

export function renderEditor(container, app, hofladenId) {
  const bestehender = hofladenId ? app.hofladenMitId(hofladenId) : null;
  if (hofladenId && !bestehender) {
    container.innerHTML = `<p class="hinweis-leiste">${escapeHtml(t("Hofladen nicht gefunden."))}</p>`;
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
  let automat24h = daten.automat_24h === true;
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
    for (const name of String(text).split(",").map((s) => s.trim()).filter(Boolean)) {
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
          <input type="time" class="oz-beginn" value="${escapeHtml(o.beginn || "")}" aria-label="${escapeHtml(t("Beginn {tag}", { tag: w.label }))}" />
          <span aria-hidden="true">–</span>
          <input type="time" class="oz-ende" value="${escapeHtml(o.ende || "")}" aria-label="${escapeHtml(t("Ende {tag}", { tag: w.label }))}" />
          <button type="button" class="entfernen-btn" data-remove="${i}" title="${escapeHtml(t("Zeit entfernen"))}" aria-label="${escapeHtml(t("Öffnungszeit {tag} entfernen", { tag: w.label }))}">${icon("schliessen", { klein: true })}</button>
        </div>`
        )
        .join("");
      const hatZeiten = zeilen !== "";
      const kopierbar = hatZeiten && w.wert <= 5;
      return `<div class="oz-tag" data-tag="${w.wert}">
        <div class="oz-tag-kopf">
          <strong>${escapeHtml(w.label)}</strong>
          ${hatZeiten ? "" : `<span class="muted">${escapeHtml(t("geschlossen"))}</span>`}
          <span class="grow"></span>
          ${kopierbar ? `<button type="button" class="link-btn oz-kopieren" data-kopieren="${w.wert}">${escapeHtml(t("Auf Mo–Fr kopieren"))}</button>` : ""}
          <button type="button" class="link-btn oz-plus" data-plus="${w.wert}" aria-label="${escapeHtml(t("Zeit für {tag} hinzufügen", { tag: w.label }))}">${escapeHtml(t("+ Zeit"))}</button>
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
        const ziele = [1, 2, 3, 4, 5].filter((d) => d !== quelle);
        const ueberschreibt = oeffnungszeiten.some((o) => ziele.includes(o.wochentag) && (o.beginn || o.ende));
        if (ueberschreibt && !confirm(t("Die Zeiten der anderen Tage von Montag bis Freitag werden ersetzt. Fortfahren?"))) return;
        for (let i = oeffnungszeiten.length - 1; i >= 0; i--) {
          if (ziele.includes(oeffnungszeiten[i].wochentag)) oeffnungszeiten.splice(i, 1);
        }
        for (const tg of ziele) vorlage.forEach((o) => oeffnungszeiten.push({ wochentag: tg, beginn: o.beginn, ende: o.ende }));
        zeichneTage();
        aktualisiere();
      });
    });
  }

  function zeichneAngebote() {
    const box = container.querySelector("#angebote-chips");
    box.innerHTML = angebote.length
      ? angebote
          .map((a, i) => `<span class="chip"><span>${escapeHtml(a)}</span><button type="button" data-chip-weg="${i}" aria-label="${escapeHtml(t("{name} entfernen", { name: a }))}">${icon("schliessen", { klein: true })}</button></span>`)
          .join("")
      : `<span class="muted">${escapeHtml(t("Noch keine Angebote."))}</span>`;
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
        return `<button type="button" class="schalter" role="switch" aria-checked="${an}" data-zahlung="${escapeHtml(z)}"><span class="schalter-name">${escapeHtml(z)}</span><span class="schalter-knopf" aria-hidden="true"></span><span class="nur-sr">${an ? t("an") : t("aus")}</span></button>`;
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
          <input type="text" class="bild-beschreibung" placeholder="${escapeHtml(t("Beschreibung (optional)"))}" value="${escapeHtml(b.beschreibung || "")}" />
          <div class="bild-zeile-meta">${i === 0 ? `${escapeHtml(t("Hauptbild"))} · ` : ""}${escapeHtml(b.hochgeladen ? t("hochgeladen") : t("externe Adresse"))}</div>
        </div>
        <div class="bild-zeile-aktionen">
          ${i !== 0 ? `<button type="button" class="sekundaer-btn" data-hauptbild="${i}" title="${escapeHtml(t("Als Hauptbild festlegen"))}" aria-label="${escapeHtml(t("Als Hauptbild festlegen"))}">${icon("funkeln", { klein: true })}</button>` : ""}
          <button type="button" class="entfernen-btn" data-remove="${i}" title="${escapeHtml(t("Bild entfernen"))}" aria-label="${escapeHtml(t("Bild entfernen"))}">${icon("schliessen", { klein: true })}</button>
        </div>
      </div>`
          )
          .join("")
      : `<p class="muted">${escapeHtml(t("Noch keine Bilder hinterlegt."))}</p>`;

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
      setUploadStatus(t("Nicht unterstütztes Dateiformat. Erlaubt: JPEG, PNG, GIF."), "error");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setUploadStatus(t("Datei ist zu gross (maximal 10 MB erlaubt)."), "error");
      return;
    }
    try {
      app._pruefeVerbindung();
    } catch (err) {
      setUploadStatus(err.message, "error");
      return;
    }

    setUploadStatus(t("„{name}“ wird hochgeladen …", { name: file.name }));
    try {
      const zuLaden = await bildVerkleinern(file);
      const bild = await app.haClient.bildHochladen(zuLaden);
      bilder.push({ url: bild.url, beschreibung: null, hochgeladen: true });
      setUploadStatus(t("„{name}“ erfolgreich hochgeladen.", { name: file.name }), "success");
      zeichneBilder();
    } catch (err) {
      setUploadStatus(err?.message || t("Upload fehlgeschlagen."), "error");
    }
  }

  const GRUPPEN_FELDER = {
    grunddaten: `
        <div class="feld-gruppe">
          <label for="f-name">${escapeHtml(t("Name"))} *</label>
          <input type="text" id="f-name" required value="${escapeHtml(daten.name)}" />
          <p class="feld-fehler" id="f-name-fehler" role="alert" hidden></p>
        </div>
        <div class="feld-gruppe">
          <label for="f-beschreibung">${escapeHtml(t("Beschreibung"))}</label>
          <textarea id="f-beschreibung">${escapeHtml(daten.beschreibung || "")}</textarea>
        </div>
        <div class="feld-gruppe">
          <label id="bewertung-label">${escapeHtml(t("Bewertung"))}</label>
          <div class="sterne-zeile">
            <div class="sterne-reihe" id="bewertung-sterne"></div>
            <button type="button" class="link-btn" id="bewertung-reset" hidden>${escapeHtml(t("Zurücksetzen"))}</button>
          </div>
        </div>
        <div class="feld-gruppe">
          <label for="f-bemerkung">${escapeHtml(t("Bemerkung (intern)"))}</label>
          <textarea id="f-bemerkung">${escapeHtml(daten.bemerkung || "")}</textarea>
        </div>`,
    adresse: `
        <div class="feld-gruppe">
          <label for="f-adresse">${escapeHtml(t("Adresse"))}</label>
          <input type="text" id="f-adresse" value="${escapeHtml(daten.adresse || "")}" />
        </div>
        <div class="feld-zeile">
          <div class="feld-gruppe">
            <label for="f-plz">${escapeHtml(t("PLZ"))}</label>
            <input type="text" id="f-plz" inputmode="numeric" value="${escapeHtml(daten.plz || "")}" />
          </div>
          <div class="feld-gruppe">
            <label for="f-ort">${escapeHtml(t("Ort"))}</label>
            <input type="text" id="f-ort" value="${escapeHtml(daten.ort || "")}" />
          </div>
        </div>
        <div class="feld-gruppe">
          <label for="f-land">${escapeHtml(t("Land"))}</label>
          <input type="text" id="f-land" value="${escapeHtml(daten.land || "")}" />
        </div>
        <div class="feld-zeile">
          <div class="feld-gruppe">
            <label for="f-latitude">${escapeHtml(t("Breitengrad"))}</label>
            <input type="text" id="f-latitude" inputmode="decimal" value="${escapeHtml(String(daten.latitude ?? ""))}" />
            <p class="feld-fehler" id="f-latitude-fehler" role="alert" hidden></p>
          </div>
          <div class="feld-gruppe">
            <label for="f-longitude">${escapeHtml(t("Längengrad"))}</label>
            <input type="text" id="f-longitude" inputmode="decimal" value="${escapeHtml(String(daten.longitude ?? ""))}" />
            <p class="feld-fehler" id="f-longitude-fehler" role="alert" hidden></p>
          </div>
        </div>
        <button type="button" class="hinzufuegen-btn" id="standort-uebernehmen-btn">${icon("standort", { klein: true })} ${escapeHtml(t("Aktuellen Standort übernehmen"))}</button>
        <button type="button" class="hinzufuegen-btn" id="adresse-ermitteln-btn">${icon("standort", { klein: true })} ${escapeHtml(t("Adresse aus Koordinaten ermitteln"))}</button>
        <div id="adresse-vorschlag" class="adresse-vorschlag" role="status" aria-live="polite"></div>`,
    kontakt: `
        <div class="feld-gruppe">
          <label for="f-mobilnummer">${escapeHtml(t("Mobilnummer"))}</label>
          <input type="tel" id="f-mobilnummer" value="${escapeHtml(daten.mobilnummer || "")}" />
        </div>
        <div class="feld-gruppe">
          <label for="f-email">${escapeHtml(t("E-Mail"))}</label>
          <input type="email" id="f-email" value="${escapeHtml(daten.email || "")}" />
          <p class="feld-fehler" id="f-email-fehler" role="alert" hidden></p>
        </div>
        <div class="feld-gruppe">
          <label for="f-website">${escapeHtml(t("Website"))}</label>
          <input type="url" id="f-website" value="${escapeHtml(daten.website || "")}" />
        </div>`,
    oeffnungszeiten: `
        <div class="schalter-liste">
          <button type="button" class="schalter" role="switch" id="automat-schalter" aria-checked="${automat24h}" aria-describedby="automat-hinweis"><span class="schalter-name">${escapeHtml(t("24h-Automat"))}</span><span class="schalter-knopf" aria-hidden="true"></span><span class="nur-sr">${automat24h ? t("an") : t("aus")}</span></button>
        </div>
        <p class="muted" id="automat-hinweis">${escapeHtml(t("Rund um die Uhr zugänglich. Dann gilt der Hofladen immer als geöffnet, ausser an Tagen mit einer Sonder-Schliessung; die Wochenzeiten werden nicht verwendet."))}</p>
        <div id="oeffnungszeiten-liste"${automat24h ? " hidden" : ""}></div>`,
    angebote: `
        <div class="gruppen-label">${escapeHtml(t("Angebote"))}</div>
        <div class="chip-liste" id="angebote-chips"></div>
        <div class="chip-liste" id="angebote-vorschlaege"></div>
        <div class="liste-zeile liste-zeile-abstand">
          <input type="text" id="angebot-neu" placeholder="${escapeHtml(t("Angebot hinzufügen"))}" aria-label="${escapeHtml(t("Neues Angebot"))}" enterkeyhint="done" />
          <button type="button" class="hinzufuegen-btn" id="angebot-hinzufuegen-btn">${escapeHtml(t("Hinzufügen"))}</button>
        </div>
        <input type="hidden" id="f-angebote" value="" />
        <div class="gruppen-label">${escapeHtml(t("Zahlungsarten"))}</div>
        <div class="schalter-liste" id="zahlungen-schalter"></div>
        <div class="liste-zeile liste-zeile-abstand">
          <input type="text" id="zahlung-neu" placeholder="${escapeHtml(t("Weitere Zahlungsart"))}" aria-label="${escapeHtml(t("Weitere Zahlungsart"))}" enterkeyhint="done" />
          <button type="button" class="hinzufuegen-btn" id="zahlung-hinzufuegen-btn">${escapeHtml(t("Hinzufügen"))}</button>
        </div>
        <input type="hidden" id="f-zahlungsarten" value="" />`,
    bilder: `
        <p class="muted">${escapeHtml(t("Das erste Bild in der Liste ist das Hauptbild."))}</p>
        <div id="bilder-liste"></div>
        <div class="upload-row">
          <button type="button" class="hinzufuegen-btn" id="foto-aufnehmen-btn">${icon("kamera", { klein: true })} ${escapeHtml(t("Foto aufnehmen"))}</button>
          <button type="button" class="hinzufuegen-btn" id="foto-bibliothek-btn">${icon("bild", { klein: true })} ${escapeHtml(t("Aus Fotos wählen"))}</button>
        </div>
        <input type="file" id="foto-kamera-input" accept="image/jpeg,image/png,image/gif" capture="environment" hidden />
        <input type="file" id="foto-bibliothek-input" accept="image/jpeg,image/png,image/gif" hidden />
        <span class="upload-status muted" id="upload-status"></span>
        <details class="manuell-bild">
          <summary class="muted klickbar">${escapeHtml(t("Oder externe Bild-Adresse manuell hinzufügen"))}</summary>
          <div class="liste-zeile liste-zeile-abstand">
            <input type="url" id="externe-bild-url" placeholder="https://…" />
            <button type="button" class="hinzufuegen-btn" id="bild-hinzufuegen-btn">${escapeHtml(t("Hinzufügen"))}</button>
          </div>
        </details>`,
    herkunft: `${herkunftHtml({ quellen })}<p class="muted">${escapeHtml(t("Die Herkunft wird beim Speichern automatisch angepasst, wenn du eine Angabe von Hand änderst."))}</p>`,
  };

  function zeichneSterne() {
    const box = container.querySelector("#bewertung-sterne");
    let html = "";
    for (let i = 1; i <= 5; i++) {
      html += `<button type="button" class="stern-btn${i <= bewertung ? " stern-gefuellt" : ""}" data-stern="${i}" aria-label="${escapeHtml(t("{n} von 5 Sternen", { n: i }))}" aria-pressed="${i <= bewertung}">★</button>`;
    }
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", t("Bewertung in Sternen"));
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
      automat_24h: automat24h,
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
        <span class="titel">${escapeHtml(t(g.titel))}</span>
        <span class="kurzinfo" data-kurzinfo></span>
      </summary>
      <div class="gruppen-inhalt">${GRUPPEN_FELDER[g.id]}</div>
    </details>`;
  }).join("");

  const zeigeFinden = !hofladenId && app.haClient;

  container.innerHTML = `
    <div id="editor-fehler" class="hinweis-leiste fehler" role="alert" hidden></div>

    <div class="auto-leiste">
      <div class="auto-titel">${escapeHtml(t("Angaben automatisch ergänzen"))}</div>
      <div class="auto-knoepfe">
        <button type="button" class="chip chip-knopf" id="webseite-info-btn">${icon("weltkugel", { klein: true })} ${escapeHtml(t("Von der Webseite"))}</button>
        ${zeigeFinden ? `<button type="button" class="chip chip-knopf" id="finden-btn">${icon("suche", { klein: true })} ${escapeHtml(t("Hofladen finden"))}</button>` : ""}
      </div>
      <p class="muted" id="auto-status">${escapeHtml(t("Liest Name, Beschreibung, Adresse, Telefon und E-Mail von der eingetragenen Webseite."))}</p>
    </div>

    <div class="gruppen-leiste"><button type="button" class="link-btn" id="alle-btn">${escapeHtml(t("Alle ausklappen"))}</button></div>

    <form id="editor-form" novalidate>
      ${gruppenHtml}

      <div class="fussleiste" id="fussleiste">
        <span class="ungespeichert" id="ungespeichert" role="status" hidden>${icon("info", { klein: true })} ${escapeHtml(t("Ungespeichert"))}</span>
        <span class="grow"></span>
        <button type="button" class="abbrechen-btn" id="abbrechen-btn">${escapeHtml(t("Abbrechen"))}</button>
        <button type="submit" class="primaer" id="speichern-btn">${escapeHtml(t("Speichern"))}</button>
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
    e.currentTarget.textContent = auf ? t("Alle einklappen") : t("Alle ausklappen");
  });
  container.querySelector("#editor-form").addEventListener("input", aktualisiere);
  container.querySelector("#editor-form").addEventListener("change", aktualisiere);

  container.querySelector("#abbrechen-btn").addEventListener("click", () => {
    if (istGeaendert() && !confirm(t("Änderungen verwerfen?"))) return;
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

  container.querySelector("#automat-schalter").addEventListener("click", (e) => {
    automat24h = !automat24h;
    e.currentTarget.setAttribute("aria-checked", String(automat24h));
    e.currentTarget.querySelector(".nur-sr").textContent = automat24h ? t("an") : t("aus");
    container.querySelector("#oeffnungszeiten-liste").hidden = automat24h;
    aktualisiere();
  });

  container.querySelector("#standort-uebernehmen-btn").addEventListener("click", async () => {
    await standortUebernehmen(container);
    aktualisiere();
  });

  // Adresse aus Koordinaten (OpenStreetMap/Nominatim): nur auf Tipp; Lücken
  // vorgewählt, Abweichungen nie; übernommen wird erst nach «Übernehmen».
  const FELD_NAME = { adresse: () => t("Adresse"), plz: () => t("PLZ"), ort: () => t("Ort") };
  const ADRESSE_FEHLER = {
    koordinaten: () => t("Bitte zuerst gültige Koordinaten eintragen oder den Standort übernehmen."),
    netz: () => t("Keine Verbindung zu OpenStreetMap. Bitte später erneut versuchen."),
    dienst: () => t("OpenStreetMap hat die Anfrage abgelehnt. Bitte später erneut versuchen."),
    nichts: () => t("Zu diesen Koordinaten wurde keine Adresse gefunden."),
  };
  container.querySelector("#adresse-ermitteln-btn").addEventListener("click", async (e) => {
    const box = container.querySelector("#adresse-vorschlag");
    const btn = e.currentTarget;
    btn.disabled = true;
    box.innerHTML = `<p class="muted">${escapeHtml(t("Adresse wird ermittelt …"))}</p>`;
    try {
      const treffer = await ermittleAdresse(wert("#f-latitude"), wert("#f-longitude"), { sprache: aktuelleSprache() });
      const zeilen = vergleicheAdresse(
        { adresse: wert("#f-adresse"), plz: wert("#f-plz"), ort: wert("#f-ort") },
        treffer
      ).filter((z) => z.status !== "gleich");
      if (!zeilen.length) {
        box.innerHTML = `<p class="muted">${escapeHtml(t("Die Adresse stimmt bereits mit OpenStreetMap überein."))}</p>`;
        return;
      }
      box.innerHTML = `
        <div class="adresse-karte">
          <p><strong>${escapeHtml(t("Gefunden bei OpenStreetMap"))}</strong></p>
          ${zeilen
            .map(
              (z) => `<label class="finden-check"><input type="checkbox" data-adr="${z.feld}" ${z.vorgewaehlt ? "checked" : ""} />
                <span><strong>${escapeHtml(FELD_NAME[z.feld]())}:</strong> ${escapeHtml(z.neu)}${
                z.alt ? `<br><span class="muted">${escapeHtml(t("bisher: {wert}", { wert: z.alt }))}</span>` : ""
              }</span></label>`
            )
            .join("")}
          <p class="muted">${escapeHtml(t("Abweichende Angaben sind nicht vorgewählt. Daten von OpenStreetMap-Mitwirkenden (ODbL)."))}</p>
          <div class="aktions-reihe">
            <button type="button" class="primaer" id="adresse-uebernehmen-btn">${escapeHtml(t("Übernehmen"))}</button>
            <button type="button" id="adresse-verwerfen-btn">${escapeHtml(t("Verwerfen"))}</button>
          </div>
        </div>`;
      box.querySelector("#adresse-verwerfen-btn").addEventListener("click", () => {
        box.innerHTML = "";
      });
      box.querySelector("#adresse-uebernehmen-btn").addEventListener("click", () => {
        const feldId = { adresse: "#f-adresse", plz: "#f-plz", ort: "#f-ort" };
        for (const z of zeilen) {
          if (!box.querySelector(`[data-adr="${z.feld}"]`).checked) continue;
          container.querySelector(feldId[z.feld]).value = z.neu;
        }
        const jetzt = sammle();
        for (const z of zeilen) {
          if (!box.querySelector(`[data-adr="${z.feld}"]`).checked) continue;
          const alt = quellen.findIndex((q) => q.feld === z.feld);
          if (alt >= 0) quellen.splice(alt, 1);
          quellen.push({ feld: z.feld, quelle: "openstreetmap", status: "confirmed", url: treffer.osmUrl, lizenz: "ODbL" });
          quellenStand[z.feld] = quellenWert(z.feld, jetzt);
        }
        box.innerHTML = `<p class="muted">${escapeHtml(t("Adresse übernommen. Bitte prüfen und speichern."))}</p>`;
        aktualisiere();
      });
    } catch (err) {
      box.innerHTML = `<p class="muted fehlertext">${escapeHtml((ADRESSE_FEHLER[err.code] || ADRESSE_FEHLER.netz)())}</p>`;
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector("#webseite-info-btn").addEventListener("click", async () => {
    const status = container.querySelector("#auto-status");
    const website = container.querySelector("#f-website").value.trim();
    if (!website) {
      // Kontakt-Gruppe öffnen, damit das Feld sichtbar ist.
      container.querySelector("#gruppe-kontakt").open = true;
      container.querySelector("#f-website").focus();
      status.textContent = t("Bitte zuerst eine Webseite eintragen.");
      status.classList.add("fehlertext");
      return;
    }
    status.classList.remove("fehlertext");
    const btn = container.querySelector("#webseite-info-btn");
    btn.disabled = true;
    btn.textContent = t("Ermittle …");
    try {
      app._pruefeVerbindung();
      const info = await app.haClient.webseiteInfo(website);
      if (info.name && !container.querySelector("#f-name").value) container.querySelector("#f-name").value = info.name;
      if (info.beschreibung) container.querySelector("#f-beschreibung").value = info.beschreibung;
      if (info.adresse) container.querySelector("#f-adresse").value = info.adresse;
      if (info.mobilnummer) container.querySelector("#f-mobilnummer").value = info.mobilnummer;
      if (info.email) container.querySelector("#f-email").value = info.email;
      status.textContent = t("Angaben von der Webseite übernommen. Bitte prüfen und speichern.");
    } catch (err) {
      status.textContent = t("Konnte keine Infos ermitteln: {fehler}", { fehler: err.message });
      status.classList.add("fehlertext");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("weltkugel", { klein: true })}<span>${escapeHtml(t("Von der Webseite"))}</span>`;
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
      feldFehler("#f-name", t("Bitte einen Namen eintragen."));
      return false;
    }
    const breite = wert("#f-latitude");
    const laenge = wert("#f-longitude");
    const b = Number(breite.replace(",", "."));
    const l = Number(laenge.replace(",", "."));
    if (breite && (!Number.isFinite(b) || b < -90 || b > 90)) {
      feldFehler("#f-latitude", t("Der Breitengrad muss eine Zahl zwischen -90 und 90 sein."));
      return false;
    }
    if (laenge && (!Number.isFinite(l) || l < -180 || l > 180)) {
      feldFehler("#f-longitude", t("Der Längengrad muss eine Zahl zwischen -180 und 180 sein."));
      return false;
    }
    if (breite && !laenge) {
      feldFehler("#f-longitude", t("Bitte auch den Längengrad eintragen."));
      return false;
    }
    if (laenge && !breite) {
      feldFehler("#f-latitude", t("Bitte auch den Breitengrad eintragen."));
      return false;
    }
    const mail = wert("#f-email");
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      feldFehler("#f-email", t("Bitte eine gültige E-Mail-Adresse eintragen."));
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
    submitBtn.textContent = t("Speichert …");

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
      submitBtn.textContent = t("Speichern");
    }
  });
}
