// Carga .env local sin dependencias. En Render las variables vienen del panel.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envPath = path.join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(i + 1).trim();
  }
}

const int = (name, fallback) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: int("PORT", 3000),
  secret: (process.env.SCRAPE_SECRET || "").trim(),
  publicUrl: (process.env.PUBLIC_URL || "https://toxdo-server.onrender.com").replace(/\/$/, ""),
  supportEmail: process.env.SUPPORT_EMAIL || "toxdoapp@gmail.com",
  // Cuántas entidades se actualizan por día. Con 8, el catálogo completo rota en menos de una semana.
  entitiesPerDay: int("INGEST_ENTITIES_PER_DAY", 8),
  // Tope diario de ciudades cuyos eventos se investigan con IA.
  cityRefreshesPerDay: int("EVENT_CITIES_PER_DAY", 25),
  assistantPerUserPerDay: int("ASSISTANT_PER_USER_PER_DAY", 40),
  cronEnabled: process.env.DISABLE_CRON !== "1",
  // Google Sheet con beneficios cargados a mano o por un scraper propio. Vacío desactiva la sincronización.
  // Debe estar compartido como "Cualquier persona con el enlace, Lector".
  sheetId: (process.env.BENEFITS_SHEET_ID || "").trim(),
  sheetGid: (process.env.BENEFITS_SHEET_GID || "0").trim(),
};
