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
  check(`Einrichtung zeigt Versionsnummer (${setupVersion})`, /^\d+\.\d+\.\d+(-dev\.\d+|-rc\.\d+)?$/.test(setupVersion));
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
  // --- 2.0.0-dev.2: Gruppen im Detail ---------------------------------------
  const gruppenIds = await page.$$eval("details.gruppe", (els) => els.map((e) => e.dataset.gruppe));
  check(`Detail: Gruppen in HA-Reihenfolge (${gruppenIds.join(", ")})`, gruppenIds.join() === "grunddaten,adresse,kontakt,oeffnungszeiten,angebote,bilder");
  check("Detail: Öffnungszeiten und Angebote sind standardmässig offen, Rest zu", JSON.stringify(await page.$$eval("details.gruppe", (els) => els.filter((e) => e.open).map((e) => e.dataset.gruppe))) === JSON.stringify(["oeffnungszeiten", "angebote"]));
  check("Detail: Öffnungszeiten zeigen alle 7 Tage", (await page.$$eval("#oeffnungszeiten-abschnitt .kontakt-zeile", (els) => els.length)) === 7);
  check("Detail: heutiger Tag ist hervorgehoben", (await page.$$("#oeffnungszeiten-abschnitt .kontakt-zeile.heute")).length === 1);
  check("Detail: Kurzinfo der Öffnungszeiten zeigt heutige Zeiten", (await page.$eval("#oeffnungszeiten-abschnitt summary", (el) => el.textContent)).includes("Heute 08:00–18:00"));
  check("Detail: Vollständigkeit hat Text für Screenreader", (await page.$eval("#oeffnungszeiten-abschnitt .vollst .nur-sr", (el) => el.textContent)).includes("vollständig"));
  check("Detail: Schnellaktion Route vorhanden", !!(await page.$(".schnellaktion[href*='maps/dir']")));
  check("Detail: Hinweis «Noch unvollständig» mit Link zum Bearbeiten", (await page.$eval("#unvollstaendig-hinweis a", (el) => el.getAttribute("href"))).endsWith("/bearbeiten"));
  await page.click("#oeffnungszeiten-abschnitt > summary");
  await page.waitForTimeout(150);
  check("Detail: Gruppe lässt sich einklappen", (await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.open)) === false);
  check("Detail: eingeklappte Gruppe ist höchstens 60px hoch", (await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.getBoundingClientRect().height)) <= 60);
  await page.click("#alle-btn");
  await page.waitForTimeout(150);
  check("Detail: «Alle ausklappen» öffnet alle Gruppen", (await page.$$eval("details.gruppe", (els) => els.every((e) => e.open))));
  await page.click("#alle-btn");
  await page.click("#oeffnungszeiten-abschnitt > summary");
  const gr = await page.evaluate(async () => {
    const g = await import("/src/gruppen.js");
    const finde = (id) => g.HOF_GRUPPEN.find((x) => x.id === id);
    return {
      leer: g.vollstaendigkeit(finde("adresse"), {}),
      halb: g.vollstaendigkeit(finde("adresse"), { adresse: "Dorfstrasse 1" }),
      voll: g.vollstaendigkeit(finde("adresse"), { adresse: "Dorfstrasse 1", ort: "Bern", latitude: 46.9, longitude: 7.4 }),
      kontaktZwei: g.vollstaendigkeit(finde("kontakt"), { mobilnummer: "079 1", website: "https://a.ch" }),
      offen: g.offeneGruppen({}).map((x) => x.id).join(),
    };
  });
  check("Gruppen: Vollständigkeit leer/halb/voll und Kontakt ab 2 Angaben", gr.leer === "leer" && gr.halb === "halb" && gr.voll === "voll" && gr.kontaktZwei === "voll");
  check("Gruppen: «Noch unvollständig» ohne die rein informative Herkunft", gr.offen === "grunddaten,adresse,kontakt,oeffnungszeiten,angebote,bilder");
  await page.evaluate(async () => {
    await window.hofkarteApp._uebernehmeLokal({ id: "xss1", name: "<img src=x onerror=window.__xss=1>", beschreibung: "<b>fett</b>", mobilnummer: "079 123", bilder: [] });
    window.location.hash = "#/hofladen/xss1";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(250);
  check("Detail: Name und Beschreibung werden maskiert", !(await page.$(".detail-kopf img")) && !(await page.$(".gruppen-text b")) && !(await page.evaluate(() => window.__xss)));
  check("Detail: Schnellaktion Anrufen mit tel:-Link, ohne Route ohne Koordinaten", (await page.$eval(".schnellaktion[href^='tel:']", (el) => el.getAttribute("href"))) === "tel:079123" && !(await page.$(".schnellaktion[href*='maps/dir']")));
  await page.evaluate(() => {
    window.location.hash = "#/hofladen/geo1";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(250);
  if (process.env.SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/detail.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  check("Detail: ⋮-Menü enthält Löschen", !!(await page.$("#aktionsmenue #loeschen-btn")));
  check("Detail: Menü- und Bearbeiten-Knopf mindestens 44px", (await page.$eval("#aktionsmenue > summary", (el) => el.getBoundingClientRect().height)) >= 44 && (await page.$eval("#bearbeiten-btn", (el) => el.getBoundingClientRect().height)) >= 44);
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

  await page.evaluate(() => { window.location.hash = "#/neu"; window.dispatchEvent(new Event("hashchange")); });
  await page.waitForTimeout(400);

  const sterneGroup = await page.$("#bewertung-sterne");
  check("Sterne-Gruppe hat role=group", (await sterneGroup?.getAttribute("role")) === "group");
  check("Sterne-Gruppe hat aria-label", !!(await sterneGroup?.getAttribute("aria-label")));
  check("Einzelner Stern-Button hat aria-label", !!(await page.$eval(".stern-btn", (el) => el.getAttribute("aria-label"))));
  check("Stern-Button Höhe >= 44px", (await page.$eval(".stern-btn", (el) => el.getBoundingClientRect().height)) >= 44);

  await page.click("#gruppe-oeffnungszeiten > summary");
  await page.click(".oz-plus[data-plus='1']");
  await page.waitForTimeout(200);
  const ozLabels = await page.$eval(".oeffnungszeit-zeile", (el) => ({
    beginn: el.querySelector(".oz-beginn")?.getAttribute("aria-label"),
    ende: el.querySelector(".oz-ende")?.getAttribute("aria-label"),
    entfernen: el.querySelector(".entfernen-btn")?.getAttribute("aria-label"),
    entfernenHoehe: el.querySelector(".entfernen-btn")?.getBoundingClientRect().height,
  }));
  check("Beginn-Input hat aria-label mit Wochentag", ozLabels.beginn === "Beginn Montag");
  check("Ende-Input hat aria-label mit Wochentag", ozLabels.ende === "Ende Montag");
  check("Entfernen-Button der Öffnungszeit hat aria-label", !!ozLabels.entfernen);
  check("Entfernen-Button (Öffnungszeiten) Höhe >= 44px", ozLabels.entfernenHoehe >= 44);

  // --- 2.0.0-dev.3: Editor mit Gruppen ----------------------------------------
  const edGruppen = await page.$$eval("details.gruppe", (els) => els.map((e) => e.dataset.gruppe));
  check(`Editor: dieselben Gruppen wie im Detail (${edGruppen.join(", ")})`, edGruppen.join() === "grunddaten,adresse,kontakt,oeffnungszeiten,angebote,bilder");
  check("Editor: Grunddaten, Adresse und Angebote offen, Rest zu", JSON.stringify(await page.$$eval("details.gruppe", (els) => els.filter((e) => e.open && e.dataset.gruppe !== "oeffnungszeiten").map((e) => e.dataset.gruppe))) === JSON.stringify(["grunddaten", "adresse", "angebote"]));
  check("Editor: feste Fussleiste mit Abbrechen und Speichern", (await page.$eval("#fussleiste", (el) => getComputedStyle(el).position)) === "fixed" && !!(await page.$("#fussleiste #speichern-btn")));
  check("Editor: 7 Tage im Wochentage-Editor", (await page.$$(".oz-tag")).length === 7);
  check("Editor: «Ungespeichert» erscheint nach einer Änderung", (await page.$eval("#ungespeichert", (el) => el.hidden)) === false);
  await page.click(".oz-kopieren[data-kopieren='1']");
  await page.waitForTimeout(150);
  check("Editor: «Auf Mo–Fr kopieren» ergibt 5 Zeilen", (await page.$$(".oeffnungszeit-zeile")).length === 5 && (await page.$$(".oz-tag[data-tag='4'] .oeffnungszeit-zeile")).length === 1);
  await page.fill("#angebot-neu", "Eier, Honig");
  await page.press("#angebot-neu", "Enter");
  await page.click("[data-vorschlag='Käse']");
  check("Editor: Angebote als Chips (Eier, Honig, Käse)", (await page.$$eval("#angebote-chips .chip", (els) => els.length)) === 3 && (await page.$eval("#f-angebote", (el) => el.value)) === "Eier, Honig, Käse");
  await page.click("#angebote-chips [aria-label='Honig entfernen']");
  check("Editor: Chip lässt sich entfernen", (await page.$eval("#f-angebote", (el) => el.value)) === "Eier, Käse");
  await page.click("[data-zahlung='TWINT']");
  check("Editor: Zahlungsart als Schalter (aria-checked)", (await page.$eval("[data-zahlung='TWINT']", (el) => el.getAttribute("aria-checked"))) === "true" && (await page.$eval("#f-zahlungsarten", (el) => el.value)) === "TWINT");
  check("Editor: Schalter mindestens 44px hoch", (await page.$eval("[data-zahlung='TWINT']", (el) => el.getBoundingClientRect().height)) >= 44);
  check("Editor: Vollständigkeit der Angebote wird live aktualisiert (halb/voll)", (await page.$eval("#gruppe-angebote .vollst", (el) => el.className)).includes("voll"));
  await page.click("[data-stern='4']");
  check("Editor: Bewertung mit «Zurücksetzen»", (await page.$eval("#bewertung-reset", (el) => !el.hidden)));
  await page.click("#bewertung-reset");
  check("Editor: Zurücksetzen löscht die Sterne", (await page.$$(".stern-gefuellt")).length === 0);
  await page.click("#gruppe-grunddaten > summary");
  await page.click("#speichern-btn");
  await page.waitForTimeout(150);
  check("Editor: fehlender Name öffnet die Gruppe und fokussiert das Feld", (await page.$eval("#gruppe-grunddaten", (el) => el.open)) && (await page.evaluate(() => document.activeElement?.id)) === "f-name" && (await page.$eval("#f-name-fehler", (el) => !el.hidden)));
  let rueckfrage = 0;
  page.once("dialog", (d) => { rueckfrage++; d.dismiss(); });
  await page.click("#abbrechen-btn");
  await page.waitForTimeout(150);
  check("Editor: Abbrechen fragt bei Änderungen zurück und bleibt bei «Nein»", rueckfrage === 1 && !!(await page.$("#editor-form")));
  await page.fill("#f-latitude", "abc");
  await page.fill("#f-name", "Test");
  await page.click("#speichern-btn");
  await page.waitForTimeout(100);
  check("Editor: ungültiger Breitengrad wird mit Hinweis abgelehnt", (await page.evaluate(() => document.activeElement?.id)) === "f-latitude" && (await page.$eval("#f-latitude-fehler", (el) => !el.hidden)));
  await page.fill("#f-latitude", "");

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
    `Einstellungen-Reihenfolge: Darstellung, Sprache, Nähe, Verbindung, Token ändern, Abmelden, Version (${einstellungenReihenfolge.join(", ")})`,
    JSON.stringify(einstellungenReihenfolge) === JSON.stringify(["Darstellung", "Sprache", "Hofläden in der Nähe", "Verbindung", "Token ändern", "Abmelden", "Version"])
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
  // --- 2.0.0-dev.1: Markenfarbe -------------------------------------------
  const akzent = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  check("Markenfarbe: Standard ist Grün (#2e7d4f)", (await akzent()) === "#2e7d4f");
  check("Markenfarbe: 5 Voreinstellungen + Standard markiert", (await page.$$(".farb-wahl")).length === 5 && (await page.$eval(".farb-wahl[data-farbe='#2e7d4f']", (el) => el.getAttribute("aria-pressed"))) === "true");
  check("Markenfarbe: Farbwahl ist mindestens 44px hoch", (await page.$eval(".farb-wahl", (el) => el.getBoundingClientRect().height)) >= 44);
  for (const breite of [1280, 390, 320]) {
    await page.setViewportSize({ width: breite, height: 844 });
    await page.waitForTimeout(100);
    const formen = await page.$$eval(".farb-punkt", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).borderRadius]; }));
    check(`Markenfarbe: Farbpunkte sind rund bei ${breite} px (${formen.map((f) => f.join("x")).join(" ")})`, formen.length === 5 && formen.every(([w, h, r]) => w === h && w >= 44 && r === "50%"));
    if (process.env.SCREENSHOT_DIR && breite === 390) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/farben.png`, clip: { x: 0, y: 150, width: 390, height: 300 } });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.click(".farb-wahl[data-farbe='#1f65c0']");
  await page.waitForTimeout(200);
  check("Markenfarbe: Blau wird angewendet", (await akzent()) === "#1f65c0");
  check("Markenfarbe: Blau wird gespeichert", (await page.evaluate(async () => (await import("/src/storage.js")).ladeMarkenfarbe())) === "#1f65c0");
  await page.click(".farb-wahl[data-farbe='#e8750f']");
  await page.waitForTimeout(200);
  check("Markenfarbe: Karotte erhält dunkle Schrift (Kontrast)", (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-ink").trim())) !== "#ffffff");
  const kontrastFehler = await page.evaluate(async () => {
    const d = await import("/src/design.js");
    const schlecht = [];
    for (let i = 0; i < 400; i++) {
      const hex = "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
      for (const dunkel of [false, true]) {
        const f = d.akzentFarben(hex, dunkel);
        const flaeche = dunkel ? "#181f1b" : "#ffffff";
        if (d.kontrast(f.fuell, f.ink) < 4.5 || d.kontrast(f.tint, flaeche) < 4.5 || d.kontrast(f.fuell, flaeche) < 3) schlecht.push(hex + (dunkel ? " dunkel" : " hell"));
      }
    }
    return schlecht.slice(0, 5);
  });
  check(`Markenfarbe: Kontrast bei 800 Zufallsfarben eingehalten (${kontrastFehler.join(", ")})`, kontrastFehler.length === 0);
  await page.click("#farbe-zuruecksetzen");
  await page.waitForTimeout(200);
  check("Markenfarbe: Zurücksetzen stellt Grün wieder her", (await akzent()) === "#2e7d4f" && (await page.evaluate(async () => (await import("/src/storage.js")).ladeMarkenfarbe())) === null);
  check("Symbole: ICON_NAMEN vollständig und ohne Emojis in Einstellungen", (await page.evaluate(async () => (await import("/src/icons.js")).ICON_NAMEN.length)) >= 20 && !/[\u{1F300}-\u{1FAFF}]/u.test(await page.$eval(".inhalt", (el) => el.textContent)));

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
    const box = document.querySelector("#filter-offen");
    box.click();
    await new Promise((r) => setTimeout(r, 200));
    const gefiltert = anzahl();
    box.click();
    await new Promise((r) => setTimeout(r, 200));
    return { alle, gefiltert, wieder: anzahl() };
  });
  check(`Karte: «Nur geöffnet» zeigt nur geöffnete (${karte.alle} → ${karte.gefiltert} → ${karte.wieder})`, karte.alle === 3 && karte.gefiltert === 1 && karte.wieder === 3);


  // Phase 6: Karten-Vorschau, Formmarker, Mein Standort, Escaping.
  const sheetTest = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    app.state.hoflaeden = [
      { id: "s1", name: "<img src=x onerror=window.__xss6=1>", adresse: "Weg 1", ort: "Bern", latitude: 46.9, longitude: 7.4, geoeffnet: true, bilder: [] },
      { id: "s2", name: "Zu", latitude: 46.91, longitude: 7.41, geoeffnet: false, bilder: [] },
      { id: "s3", name: "Unbekannt", latitude: 46.92, longitude: 7.42, geoeffnet: null, bilder: [] },
    ];
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 200));
    window.location.hash = "#/karte";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 700));
    const marker = [...document.querySelectorAll(".leaflet-marker-icon")];
    const formen = marker.map((m) => (m.querySelector("rect") ? "quadrat" : m.querySelector("circle[fill='none']") ? "ring" : "kreis")).sort().join(",");
    const sheetVorher = document.querySelector("#karten-sheet").hidden;
    marker.find((m) => /Weg|img/.test(m.getAttribute("title") || m.title || ""))?.click();
    await new Promise((r) => setTimeout(r, 200));
    const sheet = document.querySelector("#karten-sheet");
    return {
      formen, sheetVorher,
      offen: !sheet.hidden,
      titel: sheet.querySelector("h2")?.textContent,
      imgImSheet: sheet.querySelectorAll("img").length,
      xss: window.__xss6,
      route: sheet.querySelector("#sheet-route")?.getAttribute("href"),
      status: sheet.querySelector(".status-badge")?.textContent,
      hatDetails: !!sheet.querySelector("#sheet-details"),
    };
  });
  check("Karte: Marker haben Formen (Kreis/Quadrat/Ring)", sheetTest.formen === "kreis,quadrat,ring");
  check("Karte: Vorschau ist erst nach Tipp sichtbar", sheetTest.sheetVorher === true && sheetTest.offen);
  check("Karte: Vorschau zeigt Name als Text (Escaping), Status und Route", sheetTest.titel.startsWith("<img") && sheetTest.imgImSheet === 0 && !sheetTest.xss && sheetTest.status === "Geöffnet" && sheetTest.route.includes("destination=46.9%2C7.4") && sheetTest.hatDetails);
  await page.click("#sheet-details");
  await page.waitForTimeout(200);
  check("Karte: «Details» im Sheet öffnet den Hofladen", (await page.evaluate(() => location.hash)) === "#/hofladen/s1");

  // Mein Standort: nur nach Tipp.
  await page.evaluate(() => {
    window.__geoAufrufe6 = 0;
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok) => { window.__geoAufrufe6++; ok({ coords: { latitude: 46.905, longitude: 7.405 } }); } } });
    window.location.hash = "#/karte";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(700);
  check("Karte: Standort wird nicht von selbst abgefragt", (await page.evaluate(() => window.__geoAufrufe6)) === 0);
  await page.click("#mein-standort-btn");
  await page.waitForTimeout(300);
  check("Karte: «Mein Standort» fragt nach Tipp ab und zeichnet Punkt", (await page.evaluate(() => window.__geoAufrufe6)) === 1 && (await page.$$(".leaflet-interactive")).length >= 1);

  // Liste: Filter-Chips, Entfernung nach Tipp.
  const listeTest = await page.evaluate(async () => {
    const app = window.hofkarteApp;
    app.state.hoflaeden = [
      { id: "l1", name: "Fern", latitude: 47.5, longitude: 8.0, geoeffnet: true, bilder: [] },
      { id: "l2", name: "Nah", latitude: 46.906, longitude: 7.406, geoeffnet: false, bilder: [] },
      { id: "l3", name: "Ohne", geoeffnet: null, bilder: [] },
    ];
    window.location.hash = "#/";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 300));
    return { distanzVorher: document.querySelectorAll(".entfernung").length, alle: document.querySelectorAll(".hofladen-karte").length };
  });
  check("Liste: ohne Tipp keine Entfernung, Standort nicht abgefragt", listeTest.distanzVorher === 0 && listeTest.alle === 3 && (await page.evaluate(() => window.__geoAufrufe6)) === 1);
  await page.click("#chip-offen");
  check("Liste: Chip «Geöffnet» filtert", (await page.$$(".hofladen-karte")).length === 1 && (await page.getAttribute("#chip-offen", "aria-pressed")) === "true");
  await page.click("#chip-offen");
  await page.click("#chip-naehe");
  await page.waitForTimeout(300);
  const namen = await page.$$eval(".hofladen-karte .name", (els) => els.map((e) => e.textContent.trim()));
  check(`Liste: «In der Nähe» sortiert nach Entfernung, ohne Koordinaten am Ende (${namen.join(",")})`, namen.join(",") === "Nah,Fern,Ohne" && (await page.$$(".entfernung")).length === 2 && (await page.$eval("#sort-spalte", (e) => e.value)) === "entfernung");
  await page.click("#chip-naehe");
  check("Liste: «In der Nähe» aus entfernt Entfernung und Sortierung", (await page.$$(".entfernung")).length === 0 && (await page.$eval("#sort-spalte", (e) => e.value)) === "name");
  await page.click("#chip-unvollstaendig");
  check("Liste: Chip «Unvollständig» filtert", (await page.$$(".hofladen-karte")).length === 3 && (await page.getAttribute("#chip-unvollstaendig", "aria-pressed")) === "true");
  await page.click("#chip-unvollstaendig");
  check("Liste: Filter-Chips sind mindestens 44px hoch", (await page.$eval("#chip-offen", (e) => e.getBoundingClientRect().height)) >= 44);

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

  // --- Phase 7 (Discovery): „Hofladen finden“ ---------------------------------
  // Logik ohne DOM
  const logik = await page.evaluate(async () => {
    const m = await import("/src/finden.js");
    const vorschlag = {
      daten: { name: "Hof A", adresse: "Weg 1", plz: "6000", ort: "Luzern", latitude: 47.05, longitude: 8.3, angebote: [{ name: "Eier" }] },
      quellen: [
        { feld: "name", quelle: "openstreetmap", status: "confirmed", url: "https://osm.example/1", lizenz: "ODbL" },
        { feld: "ort", quelle: "openstreetmap", status: "confirmed" },
        { feld: "angebote", quelle: "website", status: "confirmed", url: "javascript:alert(1)" },
      ],
      vermutungen: { angebote: ["Käse"], zahlungsarten: ["Twint"] },
    };
    const nurBelegt = m.baueEntwurf(vorschlag, { name: true, angebote: true, adresse: true });
    const mitVermutung = m.baueEntwurf(vorschlag, { name: true, "vermutung:zahlungsarten": true, "vermutung:angebote": true });
    return {
      belegtNamen: nurBelegt.daten.angebote.map((t) => t.name),
      belegtQuellen: nurBelegt.quellen.map((q) => q.feld).sort(),
      vermutetQuellen: mitVermutung.quellen.map((q) => `${q.feld}:${q.quelle}:${q.status}`).sort(),
      vermutetZahlung: mitVermutung.daten.zahlungsarten.map((t) => t.name),
      bereinigt: m.bereinigteQuellen(
        [{ feld: "name" }, { feld: "ort" }],
        { name: "Hof A", ort: "Luzern" },
        { name: "Hof A", ort: "Bern" }
      ).map((q) => q.feld),
    };
  });
  check("Entwurf: belegte Angebote übernommen, Vermutung nicht vorausgewählt", logik.belegtNamen.join() === "Eier");
  check("Entwurf: Herkunft nur für übernommene Felder", logik.belegtQuellen.join() === "angebote,name,ort");
  check("Entwurf: angehakte Vermutungen werden als ki/inferred markiert", logik.vermutetQuellen.includes("zahlungsarten:ki:inferred") && logik.vermutetQuellen.includes("angebote:ki:inferred"));
  check("Entwurf: vermutete Zahlungsart übernommen", logik.vermutetZahlung.join() === "Twint");
  check("Von Hand geändertes Feld verliert seine Herkunft", logik.bereinigt.join() === "name");

  // Oberfläche mit Fake-HA-Client
  await page.evaluate(() => {
    const app = window.hofkarteApp;
    window.__ereignisse = null;
    window.__gespeichert = null;
    window.__anreichernArgs = null;
    navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: 47.0502, longitude: 8.3093 } });
    app.haClient = {
      kiEntitaet: async () => null,
      hofladenSuchen: async () => [
        { refs: ["node/1"], name: '<img src=x onerror="window.__xss=1">Hof', latitude: 47.0502, longitude: 8.3093, entfernung_meter: 12, konfidenz: "hoch", signale: {}, typ: [] },
        { refs: ["node/2"], name: "Zweiter Hof", latitude: 47.06, longitude: 8.31, entfernung_meter: 900, konfidenz: "mittel", signale: {}, typ: [] },
      ],
      hofladenAnreichern: async (args, cb) => {
        window.__anreichernArgs = args;
        setTimeout(() => {
          cb({ phase: "osm", status: "ok" });
          cb({ phase: "website", status: "ok" });
          cb({
            phase: "fertig",
            vorschlag: {
              daten: { name: "Hof Eins", adresse: "Weg 1", plz: "6000", ort: "Luzern", website: "https://hof.example", angebote: [{ name: "Eier" }], latitude: 47.0502, longitude: 8.3093 },
              quellen: [
                { feld: "name", quelle: "openstreetmap", status: "confirmed", url: "https://www.openstreetmap.org/node/1", lizenz: "ODbL" },
                { feld: "ort", quelle: "openstreetmap", status: "confirmed" },
                { feld: "angebote", quelle: "website", status: "confirmed", url: "https://hof.example" },
              ],
              abweichungen: {},
              vermutungen: { zahlungsarten: ["Twint"] },
            },
          });
        }, 20);
        return () => {};
      },
    };
    app.speichereHofladen = async (d) => {
      window.__gespeichert = d;
      return { ...d, id: "neu1" };
    };
    app.offlineModus = false;
    window.location.hash = "#/neu";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  check("Editor (neu) zeigt Button „Hofladen finden“", !!(await page.$("#finden-btn")));
  await page.click("#finden-btn");
  await page.waitForTimeout(400);
  check("Finden: Standort wird nicht von selbst abgefragt", (await page.$eval('[data-feld="latitude"]', (el) => el.value)) === "");
  await page.click("[data-standort]");
  await page.waitForTimeout(400);
  check("Finden: Gerätestandort wird nach Tipp übernommen", (await page.$eval('[data-feld="latitude"]', (el) => el.value)) === "47.050200");
  check("Finden: Umkreis-Standard 2 km, Maximum 5 km", (await page.$eval("[data-radius]", (el) => `${el.value}/${el.max}`)) === "2000/5000");
  check("Finden: KI-Hinweis statt Checkbox, wenn keine Entität gewählt", !!(await page.$("[data-ki-hinweis]")) && !(await page.$("[data-ki]")));
  await page.click("[data-suchen]");
  await page.waitForTimeout(300);
  check("Finden: zwei Treffer, erster (hohe Sicherheit) vorgewählt", (await page.$$("[data-kandidat]")).length === 2 && (await page.$eval('[data-kandidat][value="0"]', (el) => el.checked)));
  check("Finden: Treffername wird maskiert (kein XSS)", !(await page.evaluate(() => window.__xss)) && !(await page.$(".finden img")));
  const radioBreite = await page.$eval('[data-kandidat][value="0"]', (el) => el.getBoundingClientRect().width);
  check(`Finden: Radiobutton nicht auf volle Breite gezogen (${Math.round(radioBreite)}px)`, radioBreite < 40);
  await page.click("[data-weiter]");
  await page.waitForTimeout(400);
  check("Finden: Anreicherung ohne KI-Anforderung gestartet", (await page.evaluate(() => window.__anreichernArgs?.ki !== true && window.__anreichernArgs?.kandidat?.refs?.[0] === 'node/1')));
  check("Finden: Angaben mit Herkunft angezeigt", (await page.$$("[data-feldwahl]")).length >= 4 && (await page.content()).includes("OpenStreetMap-Mitwirkende"));
  check("Finden: KI-Vermutung ist nicht vorausgewählt", !(await page.$eval('[data-feldwahl="vermutung:zahlungsarten"]', (el) => el.checked)));
  await page.click("[data-uebernehmen]");
  await page.waitForTimeout(400);
  check("Übernahme öffnet Editor mit vorbelegten Feldern", (await page.$eval("#f-name", (el) => el.value)) === "Hof Eins" && (await page.$eval("#f-angebote", (el) => el.value)) === "Eier");
  check("Vermutete Zahlungsart wurde nicht übernommen", (await page.$eval("#f-zahlungsarten", (el) => el.value)) === "");
  await page.fill("#f-ort", "Bern");
  await page.click("#speichern-btn");
  await page.waitForTimeout(300);
  const gespeichert = await page.evaluate(() => window.__gespeichert);
  check("Speichern sendet Herkunft nur für unveränderte Felder", !!gespeichert && gespeichert.quellen.map((q) => q.feld).sort().join() === "angebote,name");
  // Roundtrip: unveränderter Hofladen wird mit demselben Inhalt gespeichert wie vor dem Umbau.
  await page.evaluate(() => {
    const app = window.hofkarteApp;
    app.state.hoflaeden = [{
      id: "rt1", version: 3, name: "Roundtrip-Hof", beschreibung: "Text", bemerkung: "intern", adresse: "Dorfstrasse 1", plz: "3000", ort: "Bern", land: "Schweiz",
      website: "https://rt.example", mobilnummer: "079 111 22 33", email: "a@b.ch", latitude: 46.9, longitude: 7.4, bewertung: 4,
      oeffnungszeiten: [{ wochentag: 2, beginn: "08:00", ende: "12:00" }, { wochentag: 2, beginn: "14:00", ende: "18:00" }],
      angebote: [{ id: "a1", name: "Eier" }, { id: "a2", name: "Honig" }], zahlungsarten: [{ id: "z1", name: "Bargeld" }],
      bilder: [{ url: "https://x.example/b.jpg", beschreibung: "Bild", hochgeladen: false }], quellen: [],
    }];
    window.__gespeichert = null;
    window.location.hash = "#/hofladen/rt1/bearbeiten";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  if (process.env.SCREENSHOT_DIR) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/editor.png` });
    await page.click("#alle-btn");
    await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/editor-alle.png`, fullPage: true });
    await page.click("#alle-btn");
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  check("Roundtrip: unveränderter Editor zeigt kein «Ungespeichert»", (await page.$eval("#ungespeichert", (el) => el.hidden)) === true && !(await page.isVisible("#ungespeichert")));
  await page.click("#speichern-btn");
  await page.waitForTimeout(300);
  const rt = await page.evaluate(() => window.__gespeichert);
  const rtOk = !!rt && rt.id === "rt1" && rt.version === 3 && rt.name === "Roundtrip-Hof" && rt.bemerkung === "intern" && rt.plz === "3000" && rt.latitude === 46.9 && rt.longitude === 7.4 && rt.bewertung === 4
    && JSON.stringify(rt.oeffnungszeiten) === JSON.stringify([{ wochentag: 2, beginn: "08:00", ende: "12:00" }, { wochentag: 2, beginn: "14:00", ende: "18:00" }])
    && rt.angebote.map((a) => a.name).join() === "Eier,Honig" && rt.zahlungsarten.map((z) => z.name).join() === "Bargeld"
    && rt.bilder.length === 1 && rt.bilder[0].beschreibung === "Bild";
  check("Roundtrip: gleiches Payload wie vor dem Umbau", rtOk);

  // --- 2.0.0-dev.4: Erfassen (Einstieg, Vor Ort, Schnell, Gespeichert) ------------
  const gehe = async (hash) => {
    await page.evaluate((h) => {
      window.location.hash = h;
      window.dispatchEvent(new Event("hashchange"));
    }, hash);
    await page.waitForTimeout(250);
  };
  await page.evaluate(() => {
    window.__geoAufrufe = 0;
    window.__geoModus = "ok";
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (ok, fehler) => {
          window.__geoAufrufe++;
          if (window.__geoModus === "verweigert") fehler({ code: 1 });
          else ok({ coords: { latitude: 46.9482, longitude: 7.4475, accuracy: 20 } });
        },
      },
    });
    const app = window.hofkarteApp;
    app.offlineModus = false;
    app.state.hoflaeden = [
      { id: "n1", name: "Hof Nah", latitude: 46.9481, longitude: 7.4474, geoeffnet: true, bilder: [] },
      { id: "n2", name: "Hof Fern", latitude: 47.5, longitude: 8.5, geoeffnet: false, bilder: [] },
    ];
    window.__erfPayload = null;
    app.speichereHofladen = async (d) => {
      window.__erfPayload = d;
      const neu = { ...d, id: "erf1" };
      app.state.hoflaeden.push(neu);
      return neu;
    };
    app.haClient = {
      hofladenSuchen: async () => [
        { name: "Hof Nah", latitude: 46.9481, longitude: 7.4474, konfidenz: "hoch", entfernung_meter: 12, signale: {} },
        { name: "Beerenhof Aebi", latitude: 46.9495, longitude: 7.4490, adresse: "Dorfweg 3", plz: "3000", ort: "Bern", konfidenz: "mittel", entfernung_meter: 60, signale: {} },
      ],
    };
  });
  await gehe("#/erfassen");
  check("Erfassen: Einstieg zeigt drei Wege", (await page.$$(".weg-karte")).length === 3 && !!(await page.$("#weg-vorort")) && !!(await page.$("#weg-webseite")) && !!(await page.$("#weg-hand")));
  check("Erfassen: Tab heisst «Erfassen» und ist aktiv", (await page.$eval("[data-tab='erfassen']", (el) => el.textContent.trim() === "Erfassen" && el.getAttribute("aria-current") === "page")));
  if (process.env.SCREENSHOT_DIR) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/e1.png`, fullPage: true }); await page.setViewportSize({ width: 1280, height: 720 }); }
  check("Erfassen: «Erweiterte Suche» bleibt erreichbar", (await page.$eval("#erweiterte-suche-link", (el) => el.getAttribute("href"))) === "#/finden");
  await page.click("#weg-vorort");
  await page.waitForTimeout(250);
  check("Vor Ort: Standort wird nicht ohne Tipp abgefragt", (await page.evaluate(() => window.__geoAufrufe)) === 0);
  check("Vor Ort: Umkreis-Chips 100/250/500 (250 gewählt)", (await page.$$eval("[data-radius]", (els) => els.map((e) => e.dataset.radius + ":" + e.getAttribute("aria-pressed")).join())) === "100:false,250:true,500:false");
  await page.click("#standort-btn");
  await page.waitForSelector("#osm-treffer", { timeout: 5000 });
  check("Vor Ort: Standort erst nach Tipp abgefragt", (await page.evaluate(() => window.__geoAufrufe)) >= 1);
  check("Vor Ort: «Schon erfasst» zeigt nur den nahen Hof", (await page.$$eval("#schon-erfasst [data-erfasst]", (els) => els.map((e) => e.dataset.erfasst).join())) === "n1");
  check("Vor Ort: schon erfasste Treffer erscheinen nicht noch einmal als neu", (await page.$$eval("#osm-treffer .treffer-zeile strong", (els) => els.map((e) => e.textContent).join())) === "Beerenhof Aebi");
  check("Vor Ort: Standort wird nicht gespeichert", !(await page.evaluate(() => JSON.stringify(localStorage) + document.cookie)).includes("46.9482") && !(await page.evaluate(async () => JSON.stringify(await (await import("/src/storage.js")).ladeVerbindung())).catch(() => "")).includes("46.9482"));
  await page.click("[data-radius='100']");
  await page.waitForTimeout(200);
  if (process.env.SCREENSHOT_DIR) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/e2.png`, fullPage: true }); await page.setViewportSize({ width: 1280, height: 720 }); }
  check("Vor Ort: Umkreis-Wechsel wird übernommen", (await page.$eval("[data-radius='100']", (el) => el.getAttribute("aria-pressed"))) === "true");
  check("Vor Ort: Knöpfe mindestens 44px", (await page.$eval(".treffer-btn", (el) => el.getBoundingClientRect().height)) >= 44 && (await page.$eval("#keiner-btn", (el) => el.getBoundingClientRect().height)) >= 44);
  await page.click("[data-kandidat='0']");
  await page.waitForTimeout(250);
  if (process.env.SCREENSHOT_DIR) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/e3.png`, fullPage: true }); await page.setViewportSize({ width: 1280, height: 720 }); }
  check("Schnell: Angaben des Treffers sind eingetragen", (await page.$eval("#s-name", (el) => el.value)) === "Beerenhof Aebi" && (await page.$eval("#s-standort-text", (el) => el.textContent)).includes("46.94950"));
  await page.fill("#s-name", "");
  await page.click("#s-speichern-btn");
  await page.waitForTimeout(150);
  check("Schnell: Name ist Pflicht (Fehler, Fokus)", (await page.evaluate(() => document.activeElement?.id)) === "s-name" && (await page.$eval("#s-name-fehler", (el) => !el.hidden)) && (await page.evaluate(() => window.__erfPayload)) === null);
  await page.fill("#s-name", "Hof Nah");
  let doppelFrage = 0;
  page.once("dialog", (d) => { doppelFrage++; d.dismiss(); });
  await page.click("#s-speichern-btn");
  await page.waitForTimeout(200);
  check("Schnell: Duplikatwarnung vor dem Speichern, bei «Abbrechen» wird nichts gespeichert", doppelFrage === 1 && (await page.evaluate(() => window.__erfPayload)) === null);
  await page.fill("#s-name", "Beerenhof Aebi");
  await page.click("#s-speichern-btn");
  await page.waitForTimeout(300);
  const erf = await page.evaluate(() => window.__erfPayload);
  check("Schnell: Speichern sendet Name, Koordinaten und Herkunft aus OpenStreetMap", !!erf && erf.name === "Beerenhof Aebi" && erf.latitude === 46.9495 && erf.plz === "3000" && erf.quellen.some((q) => q.feld === "name" && q.quelle === "openstreetmap"));
  if (process.env.SCREENSHOT_DIR) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/e4.png`, fullPage: true }); await page.setViewportSize({ width: 1280, height: 720 }); }
  check("Gespeichert: Seite mit «Noch offen»", !!(await page.$("#noch-offen")) && (await page.$eval("#gespeichert-name", (el) => el.textContent)) === "Beerenhof Aebi");
  await page.click("[data-gruppe='kontakt']");
  await page.waitForTimeout(250);
  check("Gespeichert: «Ergänzen» öffnet den Editor mit der gewünschten Gruppe", !!(await page.$("#editor-form")) && (await page.$eval("#gruppe-kontakt", (el) => el.open)));
  // Ohne Standortfreigabe: Fehlermeldung, Erfassen bleibt möglich.
  await page.evaluate(() => { window.__geoModus = "verweigert"; });
  await gehe("#/erfassen/vorort");
  await page.evaluate(() => { window.hofkarteApp.state.hoflaeden = []; });
  await page.click("#standort-btn");
  await page.waitForTimeout(500);
  check("Vor Ort: verweigerter Standort zeigt Hinweis und lässt «Ohne Standort erfassen» zu", (await page.$eval("#standort-status", (el) => el.textContent.length > 10)) && !!(await page.$("#keiner-btn")));
  await page.evaluate(() => { window.hofkarteApp.haClient = null; window.hofkarteApp.offlineModus = true; });
  await page.click("#keiner-btn");
  await page.waitForTimeout(250);
  check("Schnell: ohne Verbindung ist der Foto-Upload gesperrt mit Hinweis «Foto später ergänzen»", (await page.$eval("#s-foto-kamera-btn", (el) => el.disabled)) && (await page.$eval("#s-foto-status", (el) => el.textContent)).includes("Foto später ergänzen"));
  await page.fill("#s-name", "Offline-Hof");
  await page.click("#s-speichern-btn");
  await page.waitForTimeout(300);
  check("Schnell: Erfassen ohne Verbindung und ohne Standort funktioniert", (await page.evaluate(() => window.__erfPayload?.name)) === "Offline-Hof" && !!(await page.$("#noch-offen")));
  check("Gespeichert: fehlendes Foto wird als «Foto später ergänzen» angezeigt", (await page.$eval("#noch-offen", (el) => el.textContent)).includes("Foto später ergänzen"));
  await page.evaluate(() => { delete window.hofkarteApp.speichereHofladen; });

  // --- 2.0.0-dev.5: Webseite auslesen und Angaben ergänzen -------------------------
  const erg = await page.evaluate(async () => {
    const e = await import("/src/ergaenzen.js");
    const h = {
      name: "Hof A", mobilnummer: "079 1", adresse: "Dorf 1", website: "https://a.ch", latitude: 46.9, longitude: 7.4,
      angebote: [{ id: "a1", name: "Eier" }], zahlungsarten: [{ id: "z1", name: "Bargeld" }], oeffnungszeiten: [],
      quellen: [{ feld: "name", quelle: "angabe", status: "confirmed" }],
    };
    const v = {
      daten: {
        name: "Hof A GmbH", mobilnummer: "079 1", email: "a@b.ch", adresse: "Dorf 1", plz: "3000", latitude: 46.90001, longitude: 7.4,
        angebote: ["Eier", "Honig"], zahlungsarten: ["Bargeld"], oeffnungszeiten: [{ wochentag: 1, beginn: "08:00:00", ende: "12:00:00" }],
      },
      quellen: [{ feld: "email", quelle: "website", status: "confirmed", url: "https://a.ch" }, { feld: "plz", quelle: "website", status: "confirmed" }, { feld: "angebote", quelle: "website", status: "confirmed" }, { feld: "name", quelle: "website", status: "confirmed" }],
      abweichungen: {},
      vermutungen: { zahlungsarten: ["Twint", "Bargeld"] },
    };
    const vg = e.vergleiche(h, v);
    const status = Object.fromEntries(vg.zeilen.map((z) => [z.key, z.status]));
    const wahl = e.vorauswahl(vg);
    const e1 = e.baueErgaenzung(h, v, vg, wahl);
    const e2 = e.baueErgaenzung(h, v, vg, { ...wahl, name: true, "vermutung:zahlungsarten": true });
    const neuVg = e.vergleiche({}, v);
    return {
      status, wahl, vermutungen: vg.vermutungen.map((m) => m.neu.join()),
      d1: { email: e1.daten.email, plz: e1.daten.plz, adresse: e1.daten.adresse, name: e1.daten.name, angebote: e1.daten.angebote.map((a) => a.name).join(), oz: e1.daten.oeffnungszeiten.length, zahlung: e1.daten.zahlungsarten, quellen: e1.quellen.map((q) => q.feld).sort().join(), geaendert: e1.geaendert.join() },
      d2: { name: e2.daten.name, zahlung: e2.daten.zahlungsarten.map((z) => z.name).join(), quellen: e2.quellen.map((q) => q.feld + ":" + q.quelle).sort().join() },
      neuAlleVorgewaehlt: neuVg.zeilen.every((z) => z.vorgewaehlt && z.status === "luecke"),
    };
  });
  check("Ergänzen: Status je Zeile (Lücke, Ergänzung, gleich, Abweichung)", erg.status.name === "abweichung" && erg.status.mobilnummer === "gleich" && erg.status.email === "luecke" && erg.status.adresse === "luecke" && erg.status.angebote === "ergaenzen" && erg.status.zahlungsarten === "gleich" && erg.status.oeffnungszeiten === "luecke" && erg.status.koordinaten === "gleich");
  check("Ergänzen: Lücken vorgewählt, Abweichungen und KI-Vermutungen nie", erg.wahl.email === true && erg.wahl.adresse === true && erg.wahl.angebote === true && erg.wahl.oeffnungszeiten === true && erg.wahl.name === false && erg.wahl["vermutung:zahlungsarten"] === false);
  check("Ergänzen: nur neue Vermutungen werden angeboten", erg.vermutungen.join() === "Twint");
  check("Ergänzen: Vorauswahl überschreibt nichts (Name, Adresse bleiben), füllt nur Lücken", erg.d1.name === undefined && erg.d1.adresse === undefined && erg.d1.email === "a@b.ch" && erg.d1.plz === "3000" && erg.d1.oz === 1);
  check("Ergänzen: Listen werden ergänzt, nicht ersetzt", erg.d1.angebote === "Eier,Honig" && erg.d1.zahlung === undefined);
  check("Ergänzen: Herkunft nur für neu gefüllte Felder, alte bleibt", erg.d1.quellen === "email,name,plz" && erg.d1.geaendert.includes("E-Mail"));
  check("Ergänzen: nach ausdrücklicher Wahl wird ersetzt, Vermutung als KI markiert", erg.d2.name === "Hof A GmbH" && erg.d2.zahlung === "Bargeld,Twint" && erg.d2.quellen.includes("name:website"));
  check("Ergänzen: bei einem neuen Hofladen ist alles Gefundene eine Lücke und vorgewählt", erg.neuAlleVorgewaehlt);

  await page.evaluate(() => {
    const app = window.hofkarteApp;
    app.offlineModus = false;
    app.state.hoflaeden = [{ id: "erg1", version: 2, name: "Hof A", mobilnummer: "079 1", adresse: "Dorf 1", website: "https://a.ch", latitude: 46.9, longitude: 7.4, angebote: [{ id: "a1", name: "Eier" }], zahlungsarten: [], oeffnungszeiten: [], bilder: [], bewertung: 0, quellen: [] }];
    window.__anreichern = null;
    window.__gespeichertErg = null;
    app.speichereHofladen = async (d) => { window.__gespeichertErg = d; return { ...d, id: d.id || "neu-erg" }; };
    app.haClient = {
      kiEntitaet: async () => "ai_task.test",
      hofladenAnreichern: async (args, cb) => {
        window.__anreichern = args;
        setTimeout(() => {
          cb({ phase: "website", status: "ok" });
          cb({
            phase: "fertig",
            vorschlag: {
              daten: { name: "<img src=x onerror=window.__xss2=1>", email: "a@b.ch", plz: "3000", adresse: "Dorf 1", angebote: ["Eier", "Honig"], mobilnummer: "079 1", oeffnungszeiten: [{ wochentag: 1, beginn: "08:00", ende: "12:00" }] },
              quellen: [{ feld: "email", quelle: "website", status: "confirmed", url: "https://a.ch" }, { feld: "plz", quelle: "website", status: "confirmed" }, { feld: "oeffnungszeiten", quelle: "website", status: "confirmed" }],
              abweichungen: {},
              vermutungen: { zahlungsarten: ["Twint"] },
            },
          });
        }, 20);
        return () => {};
      },
    };
  });
  await gehe("#/hofladen/erg1/ergaenzen");
  await page.waitForTimeout(200);
  check("Ergänzen: Webseite des Hofladens ist vorbelegt, KI nie vorgewählt", (await page.$eval("#a-website", (el) => el.value)) === "https://a.ch" && (await page.$eval("#a-ki", (el) => el.checked)) === false);
  check("Ergänzen: Fenster hat Zurück zum Hofladen", !!(await page.$("#zurueck-btn")));
  await page.click("#a-start-btn");
  await page.waitForSelector("#a-uebernehmen-btn", { timeout: 4000 });
  check("Ergänzen: Auslesen ohne KI angefordert, nur mit der eingetragenen Webseite", (await page.evaluate(() => window.__anreichern)).website === "https://a.ch" && (await page.evaluate(() => window.__anreichern)).ki === false);
  check("Ergänzen: Name wird maskiert (kein XSS)", !(await page.$(".auslesen img")) && !(await page.evaluate(() => window.__xss2)));
  const wahlUi = await page.$$eval("[data-feldwahl]", (els) => Object.fromEntries(els.map((e) => [e.dataset.feldwahl, e.checked])));
  check("Ergänzen: Oberfläche wählt Lücken vor, Abweichung und Vermutung nicht", wahlUi.email === true && wahlUi.angebote === true && wahlUi.name === false && wahlUi["vermutung:zahlungsarten"] === false);
  check("Ergänzen: Zeile mit Status als Text (nicht nur Farbe)", (await page.$eval("[data-zeile='email'] .status-chip", (el) => el.textContent)).includes("Fehlt noch") && (await page.$eval("[data-zeile='name'] .status-chip", (el) => el.textContent)).includes("Weicht ab"));
  check("Ergänzen: gleiche Angaben haben keine Auswahl", !(await page.$("[data-zeile='mobilnummer'] input")));
  check("Ergänzen: Aktuell und Gefunden werden gegenübergestellt", (await page.$eval("[data-zeile='angebote']", (el) => el.textContent)).includes("Aktuell: Eier") && (await page.$eval("[data-zeile='angebote']", (el) => el.textContent)).includes("Neu: Honig"));
  check("Ergänzen: Auswahl-Kästchen mindestens 24px", (await page.$eval("[data-feldwahl='email']", (el) => el.getBoundingClientRect().width)) >= 24);
  if (process.env.SCREENSHOT_DIR) { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/p5.png`, fullPage: true }); await page.setViewportSize({ width: 1280, height: 720 }); }
  await page.click("#a-uebernehmen-btn");
  await page.waitForSelector("#editor-form", { timeout: 4000 });
  await page.waitForTimeout(200);
  check("Ergänzen: Editor zeigt ergänzte Angaben, Bestehendes unverändert", (await page.$eval("#f-email", (el) => el.value)) === "a@b.ch" && (await page.$eval("#f-plz", (el) => el.value)) === "3000" && (await page.$eval("#f-adresse", (el) => el.value)) === "Dorf 1" && (await page.$eval("#f-name", (el) => el.value)) === "Hof A");
  check("Ergänzen: Angebote ergänzt, Öffnungszeiten übernommen, «Ungespeichert» sichtbar", (await page.$eval("#f-angebote", (el) => el.value)) === "Eier, Honig" && (await page.$$(".oeffnungszeit-zeile")).length === 1 && (await page.isVisible("#ungespeichert")));
  check("Ergänzen: noch nichts gespeichert", (await page.evaluate(() => window.__gespeichertErg)) === null);
  await page.click("#speichern-btn");
  await page.waitForTimeout(250);
  const ergPayload = await page.evaluate(() => window.__gespeichertErg);
  check("Ergänzen: Speichern sendet ergänzte Angaben samt Herkunft, Version bleibt", !!ergPayload && ergPayload.id === "erg1" && ergPayload.version === 2 && ergPayload.email === "a@b.ch" && ergPayload.quellen.some((q) => q.feld === "email" && q.quelle === "website") && ergPayload.name === "Hof A");

  // 2.0.0-dev.8: «Mit OpenStreetMap ergänzen» (am gespeicherten Standort).
  await page.evaluate(() => {
    const app = window.hofkarteApp;
    window.__suche = null;
    window.__anreichern = null;
    window.__geoVorOsm = window.__geoAufrufe;
    const alt = app.haClient;
    window.__haClientAlt = alt;
    app.haClient = {
      ...alt,
      hofladenSuchen: async (args) => { window.__suche = args; return [{ name: "<b>Hof A OSM</b>", konfidenz: "hoch", adresse: "Dorf 1", plz: "3000", ort: "Bern", osm_id: 7, osm_typ: "node", latitude: 46.9, longitude: 7.4 }, { name: "Anderer Hof", konfidenz: "niedrig" }]; },
      hofladenAnreichern: async (args, cb) => {
        window.__anreichern = args;
        setTimeout(() => cb({ phase: "fertig", vorschlag: { daten: { email: "osm@hof.ch" }, quellen: [{ feld: "email", quelle: "openstreetmap", status: "confirmed" }], abweichungen: {}, vermutungen: {} } }), 20);
        return () => {};
      },
    };
  });
  await gehe("#/hofladen/erg1/ergaenzen");
  await page.waitForTimeout(200);
  check("OSM-Ergänzen: Quellenwahl, Webseite vorgewählt, OpenStreetMap wählbar", (await page.getAttribute("#a-quelle-web", "aria-pressed")) === "true" && (await page.getAttribute("#a-quelle-osm", "aria-pressed")) === "false" && !(await page.$eval("#a-quelle-osm", (el) => el.disabled)));
  await page.click("#a-quelle-web");
  await page.click("#a-start-btn");
  await page.waitForTimeout(150);
  check("OSM-Ergänzen: ohne Quelle eine Meldung, keine Suche", /Quelle/.test(await page.$eval(".auslesen", (el) => el.textContent)) && (await page.evaluate(() => window.__suche)) === null);
  await page.click("#a-quelle-osm");
  await page.click("#a-start-btn");
  await page.waitForSelector("#a-treffer-weiter-btn", { timeout: 4000 });
  const suche = await page.evaluate(() => window.__suche);
  check("OSM-Ergänzen: Suche am gespeicherten Standort (300 m, Name), ohne Geräte-Standort", suche.latitude === 46.9 && suche.longitude === 7.4 && suche.radius === 300 && suche.name === "Hof A" && (await page.evaluate(() => window.__geoAufrufe === window.__geoVorOsm)));
  check("OSM-Ergänzen: Treffer als Text (kein HTML), sicherer Treffer vorgewählt", (await page.$$("[data-a-kandidat]")).length === 2 && (await page.$eval("[data-a-kandidat][value='0']", (el) => el.checked)) && !(await page.$(".auslesen b")));
  await page.click("#a-treffer-weiter-btn");
  await page.waitForSelector("#a-uebernehmen-btn", { timeout: 4000 });
  const osmArgs = await page.evaluate(() => window.__anreichern);
  check("OSM-Ergänzen: Anreichern mit gewähltem Treffer, ohne Webseite und KI", osmArgs.kandidat.osm_id === 7 && !osmArgs.website && osmArgs.ki === false);
  check("OSM-Ergänzen: Vorschlag wird wie bisher verglichen (Lücke E-Mail vorgewählt)", (await page.$eval("[data-feldwahl='email']", (el) => el.checked)) === true);
  await page.evaluate(() => { window.hofkarteApp.haClient = window.__haClientAlt; });

  // Neuer Hofladen aus der Webseite
  await page.evaluate(() => { window.hofkarteApp.state.hoflaeden = []; window.__gespeichertErg = null; });
  await gehe("#/erfassen/webseite");
  await page.fill("#a-website", "neu.example.ch");
  await page.click("#a-start-btn");
  await page.waitForSelector("#a-uebernehmen-btn", { timeout: 4000 });
  const fokusSchritt = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim() }));
  check(`Zugänglichkeit: nach Schrittwechsel Fokus auf «Angaben prüfen» (${fokusSchritt.text})`, fokusSchritt.tag === "H2" && fokusSchritt.text === "Angaben prüfen");
  check("Webseite: Adresse ohne https:// wird ergänzt", (await page.evaluate(() => window.__anreichern)).website === "https://neu.example.ch");
  check("Webseite: bei neuem Hofladen sind alle Angaben vorgewählt, KI-Vermutung nicht", (await page.$$eval("[data-feldwahl]:not([data-feldwahl^='vermutung'])", (els) => els.every((e) => e.checked))) && (await page.$eval("[data-feldwahl='vermutung:zahlungsarten']", (el) => el.checked)) === false);
  await page.click("#a-uebernehmen-btn");
  await page.waitForSelector("#editor-form", { timeout: 4000 });
  await page.waitForTimeout(200);
  check("Webseite: Übernahme öffnet das Formular mit den Angaben und der Webseite", (await page.$eval("#f-email", (el) => el.value)) === "a@b.ch" && (await page.$eval("#f-website", (el) => el.value)) === "https://neu.example.ch" && (await page.isVisible("#ungespeichert")));
  await page.evaluate(() => { window.hofkarteApp.haClient = null; window.hofkarteApp.offlineModus = true; });
  await gehe("#/erfassen/webseite");
  check("Webseite: ohne Verbindung ist «Auslesen» gesperrt", (await page.$eval("#a-start-btn", (el) => el.disabled)) === true);
  await page.evaluate(() => { delete window.hofkarteApp.speichereHofladen; });
  await page.evaluate(() => {
    const app = window.hofkarteApp;
    app.haClient = null;
    app.offlineModus = true;
    delete app.speichereHofladen;
    app.state.hoflaeden = [
      { id: "h2", name: "Mit Herkunft", bilder: [], quellen: [
        { feld: "name", quelle: "openstreetmap", status: "confirmed", url: "https://www.openstreetmap.org/node/1" },
        { feld: "angebote", quelle: "ki", status: "inferred" },
        { feld: "website", quelle: "website", status: "confirmed", url: "javascript:alert(1)" },
      ] },
    ];
    window.location.hash = "#/hofladen/h2";
    window.dispatchEvent(new Event("hashchange"));
  });
  await page.waitForTimeout(300);
  const herkunft = await page.evaluate(() => document.querySelector(".inhalt")?.textContent || "");
  check("Detail zeigt „Herkunft der Angaben“ inkl. Vermutung", herkunft.includes("Herkunft der Angaben") && herkunft.includes("vermutet"));
  check("Detail: unsichere Quellen-URL wird nicht verlinkt", !(await page.$('a[href^="javascript:"]')));
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

  // --- 2.0.0-dev.4: Update-Funktion ----------------------------------------------
  await page.waitForTimeout(500);
  check("Update: Einstellungen zeigen die neueste Version und «aktuell»", (await page.$eval("#neueste-version", (el) => el.textContent.trim())) === angezeigteVersion && (await page.$eval("#update-status", (el) => el.textContent)).includes("neueste Version"));
  check("Update: Knopf «Nach Update suchen» und «App zurücksetzen» vorhanden", !!(await page.$("#update-suchen-btn")) && !!(await page.$("#app-zuruecksetzen-btn")));
  const upd = await page.evaluate(async () => {
    const u = await import("/src/update.js");
    return {
      a: u.vergleicheVersionen("2.0.0-dev.3", "2.0.0-dev.4"),
      b: u.vergleicheVersionen("2.0.0-dev.9", "2.0.0-rc.1"),
      c: u.vergleicheVersionen("2.0.0-rc.2", "2.0.0"),
      d: u.vergleicheVersionen("1.12.0", "2.0.0-dev.1"),
      e: u.vergleicheVersionen("2.0.0", "2.0.0"),
      f: u.vergleicheVersionen("2.0.1", "2.0.0"),
      g: u.versionAusText('export const APP_VERSION = "2.0.0-dev.4";'),
    };
  });
  check("Update: Versionsvergleich (dev < rc < Endversion)", upd.a === -1 && upd.b === -1 && upd.c === -1 && upd.d === -1 && upd.e === 0 && upd.f === 1);
  check("Update: Version wird aus version.js gelesen", upd.g === "2.0.0-dev.4");
  await page.evaluate(async () => (await import("/src/update.js")).zeigeUpdateHinweis());
  await page.evaluate(async () => (await import("/src/update.js")).zeigeUpdateHinweis());
  check("Update: Hinweis «Neue Version verfügbar» erscheint genau einmal, Knopf ≥ 44px", (await page.$$("#update-hinweis")).length === 1 && (await page.$eval("#update-jetzt-btn", (el) => el.getBoundingClientRect().height)) >= 44);
  await page.evaluate(() => document.getElementById("update-hinweis")?.remove());



  // 2.0.0-dev.8: Adresse aus Koordinaten (Nominatim).
  let nominatimAnfragen = [];
  await page.route("https://nominatim.openstreetmap.org/**", (route) => {
    nominatimAnfragen.push(route.request().url());
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ osm_type: "way", osm_id: 42, address: { road: "Dorfstrasse", house_number: "5", postcode: "3000", village: "Muri bei Bern", country: "Schweiz" } }) });
  });
  await page.evaluate(() => { const a = window.hofkarteApp; a.haClient = a.haClient || null; });
  await gehe("#/neu");
  await page.evaluate(() => { document.querySelector("#gruppe-adresse").open = true; });
  await page.fill("#f-plz", "9999");
  await page.fill("#f-latitude", "");
  await page.fill("#f-longitude", "");
  await page.click("#adresse-ermitteln-btn");
  await page.waitForTimeout(200);
  check("Adresse: ohne Koordinaten Hinweis, keine Anfrage", /Koordinaten/.test(await page.$eval("#adresse-vorschlag", (el) => el.textContent)) && nominatimAnfragen.length === 0);
  await page.fill("#f-latitude", "46.9481");
  await page.fill("#f-longitude", "7.4474");
  check("Adresse: keine Anfrage ohne Tipp", nominatimAnfragen.length === 0);
  await page.click("#adresse-ermitteln-btn");
  await page.waitForSelector("#adresse-uebernehmen-btn", { timeout: 4000 });
  check("Adresse: genau eine Anfrage mit Koordinaten, ohne weitere Daten", nominatimAnfragen.length === 1 && /lat=46\.9481/.test(nominatimAnfragen[0]) && /lon=7\.4474/.test(nominatimAnfragen[0]) && !/9999|name/.test(nominatimAnfragen[0]));
  check("Adresse: Lücken (Adresse, Ort) vorgewählt, Abweichung (PLZ) nicht", (await page.$eval("[data-adr='adresse']", (el) => el.checked)) && (await page.$eval("[data-adr='ort']", (el) => el.checked)) && (await page.$eval("[data-adr='plz']", (el) => el.checked)) === false);
  check("Adresse: nichts ist übernommen, bevor «Übernehmen» getippt wird", (await page.$eval("#f-adresse", (el) => el.value)) === "" && (await page.$eval("#f-plz", (el) => el.value)) === "9999");
  await page.click("#adresse-uebernehmen-btn");
  check("Adresse: übernommen wird nur das Gewählte (PLZ bleibt)", (await page.$eval("#f-adresse", (el) => el.value)) === "Dorfstrasse 5" && (await page.$eval("#f-ort", (el) => el.value)) === "Muri bei Bern" && (await page.$eval("#f-plz", (el) => el.value)) === "9999");
  await page.unroute("https://nominatim.openstreetmap.org/**");
  await page.route("https://nominatim.openstreetmap.org/**", (route) => route.abort());
  await page.click("#adresse-ermitteln-btn");
  await page.waitForTimeout(300);
  check("Adresse: ohne Verbindung eine verständliche Meldung", /Keine Verbindung zu OpenStreetMap/.test(await page.$eval("#adresse-vorschlag", (el) => el.textContent)));
  await page.unroute("https://nominatim.openstreetmap.org/**");
  const adr = await page.evaluate(async () => {
    const m = await import("/src/adresse.js");
    return {
      ort: m.adresseAusAntwort({ address: { road: "A", house_number: "1", town: "T", postcode: "1" } }).ort,
      leer: m.adresseAusAntwort({ address: {} }),
      komma: m.gueltigeKoordinaten("46,9", "7,4"),
      falsch: m.gueltigeKoordinaten("91", "7"),
      gleich: m.vergleicheAdresse({ adresse: "Dorfstrasse 5" }, { adresse: " dorfstrasse  5 " })[0].status,
    };
  });
  check("Adresse: Logik (Ort-Fallback, leer, Komma, Bereich, Vergleich)", adr.ort === "T" && adr.leer === null && adr.komma.latitude === 46.9 && adr.falsch === null && adr.gleich === "gleich");


  // 2.0.0-dev.8: 24h-Automat.
  await page.evaluate(() => {
    const a = window.hofkarteApp;
    a.state.hoflaeden = [{ id: "au1", version: 1, name: "Automat Eins", automat_24h: true, geoeffnet: true, oeffnungszeiten: [], sonderoeffnungszeiten: [{ datum_von: "2026-01-01", datum_bis: "2026-01-02", geschlossen: true }], bilder: [], angebote: [], zahlungsarten: [], bewertung: 0 }];
    window.__gespeichertAutomat = null;
    a.speichereHofladen = async (d) => { window.__gespeichertAutomat = d; return { ...d }; };
  });
  await gehe("#/hofladen/au1");
  await page.waitForTimeout(250);
  check("Automat: Detail zeigt «24h-Automat», keine Wochentage", /24h-Automat/.test(await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.textContent)) && !/Montag|Mo:/.test(await page.$eval("#oeffnungszeiten-abschnitt", (el) => el.textContent)));
  const automatInfo = await page.evaluate(async () => {
    const g = await import("/src/gruppen.js");
    const h = { automat_24h: true, sonderoeffnungszeiten: [{ datum_von: "2026-03-10", datum_bis: "2026-03-12", geschlossen: true }] };
    return { normal: g.heuteKurzinfo(h, new Date(2026, 2, 5)), ferien: g.heuteKurzinfo(h, new Date(2026, 2, 11)), voll: g.vollstaendigkeit(g.HOF_GRUPPEN.find((x) => x.id === "oeffnungszeiten"), { automat_24h: true }) };
  });
  check(`Automat: Kurzinfo «Rund um die Uhr», in den Ferien «Heute geschlossen», Gruppe vollständig (${automatInfo.normal} / ${automatInfo.ferien})`, /Rund um die Uhr/.test(automatInfo.normal) && automatInfo.ferien === "Heute geschlossen" && automatInfo.voll === "voll");
  await gehe("#/hofladen/au1/bearbeiten");
  await page.waitForTimeout(250);
  await page.evaluate(() => { document.querySelector("#gruppe-oeffnungszeiten").open = true; });
  check("Automat: Schalter ist an, Wochenzeiten sind ausgeblendet", (await page.getAttribute("#automat-schalter", "aria-checked")) === "true" && (await page.$eval("#oeffnungszeiten-liste", (el) => el.hidden)));
  check("Automat: Schalter ist mindestens 44px hoch", (await page.$eval("#automat-schalter", (el) => el.getBoundingClientRect().height)) >= 44);
  await page.click("#automat-schalter");
  check("Automat: Schalter aus zeigt die Wochenzeiten wieder und meldet Änderung", (await page.getAttribute("#automat-schalter", "aria-checked")) === "false" && !(await page.$eval("#oeffnungszeiten-liste", (el) => el.hidden)) && (await page.isVisible("#ungespeichert")));
  await page.click("#automat-schalter");
  await page.click("#automat-schalter");
  await page.click("#speichern-btn");
  await page.waitForTimeout(250);
  check("Automat: Speichern sendet automat_24h", (await page.evaluate(() => window.__gespeichertAutomat))?.automat_24h === false);

  // Phase 7: Zugänglichkeit.
  await page.evaluate(() => { const a = window.hofkarteApp; a.state.hoflaeden = [{ id: "z1", name: "Zugang", bilder: [] }]; });
  await gehe("#/");
  // Wie im Browser: nur ein hashchange (gehe() löst zusätzlich selbst eines aus).
  await page.evaluate(() => { window.location.hash = "#/erfassen"; });
  await page.waitForTimeout(300);
  const fokusRoute = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim(), h1: document.querySelectorAll("h1").length }));
  check(`Zugänglichkeit: nach Seitenwechsel steht der Fokus auf der Überschrift (${fokusRoute.tag} «${fokusRoute.text}»)`, fokusRoute.tag === "H1" && fokusRoute.text === "Erfassen");
  await gehe("#/");
  check("Zugänglichkeit: genau eine H1 (auch mit grossem Titel)", (await page.$$eval("h1", (els) => els.length)) === 1);
  check("Zugänglichkeit: Seitentitel folgt der Ansicht", (await page.title()).endsWith("HofKarte"));
  await page.focus("#skip-link");
  check("Zugänglichkeit: «Zum Inhalt» wird bei Fokus sichtbar und springt in den Inhalt", (await page.$eval("#skip-link", (el) => el.getBoundingClientRect().top)) >= 0);
  await page.keyboard.press("Enter");
  check("Zugänglichkeit: «Zum Inhalt» setzt den Fokus auf den Inhalt", (await page.evaluate(() => document.activeElement?.id)) === "inhalt");
  await page.keyboard.press("Tab");
  const fokusRahmen = await page.evaluate(() => { const el = document.activeElement; return el ? getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth : ""; });
  check(`Zugänglichkeit: Tastaturfokus ist sichtbar (${fokusRahmen})`, /solid 3px/.test(fokusRahmen));

  // Kontraste (WCAG AA 4.5:1) in Hell und Dunkel.
  const kontrast = async (schema) => {
    await page.emulateMedia({ colorScheme: schema });
    await page.waitForTimeout(100);
    return page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const c = document.createElement("canvas").getContext("2d");
      const rgba = (wert) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = wert; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const roh = (name) => cs.getPropertyValue(name).trim();
      // Halbtransparente Farben über dem Hintergrund zusammensetzen.
      const ueber = (vordergrund, hintergrund) => {
        const m = vordergrund.match(/rgba?\(([^)]+)\)/);
        if (!m) return rgba(vordergrund);
        const t = m[1].split(",").map((x) => parseFloat(x));
        const a = t[3] ?? 1;
        const bg = rgba(hintergrund);
        return [0, 1, 2].map((i) => Math.round(t[i] * a + bg[i] * (1 - a)));
      };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const verh = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const karte = roh("--card-bg");
      const bg = roh("--bg-color");
      const paare = {
        "Text/Karte": [ueber(roh("--text-color"), karte), rgba(karte)],
        "Gedämpft/Karte": [ueber(roh("--muted-color"), karte), rgba(karte)],
        "Gedämpft/Hintergrund": [ueber(roh("--muted-color"), bg), rgba(bg)],
        "Tint/Karte": [rgba(roh("--tint")), rgba(karte)],
        "Schrift auf Akzent": [rgba(roh("--accent-ink")), rgba(roh("--accent"))],
        "Erfolg/Karte": [rgba(roh("--success-color")), rgba(karte)],
        "Fehler/Karte": [rgba(roh("--danger-color")), rgba(karte)],
        "Erfolg/Badge": [rgba(roh("--success-color")), ueber("rgba(52, 199, 89, 0.16)", karte)],
        "Fehler/Badge": [rgba(roh("--danger-color")), ueber(roh("--danger-bg"), karte)],
        "Warnung/Karte": [rgba(roh("--warn-text")), ueber(roh("--warn-bg"), karte)],
      };
      return Object.entries(paare).map(([n, [a, b]]) => [n, verh(a, b)]).filter(([, v]) => v < 4.5).map(([n, v]) => `${n} ${v.toFixed(2)}`);
    });
  };
  const schlechtHell = await kontrast("light");
  const schlechtDunkel = await kontrast("dark");
  await page.emulateMedia({ colorScheme: "light" });
  check(`Kontrast hell ≥ 4,5:1 (${schlechtHell.join("; ")})`, schlechtHell.length === 0);
  check(`Kontrast dunkel ≥ 4,5:1 (${schlechtDunkel.join("; ")})`, schlechtDunkel.length === 0);

  // --- 2.0.0-dev.8: Sprachen (DE/FR/IT/EN) ----------------------------------------
  const setzeTesthof = () => page.evaluate(() => {
    const a = window.hofkarteApp;
    a.state.hoflaeden = [{
      id: "i1", name: "Testhof", ort: "Bern", plz: "3000", adresse: "Dorfstrasse 1", latitude: 46.9, longitude: 7.4, geoeffnet: true, bewertung: 3,
      oeffnungszeiten: [{ wochentag: 1, beginn: "08:00", ende: "12:00" }], angebote: [{ id: "a1", name: "Eier" }], zahlungsarten: [], bilder: [],
      quellen: [{ feld: "name", quelle: "openstreetmap", status: "confirmed", url: null, lizenz: null }],
    }];
  });
  await setzeTesthof();
  await gehe("#/einstellungen");
  check("Sprache: Auswahl in den Einstellungen vorhanden (Automatisch, DE, FR, IT, EN)", (await page.$$eval("#f-sprache option", (o) => o.map((x) => x.value).join(","))) === ",de,fr,it,en");
  check("Sprache: eigene Gruppe mit Dropdown (mind. 52px hoch) und Zurücksetzen-Knopf", await page.evaluate(() => {
    const g = document.querySelector("#sprache");
    const sel = g?.querySelector("select#f-sprache");
    const btn = g?.querySelector("#sprache-zuruecksetzen");
    return [!!g, !!g?.querySelector("h2"), sel?.getBoundingClientRect().height, btn?.getBoundingClientRect().height].join() && !!g && !!g.querySelector("h2") && !document.querySelector("#darstellung").contains(g) && sel.getBoundingClientRect().height >= 52 && btn.getBoundingClientRect().height >= 44;
  }));
  check("Farbe: Zurücksetzen-Knopf sichtbar und mind. 44px hoch", await page.evaluate(() => { const b = document.querySelector("#farbe-zuruecksetzen"); const r = b.getBoundingClientRect(); return r.width > 0 && r.height >= 44; }));
  check("Farbfeld «Eigene Farbe» ist ein runder Punkt (48×48, 50 %)", await page.evaluate(() => {
    const r = document.querySelector("#f-eigene-farbe");
    const b = r.getBoundingClientRect();
    return Math.abs(b.width - b.height) < 0.5 && getComputedStyle(r).borderRadius === "50%";
  }));
  const DEUTSCH = /\b(und|nicht|noch|keine|bitte|hofladen|hofläden|speichern|abbrechen|öffnungszeiten|zurück|angaben|standort|wird|werden|für|oder|eine|einen|dein|deine|dieser|ergänzen|suchen|suche|verbindung|löschen|bearbeiten)\b/i;
  const sammleTexte = () =>
    page.evaluate(() => {
      const teile = [document.body.innerText];
      document.querySelectorAll("[aria-label],[title],[placeholder]").forEach((el) => {
        for (const a of ["aria-label", "title", "placeholder"]) if (el.getAttribute(a)) teile.push(el.getAttribute(a));
      });
      return teile.join("\n");
    });
  const ROUTEN = ["#/", "#/karte", "#/hofladen/i1", "#/hofladen/i1/bearbeiten", "#/hofladen/i1/ergaenzen", "#/neu", "#/erfassen", "#/erfassen/vorort", "#/erfassen/schnell", "#/erfassen/webseite", "#/finden", "#/einstellungen"];
  for (const [code, htmlLang, marke] of [["fr", "fr-CH", /Enregistrer|Rechercher|ferme/i], ["it", "it-CH", /Salva|Cerca|negozio agricolo/i], ["en", "en-GB", /Save|Search|farm shop/i]]) {
    await gehe("#/einstellungen");
    await page.selectOption("#f-sprache", code);
    await page.waitForTimeout(200);
    check(`Sprache ${code}: html lang = ${htmlLang}, Wahl nur im Gerätespeicher`, (await page.evaluate(() => document.documentElement.lang)) === htmlLang && (await page.evaluate(() => localStorage.getItem("hofkarte-sprache"))) === code);
    const einstellungen = await sammleTexte();
    check(`Sprache ${code}: Einstellungen werden neu gezeichnet und übersetzt`, marke.test(einstellungen) || !DEUTSCH.test(einstellungen));
    const befunde = [];
    for (const route of ROUTEN) {
      await setzeTesthof();
      await page.evaluate((h) => { window.location.hash = h; }, route);
      await page.waitForTimeout(350);
      const text = await sammleTexte();
      const treffer = text.split("\n").filter((z) => DEUTSCH.test(z) && !/Testhof|Dorfstrasse|Bern/.test(z));
      if (treffer.length) befunde.push(`${route}: ${treffer.slice(0, 3).join(" / ")}`);
    }
    check(`Sprache ${code}: keine deutschen Texte auf ${ROUTEN.length} Seiten (${befunde.slice(0, 4).join(" || ")})`, befunde.length === 0);
    await setzeTesthof();
    await page.evaluate(() => { window.location.hash = "#/hofladen/i1"; });
    await page.waitForTimeout(300);
    const detailText = await sammleTexte();
    check(`Sprache ${code}: Detail zeigt übersetzte Gruppentitel (${detailText.replace(/\n+/g, " | ").slice(0, 300)})`, { fr: /horaires/i, it: /orari/i, en: /opening hours/i }[code].test(detailText));
  }
  // Zurück auf Deutsch (und «Automatisch» = Browsersprache de-CH).
  await gehe("#/einstellungen");
  await page.click("#sprache-zuruecksetzen");
  await page.waitForTimeout(200);
  check("Sprache: «Automatisch» folgt der Browsersprache (de-CH) und löscht die Wahl", (await page.evaluate(() => document.documentElement.lang)) === "de-CH" && (await page.evaluate(() => localStorage.getItem("hofkarte-sprache"))) === null);

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
