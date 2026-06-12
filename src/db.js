import { DatabaseSync } from "node:sqlite";
import { ensureDir, getDatabasePath, getStateDir } from "./config.js";
import { nowIso, parseTags, safeParseJson } from "./utils.js";

let database;
let databasePath;

function syncFts(card) {
  const db = getDb();
  db.prepare("DELETE FROM cards_fts WHERE card_id = ?").run(card.card_id);
  db.prepare(
    `INSERT INTO cards_fts (card_id, title, summary, content, insights, tags)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    card.card_id,
    card.title,
    card.summary || "",
    card.content || "",
    card.insights || "",
    (card.tags || []).join(" ")
  );
}

function rowToCard(row, db = getDb()) {
  if (!row) return null;
  const tags = db
    .prepare("SELECT tag FROM card_tags WHERE card_id = ? ORDER BY tag")
    .all(row.card_id)
    .map((item) => item.tag);
  const sources = db
    .prepare("SELECT source_file FROM card_sources WHERE card_id = ? ORDER BY source_file")
    .all(row.card_id)
    .map((item) => item.source_file);

  return {
    ...row,
    tags,
    source_files: sources,
    metadata: safeParseJson(row.metadata_json, {}),
    citations: safeParseJson(row.citations_json, [])
  };
}

export function getDb() {
  const nextPath = getDatabasePath();
  if (database && databasePath === nextPath) return database;
  if (database && typeof database.close === "function") {
    database.close();
  }
  ensureDir(getStateDir());
  database = new DatabaseSync(nextPath);
  databasePath = nextPath;
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      card_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      insights TEXT NOT NULL,
      importance TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_text TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      knowledge_date TEXT NOT NULL,
      embedding_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      file_path TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      citations_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS card_tags (
      card_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (card_id, tag)
    );

    CREATE TABLE IF NOT EXISTS card_sources (
      card_id TEXT NOT NULL,
      source_file TEXT NOT NULL,
      PRIMARY KEY (card_id, source_file)
    );

    CREATE TABLE IF NOT EXISTS pipeline_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      item_key TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_digests (
      knowledge_date TEXT PRIMARY KEY,
      summary_md TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      run_id TEXT PRIMARY KEY,
      workflow_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      error_text TEXT NOT NULL DEFAULT '',
      retry_count INTEGER NOT NULL DEFAULT 0,
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step_key TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_traces (
      trace_id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      mode TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      response_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
        card_id UNINDEXED,
        title,
        summary,
        content,
        insights,
        tags
      );
    `);
  } catch {
    database.exec(`
      CREATE TABLE IF NOT EXISTS cards_fts (
        card_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        insights TEXT NOT NULL,
        tags TEXT NOT NULL
      );
    `);
  }

  return database;
}

export function upsertCard(card) {
  const db = getDb();
  const now = nowIso();
  const payload = {
    ...card,
    created_at: card.created_at || now,
    updated_at: now,
    metadata_json: JSON.stringify(card.metadata || {}),
    citations_json: JSON.stringify(card.citations || []),
    tags: parseTags(card.tags || []),
    source_files: [...new Set(card.source_files || [])]
  };

  const dbRow = {
    card_id: payload.card_id,
    title: payload.title,
    summary: payload.summary || "",
    content: payload.content || "",
    insights: payload.insights || "",
    importance: payload.importance,
    source_type: payload.source_type,
    source_text: payload.source_text || "",
    status: payload.status,
    confidence: payload.confidence,
    knowledge_date: payload.knowledge_date,
    embedding_ref: payload.embedding_ref || "",
    created_at: payload.created_at,
    updated_at: payload.updated_at,
    file_path: payload.file_path,
    metadata_json: payload.metadata_json,
    citations_json: payload.citations_json
  };

  db.prepare(
    `INSERT INTO cards (
      card_id, title, summary, content, insights, importance, source_type, source_text,
      status, confidence, knowledge_date, embedding_ref, created_at, updated_at,
      file_path, metadata_json, citations_json
    ) VALUES (
      @card_id, @title, @summary, @content, @insights, @importance, @source_type, @source_text,
      @status, @confidence, @knowledge_date, @embedding_ref, @created_at, @updated_at,
      @file_path, @metadata_json, @citations_json
    )
    ON CONFLICT(card_id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      content = excluded.content,
      insights = excluded.insights,
      importance = excluded.importance,
      source_type = excluded.source_type,
      source_text = excluded.source_text,
      status = excluded.status,
      confidence = excluded.confidence,
      knowledge_date = excluded.knowledge_date,
      embedding_ref = excluded.embedding_ref,
      updated_at = excluded.updated_at,
      file_path = excluded.file_path,
      metadata_json = excluded.metadata_json,
      citations_json = excluded.citations_json`
  ).run(dbRow);

  db.prepare("DELETE FROM card_tags WHERE card_id = ?").run(payload.card_id);
  db.prepare("DELETE FROM card_sources WHERE card_id = ?").run(payload.card_id);
  const insertTag = db.prepare("INSERT INTO card_tags (card_id, tag) VALUES (?, ?)");
  const insertSource = db.prepare("INSERT INTO card_sources (card_id, source_file) VALUES (?, ?)");

  for (const tag of payload.tags) insertTag.run(payload.card_id, tag);
  for (const sourceFile of payload.source_files) insertSource.run(payload.card_id, sourceFile);
  syncFts(payload);

  return getCardById(payload.card_id);
}

export function getCardById(cardId) {
  return rowToCard(getDb().prepare("SELECT * FROM cards WHERE card_id = ?").get(cardId));
}

export function listCards(filters = {}) {
  const db = getDb();
  const where = [];
  const params = [];

  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.importance) {
    where.push("importance = ?");
    params.push(filters.importance);
  }
  if (filters.date) {
    where.push("knowledge_date = ?");
    params.push(filters.date);
  }
  if (filters.source_type) {
    where.push("source_type = ?");
    params.push(filters.source_type);
  }
  if (filters.tag) {
    where.push("EXISTS (SELECT 1 FROM card_tags ct WHERE ct.card_id = cards.card_id AND ct.tag = ?)");
    params.push(filters.tag);
  }

  let rows;
  if (filters.q) {
    const like = `%${filters.q}%`;
    const searchWhere = [
      ...where,
      `(title LIKE ? OR summary LIKE ? OR content LIKE ? OR insights LIKE ? OR EXISTS (
        SELECT 1 FROM card_tags ct
        WHERE ct.card_id = cards.card_id AND ct.tag LIKE ?
      ))`
    ];
    const statement = db.prepare(`
      SELECT *
      FROM cards
      WHERE ${searchWhere.join(" AND ")}
      ORDER BY knowledge_date DESC, updated_at DESC
      LIMIT ?
    `);
    rows = statement.all(...params, like, like, like, like, like, Number(filters.limit || 100));
  } else {
    const statement = db.prepare(`
      SELECT *
      FROM cards
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY knowledge_date DESC, updated_at DESC
      LIMIT ?
    `);
    rows = statement.all(...params, Number(filters.limit || 100));
  }

  return rows.map((row) => rowToCard(row, db));
}

export function getDailySummary(date) {
  return getDb().prepare("SELECT * FROM daily_digests WHERE knowledge_date = ?").get(date);
}

export function upsertDailySummary(date, summaryMd) {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO daily_digests (knowledge_date, summary_md, generated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(knowledge_date) DO UPDATE SET
         summary_md = excluded.summary_md,
         generated_at = excluded.generated_at`
    )
    .run(date, summaryMd, now);
}

export function recordPipelineEvent(event) {
  getDb()
    .prepare(
      `INSERT INTO pipeline_events (run_id, stage, item_key, status, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.run_id,
      event.stage,
      event.item_key,
      event.status,
      JSON.stringify(event.payload || {}),
      event.created_at || nowIso()
    );
}

export function getCardPipelineEvents(cardId) {
  return getDb()
    .prepare(
      `SELECT *
       FROM pipeline_events
       WHERE item_key = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(cardId)
    .map((row) => ({
      ...row,
      payload: safeParseJson(row.payload_json, {})
    }));
}

export function createWorkflowRun(run) {
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO workflow_runs (
      run_id, workflow_type, mode, status, summary, error_text, retry_count,
      input_json, output_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.run_id,
    run.workflow_type,
    run.mode || "manual",
    run.status || "queued",
    run.summary || "",
    run.error_text || "",
    Number(run.retry_count || 0),
    JSON.stringify(run.input || {}),
    JSON.stringify(run.output || {}),
    run.created_at || now,
    run.updated_at || now
  );
  return getWorkflowRun(run.run_id);
}

export function updateWorkflowRun(runId, changes) {
  const existing = getWorkflowRun(runId);
  if (!existing) return null;
  const next = {
    ...existing,
    ...changes,
    input: changes.input || existing.input,
    output: changes.output || existing.output,
    updated_at: nowIso()
  };
  getDb().prepare(
    `UPDATE workflow_runs
     SET workflow_type = ?, mode = ?, status = ?, summary = ?, error_text = ?,
         retry_count = ?, input_json = ?, output_json = ?, updated_at = ?
     WHERE run_id = ?`
  ).run(
    next.workflow_type,
    next.mode,
    next.status,
    next.summary || "",
    next.error_text || "",
    Number(next.retry_count || 0),
    JSON.stringify(next.input || {}),
    JSON.stringify(next.output || {}),
    next.updated_at,
    runId
  );
  return getWorkflowRun(runId);
}

export function addWorkflowStep(step) {
  getDb().prepare(
    `INSERT INTO workflow_steps (run_id, step_key, status, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    step.run_id,
    step.step_key,
    step.status,
    JSON.stringify(step.payload || {}),
    step.created_at || nowIso()
  );
}

export function getWorkflowRun(runId) {
  const row = getDb().prepare("SELECT * FROM workflow_runs WHERE run_id = ?").get(runId);
  if (!row) return null;
  const steps = getDb()
    .prepare(
      `SELECT *
       FROM workflow_steps
       WHERE run_id = ?
       ORDER BY id ASC`
    )
    .all(runId)
    .map((item) => ({
      ...item,
      payload: safeParseJson(item.payload_json, {})
    }));
  return {
    ...row,
    input: safeParseJson(row.input_json, {}),
    output: safeParseJson(row.output_json, {}),
    steps
  };
}

export function listWorkflowRuns(limit = 20) {
  return getDb()
    .prepare(
      `SELECT *
       FROM workflow_runs
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(Number(limit))
    .map((row) => ({
      ...row,
      input: safeParseJson(row.input_json, {}),
      output: safeParseJson(row.output_json, {})
    }));
}

export function insertChatTrace(trace) {
  getDb().prepare(
    `INSERT INTO chat_traces (trace_id, question, mode, context_json, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    trace.trace_id,
    trace.question,
    trace.mode,
    JSON.stringify(trace.context || {}),
    JSON.stringify(trace.response || {}),
    trace.created_at || nowIso()
  );
}

export function resetRuntimeData() {
  const db = getDb();
  db.exec(`
    DELETE FROM card_tags;
    DELETE FROM card_sources;
    DELETE FROM cards_fts;
    DELETE FROM cards;
    DELETE FROM pipeline_events;
    DELETE FROM daily_digests;
    DELETE FROM workflow_steps;
    DELETE FROM workflow_runs;
    DELETE FROM chat_traces;
  `);
}
