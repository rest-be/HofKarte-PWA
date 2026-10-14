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

  await page.click("[data-tab='neu']");
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
    `Einstellungen-Reihenfolge: Darstellung, Nähe, Verbindung, Token ändern, Abmelden, Version (${einstellungenReihenfolge.join(", ")})`,
    JSON.stringify(einstellungenReihenfolge) === JSON.stringify(["Darstellung", "Hofläden in der Nähe", "Verbindung", "Token ändern", "Abmelden", "Version"])
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
  check("Finden: Gerätestandort wird sofort übernommen", (await page.$eval('[data-feld="latitude"]', (el) => el.value)) === "47.050200");
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
