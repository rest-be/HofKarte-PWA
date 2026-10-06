/**
 * Playwright-Smoke-Test für die HofKarte-PWA.
 *
 * Läuft gegen eine lokal ausgelieferte Testkopie der App (siehe
 * tests/run-smoke-tests.mjs), bei der `src/ha-client.js` auf
 * `tests/ha-ws-stub.js` statt den echten (lokalen) Bibliotheks-Import zeigt – es
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
  check("Einrichtung: HA-Adresse, Token und Button 'Verbinden' vorhanden", !!(await page.$("#ha-url")) && !!(await page.$("#ha-token")) && (await page.$eval("#setup-submit", (el) => el.textContent.trim())) === "Verbinden");
  const setupVersion = await page.$eval("#setup-version", (el) => el.textContent.trim()).catch(() => "");
  check(`Einrichtung zeigt Versionsnummer (${setupVersion})`, /^\d+\.\d+\.\d+$/.test(setupVersion));
  check("Einrichtung enthält Release Notes", (await page.$$("#release-notes .release")).length >= 5);

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

  // --- Phase 8b: Versionskonflikte ---------------------------------------
  const konfliktSetup = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    const { VersionskonfliktFehler } = await import("/src/ha-client.js");
    const { verarbeiteWarteschlange } = await import("/src/sync-worker.js");
    window.__aufrufe = [];
    window.__serverStand = { id: "42", name: "Server Name", version: 4, bilder: [] };
    await app._uebernehmeLokal({ id: "42", name: "Alter Name", version: 3, bilder: [] });
    const liste = async () => ({ hoflaeden: [{ ...window.__serverStand }], zuletztAktualisiert: null, ausCache: false });
    app.haClient = null;
    await app.speichereHofladen({ id: "42", name: "Mein Name", version: 3, bilder: [] });
    app.haClient = {
      hoflaedenListe: liste,
      hofladenLoeschen: async () => {},
      hofladenSpeichern: async (daten) => {
        window.__aufrufe.push(daten.version);
        if (daten.version !== window.__serverStand.version) {
          throw new VersionskonfliktFehler({ ...window.__serverStand });
        }
        window.__serverStand = { ...daten, version: daten.version + 1 };
        return window.__serverStand;
      },
    };
    await verarbeiteWarteschlange(app);
    const nachErstemLauf = window.__aufrufe.length;
    await verarbeiteWarteschlange(app);
    return {
      aufrufeErsterLauf: nachErstemLauf,
      aufrufeZweiterLauf: window.__aufrufe.length,
      konflikte: app.state.konflikte.length,
      ausstehend: app.state.ausstehendeAnzahl,
    };
  });
  check("Versionskonflikt wird erkannt und als Konflikt markiert", konfliktSetup.konflikte === 1);
  check("Konflikt zählt nicht als 'ausstehend'", konfliktSetup.ausstehend === 0);
  check("Konflikt-Operation wird nicht automatisch wiederholt", konfliktSetup.aufrufeZweiterLauf === konfliktSetup.aufrufeErsterLauf);

  await page.evaluate(() => {
    window.location.hash = "#/konflikt/42";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(200);
  const konfliktHtml = await page.$eval(".inhalt", (el) => el.innerText);
  check("Konfliktansicht zeigt beide Versionen", konfliktHtml.includes("Mein Name") && konfliktHtml.includes("Server Name"));
  check("Kopfzeile verweist auf den Konflikt", (await page.$eval(".kopfzeile", (el) => el.innerText)).includes("Konflikt"));
  check("Konfliktansicht hat beide Entscheidungs-Buttons", !!(await page.$("#konflikt-meine")) && !!(await page.$("#konflikt-server")));

  await page.click("#konflikt-meine");
  await page.waitForTimeout(400);
  const nachMeine = await page.evaluate(() => ({
    konflikte: window.hofkarteApp.state.konflikte.length,
    ausstehend: window.hofkarteApp.state.ausstehendeAnzahl,
    serverName: window.__serverStand.name,
    serverVersion: window.__serverStand.version,
    letzteVersion: window.__aufrufe[window.__aufrufe.length - 1],
  }));
  check("'Meine Version übernehmen' sendet auf aktueller Server-Version (4)", nachMeine.letzteVersion === 4);
  check("Meine Version ist auf dem Server, Version erhöht", nachMeine.serverName === "Mein Name" && nachMeine.serverVersion === 5);
  check("Konflikt danach gelöst, Warteschlange leer", nachMeine.konflikte === 0 && nachMeine.ausstehend === 0);

  // Online-Konflikt (Server hat sich erneut geändert) + "Server-Version übernehmen"
  const nachServer = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    window.__serverStand = { id: "42", name: "Neuer Server Name", version: 9, bilder: [] };
    let fehlercode = null;
    try {
      await app.speichereHofladen({ id: "42", name: "Veraltete Eingabe", version: 5, bilder: [] });
    } catch (err) {
      fehlercode = err.code;
    }
    const konfliktErkannt = app.state.konflikte.length === 1;
    await app.loeseKonfliktMitServer("42");
    return {
      fehlercode,
      konfliktErkannt,
      konflikte: app.state.konflikte.length,
      name: app.hofladenMitId("42")?.name,
      version: app.hofladenMitId("42")?.version,
    };
  });
  check("Online-Konflikt wirft Fehler mit code=version_conflict", nachServer.fehlercode === "version_conflict");
  check("Online-Konflikt legt eigene Fassung als Konflikt ab", nachServer.konfliktErkannt);
  check("'Server-Version übernehmen' verwirft meine Änderung", nachServer.konflikte === 0 && nachServer.name === "Neuer Server Name" && nachServer.version === 9);

  // --- Phase 8c: iOS-/Accessibility-Lücken -------------------------------
  // Zurück auf die Listenansicht: der vorherige Abschnitt endet auf der
  // Detailansicht (#/hofladen/…), die bewusst keinen der drei unteren
  // Tabs als aktiv markiert (siehe app.js, renderMitRahmen()-Aufrufe).
  await page.evaluate(() => {
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(200);

  // --- Phase 9: iOS-Optik ---------------------------------------------------
  check("Listenansicht hat Large Title 'Hofläden'", (await page.$eval(".grosser-titel", (el) => el.textContent.trim()).catch(() => "")) === "Hofläden");
  check("Tab-Icons sind Inline-SVG", (await page.$$(".tableiste .icon svg")).length === 3);
  check("Navigationsleiste nutzt Blur (backdrop-filter)", await page.$eval(".kopfzeile", (el) => {
    const cs = getComputedStyle(el);
    return (cs.backdropFilter || cs.webkitBackdropFilter || "").includes("blur");
  }));
  check("'Hofläden in der Nähe' ist standardmässig eingeklappt", (await page.$eval("details.naehe-karte", (el) => el.open)) === false);
  check("Eingeklappte Nähe-Karte ist höchstens 60px hoch", (await page.$eval("details.naehe-karte", (el) => el.getBoundingClientRect().height)) <= 60);
  await page.click("details.naehe-karte > summary");
  await page.waitForTimeout(150);
  check("Nähe-Karte lässt sich aufklappen", await page.$eval("details.naehe-karte", (el) => el.open));
  await page.fill("#such-feld", "x");
  await page.fill("#such-feld", "");
  check("Aufgeklappte Nähe-Karte bleibt beim Neuzeichnen offen", await page.$eval("details.naehe-karte", (el) => el.open));
  await page.click("details.naehe-karte > summary");
  check("Listenansicht ohne Zurück-Button (Tab-Ebene)", !(await page.$("#zurueck-btn")));
  await page.evaluate(() => {
    window.location.hash = "#/hofladen/h1";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    await window.hofkarteApp._uebernehmeLokal({ id: "geo1", name: "Hof mit Koordinaten", latitude: 46.9481, longitude: 7.4474, bilder: [], oeffnungszeiten: [1, 2, 3, 4, 5, 6, 7].map((wochentag) => ({ wochentag, beginn: "08:00", ende: "18:00" })) });
    window.location.hash = "#/hofladen/geo1";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(250);
  const kartenLink = await page.$eval(".detail-abschnitt a[href*='maps']", (el) => el.getAttribute("href")).catch(() => null);
  check("Detailansicht: Karten-Link öffnet Google Maps", kartenLink === "https://www.google.com/maps/search/?api=1&query=46.9481,7.4474");
  check("Öffnungszeiten sind standardmässig eingeklappt", (await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.open)) === false);
  check("Eingeklappte Öffnungszeiten sind höchstens 60px hoch", (await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.getBoundingClientRect().height)) <= 60);
  check("Eingeklappte Öffnungszeiten zeigen die heutigen Zeiten", (await page.$eval("#oeffnungszeiten-abschnitt summary", (el) => el.textContent)).includes("Heute 08:00–18:00"));
  await page.click("#oeffnungszeiten-abschnitt > summary");
  await page.waitForTimeout(150);
  check("Öffnungszeiten lassen sich aufklappen und zeigen alle Tage", (await page.$$eval("#oeffnungszeiten-abschnitt .kontakt-zeile", (els) => els.length)) === 7 && (await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.open)));
  await page.click("#oeffnungszeiten-abschnitt > summary");
  check("Detailansicht hat Zurück-Button in der Navigationsleiste", !!(await page.$("#zurueck-btn")));
  check("Zurück-Button Höhe >= 44px", (await page.$eval("#zurueck-btn", (el) => el.getBoundingClientRect().height)) >= 44);
  await page.click("#zurueck-btn");
  await page.waitForTimeout(250);
  check("Zurück-Button führt zur Liste", !!(await page.$(".grosser-titel")));

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
    (await page.$eval("label[for='f-ha-adresse']", (el) => el.getAttribute("for"))) === "f-ha-adresse"
  );
  check("Zugehöriges Input-Feld existiert", !!(await page.$("#f-ha-adresse")));

  const einstellungenReihenfolge = await page.$$eval(".formular-abschnitt > h2", (els) => els.map((e) => e.textContent.trim()));
  check(
    `Einstellungen-Reihenfolge: Nähe, Verbindung, Token ändern, Abmelden, Version (${einstellungenReihenfolge.join(", ")})`,
    JSON.stringify(einstellungenReihenfolge) === JSON.stringify(["Hofläden in der Nähe", "Verbindung", "Token ändern", "Abmelden", "Version"])
  );
  check("Nähe-Umkreis: Standard 500 m", (await page.$eval("#f-naehe-radius", (el) => el.value)) === "500");
  await page.fill("#f-naehe-radius", "750");
  await page.dispatchEvent("#f-naehe-radius", "change");
  await page.waitForTimeout(200);
  check("Nähe-Umkreis wird gespeichert", (await page.evaluate(async () => (await import("/src/storage.js")).ladeNaeheRadius())) === 750);
  await page.fill("#f-naehe-radius", "5");
  await page.dispatchEvent("#f-naehe-radius", "change");
  await page.waitForTimeout(100);
  check("Nähe-Umkreis: ungültiger Wert wird abgelehnt (bleibt 750)", (await page.evaluate(async () => (await import("/src/storage.js")).ladeNaeheRadius())) === 750);
  await page.evaluate(() => {
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    window.location.hash = "#/einstellungen";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  check("Gespeicherter Nähe-Umkreis erscheint nach Neuaufruf der Einstellungen", (await page.$eval("#f-naehe-radius", (el) => el.value)) === "750");
  // Radius an die Suche weitergereicht?
  const gesendeterRadius = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    let radius = null;
    const alterClient = app.haClient;
    app.haClient = { hoflaedenInNaehe: async (a) => { radius = a.radiusMeter; return { hoflaeden: [] }; } };
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 46.9, longitude: 7.4 } }) } });
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector("details.naehe-karte > summary").click();
    document.querySelector("#naehe-suchen-btn").click();
    await new Promise((r) => setTimeout(r, 400));
    app.haClient = alterClient;
    return radius;
  });
  check(`Suche nutzt den eingestellten Umkreis (${gesendeterRadius})`, gesendeterRadius === 750);
  await page.evaluate(() => {
    window.location.hash = "#/einstellungen";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);

  // --- Phase 10: Performance & Security ------------------------------------
  // Suchfeld behält beim Tippen den Fokus (früher: komplettes Neuzeichnen).
  await page.evaluate(() => {
    const app = window.hofkarteApp;
    app.state.hoflaeden = [
      { id: "p1", name: "Alpha Hof", ort: "Bern", bilder: [], hauptbild_url: "https://ha.example/api/image/serve/abc123/original" },
      { id: "p2", name: "Beta Hof", ort: "Thun", bilder: [] },
    ];
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  await page.click("#such-feld");
  await page.keyboard.type("abc", { delay: 30 });
  const sucheStatus = await page.evaluate(() => ({
    wert: document.querySelector("#such-feld").value,
    fokus: document.activeElement?.id,
  }));
  check("Suchfeld behält Fokus und Wert beim Tippen", sucheStatus.wert === "abc" && sucheStatus.fokus === "such-feld");
  await page.fill("#such-feld", "alpha");
  await page.waitForTimeout(300);
  check("Suche filtert die Liste (debounced)", (await page.$$(".hofladen-karte")).length === 1);
  const thumbSrc = await page.$eval(".hofladen-karte img.miniatur", (el) => el.getAttribute("src")).catch(() => "");
  check("Liste nutzt verkleinerte Vorschau statt Original", thumbSrc.endsWith("/256x256"));
  await page.fill("#such-feld", "");
  await page.waitForTimeout(300);

  // Hilfsfunktionen
  const helfer = await page.evaluate(async () => {
    const { escapeHtml, sichereHttpUrl } = await import("/src/html.js");
    const { vorschauUrl, bildVerkleinern } = await import("/src/bilder.js");
    const { pruefeHaAdresse } = await import("/src/ha-client.js");
    const canvas = document.createElement("canvas");
    canvas.width = 3200;
    canvas.height = 2400;
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `hsl(${i * 9}, 70%, 50%)`;
      ctx.fillRect(i * 80, (i % 7) * 340, 160, 300);
    }
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.98));
    const gross = new File([blob], "foto.jpg", { type: "image/jpeg" });
    const klein = await bildVerkleinern(gross);
    const bmp = await createImageBitmap(klein);
    let httpFehler = null;
    try { pruefeHaAdresse("http://ha.example.com:8123"); } catch (e) { httpFehler = e.message; }
    return {
      esc: escapeHtml(`<img src=x onerror="a()">'`),
      jsUrl: sichereHttpUrl("javascript:alert(1)"),
      httpsUrl: sichereHttpUrl("https://example.com/x"),
      vorschau: vorschauUrl("https://h/api/image/serve/id1/original", 512),
      fremdUrl: vorschauUrl("https://bild.example/foto.jpg"),
      kleiner: klein.size < gross.size,
      breite: bmp.width,
      httpFehler,
      httpsOk: pruefeHaAdresse("https://ha.example.com:8123/"),
      localhostOk: pruefeHaAdresse("http://localhost:8123"),
    };
  });
  check("escapeHtml maskiert Tags und Anführungszeichen", !/[<>"']/.test(helfer.esc));
  check("sichereHttpUrl blockt javascript: und erlaubt https:", helfer.jsUrl === null && helfer.httpsUrl === "https://example.com/x");
  check("vorschauUrl ersetzt nur HA-Original-URLs", helfer.vorschau.endsWith("/id1/512x512") && helfer.fremdUrl === "https://bild.example/foto.jpg");
  check(`Upload-Verkleinerung: Bild wird kleiner (Breite ${helfer.breite})`, helfer.kleiner && helfer.breite <= 1600);
  check("HA-Adresse: http:// wird abgelehnt, https:// und localhost erlaubt", !!helfer.httpFehler && helfer.httpsOk === "https://ha.example.com:8123" && helfer.localhostOk === "http://localhost:8123");

  // Feindliche Daten dürfen keinen Code einschleusen.
  await page.evaluate(() => {
    window.__xss = 0;
    const app = window.hofkarteApp;
    app.state.hoflaeden = [
      {
        id: 'x"><img src=x onerror=window.__xss=1>',
        name: "<img src=x onerror=window.__xss=1>Böse",
        ort: "<b>x</b>",
        website: "javascript:window.__xss=1",
        hauptbild_url: 'https://x.example/a.png" onerror="window.__xss=1',
        latitude: 46.9, longitude: 7.4,
        bilder: [{ url: 'https://x.example/b.png" onerror="window.__xss=1', beschreibung: '"><script>window.__xss=1</script>' }],
        sonderoeffnungszeiten: [{ datum_von: "<i>1</i>", datum_bis: "<i>2</i>", geschlossen: true }],
        oeffnungszeiten: [],
      },
    ];
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  const listeInjektion = await page.evaluate(() => ({
    xss: window.__xss,
    fremdeBilder: document.querySelectorAll("#hofladen-liste img[onerror]").length,
    fremdeTags: document.querySelectorAll("#hofladen-liste b, #hofladen-liste .name img").length,
  }));
  check("Liste: feindliche Daten bleiben Text", listeInjektion.xss === 0 && listeInjektion.fremdeBilder === 0 && listeInjektion.fremdeTags === 0);
  await page.evaluate(() => {
    const id = window.hofkarteApp.state.hoflaeden[0].id;
    window.location.hash = "#/hofladen/" + encodeURIComponent(id);
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(400);
  const detailInjektion = await page.evaluate(() => ({
    xss: window.__xss,
    onerror: document.querySelectorAll("[onerror]").length,
    scripts: document.querySelectorAll(".inhalt script").length,
    jsLink: [...document.querySelectorAll("a")].some((a) => a.href.startsWith("javascript:")),
  }));
  check("Detail: feindliche Daten bleiben Text, kein javascript:-Link", detailInjektion.xss === 0 && detailInjektion.onerror === 0 && detailInjektion.scripts === 0 && !detailInjektion.jsLink);

  // Karten-Popup: Name als Text.
  const popup = await page.evaluate(async () => {
    window.location.hash = "#/karte";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 800));
    const L = window.L;
    if (!L) return { geladen: false };
    return { geladen: true, xss: window.__xss, vendorCss: !!document.querySelector('link[href="./vendor/leaflet/leaflet.css"]') };
  });
  check("Karte: Leaflet kommt lokal aus vendor/", popup.geladen && popup.vendorCss);
  check("Kein CDN-Verweis in index.html, CSP vorhanden", await page.evaluate(async () => {
    const html = await (await fetch("/index.html")).text();
    return !/jsdelivr|unpkg|cdnjs/.test(html) && /Content-Security-Policy/.test(html) && !/<script>/.test(html);
  }));

  // Kartenfilter: geschlossene Hofläden ausblendbar.
  const karte = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    app.state.hoflaeden = [
      { id: "k1", name: "Offen", latitude: 46.9, longitude: 7.4, geoeffnet: true, bilder: [] },
      { id: "k2", name: "Zu", latitude: 46.91, longitude: 7.41, geoeffnet: false, bilder: [] },
      { id: "k3", name: "Unbekannt", latitude: 46.92, longitude: 7.42, geoeffnet: null, bilder: [] },
    ];
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 200));
    window.location.hash = "#/karte";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 700));
    const anzahl = () => document.querySelectorAll(".leaflet-marker-icon").length;
    const alle = anzahl();
    const box = document.querySelector("#filter-geschlossen");
    box.click();
    await new Promise((r) => setTimeout(r, 200));
    const gefiltert = anzahl();
    box.click();
    await new Promise((r) => setTimeout(r, 200));
    return { alle, gefiltert, wieder: anzahl() };
  });
  check(`Karte: Filter blendet Geschlossene aus (${karte.alle} → ${karte.gefiltert} → ${karte.wieder})`, karte.alle === 3 && karte.gefiltert === 2 && karte.wieder === 3);

  // Foto-Upload bevorzugt WebSocket (kein CORS), REST nur als Fallback.
  const upload = await page.evaluate(async () => {
    const { HaClient } = await import("/src/ha-client.js");
    const client = new HaClient("https://ha.example.com:8123", "t");
    const nachrichten = [];
    client._connection = {
      sendMessagePromise: async (m) => {
        nachrichten.push(m);
        return { id: "abcd1234" };
      },
    };
    const datei = new File([new Uint8Array([1, 2, 3, 250])], "a.jpg", { type: "image/jpeg" });
    const ok = await client.bildHochladen(datei);
    client._connection = { sendMessagePromise: async () => { throw { code: "unknown_command", message: "x" }; } };
    let restVersucht = false;
    client._bildPerRestHochladen = async () => { restVersucht = true; return { url: "rest", hochgeladen: true }; };
    await client.bildHochladen(datei);
    return { typ: nachrichten[0].type, daten: nachrichten[0].data, url: ok.url, restVersucht };
  });
  check("Upload: WebSocket-Befehl mit Base64, Fallback auf REST bei unknown_command",
    upload.typ === "hofkarte/management/upload_image" && upload.daten === "AQID+g==" &&
    upload.url === "https://ha.example.com:8123/api/image/serve/abcd1234/original" && upload.restVersucht);

  // Eingaben im Editor überleben den stillen Wiederverbindungsversuch (30-s-Timer).
  await page.evaluate(async () => {
    const { speichereVerbindung } = await import("/src/storage.js");
    await speichereVerbindung("https://ha.example.com:8123", "test-token");
    window.hofkarteApp.haClient = null;
    window.hofkarteApp.offlineModus = true;
    window.location.hash = "#/neu";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  const editorEingabe = (await page.$("#f-name")) ? "#f-name" : "input[type=text]";
  await page.fill(editorEingabe, "Tipp-Test");
  await page.evaluate(async () => {
    await window.hofkarteApp.versucheErneutZuVerbinden();
  });
  await page.waitForTimeout(300);
  check("Editor-Eingabe überlebt Wiederverbindungsversuch", (await page.$eval(editorEingabe, (el) => el.value)) === "Tipp-Test");
  await page.evaluate(() => {
    window.location.hash = "#/einstellungen";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);

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
    consoleErrors.filter((e) => !/tile\\.openstreetmap|ERR_TUNNEL|net::/i.test(e)).length === 0
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
