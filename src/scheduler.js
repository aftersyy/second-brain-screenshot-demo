import { execFileSync } from "node:child_process";
import { getOpenClawRuntimeStatus } from "./agent-runtime.js";

function buildOpenClawInvocation(status, args) {
  const cliPath = status.cli_path || "openclaw";
  const usesNode = cliPath.endsWith(".mjs") || cliPath.endsWith(".js");
  return usesNode
    ? { command: process.env.OPENCLAW_NODE || process.execPath, args: [cliPath, ...args] }
    : { command: cliPath, args };
}

const DEFAULT_JOBS = [
  {
    name: "第二大脑截图扫描 10:00",
    cron: "0 10 * * *",
    message: "运行第二大脑截图扫描导入流程，生成待审核知识卡片。",
    agent: process.env.OPENCLAW_INGEST_AGENT || "ingest-agent"
  },
  {
    name: "第二大脑截图扫描 16:00",
    cron: "0 16 * * *",
    message: "运行第二大脑截图扫描导入流程，生成待审核知识卡片。",
    agent: process.env.OPENCLAW_INGEST_AGENT || "ingest-agent"
  },
  {
    name: "第二大脑日报生成 22:00",
    cron: "0 22 * * *",
    message: "运行第二大脑日报生成流程，整合今天已发布的知识卡片。",
    agent: process.env.OPENCLAW_DIGEST_AGENT || "digest-agent"
  },
  {
    name: "第二大脑推送预留 22:30",
    cron: "30 22 * * *",
    message: "检查第二大脑日报推送预留步骤；如果没有可推送渠道，只记录状态。",
    agent: process.env.OPENCLAW_DIGEST_AGENT || "digest-agent"
  }
];

export function getSchedulerPlan() {
  return DEFAULT_JOBS.map((job) => ({
    ...job,
    timezone: process.env.TZ || "Asia/Shanghai",
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
