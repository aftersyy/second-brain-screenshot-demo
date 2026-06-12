# Deployment Guide

这份文档面向从 GitHub 克隆项目的新用户，目标是在自己的电脑上搭建一个本地截图知识库。

## 1. 选择运行方式

推荐先用 Docker Demo 验证界面和流程，再切到本机模式处理真实截图。

| 方式 | 适合场景 | 是否读取真实截图 |
| --- | --- | --- |
| Docker Demo | 快速试用、评审展示、验证 UI | 否 |
| macOS 本机运行 | 搭建自己的截图知识库 | 是 |

## 2. Docker Demo

准备 Docker Desktop 后运行：

```bash
git clone <your-repo-url>
cd <repo>
cp .env.example .env
docker compose up --build
```

打开：

```text
http://127.0.0.1:3017
```

默认 `DEMO_MODE=true`，只使用 `demo/fixtures/` 中的公开样例，不会读取你的截图目录。

## 3. macOS 本机运行

真实截图 OCR 使用 Apple Vision framework，因此推荐 macOS 本机运行。

要求：

- macOS
- Node.js 24 或更新版本
- 一个本地截图目录，例如 `~/Pictures/KnowledgeScreenshots`

配置：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
DEMO_MODE=false
SCREENSHOT_DIR=~/Pictures/KnowledgeScreenshots
```

启动：

```bash
npm run dev
```

导入截图：

```bash
npm run ingest
```

或在网页里点击导入按钮。

## 4. OpenClaw Agent 配置

项目可以在没有 OpenClaw 模型的情况下运行本地 fallback，用于 Demo 和基础流程。

如果你已经安装并配置 OpenClaw，可以在 `.env` 中设置：

```bash
OPENCLAW_CLI=/absolute/path/to/openclaw-or-openclaw.mjs
OPENCLAW_MODEL=
OPENCLAW_THINKING=medium
OPENCLAW_AGENT_TIMEOUT_SECONDS=90
```

`OPENCLAW_MODEL` 留空时使用 OpenClaw 默认模型。建议先打开网页查看 `Health / Capabilities`，确认模型是否可用。

## 5. 数据目录

这些文件和目录是个人运行数据，默认不应提交到 GitHub：

- `.env`
- `state/`
- `card-library/`
- `cards/`
- `knowledge-base/`

备份个人知识库时，优先备份 `state/`、`card-library/` 和 `.env`。

## 6. 发布前检查

维护者发布到 GitHub 前运行：

```bash
npm run check
npm test
npm run release:check
docker build -t second-brain-demo .
```

`release:check` 会检查必要文档是否存在、`.env.example` 是否混入私人路径或 token、Git 是否误跟踪本地运行数据。
