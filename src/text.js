import { createHash } from "node:crypto";

export const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const slug = (value) => normalize(value).replace(/ /g, "_");

export const shortHash = (value) => createHash("sha1").update(String(value)).digest("hex").slice(0, 12);

export const clip = (value, max) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

// Fecha de hoy en Chile como 'YYYY-MM-DD'.
export const todayCL = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(d);
};

export const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) && !Number.isNaN(Date.parse(value));

export const isHttpUrl = (value) => {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

export const cleanDomain = (value) => {
  const s = String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : "";
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Día de la semana en Chile: 0 = domingo, 6 = sábado.
export const weekdayCL = () => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
};
