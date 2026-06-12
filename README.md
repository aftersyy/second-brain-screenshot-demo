# Second Brain Screenshot Demo

把日常截图变成可检索、可追问、可复盘的本地知识库。

这是一个本地运行的截图知识管理工作台：截图经过 OCR 和 OpenClaw agent 提炼后进入审核队列，确认后沉淀为 SQLite + Markdown 知识卡片，并可以在网页里浏览、搜索、追问、生成每日摘要和可选推送到微信。

## 核心能力

- Today / Library / Review / Daily 四个本地网页视图
- Demo Mode：不用配置模型、不用真实截图，也能体验完整流程
- macOS Vision OCR：读取真实截图中的文字
- OpenClaw 多 agent pipeline：ingest / extract / digest / chat
- Review 队列：避免低质量截图直接污染知识库
- SQLite 本地存储，Markdown 作为长期归档
- 单卡问答、引用式回答、每日摘要
- 可选微信推送通道
- Docker Compose 一键体验 Demo

## 重要边界

这个仓库只应该发布代码、公开 demo fixture 和文档。

你的个人知识库内容保留在本机，不应上传到 GitHub：

- `.env`
- `state/`
- `card-library/`
- `cards/`
- `knowledge-base/`
- `.openclaw/`
- `AGENTS.md`、`MEMORY.md`、`USER.md` 等个人工作区文件

这些路径已经写入 `.gitignore` 和 `.dockerignore`。别人克隆仓库后，会用自己的截图目录和自己的 OpenClaw 配置生成自己的知识库。

## 快速体验

要求：Docker Desktop，或兼容 Docker Compose 的环境。

```bash
cp .env.example .env
docker compose up --build
```

打开：

```text
http://127.0.0.1:3017
```

推荐体验顺序：

1. 点击 `注入 Demo`
2. 打开 `Review`，审核一张候选卡
3. 回到 `Today` 查看已发布卡片
4. 选择一张卡继续提问
5. 点击 `生成日报`

Docker 默认运行 `DEMO_MODE=true`，只使用 `demo/fixtures/` 的公开样例，不读取你的真实截图，也不会发送外部消息。

## 搭建自己的截图知识库

真实截图扫描建议在 macOS 本机运行，因为 OCR 脚本使用 Apple Vision framework。

要求：

- macOS
- Node.js 24 或更新版本
- OpenClaw CLI 可选；不配置时会使用本地 fallback
- 一个本地截图目录，例如 `~/Pictures/KnowledgeScreenshots`

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

更多细节见 [Deployment Guide](./docs/deployment.md) 和 [Personal Setup](./docs/personal-setup.md)。

## OpenClaw Agent 配置

`.env` 可覆盖以下配置：

```bash
OPENCLAW_CLI=/absolute/path/to/openclaw
OPENCLAW_MODEL=
OPENCLAW_THINKING=medium
OPENCLAW_AGENT_TIMEOUT_SECONDS=90
OPENCLAW_INGEST_AGENT=ingest-agent
OPENCLAW_EXTRACT_AGENT=extract-agent
OPENCLAW_DIGEST_AGENT=digest-agent
OPENCLAW_CHAT_AGENT=chat-agent
```

`OPENCLAW_MODEL` 留空时使用 OpenClaw 默认模型。若 OpenClaw 模型不可用，Demo 和基础链路会回退到本地规则逻辑。

## 可选：微信推送

微信推送默认关闭，因为它需要你自己的 OpenClaw 微信插件账号、target 和 context token。

需要推送时，在本机 `.env` 中配置：

```bash
WECHAT_PUSH_CHANNEL=openclaw-weixin
WECHAT_PUSH_TARGET=<your-wechat-target>
WECHAT_PUSH_ACCOUNT=<your-openclaw-weixin-account>
WECHAT_PUSH_TRANSPORT=weixin-api
WECHAT_PUSH_OPENCLAW_CONFIG_PATH=~/.openclaw/openclaw.json
```

不要把这些值提交到 GitHub。

## 常用命令

```bash
npm run dev
npm run ingest
npm run demo:seed
npm run demo:reset
npm run scheduler:plan
npm run push:preview
npm run check
npm test
npm run release:check
```

## 项目结构

```text
src/                 Node.js 后端、SQLite、工作流、OpenClaw agent adapter
public/              本地 Web UI
demo/fixtures/       可公开的演示数据
docs/                架构、部署、演示和 agent 规范
scripts/ocr.swift    macOS Vision OCR 脚本
tests/               Node test 测试
```

## 文档

- [Deployment Guide](./docs/deployment.md)
- [Personal Setup](./docs/personal-setup.md)
- [Demo Guide](./docs/demo-guide.md)
- [Architecture](./docs/architecture.md)
- [Publishing Guide](./docs/publishing.md)
- [Agent Notes](./docs/agents/README.md)

## 发布前检查

维护者发布到 GitHub 前运行：

```bash
npm run check
npm test
npm run release:check
docker build -t second-brain-demo .
```

再运行 `git status --ignored`，确认个人数据目录仍处于 ignored 状态。

## License

MIT
