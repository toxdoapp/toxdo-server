// Sucursales de los comercios con beneficio. Se buscan en OpenStreetMap (Overpass) para todo
// Chile y se guardan en Firestore agrupadas por celda. Así la app las lee al instante y no
// depende de servicios públicos que suelen estar saturados.
import { FieldValue, db } from "../firebase.js";
import { normalize, shortHash, sleep } from "../text.js";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const USER_AGENT = "ToXdo/2.0 (toxdoapp@gmail.com)";
const CHUNK = 6;
const ATTEMPTS = 6;
const REFRESH_DAYS = 14;
const MAX_PER_MERCHANT = 3000;
/** Celdas de 0,1 grados, unos 11 km. La app usa la misma fórmula. */
export const cellOf = (lat, lng) => `${Math.floor(lat * 10)}_${Math.floor(lng * 10)}`;

const VOWELS = { a: "(a|á)", e: "(e|é)", i: "(i|í)", o: "(o|ó)", u: "(u|ú|ü)", n: "(n|ñ)" };

// Expresión para Overpass: tolera tildes, apóstrofos y espacios ("Papa Johns" calza con "Papa John's").
export function overpassPattern(name) {
  return normalize(name)
    .split(" ")
    .map((word) => (word.length > 3 && word.endsWith("s") ? `${word.slice(0, -1)}.?s` : word))
    .map((word) => word.replace(/[aeioun]/g, (c) => VOWELS[c]))
    .join(".?");
}

// Comprobación estricta en el servidor: el nombre debe partir con el comercio completo.
export function matcher(name) {
  const letters = normalize(name).replace(/ /g, "").split("").join(" ?");
  return new RegExp(`^${letters}( |$)`);
}

export async function activeMerchants() {
  const snap = await db.collection("offers").where("schema", "==", 2).where("active", "==", true).get();
  const byKey = new Map();
  for (const doc of snap.docs) {
    const offer = doc.data();
    if (offer.channel === "online" || !offer.merchantKey) continue;
    if (normalize(offer.merchant).replace(/ /g, "").length < 4) continue;
    byKey.set(offer.merchantKey, offer.merchant);
  }
  return [...byKey].map(([key, name]) => ({ key, name })).sort((a, b) => a.key.localeCompare(b.key));
}

const merchantsHash = (merchants) => shortHash(merchants.map((m) => m.key).join("|"));

function buildQuery(merchants) {
  const regex = `^(${merchants.map((m) => overpassPattern(m.name)).join("|")})`;
  const named = ["shop", "amenity", "tourism", "leisure"].map((key) => `nwr["${key}"]["name"~"${regex}",i](area.cl);`).join("");
  return `[out:json][timeout:170];area["ISO3166-1"="CL"][admin_level=2]->.cl;(nwr["brand"~"${regex}",i](area.cl);${named});out tags center;`;
}

async function overpass(query, log) {
  let lastError = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(200000),
      });
      if (!res.ok) throw new Error(`Overpass respondió ${res.status}`);
      const data = await res.json();
      // Overpass avisa de un corte por tiempo dentro de una respuesta 200.
      if (data.remark && /timed out|out of memory/i.test(data.remark)) throw new Error(data.remark.slice(0, 80));
      return data.elements || [];
    } catch (err) {
      lastError = err;
      log(`[sucursales] intento ${attempt + 1} falló (${err.message}). Reintentando.`);
      await sleep(8000 * (attempt + 1));
    }
  }
  throw lastError;
}

function toPlaces(elements, merchants) {
  const tests = merchants.map((m) => ({ key: m.key, test: matcher(m.name), size: normalize(m.name).length })).sort((a, b) => b.size - a.size);
  const places = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const brand = normalize(el.tags?.brand);
    const name = normalize(el.tags?.name);
    const match = tests.find((t) => t.test.test(brand) || t.test.test(name));
    if (!match) continue;
    places.push({
      id: `${el.type[0]}${el.id}`,
      name: String(el.tags?.name || el.tags?.brand || "").slice(0, 80),
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      merchantKey: match.key,
    });
  }
  return places;
}

// Busca las sucursales de todos los comercios y reemplaza las celdas guardadas.
export async function refreshPlaces({ log = console.log } = {}) {
  if (!db) throw new Error("Firestore no está disponible");
  const merchants = await activeMerchants();
  const col = db.collection("placeCells");
  const previous = await col.get();
  const all = [];
  let failed = 0;
  for (let i = 0; i < merchants.length; i += CHUNK) {
    const group = merchants.slice(i, i + CHUNK);
    try {
      const found = toPlaces(await overpass(buildQuery(group), log), group);
      log(`[sucursales] ${group.map((m) => m.name).join(", ")}: ${found.length}`);
      all.push(...found);
    } catch (err) {
      // Si un grupo no respondió, se conservan sus sucursales anteriores.
      failed += 1;
      const keys = new Set(group.map((m) => m.key));
      for (const doc of previous.docs) all.push(...(doc.data().places || []).filter((p) => keys.has(p.merchantKey)));
      log(`[sucursales] ${group.map((m) => m.name).join(", ")}: sin respuesta, se conserva lo anterior`);
    }
    await sleep(4000);
  }
  if (failed * CHUNK >= merchants.length && merchants.length > 0) throw new Error("Overpass no respondió a ninguna consulta");

  const cells = new Map();
  const seen = new Set();
  const perMerchant = new Map();
  for (const place of all) {
    // Evita repetir un local que OSM tiene como punto y como edificio.
    const spot = `${place.merchantKey}:${place.lat.toFixed(4)}:${place.lng.toFixed(4)}`;
    const count = perMerchant.get(place.merchantKey) || 0;
    if (seen.has(spot) || count >= MAX_PER_MERCHANT) continue;
    seen.add(spot);
    perMerchant.set(place.merchantKey, count + 1);
    const cell = cellOf(place.lat, place.lng);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(place);
  }

  let batch = db.batch();
  let pending = 0;
  const flush = async (force) => {
    if (pending === 0 || (!force && pending < 300)) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };
  for (const [cell, places] of cells) {
    batch.set(col.doc(cell), { cell, places, count: places.length, updatedAt: FieldValue.serverTimestamp() });
    pending += 1;
    await flush(false);
  }
  for (const doc of previous.docs) {
    if (cells.has(doc.id)) continue;
    batch.delete(doc.ref);
    pending += 1;
    await flush(false);
  }
  await flush(true);

  const summary = { merchants: merchants.length, places: seen.size, cells: cells.size, failedGroups: failed };
  await db.collection("meta").doc("places").set({ ...summary, merchantsHash: merchantsHash(merchants), lastRunAt: FieldValue.serverTimestamp() });
  log(`[sucursales] ${summary.places} sucursales de ${perMerchant.size} comercios en ${summary.cells} celdas`);
  return { ...summary, perMerchant: Object.fromEntries(perMerchant) };
}

// Corre si cambió la lista de comercios o si los datos tienen más de dos semanas.
export async function refreshPlacesIfDue({ log = console.log } = {}) {
  if (!db) return null;
  const snap = await db.collection("meta").doc("places").get();
  const last = snap.exists ? snap.data() : null;
  const ageDays = last?.lastRunAt?.toMillis ? (Date.now() - last.lastRunAt.toMillis()) / 86400000 : Infinity;
  const changed = !last || last.merchantsHash !== merchantsHash(await activeMerchants());
  if (ageDays < 1 || (!changed && ageDays < REFRESH_DAYS)) return null;
  return refreshPlaces({ log });
}
