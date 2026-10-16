/**
 * Teilen (2.0.0-dev.12): Hofladen als Text über das Teilen-Menü des Geräts
 * (Web Share API) weitergeben; ohne Teilen-Menü wird der Text kopiert.
 * Es wird nichts an HofKarte oder Dritte gesendet - der Text enthält nur,
 * was im Hofladen steht, und verlässt die App nur durch die Wahl der Person.
 */
import { t } from "./i18n.js";
import { formatZeit, heuteKurzinfo } from "./gruppen.js";
import { sichereHttpUrl } from "./html.js";

const WOCHENTAGE = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Öffnungszeiten als kurze Textzeilen ("Montag: 08:00–18:30"). */
function zeitenZeilen(h) {
  if (h.automat_24h === true) return [t("Rund um die Uhr (24h-Automat)")];
  const nachTag = {};
  for (const oz of h.oeffnungszeiten || []) {
    (nachTag[oz.wochentag] ||= []).push(`${formatZeit(oz.beginn)}–${formatZeit(oz.ende)}`);
  }
  return Object.keys(nachTag)
    .sort((a, b) => a - b)
    .map((tag) => `${t(WOCHENTAGE[tag])}: ${nachTag[tag].join(", ")}`);
}

/** Der zu teilende Text (reiner Text, ohne HTML). */
export function teilenText(h) {
  const zeilen = [h.name];
  const adresse = [h.adresse, [h.plz, h.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (adresse) zeilen.push(adresse);
  const zeiten = zeitenZeilen(h);
  if (zeiten.length) zeilen.push("", t("Öffnungszeiten"), ...zeiten);
  else if (heuteKurzinfo(h)) zeilen.push(heuteKurzinfo(h));
  if (h.mobilnummer) zeilen.push("", h.mobilnummer);
  const url = h.website ? sichereHttpUrl(h.website) : null;
  if (url) zeilen.push(url);
  if (h.latitude != null && h.longitude != null) {
    zeilen.push("", `https://www.openstreetmap.org/?mlat=${encodeURIComponent(h.latitude)}&mlon=${encodeURIComponent(h.longitude)}#map=17/${encodeURIComponent(h.latitude)}/${encodeURIComponent(h.longitude)}`);
  }
  return zeilen.join("\n");
}

/**
 * Teilt den Hofladen. Gibt "geteilt", "kopiert", "abgebrochen" oder
 * "fehler" zurück, damit die Ansicht eine passende Meldung zeigen kann.
 */
export async function teileHofladen(h) {
  const text = teilenText(h);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: h.name, text });
      return "geteilt";
    } catch (err) {
      if (err && err.name === "AbortError") return "abgebrochen";
      // sonst weiter mit Kopieren
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "kopiert";
  } catch {
    return "fehler";
  }
}
