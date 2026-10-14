/**
 * Persistenz der Verbindungsdaten (HA-Adresse, Long-Lived Access Token)
 * in IndexedDB.
 *
 * Bewusst IndexedDB statt localStorage: localStorage ist synchron (blockiert
 * den Hauptthread) und wird von manchen iOS-Safari-Konfigurationen in
 * installierten PWAs restriktiver behandelt als IndexedDB. Es wird
 * ausschliesslich lokal auf dem Gerät gespeichert – es gibt keine
 * eigene Datenhaltung der PWA auf einem Server (siehe Vorgehensplan).
 *
 * Seit Phase 8a zusätzlich: Warteschlange für Schreibvorgänge, die
 * entstehen, während keine Verbindung zu Home Assistant besteht (siehe
 * app.js/sync-worker.js). Store-Name bewusst "warteschlange" statt dem
 * englischen "outbox" aus der Architektur-Roadmap, konsistent mit den
 * sonst durchgehend deutschen Bezeichnungen in diesem Projekt.
 */

const DB_NAME = "hofkarte-pwa";
const DB_VERSION = 2;
const STORE_NAME = "einstellungen";
const CACHE_STORE_NAME = "lesecache";
const WARTESCHLANGE_STORE_NAME = "warteschlange";
const VERBINDUNG_KEY = "verbindung";

/** Geteilte Verbindung: einmal öffnen, danach wiederverwenden (Phase 10,
 * Review P7 - vorher wurde pro Aufruf eine neue Verbindung geöffnet und nie
 * geschlossen). Bei Fehlschlag wird der Zwischenspeicher verworfen. */
let dbPromise = null;

function oeffneDb() {
  if (!dbPromise) {
    dbPromise = oeffneDbNeu().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function oeffneDbNeu() {
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
      if (!db.objectStoreNames.contains(WARTESCHLANGE_STORE_NAME)) {
        db.createObjectStore(WARTESCHLANGE_STORE_NAME);
      }
    };

    anfrage.onsuccess = () => {
      const db = anfrage.result;
      // Schema-Upgrade durch einen anderen Tab/neue Version nicht blockieren.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
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

/** Alle Einträge eines Stores als Array von {key, value} lesen, sortiert
 * ist hier bewusst nicht die Aufgabe der Datenschicht - das macht die
 * Aufruferin (siehe ladeWarteschlange()). */
async function getAlle(storeName) {
  const db = await oeffneDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const ergebnis = [];
    const cursorAnfrage = store.openCursor();
    cursorAnfrage.onsuccess = () => {
      const cursor = cursorAnfrage.result;
      if (cursor) {
        ergebnis.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      } else {
        resolve(ergebnis);
      }
    };
    cursorAnfrage.onerror = () => reject(cursorAnfrage.error);
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

/** Umkreis (Meter) für "Hofläden in der Nähe" - pro Gerät, `null` = Standard. */
const NAEHE_RADIUS_KEY = "naehe-radius";

export async function ladeNaeheRadius() {
  const wert = await get(NAEHE_RADIUS_KEY);
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

export async function speichereNaeheRadius(meter) {
  await set(NAEHE_RADIUS_KEY, meter);
}

/** Kartenfilter "Geschlossene ausblenden" - pro Gerät, Standard: aus. */
const KARTE_NUR_OFFEN_KEY = "karte-geschlossene-ausblenden";

export async function ladeKarteGeschlosseneAusblenden() {
  return (await get(KARTE_NUR_OFFEN_KEY)) === true;
}

export async function speichereKarteGeschlosseneAusblenden(wert) {
  await set(KARTE_NUR_OFFEN_KEY, wert === true);
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

/**
 * Warteschlange für Schreibvorgänge ohne Verbindung (Phase 8a, siehe
 * PWA-HA-Vorgehensplan.md Abschnitt 10.3). Jede Operation:
 * `{ id, art: "anlegen"|"aendern"|"loeschen", hofladenId, daten,
 *    erstelltAm, versuchCount, letzterFehler? }`.
 *
 * `hofladenId` ist bei "anlegen" die lokal erzeugte Platzhalter-ID
 * (siehe app.js, LOKALES_ID_PRAEFIX) - sie wird nach erfolgreichem Sync
 * durch die echte, von Home Assistant vergebene ID ersetzt (siehe
 * aktualisiereHofladenIdInWarteschlange()).
 */
export async function fuegeOperationZurWarteschlangeHinzu({ art, hofladenId, daten }) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const operation = {
    id,
    art,
    hofladenId,
    daten,
    erstelltAm: new Date().toISOString(),
    versuchCount: 0,
  };
  await set(id, operation, WARTESCHLANGE_STORE_NAME);
  return operation;
}

/** Alle ausstehenden Operationen, älteste zuerst (Reihenfolge der
 * Entstehung muss beim Abarbeiten eingehalten werden). */
export async function ladeWarteschlange() {
  const eintraege = await getAlle(WARTESCHLANGE_STORE_NAME);
  return eintraege.map((e) => e.value).sort((a, b) => a.erstelltAm.localeCompare(b.erstelltAm));
}

export async function entferneAusWarteschlange(id) {
  await remove(id, WARTESCHLANGE_STORE_NAME);
}

export async function aktualisiereInWarteschlange(id, aenderungen) {
  const bestehend = await get(id, WARTESCHLANGE_STORE_NAME);
  if (!bestehend) return;
  await set(id, { ...bestehend, ...aenderungen }, WARTESCHLANGE_STORE_NAME);
}

/** Nach erfolgreichem Sync: alle noch ausstehenden Operationen desselben
 * Hofladens (ausser Konflikt-Operationen) auf die neue Server-Version
 * heben, damit Folge-Änderungen keinen Selbst-Konflikt auslösen. */
export async function aktualisiereVersionInWarteschlange(hofladenId, neueVersion) {
  const eintraege = await getAlle(WARTESCHLANGE_STORE_NAME);
  for (const { key, value } of eintraege) {
    if (value.hofladenId === hofladenId && !value.konflikt && value.art === "aendern" && value.daten) {
      await set(key, { ...value, daten: { ...value.daten, version: neueVersion } }, WARTESCHLANGE_STORE_NAME);
    }
  }
}

/** Nach erfolgreichem Sync einer "anlegen"-Operation: alle noch
 * ausstehenden Folge-Operationen (z. B. eine offline nachträglich
 * vorgenommene Änderung am selben, neu angelegten Hofladen), die noch
 * auf die lokale Platzhalter-ID zeigen, auf die echte ID ummappen. */
export async function aktualisiereHofladenIdInWarteschlange(alteId, neueId) {
  const eintraege = await getAlle(WARTESCHLANGE_STORE_NAME);
  for (const { key, value } of eintraege) {
    if (value.hofladenId === alteId) {
      const daten = value.daten && value.daten.id === alteId ? { ...value.daten, id: neueId } : value.daten;
      await set(key, { ...value, hofladenId: neueId, daten }, WARTESCHLANGE_STORE_NAME);
    }
  }
}
