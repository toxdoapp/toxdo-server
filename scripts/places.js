// Actualiza las sucursales de los comercios con beneficio desde OpenStreetMap.
//   node scripts/places.js
import "../src/env.js";
import { firebaseReady } from "../src/firebase.js";
import { refreshPlaces } from "../src/ingest/places.js";

if (!firebaseReady()) {
  console.error("Falta FIREBASE_SERVICE_ACCOUNT en .env");
  process.exit(1);
}

try {
  const result = await refreshPlaces();
  console.table(result.perMerchant);
  process.exit(0);
} catch (err) {
  console.error("Falló:", err.message);
  process.exit(1);
}
