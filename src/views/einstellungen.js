/**
 * Einstellungen-View: über den "⚙️ Einstellungen"-Button in der
 * Kopfzeile erreichbar (siehe app.js, renderMitRahmen()). Enthält die
 * beiden einzigen pro Gerät nötigen Verwaltungsaktionen, die bisher nur
 * aus Home Assistant selbst möglich waren:
 * - Long-Lived Access Token ändern (z. B. nach Widerruf/Ablauf), ohne
 *   die App neu einrichten zu müssen (HA-Adresse bleibt erhalten).
 * - Abmelden (Verbindungsdaten auf diesem Gerät löschen).
 */

export function renderEinstellungen(container, app) {
  container.innerHTML = `
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
  `;

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
