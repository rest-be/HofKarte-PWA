/**
 * Persistenz der Verbindungsdaten (HA-Adresse, Long-Lived Access Token)
 * in IndexedDB.
 *
 * Bewusst IndexedDB statt localStorage: localStorage ist synchron (blockiert
 * den Hauptthread) und wird von manchen iOS-Safari-Konfigurationen in
 * installierten PWAs restriktiver behandelt als IndexedDB. Es wird
 * ausschliesslich lokal auf dem Gerät gespeichert – es gibt keine
 * eigene Datenhaltung der PWA auf einem Server (siehe Vorgehensplan).
 */

const DB_NAME = "hofkarte-pwa";
const DB_VERSION = 1;
const STORE_NAME = "einstellungen";
const CACHE_STORE_NAME = "lesecache";
const VERBINDUNG_KEY = "verbindung";

function oeffneDb() {
  return new Promise((resolve, reject) => {
    const anfrage = indexedDB.open(DB_NAME, DB_VERSION);

    anfrage.onupgradeneeded = () => {
      const db = anfrage.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        db.createObjectStore(CACHE_STORE_NAME);
      }
    };

    anfrage.onsuccess = () => resolve(anfrage.result);
    anfrage.onerror = () => reject(anfrage.error);
  });
}

async function get(key, storeName = STORE_NAME) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const anfrage = tx.objectStore(storeName).get(key);
    anfrage.onsuccess = () => resolve(anfrage.result ?? null);
    anfrage.onerror = () => reject(anfrage.error);
  });
}

async function set(key, value, storeName = STORE_NAME) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function remove(key, storeName = STORE_NAME) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Gespeicherte Verbindungsdaten lesen: {haUrl, token} oder `null`, wenn
 * die PWA noch nicht eingerichtet wurde.
 */
export async function ladeVerbindung() {
  return get(VERBINDUNG_KEY);
}

/**
 * Verbindungsdaten speichern (Einrichtungsbildschirm, siehe
 * src/views/setup.js).
 */
export async function speichereVerbindung(haUrl, token) {
  await set(VERBINDUNG_KEY, { haUrl, token });
}

/** Verbindungsdaten löschen ("Abmelden"/Gerät zurücksetzen). */
export async function loescheVerbindung() {
  await remove(VERBINDUNG_KEY);
}

/**
 * Lesecache für Stale-while-revalidate (siehe src/ha-client.js): liefert
 * `{daten, zeitpunkt}` oder `null`, wenn noch nichts gecacht wurde.
 * `zeitpunkt` ist ein ISO-Zeitstempel, aus dem die Oberfläche "zuletzt
 * aktualisiert am …" anzeigt, solange keine frischen Daten da sind.
 */
export async function ladeCache(key) {
  return get(key, CACHE_STORE_NAME);
}

export async function speichereCache(key, daten) {
  await set(key, { daten, zeitpunkt: new Date().toISOString() }, CACHE_STORE_NAME);
}
