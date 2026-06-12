# Publishing Guide

这份文档用于维护者把项目发布到 GitHub，同时保留自己的本地知识库内容。

## 发布原则

仓库发布的是工具，不是个人知识库。

应该提交：

- 应用代码：`src/`、`public/`
- 公开演示数据：`demo/fixtures/`
- 部署和说明文档：`README.md`、`docs/`
- 运行模板：`.env.example`
- 容器和 CI：`Dockerfile`、`docker-compose.yml`、`.github/workflows/ci.yml`
- 测试：`tests/`

不应提交：

- `.env`
- `state/`
- `card-library/`
- `cards/`
- `knowledge-base/`
- `.openclaw/`
- `.obsidian/`
- `AGENTS.md`、`MEMORY.md`、`USER.md`、`SOUL.md` 等个人工作区文件
- 真实截图、私有文档、微信账号、OpenClaw token、模型 API key

## 推荐发布流程

1. 确认本地功能：

```bash
npm run check
npm test
npm run release:check
```

2. 检查 Git 状态：

```bash
git status --ignored --short
```

确认个人内容显示为 ignored，例如：

```text
!! .env
!! state/
!! card-library/
!! cards/
!! knowledge-base/
```

3. 只添加公开文件：

```bash
git add README.md LICENSE package.json .env.example .gitignore .dockerignore Dockerfile docker-compose.yml .github demo docs public scripts src tests
```

4. 再跑一次发布检查：

```bash
npm run release:check
```

5. 提交并推送：

```bash
git commit -m "Prepare public second-brain screenshot demo"
git push
```

## 如果误 add 了个人内容

先查看 staged 文件：

```bash
git diff --cached --name-only
```

如果看到 `state/`、`card-library/`、`cards/`、`knowledge-base/`、`.env` 等路径，取消暂存：

```bash
git restore --staged .env state card-library cards knowledge-base .openclaw AGENTS.md MEMORY.md USER.md SOUL.md TOOLS.md
```

不要删除这些文件；它们是你的本地知识库，只是不应该进入公开仓库。

## 给使用者的边界说明

别人克隆仓库后会得到一个空的个人知识库骨架和公开 demo 数据。他们需要：

1. 复制 `.env.example` 为 `.env`
2. 设置自己的 `SCREENSHOT_DIR`
3. 可选配置自己的 OpenClaw 模型和微信推送账号
4. 运行导入和审核流程，生成自己的 `state/` 与 `card-library/`
