import { runOpenClawAgent } from "./agent-runtime.js";
import { createCardId, inferTags, normalizeImportance, parseTags, summarizeText } from "./utils.js";

const AGENTS = {
  ingest: process.env.OPENCLAW_INGEST_AGENT || "ingest-agent",
  extract: process.env.OPENCLAW_EXTRACT_AGENT || "extract-agent",
  digest: process.env.OPENCLAW_DIGEST_AGENT || "digest-agent",
  chat: process.env.OPENCLAW_CHAT_AGENT || "chat-agent"
};

function compactSentences(text, limit = 5) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .split(/(?<=[。！？.!?])\s*|\s{2,}/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 6)
    .slice(0, limit);
}

function fallbackBullets(text) {
  const sentences = compactSentences(text, 5);
  if (!sentences.length) return "";
  return [
    `- 主题：${summarizeText(sentences[0], 70)}`,
    sentences[1] ? `- 关键说明：${summarizeText(sentences[1], 90)}` : "",
    sentences[2] ? `- 补充信息：${summarizeText(sentences.slice(2).join(" "), 100)}` : "",
    "- 待模型复核：当前为本地规则兜底结果，建议重新运行 agent 提炼。"
  ].filter(Boolean).join("\n");
}

function fallbackClassification(sourceText) {
  const text = String(sourceText || "").trim();
  if (!text || text === "__NO_TEXT__") return { status: "draft", confidence: 0.1, reason: "no_text" };
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const confidence = Math.max(0.3, Math.min(0.98, (text.length / 400) + (lines.length / 20)));
  if (text.length < 40 || lines.length < 2) return { status: "review", confidence: Math.min(confidence, 0.75), reason: "weak_ocr" };
  return { status: "review", confidence, reason: "agent_fallback_review" };
}

function fallbackCardFromOcr({ date, fileName, sourceText }) {
  const lines = String(sourceText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines[0]?.slice(0, 40) || fileName;
  const classification = fallbackClassification(sourceText);
  const sentences = compactSentences(sourceText, 3);
  return {
    title,
    summary: sentences.length
      ? `这张截图主要讨论「${title}」相关内容，但当前为本地规则兜底摘要，建议使用模型重新提炼。`
      : "OCR 文本不足，暂无法形成可靠摘要。",
    content: fallbackBullets(sourceText),
    insights: classification.reason === "weak_ocr"
      ? "OCR 质量偏弱，建议人工补充或修正。"
      : "该卡片尚未完成模型级归纳，建议重新运行 extract-agent。",
    importance: /核心|关键|范式|底层|重要|系统/iu.test(sourceText) ? "high" : "medium",
    tags: inferTags(`${title}\n${sourceText}`),
    status: classification.status,
    confidence: Number(classification.confidence.toFixed(2)),
    knowledge_date: date,
    source_type: "screenshot",
    source_files: [fileName],
    source_text: summarizeText(sourceText, 500),
    metadata: {
      ingest_strategy: "local-ocr-agent-fallback-v1",
      fallback_reason: classification.reason
    }
  };
}

function normalizeAgentCard(agentJson, fallbackCard) {
  const source = agentJson?.card || agentJson || {};
  const status = ["published", "review", "archived", "draft"].includes(source.status)
    ? source.status
    : fallbackCard.status;
  const confidence = Number(source.confidence);
  return {
    ...fallbackCard,
    title: summarizeText(source.title || fallbackCard.title, 60),
    summary: summarizeText(source.summary || fallbackCard.summary, 240),
    content: Array.isArray(source.content)
      ? source.content.map((item) => `- ${item}`).join("\n")
      : source.content || fallbackCard.content,
    insights: source.insights || fallbackCard.insights,
    importance: normalizeImportance(source.importance || fallbackCard.importance),
    tags: parseTags(source.tags || fallbackCard.tags),
    status,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : fallbackCard.confidence,
    metadata: {
      ...fallbackCard.metadata,
      agent_strategy: "openclaw-extract-v1",
      agent_reasoning: summarizeText(source.reasoning || source.reason || "", 500)
    }
  };
}

export function buildExtractPrompt({ date, fileName, sourceText }) {
  return `你是第二大脑的 extract-agent。请只输出 JSON，不要输出解释。

任务：根据截图 OCR 文本判断是否值得沉淀为知识卡片，并生成一张经过总结、归纳和概括的候选卡片。

你不是 OCR 转写器。你要把原文重新组织为知识卡片：
- 摘要必须是抽象概括，不得直接复制 OCR 原句或只截取开头。
- 要点必须是 3-5 条“归纳后的知识点”，不能逐行复述 OCR。
- 每条要点先给结论，再给必要解释。
- insights 要指出这段内容真正值得记住的洞察或使用提醒。
- title 要概括主题，不要机械使用 OCR 第一行，除非第一行本身就是准确标题。

输出 JSON 结构：
{
  "card": {
    "title": "20字以内主题标题",
    "summary": "80-140字的概括性摘要，说明这张图主要讲了什么、核心结论是什么",
    "content": ["归纳要点1", "归纳要点2", "归纳要点3"],
    "insights": "一句洞察：用户为什么应该记住它，或如何应用它",
    "importance": "high|medium|low",
    "tags": ["标签"],
    "status": "review|draft",
    "confidence": 0.0,
    "reason": "简短原因"
  }
}

约束：
- 不要编造 OCR 文本中没有的信息。
- 不要把 OCR 文本按行改成 bullet。
- 不要输出“先和大家介绍一下”这类口语铺垫。
- 删除重复、寒暄、口头禅和无知识价值的句子。
- 如果 OCR 有断行或错别字，按语义修复后再概括。
- 非知识、空文本或聊天噪声输出 status=draft。
- 有价值但不确定的内容输出 status=review。
- 如果无法完成真正概括，status=draft，reason 说明原因。

日期：${date}
来源文件：${fileName}
OCR 文本：
${sourceText}`;
}

export function extractCardCandidate({ date, fileName, sourceText }) {
  const fallbackCard = fallbackCardFromOcr({ date, fileName, sourceText });
  const agentResult = runOpenClawAgent({
    agent: AGENTS.extract,
    message: buildExtractPrompt({ date, fileName, sourceText }),
    thinking: process.env.OPENCLAW_EXTRACT_THINKING || process.env.OPENCLAW_THINKING || "medium"
  });

  const extracted = agentResult.ok && agentResult.json
    ? normalizeAgentCard(agentResult.json, fallbackCard)
    : fallbackCard;
  const card = {
    ...extracted,
    card_id: createCardId(extracted.knowledge_date, extracted.title),
    embedding_ref: "",
    metadata: {
      ...(extracted.metadata || {}),
      agent_runtime: agentResult.ok ? "openclaw" : "fallback",
      agent: AGENTS.extract,
      agent_error: agentResult.ok ? "" : summarizeText(agentResult.error || agentResult.stderr || "agent_unavailable", 500)
    }
  };

  return {
    card,
    agent_result: agentResult,
    used_fallback: !agentResult.ok || !agentResult.json
  };
}

export function buildDigestPrompt({ date, cards, fallbackSummary }) {
  const cardText = cards
    .map((card, index) => `${index + 1}. ${card.title}\n摘要：${card.summary}\n要点：${card.content}\n洞察：${card.insights}`)
    .join("\n\n");
  return `你是第二大脑的 digest-agent。请基于当天已发布卡片生成中文 Markdown 日报，只输出 JSON。

输出 JSON：
{ "summary_md": "Markdown 日报正文" }

约束：
- 不要新增卡片之外的信息。
- 保留卡片标题和重点。
- 如果卡片为空，返回简短空日报。

日期：${date}
默认日报草稿：
${fallbackSummary}

卡片：
${cardText}`;
}

export function generateDigestWithAgent({ date, cards, fallbackSummary }) {
  const agentResult = runOpenClawAgent({
    agent: AGENTS.digest,
    message: buildDigestPrompt({ date, cards, fallbackSummary }),
    thinking: process.env.OPENCLAW_DIGEST_THINKING || process.env.OPENCLAW_THINKING || "medium"
  });
  const summary = agentResult.ok && agentResult.json?.summary_md
    ? String(agentResult.json.summary_md)
    : fallbackSummary;
  return {
    summary,
    agent_result: agentResult,
    used_fallback: !agentResult.ok || !agentResult.json?.summary_md
  };
}

export function buildChatPrompt({ question, cards }) {
  const context = cards
    .map((card, index) => `${index + 1}. ${card.title}
日期：${card.knowledge_date}
标签：${(card.tags || []).join(" / ") || "未分类"}
摘要：${card.summary}
要点：${card.content}
洞察：${card.insights}`)
    .join("\n\n");
  return `你是第二大脑的 chat-agent。请基于知识卡片回答用户问题，只输出 JSON。

输出 JSON：
{
  "answer": "中文回答，必须基于卡片内容",
  "citation_card_ids": ["card_id"]
}

约束：
- 如果卡片不足以回答，要明确说知识库中证据不足。
- 不要编造外部事实。
- 回答要引用相关卡片标题。

用户问题：
${question}

知识卡片：
${context}`;
}

export function answerWithAgent({ question, cards, fallbackAnswer }) {
  const agentResult = runOpenClawAgent({
    agent: AGENTS.chat,
    message: buildChatPrompt({ question, cards }),
    thinking: process.env.OPENCLAW_CHAT_THINKING || process.env.OPENCLAW_THINKING || "medium"
  });
  if (agentResult.ok && agentResult.json?.answer) {
    return {
      answer: String(agentResult.json.answer),
      agent_result: agentResult,
      used_fallback: false
    };
  }
  return {
    answer: fallbackAnswer,
    agent_result: agentResult,
    used_fallback: true
  };
}
