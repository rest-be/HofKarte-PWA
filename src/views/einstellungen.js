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
import { STANDARD_RADIUS_METER, MIN_RADIUS_METER, MAX_RADIUS_METER } from "../naehe.js";

export function renderEinstellungen(container, app) {
  const farbKnoepfe = FARBEN.map(
    (f) => `<button type="button" class="farb-wahl" data-farbe="${f.farbe}" aria-pressed="false">
        <span class="farb-punkt" data-farb-punkt="${f.farbe}">${icon("haken")}</span>${f.name}
      </button>`
  ).join("");

  container.innerHTML = `
    <section class="formular-abschnitt" id="darstellung">
      <h2>Darstellung</h2>
      <div class="farb-raster" role="group" aria-label="Markenfarbe">${farbKnoepfe}</div>
      <div class="farb-eigene">
        <input type="color" id="f-eigene-farbe" value="${STANDARD_FARBE}" aria-label="Eigene Farbe wählen" />
        <div>
          <strong>Eigene Farbe</strong>
          <p class="muted" id="farbe-status">Frei wählbar, nur auf diesem Gerät. Die Schriftfarbe darauf passt sich für gute Lesbarkeit an.</p>
        </div>
      </div>
      <div class="farb-vorschau">
        <span class="vorschau-knopf">Vorschau</span>
        <span class="status-badge offen">Offen bis 18:30</span>
        <button type="button" id="farbe-zuruecksetzen">Zurücksetzen</button>
      </div>
    </section>

    <section class="formular-abschnitt">
      <h2>Hofläden in der Nähe</h2>
      <div class="feld-gruppe">
        <label for="f-naehe-radius">Umkreis in Metern (Standard ${STANDARD_RADIUS_METER})</label>
        <input type="number" id="f-naehe-radius" inputmode="numeric" min="${MIN_RADIUS_METER}" max="${MAX_RADIUS_METER}" step="50" value="${STANDARD_RADIUS_METER}" />
      </div>
      <p class="muted" id="naehe-radius-status">Gilt für „Hofläden in der Nähe“ in der Liste, nur auf diesem Gerät.</p>
    </section>

    <section class="formular-abschnitt">
      <h2>Verbindung</h2>
      <div class="feld-gruppe">
        <label for="f-ha-adresse">Home-Assistant-Adresse</label>
        <input type="text" id="f-ha-adresse" value="${app.haUrl ? escapeAttr(app.haUrl) : "–"}" disabled />
      </div>
    </section>

    <section class="formular-abschnitt">
      <h2>Token ändern</h2>
      <p class="muted">
        Neues Long-Lived Access Token hinterlegen, z. B. nach Widerruf des
        bisherigen Tokens in Home Assistant. Die HA-Adresse bleibt
        unverändert.
      </p>
      <div id="token-fehler" class="hinweis-leiste fehler" hidden></div>
      <div id="token-erfolg" class="hinweis-leiste" hidden></div>
      <form id="token-form">
        <div class="feld-gruppe">
          <label for="f-token">Neues Long-Lived Access Token</label>
          <textarea id="f-token" placeholder="In Home Assistant unter Profil → Long-Lived Access Tokens erzeugen"></textarea>
        </div>
        <button type="submit" class="speichern-btn" id="token-speichern-btn">Token aktualisieren</button>
      </form>
    </section>

    <section class="formular-abschnitt">
      <h2>Abmelden</h2>
      <p class="muted">
        Entfernt die Verbindungsdaten (HA-Adresse, Token) von diesem
        Gerät. Der Lesecache wird dabei nicht angetastet; nach dem
        Abmelden erscheint wieder der Einrichtungsbildschirm.
      </p>
      <div class="aktions-reihe">
        <button type="button" class="gefahr" id="abmelden-btn">Abmelden</button>
      </div>
    </section>

    <section class="formular-abschnitt">
      <h2>Version</h2>
      <div class="feld-gruppe version-zeile">
        <span>Installiert</span>
        <strong id="app-version">${escapeAttr(APP_VERSION)}</strong>
      </div>
    </section>
  `;

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
      ? "Frei wählbar, nur auf diesem Gerät. Die Schriftfarbe darauf passt sich für gute Lesbarkeit an."
      : `Eigene Farbe ${aktuell} ist aktiv.`;
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
      radiusStatus.textContent = `Bitte einen Wert zwischen ${MIN_RADIUS_METER} und ${MAX_RADIUS_METER} Metern eingeben.`;
      radiusStatus.classList.add("fehlertext");
      return;
    }
    radiusFeld.value = wert;
    radiusStatus.classList.remove("fehlertext");
    try {
      await speichereNaeheRadius(wert);
      radiusStatus.textContent = `Gespeichert: ${wert} m.`;
    } catch {
      radiusStatus.textContent = "Konnte den Wert nicht speichern.";
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
      fehlerBox.textContent = "Bitte ein Token eintragen.";
      fehlerBox.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Aktualisiere …";

    try {
      await app.aktualisiereToken(neuesToken);
      erfolgBox.textContent = "Token erfolgreich aktualisiert.";
      erfolgBox.hidden = false;
      form.reset();
    } catch (err) {
      fehlerBox.textContent = err?.message || "Token konnte nicht aktualisiert werden.";
      fehlerBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Token aktualisieren";
    }
  });

  container.querySelector("#abmelden-btn").addEventListener("click", () => {
    if (confirm("Verbindung zu Home Assistant auf diesem Gerät trennen?")) {
      app.abmelden();
    }
  });
}

function escapeAttr(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
