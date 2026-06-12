import fs from "node:fs";
import path from "node:path";
import { getLegacyCardsDir, getLegacyKnowledgeBaseDir } from "./config.js";
import { listCards, upsertDailySummary } from "./db.js";
import { renderLegacyCardsMarkdown, renderLegacyKnowledgeBaseMarkdown } from "./markdown.js";
import { generateDigestWithAgent } from "./pipeline.js";

export function generateDailyArtifacts(date) {
  const cards = listCards({ date, status: "published", limit: 500 });
  const fallbackCards = renderLegacyCardsMarkdown(date, cards);
  const agentDigest = generateDigestWithAgent({ date, cards, fallbackSummary: fallbackCards });
  const legacyCards = agentDigest.summary;
  const legacyKnowledge = renderLegacyKnowledgeBaseMarkdown(date, cards);

  fs.writeFileSync(path.join(getLegacyCardsDir(), `${date}.md`), legacyCards, "utf8");
  fs.writeFileSync(path.join(getLegacyKnowledgeBaseDir(), `${date}.md`), legacyKnowledge, "utf8");
  upsertDailySummary(date, legacyCards);

  return {
    date,
    count: cards.length,
    cards,
    legacyCards,
    legacyKnowledge,
    agent: {
      runtime: agentDigest.used_fallback ? "fallback" : "openclaw",
      used_fallback: agentDigest.used_fallback,
      error: agentDigest.agent_result.ok ? "" : agentDigest.agent_result.error || agentDigest.agent_result.stderr || ""
    }
  };
}

export function buildDailyResponse(date) {
  const formalCards = listCards({ date, status: "published", limit: 500 });
  const reviewCards = listCards({ date, status: "review", source_type: "screenshot", limit: 500 });
  const archivedCards = listCards({ date, status: "archived", limit: 500 });
  const cardsPath = path.join(getLegacyCardsDir(), `${date}.md`);
  const summary = fs.existsSync(cardsPath)
    ? fs.readFileSync(cardsPath, "utf8")
    : renderLegacyCardsMarkdown(date, formalCards);
  return {
    date,
    cards: formalCards,
    published_count: formalCards.length,
    review_count: reviewCards.length,
    archived_count: archivedCards.length,
    summary
  };
}
