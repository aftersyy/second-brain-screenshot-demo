import fs from "node:fs";
import path from "node:path";
import { getStateDir, readEnvBoolean } from "./config.js";

const DEFAULT_SETTINGS = {
  schedule: {
    timezone: process.env.TZ || "Asia/Shanghai",
    ingest_times: ["10:00", "16:00"],
    digest_time: "22:00",
    wechat_push_time: "22:30"
  },
  wechat: {
    channel: process.env.WECHAT_PUSH_CHANNEL || "openclaw-weixin",
    target: process.env.WECHAT_PUSH_TARGET || "",
    account: process.env.WECHAT_PUSH_ACCOUNT || "",
    transport: process.env.WECHAT_PUSH_TRANSPORT || "weixin-api",
    openclaw_config_path: process.env.WECHAT_PUSH_OPENCLAW_CONFIG_PATH || "",
    max_cards: Number(process.env.WECHAT_PUSH_MAX_CARDS || 5),
    auto_push_enabled: readEnvBoolean("WECHAT_AUTO_PUSH_ENABLED", false)
  }
};

function settingsPath() {
  return path.join(getStateDir(), "settings.json");
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function uniq(values) {
  return [...new Set(values)];
}

export function normalizeTime(value, fallback = "") {
  const match = String(value || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/u);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function normalizeTimes(values, fallback = []) {
  const source = Array.isArray(values) ? values : String(values || "").split(",");
  const normalized = source
    .map((value) => normalizeTime(value))
    .filter(Boolean);
  return uniq(normalized).length ? uniq(normalized) : fallback;
}

function normalizePositiveInt(value, fallback, max = 12) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.max(Math.floor(number), 1), max);
}

export function normalizeSettings(input = {}) {
  const schedule = input.schedule || {};
  const wechat = input.wechat || {};
  return {
    schedule: {
      timezone: String(schedule.timezone || DEFAULT_SETTINGS.schedule.timezone).trim() || "Asia/Shanghai",
      ingest_times: normalizeTimes(schedule.ingest_times, DEFAULT_SETTINGS.schedule.ingest_times),
      digest_time: normalizeTime(schedule.digest_time, DEFAULT_SETTINGS.schedule.digest_time),
      wechat_push_time: normalizeTime(schedule.wechat_push_time, DEFAULT_SETTINGS.schedule.wechat_push_time)
    },
    wechat: {
      channel: String(wechat.channel || DEFAULT_SETTINGS.wechat.channel).trim(),
      target: String(wechat.target || DEFAULT_SETTINGS.wechat.target).trim(),
      account: String(wechat.account || DEFAULT_SETTINGS.wechat.account).trim(),
      transport: String(wechat.transport || DEFAULT_SETTINGS.wechat.transport).trim(),
      openclaw_config_path: String(wechat.openclaw_config_path || DEFAULT_SETTINGS.wechat.openclaw_config_path).trim(),
      max_cards: normalizePositiveInt(wechat.max_cards, DEFAULT_SETTINGS.wechat.max_cards),
      auto_push_enabled: Boolean(wechat.auto_push_enabled)
    }
  };
}

export function readSettings() {
  const persisted = readJsonFile(settingsPath(), {});
  return normalizeSettings({
    schedule: {
      ...DEFAULT_SETTINGS.schedule,
      ...(persisted.schedule || {})
    },
    wechat: {
      ...DEFAULT_SETTINGS.wechat,
      ...(persisted.wechat || {})
    }
  });
}

export function writeSettings(nextSettings) {
  const normalized = normalizeSettings({
    schedule: {
      ...readSettings().schedule,
      ...(nextSettings.schedule || {})
    },
    wechat: {
      ...readSettings().wechat,
      ...(nextSettings.wechat || {})
    }
  });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
