/**
 * „Hofladen finden“ (Hofladen-Discovery, Phase 7): Suche in OpenStreetMap,
 * Auswahl des Kandidaten, Prüfen der Angaben mit Herkunft – danach öffnet
 * sich der normale Editor mit den übernommenen Angaben. Gegenstück zum
 * gleichnamigen Dialog im HA-Verwaltungs-Panel; die Logik steht in
 * src/finden.js. Der Dialog speichert nichts.
 *
 * Der Standort des Geräts wird nur für die Suche an die eigene HA-Instanz
 * gesendet und nicht gespeichert. Die KI-Auswertung ist Opt-in, nie
 * vorausgewählt und nur mit in HA gewählter `ai_task`-Entität möglich.
 */

import { escapeHtml } from "../html.js";
import { aktuellerStandort } from "../naehe.js";
import {
  FINDEN_STANDARD_RADIUS_METER,
  FINDEN_MIN_RADIUS_METER,
  FINDEN_MAX_RADIUS_METER,
  FINDEN_FEHLERMELDUNGEN,
  FINDEN_WEBSITE_STATUS,
  FINDEN_KI_STATUS,
  FINDEN_QUELLEN_LABEL,
  FINDEN_ZEILEN,
  FINDEN_VERMUTUNGEN,
  baueEntwurf,
  findeBestehenden,
  istGueltigeKoordinate,
  istHttpUrl,
  kandidatGruende,
  koordinatenZahl,
  quellenListe,
  radiusText,
  zeileWert,
} from "../finden.js";

const ANREICHERN_TIMEOUT_MS = 90_000;

const KONFIDENZ_TEXT = {
  hoch: "✔ hohe Sicherheit",
  mittel: "• mittlere Sicherheit",
  niedrig: "○ niedrige Sicherheit",
};

function neuerZustand() {
  return {
    schritt: 1,
    name: "",
    website: "",
    latitude: "",
    longitude: "",
    radius: FINDEN_STANDARD_RADIUS_METER,
    erweitert: false,
    ki: false,
    kiEntitaet: null,
    standortText: "",
    standortFehler: false,
    busy: false,
    fehler: "",
    kandidaten: [],
    gewaehlt: null,
    ereignisse: {},
    vorschlag: null,
    felder: {},
  };
}

function meldung(err, fallback) {
  return FINDEN_FEHLERMELDUNGEN[err?.code] || err?.message || fallback;
}

export function renderFinden(container, app) {
  const z = neuerZustand();
  let abmelden = null;
  let timer = null;
  let aktiv = true;

  // Beim Verlassen der Ansicht (anderer Container-Inhalt) Abo beenden.
  const beobachter = new MutationObserver(() => {
    if (!container.isConnected) {
      aktiv = false;
      beendeAbo();
      beobachter.disconnect();
    }
  });
  beobachter.observe(document.body, { childList: true, subtree: true });

  function beendeAbo() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const unsub = abmelden;
    abmelden = null;
    if (unsub) Promise.resolve().then(() => unsub()).catch(() => {});
  }

  /** Eingaben aus dem DOM sichern, bevor neu gezeichnet wird. */
  function erfasse() {
    const feld = (n) => container.querySelector(`[data-feld="${n}"]`);
    for (const n of ["name", "website", "latitude", "longitude"]) {
      const el = feld(n);
      if (el) z[n] = el.value;
    }
    const radius = container.querySelector("[data-radius]");
    if (radius) z.radius = Number(radius.value) || FINDEN_STANDARD_RADIUS_METER;
    const erweitert = container.querySelector("[data-erweitert]");
    if (erweitert) z.erweitert = !!erweitert.checked;
    const ki = container.querySelector("[data-ki]");
    if (ki) z.ki = !!ki.checked;
  }

  function zeichne() {
    if (!aktiv) return;
    container.innerHTML = `<div data-finden class="finden">${html()}</div>`;
    binde();
  }

  // --- Schritt 1: Suche ---------------------------------------------------
  function schritt1() {
    const kiBlock = z.kiEntitaet
      ? `<label class="finden-check"><input type="checkbox" data-ki ${z.ki ? "checked" : ""}>
           <span>Website-Text mit KI auswerten (Angebote, Zahlungsarten, Öffnungszeiten)<br>
           <span class="muted">Der Text der Website wird an <b>${escapeHtml(z.kiEntitaet)}</b> gesendet – je nach Anbieter verlässt er dein Netzwerk. Die KI schlägt nur vor; Belegtes und Vermutetes wird getrennt angezeigt.</span></span></label>`
      : `<p class="muted" data-ki-hinweis>🤖 KI-Auswertung nicht eingerichtet. Zum Aktivieren in Home Assistant unter Einstellungen → Geräte &amp; Dienste → HofKarte → Konfigurieren eine „AI Task“-Entität wählen (setzt eine KI-Integration wie Ollama oder OpenAI voraus).</p>`;
    return `
      <p class="muted finden-intro">Sucht in OpenStreetMap nach Hofläden in der Nähe und liest, falls vorhanden, deren Website aus. Es wird nichts gespeichert.</p>
      <section class="formular-abschnitt">
        <h2>Suche</h2>
        <div class="feld-gruppe"><label>Name (optional)</label>
          <input type="text" data-feld="name" value="${escapeHtml(z.name)}" autocomplete="off" /></div>
        <div class="feld-gruppe"><label>Website (optional)</label>
          <input type="url" data-feld="website" value="${escapeHtml(z.website)}" placeholder="https://…" autocomplete="off" /></div>
        <div class="feld-gruppe"><label>Breitengrad</label>
          <input type="text" inputmode="decimal" data-feld="latitude" value="${escapeHtml(String(z.latitude))}" /></div>
        <div class="feld-gruppe"><label>Längengrad</label>
          <input type="text" inputmode="decimal" data-feld="longitude" value="${escapeHtml(String(z.longitude))}" /></div>
        <button type="button" class="hinzufuegen-btn" data-standort>📍 Mein Standort</button>
        <p class="muted${z.standortFehler ? " fehler-text" : ""}" data-standort-text>${escapeHtml(z.standortText)}</p>
        <div class="feld-gruppe"><label>Umkreis: <span data-radius-anzeige>${escapeHtml(radiusText(z.radius))}</span></label>
          <input type="range" min="${FINDEN_MIN_RADIUS_METER}" max="${FINDEN_MAX_RADIUS_METER}" step="50" value="${z.radius}" data-radius /></div>
        <label class="finden-check"><input type="checkbox" data-erweitert ${z.erweitert ? "checked" : ""}>
          <span>Erweiterte Suche (mehr Tags, langsamer, noch wenig getestet)</span></label>
        ${kiBlock}
      </section>
      ${fehlerHtml()}
      <div class="aktions-reihe">
        <button type="button" class="primaer" data-suchen ${z.busy ? "disabled" : ""}>${z.busy ? "Suche läuft …" : "Suchen"}</button>
        <button type="button" data-leer>Manuell erfassen</button>
      </div>`;
  }

  // --- Schritt 2: Kandidaten ----------------------------------------------
  function schritt2() {
    const eintraege = z.kandidaten
      .map((k, i) => {
        const adresse = [k.adresse, [k.plz, k.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        const bestehend = findeBestehenden(k, app.state.hoflaeden);
        return `<label class="finden-kandidat${z.gewaehlt === i ? " gewaehlt" : ""}">
          <input type="radio" name="finden-kandidat" value="${i}" data-kandidat ${z.gewaehlt === i ? "checked" : ""} />
          <span class="finden-text">
            <span class="finden-name">${escapeHtml(k.name || "(ohne Namen)")}</span>
            <span class="muted">${escapeHtml(KONFIDENZ_TEXT[k.konfidenz] || "")}</span>
            ${adresse ? `<span class="muted">${escapeHtml(adresse)}</span>` : ""}
            <span class="muted">${escapeHtml(kandidatGruende(k))}</span>
            ${bestehend ? `<span class="finden-warnung">⚠ Möglicherweise schon erfasst: ${escapeHtml(bestehend.name)}</span>` : ""}
          </span></label>`;
      })
      .join("");
    const mitWebsite = !!z.website.trim();
    return `
      <p class="muted finden-intro">${
        z.kandidaten.length
          ? `${z.kandidaten.length} Treffer. Bitte den passenden Hofladen wählen (sortiert nach Übereinstimmung).`
          : "In OpenStreetMap wurde im Umkreis nichts gefunden. Du kannst die Website direkt auswerten lassen oder den Hofladen von Hand erfassen."
      }</p>
      ${z.kandidaten.length ? `<section class="formular-abschnitt"><h2>Treffer</h2>${eintraege}</section>` : ""}
      ${fehlerHtml()}
      <div class="aktions-reihe">
        <button type="button" class="primaer" data-weiter ${z.gewaehlt === null ? "disabled" : ""}>Weiter</button>
        ${mitWebsite ? `<button type="button" data-nur-website>Nur Website auswerten</button>` : ""}
        <button type="button" data-leer>Manuell erfassen</button>
        <button type="button" data-zurueck>Zurück</button>
      </div>`;
  }

  // --- Schritt 3: Prüfen ----------------------------------------------------
  function schritt3() {
    const ev = z.ereignisse;
    const status = (phase, titel) => {
      const e = ev[phase];
      if (!e) return z.busy ? `⏳ ${titel} …` : "";
      const text = phase === "website" ? FINDEN_WEBSITE_STATUS[e.status] || e.status : "OpenStreetMap-Daten übernommen";
      return `${e.status === "ok" ? "✔" : "ℹ"} ${text}`;
    };
    const kiText = !z.ki
      ? ""
      : ev.ki
        ? `${ev.ki.status === "ok" ? "✔" : "ℹ"} ${FINDEN_KI_STATUS[ev.ki.status] || ev.ki.status}`
        : z.busy
          ? "⏳ KI …"
          : "";
    const fortschritt = [status("osm", "OpenStreetMap"), status("website", "Website"), kiText]
      .filter(Boolean)
      .map((t) => `<p class="muted finden-status">${escapeHtml(t)}</p>`)
      .join("");

    let zeilen = "";
    let osmDabei = false;
    if (z.vorschlag) {
      const liste = quellenListe(z.vorschlag.quellen);
      const abweichungen = z.vorschlag.abweichungen || {};
      for (const zeile of FINDEN_ZEILEN) {
        const wert = zeileWert(zeile, z.vorschlag.daten);
        if (!wert) continue;
        const q = zeile.felder.map((f) => liste.find((x) => x.feld === f)).find(Boolean);
        if (q?.quelle === "openstreetmap") osmDabei = true;
        const label = q ? FINDEN_QUELLEN_LABEL[q.quelle] || q.quelle : "";
        const badge = q
          ? istHttpUrl(q.url)
            ? `<a href="${escapeHtml(q.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
            : escapeHtml(label)
          : "";
        const abwFeld = zeile.felder.find((x) => abweichungen[x]);
        const abw = abwFeld
          ? `<span class="finden-warnung">⚠ weicht von ${escapeHtml(FINDEN_QUELLEN_LABEL[abweichungen[abwFeld]] || "der anderen Quelle")} ab</span>`
          : "";
        zeilen += `<label class="finden-zeile"><input type="checkbox" data-feldwahl="${escapeHtml(zeile.key)}" ${z.felder[zeile.key] ? "checked" : ""} />
          <span class="finden-text"><span class="finden-label">${escapeHtml(zeile.label)}</span>
          <span>${escapeHtml(wert)}</span><span class="muted">${badge}</span>${abw}</span></label>`;
      }
      let vermutet = "";
      const vermutungen = z.vorschlag.vermutungen || {};
      for (const v of FINDEN_VERMUTUNGEN) {
        const werte = Array.isArray(vermutungen[v.key]) ? vermutungen[v.key] : [];
        if (!werte.length) continue;
        vermutet += `<label class="finden-zeile finden-vermutung"><input type="checkbox" data-feldwahl="vermutung:${escapeHtml(v.key)}" ${z.felder[`vermutung:${v.key}`] ? "checked" : ""} />
          <span class="finden-text"><span class="finden-label">${escapeHtml(v.label)} (vermutet)</span>
          <span>${escapeHtml(werte.map((x) => x.name ?? x).join(", "))}</span>
          <span class="finden-warnung">⚠ Von der KI genannt, steht aber nicht im Text der Website. Bitte selbst prüfen.</span></span></label>`;
      }
      if (!zeilen && !vermutet) zeilen = `<p class="muted">Es wurden keine verwertbaren Angaben gefunden.</p>`;
      var block = `
        <p class="muted finden-intro">Gewählte Angaben werden in ein neues Formular übernommen. Gespeichert wird erst dort.</p>
        ${zeilen ? `<section class="formular-abschnitt"><h2>Angaben</h2>${zeilen}</section>` : ""}
        ${vermutet ? `<section class="formular-abschnitt"><h2>Vermutungen der KI (nicht belegt)</h2>${vermutet}</section>` : ""}
        ${osmDabei ? `<p class="muted">© OpenStreetMap-Mitwirkende (ODbL)</p>` : ""}`;
    }
    return `
      <div class="finden-fortschritt">${fortschritt}</div>
      ${block || ""}
      ${fehlerHtml()}
      <div class="aktions-reihe">
        <button type="button" class="primaer" data-uebernehmen ${z.vorschlag ? "" : "disabled"}>In Formular übernehmen</button>
        <button type="button" data-zurueck>Zurück</button>
      </div>`;
  }

  function fehlerHtml() {
    return z.fehler ? `<div class="hinweis-leiste fehler">${escapeHtml(z.fehler)}</div>` : "";
  }

  function html() {
    return z.schritt === 1 ? schritt1() : z.schritt === 2 ? schritt2() : schritt3();
  }

  // --- Aktionen -------------------------------------------------------------
  async function ermittleStandort() {
    z.standortText = "Standort wird ermittelt …";
    z.standortFehler = false;
    aktualisiereStandortText();
    let pos = null;
    let fehler = null;
    try {
      pos = await aktuellerStandort();
    } catch (err) {
      fehler = err;
    }
    if (!aktiv) return;
    // Zwischenzeitliche Eingaben sichern, dann den Standort setzen.
    if (z.schritt === 1) erfasse();
    if (pos) {
      z.latitude = pos.latitude.toFixed(6);
      z.longitude = pos.longitude.toFixed(6);
      z.standortText = "Aktueller Standort des Geräts übernommen.";
      z.standortFehler = false;
    } else {
      z.standortText = `${fehler.message} Koordinaten können von Hand eingetragen werden.`;
      z.standortFehler = true;
    }
    if (z.schritt === 1 && !z.busy) zeichne();
  }

  function aktualisiereStandortText() {
    const el = container.querySelector("[data-standort-text]");
    if (el) {
      el.textContent = z.standortText;
      el.classList.toggle("fehler-text", z.standortFehler);
    }
  }

  async function suche() {
    erfasse();
    if (z.busy) return;
    const lat = koordinatenZahl(z.latitude);
    const lon = koordinatenZahl(z.longitude);
    if (!istGueltigeKoordinate(lat, lon)) {
      z.fehler = FINDEN_FEHLERMELDUNGEN.invalid_coordinates;
      zeichne();
      return;
    }
    z.fehler = "";
    z.busy = true;
    zeichne();
    try {
      app._pruefeVerbindung();
      const kandidaten = await app.haClient.hofladenSuchen({
        latitude: lat,
        longitude: lon,
        radius: z.radius,
        erweitert: z.erweitert,
        name: z.name.trim(),
        website: z.website.trim(),
      });
      if (!aktiv) return;
      z.kandidaten = kandidaten;
      z.gewaehlt = kandidaten[0] && kandidaten[0].konfidenz === "hoch" ? 0 : null;
      z.schritt = 2;
    } catch (err) {
      if (!aktiv) return;
      z.fehler = meldung(err, "Die Suche ist fehlgeschlagen.");
    }
    z.busy = false;
    zeichne();
  }

  async function anreichern({ ohneKandidat = false } = {}) {
    if (z.busy) return;
    const kandidat = ohneKandidat ? null : z.kandidaten[z.gewaehlt];
    const website = z.website.trim();
    if (!kandidat && !website) return;
    z.fehler = "";
    z.busy = true;
    z.ereignisse = {};
    z.vorschlag = null;
    z.schritt = 3;
    zeichne();

    const aufEreignis = (e) => {
      if (!aktiv || !e) return;
      if (e.phase === "fertig") {
        z.vorschlag = e.vorschlag || { daten: {}, quellen: [], abweichungen: {} };
        z.felder = {};
        for (const zeile of FINDEN_ZEILEN) z.felder[zeile.key] = zeileWert(zeile, z.vorschlag.daten) !== "";
        // KI-Vermutungen sind nie vorausgewählt.
        for (const v of FINDEN_VERMUTUNGEN) z.felder[`vermutung:${v.key}`] = false;
        z.busy = false;
        beendeAbo();
      } else if (e.phase) {
        z.ereignisse[e.phase] = e;
      }
      zeichne();
    };
    try {
      app._pruefeVerbindung();
      const unsub = await app.haClient.hofladenAnreichern(
        { kandidat, website, ki: z.ki && !!z.kiEntitaet },
        aufEreignis
      );
      if (!aktiv || z.schritt !== 3) {
        Promise.resolve().then(() => unsub()).catch(() => {});
        return;
      }
      abmelden = unsub;
      if (z.busy) {
        timer = setTimeout(() => {
          if (z.busy) {
            z.busy = false;
            z.fehler = "Die Anreicherung hat zu lange gedauert.";
            beendeAbo();
            zeichne();
          }
        }, ANREICHERN_TIMEOUT_MS);
      } else {
        beendeAbo();
      }
    } catch (err) {
      if (!aktiv) return;
      z.busy = false;
      z.fehler = meldung(err, "Die Anreicherung ist fehlgeschlagen.");
      zeichne();
    }
  }

  function zumEditor(entwurf) {
    beendeAbo();
    app.entwurf = entwurf;
    app.navigate("#/neu");
  }

  function uebernehmen() {
    if (!z.vorschlag) return;
    zumEditor(baueEntwurf(z.vorschlag, z.felder, { name: z.name.trim(), website: z.website.trim() }));
  }

  function leerAnlegen() {
    erfasse();
    const daten = {};
    if (z.name.trim()) daten.name = z.name.trim();
    if (z.website.trim()) daten.website = z.website.trim();
    const lat = koordinatenZahl(z.latitude);
    const lon = koordinatenZahl(z.longitude);
    if (istGueltigeKoordinate(lat, lon)) {
      daten.latitude = lat;
      daten.longitude = lon;
    }
    zumEditor({ daten, quellen: [] });
  }

  function zurueck() {
    beendeAbo();
    z.busy = false;
    z.fehler = "";
    z.schritt = Math.max(1, z.schritt - 1);
    zeichne();
  }

  function binde() {
    const auf = (sel, fn) => container.querySelector(sel)?.addEventListener("click", fn);
    auf("[data-suchen]", suche);
    auf("[data-standort]", () => {
      erfasse();
      ermittleStandort();
    });
    auf("[data-leer]", leerAnlegen);
    auf("[data-weiter]", () => anreichern());
    auf("[data-nur-website]", () => anreichern({ ohneKandidat: true }));
    auf("[data-uebernehmen]", uebernehmen);
    container.querySelectorAll("[data-zurueck]").forEach((b) => b.addEventListener("click", zurueck));

    container.querySelector("[data-radius]")?.addEventListener("input", (e) => {
      z.radius = Number(e.target.value) || FINDEN_STANDARD_RADIUS_METER;
      const anzeige = container.querySelector("[data-radius-anzeige]");
      if (anzeige) anzeige.textContent = radiusText(z.radius);
    });
    container.querySelectorAll("[data-kandidat]").forEach((el) =>
      el.addEventListener("change", () => {
        z.gewaehlt = Number(el.value);
        container.querySelector("[data-weiter]")?.removeAttribute("disabled");
        container.querySelectorAll(".finden-kandidat").forEach((l) =>
          l.classList.toggle("gewaehlt", !!l.querySelector("input")?.checked)
        );
      })
    );
    container.querySelectorAll("[data-feldwahl]").forEach((el) =>
      el.addEventListener("change", () => {
        z.felder[el.dataset.feldwahl] = el.checked;
      })
    );
  }

  // Start: KI-Entität erfragen (optional) und Gerätestandort übernehmen.
  zeichne();
  ermittleStandort();
  if (app.haClient?.kiEntitaet) {
    app.haClient
      .kiEntitaet()
      .then((entitaet) => {
        if (!aktiv) return;
        z.kiEntitaet = entitaet;
        if (z.schritt === 1 && !z.busy) {
          erfasse();
          zeichne();
        }
      })
      .catch(() => {});
  }
}
