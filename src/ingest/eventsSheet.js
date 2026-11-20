// Sincroniza eventos desde una segunda pestaña del mismo Google Sheet de beneficios.
// Pensada para alimentarse de una búsqueda que corre FUERA del servidor (por ejemplo, Claude
// Code en modo headless con el crédito del Agent SDK incluido en la suscripción), no con la IA
// del servidor ni con costo de API. El servidor solo lee, valida y geocodifica.
import { config } from "../env.js";
import { geocode } from "../geo.js";
import { db } from "../firebase.js";
import { clip, isIsoDate, normalize, slug, todayCL } from "../text.js";
import { eventCategoryIds } from "../catalog.js";
import { sanitizeEvent, saveEvents } from "./events.js";

const WINDOW_DAYS = 60;

// Nombres de columna tal como deben estar escritos en la primera fila de la pestaña.
const HEADERS = {
  status: "Status",
  country: "Pais",
  city: "Ciudad",
  region: "Region",
  title: "title",
  description: "description",
  category: "category",
  venue: "venue",
  address: "address",
  commune: "commune",
  startDate: "Fecha_de_Inicio",
  endDate: "Fecha_de_Fin",
  startTime: "Hora",
  priceLabel: "Precio",
  isFree: "Gratis",
  url: "URL",
};

function parseDate(rawDate) {
  const text = String(rawDate ?? "").trim();
  if (isIsoDate(text)) return text;
  const m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return "";
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : "";
}

function parseCategory(raw) {
  const n = normalize(raw);
  return eventCategoryIds.includes(n) ? n : "other";
}

function parseFree(raw) {
  const n = normalize(raw);
  return n === "si" || n === "true" || n === "1" || n === "gratis";
}

// Misma técnica que el Sheet de beneficios: la API pública "gviz" no necesita autenticación,
// solo que la pestaña esté compartida como "Cualquier persona con el enlace, Lector".
async function fetchRows(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url, { headers: { Accept: "text/plain" } });
  if (!res.ok) {
    throw new Error(`No se pudo leer la pestaña de eventos (${res.status}). Revisa que esté compartida como "Cualquier persona con el enlace, Lector".`);
  }
  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("La pestaña de eventos no devolvió datos. Revisa el ID y el gid.");
  const json = JSON.parse(text.slice(start, end + 1));
  const cols = (json.table.cols || []).map((c) => String(c.label || "").trim());
  const index = Object.fromEntries(Object.entries(HEADERS).map(([key, header]) => [key, cols.indexOf(header)]));
  const missing = Object.entries(index).filter(([, i]) => i < 0).map(([key]) => HEADERS[key]);
  if (missing.length) throw new Error(`Faltan columnas en la pestaña de eventos: ${missing.join(", ")}`);
  const cell = (row, key) => {
    const c = row.c?.[index[key]];
    if (!c) return "";
    if (typeof c.f === "string" && c.f !== "") return c.f;
    return c.v != null ? c.v : "";
  };
  return (json.table.rows || []).map((row) => Object.fromEntries(Object.keys(HEADERS).map((key) => [key, cell(row, key)])));
}

export async function syncEventsSheet({ log = console.log } = {}) {
  const sheetId = config.sheetId;
  const gid = config.eventsSheetGid;
  if (!sheetId || !gid) return { skipped: true, reason: "no_events_sheet_configured" };

  const today = todayCL();
  const until = todayCL(WINDOW_DAYS);
  const rows = await fetchRows(sheetId, gid);

  const byCity = new Map();
  let skippedInactive = 0;
  let skippedCountry = 0;
  let skippedInvalid = 0;

  for (const row of rows) {
    if (String(row.status ?? "").trim().toLowerCase() !== "active") {
      skippedInactive += 1;
      continue;
    }
    if (row.country && !/^chile$/i.test(String(row.country).trim())) {
      skippedCountry += 1;
      continue;
    }
    const city = clip(String(row.city ?? "").trim(), 60);
    if (!city) {
      skippedInvalid += 1;
      continue;
    }
    const raw = {
      title: String(row.title ?? "").trim(),
      description: String(row.description ?? "").trim(),
      category: parseCategory(row.category),
      venue: String(row.venue ?? "").trim(),
      address: String(row.address ?? "").trim(),
      commune: String(row.commune ?? "").trim(),
      startDate: parseDate(row.startDate),
      endDate: parseDate(row.endDate) || parseDate(row.startDate),
      startTime: String(row.startTime ?? "").trim(),
      priceLabel: String(row.priceLabel ?? "").trim(),
      isFree: parseFree(row.isFree),
      url: String(row.url ?? "").trim(),
    };
    const event = sanitizeEvent(raw, today, until);
    if (!event) {
      skippedInvalid += 1;
      continue;
    }
    const region = clip(String(row.region ?? "").trim(), 60);
    const key = `${city}|${region}`;
    if (!byCity.has(key)) byCity.set(key, { city, region, events: [] });
    byCity.get(key).events.push(event);
  }

  // Geocodifica el centro de cada ciudad una sola vez, aunque tenga muchos eventos.
  const centerCache = new Map();
  const resolveCenter = async (city, region) => {
    const key = normalize(`${city} ${region}`);
    if (centerCache.has(key)) return centerCache.get(key);
    const where = region && normalize(region) !== normalize(city) ? `${city}, ${region}, Chile` : `${city}, Chile`;
    const center = await geocode(where).catch(() => null);
    centerCache.set(key, center);
    return center;
  };

  let savedCities = 0;
  let savedEvents = 0;
  const sourceUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  for (const { city, region, events } of byCity.values()) {
    const cityKey = slug(city);
    const center = await resolveCenter(city, region);
    const saved = await saveEvents(events, { city, cityKey, center, source: "sheet", sourceUrl });
    if (db) {
      await db
        .collection("eventCities")
        .doc(cityKey)
        .set({ city, region, cityKey, ...(center || {}) }, { merge: true })
        .catch(() => {});
    }
    savedCities += 1;
    savedEvents += saved;
    log(`[eventos-sheet] ${city}: ${saved} eventos`);
  }

  return { cities: savedCities, events: savedEvents, skippedInactive, skippedCountry, skippedInvalid };
}
