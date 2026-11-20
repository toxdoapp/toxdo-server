// Tareas diarias. Render suspende el servicio gratuito cuando no hay tráfico, así que además del
// cron se revisa si falta la tarea del día cada vez que el servidor despierta o recibe un ping.
import cron from "node-cron";
import { aiConfigured } from "./ai.js";
import { config } from "./env.js";
import { db } from "./firebase.js";
import { expireOffers, ingestDue } from "./ingest/benefits.js";
import { pruneEvents, refreshActiveCities } from "./ingest/events.js";
import { refreshPlacesIfDue } from "./ingest/places.js";
import { syncEventsSheet } from "./ingest/eventsSheet.js";
import { syncSheet } from "./ingest/sheet.js";
import { todayCL } from "./text.js";

let busy = false;
let sheetBusy = false;
let eventsSheetBusy = false;

// Marca la tarea como tomada para hoy. Devuelve false si ya se hizo.
async function claim(field) {
  const ref = db.collection("meta").doc("scheduler");
  const today = todayCL();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()[field] === today) return false;
    tx.set(ref, { [field]: today }, { merge: true });
    return true;
  });
}

const release = (field) =>
  db
    .collection("meta")
    .doc("scheduler")
    .set({ [field]: null }, { merge: true })
    .catch(() => {});

export async function runDailyIfDue({ log = console.log } = {}) {
  if (!db || busy) return;
  busy = true;
  try {
    if (await claim("housekeepingDate")) {
      const expired = await expireOffers();
      const pruned = await pruneEvents();
      log(`[tareas] limpieza: ${expired} ofertas vencidas, ${pruned} eventos antiguos`);
    }
    if (aiConfigured() && (await claim("ingestDate"))) {
      log("[tareas] actualización diaria con IA");
      try {
        await ingestDue({ limit: config.entitiesPerDay, log });
        await refreshActiveCities({ limit: 6, log });
      } catch (err) {
        // Sin IA no se hizo nada: se libera el día para reintentar cuando vuelva.
        if (err.name === "AiUnavailable") await release("ingestDate");
        throw err;
      }
    }
  } catch (err) {
    log(`[tareas] error: ${err.message}`);
  }
  try {
    // Las sucursales no dependen de la IA: se actualizan si cambiaron los comercios o pasaron dos semanas.
    await refreshPlacesIfDue({ log });
  } catch (err) {
    log(`[tareas] sucursales: ${err.message}`);
  } finally {
    busy = false;
  }
}

// El Sheet no depende de IA y no tiene costo, así que se revisa varias veces al día en vez de una sola.
// Tiene su propio candado (no el de runDailyIfDue) para no esperar a que termine la tarea diaria completa.
export async function runSheetSyncNow({ log = console.log } = {}) {
  if (!db || !config.sheetId || sheetBusy) return { skipped: true };
  sheetBusy = true;
  try {
    const result = await syncSheet({ log });
    log(`[tareas] sheet: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    log(`[tareas] sheet: ${err.message}`);
    return { error: err.message };
  } finally {
    sheetBusy = false;
  }
}

// La pestaña de eventos se llena fuera del servidor (por ejemplo, un script en el computador
// de la persona), no con IA del servidor. Acá solo se lee, se valida y se geocodifica.
export async function runEventsSheetSyncNow({ log = console.log } = {}) {
  if (!db || !config.eventsSheetGid || eventsSheetBusy) return { skipped: true };
  eventsSheetBusy = true;
  try {
    const result = await syncEventsSheet({ log });
    log(`[tareas] eventos-sheet: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    log(`[tareas] eventos-sheet: ${err.message}`);
    return { error: err.message };
  } finally {
    eventsSheetBusy = false;
  }
}

export function startScheduler() {
  if (!config.cronEnabled) return;
  cron.schedule("15 6 * * *", () => runDailyIfDue(), { timezone: "America/Santiago" });
  if (config.sheetId) cron.schedule("20 */4 * * *", () => runSheetSyncNow(), { timezone: "America/Santiago" });
  if (config.eventsSheetGid) cron.schedule("40 */4 * * *", () => runEventsSheetSyncNow(), { timezone: "America/Santiago" });
  // Al arrancar se espera un momento para no competir con el inicio del servidor.
  setTimeout(() => runDailyIfDue(), 20000).unref();
  setTimeout(() => runSheetSyncNow(), 25000).unref();
  setTimeout(() => runEventsSheetSyncNow(), 30000).unref();
}
