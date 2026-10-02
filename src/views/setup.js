/**
 * Einrichtungsbildschirm: HA-Adresse + Long-Lived Access Token erfassen
 * (siehe Vorgehensplan Phase 4, Schritt 34).
 *
 * Das Adressfeld ist bewusst mit der im Vorgehensplan festgelegten
 * DuckDNS-Adresse vorausgefüllt (kann überschrieben werden, falls
 * jemand HofKarte unter einer anderen Adresse betreibt).
 */

const STANDARD_HA_ADRESSE = "https://hofkarte.duckdns.org:8123";

/**
 * @param {HTMLElement} container
 * @param {(haUrl: string, token: string) => Promise<void>} onVerbinden
 *        Wird mit den eingegebenen Werten aufgerufen; soll bei Erfolg
 *        auflösen, bei Fehler mit einer `Error` (deren `message`
 *        angezeigt wird) ablehnen.
 */
export function renderSetup(container, onVerbinden) {
  container.innerHTML = `
    <div class="einrichtung">
      <img class="carrot-logo" src="icons/icon-192.png" alt="" />
      <h1>HofKarte</h1>
      <p class="untertitel">Verbindung zu Home Assistant einrichten</p>

      <div id="setup-fehler" class="hinweis-leiste fehler" hidden></div>

      <form id="setup-form">
        <div class="feld-gruppe">
          <label for="ha-url">Home-Assistant-Adresse</label>
          <input type="url" id="ha-url" required value="${STANDARD_HA_ADRESSE}" />
        </div>
        <div class="feld-gruppe">
          <label for="ha-token">Long-Lived Access Token</label>
          <textarea id="ha-token" required placeholder="In Home Assistant unter Profil → Long-Lived Access Tokens erzeugen"></textarea>
        </div>
        <button type="submit" class="speichern-btn" id="setup-submit">Verbinden</button>
      </form>

      <p class="hinweistext">
        Das Token wird nur lokal auf diesem Gerät gespeichert (IndexedDB) –
        nie an einen anderen Server übertragen. Für jedes Gerät sollte ein
        eigenes Token verwendet werden, damit es bei Geräteverlust gezielt
        widerrufen werden kann.
      </p>
    </div>
  `;

  const form = container.querySelector("#setup-form");
  const fehlerBox = container.querySelector("#setup-fehler");
  const submitBtn = container.querySelector("#setup-submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    fehlerBox.hidden = true;

    const haUrl = container.querySelector("#ha-url").value.trim().replace(/\/+$/, "");
    const token = container.querySelector("#ha-token").value.trim();

    submitBtn.disabled = true;
    submitBtn.textContent = "Verbinde …";

    try {
      await onVerbinden(haUrl, token);
    } catch (err) {
      fehlerBox.textContent = err?.message || "Verbindung fehlgeschlagen.";
      fehlerBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Verbinden";
    }
  });
}
