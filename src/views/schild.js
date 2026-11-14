/**
 * Schild lesen (ab 2.1.0-dev.4): ein Foto vom Hofladen-Schild wird im Browser
 * ausgewertet (OCR, ohne KI, ohne Upload) und wie bei «Angaben ergänzen»
 * verglichen, in zwei Varianten:
 * - neu (`#/erfassen/schild`): ein neuer Hofladen entsteht aus dem Schild
 * - ergänzen (`#/hofladen/<id>/schild`): Angaben eines bestehenden Hofladens ergänzen
 *
 * Schritte: Foto → Lesen → Prüfen. Der erkannte Text bleibt sichtbar und lässt
 * sich korrigieren («Neu auswerten»). Vergleich und Übernahme stehen in
 * src/ergaenzen.js (Lücken vorgewählt, Abweichungen nie); die Zerlegung des
 * Textes in src/schildtext.js. Gespeichert wird erst im Editor.
 */

import { escapeHtml } from "../html.js";
import { leerzustandHtml } from "../leerzustand.js";
import { icon } from "../icons.js";
import { fokussiereSchritt } from "../fokus.js";
import { t, tn, aktuelleSprache } from "../i18n.js";
import { FINDEN_QUELLEN_LABEL, findeBestehenden } from "../finden.js";
import { STATUS, baueErgaenzung, vergleiche, vorauswahl } from "../ergaenzen.js";
import { bildVerkleinern } from "../bilder.js";
import { erkenneText, ocrVerfuegbar } from "../ocr.js";
import { leseSchildtext } from "../schildtext.js";

const STATUS_TEXT = {
  [STATUS.luecke]: { text: "Fehlt noch", symbol: "plus" },
  [STATUS.ergaenzen]: { text: "Wird ergänzt", symbol: "plus" },
  [STATUS.abweichung]: { text: "Weicht ab", symbol: "warnung" },
  [STATUS.gleich]: { text: "Schon gleich", symbol: "haken" },
};

/** Sprachen des Schildes: Code der Oberfläche → Code der Texterkennung. */
const SPRACHEN = [
  { code: "de", ocr: "deu", name: "Deutsch" },
  { code: "fr", ocr: "fra", name: "Français" },
  { code: "it", ocr: "ita", name: "Italiano" },
  { code: "en", ocr: "eng", name: "English" },
];

function alsDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => resolve("");
    r.readAsDataURL(blob);
  });
}

export function renderSchild(container, app, hofladenId = null) {
  const bestehend = hofladenId ? app.hofladenMitId(hofladenId) : null;
  if (hofladenId && !bestehend) {
    container.innerHTML = leerzustandHtml({ symbol: "suche", titel: t("Hofladen nicht gefunden."), aktion: { href: "#/", label: t("Zur Liste") } });
    return;
  }
  const ui = aktuelleSprache();
  const z = {
    schritt: "start", // start | laeuft | pruefen
    sprachen: new Set([SPRACHEN.some((s) => s.code === ui) ? ui : "de"]),
    vorschau: "",
    text: "",
    vertrauen: 0,
    vorschlag: null,
    vergleich: null,
    auswahl: {},
    fehler: "",
    fortschritt: { status: "", anteil: 0 },
  };
  let aktiv = true;
  let abbruch = null;
  let laufNr = 0;

  const beobachter = new MutationObserver(() => {
    if (!container.isConnected) {
      aktiv = false;
      abbruch?.abort();
      beobachter.disconnect();
    }
  });
  beobachter.observe(document.body, { childList: true, subtree: true });

  const fehlerHtml = () => (z.fehler ? `<div class="hinweis-leiste fehler" role="alert">${escapeHtml(z.fehler)}</div>` : "");
  const sprachCodes = () => SPRACHEN.filter((s) => z.sprachen.has(s.code));

  // --- Schritt 1: Foto ------------------------------------------------------------
  function start() {
    const ok = ocrVerfuegbar();
    return `
      <p class="muted">${
        bestehend
          ? t("Liest das Schild von «{name}» und zeigt, was bei dir noch fehlt oder abweicht. Es wird nichts überschrieben, ohne dass du es wählst.", { name: escapeHtml(bestehend.name) })
          : escapeHtml(t("Liest Name, Adresse, Telefon, Öffnungszeiten und mehr vom Schild des Hofladens. Danach prüfst du die Angaben."))
      }</p>
      <p class="muted">${escapeHtml(t("Das Foto wird nur auf diesem Gerät ausgewertet und nicht hochgeladen. Am besten gerade, nah und bei gutem Licht fotografieren."))}</p>
      ${ok ? "" : `<p class="hinweis-leiste fehler" role="alert">${escapeHtml(t("Die Texterkennung wird in diesem Browser nicht unterstützt."))}</p>`}
      ${fehlerHtml()}
      <section class="formular-abschnitt schnell-abschnitt">
        <div class="chip-liste" role="group" aria-label="${escapeHtml(t("Sprache des Schildes"))}">
          ${SPRACHEN.map((s) => `<button type="button" class="chip" data-s-sprache="${s.code}" aria-pressed="${z.sprachen.has(s.code)}">${escapeHtml(s.name)}</button>`).join("")}
        </div>
        <p class="muted">${escapeHtml(t("Sprache des Schildes wählen. Mehrere Sprachen brauchen etwas länger. Beim ersten Mal werden rund 6 MB geladen."))}</p>
      </section>
      <div class="aktions-reihe aktions-stapel">
        <button type="button" class="primaer" id="s-kamera-btn" ${ok ? "" : "disabled"}>${escapeHtml(t("Foto aufnehmen"))}</button>
        <button type="button" id="s-datei-btn" ${ok ? "" : "disabled"}>${escapeHtml(t("Foto aus der Mediathek wählen"))}</button>
      </div>
      <input type="file" id="s-kamera" accept="image/*" capture="environment" hidden />
      <input type="file" id="s-datei" accept="image/*" hidden />`;
  }

  // --- Schritt 2: Lesen -----------------------------------------------------------
  function laeuft() {
    const prozent = Math.round(z.fortschritt.anteil * 100);
    return `
      <div class="auslesen-laeuft" role="status" aria-live="polite" data-fokus tabindex="-1">
        <p><strong>${escapeHtml(t("Schild wird gelesen …"))}</strong></p>
        <p class="muted" id="s-status">${escapeHtml(statusText(z.fortschritt.status))}</p>
        <progress id="s-fortschritt" max="1" value="${z.fortschritt.anteil}" aria-label="${escapeHtml(t("Fortschritt"))}">${prozent} %</progress>
      </div>
      ${z.vorschau ? `<img class="schild-vorschau" src="${escapeHtml(z.vorschau)}" alt="${escapeHtml(t("Foto des Schildes"))}" />` : ""}
      <div class="aktions-reihe aktions-stapel"><button type="button" id="s-abbruch-btn">${escapeHtml(t("Abbrechen"))}</button></div>`;
  }

  function statusText(status) {
    if (/core/.test(status)) return t("Texterkennung wird geladen …");
    if (/traineddata|language/.test(status)) return t("Sprachdaten werden geladen …");
    if (/recogniz/.test(status)) return t("Text wird erkannt …");
    return t("Wird vorbereitet …");
  }

  // --- Schritt 3: Prüfen ----------------------------------------------------------
  function zeileHtml(r) {
    const st = STATUS_TEXT[r.status];
    const label = r.quelle ? FINDEN_QUELLEN_LABEL[r.quelle.quelle] || r.quelle.quelle : "";
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
      ${label ? `<span class="muted">${escapeHtml(label)}</span>` : ""}`;
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
    const h = z.vorschlag.hinweise || {};
    const tage = (h.geschlossen || []).length;
    const doppelt =
      !bestehend && z.vorschlag.daten.name
        ? findeBestehenden({ name: z.vorschlag.daten.name, latitude: NaN, longitude: NaN, weitere_namen: [] }, app.state.hoflaeden)
        : null;
    return `
      <h2 class="nur-leser" data-fokus tabindex="-1">${escapeHtml(t("Angaben prüfen"))}</h2>
      ${z.vorschau ? `<img class="schild-vorschau" src="${escapeHtml(z.vorschau)}" alt="${escapeHtml(t("Foto des Schildes"))}" />` : ""}
      ${doppelt ? `<p class="hinweis-leiste" id="s-doppelt">${icon("warnung", { klein: true })} ${escapeHtml(t("Möglicherweise schon erfasst: {name}.", { name: doppelt.name }))} <a href="#/hofladen/${encodeURIComponent(doppelt.id)}/schild">${escapeHtml(t("Dort ergänzen"))}</a></p>` : ""}
      ${
        v.zeilen.length
          ? `<p class="muted" id="s-zusammenfassung">${
              bestehend
                ? offene.length
                  ? escapeHtml(tn(offene.length, "1 Angabe kann ergänzt werden. Lücken sind vorgewählt, Abweichungen nicht.", "{n} Angaben können ergänzt werden. Lücken sind vorgewählt, Abweichungen nicht."))
                  : escapeHtml(t("Alles Gefundene ist bei dir schon vorhanden."))
                : escapeHtml(t("Gewählte Angaben werden in ein neues Formular übernommen. Gespeichert wird erst dort."))
            }</p>
            <p class="hinweis-leiste">${icon("info", { klein: true })} ${escapeHtml(t("Die Erkennung kann sich irren. Bitte jede Angabe mit dem Schild vergleichen."))}</p>
            <section class="vorort-abschnitt"><h3>${escapeHtml(t("Angaben"))}</h3>${v.zeilen.map(zeileHtml).join("")}</section>`
          : `<p class="muted" id="s-leer">${escapeHtml(z.text.trim() ? t("Aus dem Text konnten keine Angaben gelesen werden. Du kannst ihn unten korrigieren.") : t("Auf dem Foto wurde kein Text erkannt. Bitte näher, gerade und bei gutem Licht fotografieren."))}</p>`
      }
      ${tage ? `<p class="muted" id="s-geschlossen">${escapeHtml(t("Als geschlossen erkannt: {tage}. Ruhetage werden nicht übernommen, dort fehlen einfach Zeiten.", { tage: (h.geschlossen || []).map(tagName).join(", ") }))}</p>` : ""}
      <section class="vorort-abschnitt">
        <h3>${escapeHtml(t("Erkannter Text"))}</h3>
        <label class="nur-leser" for="s-text">${escapeHtml(t("Erkannter Text"))}</label>
        <textarea id="s-text" rows="7" spellcheck="false" autocapitalize="off" autocomplete="off">${escapeHtml(z.text)}</textarea>
        <p class="muted">${escapeHtml(t("Fehler im Text hier korrigieren und neu auswerten."))}</p>
        <div class="aktions-reihe"><button type="button" id="s-neu-btn">${escapeHtml(t("Neu auswerten"))}</button></div>
      </section>
      ${fehlerHtml()}
      <div class="aktions-reihe aktions-stapel">
        <button type="button" class="primaer" id="s-uebernehmen-btn" ${v.zeilen.length ? "" : "disabled"}>${escapeHtml(bestehend ? t("Im Formular prüfen") : t("In Formular übernehmen"))}</button>
        <button type="button" id="s-anderes-btn">${escapeHtml(t("Anderes Foto"))}</button>
      </div>`;
  }

  const TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
  const tagName = (n) => t(TAGE[n - 1] || "");

  let letzterSchritt;
  function zeichne() {
    if (!aktiv) return;
    const kopf = z.schritt === "start" ? `<h2 class="nur-leser" data-fokus tabindex="-1">${escapeHtml(t("Foto des Schildes"))}</h2>` : "";
    container.innerHTML = `<div class="auslesen schild" data-schritt="${z.schritt}">${kopf}${z.schritt === "start" ? start() : z.schritt === "laeuft" ? laeuft() : pruefen()}</div>`;
    binde();
    if (letzterSchritt !== undefined && letzterSchritt !== z.schritt) fokussiereSchritt(container);
    letzterSchritt = z.schritt;
  }

  /** Text auswerten und den Vergleich aufbauen (ohne neue Texterkennung). */
  function werteAus() {
    z.vorschlag = leseSchildtext(z.text, sprachCodes().map((s) => s.code));
    z.vergleich = vergleiche(bestehend || {}, z.vorschlag);
    z.auswahl = vorauswahl(z.vergleich);
  }

  async function lies(datei) {
    if (!datei) return;
    const nr = ++laufNr;
    z.fehler = "";
    z.fortschritt = { status: "", anteil: 0 };
    z.schritt = "laeuft";
    zeichne();
    abbruch?.abort();
    const ctl = (abbruch = new AbortController());
    try {
      const bild = await bildVerkleinern(datei);
      z.vorschau = await alsDataUrl(bild);
      if (!aktiv || nr !== laufNr) return;
      zeichne();
      const erg = await erkenneText(bild, {
        sprachen: sprachCodes().map((s) => s.ocr),
        signal: ctl.signal,
        onFortschritt: (f) => {
          if (!aktiv || nr !== laufNr) return;
          z.fortschritt = f;
          const status = container.querySelector("#s-status");
          const balken = container.querySelector("#s-fortschritt");
          if (status) status.textContent = statusText(f.status);
          if (balken) balken.value = f.anteil;
        },
      });
      if (!aktiv || nr !== laufNr) return;
      z.text = erg.text.replace(/\n{3,}/g, "\n\n").trim();
      z.vertrauen = erg.vertrauen;
      werteAus();
      z.schritt = "pruefen";
    } catch (err) {
      if (!aktiv || nr !== laufNr) return;
      if (err?.name === "AbortError") {
        z.schritt = "start";
      } else {
        z.fehler =
          navigator.onLine === false || /geladen/.test(String(err?.message))
            ? t("Die Texterkennung konnte nicht geladen werden. Beim ersten Mal ist eine Internetverbindung nötig.")
            : t("Das Schild konnte nicht gelesen werden.");
        z.schritt = "start";
      }
    }
    zeichne();
  }

  function uebernehmen() {
    const ergebnis = baueErgaenzung(bestehend || {}, z.vorschlag, z.vergleich, z.auswahl);
    if (bestehend) {
      app.ergaenzung = { hofladenId: bestehend.id, daten: ergebnis.daten, quellen: ergebnis.quellen };
      app.navigate(`#/hofladen/${encodeURIComponent(bestehend.id)}/bearbeiten`);
    } else {
      app.entwurf = { daten: { ...ergebnis.daten }, quellen: ergebnis.quellen };
      app.navigate("#/neu");
    }
  }

  function binde() {
    const auf = (sel, fn) => container.querySelector(sel)?.addEventListener("click", fn);
    auf("#s-kamera-btn", () => container.querySelector("#s-kamera").click());
    auf("#s-datei-btn", () => container.querySelector("#s-datei").click());
    for (const sel of ["#s-kamera", "#s-datei"]) {
      container.querySelector(sel)?.addEventListener("change", (e) => {
        const datei = e.target.files?.[0];
        e.target.value = "";
        lies(datei);
      });
    }
    container.querySelectorAll("[data-s-sprache]").forEach((el) =>
      el.addEventListener("click", () => {
        const code = el.dataset.sSprache;
        if (z.sprachen.has(code)) {
          if (z.sprachen.size > 1) z.sprachen.delete(code); // mindestens eine Sprache bleibt gewählt
        } else {
          z.sprachen.add(code);
        }
        el.setAttribute("aria-pressed", String(z.sprachen.has(code)));
        container.querySelectorAll("[data-s-sprache]").forEach((b) => b.setAttribute("aria-pressed", String(z.sprachen.has(b.dataset.sSprache))));
      })
    );
    auf("#s-abbruch-btn", () => {
      laufNr++;
      abbruch?.abort();
      z.schritt = "start";
      zeichne();
    });
    auf("#s-anderes-btn", () => {
      z.schritt = "start";
      zeichne();
    });
    auf("#s-neu-btn", () => {
      z.text = container.querySelector("#s-text").value;
      werteAus();
      zeichne();
      container.querySelector("#s-text")?.focus();
    });
    auf("#s-uebernehmen-btn", uebernehmen);
    container.querySelectorAll("[data-feldwahl]").forEach((el) =>
      el.addEventListener("change", () => {
        z.auswahl[el.dataset.feldwahl] = el.checked;
      })
    );
  }

  zeichne();
}
