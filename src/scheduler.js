// Tareas diarias. Render suspende el servicio gratuito cuando no hay tráfico, así que además del
// cron se revisa si falta la tarea del día cada vez que el servidor despierta o recibe un ping.
import cron from "node-cron";
import { aiConfigured } from "./ai.js";
import { config } from "./env.js";
import { db } from "./firebase.js";
import { expireOffers, ingestDue } from "./ingest/benefits.js";
import { pruneEvents, refreshActiveCities } from "./ingest/events.js";
import { refreshPlacesIfDue } from "./ingest/places.js";
import { todayCL } from "./text.js";

let busy = false;

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

export function startScheduler() {
  if (!config.cronEnabled) return;
  cron.schedule("15 6 * * *", () => runDailyIfDue(), { timezone: "America/Santiago" });
  // Al arrancar se espera un momento para no competir con el inicio del servidor.
  setTimeout(() => runDailyIfDue(), 20000).unref();
}
