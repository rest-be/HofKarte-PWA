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
import { leerzustandHtml } from "../leerzustand.js";
import { icon } from "../icons.js";
import { fokussiereSchritt } from "../fokus.js";
import { t, tn } from "../i18n.js";
import { FINDEN_FEHLERMELDUNGEN, FINDEN_KI_STATUS, FINDEN_QUELLEN_LABEL, FINDEN_WEBSITE_STATUS, findeBestehenden, istHttpUrl, kandidatGruende } from "../finden.js";
import { STATUS, baueErgaenzung, vergleiche, vorauswahl } from "../ergaenzen.js";

const TIMEOUT_MS = 90_000;
/** Suchumkreis um die gespeicherten Koordinaten (Meter) für «Mit OpenStreetMap ergänzen». */
const OSM_RADIUS_METER = 300;

const koordinate = (w) => (w === null || w === undefined || w === "" ? null : Number.isFinite(Number(w)) ? Number(w) : null);
export function hatKoordinaten(h) {
  return !!h && koordinate(h.latitude) !== null && koordinate(h.longitude) !== null;
}

const STATUS_TEXT = {
  [STATUS.luecke]: { text: "Fehlt noch", symbol: "plus" },
  [STATUS.ergaenzen]: { text: "Wird ergänzt", symbol: "plus" },
  [STATUS.abweichung]: { text: "Weicht ab", symbol: "warnung" },
  [STATUS.gleich]: { text: "Schon gleich", symbol: "haken" },
};

export function renderAuslesen(container, app, hofladenId = null) {
  const bestehend = hofladenId ? app.hofladenMitId(hofladenId) : null;
  if (hofladenId && !bestehend) {
    container.innerHTML = leerzustandHtml({ symbol: "suche", titel: t("Hofladen nicht gefunden."), aktion: { href: "#/", label: t("Zur Liste") } });
    return;
  }
  const z = {
    schritt: "start", // start | suche | treffer | laeuft | pruefen
    website: bestehend?.website || "",
    // Quellen: Webseite und/oder OpenStreetMap (am gespeicherten Standort; nur ergänzen).
    web: true,
    osm: !!bestehend && hatKoordinaten(bestehend) && !bestehend.website,
    kandidaten: [],
    gewaehlt: null,
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

  // --- Quellenwahl (nur beim Ergänzen): Webseite und/oder OpenStreetMap ------
  function quellenWahl() {
    if (!bestehend) return "";
    const osmMoeglich = hatKoordinaten(bestehend);
    return `<div class="chip-liste" role="group" aria-label="${escapeHtml(t("Quellen"))}">
        <button type="button" class="chip" id="a-quelle-web" aria-pressed="${z.web}">${icon("weltkugel", { klein: true })} ${escapeHtml(t("Webseite"))}</button>
        <button type="button" class="chip" id="a-quelle-osm" aria-pressed="${z.osm}" ${osmMoeglich ? "" : "disabled"}>${icon("standort", { klein: true })} OpenStreetMap</button>
      </div>
      ${osmMoeglich ? `<p class="muted">${escapeHtml(t("OpenStreetMap wird am gespeicherten Standort ({meter} m Umkreis) durchsucht. Dein Standort wird nicht abgefragt.", { meter: OSM_RADIUS_METER }))}</p>` : `<p class="muted">${escapeHtml(t("Für OpenStreetMap braucht der Hofladen Koordinaten."))}</p>`}`;
  }

  // --- Schritt 1: Webseite ----------------------------------------------------
  // (bei der Variante «ergänzen» zusätzlich mit Quellenwahl)
  function start() {
    const ki = z.kiEntitaet
      ? `<label class="finden-check"><input type="checkbox" id="a-ki" ${z.ki ? "checked" : ""}>
          <span>${escapeHtml(t("Text mit KI auswerten (Angebote, Zahlungsarten, Öffnungszeiten)"))}<br>
          <span class="muted">${t("Der Text der Webseite wird an <b>{ki}</b> gesendet, je nach Anbieter verlässt er dein Netzwerk. Die KI schlägt nur vor; Vermutungen werden getrennt gezeigt und sind nie vorgewählt.", { ki: escapeHtml(z.kiEntitaet) })}</span></span></label>`
      : "";
    return `
      <p class="muted">${
        bestehend
          ? t("Liest die Webseite von «{name}» aus und zeigt, was bei dir noch fehlt oder abweicht. Es wird nichts überschrieben, ohne dass du es wählst.", { name: escapeHtml(bestehend.name) })
          : escapeHtml(t("Liest Name, Adresse, Telefon, E-Mail, Öffnungszeiten und mehr von der Webseite des Hofladens. Danach prüfst du die Angaben."))
      }</p>
      ${verbunden() ? "" : `<p class="hinweis-leiste">${icon("offline", { klein: true })} ${escapeHtml(t("Zum Auslesen ist eine Verbindung zu Home Assistant nötig."))}</p>`}
      ${fehlerHtml()}
      <section class="formular-abschnitt schnell-abschnitt">
        ${quellenWahl()}
        <div class="feld-gruppe">
          <label for="a-website">${escapeHtml(t("Webseite"))}</label>
          <input type="url" id="a-website" autocomplete="off" placeholder="https://…" value="${escapeHtml(z.website)}" />
        </div>
        ${ki}
      </section>
      <div class="aktions-reihe aktions-stapel">
        <button type="button" class="primaer" id="a-start-btn" ${verbunden() ? "" : "disabled"}>${escapeHtml(t("Auslesen"))}</button>
      </div>`;
  }

  // --- OpenStreetMap: Suche und Trefferwahl -------------------------------------
  function sucheSchritt() {
    return `<div class="auslesen-laeuft" role="status" aria-live="polite" data-fokus tabindex="-1">
        <p><strong>${escapeHtml(t("OpenStreetMap wird durchsucht …"))}</strong></p>
      </div>
      <div class="aktions-reihe aktions-stapel"><button type="button" id="a-abbruch-btn">${escapeHtml(t("Abbrechen"))}</button></div>`;
  }

  const KONFIDENZ = { hoch: () => t("Sehr wahrscheinlich"), mittel: () => t("Möglich"), niedrig: () => t("Unsicher") };

  function trefferSchritt() {
    const eintraege = z.kandidaten
      .map((k, i) => {
        const adresse = [k.adresse, [k.plz, k.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        return `<label class="finden-kandidat${z.gewaehlt === i ? " gewaehlt" : ""}">
          <input type="radio" name="a-kandidat" value="${i}" data-a-kandidat ${z.gewaehlt === i ? "checked" : ""} />
          <span class="finden-text">
            <span class="finden-name">${escapeHtml(k.name || t("(ohne Namen)"))}</span>
            <span class="muted">${escapeHtml((KONFIDENZ[k.konfidenz] || (() => ""))())}</span>
            ${adresse ? `<span class="muted">${escapeHtml(adresse)}</span>` : ""}
            <span class="muted">${escapeHtml(kandidatGruende(k))}</span>
          </span></label>`;
      })
      .join("");
    return `
      <p class="muted">${escapeHtml(
        z.kandidaten.length
          ? t("Bitte den passenden Eintrag aus OpenStreetMap wählen. Es wird nichts übernommen, ohne dass du es wählst.")
          : t("In OpenStreetMap wurde im Umkreis nichts gefunden.")
      )}</p>
      ${z.kandidaten.length ? `<section class="formular-abschnitt">${eintraege}</section>` : ""}
      ${fehlerHtml()}
      <div class="aktions-reihe aktions-stapel">
        ${z.kandidaten.length ? `<button type="button" class="primaer" id="a-treffer-weiter-btn" ${z.gewaehlt === null ? "disabled" : ""}>${escapeHtml(t("Weiter"))}</button>` : ""}
        ${z.web ? `<button type="button" id="a-nur-web-btn">${escapeHtml(t("Nur die Webseite auslesen"))}</button>` : ""}
        <button type="button" id="a-zurueck-btn">${escapeHtml(t("Zurück"))}</button>
      </div>`;
  }

  // --- Schritt 2: Auslesen --------------------------------------------------------
  function laeuft() {
    const e = z.ereignisse;
    const zeile = (text) => `<p class="muted finden-status">${escapeHtml(text)}</p>`;
    const teile = [];
    if (z.mitOsm) teile.push(zeile(e.osm ? t("OpenStreetMap gelesen.") : t("OpenStreetMap wird gelesen …")));
    if (z.mitWeb !== false) teile.push(zeile(e.website ? FINDEN_WEBSITE_STATUS[e.website.status] || e.website.status : t("Webseite wird gelesen …")));
    if (z.ki && z.mitWeb !== false) teile.push(zeile(e.ki ? FINDEN_KI_STATUS[e.ki.status] || e.ki.status : t("KI wertet aus …")));
    return `
      <div class="auslesen-laeuft" role="status" aria-live="polite" data-fokus tabindex="-1">
        <p><strong>${escapeHtml(t("Auslesen …"))}</strong></p>
        ${teile.join("")}
      </div>
      ${fehlerHtml()}
      <div class="aktions-reihe aktions-stapel"><button type="button" id="a-abbruch-btn">${escapeHtml(t("Abbrechen"))}</button></div>`;
  }

  // --- Schritt 3: Prüfen ----------------------------------------------------------
  function zeileHtml(r) {
    const st = STATUS_TEXT[r.status];
    const label = r.quelle ? FINDEN_QUELLEN_LABEL[r.quelle.quelle] || r.quelle.quelle : "";
    const abw = r.abweichungVon
      ? `<span class="finden-warnung">${icon("warnung", { klein: true })} ${escapeHtml(t("weicht von {quelle} ab", { quelle: FINDEN_QUELLEN_LABEL[r.abweichungVon] || t("der anderen Quelle") }))}</span>`
      : "";
    const wert =
      r.key === "angebote" || r.key === "zahlungsarten"
        ? r.status === STATUS.gleich
          ? r.gefunden
          : t("Neu: {liste}", { liste: r.neu.join(", ") })
        : r.gefunden;
    const kopf = `<span class="finden-label">${escapeHtml(r.label)}</span>
      <span class="status-chip status-${r.status}">${icon(st.symbol, { klein: true })} ${escapeHtml(t(st.text))}</span>`;
    const inhalt = `${bestehend ? `<span class="muted">${escapeHtml(t("Aktuell: {wert}", { wert: r.aktuell || "–" }))}</span>` : ""}
      <span>${bestehend ? `${escapeHtml(t("Gefunden:"))} ` : ""}${escapeHtml(wert)}</span>
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
          <span class="finden-text"><span class="finden-label">${escapeHtml(m.label)} ${escapeHtml(t("(vermutet)"))}</span>
          <span>${escapeHtml(m.neu.join(", "))}</span>
          <span class="finden-warnung">${icon("warnung", { klein: true })} ${escapeHtml(t("Von der KI genannt, steht aber nicht im Text der Webseite. Bitte selbst prüfen."))}</span></span></label>`
      )
      .join("");
    const leerText = !v.zeilen.length && !v.vermutungen.length;
    return `
      ${(z.ereignisse.website && z.ereignisse.website.status !== "ok") ? `<p class="hinweis-leiste">${icon("info", { klein: true })} ${escapeHtml(FINDEN_WEBSITE_STATUS[z.ereignisse.website.status] || z.ereignisse.website.status)}</p>` : ""}
      ${doppelt ? `<p class="hinweis-leiste" id="a-doppelt">${icon("warnung", { klein: true })} ${escapeHtml(t("Möglicherweise schon erfasst: {name}.", { name: doppelt.name }))} <a href="#/hofladen/${encodeURIComponent(doppelt.id)}/ergaenzen" id="a-doppelt-link">${escapeHtml(t("Dort ergänzen"))}</a></p>` : ""}
      ${
        leerText
          ? `<p class="muted">${escapeHtml(t("Es wurden keine verwertbaren Angaben gefunden."))}</p>`
          : `<p class="muted" id="a-zusammenfassung">${
              bestehend
                ? offene.length
                  ? escapeHtml(tn(offene.length, "1 Angabe kann ergänzt werden. Lücken sind vorgewählt, Abweichungen nicht.", "{n} Angaben können ergänzt werden. Lücken sind vorgewählt, Abweichungen nicht."))
                  : escapeHtml(t("Alles Gefundene ist bei dir schon vorhanden."))
                : escapeHtml(t("Gewählte Angaben werden in ein neues Formular übernommen. Gespeichert wird erst dort."))
            }</p>
            <section class="vorort-abschnitt"><h3>${escapeHtml(t("Angaben"))}</h3>${v.zeilen.map(zeileHtml).join("")}</section>`
      }
      ${vermutet ? `<section class="vorort-abschnitt"><h3>${escapeHtml(t("Vermutungen der KI (nicht belegt)"))}</h3>${vermutet}</section>` : ""}
      ${osm ? `<p class="muted">${escapeHtml(t("© OpenStreetMap-Mitwirkende (ODbL)"))}</p>` : ""}
      ${fehlerHtml()}
      <div class="aktions-reihe aktions-stapel">
        <button type="button" class="primaer" id="a-uebernehmen-btn">${escapeHtml(bestehend ? t("Im Formular prüfen") : t("In Formular übernehmen"))}</button>
        <button type="button" id="a-zurueck-btn">${escapeHtml(t("Zurück"))}</button>
      </div>`;
  }

  let letzterSchritt;
  function zeichne() {
    if (!aktiv) return;
    const schrittName =
      z.schritt === "start" ? t("Webadresse eingeben") : z.schritt === "laeuft" || z.schritt === "suche" ? "" : z.schritt === "treffer" ? t("Treffer wählen") : t("Angaben prüfen");
    const kopf = schrittName ? `<h2 class="nur-leser" data-fokus>${schrittName}</h2>` : "";
    container.innerHTML = `<div class="auslesen" data-schritt="${z.schritt}">${kopf}${z.schritt === "start" ? start() : z.schritt === "suche" ? sucheSchritt() : z.schritt === "treffer" ? trefferSchritt() : z.schritt === "laeuft" ? laeuft() : pruefen()}</div>`;
    binde();
    // Fokus nur bei einem Schrittwechsel (nicht bei jedem Statusereignis).
    if (letzterSchritt !== undefined && letzterSchritt !== z.schritt) {
      fokussiereSchritt(container);
    }
    letzterSchritt = z.schritt;
  }

  /** «Auslesen»: Quellen prüfen, bei OpenStreetMap zuerst Treffer suchen, sonst direkt auslesen. */
  async function auslesen() {
    const eingabe = container.querySelector("#a-website");
    let website = eingabe.value.trim();
    if (website && !istHttpUrl(website)) website = `https://${website}`;
    z.website = website;
    z.ki = !!container.querySelector("#a-ki")?.checked;
    if (!z.web && !z.osm) {
      z.fehler = t("Bitte mindestens eine Quelle wählen.");
      zeichne();
      return;
    }
    if (z.web && (!website || !sichereHttpUrl(website))) {
      z.fehler = t("Bitte eine gültige Webadresse eintragen.");
      zeichne();
      container.querySelector("#a-website")?.focus();
      return;
    }
    z.fehler = "";
    if (z.osm && bestehend) {
      await sucheOsm();
      return;
    }
    await anreichern(null);
  }

  async function sucheOsm() {
    z.schritt = "suche";
    zeichne();
    try {
      app._pruefeVerbindung();
      const kandidaten = await app.haClient.hofladenSuchen({
        latitude: koordinate(bestehend.latitude),
        longitude: koordinate(bestehend.longitude),
        radius: OSM_RADIUS_METER,
        name: bestehend.name,
        website: z.web ? z.website : undefined,
      });
      if (!aktiv || z.schritt !== "suche") return;
      z.kandidaten = kandidaten;
      z.gewaehlt = kandidaten[0] && kandidaten[0].konfidenz === "hoch" ? 0 : null;
      z.schritt = "treffer";
    } catch (err) {
      if (!aktiv) return;
      z.fehler = FINDEN_FEHLERMELDUNGEN[err?.code] || err?.message || t("Die Suche ist fehlgeschlagen.");
      z.schritt = "start";
    }
    zeichne();
  }

  /** Auslesen mit gewähltem Treffer (oder nur Webseite). */
  async function anreichern(kandidat) {
    const website = z.web ? z.website : "";
    if (!kandidat && !website) return;
    z.fehler = "";
    z.ereignisse = {};
    z.mitOsm = !!kandidat;
    z.mitWeb = !!website;
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
      const unsub = await app.haClient.hofladenAnreichern({ kandidat, website: website || undefined, ki: z.ki && !!z.kiEntitaet && !!website }, aufEreignis);
      if (!aktiv || z.schritt !== "laeuft") {
        Promise.resolve().then(() => unsub()).catch(() => {});
        return;
      }
      abmelden = unsub;
      timer = setTimeout(() => {
        if (z.schritt === "laeuft") {
          z.fehler = t("Das Auslesen hat zu lange gedauert.");
          z.schritt = "start";
          beende();
          zeichne();
        }
      }, TIMEOUT_MS);
    } catch (err) {
      if (!aktiv) return;
      z.fehler = FINDEN_FEHLERMELDUNGEN[err?.code] || err?.message || t("Das Auslesen ist fehlgeschlagen.");
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
    for (const [sel, key] of [["#a-quelle-web", "web"], ["#a-quelle-osm", "osm"]]) {
      container.querySelector(sel)?.addEventListener("click", (e) => {
        z[key] = !z[key];
        e.currentTarget.setAttribute("aria-pressed", String(z[key]));
      });
    }
    container.querySelectorAll("[data-a-kandidat]").forEach((el) =>
      el.addEventListener("change", () => {
        z.gewaehlt = Number(el.value);
        container.querySelector("#a-treffer-weiter-btn")?.removeAttribute("disabled");
        container.querySelectorAll(".finden-kandidat").forEach((l) => l.classList.toggle("gewaehlt", l.contains(el)));
      })
    );
    auf("#a-treffer-weiter-btn", () => anreichern(z.kandidaten[z.gewaehlt]));
    auf("#a-nur-web-btn", () => anreichern(null));
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
