// Carga el contenido inicial curado a mano desde data/. Sirve para partir con datos reales
// antes de que la ingesta con IA esté activa. Se puede ejecutar más de una vez sin duplicar.
//   node scripts/seed.js            carga ofertas y eventos
//   node scripts/seed.js offers     solo ofertas
//   node scripts/seed.js events     solo eventos
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../src/env.js";
import { entityById } from "../src/catalog.js";
import { db, firebaseReady } from "../src/firebase.js";
import { sanitizeOffer, saveOffers } from "../src/ingest/benefits.js";
import { sanitizeEvent, saveEvents } from "../src/ingest/events.js";
import { slug, todayCL } from "../src/text.js";

if (!firebaseReady()) {
  console.error("Falta FIREBASE_SERVICE_ACCOUNT en .env");
  process.exit(1);
}

const what = process.argv[2] || "all";
const readJson = (name) => {
  const file = path.join(ROOT, "data", name);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
const today = todayCL();

if (what === "all" || what === "offers") {
  const seed = readJson("seed-offers.json") || {};
  let total = 0;
  for (const [entityId, block] of Object.entries(seed)) {
    const entity = entityById.get(entityId);
    if (!entity) {
      console.warn(`Entidad desconocida en la semilla: ${entityId}`);
      continue;
    }
    const offers = block.offers.map((o) => sanitizeOffer(o, today)).filter(Boolean);
    const saved = await saveOffers(entity, offers, { source: "curated", sourceUrl: block.sourceUrl, replaceSources: ["curated"], announce: false });
    total += saved.found;
    console.log(`${entity.name}: ${saved.found} ofertas, ${saved.created} nuevas, ${saved.deactivated} desactivadas`);
  }
  console.log(`Ofertas cargadas: ${total}`);
}

if (what === "all" || what === "events") {
  const seed = readJson("seed-events.json") || [];
  const until = todayCL(120);
  let total = 0;
  for (const block of seed) {
    const events = block.events.map((e) => sanitizeEvent(e, today, until)).filter(Boolean);
    const center = { lat: block.lat, lng: block.lng };
    const saved = await saveEvents(events, { city: block.city, cityKey: slug(block.city), center, source: "curated" });
    await db.collection("eventCities").doc(slug(block.city)).set({ city: block.city, region: block.region || "", cityKey: slug(block.city), ...center }, { merge: true });
    total += saved;
    console.log(`${block.city}: ${saved} eventos`);
  }
  console.log(`Eventos cargados: ${total}`);
}

process.exit(0);
