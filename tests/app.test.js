import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

process.env.OPENCLAW_CLI = "/tmp/openclaw-not-installed.mjs";

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-agent-"));
  fs.mkdirSync(path.join(root, "cards"), { recursive: true });
  fs.mkdirSync(path.join(root, "knowledge-base"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  fs.mkdirSync(path.join(root, "demo", "fixtures"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "USER.md"),
    "- **截图文件夹**：`/tmp/not-used`\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "cards", "2026-04-18.md"),
    `# 📚 2026-04-18 知识卡片

---

### 卡片 1：三重脑模型
- **要点**：
  - 人类大脑分三层
  - 拖延并非简单的意志力问题
- **思考**：设计系统比责怪自己更有效
- **频次/重要性**：高
- **标签**：#心理学 #方法论
`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "demo", "fixtures", "cards.json"),
    JSON.stringify({
      published_cards: [
        {
          title: "Demo Published",
          summary: "demo summary",
          content: "- point one",
          insights: "demo insight",
          importance: "high",
          tags: ["AI"],
          source_type: "knowledge-base",
          source_files: ["knowledge-base/__TODAY__.md"],
          source_text: "demo source",
          status: "published",
          confidence: 0.9,
          knowledge_date: "__TODAY__",
          metadata: { demo_seed: true }
        }
      ],
      review_cards: [
        {
          title: "Demo Review",
          summary: "demo review summary",
          content: "- candidate point",
          insights: "",
          importance: "medium",
          tags: ["Review"],
          source_type: "demo-upload",
          source_files: ["demo/review.png"],
          source_text: "candidate source",
          status: "review",
          confidence: 0.8,
          knowledge_date: "__TODAY__",
          metadata: { demo_seed: true }
        }
      ]
    }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "demo", "fixtures", "ingest-fixtures.json"),
    JSON.stringify({
      items: [
        {
          fixture_id: "codex-figma",
          title: "Demo Ingest Candidate",
          summary: "fixture summary",
          content: "- imported point",
          insights: "needs review",
          importance: "high",
          tags: ["AI工具"],
          source_type: "demo-upload",
          source_files: ["demo/import.png"],
          source_text: "fixture source",
          confidence: 0.88,
          knowledge_date: "__TODAY__"
        }
      ]
    }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "demo", "fixtures", "reference-sources.json"),
    JSON.stringify({
      items: [
        {
          topic: "Demo Published",
          keywords: ["demo", "published"],
          title: "Reference",
          url: "https://example.com/reference"
        }
      ]
    }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "demo", "fixtures", "manifest.json"),
    JSON.stringify({ name: "demo" }, null, 2),
    "utf8"
  );
  return root;
}

test("migration imports legacy markdown into structured cards", async () => {
  const root = createFixtureRoot();
  process.env.KNOWLEDGE_AGENT_ROOT = root;

  const { migrateLegacyData } = await import("../src/migrate.js");
  const result = migrateLegacyData();

  assert.equal(result.imported_count, 1);
  const cardFile = fs.readdirSync(path.join(root, "card-library", "2026-04-18"));
  assert.equal(cardFile.length, 1);
});

test("migration imports raw knowledge-base entries produced by legacy daytime workflow", async () => {
  const root = createFixtureRoot();
  process.env.KNOWLEDGE_AGENT_ROOT = root;

  fs.writeFileSync(
    path.join(root, "knowledge-base", "2026-04-20.md"),
    `## [截屏2026-04-20 15.45.04.png]
**分类标签**: 技术/AI工具
**提取时间**: 16:00
**OCR原始内容**:
Codex + Figma AI设计工作流
核心功能：输入产品需求，AI直接在Figma生成可编辑设计稿

**知识要点**:
- Codex是AI设计助手，可联动Figma自动生成设计稿
- 关键步骤：安装插件→自检测试→design-generator生成规范→输出到Figma
`,
    "utf8"
  );

  const { migrateLegacyData } = await import("../src/migrate.js");
  const { listCards } = await import("../src/db.js");

  migrateLegacyData();
  const cards = listCards({ date: "2026-04-20", status: "published" });

  assert.equal(cards.length, 1);
  assert.match(cards[0].title, /Codex|Figma/);
  assert.equal(cards[0].source_type, "knowledge-base");
});

test("server exposes cards and citation-based chat", async () => {
  const root = createFixtureRoot();
  process.env.KNOWLEDGE_AGENT_ROOT = root;

  const { migrateLegacyData } = await import("../src/migrate.js");
  const { listCards } = await import("../src/db.js");
  const { answerQuestion } = await import("../src/chat.js");

  migrateLegacyData();
  const cardsPayload = listCards({});
  assert.equal(cardsPayload.length, 1);

  const chatPayload = answerQuestion({ question: "拖延的底层逻辑是什么？" });
  assert.match(chatPayload.answer, /三重脑模型/);
  assert.equal(chatPayload.citations.length, 1);
});

test("demo seed and workflow endpoints support competition demo flows", async () => {
  const root = createFixtureRoot();
  process.env.KNOWLEDGE_AGENT_ROOT = root;
  process.env.DEMO_MODE = "true";
  process.env.ENABLE_WEB_SEARCH = "true";

  const { seedDemoData } = await import("../src/demo.js");
  const { getSystemCapabilities } = await import("../src/capabilities.js");
  const { listWorkflowRuns } = await import("../src/db.js");
  const { startDigestWorkflow, startIngestWorkflow } = await import("../src/workflows.js");

  const seedResponse = seedDemoData();
  assert.equal(seedResponse.published_count, 1);

  const capabilities = getSystemCapabilities();
  assert.equal(capabilities.demo_mode, true);

  const ingestResponse = await startIngestWorkflow({ mode: "demo_upload" });
  assert.match(ingestResponse.run_id, /ingest_workflow_/);

  const digestResponse = startDigestWorkflow({ date: new Date().toISOString().slice(0, 10) });
  assert.match(digestResponse.run_id, /daily_digest_workflow_/);

  const runs = listWorkflowRuns(5);
  assert.ok(runs.length >= 2);
});

test("agent pipeline falls back when OpenClaw model is unavailable", async () => {
  process.env.OPENCLAW_CLI = "/tmp/openclaw-not-installed.mjs";

  const { extractCardCandidate } = await import("../src/pipeline.js");
  const result = extractCardCandidate({
    date: "2026-05-20",
    fileName: "screenshot.png",
    sourceText: "Codex Agent 工作流\n核心步骤：先 OCR，再提炼卡片，最后进入审核队列。"
  });

  assert.equal(result.used_fallback, true);
  assert.equal(result.card.status, "review");
  assert.equal(result.card.metadata.agent_runtime, "fallback");
});

test("scheduler exposes OpenClaw cron plan without installing jobs", async () => {
  const root = createFixtureRoot();
  process.env.KNOWLEDGE_AGENT_ROOT = root;

  const { getSchedulerPlan, installOpenClawCronJobs } = await import("../src/scheduler.js");
  const plan = getSchedulerPlan();

  assert.equal(plan.length, 3);
  assert.match(plan[0].name, /截图扫描/);

  const dryRun = installOpenClawCronJobs({ dryRun: true });
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.jobs.length, 3);
});

test("user settings drive schedule and wechat push configuration", async () => {
  const root = createFixtureRoot();
  process.env.KNOWLEDGE_AGENT_ROOT = root;

  const { writeSettings, readSettings } = await import("../src/settings.js");
  const { getSchedulerPlan } = await import("../src/scheduler.js");

  const settings = writeSettings({
    schedule: {
      timezone: "Asia/Shanghai",
      ingest_times: ["09:30", "18:15"],
      digest_time: "21:10",
      wechat_push_time: "21:40"
    },
    wechat: {
      channel: "openclaw-weixin",
      target: "demo-user",
      account: "demo-account",
      transport: "weixin-api",
      max_cards: 3,
      auto_push_enabled: true
    }
  });

  assert.deepEqual(readSettings().schedule.ingest_times, ["09:30", "18:15"]);
  assert.equal(settings.wechat.max_cards, 3);

  const plan = getSchedulerPlan();
  assert.equal(plan.length, 4);
  assert.equal(plan[0].cron, "30 9 * * *");
  assert.equal(plan[1].cron, "15 18 * * *");
  assert.equal(plan[2].cron, "10 21 * * *");
  assert.equal(plan[3].cron, "40 21 * * *");
});
