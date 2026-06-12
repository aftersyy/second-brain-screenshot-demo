import crypto from "node:crypto";
import { listCards, insertChatTrace } from "./db.js";
import { loadDemoReferenceSources } from "./demo.js";
import { isDemoMode, isWebSearchEnabled } from "./config.js";
import { answerWithAgent } from "./pipeline.js";
import { nowIso, summarizeText } from "./utils.js";

function tokenize(text) {
  const normalized = String(text || "").toLowerCase();
  const basicTokens = normalized
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((token) => token.length > 1);
  const cjkChunks = [...normalized.matchAll(/[\p{Script=Han}]{2,}/gu)].map((match) => match[0]);
  const ngrams = cjkChunks.flatMap((chunk) => {
    const grams = [];
    for (let index = 0; index < chunk.length - 1; index += 1) {
      grams.push(chunk.slice(index, index + 2));
      if (index + 3 <= chunk.length) grams.push(chunk.slice(index, index + 3));
    }
    return grams;
  });
  return [...new Set([...basicTokens, ...ngrams])];
}

function scoreCard(question, card) {
  const tokens = tokenize(question);
  const haystack = `${card.title}\n${card.summary}\n${card.content}\n${card.insights}\n${(card.tags || []).join(" ")}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export function answerQuestion({ question, mode = "knowledge_only", tag, date }) {
  const candidateCards = listCards({ status: "published", limit: 200, tag, date });
  const ranked = candidateCards
    .map((card) => ({ card, score: scoreCard(question, card) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (!ranked.length) {
    const emptyResponse = {
      answer: "知识库中没有足够内容来回答这个问题。",
      citations: [],
      external_sources: [],
      mode_used: mode
    };
    insertTrace(question, mode, { tag, date }, emptyResponse);
    return emptyResponse;
  }

  const answerLines = ranked.map(({ card }) => {
    const tagText = card.tags.length ? `标签：${card.tags.join(" / ")}` : "标签：未分类";
    return `《${card.title}》：${summarizeText(`${card.summary} ${card.insights}`, 150)}（${tagText}）`;
  });

  const externalSources = buildExternalSources(question, ranked.map(({ card }) => card), mode);
  const externalBlock = externalSources.length
    ? `\n\n联网补充参考：\n- ${externalSources.map((item) => `${item.title} (${item.url})`).join("\n- ")}`
    : "";
  const fallbackAnswer = `基于已入库卡片，我找到这些相关结论：\n\n- ${answerLines.join("\n- ")}${externalBlock}`;
  const agentAnswer = answerWithAgent({
    question,
    cards: ranked.map(({ card }) => card),
    fallbackAnswer
  });
  const response = {
    answer: `${agentAnswer.answer}${agentAnswer.used_fallback ? "" : externalBlock}`,
    citations: ranked.map(({ card, score }) => ({
      card_id: card.card_id,
      title: card.title,
      knowledge_date: card.knowledge_date,
      tags: card.tags,
      score
    })),
    external_sources: externalSources,
    mode_used: mode,
    agent: {
      runtime: agentAnswer.used_fallback ? "fallback" : "openclaw",
      used_fallback: agentAnswer.used_fallback,
      error: agentAnswer.agent_result.ok ? "" : agentAnswer.agent_result.error || agentAnswer.agent_result.stderr || ""
    }
  };
  insertTrace(question, mode, { tag, date }, response);
  return response;
}

function buildExternalSources(question, cards, mode) {
  if (!["knowledge_plus_web", "knowledge_plus_reasoning"].includes(mode)) return [];
  if (!isWebSearchEnabled() && !isDemoMode()) return [];

  const references = loadDemoReferenceSources();
  const lookupText = `${question}\n${cards.map((card) => `${card.title}\n${(card.tags || []).join(" ")}`).join("\n")}`;
  const matches = references.items.filter((item) => {
    const keywords = [item.topic, ...(item.keywords || [])].join(" ").toLowerCase();
    return keywords.split(/\s+/u).some((token) => token && lookupText.toLowerCase().includes(token));
  });
  return matches.slice(0, 3);
}

function insertTrace(question, mode, context, response) {
  insertChatTrace({
    trace_id: `trace_${crypto.randomUUID()}`,
    question,
    mode,
    context,
    response: {
      ...response,
      created_at: nowIso()
    }
  });
}
