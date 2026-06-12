import { answerQuestion } from "./chat.js";
import { isDemoMode } from "./config.js";
import {
  addWorkflowStep,
  createWorkflowRun,
  getCardById,
  getWorkflowRun,
  listCards,
  updateWorkflowRun,
  upsertCard
} from "./db.js";
import { loadDemoIngestFixture } from "./demo.js";
import { generateDailyArtifacts } from "./digest.js";
import { runIngest } from "./ingest.js";
import { writeCardMarkdown } from "./markdown.js";
import { migrateLegacyData } from "./migrate.js";
import { createCardId, nowIso } from "./utils.js";

function newRunId(prefix) {
  return `${prefix}_${Date.now()}`;
}

function beginRun({ workflowType, mode, input }) {
  return createWorkflowRun({
    run_id: newRunId(workflowType),
    workflow_type: workflowType,
    mode,
    status: "running",
    input
  });
}

function step(runId, stepKey, status, payload = {}) {
  addWorkflowStep({
    run_id: runId,
    step_key: stepKey,
    status,
    payload
  });
}

function finishRun(runId, changes) {
  return updateWorkflowRun(runId, {
    ...changes,
    status: changes.status || "completed"
  });
}

function failRun(runId, error) {
  return updateWorkflowRun(runId, {
    status: "failed",
    error_text: String(error.message || error),
    summary: "workflow failed"
  });
}

function createCandidateCardFromFixture(fixture) {
  const createdAt = nowIso();
  const card = {
    card_id: createCardId(fixture.knowledge_date, fixture.title),
    title: fixture.title,
    summary: fixture.summary,
    content: fixture.content,
    insights: fixture.insights || "",
    importance: fixture.importance || "medium",
    tags: fixture.tags || [],
    source_type: fixture.source_type || "demo-upload",
    source_files: fixture.source_files || [],
    source_text: fixture.source_text || "",
    status: "review",
    confidence: Number(fixture.confidence || 0.84),
    knowledge_date: fixture.knowledge_date,
    embedding_ref: "",
    metadata: {
      fixture_id: fixture.fixture_id,
      ingest_strategy: "demo-fixture-v1",
      review_required: true
    },
    created_at: createdAt,
    updated_at: createdAt
  };
  const filePath = writeCardMarkdown(card);
  return upsertCard({ ...card, file_path: filePath });
}

export async function startIngestWorkflow({ mode = "screenshot_scan", fixture_id: fixtureId } = {}) {
  const run = beginRun({
    workflowType: "ingest_workflow",
    mode,
    input: { fixture_id: fixtureId || "", demo_mode: isDemoMode() }
  });

  try {
    if (mode === "demo_upload" || isDemoMode()) {
      step(run.run_id, "load_fixture", "running", { fixture_id: fixtureId || "codex-figma" });
      const fixture = loadDemoIngestFixture(fixtureId);
      step(run.run_id, "load_fixture", "completed", { title: fixture.title });
      step(run.run_id, "extract_candidate", "running");
      const candidate = createCandidateCardFromFixture(fixture);
      step(run.run_id, "extract_candidate", "completed", { candidate_card_ids: [candidate.card_id] });
      return finishRun(run.run_id, {
        summary: "demo ingest completed",
        output: {
          candidate_card_ids: [candidate.card_id],
          published_card_ids: []
        }
      });
    }

    const beforeIds = new Set(listCards({ date: new Date().toISOString().slice(0, 10), limit: 500 }).map((card) => card.card_id));
    step(run.run_id, "scan_screenshots", "running", { runtime: "local_ocr_openclaw_agent" });
    const localResult = runIngest();
    step(run.run_id, "scan_screenshots", "completed", {
      processed: localResult.processed.length,
      skipped: localResult.skipped,
      runtime: "local_ocr_openclaw_agent"
    });

    step(run.run_id, "sync_structured_cards", "running");
    migrateLegacyData();
    const todayCards = listCards({ date: new Date().toISOString().slice(0, 10), limit: 500 });
    const candidateCardIds = todayCards.filter((card) => card.status === "review").map((card) => card.card_id);
    const publishedCardIds = todayCards
      .filter((card) => card.status === "published" && !beforeIds.has(card.card_id))
      .map((card) => card.card_id);
    step(run.run_id, "sync_structured_cards", "completed", {
      candidate_card_ids: candidateCardIds,
      published_card_ids: publishedCardIds
    });
    return finishRun(run.run_id, {
      summary: "screenshot scan completed",
      output: {
        candidate_card_ids: candidateCardIds,
        published_card_ids: publishedCardIds
      }
    });
  } catch (error) {
    failRun(run.run_id, error);
    throw error;
  }
}

export function startDigestWorkflow({ date }) {
  const run = beginRun({
    workflowType: "daily_digest_workflow",
    mode: "manual",
    input: { date }
  });

  try {
    step(run.run_id, "collect_cards", "running", { date });
    const digest = generateDailyArtifacts(date);
    step(run.run_id, "collect_cards", "completed", { count: digest.count });
    step(run.run_id, "render_digest", "completed", {
      published_card_ids: digest.cards.map((card) => card.card_id)
    });
    return finishRun(run.run_id, {
      summary: "daily digest completed",
      output: {
        published_card_ids: digest.cards.map((card) => card.card_id),
        summary_preview: digest.legacyCards.slice(0, 240)
      }
    });
  } catch (error) {
    failRun(run.run_id, error);
    throw error;
  }
}

export function approveCandidateWorkflow(cardId, buildNextCard) {
  const run = beginRun({
    workflowType: "review_workflow",
    mode: "approve",
    input: { card_id: cardId }
  });

  try {
    const existing = getCardById(cardId);
    if (!existing) throw new Error("candidate_card_not_found");
    step(run.run_id, "load_candidate", "completed", { card_id: cardId });
    step(run.run_id, "publish_card", "running");
    const nextCard = buildNextCard(existing);
    const filePath = writeCardMarkdown(nextCard);
    const published = upsertCard({ ...nextCard, file_path: filePath });
    step(run.run_id, "publish_card", "completed", { published_card_ids: [published.card_id] });
    return finishRun(run.run_id, {
      summary: "candidate approved",
      output: { published_card_ids: [published.card_id] }
    });
  } catch (error) {
    failRun(run.run_id, error);
    throw error;
  }
}

export function rejectCandidateWorkflow(cardId, buildNextCard) {
  const run = beginRun({
    workflowType: "review_workflow",
    mode: "reject",
    input: { card_id: cardId }
  });

  try {
    const existing = getCardById(cardId);
    if (!existing) throw new Error("candidate_card_not_found");
    step(run.run_id, "load_candidate", "completed", { card_id: cardId });
    const nextCard = buildNextCard(existing);
    const filePath = writeCardMarkdown(nextCard);
    const archived = upsertCard({ ...nextCard, file_path: filePath });
    step(run.run_id, "archive_candidate", "completed", { archived_card_ids: [archived.card_id] });
    return finishRun(run.run_id, {
      summary: "candidate rejected",
      output: { archived_card_ids: [archived.card_id] }
    });
  } catch (error) {
    failRun(run.run_id, error);
    throw error;
  }
}

export function readWorkflowRun(runId) {
  return getWorkflowRun(runId);
}
