import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const AUTH_DIR = path.join(DATA_DIR, "auth");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const DB_PATH = path.join(DATA_DIR, "workshop.db");

export function uid() {
  return randomUUID();
}

export function now() {
  return Date.now();
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toEnglishDigits(value = "") {
  return String(value).replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

export function normalizeName(value = "") {
  return String(value)
    .trim()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function formatMoneyNumber(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function safeText(value) {
  return String(value || "").trim();
}
