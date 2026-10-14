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
import { STANDARD_RADIUS_METER, MIN_RADIUS_METER, MAX_RADIUS_METER } from "../naehe.js";

export function renderEinstellungen(container, app) {
  container.innerHTML = `
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
