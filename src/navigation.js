/**
 * Navigation (2.0.0-dev.16): Der Knopf «Route» öffnet je nach Einstellung
 * Google Maps oder Apple Karten. Die Wahl gilt zentral für alle Hofläden und
 * nur auf diesem Gerät (localStorage). Ohne Wahl: auf iPhone/iPad Apple
 * Karten, sonst Google Maps. Es werden nur Weblinks gebaut, nichts übertragen.
 */

export const NAVIGATIONSDIENSTE = [
  { code: "google", name: "Google Maps" },
  { code: "apple", name: "Apple Karten" },
];

const SPEICHER_KEY = "hofkarte-navigation";

const gueltig = (code) => (NAVIGATIONSDIENSTE.some((d) => d.code === code) ? code : null);

/** iPhone, iPad oder iPod (auch iPadOS, das sich als Mac ausgibt). */
export function istAppleGeraet() {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function standardDienst() {
  return istAppleGeraet() ? "apple" : "google";
}

export function gespeicherterDienst() {
  try {
    return gueltig(localStorage.getItem(SPEICHER_KEY));
  } catch {
    return null;
  }
}

/** `null` = Standard des Geräts. */
export function setzeDienst(code) {
  const wahl = gueltig(code);
  try {
    if (wahl) localStorage.setItem(SPEICHER_KEY, wahl);
    else localStorage.removeItem(SPEICHER_KEY);
  } catch {
    /* Speicher nicht verfügbar: gilt nur für diese Sitzung */
  }
  return aktuellerDienst();
}

export function aktuellerDienst() {
  return gespeicherterDienst() || standardDienst();
}

const koordinaten = (h) => `${encodeURIComponent(h.latitude)},${encodeURIComponent(h.longitude)}`;

/** Link für «Route»: startet die Navigation zum Hofladen. */
export function routenLink(h, dienst = aktuellerDienst()) {
  if (dienst === "apple") return `https://maps.apple.com/?daddr=${koordinaten(h)}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${h.latitude},${h.longitude}`)}`;
}

/** Link für «Auf der Karte öffnen»: zeigt den Ort ohne Route. */
export function kartenLink(h, dienst = aktuellerDienst()) {
  if (dienst === "apple") {
    const name = h.name ? `&q=${encodeURIComponent(h.name)}` : "";
    return `https://maps.apple.com/?ll=${koordinaten(h)}${name}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${koordinaten(h)}`;
}
