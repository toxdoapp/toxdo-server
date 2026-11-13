// Acceso a Claude. Todo el servidor pasa por aquí para hablar con el modelo.
import "./env.js";
import Anthropic from "@anthropic-ai/sdk";

export class AiUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "AiUnavailable";
  }
}

const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 }) : null;

// Modelo principal: Fable. Si la cuenta no tiene acceso a uno, se prueba el siguiente.
const MODEL_CHAIN = [
  ...new Set(
    [process.env.ANTHROPIC_MODEL, "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5"].filter(Boolean),
  ),
];

let workingModel = null;
let lastError = null;
let keyRejected = false;

export const aiConfigured = () => client !== null && !keyRejected;
export const aiState = () => ({
  configured: client !== null,
  keyRejected,
  model: workingModel || MODEL_CHAIN[0],
  lastError,
});

const isModelProblem = (err) => err?.status === 404 || (err?.status === 400 && /model/i.test(err?.message || ""));

async function create(params, { model } = {}) {
  if (!client) throw new AiUnavailable("ANTHROPIC_API_KEY no está configurada");
  if (keyRejected) throw new AiUnavailable("La clave de Anthropic fue rechazada");
  const candidates = model ? [model] : workingModel ? [workingModel] : MODEL_CHAIN;
  for (const candidate of candidates) {
    try {
      // Se usa streaming para que las respuestas largas no se corten por tiempo de espera.
      const message = await client.messages.stream({ ...params, model: candidate }).finalMessage();
      if (!model) workingModel = candidate;
      lastError = null;
      return message;
    } catch (err) {
      lastError = `${err?.status ?? ""} ${err?.message ?? err}`.trim().slice(0, 300);
      if (err?.status === 401 || err?.status === 403) {
        keyRejected = true;
        throw new AiUnavailable("La clave de Anthropic fue rechazada");
      }
      if (isModelProblem(err)) continue;
      throw err;
    }
  }
  throw new AiUnavailable("Ningún modelo de la lista está disponible para esta cuenta");
}

const textOf = (message) =>
  message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("El modelo no devolvió JSON válido");
  }
}

// Pide una respuesta que cumple un esquema JSON. Sin herramientas.
export async function askJson({ system, user, schema, maxTokens = 16000, model }) {
  const base = { max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
  let message;
  try {
    message = await create({ ...base, output_config: { format: { type: "json_schema", schema } } }, { model });
  } catch (err) {
    if (err instanceof AiUnavailable || err?.status !== 400) throw err;
    // Si el modelo no admite salida estructurada, se pide JSON por instrucción.
    const fallbackSystem = `${system}\n\nResponde únicamente con un objeto JSON válido que cumpla este esquema, sin texto adicional:\n${JSON.stringify(schema)}`;
    message = await create({ ...base, system: fallbackSystem }, { model });
  }
  if (message.stop_reason === "refusal") throw new Error("El modelo rechazó la solicitud");
  if (message.stop_reason === "max_tokens") throw new Error("La respuesta del modelo quedó incompleta");
  return parseJson(textOf(message));
}

// Investiga en la web con la herramienta de búsqueda de Claude y devuelve texto libre con sus fuentes.
export async function research({ system, user, maxSearches = 6, city, region, maxTokens = 8000 }) {
  const tools = [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxSearches,
      user_location: {
        type: "approximate",
        country: "CL",
        timezone: "America/Santiago",
        ...(city ? { city } : {}),
        ...(region ? { region } : {}),
      },
    },
  ];
  let messages = [{ role: "user", content: user }];
  let text = "";
  const citations = new Map();
  for (let turn = 0; turn < 5; turn += 1) {
    const message = await create({ max_tokens: maxTokens, system, messages, tools });
    for (const block of message.content) {
      if (block.type !== "text") continue;
      text += block.text;
      for (const c of block.citations || []) {
        if (c.url && !citations.has(c.url)) citations.set(c.url, c.title || "");
      }
    }
    // pause_turn: el turno quedó a medias. Se reenvía la respuesta tal cual para que continúe.
    if (message.stop_reason !== "pause_turn") break;
    messages = [...messages, { role: "assistant", content: message.content }];
  }
  return { text: text.trim(), citations: [...citations].map(([url, title]) => ({ url, title })) };
}
