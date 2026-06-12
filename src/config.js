import fs from "node:fs";
import path from "node:path";

export function getRootDir() {
  return process.env.KNOWLEDGE_AGENT_ROOT
    ? path.resolve(process.env.KNOWLEDGE_AGENT_ROOT)
    : process.cwd();
}

export function resolveInRoot(...parts) {
  return path.join(getRootDir(), ...parts);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function getStateDir() {
  return ensureDir(resolveInRoot("state"));
}

export function getDatabasePath() {
  return resolveInRoot("state", "knowledge-agent.db");
}

export function readEnvBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function isDemoMode() {
  return readEnvBoolean("DEMO_MODE", false);
}

export function isWebSearchEnabled() {
  return readEnvBoolean("ENABLE_WEB_SEARCH", false);
}

export function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getTemporalAddress() {
  return process.env.TEMPORAL_ADDRESS || "";
}

export function getTemporalUiUrl() {
  return process.env.TEMPORAL_UI_URL || "";
}

export function getPostgresUrl() {
  return process.env.POSTGRES_URL || "";
}

export function getCardLibraryDir() {
  return ensureDir(resolveInRoot("card-library"));
}

export function getLegacyCardsDir() {
  return ensureDir(resolveInRoot("cards"));
}

export function getLegacyKnowledgeBaseDir() {
  return ensureDir(resolveInRoot("knowledge-base"));
}

export function getPublicDir() {
  return resolveInRoot("public");
}

export function getScriptsDir() {
  return resolveInRoot("scripts");
}

export function getDemoDir() {
  return ensureDir(resolveInRoot("demo"));
}

export function getDemoFixturesDir() {
  return ensureDir(resolveInRoot("demo", "fixtures"));
}

export function readUserMarkdown() {
  const filePath = resolveInRoot("USER.md");
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

export function getScreenshotDir() {
  if (process.env.SCREENSHOT_DIR) {
    return process.env.SCREENSHOT_DIR.startsWith("~/")
      ? path.join(process.env.HOME || "", process.env.SCREENSHOT_DIR.slice(2))
      : process.env.SCREENSHOT_DIR;
  }
  const text = readUserMarkdown();
  const match = text.match(/截图文件夹.*?`([^`]+)`/);
  return match ? match[1] : null;
}
