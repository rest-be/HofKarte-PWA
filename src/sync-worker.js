/**
 * Arbeitet die Warteschlange ausstehender Schreibvorgänge ab (Phase 8a,
 * siehe PWA-HA-Vorgehensplan.md Abschnitt 10.3), sobald wieder eine
 * Verbindung zu Home Assistant besteht. Wird von app.js nach jedem
 * erfolgreichen (Wieder-)Verbindungsaufbau aufgerufen - es gibt keinen
 * eigenen Hintergrund-Timer, da eine PWA im Hintergrund/geschlossenen
 * Zustand ohnehin keinen JavaScript-Code ausführen kann.
 *
 * Reihenfolge bleibt erhalten (älteste Operation zuerst), damit z. B.
 * "Hofladen anlegen" vor einer offline nachträglich vorgenommenen
 * "Hofladen ändern"-Operation für denselben (noch lokalen) Hofladen
 * ausgeführt wird.
 *
 * Bewusst nicht Teil dieser Version: Foto-Operationen (Upload/Löschen)
 * bleiben weiterhin eine Live-Aktion mit sofortiger Fehlermeldung bei
 * fehlender Verbindung (siehe editor.js) - siehe PWA-HA-Vorgehensplan.md
 * Abschnitt 10.3, Phase 8a, als bewusst zurückgestellte Erweiterung.
 */

import {
  ladeWarteschlange,
  entferneAusWarteschlange,
  aktualisiereInWarteschlange,
} from "./storage.js";

/** Nach so vielen gescheiterten Versuchen wird eine Operation nicht mehr
 * automatisch wiederholt, sondern als dauerhaft fehlgeschlagen markiert
 * (sichtbar über app.state.ausstehendeWarnung) - verhindert endloses,
 * stilles Wiederholen bei einem dauerhaften Fehler (z. B. ungültige
 * Daten), siehe Roadmap Abschnitt 4 ("mit sinnvollen Grenzen"). */
const MAX_VERSUCHE = 8;

/** Backoff-Stufen in Millisekunden (Roadmap Abschnitt 4: 5s/30s/2min/10min),
 * danach bleibt es bei der letzten Stufe. */
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];

let laeuftBereits = false;
let naechsterVersuchTimer = null;

function backoffFuer(versuchCount) {
  return BACKOFF_MS[Math.min(versuchCount, BACKOFF_MS.length - 1)];
}

async function wendeOperationAn(app, op) {
  if (op.art === "anlegen") {
    const { id: lokaleId, _synchronisierungAusstehend, ...rest } = op.daten;
    const gespeichert = await app.haClient.hofladenSpeichern(rest);
    await app._ersetzeLokaleId(lokaleId, gespeichert.id, gespeichert);
    return;
  }
  if (op.art === "aendern") {
    const { _synchronisierungAusstehend, ...rest } = op.daten;
    await app.haClient.hofladenSpeichern(rest);
    return;
  }
  if (op.art === "loeschen") {
    await app.haClient.hofladenLoeschen(op.hofladenId);
    return;
  }
}

/**
 * Warteschlange einmal durchgehen. Bricht die aktuelle Runde ab, sobald
 * eine Operation an einem Verbindungsfehler scheitert (die Verbindung ist
 * dann vermutlich insgesamt weg) - plant stattdessen einen späteren
 * Wiederholungsversuch per Backoff. Ein fachlicher Fehler (z. B. von Home
 * Assistant abgelehnte Daten) blockiert die übrigen Operationen dagegen
 * nicht.
 */
export async function verarbeiteWarteschlange(app) {
  if (laeuftBereits) return;
  if (naechsterVersuchTimer) {
    clearTimeout(naechsterVersuchTimer);
    naechsterVersuchTimer = null;
  }
  laeuftBereits = true;

  try {
    if (!app.haClient) return;

    const operationen = await ladeWarteschlange();
    let verbindungVerloren = false;

    for (const op of operationen) {
      if (!app.haClient) {
        verbindungVerloren = true;
        break;
      }
      try {
        await wendeOperationAn(app, op);
        await entferneAusWarteschlange(op.id);
      } catch (err) {
        const versuchCount = (op.versuchCount || 0) + 1;
        await aktualisiereInWarteschlange(op.id, {
          versuchCount,
          letzterFehler: err.message,
          endgueltigFehlgeschlagen: versuchCount >= MAX_VERSUCHE,
        });
        if (err.code === "connection_lost") {
          verbindungVerloren = true;
          break;
        }
        // Fachlicher Fehler (z. B. ungültige Daten) - mit den übrigen
        // Operationen weiterfahren, diese einzelne bleibt zum späteren
        // erneuten Versuch in der Warteschlange.
      }
    }

    await app._aktualisiereAusstehendeAnzahl();

    if (verbindungVerloren) {
      const restOperationen = await ladeWarteschlange();
      const maxVersuche = Math.max(0, ...restOperationen.map((o) => o.versuchCount || 0));
      naechsterVersuchTimer = setTimeout(() => {
        verarbeiteWarteschlange(app);
      }, backoffFuer(maxVersuche));
    }
  } finally {
    laeuftBereits = false;
  }
}
