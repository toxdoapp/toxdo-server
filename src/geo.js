// Geocodificación con Nominatim (OpenStreetMap). Respeta su política de uso:
// una consulta por segundo como máximo, agente identificado y resultados en caché.
import { db } from "./firebase.js";
import { shortHash, sleep } from "./text.js";

const USER_AGENT = "ToXdo/2.0 (toxdoapp@gmail.com)";
const memory = new Map();
let lastCallAt = 0;

async function nominatim(query, near) {
  const wait = lastCallAt + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  const params = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "cl", q: query });
  if (near) {
    // Prefiere resultados cerca de la ciudad consultada, sin excluir el resto.
    const d = 0.35;
    params.set("viewbox", [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(","));
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "es" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const lat = Number(rows[0].lat);
  const lng = Number(rows[0].lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// Devuelve { lat, lng } o null. Guarda también los resultados vacíos para no repetir consultas.
export async function geocode(query, near = null) {
  const q = String(query).replace(/\s+/g, " ").trim();
  if (!q) return null;
  const key = shortHash(q.toLowerCase());
  if (memory.has(key)) return memory.get(key);
  const ref = db ? db.collection("geocodeCache").doc(key) : null;
  if (ref) {
    const snap = await ref.get().catch(() => null);
    if (snap?.exists) {
      const data = snap.data();
      const hit = data.found ? { lat: data.lat, lng: data.lng } : null;
      memory.set(key, hit);
      return hit;
    }
  }
  let hit = null;
  try {
    hit = await nominatim(q, near);
  } catch {
    return null; // Fallo de red: no se guarda, se reintentará después.
  }
  memory.set(key, hit);
  if (ref) await ref.set({ q, found: hit !== null, ...(hit || {}), at: Date.now() }).catch(() => {});
  return hit;
}

export function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
