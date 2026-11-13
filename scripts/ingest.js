// Ejecuta la ingesta con IA desde la terminal.
//   node scripts/ingest.js benefits                 actualiza las entidades más atrasadas
//   node scripts/ingest.js benefits bci santander   actualiza entidades específicas
//   node scripts/ingest.js events "Viña del Mar" "Valparaíso"
import "../src/env.js";
import { aiConfigured } from "../src/ai.js";
import { config } from "../src/env.js";
import { firebaseReady } from "../src/firebase.js";
import { ingestDue } from "../src/ingest/benefits.js";
import { refreshCity } from "../src/ingest/events.js";

const [kind, ...args] = process.argv.slice(2);

if (!firebaseReady()) {
  console.error("Falta FIREBASE_SERVICE_ACCOUNT en .env");
  process.exit(1);
}
if (!aiConfigured()) {
  console.error("Falta una ANTHROPIC_API_KEY válida en .env");
  process.exit(1);
}

try {
  if (kind === "benefits") {
    const results = await ingestDue({ entityIds: args.length ? args : null, limit: config.entitiesPerDay });
    console.table(results.map(({ entityId, ok, mode, found, created, deactivated, error }) => ({ entityId, ok, mode, found, created, deactivated, error })));
  } else if (kind === "events") {
    if (!args.length) throw new Error("Indica al menos una ciudad");
    for (const city of args) {
      const result = await refreshCity({ city, force: true, wait: true });
      console.log(city, result);
    }
  } else {
    console.log("Uso: node scripts/ingest.js benefits [entidades...] | events <ciudad> [ciudad...]");
  }
  process.exit(0);
} catch (err) {
  console.error("Falló:", err.message);
  process.exit(1);
}
