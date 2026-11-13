import * as cheerio from "cheerio";

const USER_AGENT = "Mozilla/5.0 (compatible; ToXdoBot/2.0; +https://toxdo-server.onrender.com/soporte)";

// Convierte HTML en el texto que vería una persona, una línea por bloque.
export function htmlToText(html, maxChars = 60000) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, nav, footer, form, select").remove();
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, a").each((_, el) => {
    $(el).append("\n");
  });
  const seen = new Set();
  const lines = [];
  for (const raw of $("body").text().split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 2) continue;
    // Los carruseles repiten el mismo texto muchas veces. Las líneas largas se guardan una sola vez.
    if (line.length > 40) {
      if (seen.has(line)) continue;
      seen.add(line);
    }
    lines.push(line);
  }
  return lines.join("\n").slice(0, maxChars);
}

// Descarga una página pública y devuelve su texto visible. No intenta saltarse bloqueos:
// si el sitio no responde con contenido, el llamador usa la búsqueda web.
export async function fetchPageText(url, { timeoutMs = 20000, maxChars = 60000 } = {}) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "es-CL,es;q=0.9", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, status: res.status, text: "" };
    const text = htmlToText(await res.text(), maxChars);
    return { ok: text.length >= 1500, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: err.message };
  }
}
