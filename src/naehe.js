/**
 * "Hofläden in der Nähe" – nutzt die Browser-Geolocation-API und die
 * HofKarte-HA-Action `hoflaeden_in_naehe` (siehe Vorgehensplan Phase 4,
 * Schritt 36).
 *
 * Wichtig: Die eigentliche, zuverlässige Hintergrund-Benachrichtigung
 * (auch wenn die PWA nicht geöffnet ist) läuft über das HA-seitige
 * Automation-Blueprint mit der offiziellen Home Assistant Companion
 * App (siehe HofKarte-HA-README, Abschnitt "Mobile PWA") – iOS/Safari
 * bieten keine Geofencing-/Hintergrund-Standort-API für Web-Apps (siehe
 * PWA-HA-Vorgehensplan). Diese Datei deckt nur den Fall ab, dass die
 * PWA gerade aktiv geöffnet ist ("Hofläden in der Nähe"-Karte auf der
 * Übersicht).
 *
 * Es wird kein Standort gespeichert: `navigator.geolocation` wird bei
 * jedem Aufruf frisch abgefragt, das Ergebnis nur im Arbeitsspeicher
 * weitergereicht.
 */

/** Standard-Umkreis (Meter); pro Gerät in den Einstellungen änderbar. */
const STANDARD_RADIUS_METER = 500;
const MIN_RADIUS_METER = 50;
const MAX_RADIUS_METER = 50000;

/**
 * Aktuellen Standort einmalig abfragen. Wirft bei fehlender Berechtigung
 * oder nicht unterstütztem Browser einen Fehler mit sprechender
 * `message` (für die direkte Anzeige in der Oberfläche gedacht).
 */
function aktuellerStandort() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Dieser Browser unterstützt keine Standortabfrage."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              "Standortzugriff wurde abgelehnt. Bitte in den Geräte-Einstellungen erlauben."
            )
          );
        } else {
          reject(new Error("Standort konnte nicht ermittelt werden."));
        }
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

/**
 * Hofläden in der Nähe des aktuellen Geräte-Standorts ermitteln.
 *
 * Gibt `{latitude, longitude, treffer}` zurück, `treffer` wie von der
 * Action geliefert (sortiert nach Entfernung, inkl. `entfernung_meter`).
 */
export async function hoflaedenInNaeheDesGeraets(
  haClient,
  { radiusMeter = STANDARD_RADIUS_METER, nurGeoeffnet = true } = {}
) {
  const { latitude, longitude } = await aktuellerStandort();
  const ergebnis = await haClient.hoflaedenInNaehe({
    latitude,
    longitude,
    radiusMeter,
    nurGeoeffnet,
  });
  return { latitude, longitude, treffer: ergebnis.hoflaeden };
}

export { aktuellerStandort, STANDARD_RADIUS_METER, MIN_RADIUS_METER, MAX_RADIUS_METER };
