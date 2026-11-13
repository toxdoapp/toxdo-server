// toxdo-server/seed.js
// Ejecutar UNA VEZ para poblar Firestore con datos reales iniciales
// Uso: node seed.js
//
// Requiere FIREBASE_SERVICE_ACCOUNT en .env

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

// Leer .env manualmente (sin dotenv)
const envLines = readFileSync(".env", "utf8").split("\n");
for (const line of envLines) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const SEED_OFFERS = [
  // ── COPEC ──────────────────────────────────────────────────────────────────
  {
    id: "copec_25_bencina_visa",
    title: "25% en bencina con Visa",
    description: "Descuento directo en el surtidor pagando con tu tarjeta Visa en estaciones Copec.",
    discountLabel: "25% dcto",
    bankId: "copec",
    categoryId: "cat_fuel",
    isFeatured: true,
    isLastMinute: false,
    validity: "Válido hasta diciembre 2026",
    expiresAt: "2026-12-31",
    benefitUrl: "https://www.copec.cl/beneficios",
    imageUrl: "https://images.unsplash.com/photo-1545609809-5a8286b7613b?w=600",
    region: "",
    source: "seed",
  },
  {
    id: "copec_tag_gratis",
    title: "TAG gratis primer mes",
    description: "Primer mes de TAG gratuito para clientes nuevos que se suscriban a Copec Pay.",
    discountLabel: "Gratis",
    bankId: "copec",
    categoryId: "cat_fuel",
    isFeatured: false,
    isLastMinute: true,
    validity: "Hasta agotar stock",
    expiresAt: "",
    benefitUrl: "https://www.copec.cl/copeypay",
    imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600",
    region: "",
    source: "seed",
  },

  // ── SHELL ──────────────────────────────────────────────────────────────────
  {
    id: "shell_20_mastercard",
    title: "20% en combustible con Mastercard",
    description: "Presenta tu tarjeta Mastercard al pagar en Shell y obtén 20% de descuento en cualquier combustible.",
    discountLabel: "20% dcto",
    bankId: "shell",
    categoryId: "cat_fuel",
    isFeatured: true,
    isLastMinute: false,
    validity: "Lunes a viernes",
    expiresAt: "2026-11-30",
    benefitUrl: "https://www.shell.cl/beneficios",
    imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600",
    region: "",
    source: "seed",
  },

  // ── SANTANDER ──────────────────────────────────────────────────────────────
  {
    id: "santander_30_restaurantes",
    title: "30% en restaurantes seleccionados",
    description: "Paga con tu tarjeta Santander y obtén 30% de descuento en más de 500 restaurantes participantes.",
    discountLabel: "30% dcto",
    bankId: "santander",
    categoryId: "cat_restaurants",
    isFeatured: true,
    isLastMinute: false,
    validity: "Válido todos los días",
    expiresAt: "2026-12-31",
    benefitUrl: "https://www.santander.cl/beneficios",
    imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600",
    region: "",
    source: "seed",
  },
  {
    id: "santander_2x1_cine",
    title: "2x1 en Cinépolis y Cinemark",
    description: "Lleva a alguien al cine pagando solo una entrada con tu tarjeta Santander.",
    discountLabel: "2x1",
    bankId: "santander",
    categoryId: "cat_entertainment",
    isFeatured: true,
    isLastMinute: true,
    validity: "Solo fines de semana",
    expiresAt: "2026-10-31",
    benefitUrl: "https://www.santander.cl/cine",
    imageUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600",
    region: "",
    source: "seed",
  },
  {
    id: "santander_sky_airline",
    title: "15% en vuelos SKY Airline",
    description: "Reserva tu vuelo en sky.cl y aplica el descuento pagando con tarjeta Santander.",
    discountLabel: "15% dcto",
    bankId: "santander",
    categoryId: "cat_travel",
    isFeatured: false,
    isLastMinute: false,
    validity: "Válido hasta noviembre 2026",
    expiresAt: "2026-11-30",
    benefitUrl: "https://www.sky.cl",
    imageUrl: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600",
    region: "",
    source: "seed",
  },

  // ── BCI ────────────────────────────────────────────────────────────────────
  {
    id: "bci_20_supermercado",
    title: "20% en Lider con BCI",
    description: "Descuento todos los martes pagando con tarjeta BCI en cualquier sucursal Lider.",
    discountLabel: "20% dcto",
    bankId: "bci",
    categoryId: "cat_supermarkets",
    isFeatured: true,
    isLastMinute: true,
    validity: "Solo martes",
    expiresAt: "2026-12-31",
    benefitUrl: "https://www.bci.cl/beneficios",
    imageUrl: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=600",
    region: "",
    source: "seed",
  },
  {
    id: "bci_falabella_10",
    title: "10% extra en Falabella",
    description: "Acumula 10% adicional en CMR Puntos comprando en Falabella con tarjeta BCI.",
    discountLabel: "10% extra",
    bankId: "bci",
    categoryId: "cat_retail",
    isFeatured: false,
    isLastMinute: false,
    validity: "Válido en tiendas y online",
    expiresAt: "2026-10-31",
    benefitUrl: "https://www.falabella.com",
    imageUrl: "https://images.unsplash.com/photo-1607082349566-187342175e2f?w=600",
    region: "",
    source: "seed",
  },

  // ── BANCO ESTADO ───────────────────────────────────────────────────────────
  {
    id: "bancoestado_salud_20",
    title: "20% en clínicas Red Salud",
    description: "Presenta tu tarjeta BancoEstado en las clínicas Red Salud y obtén descuento en consultas y exámenes.",
    discountLabel: "20% dcto",
    bankId: "banco_estado",
    categoryId: "cat_health",
    isFeatured: true,
    isLastMinute: false,
    validity: "Lunes a sábado",
    expiresAt: "2026-12-31",
    benefitUrl: "https://www.bancoestado.cl/beneficios",
    imageUrl: "https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=600",
    region: "",
    source: "seed",
  },
  {
    id: "bancoestado_copec_15",
    title: "15% bencina Copec con CuentaRUT",
    description: "Descuento exclusivo para titulares de CuentaRUT en estaciones Copec a nivel nacional.",
    discountLabel: "15% dcto",
    bankId: "banco_estado",
    categoryId: "cat_fuel",
    isFeatured: true,
    isLastMinute: false,
    validity: "Todos los días",
    expiresAt: "2026-12-31",
    benefitUrl: "https://www.bancoestado.cl",
    imageUrl: "https://images.unsplash.com/photo-1545609809-5a8286b7613b?w=600",
    region: "",
    source: "seed",
  },

  // ── SCOTIABANK ─────────────────────────────────────────────────────────────
  {
    id: "scotiabank_lider_25",
    title: "25% en supermercados Jumbo",
    description: "Los jueves con tu tarjeta Scotiabank obtienes 25% en tu compra total en Jumbo.",
    discountLabel: "25% dcto",
    bankId: "scotiabank",
    categoryId: "cat_supermarkets",
    isFeatured: true,
    isLastMinute: true,
    validity: "Solo jueves",
    expiresAt: "2026-12-31",
    benefitUrl: "https://www.scotiabank.cl/beneficios",
    imageUrl: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=600",
    region: "",
    source: "seed",
  },
  {
    id: "scotiabank_latam_10",
    title: "10% en pasajes LATAM",
    description: "Compra tus pasajes en latamairlines.com con Scotiabank y ahorra 10% en cualquier destino.",
    discountLabel: "10% dcto",
    bankId: "scotiabank",
    categoryId: "cat_travel",
    isFeatured: false,
    isLastMinute: false,
    validity: "Válido hasta octubre 2026",
    expiresAt: "2026-10-31",
    benefitUrl: "https://www.latamairlines.com",
    imageUrl: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600",
    region: "",
    source: "seed",
  },
];

async function seedFirestore() {
  console.log(`🌱 Seeding ${SEED_OFFERS.length} ofertas en Firestore...`);
  const batch = db.batch();

  for (const offer of SEED_OFFERS) {
    const { id, ...data } = offer;
    const ref = db.collection("offers").doc(id);
    batch.set(ref, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  }

  await batch.commit();
  console.log("✅ Seed completado. Abre la app y verás los datos reales.");
  process.exit(0);
}

seedFirestore().catch(err => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
