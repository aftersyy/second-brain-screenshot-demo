# Personal Setup

这份指南用于把项目从 Demo Mode 切换成你自己的截图知识库。

## 1. 准备截图目录

创建或选择一个本机目录，用来接收日常截图。常见选择：

- iCloud Drive 同步目录
- Dropbox / Google Drive / OneDrive 同步目录
- 普通本地目录，例如 `~/Pictures/KnowledgeScreenshots`

目录里放 `.png`、`.jpg`、`.jpeg` 或 `.webp` 文件即可。

## 2. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
DEMO_MODE=false
SCREENSHOT_DIR=/absolute/path/to/your/screenshots
```

`SCREENSHOT_DIR` 支持绝对路径，也支持 `~/...`。

## 3. 本机运行

真实截图扫描推荐在 macOS 本机运行，因为 `scripts/ocr.swift` 使用 Apple Vision framework。

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:3017
```

## 4. 导入截图

有两种方式：

```bash
npm run ingest
```

或在网页中触发导入流程。

导入过程会：

1. 读取 `SCREENSHOT_DIR` 中未处理过的图片
2. 运行本地 OCR
3. 提炼候选知识卡片
4. 写入 Review 队列
5. 记录已处理文件到 `state/processed.json`

## 5. 审核与沉淀

打开 `Review` 页面，人工决定候选卡片是否值得保留。

通过审核后，卡片会进入：

- SQLite 数据库：`state/knowledge-agent.db`
- Markdown 归档：`card-library/YYYY-MM-DD/`

这些目录默认被 `.gitignore` 忽略，适合保留在你的本机。

## 6. 生成每日摘要

在网页里点击 `生成日报`，或运行对应 workflow。每日摘要会读取当天已发布卡片，生成适合复盘的 Markdown 内容。

## 7. 可选：接入 OpenClaw agent

不配置 OpenClaw 时，项目会使用本地 fallback 规则，足够体验主流程。

如果你有 OpenClaw CLI 和模型环境，可以在 `.env` 配置：

```bash
OPENCLAW_CLI=/path/to/openclaw
OPENCLAW_MODEL=
OPENCLAW_THINKING=medium
OPENCLAW_AGENT_TIMEOUT_SECONDS=90
```

然后检查能力状态：

```bash
npm run scheduler:plan
```

## 8. 可选：定时任务

查看默认计划：

```bash
npm run scheduler:plan
```

确认 OpenClaw CLI 可用后，再安装定时任务：

```bash
npm run scheduler:install
```

默认计划包含：

- 10:00 截图扫描
- 16:00 截图扫描
- 22:00 生成日报
- 22:30 推送预留步骤

当前项目默认不绑定任何真实推送渠道。

## 9. 备份建议

建议备份这些目录和文件：

- `state/`
- `card-library/`
- `.env`

不要把它们提交到公开 GitHub 仓库。
