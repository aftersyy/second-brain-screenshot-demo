import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getScreenshotDir, getScriptsDir, resolveInRoot } from "./config.js";
import { recordPipelineEvent, upsertCard } from "./db.js";
import { writeCardMarkdown } from "./markdown.js";
import { extractCardCandidate } from "./pipeline.js";
import { nowIso, safeParseJson, summarizeText } from "./utils.js";

const PROCESSED_STATE_PATH = resolveInRoot("state", "processed.json");

function readProcessedState() {
  if (!fs.existsSync(PROCESSED_STATE_PATH)) {
    return { processed_files: [], last_scan: null };
  }
  return safeParseJson(fs.readFileSync(PROCESSED_STATE_PATH, "utf8"), {
    processed_files: [],
    last_scan: null
  });
}

function writeProcessedState(state) {
  fs.writeFileSync(PROCESSED_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function readTextFromImage(imagePath) {
  const scriptPath = path.join(getScriptsDir(), "ocr.swift");
  const output = execFileSync("swift", [scriptPath, imagePath], {
    cwd: resolveInRoot("scripts"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return output.trim();
}

export function runIngest() {
  const screenshotDir = getScreenshotDir();
  const runId = `run_${Date.now()}`;
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const processedState = readProcessedState();
  const processedFiles = new Set(processedState.processed_files || []);

  if (!screenshotDir || !fs.existsSync(screenshotDir)) {
    recordPipelineEvent({
      run_id: runId,
      stage: "ingest",
      item_key: "workspace",
      status: "skipped",
      payload: { reason: "screenshot_dir_missing", screenshotDir }
    });
    return { run_id: runId, processed: [], skipped: true };
  }

  const imageFiles = fs
    .readdirSync(screenshotDir)
    .filter((fileName) => /\.(png|jpe?g|webp)$/iu.test(fileName))
    .filter((fileName) => !processedFiles.has(fileName))
    .sort();

  const processed = [];
  for (const fileName of imageFiles) {
    const imagePath = path.join(screenshotDir, fileName);
    recordPipelineEvent({
      run_id: runId,
      stage: "ingest",
      item_key: fileName,
      status: "started",
      payload: { imagePath }
    });

    try {
      const sourceText = readTextFromImage(imagePath);
      recordPipelineEvent({
        run_id: runId,
        stage: "ocr",
        item_key: fileName,
        status: "completed",
        payload: { preview: summarizeText(sourceText, 120) }
      });

      const { card, agent_result: agentResult, used_fallback: usedFallback } = extractCardCandidate({ date, fileName, sourceText });
      recordPipelineEvent({
        run_id: runId,
        stage: "agent_extract",
        item_key: card.card_id,
        status: card.status,
        payload: {
          agent: card.metadata?.agent || "extract-agent",
          runtime: card.metadata?.agent_runtime || "fallback",
          used_fallback: usedFallback,
          confidence: card.confidence,
          error: agentResult.ok ? "" : agentResult.error || agentResult.stderr || ""
        }
      });

      if (card.status === "draft") {
        recordPipelineEvent({
          run_id: runId,
          stage: "route",
          item_key: fileName,
          status: "ignored",
          payload: { reason: card.metadata?.fallback_reason || "draft_candidate" }
        });
        processedFiles.add(fileName);
        continue;
      }

      const filePath = writeCardMarkdown({
        ...card,
        created_at: nowIso(),
        updated_at: nowIso()
      });
      const persisted = upsertCard({ ...card, file_path: filePath });
      recordPipelineEvent({
        run_id: runId,
        stage: "publish",
        item_key: persisted.card_id,
        status: "review",
        payload: { file_path: filePath }
      });
      processedFiles.add(fileName);
      processed.push(persisted);
    } catch (error) {
      recordPipelineEvent({
        run_id: runId,
        stage: "ingest",
        item_key: fileName,
        status: "failed",
        payload: { error: String(error.message || error) }
      });
    }
  }

  writeProcessedState({
    processed_files: [...processedFiles].sort(),
    last_scan: nowIso()
  });
  return { run_id: runId, processed, skipped: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const result = runIngest();
  console.log(JSON.stringify(result, null, 2));
}
