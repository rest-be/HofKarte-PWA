#!/usr/bin/env node
/**
 * Richtet eine isolierte Testkopie der PWA ein, liefert sie über einen
 * kleinen lokalen HTTP-Server aus und führt tests/smoke-test.js mit
 * Playwright gegen diese Kopie aus. Gedacht für `npm run test:smoke`
 * sowie für den CI-Workflow (.github/workflows/test.yml).
 *
 * Warum eine Kopie statt direkt gegen das Repo zu testen: `src/ha-
 * client.js` lädt `home-assistant-js-websocket` im Produktivbetrieb
 * bewusst direkt von jsDelivr (kein Bundler, siehe Vorgehensplan,
 * Phase 4). Für die Tests wird dieser eine Import-Pfad in der Kopie
 * auf `tests/ha-ws-stub.js` umgeschrieben, damit die Tests ohne
 * Netzwerkzugriff und ohne echte Home-Assistant-Instanz laufen – alle
 * übrigen Dateien bleiben unverändert.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, cp, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function starteStatischenServer(wurzelverzeichnis) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const urlPfad = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        const dateiPfad = path.join(wurzelverzeichnis, urlPfad === "/" ? "/index.html" : urlPfad);
        if (!dateiPfad.startsWith(wurzelverzeichnis)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const inhalt = await readFile(dateiPfad);
        const ext = path.extname(dateiPfad);
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(inhalt);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function bereiteTestkopieVor() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hofkarte-pwa-test-"));

  for (const eintrag of ["index.html", "manifest.json", "service-worker.js", "icons", "src"]) {
    await cp(path.join(REPO_ROOT, eintrag), path.join(tempDir, eintrag), { recursive: true });
  }

  await cp(path.join(REPO_ROOT, "tests", "ha-ws-stub.js"), path.join(tempDir, "src", "ha-ws-stub.js"));

  const haClientPfad = path.join(tempDir, "src", "ha-client.js");
  const haClientInhalt = await readFile(haClientPfad, "utf-8");
  const gepatcht = haClientInhalt.replace(
    /from\s+"https:\/\/cdn\.jsdelivr\.net\/npm\/home-assistant-js-websocket[^"]*"/,
    'from "./ha-ws-stub.js"'
  );
  if (gepatcht === haClientInhalt) {
    throw new Error(
      "Konnte den jsDelivr-Import in src/ha-client.js nicht finden/ersetzen – " +
        "Testkopie wäre nicht lauffähig. Bitte run-smoke-tests.mjs an eine " +
        "geänderte Import-Zeile anpassen."
    );
  }
  await import("node:fs/promises").then(({ writeFile }) => writeFile(haClientPfad, gepatcht, "utf-8"));

  return tempDir;
}

async function main() {
  const tempDir = await bereiteTestkopieVor();
  const server = await starteStatischenServer(tempDir);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const launchOptions = {};
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }

  const browser = await chromium.launch(launchOptions);
  let erfolgreich = false;
  try {
    const page = await browser.newPage();
    const { fuehreSmokeTestsAus } = await import(path.join(REPO_ROOT, "tests", "smoke-test.js"));
    erfolgreich = await fuehreSmokeTestsAus(page, baseUrl);
  } finally {
    await browser.close();
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }

  if (!erfolgreich) {
    console.error("\nSmoke-Tests fehlgeschlagen.");
    process.exit(1);
  }
  console.log("\nAlle Smoke-Tests erfolgreich.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
