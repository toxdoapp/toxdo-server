// Muestra el texto que el servidor logra leer de una página.
//   node scripts/dump-page.js bci                 página oficial de una entidad del catálogo
//   node scripts/dump-page.js https://sitio.cl    cualquier dirección
//   node scripts/dump-page.js archivo.html        un archivo HTML guardado
import { existsSync, readFileSync } from "node:fs";
import { entityById } from "../src/catalog.js";
import { fetchPageText, htmlToText } from "../src/fetchPage.js";

const target = process.argv[2] || "";
if (existsSync(target)) {
  console.log(htmlToText(readFileSync(target, "utf8"), 400000));
} else {
  const urls = entityById.get(target)?.urls ?? (target ? [target] : []);
  for (const url of urls) {
    const page = await fetchPageText(url, { maxChars: 400000 });
    console.error(`${url} -> ok:${page.ok} estado:${page.status} caracteres:${page.text.length}`);
    if (page.text) console.log(page.text);
  }
}
