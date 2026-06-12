import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { summarizeText, safeParseJson } from "./utils.js";

let agentListCache = null;

function resolveHomePath(filePath) {
  return filePath?.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
}

function readOpenClawConfig() {
  const openclawStateDir = path.join(os.homedir(), ".openclaw");
  const openclawConfigPath = process.env.OPENCLAW_CONFIG_PATH || path.join(openclawStateDir, "openclaw.json");
  const openclawConfig = readJsonIfExists(openclawConfigPath) || {};
  const cliPath = resolveHomePath(process.env.OPENCLAW_CLI || "openclaw");
  const nodeBinary = process.env.OPENCLAW_NODE || process.execPath;
  const gatewayPort = Number(process.env.OPENCLAW_GATEWAY_PORT || openclawConfig.gateway?.port || 18789);
  const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN || openclawConfig.gateway?.auth?.token || "";

  return {
    openclawStateDir,
    openclawConfigPath,
    nodeBinary,
    cliPath,
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL || `ws://127.0.0.1:${gatewayPort}`,
    gatewayToken
  };
}

function cliUsesNode(config) {
  return config.cliPath.endsWith(".mjs") || config.cliPath.endsWith(".js");
}

function buildOpenClawInvocation(config, args) {
  return cliUsesNode(config)
    ? { command: config.nodeBinary, args: [config.cliPath, ...args] }
    : { command: config.cliPath, args };
}

function runOpenClawCli(config, args, options = {}) {
  const invocation = buildOpenClawInvocation(config, args);
  return execFileSync(invocation.command, invocation.args, options);
}

function hasOpenClawCli(config) {
  if (cliUsesNode(config) && !fs.existsSync(config.cliPath)) return false;
  try {
    runOpenClawCli(config, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const direct = safeParseJson(trimmed, null);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced) {
    const parsed = safeParseJson(fenced[1], null);
    if (parsed) return parsed;
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return safeParseJson(trimmed.slice(first, last + 1), null);
  }
  return null;
}

function extractAgentText(parsed, fallbackOutput) {
  if (!parsed || typeof parsed !== "object") return fallbackOutput;
  const payloadText = Array.isArray(parsed.payloads)
    ? parsed.payloads.map((payload) => payload?.text).filter(Boolean).join("\n")
    : "";
  return payloadText ||
    parsed.message ||
    parsed.response ||
    parsed.answer ||
    parsed.text ||
    parsed.output ||
    fallbackOutput;
}

export function getOpenClawRuntimeStatus() {
  const config = readOpenClawConfig();
  const cliExists = hasOpenClawCli(config);
  let models = null;
  let modelAvailable = false;
  let authMissing = [];

  if (cliExists) {
    try {
      const output = runOpenClawCli(config, ["models", "status", "--json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 8000
      });
      models = safeParseJson(output, null);
      modelAvailable = Boolean(models?.resolvedDefault && !models?.auth?.missingProvidersInUse?.length);
      authMissing = models?.auth?.missingProvidersInUse || [];
    } catch (error) {
      models = {
        error: String(error.message || error)
      };
    }
  }

  return {
    ok: cliExists && modelAvailable,
    cli_exists: cliExists,
    cli_path: config.cliPath,
    gateway_url: config.gatewayUrl,
    default_model: process.env.OPENCLAW_MODEL || models?.resolvedDefault || models?.defaultModel || "",
    model_available: modelAvailable,
    auth_missing: authMissing,
    models
  };
}

export function runOpenClawAgent({
  agent,
  message,
  model = process.env.OPENCLAW_MODEL || "",
  thinking = process.env.OPENCLAW_THINKING || "medium",
  timeoutSeconds = Number(process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS || 90),
  local = process.env.OPENCLAW_AGENT_LOCAL !== "false"
}) {
  const config = readOpenClawConfig();
  if (!hasOpenClawCli(config)) {
    return {
      ok: false,
      error: "openclaw_cli_missing",
      summary: "OpenClaw CLI not found"
    };
  }
  if (process.env.OPENCLAW_SKIP_PREFLIGHT !== "true") {
    const status = getOpenClawRuntimeStatus();
    if (!status.model_available) {
      return {
        ok: false,
        agent,
        model: model || status.default_model || "openclaw-default",
        error: "openclaw_model_unavailable",
        status
      };
    }
  }
  const effectiveAgent = resolveEffectiveAgent(agent, config);

  const args = ["agent"];
  if (local) args.push("--local");
  if (effectiveAgent) args.push("--agent", effectiveAgent);
  args.push(
    "--message",
    message,
    "--thinking",
    thinking,
    "--timeout",
    String(timeoutSeconds),
    "--json"
  );
  if (model) args.push("--model", model);

  try {
    const output = runOpenClawCli(config, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutSeconds * 1000 + 5000,
      maxBuffer: 1024 * 1024 * 4
    });
    const parsed = safeParseJson(output, null);
    const text = extractAgentText(parsed, output);
    return {
      ok: true,
      agent,
      effective_agent: effectiveAgent || "default",
      model: model || "openclaw-default",
      raw: parsed || output,
      text: typeof text === "string" ? text : JSON.stringify(text),
      json: extractJsonObject(typeof text === "string" ? text : JSON.stringify(text))
    };
  } catch (error) {
    return {
      ok: false,
      agent,
      effective_agent: effectiveAgent || "default",
      model: model || "openclaw-default",
      error: String(error.message || error),
      stderr: summarizeText(error.stderr || "", 500),
      stdout: summarizeText(error.stdout || "", 500)
    };
  }
}

function listConfiguredAgents(config) {
  if (agentListCache) return agentListCache;
  try {
    const output = runOpenClawCli(config, ["agents", "list", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 8000
    });
    const agents = safeParseJson(output, []);
    agentListCache = Array.isArray(agents) ? agents.map((item) => item.id).filter(Boolean) : [];
  } catch {
    agentListCache = [];
  }
  return agentListCache;
}

function resolveEffectiveAgent(agent, config) {
  if (!agent) return "";
  const agents = listConfiguredAgents(config);
  if (agents.includes(agent)) return agent;
  if (process.env.OPENCLAW_ALLOW_AGENT_FALLBACK === "true") {
    return process.env.OPENCLAW_FALLBACK_AGENT || (agents.includes("main") ? "main" : agent);
  }
  return agent;
}

export function parseAgentJson(text) {
  return extractJsonObject(text);
}
