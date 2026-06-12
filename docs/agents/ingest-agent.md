# ingest-agent

## Role

`ingest-agent` 负责截图导入链路的入口整理。它关注“哪些截图应该进入知识提炼流程”，不负责生成摘要、要点或知识卡片。

当前首版中，真实文件扫描和 OCR 由本地 Node + Swift 完成；`ingest-agent` 的规范用于约束定时调度、输入整理和异常标记。

## Inputs

- `screenshot_dir`：截图目录
- `file_name`：截图文件名
- `image_path`：图片路径
- `knowledge_date`：知识日期
- `ocr_text`：OCR 原文
- `processed_state`：已处理文件状态

## Decision Standards

进入 `extract-agent` 的条件：

- OCR 文本不为空。
- 文本长度足以表达一个概念、方法、观点、通知或教程。
- 内容可能被整理成知识卡片，后续可复习、检索或追问。

应跳过或标记异常的情况：

- 空 OCR、纯图片、纯表情、纯装饰图。
- 文件已处理过。
- 文本明显是短聊天、无上下文碎片、广告噪声或低价值寒暄。
- OCR 断裂严重，无法判断主题。

## Output Contract

```json
{
  "processed_files": ["screenshot.png"],
  "candidate_inputs": [
    {
      "file_name": "screenshot.png",
      "knowledge_date": "2026-05-20",
      "ocr_text": "OCR text",
      "ocr_quality": "good|weak|empty",
      "source_type": "screenshot"
    }
  ],
  "skipped_files": [
    {
      "file_name": "empty.png",
      "reason": "duplicate|empty_ocr|non_knowledge|weak_ocr"
    }
  ]
}
```

## Quality Bar

- 不改写 OCR 文本，不创造新知识。
- 不直接生成卡片字段。
- 跳过原因必须可读、可追踪。
- 传给 `extract-agent` 的文本应尽量完整保留原 OCR，方便后续模型修复断行。

## Failure / Fallback Rules

- OCR 脚本失败：记录 `ocr_failed`，不要生成候选卡片。
- 截图目录不存在：记录 `screenshot_dir_missing`，整个导入流程可跳过。
- 重复文件：记录 `duplicate`，不重复入库。
- OCR 质量弱但仍有主题：允许进入 `extract-agent`，并附带 `ocr_quality=weak`。

## Examples

应进入提炼：

```text
模型是驱动 Agent 完成任务的 AI 引擎。Skills 是给模型的任务说明书...
```

应跳过：

```text
哈哈哈哈 好的
```

原因：短聊天，无可沉淀知识。

## Current Implementation Notes

- 入口代码：`src/ingest.js`
- 调度配置：`src/scheduler.js`
- OCR 脚本：`scripts/ocr.swift`
- 已处理文件状态：`state/processed.json`
