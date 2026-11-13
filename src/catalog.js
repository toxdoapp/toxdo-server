// Catálogo compartido con la app: entidades de Chile, categorías y tipos de evento.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.js";

const catalog = JSON.parse(readFileSync(path.join(ROOT, "src", "catalog.json"), "utf8"));

export const entities = catalog.entities;
export const entityById = new Map(entities.map((e) => [e.id, e]));
export const categories = catalog.categories;
export const categoryIds = categories.map((c) => c.id);
export const categoryLabel = (id) => categories.find((c) => c.id === id)?.label ?? "Otros";
export const eventCategoryIds = catalog.eventCategories.map((c) => c.id);
export default catalog;
