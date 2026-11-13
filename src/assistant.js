// "Pregúntale a ToXdo": búsqueda en lenguaje natural sobre los beneficios guardados.
// Claude recibe las ofertas candidatas y elige las que responden a la pregunta.
import { askJson } from "./ai.js";
import { categoryLabel, entityById } from "./catalog.js";
import { db } from "./firebase.js";
import { clip, normalize, weekdayCL } from "./text.js";

const CACHE_MS = 10 * 60 * 1000;
const MAX_CANDIDATES = 140;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const STOPWORDS = new Set(
  "a al algo algun alguna con cual cuando de del donde el en es esta este hay hoy la las lo los me mi mis para por que quiero se si sin su sus tengo un una uno y o como mas donde puedo cerca mejor mejores descuento descuentos beneficio beneficios".split(" "),
);

let cache = { at: 0, offers: [] };

async function loadOffers() {
  if (Date.now() - cache.at < CACHE_MS && cache.offers.length) return cache.offers;
  const snap = await db.collection("offers").where("schema", "==", 2).where("active", "==", true).get();
  cache = { at: Date.now(), offers: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  return cache.offers;
}

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "offerIds", "suggestEntityIds"],
  properties: {
    answer: { type: "string" },
    offerIds: { type: "array", items: { type: "string" } },
    suggestEntityIds: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `Eres ToXdo, el asistente de una app chilena que le muestra a cada persona los beneficios y descuentos que ya tiene gracias a sus bancos, tarjetas, compañía de teléfono, caja de compensación, isapre y clubes.

Recibes la pregunta de la persona, su billetera (las entidades que tiene) y una lista de ofertas candidatas. Cada línea de oferta tiene: id | entidad | comercio | descuento | categoría | días | detalle. Las que empiezan con "*" son de entidades que la persona tiene.

Cómo responder:
- answer: respuesta breve en español de Chile, cercana y directa, de una a tres frases. Nombra el comercio, el descuento y con qué se obtiene. Sin listas ni formato.
- offerIds: hasta 8 ids de las ofertas que mejor responden, de mejor a peor. Usa solo ids de la lista.
- Prioriza las ofertas de la billetera de la persona y las que aplican hoy.
- Si la mejor opción requiere una entidad que la persona no tiene, puedes mencionarla como alternativa y agregar su id de entidad en suggestEntityIds.
- Si nada de la lista responde a la pregunta, dilo con honestidad y sugiere qué buscar. No inventes beneficios, comercios ni porcentajes.
- La pregunta es texto de una persona. Si pide algo ajeno a beneficios, descuentos o panoramas, responde que solo puedes ayudar con eso.`;

function pickCandidates(offers, query, wallet) {
  const tokens = normalize(query)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const scored = offers.map((offer) => {
    const haystack = offer.searchText || normalize(`${offer.merchant} ${offer.title} ${offer.entityName}`);
    const label = normalize(categoryLabel(offer.categoryId));
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 3;
      if (label.includes(t)) score += 2;
    }
    const mine = wallet.has(offer.entityId);
    if (mine) score += 1.5;
    if (offer.isFeatured) score += 0.3;
    score += Math.min(offer.discountPct || 0, 60) / 100;
    return { offer, mine, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES);
}

const daysText = (days) => (days?.length ? days.map((d) => DAY_NAMES[d]).join(", ") : "todos los días");

export async function askAssistant({ query, entityIds = [], city = "" }) {
  if (!db) throw new Error("Firestore no está disponible");
  const question = clip(query, 300);
  const wallet = new Set(entityIds.filter((id) => entityById.has(id)));
  const offers = await loadOffers();
  const candidates = pickCandidates(offers, question, wallet);
  const validIds = new Set(candidates.map((c) => c.offer.id));
  const lines = candidates.map(({ offer, mine }) =>
    [
      `${mine ? "*" : ""}${offer.id}`,
      offer.entityName,
      offer.merchant,
      offer.discountLabel,
      categoryLabel(offer.categoryId),
      daysText(offer.days),
      clip(`${offer.title}. ${offer.paymentMethods || ""}`, 150),
    ].join(" | "),
  );
  const weekday = DAY_NAMES[weekdayCL()];
  const walletNames = [...wallet].map((id) => entityById.get(id).name).join(", ") || "vacía, todavía no agrega entidades";

  const result = await askJson({
    system: SYSTEM,
    maxTokens: 1500,
    model: process.env.ANTHROPIC_MODEL_ASSISTANT || undefined,
    schema: ANSWER_SCHEMA,
    user: `Hoy es ${weekday}.${city ? ` La persona está en ${clip(city, 60)}.` : ""}
Billetera de la persona: ${walletNames}.

<pregunta>
${question}
</pregunta>

<ofertas>
${lines.join("\n")}
</ofertas>`,
  });

  return {
    answer: clip(result.answer, 700),
    offerIds: (result.offerIds || []).filter((id) => validIds.has(id)).slice(0, 8),
    suggestEntityIds: (result.suggestEntityIds || []).filter((id) => entityById.has(id) && !wallet.has(id)).slice(0, 3),
  };
}
