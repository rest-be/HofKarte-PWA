/**
 * Webseite auslesen und Angaben prüfen (ab 2.0.0-dev.5), in zwei Varianten:
 * - neu (`#/erfassen/webseite`): ein neuer Hofladen entsteht aus der Webseite
 * - ergänzen (`#/hofladen/<id>/ergaenzen`): Angaben eines bestehenden Hofladens ergänzen
 *
 * Schritte: Webseite → Auslesen → Prüfen. Der Vergleich mit dem Bestehenden steht in
 * src/ergaenzen.js (Lücken vorgewählt, Abweichungen nie, Listen ergänzt, KI getrennt).
 * Die Übernahme öffnet den Editor; gespeichert wird erst dort. Die KI-Auswertung ist
 * Opt-in und nie vorausgewählt.
 */

import { escapeHtml, sichereHttpUrl } from "../html.js";
import { icon } from "../icons.js";
import { FINDEN_FEHLERMELDUNGEN, FINDEN_KI_STATUS, FINDEN_QUELLEN_LABEL, FINDEN_WEBSITE_STATUS, findeBestehenden, istHttpUrl } from "../finden.js";
import { STATUS, baueErgaenzung, vergleiche, vorauswahl } from "../ergaenzen.js";

const TIMEOUT_MS = 90_000;

const STATUS_TEXT = {
  [STATUS.luecke]: { text: "Fehlt noch", symbol: "plus" },
  [STATUS.ergaenzen]: { text: "Wird ergänzt", symbol: "plus" },
  [STATUS.abweichung]: { text: "Weicht ab", symbol: "warnung" },
  [STATUS.gleich]: { text: "Schon gleich", symbol: "haken" },
};

export function renderAuslesen(container, app, hofladenId = null) {
  const bestehend = hofladenId ? app.hofladenMitId(hofladenId) : null;
  if (hofladenId && !bestehend) {
    container.innerHTML = `<p class="hinweis-leiste">Hofladen nicht gefunden.</p>`;
    return;
  }
  const z = {
    schritt: "start", // start | laeuft | pruefen
    website: bestehend?.website || "",
    ki: false,
    kiEntitaet: null,
    ereignisse: {},
    vorschlag: null,
    vergleich: null,
    auswahl: {},
    fehler: "",
  };
  let aktiv = true;
  let abmelden = null;
  let timer = null;

  const beobachter = new MutationObserver(() => {
    if (!container.isConnected) {
      aktiv = false;
      beende();
      beobachter.disconnect();
    }
  });
  beobachter.observe(document.body, { childList: true, subtree: true });

  function beende() {
    if (timer) clearTimeout(timer);
    timer = null;
    const unsub = abmelden;
    abmelden = null;
    if (unsub) Promise.resolve().then(() => unsub()).catch(() => {});
  }

  const verbunden = () => !!app.haClient && !app.offlineModus;

  function fehlerHtml() {
    return z.fehler ? `<div class="hinweis-leiste fehler" role="alert">${escapeHtml(z.fehler)}</div>` : "";
  }

  // --- Schritt 1: Webseite ----------------------------------------------------
  function start() {
    const ki = z.kiEntitaet
      ? `<label class="finden-check"><input type="checkbox" id="a-ki" ${z.ki ? "checked" : ""}>
          <span>Text mit KI auswerten (Angebote, Zahlungsarten, Öffnungszeiten)<br>
          <span class="muted">Der Text der Webseite wird an <b>${escapeHtml(z.kiEntitaet)}</b> gesendet, je nach Anbieter verlässt er dein Netzwerk. Die KI schlägt nur vor; Vermutungen werden getrennt gezeigt und sind nie vorgewählt.</span></span></label>`
      : "";
    return `
      <p class="muted">${
        bestehend
          ? `Liest die Webseite von «${escapeHtml(bestehend.name)}» aus und zeigt, was bei dir noch fehlt oder abweicht. Es wird nichts überschrieben, ohne dass du es wählst.`
          : "Liest Name, Adresse, Telefon, E-Mail, Öffnungszeiten und mehr von der Webseite des Hofladens. Danach prüfst du die Angaben."
      }</p>
      ${verbunden() ? "" : `<p class="hinweis-leiste">${icon("offline", { klein: true })} Zum Auslesen ist eine Verbindung zu Home Assistant nötig.</p>`}
      ${fehlerHtml()}
      <section class="formular-abschnitt schnell-abschnitt">
        <div class="feld-gruppe">
          <label for="a-website">Webseite</label>
          <input type="url" id="a-website" autocomplete="off" placeholder="https://…" value="${escapeHtml(z.website)}" />
        </div>
        ${ki}
      </section>
      <div class="aktions-reihe aktions-stapel">
        <button type="button" class="primaer" id="a-start-btn" ${verbunden() ? "" : "disabled"}>Auslesen</button>
      </div>`;
  }

  // --- Schritt 2: Auslesen --------------------------------------------------------
  function laeuft() {
    const e = z.ereignisse;
    const zeile = (text) => `<p class="muted finden-status">${escapeHtml(text)}</p>`;
    const teile = [];
    teile.push(zeile(e.website ? FINDEN_WEBSITE_STATUS[e.website.status] || e.website.status : "Webseite wird gelesen …"));
    if (z.ki) teile.push(zeile(e.ki ? FINDEN_KI_STATUS[e.ki.status] || e.ki.status : "KI wertet aus …"));
    return `
      <div class="auslesen-laeuft" role="status" aria-live="polite">
        <p><strong>Auslesen …</strong></p>
        ${teile.join("")}
      </div>
      ${fehlerHtml()}
      <div class="aktions-reihe aktions-stapel"><button type="button" id="a-abbruch-btn">Abbrechen</button></div>`;
  }

  // --- Schritt 3: Prüfen ----------------------------------------------------------
  function zeileHtml(r) {
    const st = STATUS_TEXT[r.status];
    const label = r.quelle ? FINDEN_QUELLEN_LABEL[r.quelle.quelle] || r.quelle.quelle : "";
    const abw = r.abweichungVon
      ? `<span class="finden-warnung">${icon("warnung", { klein: true })} weicht von ${escapeHtml(FINDEN_QUELLEN_LABEL[r.abweichungVon] || "der anderen Quelle")} ab</span>`
      : "";
    const wert =
      r.key === "angebote" || r.key === "zahlungsarten"
        ? r.status === STATUS.gleich
          ? r.gefunden
          : `Neu: ${r.neu.join(", ")}`
        : r.gefunden;
    const kopf = `<span class="finden-label">${escapeHtml(r.label)}</span>
      <span class="status-chip status-${r.status}">${icon(st.symbol, { klein: true })} ${st.text}</span>`;
    const inhalt = `${bestehend ? `<span class="muted">Aktuell: ${escapeHtml(r.aktuell || "–")}</span>` : ""}
      <span>${bestehend ? "Gefunden: " : ""}${escapeHtml(wert)}</span>
      ${label ? `<span class="muted">${escapeHtml(label)}</span>` : ""}${abw}`;
    if (r.status === STATUS.gleich) {
      return `<div class="finden-zeile ergaenzen-zeile gleich" data-zeile="${r.key}"><span class="finden-text"><span class="zeilen-kopf">${kopf}</span>${inhalt}</span></div>`;
    }
    return `<label class="finden-zeile ergaenzen-zeile" data-zeile="${r.key}">
      <input type="checkbox" data-feldwahl="${escapeHtml(r.key)}" ${z.auswahl[r.key] ? "checked" : ""} />
      <span class="finden-text"><span class="zeilen-kopf">${kopf}</span>${inhalt}</span></label>`;
  }

  function pruefen() {
    const v = z.vergleich;
    const offene = v.zeilen.filter((r) => r.status !== STATUS.gleich);
    const osm = v.zeilen.some((r) => r.quelle?.quelle === "openstreetmap");
    const doppelt =
      !bestehend && z.vorschlag?.daten?.name
        ? findeBestehenden(
            { name: z.vorschlag.daten.name, latitude: Number(z.vorschlag.daten.latitude), longitude: Number(z.vorschlag.daten.longitude), weitere_namen: [] },
            app.state.hoflaeden
          )
        : null;
    const vermutet = v.vermutungen
      .map(
        (m) => `<label class="finden-zeile finden-vermutung" data-vermutung="${m.key}"><input type="checkbox" data-feldwahl="vermutung:${m.key}" ${z.auswahl[`vermutung:${m.key}`] ? "checked" : ""} />
          <span class="finden-text"><span class="finden-label">${escapeHtml(m.label)} (vermutet)</span>
          <span>${escapeHtml(m.neu.join(", "))}</span>
          <span class="finden-warnung">${icon("warnung", { klein: true })} Von der KI genannt, steht aber nicht im Text der Webseite. Bitte selbst prüfen.</span></span></label>`
      )
      .join("");
    const leerText = !v.zeilen.length && !v.vermutungen.length;
    return `
      ${(z.ereignisse.website && z.ereignisse.website.status !== "ok") ? `<p class="hinweis-leiste">${icon("info", { klein: true })} ${escapeHtml(FINDEN_WEBSITE_STATUS[z.ereignisse.website.status] || z.ereignisse.website.status)}</p>` : ""}
      ${doppelt ? `<p class="hinweis-leiste" id="a-doppelt">${icon("warnung", { klein: true })} Möglicherweise schon erfasst: ${escapeHtml(doppelt.name)}. <a href="#/hofladen/${encodeURIComponent(doppelt.id)}/ergaenzen" id="a-doppelt-link">Dort ergänzen</a></p>` : ""}
      ${
        leerText
          ? `<p class="muted">Es wurden keine verwertbaren Angaben gefunden.</p>`
          : `<p class="muted" id="a-zusammenfassung">${
              bestehend
                ? offene.length
                  ? `${offene.length} ${offene.length === 1 ? "Angabe kann" : "Angaben können"} ergänzt werden. Lücken sind vorgewählt, Abweichungen nicht.`
                  : "Alles Gefundene ist bei dir schon vorhanden."
                : "Gewählte Angaben werden in ein neues Formular übernommen. Gespeichert wird erst dort."
            }</p>
            <section class="vorort-abschnitt"><h3>Angaben</h3>${v.zeilen.map(zeileHtml).join("")}</section>`
      }
      ${vermutet ? `<section class="vorort-abschnitt"><h3>Vermutungen der KI (nicht belegt)</h3>${vermutet}</section>` : ""}
      ${osm ? `<p class="muted">© OpenStreetMap-Mitwirkende (ODbL)</p>` : ""}
      ${fehlerHtml()}
      <div class="aktions-reihe aktions-stapel">
        <button type="button" class="primaer" id="a-uebernehmen-btn">${bestehend ? "Im Formular prüfen" : "In Formular übernehmen"}</button>
        <button type="button" id="a-zurueck-btn">Zurück</button>
      </div>`;
  }

  function zeichne() {
    if (!aktiv) return;
    container.innerHTML = `<div class="auslesen" data-schritt="${z.schritt}">${z.schritt === "start" ? start() : z.schritt === "laeuft" ? laeuft() : pruefen()}</div>`;
    binde();
  }

  async function auslesen() {
    const eingabe = container.querySelector("#a-website");
    let website = eingabe.value.trim();
    if (website && !istHttpUrl(website)) website = `https://${website}`;
    z.website = website;
    z.ki = !!container.querySelector("#a-ki")?.checked;
    if (!website || !sichereHttpUrl(website)) {
      z.fehler = "Bitte eine gültige Webadresse eintragen.";
      zeichne();
      container.querySelector("#a-website")?.focus();
      return;
    }
    z.fehler = "";
    z.ereignisse = {};
    z.schritt = "laeuft";
    zeichne();

    const aufEreignis = (e) => {
      if (!aktiv || !e) return;
      if (e.phase === "fertig") {
        z.vorschlag = e.vorschlag || { daten: {}, quellen: [], abweichungen: {} };
        // Eine eingetragene Webadresse gilt als Angabe, wenn sie noch fehlt.
        if (!z.vorschlag.daten) z.vorschlag.daten = {};
        z.vergleich = vergleiche(bestehend || {}, z.vorschlag);
        z.auswahl = vorauswahl(z.vergleich);
        z.schritt = "pruefen";
        beende();
      } else if (e.phase) {
        z.ereignisse[e.phase] = e;
      }
      zeichne();
    };
    try {
      app._pruefeVerbindung();
      const unsub = await app.haClient.hofladenAnreichern({ kandidat: null, website, ki: z.ki && !!z.kiEntitaet }, aufEreignis);
      if (!aktiv || z.schritt !== "laeuft") {
        Promise.resolve().then(() => unsub()).catch(() => {});
        return;
      }
      abmelden = unsub;
      timer = setTimeout(() => {
        if (z.schritt === "laeuft") {
          z.fehler = "Das Auslesen hat zu lange gedauert.";
          z.schritt = "start";
          beende();
          zeichne();
        }
      }, TIMEOUT_MS);
    } catch (err) {
      if (!aktiv) return;
      z.fehler = FINDEN_FEHLERMELDUNGEN[err?.code] || err?.message || "Das Auslesen ist fehlgeschlagen.";
      z.schritt = "start";
      zeichne();
    }
  }

  function uebernehmen() {
    const ergebnis = baueErgaenzung(bestehend || {}, z.vorschlag, z.vergleich, z.auswahl);
    if (bestehend) {
      app.ergaenzung = { hofladenId: bestehend.id, daten: ergebnis.daten, quellen: ergebnis.quellen };
      app.navigate(`#/hofladen/${encodeURIComponent(bestehend.id)}/bearbeiten`);
    } else {
      const daten = { ...ergebnis.daten };
      if (!daten.website && z.website) daten.website = z.website;
      app.entwurf = { daten, quellen: ergebnis.quellen };
      app.navigate("#/neu");
    }
  }

  function binde() {
    const auf = (sel, fn) => container.querySelector(sel)?.addEventListener("click", fn);
    auf("#a-start-btn", auslesen);
    container.querySelector("#a-website")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        auslesen();
      }
    });
    auf("#a-abbruch-btn", () => {
      beende();
      z.schritt = "start";
      zeichne();
    });
    auf("#a-uebernehmen-btn", uebernehmen);
    auf("#a-zurueck-btn", () => {
      z.schritt = "start";
      zeichne();
    });
    container.querySelectorAll("[data-feldwahl]").forEach((el) =>
      el.addEventListener("change", () => {
        z.auswahl[el.dataset.feldwahl] = el.checked;
      })
    );
  }

  zeichne();
  if (app.haClient?.kiEntitaet) {
    app.haClient
      .kiEntitaet()
      .then((entitaet) => {
        if (!aktiv) return;
        z.kiEntitaet = entitaet;
        if (z.schritt === "start") {
          z.website = container.querySelector("#a-website")?.value ?? z.website;
          zeichne();
        }
      })
      .catch(() => {});
  }
}
