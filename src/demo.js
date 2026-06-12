import fs from "node:fs";
import path from "node:path";
import { getCardLibraryDir, getDemoFixturesDir, getLegacyCardsDir, getLegacyKnowledgeBaseDir } from "./config.js";
import { listCards, resetRuntimeData, upsertCard, upsertDailySummary } from "./db.js";
import { generateDailyArtifacts } from "./digest.js";
import { writeCardMarkdown } from "./markdown.js";
import { createCardId, nowIso } from "./utils.js";

function fixturePath(fileName) {
  return path.join(getDemoFixturesDir(), fileName);
}

function replaceTokens(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => replaceTokens(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTokens(item, replacements)])
    );
  }
  if (typeof value !== "string") return value;
  return Object.entries(replacements).reduce(
    (result, [token, replacement]) => result.replaceAll(token, replacement),
    value
  );
}

function loadFixture(fileName, replacements) {
  const raw = JSON.parse(fs.readFileSync(fixturePath(fileName), "utf8"));
  return replaceTokens(raw, replacements);
}

function clearGeneratedDirectories() {
  fs.rmSync(getCardLibraryDir(), { recursive: true, force: true });
  fs.mkdirSync(getCardLibraryDir(), { recursive: true });
}

function fixtureReplacements() {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  return {
    "__TODAY__": today,
    "__YESTERDAY__": yesterday
  };
}

function persistCard(template) {
  const createdAt = template.created_at || nowIso();
  const card = {
    ...template,
    card_id: template.card_id || createCardId(template.knowledge_date, template.title),
    created_at: createdAt,
    updated_at: nowIso()
  };
  const filePath = writeCardMarkdown(card);
  return upsertCard({ ...card, file_path: filePath });
}

export function seedDemoData() {
  const replacements = fixtureReplacements();
  const fixture = loadFixture("cards.json", replacements);

  resetRuntimeData();
  clearGeneratedDirectories();

  const published = fixture.published_cards.map((card) => persistCard(card));
  const review = fixture.review_cards.map((card) => persistCard(card));

  const dates = [...new Set([...published, ...review].map((card) => card.knowledge_date))];
  for (const date of dates) {
    const digest = generateDailyArtifacts(date);
    upsertDailySummary(date, digest.legacyCards);
  }

  return {
    published_count: published.length,
    review_count: review.length,
    dates
  };
}

export function resetAndSeedDemoData() {
  return seedDemoData();
}

export function loadDemoIngestFixture(fixtureId = "codex-figma") {
  const replacements = fixtureReplacements();
  const fixture = loadFixture("ingest-fixtures.json", replacements);
  return fixture.items.find((item) => item.fixture_id === fixtureId) || fixture.items[0];
}

export function loadDemoReferenceSources() {
  const replacements = fixtureReplacements();
  return loadFixture("reference-sources.json", replacements);
}

export function readDemoManifest() {
  const replacements = fixtureReplacements();
  return loadFixture("manifest.json", replacements);
}
