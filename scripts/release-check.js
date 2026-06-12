import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredFiles = [
  "README.md",
  "LICENSE",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "Dockerfile",
  "docker-compose.yml",
  "docs/deployment.md",
  "docs/publishing.md",
  "docs/personal-setup.md",
  "docs/architecture.md",
  "docs/demo-guide.md",
  "demo/fixtures/cards.json",
  "scripts/ocr.swift"
];

const forbiddenTrackedPrefixes = [
  "state/",
  "memory/",
  "card-library/",
  "cards/",
  "knowledge-base/",
  ".obsidian/",
  ".openclaw/",
  "AGENTS.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "MEMORY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md"
];

const forbiddenEnvPatterns = [
  /\/Users\/[^/\s]+/u,
  /\.qclaw/u,
  /sk-[A-Za-z0-9_-]{12,}/u,
  /Bearer\s+[A-Za-z0-9._-]+/u,
  /WECHAT_PUSH_TARGET=.+@im\.wechat/u,
  /WECHAT_PUSH_ACCOUNT=.+/u
];

const privatePathsThatMustBeIgnored = [
  ".env",
  "state",
  "card-library",
  "cards",
  "knowledge-base",
  ".openclaw",
  ".obsidian",
  "AGENTS.md",
  "MEMORY.md",
  "USER.md",
  "SOUL.md",
  "TOOLS.md"
];

function fail(message) {
  console.error(`release-check failed: ${message}`);
  process.exitCode = 1;
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    fail(`missing required file: ${file}`);
  }
}

const envExample = fs.existsSync(".env.example") ? fs.readFileSync(".env.example", "utf8") : "";
for (const pattern of forbiddenEnvPatterns) {
  if (pattern.test(envExample)) {
    fail(`.env.example contains private-looking value matching ${pattern}`);
  }
}

try {
  for (const privatePath of privatePathsThatMustBeIgnored) {
    if (!fs.existsSync(path.join(root, privatePath))) continue;
    try {
      execFileSync("git", ["check-ignore", "-q", privatePath], { stdio: "ignore" });
    } catch {
      fail(`private/runtime path exists but is not ignored by git: ${privatePath}`);
    }
  }
} catch (error) {
  console.warn(`release-check warning: git check-ignore unavailable (${String(error.message || error)})`);
}

try {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const file of tracked) {
    if ((file === ".env" || file.startsWith(".env.")) && file !== ".env.example") {
      fail(`private env file is tracked by git: ${file}`);
    }
    if (forbiddenTrackedPrefixes.some((prefix) => file === prefix || file.startsWith(prefix))) {
      fail(`private/runtime path is tracked by git: ${file}`);
    }
  }
} catch (error) {
  console.warn(`release-check warning: git ls-files unavailable (${String(error.message || error)})`);
}

if (!process.exitCode) {
  console.log("release-check ok");
}
