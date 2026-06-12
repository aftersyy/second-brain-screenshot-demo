import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { getPublicDir, isDemoMode } from "./config.js";
import { getSystemCapabilities, getSystemHealth } from "./capabilities.js";
import { answerQuestion } from "./chat.js";
import { getCardById, getCardPipelineEvents, listCards, listWorkflowRuns, upsertCard } from "./db.js";
import { buildDailyResponse, generateDailyArtifacts } from "./digest.js";
import { readDemoManifest, resetAndSeedDemoData, seedDemoData } from "./demo.js";
import { writeCardMarkdown } from "./markdown.js";
import { migrateLegacyData } from "./migrate.js";
import { buildWechatRecommendationPreview, pushWechatRecommendation } from "./push.js";
import { getSchedulerPlan, installOpenClawCronJobs } from "./scheduler.js";
import { readSettings, writeSettings } from "./settings.js";
import { nowIso, parseTags } from "./utils.js";
import { getWechatConnectionStatus, readWechatQrConnectSession, startWechatQrConnect } from "./wechat-connect.js";
import {
  approveCandidateWorkflow,
  readWorkflowRun,
  rejectCandidateWorkflow,
  startDigestWorkflow,
  startIngestWorkflow
} from "./workflows.js";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, payload, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, { "content-type": contentType });
  response.end(payload);
}

function notFound(response) {
  sendJson(response, 404, { error: "not_found" });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(request, response) {
  const requested = request.url === "/" ? "/index.html" : request.url;
  const filePath = path.join(getPublicDir(), requested.replace(/\?.*$/u, ""));
  if (!filePath.startsWith(getPublicDir()) || !fs.existsSync(filePath)) {
    notFound(response);
    return true;
  }

  const ext = path.extname(filePath);
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";

  sendText(response, 200, fs.readFileSync(filePath), contentType);
  return true;
}

function updateCard(cardId, changes) {
  const existing = getCardById(cardId);
  if (!existing) return null;

  const nextCard = {
    ...existing,
    ...changes,
    tags: changes.tags ? parseTags(changes.tags) : existing.tags,
    source_files: changes.source_files || existing.source_files,
    metadata: {
      ...(existing.metadata || {}),
      ...(changes.metadata || {})
    },
    citations: changes.citations || existing.citations,
    updated_at: nowIso()
  };

  const filePath = writeCardMarkdown(nextCard);
  return upsertCard({ ...nextCard, file_path: filePath });
}

function createServer() {
  migrateLegacyData();

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/cards") {
      sendJson(response, 200, {
        items: listCards({
          status: url.searchParams.get("status") || "",
          importance: url.searchParams.get("importance") || "",
          date: url.searchParams.get("date") || "",
          source_type: url.searchParams.get("source_type") || "",
          tag: url.searchParams.get("tag") || "",
          q: url.searchParams.get("q") || "",
          limit: Number(url.searchParams.get("limit") || 100)
        })
      });
      return;
    }

    if (request.method === "GET" && /^\/api\/cards\/[^/]+$/u.test(url.pathname)) {
      const cardId = decodeURIComponent(url.pathname.split("/").pop());
      const card = getCardById(cardId);
      if (!card) return notFound(response);
      sendJson(response, 200, {
        item: card,
        events: getCardPipelineEvents(cardId)
      });
      return;
    }

    if (request.method === "PATCH" && /^\/api\/cards\/[^/]+$/u.test(url.pathname)) {
      const cardId = decodeURIComponent(url.pathname.split("/").pop());
      const body = await readJson(request);
      const updated = updateCard(cardId, body);
      if (!updated) return notFound(response);
      sendJson(response, 200, { item: updated });
      return;
    }

    if (request.method === "POST" && /^\/api\/review\/[^/]+\/approve$/u.test(url.pathname)) {
      const cardId = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readJson(request);
      const existing = getCardById(cardId);
      if (!existing) return notFound(response);
      const workflowRun = approveCandidateWorkflow(cardId, (current) => ({
        ...current,
        ...body,
        tags: body.tags ? parseTags(body.tags) : current.tags,
        source_files: body.source_files || current.source_files,
        status: "published",
        metadata: {
          ...(current.metadata || {}),
          review_approved: true,
          approved_at: nowIso()
        },
        citations: body.citations || current.citations,
        updated_at: nowIso()
      }));
      const updated = getCardById(cardId);
      if (!updated) return notFound(response);
      sendJson(response, 200, { item: updated, workflow_run: workflowRun });
      return;
    }

    if (request.method === "POST" && /^\/api\/review\/[^/]+\/reject$/u.test(url.pathname)) {
      const cardId = decodeURIComponent(url.pathname.split("/")[3]);
      const workflowRun = rejectCandidateWorkflow(cardId, (current) => ({
        ...current,
        status: "archived",
        metadata: {
          ...(current.metadata || {}),
          rejected_at: nowIso()
        },
        updated_at: nowIso()
      }));
      const updated = getCardById(cardId);
      if (!updated) return notFound(response);
      sendJson(response, 200, { item: updated, workflow_run: workflowRun });
      return;
    }

    if (request.method === "GET" && /^\/api\/daily\/\d{4}-\d{2}-\d{2}$/u.test(url.pathname)) {
      const date = url.pathname.split("/").pop();
      sendJson(response, 200, buildDailyResponse(date));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(request);
      sendJson(response, 200, answerQuestion(body));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/workflows") {
      sendJson(response, 200, {
        items: listWorkflowRuns(Number(url.searchParams.get("limit") || 10))
      });
      return;
    }

    if (request.method === "GET" && /^\/api\/workflows\/[^/]+$/u.test(url.pathname)) {
      const runId = decodeURIComponent(url.pathname.split("/").pop());
      const run = readWorkflowRun(runId);
      if (!run) return notFound(response);
      sendJson(response, 200, { item: run });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/workflows/ingest") {
      try {
        const body = await readJson(request);
        const result = await startIngestWorkflow(body);
        sendJson(response, 200, {
          ok: true,
          run_id: result.run_id,
          item: result
        });
      } catch (error) {
        sendJson(response, 502, {
          ok: false,
          error: "ingest_workflow_failed",
          message: String(error.message || error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ingest/run") {
      try {
        const result = await startIngestWorkflow({
          mode: isDemoMode() ? "demo_upload" : "screenshot_scan"
        });
        sendJson(response, 200, {
          ok: true,
          run_id: result.run_id,
          summary: result.summary,
          item: result
        });
      } catch (error) {
        sendJson(response, 502, {
          ok: false,
          error: "ingest_workflow_failed",
          message: String(error.message || error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/workflows/digest") {
      try {
        const body = await readJson(request);
        const date = body.date || new Date().toISOString().slice(0, 10);
        const result = startDigestWorkflow({ date });
        sendJson(response, 200, {
          ok: true,
          run_id: result.run_id,
          item: result
        });
      } catch (error) {
        sendJson(response, 500, {
          ok: false,
          error: "digest_workflow_failed",
          message: String(error.message || error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/push/wechat/preview") {
      sendJson(response, 200, buildWechatRecommendationPreview({
        date: url.searchParams.get("date") || "",
        limit: Number(url.searchParams.get("limit") || 0)
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/push/wechat") {
      try {
        const body = await readJson(request);
        const result = pushWechatRecommendation({
          date: body.date,
          limit: body.limit,
          dry_run: body.dry_run !== false,
          confirm: body.confirm === true
        });
        sendJson(response, result.requires_confirmation ? 409 : result.ok ? 200 : 502, result);
      } catch (error) {
        sendJson(response, 502, {
          ok: false,
          error: "wechat_push_failed",
          message: String(error.message || error)
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      sendJson(response, 200, { item: readSettings() });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const body = await readJson(request);
      sendJson(response, 200, { item: writeSettings(body) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/wechat/connect") {
      sendJson(response, 200, { item: getWechatConnectionStatus(), session: readWechatQrConnectSession() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/wechat/connect/start") {
      sendJson(response, 200, startWechatQrConnect());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/demo/seed") {
      const payload = seedDemoData();
      sendJson(response, 200, { ok: true, ...payload });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/demo/reset") {
      const payload = resetAndSeedDemoData();
      sendJson(response, 200, { ok: true, ...payload });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/demo/manifest") {
      sendJson(response, 200, { item: readDemoManifest() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/system/capabilities") {
      sendJson(response, 200, getSystemCapabilities());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/system/health") {
      sendJson(response, 200, await getSystemHealth());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/scheduler/plan") {
      sendJson(response, 200, { items: getSchedulerPlan() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/scheduler/install") {
      const body = await readJson(request);
      try {
        sendJson(response, 200, installOpenClawCronJobs({ dryRun: body.dry_run !== false }));
      } catch (error) {
        sendJson(response, 502, {
          ok: false,
          error: "scheduler_install_failed",
          message: String(error.message || error)
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/sync/run") {
      const sync = migrateLegacyData();
      sendJson(response, 200, {
        ok: true,
        imported_count: sync.imported_count
      });
      return;
    }

    serveStatic(request, response);
  });
}

export function startServer(port = Number(process.env.PORT || 3017)) {
  const server = createServer();
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT || 3017);
  startServer(port).then(() => {
    console.log(`Knowledge agent UI running at http://127.0.0.1:${port}`);
  });
}
