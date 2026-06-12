import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createWorkflowRun, addWorkflowStep, listCards, updateWorkflowRun } from "./db.js";
import { readSettings } from "./settings.js";
import { nowIso, safeParseJson, summarizeText } from "./utils.js";

const IMPORTANCE_RANK = {
  high: 0,
  medium: 1,
  low: 2
};

function localDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveHomePath(filePath) {
  return filePath?.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;
}

function getPushConfig() {
  const defaultCli = "openclaw";
  const settings = readSettings();
  const wechat = settings.wechat;
  return {
    channel: wechat.channel || process.env.WECHAT_PUSH_CHANNEL || "openclaw-weixin",
    target: wechat.target || process.env.WECHAT_PUSH_TARGET || "",
    account: wechat.account || process.env.WECHAT_PUSH_ACCOUNT || "",
    transport: wechat.transport || process.env.WECHAT_PUSH_TRANSPORT || "weixin-api",
    cliPath: resolveHomePath(process.env.WECHAT_PUSH_OPENCLAW_CLI || process.env.OPENCLAW_CLI || defaultCli),
    nodeBinary: process.env.WECHAT_PUSH_NODE || process.env.OPENCLAW_NODE || process.execPath,
    configPath: resolveHomePath(
      wechat.openclaw_config_path || process.env.WECHAT_PUSH_OPENCLAW_CONFIG_PATH || path.join(os.homedir(), ".openclaw", "openclaw.json")
    ),
    timeoutMs: Number(process.env.WECHAT_PUSH_TIMEOUT_MS || 30000),
    cronTimeoutMs: Number(process.env.WECHAT_PUSH_CRON_TIMEOUT_MS || 180000),
    maxCards: Number(wechat.max_cards || process.env.WECHAT_PUSH_MAX_CARDS || 5),
    appUrl: process.env.KNOWLEDGE_AGENT_APP_URL || "http://127.0.0.1:3017"
  };
}

export function getPushRuntimeStatus() {
  const config = getPushConfig();
  return {
    ok: Boolean(config.channel && config.target && (config.cliPath === "openclaw" || fs.existsSync(config.cliPath)) && fs.existsSync(config.configPath)),
    channel: config.channel,
    target: config.target,
    account: config.account,
    transport: config.transport,
    cli_exists: config.cliPath === "openclaw" || fs.existsSync(config.cliPath),
    config_exists: fs.existsSync(config.configPath),
    config_path: config.configPath
  };
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function getWeixinAccountPaths(config) {
  const stateDir = path.dirname(config.configPath);
  const accountsDir = path.join(stateDir, "openclaw-weixin", "accounts");
  return {
    accountFile: path.join(accountsDir, `${config.account}.json`),
    contextTokenFile: path.join(accountsDir, `${config.account}.context-tokens.json`)
  };
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

function normalizeLimit(limit, fallback) {
  const value = Number(limit || fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), 12);
}

function sortRecommendedCards(cards) {
  return [...cards].sort((left, right) => {
    const leftRank = IMPORTANCE_RANK[left.importance] ?? 1;
    const rightRank = IMPORTANCE_RANK[right.importance] ?? 1;
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (Number(left.confidence || 0) !== Number(right.confidence || 0)) {
      return Number(right.confidence || 0) - Number(left.confidence || 0);
    }
    return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
  });
}

export function selectRecommendedCards({ date = localDate(), limit } = {}) {
  const config = getPushConfig();
  const maxCards = normalizeLimit(limit, config.maxCards);
  const cards = listCards({
    status: "published",
    date,
    limit: 100
  });
  return sortRecommendedCards(cards).slice(0, maxCards);
}

function cleanLine(value, maxLength = 140) {
  return summarizeText(String(value || "").replace(/\s+/gu, " ").trim(), maxLength);
}

function extractBullets(card, maxItems = 3) {
  const source = card.content || card.insights || "";
  return String(source)
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/u, "").trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((line) => cleanLine(line, 96));
}

export function formatCardRecommendation({ date = localDate(), cards = [], appUrl = getPushConfig().appUrl } = {}) {
  if (!cards.length) {
    return [
      `第二大脑知识卡片推荐｜${date}`,
      "",
      "今天暂无已发布知识卡片。",
      "可以先在工作台运行截图导入、审核卡片，再重新推送。",
      "",
      `工作台：${appUrl}`
    ].join("\n");
  }

  const lines = [
    `第二大脑知识卡片推荐｜${date}`,
    `今日精选 ${cards.length} 张，按重要性和可信度排序。`,
    ""
  ];

  cards.forEach((card, index) => {
    const tags = (card.tags || []).slice(0, 3).map((tag) => `#${tag}`).join(" ");
    lines.push(`${index + 1}. ${card.title}`);
    lines.push(`摘要：${cleanLine(card.summary, 120) || "暂无摘要"}`);
    const bullets = extractBullets(card, 3);
    if (bullets.length) {
      lines.push("要点：");
      bullets.forEach((bullet) => lines.push(`- ${bullet}`));
    }
    if (card.insights) lines.push(`思考：${cleanLine(card.insights, 110)}`);
    lines.push(`重要性：${card.importance || "medium"}${tags ? `｜${tags}` : ""}`);
    lines.push("");
  });

  lines.push(`工作台：${appUrl}`);
  return lines.join("\n").trim();
}

function runMessageSend({ message, dryRun = true }) {
  const config = getPushConfig();
  if (!fs.existsSync(config.cliPath)) {
    return {
      ok: false,
      error: "openclaw_cli_missing",
      message: `OpenClaw CLI not found: ${config.cliPath}`
    };
  }
  if (!fs.existsSync(config.configPath)) {
    return {
      ok: false,
      error: "wechat_config_missing",
      message: `WeChat channel config not found: ${config.configPath}`
    };
  }

  const args = [
    config.cliPath,
    "message",
    "send",
    "--channel",
    config.channel,
    "--target",
    config.target,
    "--message",
    message,
    "--json"
  ];
  if (config.account) args.push("--account", config.account);
  if (dryRun) args.push("--dry-run");

  try {
    const output = execFileSync(config.nodeBinary, args, {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: config.configPath
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024 * 4
    });
    return {
      ok: true,
      dry_run: dryRun,
      channel: config.channel,
      target: config.target,
      account: config.account,
      raw: extractJsonObject(output) || summarizeText(output, 1200)
    };
  } catch (error) {
    return {
      ok: false,
      dry_run: dryRun,
      channel: config.channel,
      target: config.target,
      account: config.account,
      error: "wechat_send_failed",
      message: String(error.message || error),
      stderr: summarizeText(error.stderr || "", 1200),
      stdout: summarizeText(error.stdout || "", 1200)
    };
  }
}

function postWeixinMessage({ message }) {
  const config = getPushConfig();
  const paths = getWeixinAccountPaths(config);
  const account = readJsonFile(paths.accountFile, null);
  const contextTokens = readJsonFile(paths.contextTokenFile, {});
  const contextToken = contextTokens?.[config.target];

  if (!account?.token || !account?.baseUrl) {
    return {
      ok: false,
      dry_run: false,
      channel: config.channel,
      target: config.target,
      account: config.account,
      transport: "weixin-api",
      error: "weixin_account_missing",
      message: `Weixin account file is missing or incomplete: ${paths.accountFile}`
    };
  }
  if (!contextToken) {
    return {
      ok: false,
      dry_run: false,
      channel: config.channel,
      target: config.target,
      account: config.account,
      transport: "weixin-api",
      error: "weixin_context_token_missing",
      message: "Ask the target WeChat account to send one message to OpenClaw first, then retry.",
      context_token_file: paths.contextTokenFile
    };
  }

  const clientId = `second-brain:${Date.now().toString(36)}:${crypto.randomBytes(4).toString("hex")}`;
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: config.target,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: message } }],
      context_token: contextToken
    },
    base_info: { channel_version: "1.0.3" }
  });

  try {
    const script = `
const baseUrl = process.env.WEIXIN_BASE_URL;
const body = process.env.WEIXIN_BODY;
const token = process.env.WEIXIN_TOKEN;
const response = await fetch(new URL("ilink/bot/sendmessage", baseUrl.endsWith("/") ? baseUrl : baseUrl + "/").toString(), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: "Bearer " + token,
    "Content-Length": String(Buffer.byteLength(body, "utf8")),
    "X-WECHAT-UIN": process.env.WEIXIN_UIN
  },
  body
});
const raw = await response.text();
console.log(JSON.stringify({ ok: response.ok, status: response.status, raw }));
`;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        WEIXIN_BASE_URL: account.baseUrl,
        WEIXIN_TOKEN: account.token,
        WEIXIN_BODY: body,
        WEIXIN_UIN: randomWechatUin()
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024
    });
    const result = safeParseJson(output, null);
    if (!result?.ok) {
      return {
        ok: false,
        dry_run: false,
        channel: config.channel,
        target: config.target,
        account: config.account,
        transport: "weixin-api",
        error: "weixin_api_failed",
        status: result?.status,
        raw: summarizeText(result?.raw || output, 1500)
      };
    }
    return {
      ok: true,
      dry_run: false,
      channel: config.channel,
      target: config.target,
      account: config.account,
      transport: "weixin-api",
      message_id: clientId,
      raw: extractJsonObject(result.raw) || summarizeText(result.raw, 800)
    };
  } catch (error) {
    return {
      ok: false,
      dry_run: false,
      channel: config.channel,
      target: config.target,
      account: config.account,
      transport: "weixin-api",
      error: "weixin_api_exception",
      message: String(error.message || error),
      stderr: summarizeText(error.stderr || "", 1200),
      stdout: summarizeText(error.stdout || "", 1200)
    };
  }
}

function runWeixinApiDelivery({ message, dryRun = true }) {
  const config = getPushConfig();
  if (dryRun) {
    const paths = getWeixinAccountPaths(config);
    const contextTokens = readJsonFile(paths.contextTokenFile, {});
    return {
      ok: true,
      dry_run: true,
      channel: config.channel,
      target: config.target,
      account: config.account,
      transport: "weixin-api",
      context_ready: Boolean(contextTokens?.[config.target]),
      raw: { action: "preview" }
    };
  }
  return postWeixinMessage({ message });
}

function buildDirectOutputMessage(message) {
  return [
    "直接输出以下内容，禁止调用 message 工具，禁止添加解释，禁止改写：",
    "",
    message
  ].join("\n");
}

function extractCronJobId(raw) {
  if (raw && typeof raw === "object") {
    return raw.id || raw.jobId || raw.job?.id || raw.item?.id || "";
  }
  const text = String(raw || "");
  const match = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
  return match ? match[0] : "";
}

function runCronDelivery({ message, dryRun = true }) {
  const config = getPushConfig();
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      channel: config.channel,
      target: config.target,
      transport: "cron-delivery",
      raw: {
        action: "preview",
        note: "cron delivery is only created when dry_run=false"
      }
    };
  }
  if (!fs.existsSync(config.cliPath)) {
    return {
      ok: false,
      error: "openclaw_cli_missing",
      message: `OpenClaw CLI not found: ${config.cliPath}`
    };
  }

  const env = {
    ...process.env,
    OPENCLAW_CONFIG_PATH: config.configPath
  };
  const createArgs = [
    config.cliPath,
    "cron",
    "add",
    "--name",
    `第二大脑微信推荐 ${localDate()}`,
    "--at",
    "1m",
    "--delete-after-run",
    "--session",
    "isolated",
    "--agent",
    process.env.WECHAT_PUSH_AGENT || process.env.OPENCLAW_PUSH_AGENT || "main",
    "--message",
    buildDirectOutputMessage(message),
    "--announce",
    "--channel",
    config.channel,
    "--to",
    config.target,
    "--best-effort-deliver",
    "--timeout",
    String(config.cronTimeoutMs),
    "--json"
  ];
  if (config.account) createArgs.push("--account", config.account);

  try {
    const createOutput = execFileSync(config.nodeBinary, createArgs, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024 * 4
    });
    const createRaw = extractJsonObject(createOutput) || createOutput;
    const jobId = extractCronJobId(createRaw);
    if (!jobId) {
      return {
        ok: false,
        dry_run: false,
        channel: config.channel,
        target: config.target,
        transport: "cron-delivery",
        error: "cron_job_id_missing",
        raw: summarizeText(createOutput, 1500)
      };
    }

    const runOutput = execFileSync(config.nodeBinary, [
      config.cliPath,
      "cron",
      "run",
      jobId,
      "--expect-final",
      "--timeout",
      String(config.cronTimeoutMs)
    ], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: config.cronTimeoutMs + 5000,
      maxBuffer: 1024 * 1024 * 4
    });
    const runRaw = extractJsonObject(runOutput) || runOutput;
    const rawText = typeof runRaw === "string" ? runRaw : JSON.stringify(runRaw);
    const delivered = /deliveryStatus["']?\s*:\s*["']delivered|delivered["']?\s*:\s*true|投递.*成功|已发送|送达/u.test(rawText);
    return {
      ok: delivered,
      dry_run: false,
      channel: config.channel,
      target: config.target,
      transport: "cron-delivery",
      job_id: jobId,
      delivery_status: delivered ? "delivered" : "unknown",
      raw: summarizeText(rawText, 1800)
    };
  } catch (error) {
    return {
      ok: false,
      dry_run: false,
      channel: config.channel,
      target: config.target,
      transport: "cron-delivery",
      error: "cron_delivery_failed",
      message: String(error.message || error),
      stderr: summarizeText(error.stderr || "", 1500),
      stdout: summarizeText(error.stdout || "", 1500)
    };
  }
}

function deliverRecommendation({ message, dryRun }) {
  const config = getPushConfig();
  if (config.transport === "message-send") {
    if (config.channel === "wechat-access" && !dryRun) {
      return {
        ok: false,
        dry_run: false,
        channel: config.channel,
        target: config.target,
        transport: config.transport,
        error: "wechat_access_message_send_is_noop",
        message: "wechat-access message send reports ok but does not deliver; use WECHAT_PUSH_TRANSPORT=cron-delivery."
      };
    }
    return runMessageSend({ message, dryRun });
  }
  if (config.transport === "weixin-api") {
    return runWeixinApiDelivery({ message, dryRun });
  }
  return runCronDelivery({ message, dryRun });
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const direct = safeParseJson(trimmed, null);
  if (direct) return direct;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return safeParseJson(trimmed.slice(first, last + 1), null);
  return null;
}

export function buildWechatRecommendationPreview(options = {}) {
  const config = getPushConfig();
  const date = options.date || localDate();
  const cards = selectRecommendedCards({ date, limit: options.limit });
  const message = formatCardRecommendation({ date, cards, appUrl: config.appUrl });
  return {
    ok: true,
    dry_run: true,
    date,
    channel: config.channel,
    target: config.target,
    account: config.account,
    message,
    cards: cards.map((card) => ({
      card_id: card.card_id,
      title: card.title,
      importance: card.importance,
      confidence: card.confidence
    })),
    runtime: getPushRuntimeStatus()
  };
}

export function pushWechatRecommendation(options = {}) {
  const date = options.date || localDate();
  const dryRun = options.dry_run !== false;
  const runId = `push_${date}_${Date.now().toString(36)}`;
  const preview = buildWechatRecommendationPreview({
    date,
    limit: options.limit
  });

  if (!dryRun && options.confirm !== true) {
    return {
      ...preview,
      ok: false,
      dry_run: false,
      requires_confirmation: true,
      error: "confirmation_required",
      confirmation_message: "Set confirm=true to send this recommendation to WeChat."
    };
  }

  createWorkflowRun({
    run_id: runId,
    workflow_type: "wechat_push",
    mode: dryRun ? "dry_run" : "manual_send",
    status: "running",
    summary: dryRun ? "生成微信推荐预览" : "发送微信推荐",
    input: {
      date,
      limit: options.limit || getPushConfig().maxCards,
      dry_run: dryRun
    }
  });
  addWorkflowStep({
    run_id: runId,
    step_key: "format_recommendation",
    status: "ok",
    payload: {
      date,
      card_count: preview.cards.length,
      message_summary: summarizeText(preview.message, 220)
    }
  });

  const delivery = deliverRecommendation({
    message: preview.message,
    dryRun
  });
  addWorkflowStep({
    run_id: runId,
    step_key: dryRun ? "wechat_dry_run" : "wechat_send",
    status: delivery.ok ? "ok" : "failed",
    payload: {
      channel: preview.channel,
      target: preview.target,
      delivery
    }
  });

  const finalStatus = delivery.ok ? "succeeded" : "failed";
  const workflowRun = updateWorkflowRun(runId, {
    status: finalStatus,
    summary: delivery.ok
      ? dryRun
        ? `微信推荐预览已生成：${preview.cards.length} 张卡片`
        : `微信推荐已发送：${preview.cards.length} 张卡片`
      : "微信推荐发送失败",
    error_text: delivery.ok ? "" : delivery.message || delivery.error || "unknown_error",
    output: {
      card_count: preview.cards.length,
      delivery
    }
  });

  return {
    ...preview,
    ok: delivery.ok,
    dry_run: dryRun,
    run_id: runId,
    workflow_run: workflowRun,
    delivery
  };
}
