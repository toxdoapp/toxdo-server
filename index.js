// Servidor de ToXdo: mantiene al día los beneficios y eventos con IA y responde al asistente.
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import { ROOT, config } from "./src/env.js";
import { AiUnavailable, aiConfigured, aiState } from "./src/ai.js";
import { askAssistant } from "./src/assistant.js";
import { entityById } from "./src/catalog.js";
import { auth, db, firebaseReady } from "./src/firebase.js";
import { ingestDue } from "./src/ingest/benefits.js";
import { refreshCity } from "./src/ingest/events.js";
import { runDailyIfDue, runSheetSyncNow, startScheduler } from "./src/scheduler.js";
import { todayCL } from "./src/text.js";

const app = express();
app.set("trust proxy", 1); // Render pone un proxy delante.
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

const limiter = (limit, windowMs = 60_000) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", message: "Demasiadas solicitudes. Intenta de nuevo en un momento." },
  });

app.use("/api/", limiter(120));

// ---------- Autorización ----------

function requireSecret(req, res, next) {
  const given = Buffer.from(String(req.get("x-toxdo-secret") || ""));
  const expected = Buffer.from(config.secret);
  if (expected.length < 12) return res.status(503).json({ error: "secret_not_configured" });
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

async function requireUser(req, res, next) {
  if (!auth) return res.status(503).json({ error: "server_not_ready" });
  const header = String(req.get("authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "sign_in_required" });
  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "sign_in_required" });
  }
}

const dailyUse = new Map();
function withinDailyLimit(uid) {
  const key = `${uid}:${todayCL()}`;
  const used = dailyUse.get(key) || 0;
  if (used >= config.assistantPerUserPerDay) return false;
  if (dailyUse.size > 5000) dailyUse.clear();
  dailyUse.set(key, used + 1);
  return true;
}

const wrap = (handler) => (req, res) =>
  handler(req, res).catch((err) => {
    if (err instanceof AiUnavailable) {
      return res.status(503).json({ error: "ai_unavailable", message: "El asistente no está disponible por ahora." });
    }
    console.error(`[error] ${req.method} ${req.path}:`, err.message);
    res.status(500).json({ error: "internal", message: "Algo falló. Intenta de nuevo." });
  });

// ---------- Rutas públicas ----------

// La app llama a /api/ping al abrirse: despierta el servidor y dispara la tarea diaria si falta.
app.get("/api/ping", (req, res) => {
  runDailyIfDue();
  res.json({ ok: true, ai: aiConfigured(), data: firebaseReady() });
});

app.get(
  "/api/status",
  wrap(async (req, res) => {
    const status = { ok: true, version: 2, firebase: firebaseReady(), ai: aiConfigured(), model: aiState().model };
    if (db) {
      const [offers, events] = await Promise.all([
        db.collection("offers").where("schema", "==", 2).where("active", "==", true).count().get(),
        db.collection("events").where("endDate", ">=", todayCL()).count().get(),
      ]);
      status.activeOffers = offers.data().count;
      status.upcomingEvents = events.data().count;
    }
    res.json(status);
  }),
);

// Pide actualizar los eventos de la ciudad donde está la persona. Responde de inmediato;
// los eventos nuevos llegan a la app por Firestore cuando la búsqueda termina.
app.post(
  "/api/events/refresh",
  limiter(10),
  wrap(async (req, res) => {
    const { city, region, lat, lng } = req.body || {};
    if (typeof city !== "string" || city.trim().length < 2) return res.status(400).json({ error: "city_required" });
    const inChile = Number.isFinite(lat) && Number.isFinite(lng) && lat < -17 && lat > -56.5 && lng < -66 && lng > -110;
    if (!inChile) return res.json({ status: "out_of_coverage" });
    if (!firebaseReady()) return res.status(503).json({ error: "server_not_ready" });
    if (!aiConfigured()) return res.json({ status: "ai_unavailable" });
    res.json(await refreshCity({ city, region: typeof region === "string" ? region : "", lat, lng }));
  }),
);

app.post(
  "/api/assistant",
  limiter(12),
  requireUser,
  wrap(async (req, res) => {
    const { query, entityIds, city } = req.body || {};
    if (typeof query !== "string" || query.trim().length < 3) return res.status(400).json({ error: "query_required" });
    if (!withinDailyLimit(req.user.uid)) {
      return res.status(429).json({ error: "daily_limit", message: "Llegaste al límite de preguntas por hoy." });
    }
    const ids = Array.isArray(entityIds) ? entityIds.filter((id) => typeof id === "string" && entityById.has(id)).slice(0, 60) : [];
    res.json(await askAssistant({ query, entityIds: ids, city: typeof city === "string" ? city : "" }));
  }),
);

// ---------- Rutas de administración (requieren el encabezado x-toxdo-secret) ----------

app.post(
  "/api/admin/ingest/benefits",
  requireSecret,
  wrap(async (req, res) => {
    const { entityIds, limit } = req.body || {};
    const job = ingestDue({ entityIds: Array.isArray(entityIds) ? entityIds : null, limit: Number.isInteger(limit) ? limit : config.entitiesPerDay });
    job.catch((err) => console.error("[beneficios] ingesta manual falló:", err.message));
    res.status(202).json({ status: "started" });
  }),
);

app.post(
  "/api/admin/ingest/events",
  requireSecret,
  wrap(async (req, res) => {
    const { city, region, lat, lng } = req.body || {};
    if (typeof city !== "string" || !city.trim()) return res.status(400).json({ error: "city_required" });
    res.status(202).json(await refreshCity({ city, region, lat, lng, force: true }));
  }),
);

app.post(
  "/api/admin/sync/sheet",
  requireSecret,
  wrap(async (req, res) => {
    if (!firebaseReady()) return res.status(503).json({ error: "server_not_ready" });
    res.json(await runSheetSyncNow());
  }),
);

app.get(
  "/api/admin/status",
  requireSecret,
  wrap(async (req, res) => {
    const runs = db ? (await db.collection("ingestRuns").get()).docs.map((d) => ({ ...d.data(), lastRunAt: d.data().lastRunAt?.toDate?.() ?? null })) : [];
    res.json({ ai: aiState(), firebase: firebaseReady(), runs });
  }),
);

// ---------- Páginas públicas: privacidad, términos y soporte ----------

app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"], maxAge: "1h" }));

app.use((req, res) => res.status(404).json({ error: "not_found" }));

app.listen(config.port, () => {
  console.log(`ToXdo server en el puerto ${config.port}. Firebase: ${firebaseReady() ? "ok" : "no"}. IA: ${aiConfigured() ? "ok" : "no"}.`);
  startScheduler();
});
