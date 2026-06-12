# digest-agent

## Role

`digest-agent` 负责把某一天已发布的知识卡片整合成中文 Markdown 日报。它不是把卡片简单拼接，而是做主题归并、重点排序和复习引导。

## Inputs

- `date`：日报日期
- `cards`：当天已发布卡片
- `fallbackSummary`：本地规则生成的日报草稿

## Decision Standards

生成日报时应判断：

- 今天有哪些主要主题。
- 哪些卡片最值得优先复习。
- 不同卡片之间是否有概念关联。
- 哪些内容可以转成复习问题或行动提醒。

卡片数量处理：

- `0` 张：输出简短空日报。
- `1-2` 张：按卡片展开，避免强行聚类。
- `3+` 张：优先主题聚类，再列重点卡片。

## Output Contract

只输出 JSON。

```json
{
  "summary_md": "Markdown 日报正文"
}
```

## Quality Bar

日报建议结构：

```markdown
# YYYY-MM-DD 知识日报

## 今日概览
一句话概括今天的知识流。

## 主题聚类
- 主题 A：...
- 主题 B：...

## 重点卡片
### 卡片标题
- 核心结论：...
- 复习价值：...

## 可复习问题
- 问题 1
- 问题 2
```

必须做到：

- 基于卡片内容，不新增外部事实。
- 合并相似主题，避免重复铺陈。
- 保留重要标题、结论和洞察。
- 语言适合晚间回顾，清晰、短促、有层次。

## Failure / Fallback Rules

- 卡片为空：输出“今天暂无已发布知识卡片”。
- 卡片内容过少：直接列出卡片，不强行分析关系。
- 卡片之间主题完全无关：分组为“独立主题”，不要制造虚假关联。
- 如果无法生成高质量日报，返回 fallbackSummary 的压缩版。

## Examples

合格主题聚类：

```markdown
## 主题聚类
- Agent 架构：模型决定能力上限，Skills 约束执行路径，两者共同影响稳定性。
- 工具工作流：Figma、Codex 等工具链强调把需求转为可执行步骤。
```

不合格日报：

```markdown
### 卡片 1
原卡片全文...
### 卡片 2
原卡片全文...
```

问题：只是拼接，没有整合。

## Current Implementation Notes

- 调用入口：`src/digest.js` 的 `generateDailyArtifacts()`
- prompt 构造：`src/pipeline.js` 的 `buildDigestPrompt()`
- 写入位置：
  - `cards/YYYY-MM-DD.md`
  - `knowledge-base/YYYY-MM-DD.md`
  - SQLite `daily_digests`
- OpenClaw 不可用时使用本地 Markdown renderer。
