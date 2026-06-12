import net from "node:net";
import {
  getPostgresUrl,
  getTemporalAddress,
  getTemporalUiUrl,
  hasOpenAiKey,
  isDemoMode,
  isWebSearchEnabled
} from "./config.js";
import { getOpenClawRuntimeStatus } from "./agent-runtime.js";
import { getPushRuntimeStatus } from "./push.js";

function parseHostPort(value) {
  if (!value) return null;
  const normalized = String(value).replace(/^\w+:\/\//u, "");
  const [host, port] = normalized.split(":");
  if (!host || !port) return null;
  return { host, port: Number(port) };
}

function checkSocket(address, timeoutMs = 250) {
  const target = parseHostPort(address);
  if (!target) return Promise.resolve({ ok: false, status: "not_configured" });

  return new Promise((resolve) => {
    const socket = net.createConnection(target.port, target.host);
    const cleanup = (payload) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(payload);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => cleanup({ ok: true, status: "ok" }));
    socket.once("timeout", () => cleanup({ ok: false, status: "timeout" }));
    socket.once("error", (error) => cleanup({ ok: false, status: "error", message: String(error.message || error) }));
  });
}

export function getSystemCapabilities() {
  const openclaw = getOpenClawRuntimeStatus();
  const push = getPushRuntimeStatus();
  return {
    demo_mode: isDemoMode(),
    openai_agents: hasOpenAiKey(),
    openclaw_agent_runtime: openclaw.cli_exists,
    openclaw_model_available: openclaw.model_available,
    openclaw_default_model: openclaw.default_model,
    temporal: Boolean(getTemporalAddress()),
    temporal_ui: Boolean(getTemporalUiUrl()),
    web_search: isWebSearchEnabled(),
    push_channel: push.ok,
    push_channel_name: push.channel,
    push_target: push.target
  };
}

export async function getSystemHealth() {
  const temporal = await checkSocket(getTemporalAddress());
  const postgres = await checkSocket(getPostgresUrl());
  const capabilities = getSystemCapabilities();
  const services = {
    sqlite: { ok: true, status: "ok" },
    temporal,
    postgres,
    agent_runtime: {
      ok: capabilities.openclaw_model_available || capabilities.demo_mode,
      status: capabilities.openclaw_model_available ? "ok" : capabilities.demo_mode ? "demo_fallback" : "model_unavailable"
    },
    openclaw: {
      ok: capabilities.openclaw_agent_runtime || capabilities.demo_mode,
      status: capabilities.openclaw_agent_runtime
        ? capabilities.openclaw_model_available ? "ok" : capabilities.demo_mode ? "optional_in_demo" : "model_unavailable"
        : capabilities.demo_mode ? "optional_in_demo" : "cli_missing",
      default_model: capabilities.openclaw_default_model
    },
    push: {
      ok: capabilities.push_channel,
      status: capabilities.push_channel ? "ok" : "not_configured",
      channel: capabilities.push_channel_name,
      target: capabilities.push_target
    }
  };
  const ok = Object.values(services).every((item) => item.ok || item.status === "not_configured" || item.status === "optional_in_demo");
  return { ok, services, capabilities };
}
