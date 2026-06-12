import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { readSettings } from "./settings.js";
import { summarizeText } from "./utils.js";

let activeSession = null;

function resolveHomePath(filePath) {
  return filePath?.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;
}

function commandExists(command) {
  if (!command) return false;
  if (command.includes("/") || command.endsWith(".mjs") || command.endsWith(".js")) {
    return fs.existsSync(resolveHomePath(command));
  }
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getConfig() {
  const settings = readSettings();
  const cliPath = resolveHomePath(process.env.WECHAT_PUSH_OPENCLAW_CLI || process.env.OPENCLAW_CLI || "openclaw");
  const configPath = resolveHomePath(
    settings.wechat.openclaw_config_path ||
    process.env.WECHAT_PUSH_OPENCLAW_CONFIG_PATH ||
    path.join(os.homedir(), ".openclaw", "openclaw.json")
  );
  return {
    channel: settings.wechat.channel || "openclaw-weixin",
    target: settings.wechat.target || "",
    account: settings.wechat.account || "",
    cliPath,
    nodeBinary: process.env.WECHAT_PUSH_NODE || process.env.OPENCLAW_NODE || process.execPath,
    configPath
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function accountPaths(config) {
  const stateDir = path.dirname(config.configPath);
  const accountsDir = path.join(stateDir, "openclaw-weixin", "accounts");
  return {
    accountsDir,
    accountFile: config.account ? path.join(accountsDir, `${config.account}.json`) : "",
    contextFile: config.account ? path.join(accountsDir, `${config.account}.context-tokens.json`) : ""
  };
}

function listAccountIds(accountsDir) {
  try {
    return fs.readdirSync(accountsDir)
      .filter((fileName) => fileName.endsWith(".json"))
      .filter((fileName) => !fileName.endsWith(".context-tokens.json"))
      .filter((fileName) => !fileName.endsWith(".sync.json"))
      .map((fileName) => path.basename(fileName, ".json"));
  } catch {
    return [];
  }
}

function sanitizeOutput(value) {
  return String(value || "")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gu, "$1[redacted]")
    .replace(/("?(?:token|bot_token|context_token)"?\s*[:=]\s*"?)[^"\s,}]+/giu, "$1[redacted]");
}

function parseQrUrl(output) {
  const matches = String(output || "").match(/https?:\/\/[^\s"'<>]+/gu) || [];
  return matches.find((url) => /qrcode|login|weixin|wechat|ilink|qq/u.test(url)) || matches[0] || "";
}

export function getWechatConnectionStatus() {
  const config = getConfig();
  const paths = accountPaths(config);
  const accounts = listAccountIds(paths.accountsDir);
  const contextTokens = readJson(paths.contextFile, {});
  const selectedAccountExists = Boolean(config.account && fs.existsSync(paths.accountFile));
  const contextReady = Boolean(config.target && contextTokens?.[config.target]);

  return {
    ok: Boolean(config.channel && config.target && (selectedAccountExists || accounts.length === 1) && contextReady),
    channel: config.channel,
    target: config.target,
    account: config.account,
    cli_exists: commandExists(config.cliPath),
    config_exists: fs.existsSync(config.configPath),
    selected_account_exists: selectedAccountExists,
    account_count: accounts.length,
    context_ready: contextReady,
    connect_command: `${config.cliPath} channels login --channel ${config.channel}`,
    note: contextReady
      ? "WeChat target has a context token and can receive direct push."
      : "After QR login, ask the target WeChat account to send one message to OpenClaw so the reply context token is created."
  };
}

export function startWechatQrConnect() {
  const config = getConfig();
  if (activeSession?.status === "running") {
    return readWechatQrConnectSession();
  }

  if (!commandExists(config.cliPath)) {
    return {
      ok: false,
      status: "unavailable",
      error: "openclaw_cli_missing",
      message: `OpenClaw CLI is not available. Run this manually after installing OpenClaw: ${config.cliPath} channels login --channel ${config.channel}`,
      connect_command: `${config.cliPath} channels login --channel ${config.channel}`
    };
  }

  const usesNode = config.cliPath.endsWith(".mjs") || config.cliPath.endsWith(".js");
  const command = usesNode ? config.nodeBinary : config.cliPath;
  const args = usesNode
    ? [config.cliPath, "channels", "login", "--channel", config.channel]
    : ["channels", "login", "--channel", config.channel];

  const startedAt = new Date().toISOString();
  const child = spawn(command, args, {
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: config.configPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  activeSession = {
    ok: true,
    status: "running",
    started_at: startedAt,
    finished_at: "",
    exit_code: null,
    output: "",
    qr_url: "",
    child
  };

  const append = (chunk) => {
    activeSession.output = summarizeText(`${activeSession.output}${sanitizeOutput(chunk)}`, 5000);
    activeSession.qr_url = activeSession.qr_url || parseQrUrl(activeSession.output);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code) => {
    if (!activeSession) return;
    activeSession.status = code === 0 ? "succeeded" : "failed";
    activeSession.finished_at = new Date().toISOString();
    activeSession.exit_code = code;
  });

  return readWechatQrConnectSession();
}

export function readWechatQrConnectSession() {
  const status = getWechatConnectionStatus();
  if (!activeSession) {
    return {
      ok: false,
      status: "idle",
      qr_url: "",
      output: "",
      connection: status
    };
  }
  return {
    ok: activeSession.ok,
    status: activeSession.status,
    started_at: activeSession.started_at,
    finished_at: activeSession.finished_at,
    exit_code: activeSession.exit_code,
    qr_url: activeSession.qr_url,
    output: activeSession.output,
    connection: status
  };
}
