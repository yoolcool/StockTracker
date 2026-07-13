import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function average(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

export function weightedAverage(items, fallback = 0) {
  const valid = items.filter((row) => Number.isFinite(Number(row.value)));
  const totalWeight = valid.reduce((sum, row) => sum + Number(row.weight || 1), 0);
  if (!valid.length || totalWeight <= 0) return fallback;
  return valid.reduce((sum, row) => sum + Number(row.value) * Number(row.weight || 1), 0) / totalWeight;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function rounded(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export function pct(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return "n/a";
  const num = rounded(value, digits);
  return `${num > 0 ? "+" : ""}${num}%`;
}

export function money(value, currency = "USD") {
  if (!Number.isFinite(Number(value))) return "n/a";
  const digits = currency === "KRW" ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: digits
  }).format(Number(value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
