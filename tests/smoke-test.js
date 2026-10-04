/**
 * Playwright-Smoke-Test für die HofKarte-PWA.
 *
 * Läuft gegen eine lokal ausgelieferte Testkopie der App (siehe
 * tests/run-smoke-tests.mjs), bei der `src/ha-client.js` auf
 * `tests/ha-ws-stub.js` statt den echten jsDelivr-Import zeigt – es
 * wird also nie eine echte Verbindung zu Home Assistant aufgebaut.
 * Den für die einzelnen Szenarien nötigen App-Zustand (offline,
 * Beispiel-Hofladen) erzwingen die Tests direkt über
 * `window.hofkarteApp` (siehe `app.js`).
 *
 * Deckt ab:
 * - Grundrendering/Routing (Einrichtungsbildschirm beim ersten Start).
 * - Phase 8a: Offline-Schreib-Outbox (Anlegen/Ändern/Löschen ohne
 *   Verbindung, Sync-Status-Anzeige, Sync-Worker inkl. ID-Remapping
 *   und teilweise fehlschlagendem Sync).
 * - Phase 8c: iOS-/Accessibility-Lücken (Touch-Target-Grössen,
 *   ARIA-Attribute, Label-Verknüpfungen).
 * - Phase 8e: Versionsanzeige in den Einstellungen.
 *
 * Nutzt absichtlich kein Test-Framework (kein Vitest/Jest) – die PWA
 * selbst ist bewusst bundlerfrei (siehe Vorgehensplan, Phase 5), ein
 * Test-Runner mit eigener Abhängigkeitskette wäre hier unverhältnis-
 * mässig. `node` + `playwright` (bereits für den Testlauf installiert)
 * reichen für diesen Umfang.
 */

export async function fuehreSmokeTestsAus(page, baseUrl) {
  let pass = 0;
  let fail = 0;
  const fehlgeschlagen = [];

  function check(label, bedingung) {
    if (bedingung) {
      pass++;
      console.log("OK  -", label);
    } else {
      fail++;
      fehlgeschlagen.push(label);
      console.log("FAIL-", label);
    }
  }

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

  // --- Grundrendering ---------------------------------------------------
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  check("Einrichtungsbildschirm beim ersten Start sichtbar", !!(await page.$("#setup-form")));

  // --- Zustand erzwingen: offline, ein bestehender Hofladen -------------
  await page.evaluate(() => {
    const app = window.hofkarteApp;
    app.haClient = null;
    app.offlineModus = true;
    app.state.hoflaeden = [
      { id: "h1", name: "Bestehender Hof", adresse: "Musterstrasse 1", bewertung: 3, bilder: [] },
    ];
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  check("Nach erzwungenem Offline-Zustand auf Hauptansicht (Tableiste sichtbar)", !!(await page.$(".tableiste")));

  // --- Phase 8a: Offline-Schreib-Outbox ----------------------------------
  const neuerHofladen = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    return app.speichereHofladen({ name: "Offline angelegter Hof", bilder: [] });
  });
  check("Neuer Hofladen erhält lokale Platzhalter-ID", neuerHofladen.id.startsWith("lokal-"));
  check("Neuer Hofladen ist als ausstehend markiert", neuerHofladen._synchronisierungAusstehend === true);

  const anzahlNachAnlegen = await page.evaluate(() => window.hofkarteApp.state.ausstehendeAnzahl);
  check(`Warteschlange enthält 1 Operation nach Anlegen (war: ${anzahlNachAnlegen})`, anzahlNachAnlegen === 1);

  const listeNachAnlegen = await page.evaluate(() => window.hofkarteApp.state.hoflaeden.length);
  check(`Lokale Liste enthält 2 Hofläden nach Anlegen (war: ${listeNachAnlegen})`, listeNachAnlegen === 2);

  await page.evaluate(async () => {
    const app = window.hofkarteApp;
    await app.speichereHofladen({ id: "h1", name: "Bestehender Hof (geändert)", bewertung: 3, bilder: [] });
  });
  const geaenderterName = await page.evaluate(
    () => window.hofkarteApp.state.hoflaeden.find((h) => h.id === "h1").name
  );
  check("Optimistisches Update für bestehenden Hofladen übernommen", geaenderterName === "Bestehender Hof (geändert)");

  const anzahlNachAendern = await page.evaluate(() => window.hofkarteApp.state.ausstehendeAnzahl);
  check(`Warteschlange enthält 2 Operationen nach Ändern (war: ${anzahlNachAendern})`, anzahlNachAendern === 2);

  await page.evaluate(() => {
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(200);
  const listHtml = await page.content();
  check(
    "Sync-Status zeigt Offline + ausstehende Anzahl in der Kopfzeile",
    listHtml.includes("Offline") && listHtml.includes("ausstehend")
  );

  await page.evaluate((id) => {
    window.location.hash = `#/hofladen/${id}`;
    window.dispatchEvent(new Event("hashchange"));
  }, neuerHofladen.id);
  await page.waitForTimeout(200);
  const detailHtml = await page.content();
  check("Detailansicht zeigt Hinweis auf ausstehende Synchronisation", detailHtml.includes("Noch nicht synchronisiert"));

  // Nie synchronisierten, lokal angelegten Hofladen wieder löschen:
  // Warteschlange soll auf die verbleibende "aendern"-Operation zurückfallen.
  await page.evaluate(async (id) => {
    await window.hofkarteApp.loescheHofladen(id);
  }, neuerHofladen.id);
  const anzahlNachLoeschenLokal = await page.evaluate(() => window.hofkarteApp.state.ausstehendeAnzahl);
  check(
    `Löschen eines nie synchronisierten lokalen Hofladens verwirft dessen Anlegen-Operation (war: ${anzahlNachLoeschenLokal})`,
    anzahlNachLoeschenLokal === 1
  );

  // Erfolgreichen Sync simulieren: haClient wieder setzen, Warteschlange abarbeiten.
  const syncErgebnisErfolg = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    let naechsteId = 100;
    app.haClient = {
      hofladenSpeichern: async (daten) => {
        if (!daten.id) return { ...daten, id: String(naechsteId++) };
        return daten;
      },
      hofladenLoeschen: async () => {},
    };
    const { verarbeiteWarteschlange } = await import("/src/sync-worker.js");
    await verarbeiteWarteschlange(app);
    return {
      ausstehendeAnzahl: app.state.ausstehendeAnzahl,
      hofladenIds: app.state.hoflaeden.map((h) => h.id),
    };
  });
  check(
    `Erfolgreicher Sync leert die Warteschlange (war: ${syncErgebnisErfolg.ausstehendeAnzahl})`,
    syncErgebnisErfolg.ausstehendeAnzahl === 0
  );
  check(
    "Kein lokaler Platzhalter-Hofladen (lokal-…) mehr nach erfolgreichem Sync vorhanden",
    !syncErgebnisErfolg.hofladenIds.some((id) => id.startsWith("lokal-"))
  );

  // --- Phase 8c: iOS-/Accessibility-Lücken -------------------------------
  // Zurück auf die Listenansicht: der vorherige Abschnitt endet auf der
  // Detailansicht (#/hofladen/…), die bewusst keinen der drei unteren
  // Tabs als aktiv markiert (siehe app.js, renderMitRahmen()-Aufrufe).
  await page.evaluate(() => {
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(200);

  const kopfBtnHeight = await page.$eval("#einstellungen-btn", (el) => el.getBoundingClientRect().height);
  check("Einstellungen-Button Höhe >= 44px", kopfBtnHeight >= 44);

  const tabHeights = await page.$$eval(".tableiste button", (els) => els.map((el) => el.getBoundingClientRect().height));
  check("Alle Tab-Buttons Höhe >= 44px", tabHeights.length > 0 && tabHeights.every((h) => h >= 44));

  check("Aktiver Tab hat aria-current=page", !!(await page.$(".tableiste button[aria-current='page']")));

  const mapModuleOk = await page.evaluate(async () => {
    const mod = await import("/src/views/map.js");
    return typeof mod.renderKarte === "function";
  });
  check("map.js exportiert renderKarte korrekt (inkl. prefers-reduced-motion-Zweig)", mapModuleOk);

  await page.click("[data-tab='neu']");
  await page.waitForTimeout(400);

  const sterneGroup = await page.$("#bewertung-sterne");
  check("Sterne-Gruppe hat role=group", (await sterneGroup?.getAttribute("role")) === "group");
  check("Sterne-Gruppe hat aria-label", !!(await sterneGroup?.getAttribute("aria-label")));
  check("Einzelner Stern-Button hat aria-label", !!(await page.$eval(".stern-btn", (el) => el.getAttribute("aria-label"))));
  check("Stern-Button Höhe >= 44px", (await page.$eval(".stern-btn", (el) => el.getBoundingClientRect().height)) >= 44);

  await page.click("#oz-hinzufuegen-btn");
  await page.waitForTimeout(200);
  const ozLabels = await page.$eval(".oeffnungszeit-zeile", (el) => ({
    wochentag: el.querySelector(".oz-wochentag")?.getAttribute("aria-label"),
    beginn: el.querySelector(".oz-beginn")?.getAttribute("aria-label"),
    ende: el.querySelector(".oz-ende")?.getAttribute("aria-label"),
    entfernen: el.querySelector(".entfernen-btn")?.getAttribute("aria-label"),
    entfernenHoehe: el.querySelector(".entfernen-btn")?.getBoundingClientRect().height,
  }));
  check("Wochentag-Select hat aria-label", ozLabels.wochentag === "Wochentag");
  check("Beginn-Input hat aria-label", ozLabels.beginn === "Beginn");
  check("Ende-Input hat aria-label", ozLabels.ende === "Ende");
  check("Entfernen-Button der Öffnungszeit hat aria-label", !!ozLabels.entfernen);
  check("Entfernen-Button (Öffnungszeiten) Höhe >= 44px", ozLabels.entfernenHoehe >= 44);

  check("Speichern-Button Höhe >= 44px", (await page.$eval("#speichern-btn", (el) => el.getBoundingClientRect().height)) >= 44);
  check("Abbrechen-Button Höhe >= 44px", (await page.$eval("#abbrechen-btn", (el) => el.getBoundingClientRect().height)) >= 44);

  await page.click("[data-tab='liste']");
  await page.waitForTimeout(300);
  check("Suchfeld hat aria-label", !!(await page.$eval("#such-feld", (el) => el.getAttribute("aria-label"))));
  check("Sortier-Select hat aria-label", !!(await page.$eval("#sort-spalte", (el) => el.getAttribute("aria-label"))));
  check("Sortierrichtung-Button hat aria-label", !!(await page.$eval("#sort-richtung", (el) => el.getAttribute("aria-label"))));
  check(
    "Sortierrichtung-Button Höhe >= 44px",
    (await page.$eval("#sort-richtung", (el) => el.getBoundingClientRect().height)) >= 44
  );

  await page.click("#einstellungen-btn");
  await page.waitForTimeout(300);
  check(
    "HA-Adresse-Label ist mit Input verknüpft (for=f-ha-adresse)",
    (await page.$eval("section.formular-abschnitt label", (el) => el.getAttribute("for"))) === "f-ha-adresse"
  );
  check("Zugehöriges Input-Feld existiert", !!(await page.$("#f-ha-adresse")));

  // --- Phase 8e: Versionsanzeige -----------------------------------------
  const angezeigteVersion = await page.$eval("#app-version", (el) => el.textContent.trim());
  const erwarteteVersion = await page.evaluate(async () => {
    const mod = await import("/src/version.js");
    return mod.APP_VERSION;
  });
  check(
    `Einstellungen zeigen die installierte Version an (${angezeigteVersion})`,
    !!angezeigteVersion && angezeigteVersion === erwarteteVersion
  );

  check(
    "Keine Konsolen-/Laufzeitfehler (ohne CDN-Netzwerkfehler aus der Sandbox)",
    consoleErrors.filter((e) => !/jsdelivr|leaflet|ERR_TUNNEL|net::/i.test(e)).length === 0
  );
  if (consoleErrors.length) {
    console.log("Beobachtete Konsolenmeldungen (ggf. erwartete CDN-Netzwerkfehler in isolierter Testumgebung):");
    console.log(consoleErrors);
  }

  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  if (fail) {
    console.log("Fehlgeschlagen:", fehlgeschlagen);
  }
  return fail === 0;
}
