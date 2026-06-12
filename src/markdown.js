import fs from "node:fs";
import path from "node:path";
import { getCardLibraryDir } from "./config.js";
import { denormalizeImportance, parseTags, safeParseJson } from "./utils.js";

function formatFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return '""';
  return JSON.stringify(String(value));
}

export function serializeCard(card) {
  const frontmatter = {
    card_id: card.card_id,
    title: card.title,
    status: card.status,
    importance: card.importance,
    tags: card.tags || [],
    knowledge_date: card.knowledge_date,
    source_type: card.source_type,
    source_files: card.source_files || [],
    confidence: Number(card.confidence || 0),
    created_at: card.created_at,
    updated_at: card.updated_at,
    embedding_ref: card.embedding_ref || ""
  };

  const header = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`)
    .join("\n");

  return `---\n${header}\n---\n\n## 摘要\n${card.summary || ""}\n\n## 要点\n${card.content || ""}\n\n## 思考\n${card.insights || ""}\n\n## OCR 原文摘要\n${card.source_text || ""}\n`;
}

export function writeCardMarkdown(card) {
  const baseDir = path.join(getCardLibraryDir(), card.knowledge_date || "unknown");
  fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${card.card_id}.md`);
  fs.writeFileSync(filePath, serializeCard(card), "utf8");
  return filePath;
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { attributes: {}, body: markdown };
  }

  const attributes = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1).trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      attributes[key] = safeParseJson(raw, []);
    } else if (raw.startsWith('"') || raw.startsWith("'")) {
      try {
        attributes[key] = JSON.parse(raw);
      } catch {
        attributes[key] = raw.replace(/^['"]|['"]$/g, "");
      }
    } else if (!Number.isNaN(Number(raw))) {
      attributes[key] = Number(raw);
    } else {
      attributes[key] = raw;
    }
  }

  return {
    attributes,
    body: markdown.slice(match[0].length)
  };
}

export function parseCardMarkdown(filePath) {
  const markdown = fs.readFileSync(filePath, "utf8");
  const { attributes, body } = parseFrontmatter(markdown);
  const sectionMap = {};
  let currentSection = null;
  let buffer = [];

  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/u);
    if (heading) {
      if (currentSection) {
        sectionMap[currentSection] = buffer.join("\n").trim();
      }
      currentSection = heading[1].trim();
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  if (currentSection) {
    sectionMap[currentSection] = buffer.join("\n").trim();
  }

  return {
    card_id: attributes.card_id,
    title: attributes.title,
    status: attributes.status || "draft",
    importance: attributes.importance || "medium",
    tags: parseTags(attributes.tags || []),
    knowledge_date: attributes.knowledge_date,
    source_type: attributes.source_type || "manual",
    source_files: Array.isArray(attributes.source_files) ? attributes.source_files : [],
    confidence: Number(attributes.confidence || 0),
    created_at: attributes.created_at || "",
    updated_at: attributes.updated_at || "",
    embedding_ref: attributes.embedding_ref || "",
    summary: sectionMap["摘要"] || "",
    content: sectionMap["要点"] || "",
    insights: sectionMap["思考"] || "",
    source_text: sectionMap["OCR 原文摘要"] || "",
    file_path: filePath
  };
}

export function renderLegacyCardsMarkdown(date, cards) {
  const sections = cards
    .map((card, index) => {
      const tagText = (card.tags || []).map((tag) => `#${tag}`).join(" ");
      return `### 卡片 ${index + 1}：${card.title}
- **要点**：
${String(card.content || "")
  .split("\n")
  .filter(Boolean)
  .map((line) => (line.startsWith("-") ? `  ${line}` : `  - ${line}`))
  .join("\n")}
- **思考**：${card.insights || ""}
- **频次/重要性**：${denormalizeImportance(card.importance)}
- **标签**：${tagText || "无"}`;
    })
    .join("\n\n---\n\n");

  return `# 📚 ${date} 知识卡片\n\n---\n\n${sections}\n`;
}

export function renderLegacyKnowledgeBaseMarkdown(date, cards) {
  const sections = cards
    .map((card, index) => `## 主题 ${index + 1}：${card.title}
**分类标签**: ${(card.tags || []).join(" / ") || "未分类"}
**频次/重要性**: ${denormalizeImportance(card.importance)}

### 核心内容
${card.summary || ""}

### 关键洞察
${card.content || ""}

### 实践建议
${card.insights || "待补充"}
`)
    .join("\n---\n\n");

  return `# 📚 ${date} 知识库（整合版）\n\n---\n\n${sections}`;
}
