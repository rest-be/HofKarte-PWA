/**
 * Test-Stub für `home-assistant-js-websocket`, nur für die
 * Playwright-Smoke-Tests unter tests/ (siehe tests/README.md).
 *
 * Ersetzt in einer Testkopie der App den jsDelivr-Import in
 * `src/ha-client.js`, damit die Tests ohne echte Home-Assistant-
 * Instanz und ohne Netzwerkzugriff laufen. Die Verbindung schlägt
 * hier bewusst immer fehl ("connection_lost") – die Tests selbst
 * erzwingen den benötigten App-Zustand direkt über
 * `window.hofkarteApp`, statt den echten Verbindungsaufbau zu
 * durchlaufen (siehe `app.js`'s globalem `window.hofkarteApp`, das
 * genau zu diesem Zweck exponiert wird).
 */
export function createLongLivedTokenAuth() {
  return {};
}

export async function createConnection() {
  const fehler = new Error("stub: keine echte Verbindung in diesem Test");
  fehler.code = "connection_lost";
  throw fehler;
}

export const ERR_INVALID_AUTH = "ERR_INVALID_AUTH_STUB";
