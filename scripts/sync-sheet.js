// Sincroniza el Sheet de beneficios desde la terminal, sin esperar al cron diario.
//   npm run sync:sheet
import "../src/env.js";
import { config } from "../src/env.js";
import { firebaseReady } from "../src/firebase.js";
import { syncSheet } from "../src/ingest/sheet.js";

if (!firebaseReady()) {
  console.error("Falta FIREBASE_SERVICE_ACCOUNT en .env");
  process.exit(1);
}
if (!config.sheetId) {
  console.error("Falta BENEFITS_SHEET_ID en .env");
  process.exit(1);
}

try {
  const result = await syncSheet();
  console.log(result);
  if (result.unmatchedBanks?.length) {
    console.log("\nBancos sin reconocer (agrégalos a ENTITY_ALIASES en src/ingest/sheet.js):");
    console.log(result.unmatchedBanks.join(", "));
  }
  process.exit(0);
} catch (err) {
  console.error("Falló:", err.message);
  process.exit(1);
}
