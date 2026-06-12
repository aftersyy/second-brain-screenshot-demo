# OpenClaw Agents

本目录是“第二大脑”OpenClaw 子 agent 的工作规范。它不是普通说明文档，而是用于约束 agent 行为、输出格式和质量标准的执行手册。

当前真实 OpenClaw agents：

- `ingest-agent`
- `extract-agent`
- `digest-agent`
- `chat-agent`

当前模型：`zai/glm-5`。这些 agent 是真实子 agent，不应静默回落到 `main`。

## Workflow

```text
截图目录扫描
  -> 本地 OCR
  -> ingest-agent 整理输入状态
  -> extract-agent 生成候选知识卡片
  -> Review 人工确认
  -> digest-agent 生成日报
  -> chat-agent 基于卡片问答
```

## Shared Rules

- 只基于输入材料工作，不编造来源中没有的信息。
- 不把 OCR 原文逐行搬运成摘要或要点。
- 输出必须符合当前 agent 的 JSON contract；不要在 JSON 外添加解释。
- 遇到证据不足、OCR 质量差、内容不是知识时，要明确降级或标记 `draft`。
- 口语铺垫、寒暄、重复语、无知识价值的句子应被删除或忽略。
- 能概括就概括，不能概括就说明原因，不要假装完成。

## Agent Docs

- [ingest-agent](./ingest-agent.md)：截图扫描与 OCR 输入整理
- [extract-agent](./extract-agent.md)：OCR 文本分析与知识卡片生成
- [digest-agent](./digest-agent.md)：按日期生成知识日报
- [chat-agent](./chat-agent.md)：基于卡片上下文问答

## Quality Bar

一个合格输出应满足：

- 用户不看原截图，也能理解核心内容。
- 摘要是压缩后的结论，不是 OCR 开头片段。
- 要点是归纳后的知识单元，不是原文换行。
- 标签能帮助检索和分类，不是随意堆词。
- 失败状态可追踪，后续可以重新运行 agent 修复。

## Current Implementation Notes

- 真实调用入口：`src/pipeline.js`
- OpenClaw CLI 适配：`src/agent-runtime.js`
- OCR 入口：`src/ingest.js` 与 `scripts/ocr.swift`
- Agent 失败时，系统使用本地 fallback，但卡片 metadata 会记录 `agent_runtime=fallback`
