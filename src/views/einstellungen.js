/**
 * Einstellungen-View: über den "⚙️ Einstellungen"-Button in der
 * Kopfzeile erreichbar (siehe app.js, renderMitRahmen()). Enthält die
 * beiden einzigen pro Gerät nötigen Verwaltungsaktionen, die bisher nur
 * aus Home Assistant selbst möglich waren:
 * - Long-Lived Access Token ändern (z. B. nach Widerruf/Ablauf), ohne
 *   die App neu einrichten zu müssen (HA-Adresse bleibt erhalten).
 * - Abmelden (Verbindungsdaten auf diesem Gerät löschen).
 * - Anzeige der installierten App-Version (Phase 8e), damit sich beim
 *   Support/Vergleich zwischen Geräten nachvollziehen lässt, welcher
 *   Stand gerade läuft (seit 1.8.0 ganz unten, nur die Nummer).
 */

import { APP_VERSION } from "../version.js";
import { ladeNaeheRadius, speichereNaeheRadius } from "../storage.js";
import { FARBEN, STANDARD_FARBE, aktuelleMarkenfarbe, setzeMarkenfarbe, normalisiereHex } from "../design.js";
import { icon } from "../icons.js";
import { aktualisiereJetzt, appZuruecksetzen, pruefeAufUpdate } from "../update.js";
import { STANDARD_RADIUS_METER, MIN_RADIUS_METER, MAX_RADIUS_METER } from "../naehe.js";
import { t, SPRACHEN, gespeicherteSprache, setzeSprache } from "../i18n.js";

export function renderEinstellungen(container, app) {
  const farbKnoepfe = FARBEN.map(
    (f) => `<button type="button" class="farb-wahl" data-farbe="${f.farbe}" aria-pressed="false">
        <span class="farb-punkt" data-farb-punkt="${f.farbe}">${icon("haken")}</span>${escapeAttr(t(f.name))}
      </button>`
  ).join("");

  container.innerHTML = `
    <section class="formular-abschnitt" id="darstellung">
      <h2>${t("Darstellung")}</h2>
      <div class="farb-raster" role="group" aria-label="${t("Markenfarbe")}">${farbKnoepfe}</div>
      <div class="farb-eigene">
        <input type="color" id="f-eigene-farbe" value="${STANDARD_FARBE}" aria-label="${t("Eigene Farbe wählen")}" />
        <div>
          <strong>${t("Eigene Farbe")}</strong>
          <p class="muted" id="farbe-status">${t("Frei wählbar, nur auf diesem Gerät. Die Schriftfarbe darauf passt sich für gute Lesbarkeit an.")}</p>
        </div>
      </div>
      <div class="farb-vorschau">
        <span class="vorschau-knopf">${t("Vorschau")}</span>
        <span class="status-badge offen">${t("Offen bis {zeit}", { zeit: "18:30" })}</span>
        <button type="button" class="hinzufuegen-btn" id="farbe-zuruecksetzen">${t("Zurücksetzen")}</button>
      </div>
    </section>

    <section class="formular-abschnitt" id="sprache">
      <h2>${t("Sprache")}</h2>
      <div class="feld-gruppe">
        <label for="f-sprache">${t("Sprache der App")}</label>
        <select id="f-sprache" class="sprach-auswahl">
          <option value="">${t("Automatisch (Browser)")}</option>
          ${SPRACHEN.map((l) => `<option value="${l.code}">${l.name}</option>`).join("")}
        </select>
      </div>
      <button type="button" class="hinzufuegen-btn" id="sprache-zuruecksetzen">${t("Zurücksetzen")}</button>
      <p class="muted">${t("Gilt nur auf diesem Gerät. Texte aus Home Assistant bleiben in der dortigen Sprache.")}</p>
    </section>

    <section class="formular-abschnitt">
      <h2>${t("Hofläden in der Nähe")}</h2>
      <div class="feld-gruppe">
        <label for="f-naehe-radius">${t("Umkreis in Metern (Standard {meter})", { meter: STANDARD_RADIUS_METER })}</label>
        <input type="number" id="f-naehe-radius" inputmode="numeric" min="${MIN_RADIUS_METER}" max="${MAX_RADIUS_METER}" step="50" value="${STANDARD_RADIUS_METER}" />
      </div>
      <p class="muted" id="naehe-radius-status">${t("Gilt für „Hofläden in der Nähe“ in der Liste, nur auf diesem Gerät.")}</p>
    </section>

    <section class="formular-abschnitt">
      <h2>${t("Verbindung")}</h2>
      <div class="feld-gruppe">
        <label for="f-ha-adresse">${t("Home-Assistant-Adresse")}</label>
        <input type="text" id="f-ha-adresse" value="${app.haUrl ? escapeAttr(app.haUrl) : "–"}" disabled />
      </div>
    </section>

    <section class="formular-abschnitt">
      <h2>${t("Token ändern")}</h2>
      <p class="muted">
        ${t("Neues Long-Lived Access Token hinterlegen, z. B. nach Widerruf des bisherigen Tokens in Home Assistant. Die HA-Adresse bleibt unverändert.")}
      </p>
      <div id="token-fehler" class="hinweis-leiste fehler" hidden></div>
      <div id="token-erfolg" class="hinweis-leiste" hidden></div>
      <form id="token-form">
        <div class="feld-gruppe">
          <label for="f-token">${t("Neues Long-Lived Access Token")}</label>
          <textarea id="f-token" placeholder="${t("In Home Assistant unter Profil → Long-Lived Access Tokens erzeugen")}"></textarea>
        </div>
        <button type="submit" class="speichern-btn" id="token-speichern-btn">${t("Token aktualisieren")}</button>
      </form>
    </section>

    <section class="formular-abschnitt">
      <h2>${t("Abmelden")}</h2>
      <p class="muted">
        ${t("Entfernt die Verbindungsdaten (HA-Adresse, Token) von diesem Gerät. Der Lesecache wird dabei nicht angetastet; nach dem Abmelden erscheint wieder der Einrichtungsbildschirm.")}
      </p>
      <div class="aktions-reihe">
        <button type="button" class="gefahr" id="abmelden-btn">${t("Abmelden")}</button>
      </div>
    </section>

    <section class="formular-abschnitt">
      <h2>${t("Version")}</h2>
      <div class="feld-gruppe version-zeile">
        <span>${t("Installiert")}</span>
        <strong id="app-version">${escapeAttr(APP_VERSION)}</strong>
      </div>
      <div class="feld-gruppe version-zeile">
        <span>${t("Neueste")}</span>
        <strong id="neueste-version">–</strong>
      </div>
      <p class="muted" id="update-status" role="status">${t("Prüft, ob eine neuere Version der App vorliegt.")}</p>
      <button type="button" class="hinzufuegen-btn" id="update-suchen-btn">${icon("suche", { klein: true })} ${t("Nach Update suchen")}</button>
      <details class="manuell-bild">
        <summary class="muted klickbar">${t("Die App aktualisiert sich nicht?")}</summary>
        <p class="muted">${t("Leert den Zwischenspeicher der App und lädt sie neu. Anmeldung, Einstellungen und noch nicht gesendete Änderungen bleiben erhalten.")}</p>
        <button type="button" class="hinzufuegen-btn" id="app-zuruecksetzen-btn">${t("App zurücksetzen")}</button>
      </details>
    </section>
  `;

  // Sprache: gilt pro Gerät; danach wird die Ansicht neu gezeichnet.
  const spracheFeld = container.querySelector("#f-sprache");
  spracheFeld.value = gespeicherteSprache() || "";
  const wendeSpracheAn = (code) => {
    setzeSprache(code || null);
    if (app.neuZeichnen) app.neuZeichnen();
  };
  spracheFeld.addEventListener("change", () => wendeSpracheAn(spracheFeld.value));
  // «Zurücksetzen»: zurück auf «Automatisch» (Browsersprache).
  container.querySelector("#sprache-zuruecksetzen").addEventListener("click", () => wendeSpracheAn(""));

  const farbStatus = container.querySelector("#farbe-status");
  const eigeneFarbe = container.querySelector("#f-eigene-farbe");
  const farbKnopfListe = [...container.querySelectorAll(".farb-wahl")];
  const zeigeAuswahl = () => {
    const aktuell = aktuelleMarkenfarbe() || STANDARD_FARBE;
    let bekannt = false;
    farbKnopfListe.forEach((k) => {
      const an = k.dataset.farbe === aktuell;
      bekannt = bekannt || an;
      k.setAttribute("aria-pressed", String(an));
      k.querySelector(".farb-punkt").style.setProperty("background", k.dataset.farbe);
    });
    eigeneFarbe.value = aktuell;
    farbStatus.textContent = bekannt
      ? t("Frei wählbar, nur auf diesem Gerät. Die Schriftfarbe darauf passt sich für gute Lesbarkeit an.")
      : t("Eigene Farbe {farbe} ist aktiv.", { farbe: aktuell });
  };
  zeigeAuswahl();
  // Falls die gespeicherte Farbe erst nach dem Start aus IndexedDB eintrifft.
  setTimeout(zeigeAuswahl, 300);
  farbKnopfListe.forEach((k) =>
    k.addEventListener("click", async () => {
      await setzeMarkenfarbe(k.dataset.farbe);
      zeigeAuswahl();
    })
  );
  eigeneFarbe.addEventListener("input", () => {
    setzeMarkenfarbe(normalisiereHex(eigeneFarbe.value), { speichern: false });
  });
  eigeneFarbe.addEventListener("change", async () => {
    await setzeMarkenfarbe(normalisiereHex(eigeneFarbe.value));
    zeigeAuswahl();
  });
  container.querySelector("#farbe-zuruecksetzen").addEventListener("click", async () => {
    await setzeMarkenfarbe(null);
    zeigeAuswahl();
  });

  const updateStatus = container.querySelector("#update-status");
  const neuesteAnzeige = container.querySelector("#neueste-version");
  const updateKnopf = container.querySelector("#update-suchen-btn");
  async function updatePruefen({ aktualisieren = false } = {}) {
    updateKnopf.disabled = true;
    updateStatus.classList.remove("fehlertext");
    updateStatus.textContent = t("Suche …");
    try {
      const stand = await pruefeAufUpdate();
      neuesteAnzeige.textContent = stand.neueste || "–";
      if (!stand.verfuegbar) {
        updateStatus.textContent = t("Du hast die neueste Version.");
      } else if (aktualisieren) {
        updateStatus.textContent = t("Version {version} wird geladen …", { version: stand.neueste });
        await aktualisiereJetzt();
      } else {
        updateStatus.textContent = t("Neue Version {version} verfügbar. „Nach Update suchen“ lädt sie.", { version: stand.neueste });
      }
    } catch {
      updateStatus.textContent = t("Keine Verbindung: die neueste Version konnte nicht abgefragt werden.");
      updateStatus.classList.add("fehlertext");
    } finally {
      updateKnopf.disabled = false;
    }
  }
  updateKnopf.addEventListener("click", () => updatePruefen({ aktualisieren: true }));
  container.querySelector("#app-zuruecksetzen-btn").addEventListener("click", () => {
    if (confirm(t("Zwischenspeicher der App leeren und neu laden? Anmeldung und Einstellungen bleiben erhalten."))) {
      appZuruecksetzen();
    }
  });
  updatePruefen();

  const radiusFeld = container.querySelector("#f-naehe-radius");
  const radiusStatus = container.querySelector("#naehe-radius-status");
  ladeNaeheRadius()
    .then((gespeichert) => {
      if (gespeichert != null) radiusFeld.value = gespeichert;
    })
    .catch(() => {});
  radiusFeld.addEventListener("change", async () => {
    const wert = Math.round(Number(radiusFeld.value));
    if (!Number.isFinite(wert) || wert < MIN_RADIUS_METER || wert > MAX_RADIUS_METER) {
      radiusStatus.textContent = t("Bitte einen Wert zwischen {min} und {max} Metern eingeben.", { min: MIN_RADIUS_METER, max: MAX_RADIUS_METER });
      radiusStatus.classList.add("fehlertext");
      return;
    }
    radiusFeld.value = wert;
    radiusStatus.classList.remove("fehlertext");
    try {
      await speichereNaeheRadius(wert);
      radiusStatus.textContent = t("Gespeichert: {wert} m.", { wert });
    } catch {
      radiusStatus.textContent = t("Konnte den Wert nicht speichern.");
      radiusStatus.classList.add("fehlertext");
    }
  });

  const form = container.querySelector("#token-form");
  const fehlerBox = container.querySelector("#token-fehler");
  const erfolgBox = container.querySelector("#token-erfolg");
  const submitBtn = container.querySelector("#token-speichern-btn");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    fehlerBox.hidden = true;
    erfolgBox.hidden = true;

    const neuesToken = container.querySelector("#f-token").value.trim();
    if (!neuesToken) {
      fehlerBox.textContent = t("Bitte ein Token eintragen.");
      fehlerBox.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = t("Aktualisiere …");

    try {
      await app.aktualisiereToken(neuesToken);
      erfolgBox.textContent = t("Token erfolgreich aktualisiert.");
      erfolgBox.hidden = false;
      form.reset();
    } catch (err) {
      fehlerBox.textContent = err?.message || t("Token konnte nicht aktualisiert werden.");
      fehlerBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = t("Token aktualisieren");
    }
  });

  container.querySelector("#abmelden-btn").addEventListener("click", () => {
    if (confirm(t("Verbindung zu Home Assistant auf diesem Gerät trennen?"))) {
      app.abmelden();
    }
  });
}

function escapeAttr(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
