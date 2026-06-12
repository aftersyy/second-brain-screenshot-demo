import fs from "node:fs";
import path from "node:path";
import { getLegacyCardsDir, getLegacyKnowledgeBaseDir } from "./config.js";
import { createCardId, inferTags, normalizeImportance, summarizeText } from "./utils.js";

function parseLegacyCardSections(markdown, date) {
  const sections = markdown
    .split(/^###\s+卡片\s+\d+：/gmu)
    .slice(1)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.map((section) => {
    const [rawTitle, ...restLines] = section.split("\n");
    const title = rawTitle.trim();
    const block = restLines.join("\n");
    const pointsMatch = block.match(/- \*\*要点\*\*：\n([\s\S]*?)(?=\n- \*\*思考\*\*：|\n- \*\*频次\/重要性\*\*：|\n- \*\*标签\*\*：|(?![\s\S]))/u);
    const insightsMatch = block.match(/- \*\*思考\*\*：(.*)/u);
    const importanceMatch = block.match(/- \*\*频次\/重要性\*\*：(.*)/u);
    const tagsMatch = block.match(/- \*\*标签\*\*：(.*)/u);
    const content = (pointsMatch?.[1] || "")
      .split("\n")
      .map((line) => line.replace(/^\s*-\s?/u, "").trim())
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");
    const insights = (insightsMatch?.[1] || "").trim();
    const tags = (tagsMatch?.[1] || "")
      .split(/\s+/u)
      .map((tag) => tag.replace(/^#/u, "").trim())
      .filter(Boolean);

    return {
      card_id: createCardId(date, title.trim()),
      title,
      summary: summarizeText(content.replace(/^- /gmu, "")),
      content,
      insights,
      importance: normalizeImportance(importanceMatch?.[1] || "中"),
      tags: tags.length ? tags : inferTags(`${title}\n${content}\n${insights}`),
      source_type: "legacy-digest",
      source_files: [`cards/${date}.md`],
      source_text: "",
      status: "published",
      confidence: 0.95,
      knowledge_date: date,
      embedding_ref: ""
    };
  });
}

export function importLegacyCards() {
  const cardsDir = getLegacyCardsDir();
  if (!fs.existsSync(cardsDir)) return [];
  const imported = [];
  for (const fileName of fs.readdirSync(cardsDir)) {
    if (!fileName.endsWith(".md")) continue;
    const date = path.basename(fileName, ".md");
    const markdown = fs.readFileSync(path.join(cardsDir, fileName), "utf8");
    imported.push(...parseLegacyCardSections(markdown, date));
  }
  return imported;
}

function cleanSectionBlock(block) {
  return block
    .replace(/\r/g, "")
    .trim();
}

function cleanKnowledgeText(text) {
  return String(text || "")
    .replace(/\n---+\n?/gu, "\n")
    .replace(/\n##\s+统计信息[\s\S]*$/u, "")
    .trim();
}

function matchSection(block, title) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`###\\s+${escapedTitle}\\n([\\s\\S]*?)(?=\\n###\\s+|$)`, "u");
  return block.match(pattern)?.[1]?.trim() || "";
}

function normalizeKnowledgeTitle(title) {
  return title.replace(/\s+与.+$/u, "").trim() || title.trim();
}

function extractInlineList(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[.)、]\s*/u, "").replace(/^-+\s*/u, "").trim())
    .filter(Boolean);
}

function guessRawEntryTitle(sourceName, sourceText, knowledgePoints) {
  const firstKnowledgePoint = extractInlineList(knowledgePoints)[0];
  if (firstKnowledgePoint) {
    return summarizeText(firstKnowledgePoint, 36);
  }

  const firstSourceLine = String(sourceText || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstSourceLine) return summarizeText(firstSourceLine, 36);

  return sourceName.replace(/\.[^.]+$/u, "").trim();
}

function parseRawKnowledgeBase(markdown, date) {
  const sections = markdown
    .split(/^##\s+\[/gmu)
    .slice(1)
    .map((section) => `[${section}`.trim())
    .filter(Boolean);

  return sections.map((section) => {
    const headerMatch = section.match(/^\[(.+?)\]\n/u);
    const sourceName = headerMatch?.[1]?.trim() || "未命名来源";
    const tagsLine = section.match(/\*\*分类标签\*\*:\s*(.+)/u)?.[1]?.trim() || "";
    const sourceText = section.match(/\*\*OCR原始内容\*\*:\n([\s\S]*?)(?=\n\*\*知识要点\*\*:|$)/u)?.[1]?.trim() || "";
    const knowledgePoints = section.match(/\*\*知识要点\*\*:\n([\s\S]*)$/u)?.[1]?.trim() || "";
    const tags = tagsLine
      .split(/[\/、]/u)
      .map((tag) => tag.trim())
      .filter(Boolean);
    const bullets = extractInlineList(knowledgePoints);
    const title = guessRawEntryTitle(sourceName, sourceText, knowledgePoints);
    const content = bullets.map((line) => `- ${line}`).join("\n") || `- ${summarizeText(sourceText, 120)}`;
    const summary = summarizeText(
      bullets.join("； ") || sourceText.replace(/\s+/gu, " "),
      140
    );

    return {
      card_id: createCardId(date, `${sourceName}-${title}`),
      title,
      summary,
      content,
      insights: "",
      importance: bullets.length >= 3 ? "high" : "medium",
      tags: tags.length ? tags : inferTags(`${title}\n${knowledgePoints}\n${sourceText}`),
      source_type: "knowledge-base",
      source_files: [`knowledge-base/${date}.md`, sourceName],
      source_text: sourceText,
      status: "published",
      confidence: 0.9,
      knowledge_date: date,
      embedding_ref: "",
      metadata: {
        formal_source: true,
        knowledge_stage: "ingested"
      }
    };
  });
}

function parseLegacyKnowledgeBase(markdown, date) {
  if (/^\s*##\s+\[/mu.test(markdown)) {
    return parseRawKnowledgeBase(markdown, date);
  }

  const sections = markdown
    .split(/^##\s+主题\s+\d+：/gmu)
    .slice(1)
    .map((section) => cleanSectionBlock(section))
    .filter(Boolean);

  return sections.map((section) => {
    const [rawTitle, ...restLines] = section.split("\n");
    const title = normalizeKnowledgeTitle(rawTitle.trim());
    const block = restLines.join("\n").trim();
    const tagsLine = block.match(/\*\*分类标签\*\*:\s*(.*)/u)?.[1] || "";
    const importanceLine = block.match(/\*\*频次\/重要性\*\*:\s*(.*)/u)?.[1] || "中";
    const sourceLine = block.match(/\*\*来源\*\*:\s*(.*)/u)?.[1] || "";
    const summary = cleanKnowledgeText(
      matchSection(block, "核心内容") || matchSection(block, "演变路径") || matchSection(block, "四大组件") || ""
    );
    const details = [
      matchSection(block, "关键洞察"),
      matchSection(block, "各阶段核心"),
      matchSection(block, "核心挑战"),
      matchSection(block, "关键技术手段"),
      matchSection(block, "三大特点"),
      matchSection(block, "应用方向"),
      matchSection(block, "一句话理解")
    ]
      .filter(Boolean)
      .join("\n");
    const content = cleanKnowledgeText(details || summary);
    const insights = cleanKnowledgeText(
      matchSection(block, "实践建议") ||
      matchSection(block, "一句话理解") ||
      summarizeText(`${summary} ${details}`, 140)
    );

    const tags = tagsLine
      .split(/[\/、]/u)
      .map((tag) => tag.trim())
      .filter(Boolean);

    return {
      card_id: createCardId(date, title),
      title,
      summary: summarizeText(summary || details, 140),
      content,
      insights,
      importance: normalizeImportance(importanceLine),
      tags: tags.length ? tags : inferTags(`${title}\n${summary}\n${details}`),
      source_type: "knowledge-base",
      source_files: [`knowledge-base/${date}.md`],
      source_text: sourceLine,
      status: "published",
      confidence: 1,
      knowledge_date: date,
      embedding_ref: "",
      metadata: {
        formal_source: true
      }
    };
  });
}

export function importFormalKnowledgeBase() {
  const baseDir = getLegacyKnowledgeBaseDir();
  if (!fs.existsSync(baseDir)) return [];
  const imported = [];
  for (const fileName of fs.readdirSync(baseDir)) {
    if (!fileName.endsWith(".md")) continue;
    const date = path.basename(fileName, ".md");
    const markdown = fs.readFileSync(path.join(baseDir, fileName), "utf8");
    imported.push(...parseLegacyKnowledgeBase(markdown, date));
  }
  return imported;
}

export function listLegacyKnowledgeBaseFiles() {
  const baseDir = getLegacyKnowledgeBaseDir();
  return fs.existsSync(baseDir)
    ? fs.readdirSync(baseDir).filter((fileName) => fileName.endsWith(".md"))
    : [];
}
