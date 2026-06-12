import crypto from "node:crypto";

export function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "card";
}

export function createCardId(date, title) {
  const compactDate = String(date || new Date().toISOString().slice(0, 10)).replaceAll("-", "");
  const digest = crypto
    .createHash("sha1")
    .update(`${compactDate}:${title}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `card_${compactDate}_${slugify(title)}_${digest}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeImportance(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["高", "high"].includes(normalized)) return "high";
  if (["低", "low"].includes(normalized)) return "low";
  return "medium";
}

export function denormalizeImportance(value) {
  if (value === "high") return "高";
  if (value === "low") return "低";
  return "中";
}

export function parseTags(input) {
  if (Array.isArray(input)) return [...new Set(input.map((tag) => String(tag).trim()).filter(Boolean))];
  return [...new Set(String(input || "")
    .split(/[,\s#]+/u)
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

export function json(data) {
  return JSON.stringify(data, null, 2);
}

export function safeParseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function summarizeText(text, maxLength = 120) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

export function inferTags(text) {
  const mapping = [
    ["AI", /ai|prompt|context|harness|agent/iu],
    ["机器学习", /机器学习|ml|model|objective|algorithm/iu],
    ["心理学", /大脑|拖延|上瘾|元认知|情绪/iu],
    ["机器人", /机器人|传感器|gripper|触觉/iu],
    ["方法论", /方法|框架|流程|实践/iu]
  ];
  return mapping.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}
