// Revisa qué páginas oficiales del catálogo se pueden leer directamente.
//   node scripts/check-sources.js
import { entities } from "../src/catalog.js";
import { fetchPageText } from "../src/fetchPage.js";

const rows = await Promise.all(
  entities.map(async (e) => {
    const page = await fetchPageText(e.urls[0], { maxChars: 300000 });
    return { id: e.id, legible: page.ok, estado: page.status, caracteres: page.text.length };
  }),
);
console.table(rows);
console.log(`Legibles: ${rows.filter((r) => r.legible).length} de ${rows.length}`);
