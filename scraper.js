// toxdo-server/scraper.js
// Extrae beneficios bancarios Y de combustible chilenos usando Claude como cerebro de parsing

import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Bancos chilenos y sus URLs de beneficios ────────────────────────────────
const BANK_SOURCES = [
  {
    bankId: "santander",
    name: "Santander",
    urls: [
      "https://www.santander.cl/beneficios-y-descuentos",
      "https://www.santander.cl/descuentos",
    ],
  },
  {
    bankId: "banco_estado",
    name: "BancoEstado",
    urls: ["https://www.bancoestado.cl/imagenes/_personas/productos/beneficios/index.asp"],
  },
  {
    bankId: "scotiabank",
    name: "Scotiabank",
    urls: ["https://www.scotiabank.cl/personas/beneficios-y-descuentos.html"],
  },
  {
    bankId: "bci",
    name: "BCI",
    urls: ["https://www.bci.cl/personas/beneficios"],
  },
  {
    bankId: "itau",
    name: "Itaú",
    urls: ["https://www.itau.cl/beneficios"],
  },
  {
    bankId: "falabella",
    name: "CMR Falabella",
    urls: ["https://www.falabella.com/falabella-cl/category/cat10001/Beneficios-CMR"],
  },
  {
    bankId: "bice",
    name: "BICE",
    urls: ["https://www.bice.cl/personas/tarjetas/beneficios"],
  },
];

// categoryIds válidos en Firestore
const VALID_CATEGORIES = [
  "cat_restaurants", "cat_fuel", "cat_travel",
  "cat_entertainment", "cat_health", "cat_retail", "cat_supermarkets",
];

// ─── Fetch HTML y extrae texto limpio ────────────────────────────────────────
async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-CL,es;q=0.9,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  // Eliminar ruido: scripts, estilos, nav, footer, modales
  $("script, style, nav, footer, header, .cookie-banner, .modal, iframe, noscript").remove();

  // Priorizar secciones que probablemente tienen ofertas
  const selectors = [
    ".beneficios", ".descuentos", ".ofertas", ".deals", ".promotions",
    "[class*='benefit']", "[class*='discount']", "[class*='offer']",
    "main", "article", "#main-content", ".main-content",
  ];

  let text = "";
  for (const sel of selectors) {
    const found = $(sel).text();
    if (found.length > 200) { text = found; break; }
  }

  // Fallback al body completo si no encontró secciones específicas
  if (text.length < 200) text = $("body").text();

  // Limpiar espacios y truncar a 10000 chars (límite seguro para Haiku)
  return text.replace(/\s+/g, " ").trim().slice(0, 10000);
}

// ─── Claude extrae ofertas estructuradas desde texto de la página ─────────────
async function extractOffersWithClaude(pageText, bank) {
  if (!pageText || pageText.length < 50) return [];

  const prompt = `Eres un extractor experto de beneficios bancarios chilenos.

Analiza este texto de la página de beneficios de ${bank.name} y extrae TODOS los descuentos o beneficios que encuentres.

Devuelve un JSON array. Cada objeto debe tener EXACTAMENTE estos campos:
- "title": string — nombre del beneficio (máx 60 chars)
- "description": string — descripción breve (máx 130 chars)
- "discountLabel": string — ej: "20% dcto", "2x1", "$5.000 off", "Cuotas sin interés", o "Beneficio"
- "categoryId": string — SOLO uno de: ${VALID_CATEGORIES.join(", ")}
- "benefitUrl": string — URL directa si aparece en el texto, si no ""
- "validity": string — texto de vigencia legible, ej: "Válido hasta dic 2026" o ""
- "expiresAt": string — fecha ISO si puedes inferirla, ej: "2026-12-31" o ""
- "isFeatured": boolean — true si parece ser oferta principal o destacada
- "isLastMinute": boolean — true si expira hoy, esta semana, o dice "últimos días"
- "imageUrl": string — URL de imagen si aparece en el texto, si no ""

Reglas:
1. Si un beneficio es vago o genérico (ej: "Más beneficios para ti"), omítelo
2. categoryId debe ser lo más preciso posible según el comercio/rubro
3. Devuelve SOLO el JSON array, sin texto adicional ni markdown

Texto de la página de ${bank.name}:
${pageText}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = msg.content[0].type === "text" ? msg.content[0].text : "";

  // Extraer el JSON array de la respuesta
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const offers = JSON.parse(jsonMatch[0]);
    // Validar que cada oferta tenga categoryId válido
    return offers.filter(o =>
      o.title && o.title.length > 3 && VALID_CATEGORIES.includes(o.categoryId)
    );
  } catch {
    return [];
  }
}

// ─── Genera un ID estable para evitar duplicados en Firestore ─────────────────
function stableOfferId(bankId, title) {
  const slug = title.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // quitar tildes
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40);
  return `${bankId}_${slug}`;
}

// ─── Función principal exportada — scraping de todos los bancos ───────────────
export async function scrapeAllBanks(db) {
  const results = { success: [], errors: [], totalNew: 0 };

  for (const bank of BANK_SOURCES) {
    let bankOffers = [];

    for (const url of bank.urls) {
      try {
        console.log(`  → Fetching ${url}`);
        const pageText = await fetchPageText(url);
        const offers = await extractOffersWithClaude(pageText, bank);
        bankOffers = [...bankOffers, ...offers];

        // Pausa entre URLs del mismo banco
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`  ⚠️ ${url}: ${err.message}`);
      }
    }

    if (bankOffers.length === 0) {
      results.errors.push({ bank: bank.name, error: "Sin ofertas extraídas" });
      continue;
    }

    // Guardar en Firestore con merge (no sobreescribe datos editados manualmente)
    let savedCount = 0;
    for (const offer of bankOffers) {
      try {
        const docId = stableOfferId(bank.bankId, offer.title);
        await db.collection("offers").doc(docId).set(
          {
            ...offer,
            bankId: bank.bankId,
            source: "scraper_ai",
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        savedCount++;
      } catch (err) {
        console.warn(`  ⚠️ Error guardando oferta: ${err.message}`);
      }
    }

    console.log(`✅ ${bank.name}: ${savedCount}/${bankOffers.length} ofertas guardadas`);
    results.success.push({ bank: bank.name, found: bankOffers.length, saved: savedCount });
    results.totalNew += savedCount;

    // Pausa entre bancos para no saturar
    await new Promise(r => setTimeout(r, 3000));
  }

  return results;
}

// ─── Scraping de un banco específico (para pruebas) ───────────────────────────
export async function scrapeBank(db, bankId) {
  const bank = BANK_SOURCES.find(b => b.bankId === bankId);
  if (!bank) throw new Error(`Banco "${bankId}" no encontrado`);
  return scrapeAllBanks(db); // reusar lógica, filtrar solo el banco pedido
}

// ─── Compañías de combustible chilenas ────────────────────────────────────────
export const FUEL_SOURCES = [
  {
    bankId: "copec",
    name: "Copec",
    deepLink: "copec://",           // scheme de la app "Copec a tu Lado"
    fallbackUrl: "https://apps.apple.com/cl/app/copec-a-tu-lado/id1089176411",
    urls: [
      "https://www.copec.cl/personas/beneficios",
      "https://www.copec.cl/convenios",
    ],
  },
  {
    bankId: "shell",
    name: "Shell",
    deepLink: "shellbox://",        // scheme de la app "Shell Box"
    fallbackUrl: "https://apps.apple.com/cl/app/shell-box/id1327106414",
    urls: [
      "https://www.shell.cl/motoristas/ofertas-y-descuentos.html",
      "https://www.shell.cl/descuentos",
    ],
  },
  {
    bankId: "aramco",
    name: "Aramco",
    deepLink: null,
    fallbackUrl: "https://www.aramco.com",
    urls: [
      "https://www.aramco.com/es/beneficios",
    ],
  },
  {
    bankId: "petrobras",
    name: "Petrobras",
    deepLink: null,
    fallbackUrl: "https://www.petrobras.cl",
    urls: [
      "https://www.petrobras.cl/beneficios-y-descuentos",
      "https://www.petrobras.cl/descuentos",
    ],
  },
];

// ─── Scraping de compañías de combustible ─────────────────────────────────────
export async function scrapeFuelCompanies(db) {
  const results = { success: [], errors: [], totalNew: 0 };

  for (const fuel of FUEL_SOURCES) {
    let fuelOffers = [];

    for (const url of fuel.urls) {
      try {
        console.log(`  ⛽ Fetching ${url}`);
        const pageText = await fetchPageText(url);
        // Reusa el mismo extractor de Claude pero con contexto de combustible
        const offers = await extractFuelOffersWithClaude(pageText, fuel);
        fuelOffers = [...fuelOffers, ...offers];
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`  ⚠️ ${url}: ${err.message}`);
      }
    }

    if (fuelOffers.length === 0) {
      results.errors.push({ company: fuel.name, error: "Sin ofertas extraídas" });
      continue;
    }

    let savedCount = 0;
    for (const offer of fuelOffers) {
      try {
        const docId = stableOfferId(fuel.bankId, offer.title);
        await db.collection("offers").doc(docId).set(
          {
            ...offer,
            bankId: fuel.bankId,
            categoryId: "cat_fuel",
            deepLink: fuel.deepLink || null,
            source: "scraper_fuel",
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        savedCount++;
      } catch (err) {
        console.warn(`  ⚠️ Error guardando: ${err.message}`);
      }
    }

    console.log(`✅ ${fuel.name}: ${savedCount} ofertas guardadas`);
    results.success.push({ company: fuel.name, found: fuelOffers.length, saved: savedCount });
    results.totalNew += savedCount;
    await new Promise(r => setTimeout(r, 3000));
  }

  return results;
}

// Extractor específico para combustible (más enfocado que el bancario)
async function extractFuelOffersWithClaude(pageText, fuel) {
  if (!pageText || pageText.length < 50) return [];

  const prompt = `Eres un extractor de beneficios de empresas de combustible chilenas.

Analiza este texto de ${fuel.name} y extrae descuentos, convenios y beneficios para automovilistas.

Devuelve un JSON array. Cada objeto debe tener:
- "title": string — nombre del beneficio (máx 60 chars)
- "description": string — descripción (máx 130 chars)
- "discountLabel": string — ej: "$50/L dcto", "5% off", "Puntos dobles", o "Beneficio"
- "benefitUrl": string — URL directa si aparece, si no ""
- "validity": string — texto de vigencia, ej: "Válido hasta dic 2026" o ""
- "isFeatured": boolean
- "isLastMinute": boolean — true si dice "últimas horas", "hoy" o "esta semana"
- "imageUrl": string — URL de imagen si aparece, si no ""

Devuelve SOLO el JSON array. Si no hay beneficios claros, devuelve [].

Texto de ${fuel.name}:
${pageText}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = msg.content[0].type === "text" ? msg.content[0].text : "";
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]).filter(o => o.title && o.title.length > 3);
  } catch {
    return [];
  }
}

export { BANK_SOURCES };
