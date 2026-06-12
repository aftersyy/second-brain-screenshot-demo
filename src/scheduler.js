import { execFileSync } from "node:child_process";
import { getOpenClawRuntimeStatus } from "./agent-runtime.js";
import { readSettings } from "./settings.js";

function buildOpenClawInvocation(status, args) {
  const cliPath = status.cli_path || "openclaw";
  const usesNode = cliPath.endsWith(".mjs") || cliPath.endsWith(".js");
  return usesNode
    ? { command: process.env.OPENCLAW_NODE || process.execPath, args: [cliPath, ...args] }
    : { command: cliPath, args };
}

function timeToCron(time) {
  const [hour, minute] = String(time).split(":");
  return `${Number(minute)} ${Number(hour)} * * *`;
}

export function getSchedulerPlan() {
  const settings = readSettings();
  const jobs = [];
  for (const time of settings.schedule.ingest_times) {
    jobs.push({
      name: `第二大脑截图扫描 ${time}`,
      cron: timeToCron(time),
      message: "运行第二大脑截图扫描导入流程，生成待审核知识卡片。",
      agent: process.env.OPENCLAW_INGEST_AGENT || "ingest-agent"
    });
  }
  jobs.push({
    name: `第二大脑日报生成 ${settings.schedule.digest_time}`,
    cron: timeToCron(settings.schedule.digest_time),
    message: "运行第二大脑日报生成流程，整合今天已发布的知识卡片。",
    agent: process.env.OPENCLAW_DIGEST_AGENT || "digest-agent"
  });
  if (settings.wechat.auto_push_enabled && settings.schedule.wechat_push_time) {
    jobs.push({
      name: `第二大脑微信推送 ${settings.schedule.wechat_push_time}`,
      cron: timeToCron(settings.schedule.wechat_push_time),
      message: "运行第二大脑微信卡片推荐推送流程；如果没有可推送渠道，只记录状态。",
      agent: process.env.OPENCLAW_DIGEST_AGENT || "digest-agent"
    });
  }

  return jobs.map((job) => ({
    ...job,
    timezone: settings.schedule.timezone,
    session: "isolated",
    light_context: true
  }));
}

export function installOpenClawCronJobs({ dryRun = false } = {}) {
  const status = getOpenClawRuntimeStatus();
  const jobs = getSchedulerPlan();
  if (dryRun || !status.cli_exists) {
    return {
      ok: status.cli_exists,
      dry_run: true,
      status,
      jobs
    };
  }

  const installed = [];
  for (const job of jobs) {
    const args = [
      "cron",
      "add",
      "--name",
      job.name,
      "--cron",
      job.cron,
      "--tz",
      job.timezone,
      "--agent",
      job.agent,
      "--message",
      job.message,
      "--session",
      job.session,
      "--light-context",
      "--no-deliver",
      "--json"
    ];
    const invocation = buildOpenClawInvocation(status, args);
    const output = execFileSync(invocation.command, invocation.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000
    });
    installed.push({ job, output });
  }
  return {
    ok: true,
    dry_run: false,
    installed
  };
}
