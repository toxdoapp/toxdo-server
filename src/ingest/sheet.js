// Sincroniza beneficios desde un Google Sheet público, sin usar IA ni costo de tokens.
// El Sheet lo arma la persona dueña del proyecto (a mano o con un scraper propio), una fila por beneficio.
// Convierte cada fila al mismo formato que usa la ingesta con IA y la guarda con sanitizeOffer/saveOffers,
// así que nunca choca con lo que la IA ya cargó: cada fuente solo reemplaza sus propias ofertas.
import { entityById } from "../catalog.js";
import { config } from "../env.js";
import { clip, isIsoDate, normalize, todayCL } from "../text.js";
import { sanitizeOffer, saveOffers } from "./benefits.js";

// Nombres de columna tal como deben estar escritos en la primera fila del Sheet.
const HEADERS = {
  status: "Status",
  startDate: "Fecha_de_Inicio",
  endDate: "Fecha_de_Fin",
  title: "title",
  description: "description",
  discount: "discount",
  country: "Pais",
  region: "Region",
  category: "Categoria",
  bank: "bank",
  cap: "Tope",
  installments: "Cuotas",
  tier: "Nivel_Brand",
  cardType: "Tipo_Tarjeta",
  // El encabezado real del Sheet dice "Codiciones" (sin la "n"); se deja tal cual está escrito.
  conditions: "Codiciones",
  scope: "Alcance",
  url: "URL_Beneficio",
};

// Nombres de cada entidad tal como puede escribirlos el Sheet, en minúsculas y sin tildes.
// Si el scraper usa otro nombre para un banco, agrega el alias aquí.
const ENTITY_ALIASES = {
  banco_chile: ["banco de chile", "banco chile"],
  santander: ["santander"],
  bci: ["bci"],
  banco_estado: ["bancoestado", "banco estado"],
  scotiabank: ["scotiabank", "scotia"],
  itau: ["itau"],
  bice: ["bice"],
  consorcio: ["consorcio"],
  banco_falabella: ["cmr falabella", "banco falabella", "cmr"],
  banco_ripley: ["ripley"],
  coopeuch: ["coopeuch"],
  cencosud_scotiabank: ["cencosud"],
  lider_bci: ["lider bci", "lider"],
  tenpo: ["tenpo"],
  mach: ["mach"],
  mercado_pago: ["mercado pago", "mercadopago"],
  entel: ["entel"],
  movistar: ["movistar"],
  claro: ["claro"],
  wom: ["wom"],
  vtr: ["vtr"],
  caja_los_andes: ["caja los andes", "los andes"],
  la_araucana: ["la araucana", "araucana"],
  los_heroes: ["los heroes"],
  caja_18: ["caja 18", "caja18"],
  banmedica: ["banmedica"],
  colmena: ["colmena"],
  consalud: ["consalud"],
  cruzblanca: ["cruzblanca", "cruz blanca"],
  nueva_masvida: ["masvida", "nueva masvida"],
  vidatres: ["vida tres", "vidatres"],
  copec: ["copec"],
  shell: ["shell"],
  aramco: ["aramco"],
  club_la_tercera: ["la tercera"],
  club_lectores: ["club de lectores", "el mercurio"],
  latam_pass: ["latam pass", "latam"],
  puntos_cencosud: ["puntos cencosud"],
  tarjeta_joven: ["tarjeta joven", "injuv"],
};

// Palabras de la columna Categoria que describen el alcance o la moneda del beneficio, no su rubro.
const CATEGORY_IGNORE = new Set([
  "regiones", "nacional", "rm", "elite", "general", "otros", "verano", "fpuntos", "sustentable",
  "cmr puntos", "dolares premio", "pago en cuotas", "cuotas sin interes", "beneficios y descuentos",
]);

// Palabra del Sheet -> categoría de la app. Si una fila no calza con ninguna, cae en cat_services.
const CATEGORY_WORDS = {
  antojos: "cat_restaurants",
  restaurantes: "cat_restaurants",
  restaurant: "cat_restaurants",
  comida: "cat_restaurants",
  gastronomia: "cat_restaurants",
  cafeterias: "cat_restaurants",
  delivery: "cat_restaurants",
  sabores: "cat_restaurants",
  mercado: "cat_supermarkets",
  supermercado: "cat_supermarkets",
  supermercados: "cat_supermarkets",
  combustible: "cat_fuel",
  bencina: "cat_fuel",
  tiendas: "cat_retail",
  retail: "cat_retail",
  moda: "cat_retail",
  catalogo: "cat_retail",
  mascotas: "cat_retail",
  viajes: "cat_travel",
  viaje: "cat_travel",
  turismo: "cat_travel",
  transporte: "cat_travel",
  entretencion: "cat_entertainment",
  entretension: "cat_entertainment",
  cine: "cat_entertainment",
  musica: "cat_entertainment",
  panoramas: "cat_entertainment",
  panorama: "cat_entertainment",
  salud: "cat_health",
  farmacia: "cat_health",
  belleza: "cat_wellness",
  bienestar: "cat_wellness",
  deporte: "cat_wellness",
  gimnasio: "cat_wellness",
  hogar: "cat_home",
  educacion: "cat_education",
  servicios: "cat_services",
  suscripciones: "cat_services",
};

const DAY_WORDS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

export function matchEntity(rawBank) {
  const value = normalize(rawBank);
  if (!value) return null;
  let best = null;
  for (const [entityId, aliases] of Object.entries(ENTITY_ALIASES)) {
    for (const alias of aliases) {
      if (value.includes(alias) && (!best || alias.length > best.aliasLength)) best = { entityId, aliasLength: alias.length };
    }
  }
  return best ? entityById.get(best.entityId) ?? null : null;
}

export function matchCategory(rawCategory) {
  for (const tag of String(rawCategory ?? "").split(",")) {
    const n = normalize(tag);
    if (!n || CATEGORY_IGNORE.has(n)) continue;
    if (CATEGORY_WORDS[n]) return CATEGORY_WORDS[n];
    for (const [word, catId] of Object.entries(CATEGORY_WORDS)) {
      if (n.includes(word)) return catId;
    }
  }
  return "cat_services";
}

export function parseDiscount(rawDiscount) {
  const text = String(rawDiscount ?? "").trim();
  const m = text.match(/(\d{1,3})\s*%/);
  if (m) {
    const pct = Math.max(0, Math.min(100, Number.parseInt(m[1], 10)));
    return { pct, label: `${pct}%` };
  }
  return { pct: 0, label: clip(text, 28) || "Beneficio" };
}

// Acepta DD-MM-YYYY (como lo escribe el Sheet) o AAAA-MM-DD. Entrega AAAA-MM-DD o cadena vacía.
export function parseDate(rawDate) {
  const text = String(rawDate ?? "").trim();
  if (isIsoDate(text)) return text;
  const m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return "";
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : "";
}

export function parseDays(rawConditions) {
  const text = normalize(rawConditions);
  const found = new Set();
  for (const [word, num] of Object.entries(DAY_WORDS)) if (text.includes(word)) found.add(num);
  return found.size === 7 ? [] : [...found].sort();
}

export function parseChannel(rawScope) {
  const text = normalize(rawScope);
  const presencial = text.includes("presencial");
  const online = text.includes("online");
  if (presencial && !online) return "presencial";
  if (online && !presencial) return "online";
  return "ambos";
}

export function parseRegions(rawRegion) {
  const text = String(rawRegion ?? "").trim();
  if (!text || /^nacional$/i.test(text)) return [];
  return text
    .split(",")
    .map((r) => clip(r.trim() === "RM" ? "Región Metropolitana" : r.trim(), 60))
    .filter(Boolean);
}

const displayDate = (iso) => (iso ? iso.split("-").reverse().join("-") : "");

// Lee el Sheet con la API pública "gviz": no necesita autenticación, basta con que el documento
// esté compartido como "Cualquier persona con el enlace, Lector".
async function fetchRows(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url, { headers: { Accept: "text/plain" } });
  if (!res.ok) {
    throw new Error(`No se pudo leer el Sheet (${res.status}). Revisa que esté compartido como "Cualquier persona con el enlace, Lector".`);
  }
  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("El Sheet no devolvió datos. Revisa el ID y que la pestaña (gid) exista.");
  const json = JSON.parse(text.slice(start, end + 1));
  const cols = (json.table.cols || []).map((c) => String(c.label || "").trim());
  const index = Object.fromEntries(Object.entries(HEADERS).map(([key, header]) => [key, cols.indexOf(header)]));
  const missing = Object.entries(index).filter(([, i]) => i < 0).map(([key]) => HEADERS[key]);
  if (missing.length) throw new Error(`Faltan columnas en el Sheet: ${missing.join(", ")}`);
  // Google tipa columnas como "Fecha_de_Fin" o "discount" como fecha/número y manda el valor crudo
  // en "v" (p. ej. "Date(2026,10,13)" o 0.4). El texto que de verdad queremos ("13-11-2026", "40%")
  // viene en "f", el valor formateado tal como se ve en el Sheet.
  const cell = (row, key) => {
    const c = row.c?.[index[key]];
    if (!c) return "";
    if (typeof c.f === "string" && c.f !== "") return c.f;
    return c.v != null ? c.v : "";
  };
  return (json.table.rows || []).map((row) => Object.fromEntries(Object.keys(HEADERS).map((key) => [key, cell(row, key)])));
}

export async function syncSheet({ log = console.log } = {}) {
  const sheetId = config.sheetId;
  if (!sheetId) return { skipped: true, reason: "no_sheet_configured" };

  const today = todayCL();
  const rows = await fetchRows(sheetId, config.sheetGid);

  const byEntity = new Map();
  const unmatchedBanks = new Set();
  let skippedInactive = 0;
  let skippedCountry = 0;
  let skippedExpired = 0;

  for (const row of rows) {
    if (String(row.status ?? "").trim().toLowerCase() !== "active") {
      skippedInactive += 1;
      continue;
    }
    if (row.country && !/^chile$/i.test(String(row.country).trim())) {
      skippedCountry += 1;
      continue;
    }
    const entity = matchEntity(row.bank);
    if (!entity) {
      if (row.bank) unmatchedBanks.add(String(row.bank).trim());
      continue;
    }
    const expiresAt = parseDate(row.endDate);
    if (expiresAt && expiresAt < today) {
      skippedExpired += 1;
      continue;
    }

    const merchant = clip(String(row.title ?? "").trim(), 60) || entity.name;
    const { pct, label } = parseDiscount(row.discount);
    const startIso = parseDate(row.startDate);
    const validity = expiresAt ? `Hasta el ${displayDate(expiresAt)}` : startIso ? `Desde el ${displayDate(startIso)}` : "";
    const conditionParts = [
      row.tier && !/^general$/i.test(String(row.tier)) ? `Nivel ${row.tier}` : "",
      row.cap && !/^(n\/a|sin tope)$/i.test(String(row.cap)) ? `Tope: ${row.cap}` : "",
      Number(row.installments) > 0 ? `${row.installments} cuotas` : "",
    ].filter(Boolean);

    const raw = {
      merchant,
      merchantDomain: "",
      title: `${label} en ${merchant}`,
      description: clip(String(row.description ?? "").trim(), 400) || merchant,
      discountLabel: label,
      discountPct: pct,
      categoryId: matchCategory(row.category),
      days: parseDays(row.conditions),
      validity,
      expiresAt,
      conditions: conditionParts.join(". "),
      paymentMethods: clip(String(row.cardType ?? "").trim(), 200),
      channel: parseChannel(row.scope),
      regions: parseRegions(row.region),
      benefitUrl: String(row.url ?? "").trim(),
      isFeatured: pct >= 40,
    };

    const offer = sanitizeOffer(raw, today);
    if (!offer) continue;
    if (!byEntity.has(entity.id)) byEntity.set(entity.id, []);
    const list = byEntity.get(entity.id);
    // Tope alto solo para frenar una carga descontrolada del Sheet, no para recortar el catálogo real.
    if (list.length < 1000) list.push(offer);
  }

  let savedEntities = 0;
  let savedOffers = 0;
  for (const [entityId, offers] of byEntity) {
    const entity = entityById.get(entityId);
    const result = await saveOffers(entity, offers, {
      source: "sheet",
      sourceUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
      replaceSources: ["sheet"],
      // Sin avisos: el Sheet trae cientos de filas por corrida y correrá varias veces al día,
      // así que avisar "nuevo beneficio" por cada una saturaría las Novedades de la app.
      announce: false,
    });
    savedEntities += 1;
    savedOffers += result.found;
    log(`[sheet] ${entityId}: ${result.found} encontrados, ${result.created} nuevos, ${result.deactivated} desactivados`);
  }

  if (unmatchedBanks.size) log(`[sheet] bancos sin reconocer, revisa ENTITY_ALIASES: ${[...unmatchedBanks].join(", ")}`);

  return { entities: savedEntities, offers: savedOffers, skippedInactive, skippedCountry, skippedExpired, unmatchedBanks: [...unmatchedBanks] };
}
