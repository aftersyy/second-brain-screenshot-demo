# Demo Guide

评委推荐体验路径：

1. 启动项目：`cp .env.example .env && docker compose up --build`
2. 打开 `http://127.0.0.1:3017`
3. 点击 `注入 Demo`
4. 打开 `Review`
5. 通过一张候选卡，观察它进入 `Today`
6. 在 `Today` 选择一张卡片继续提问
7. 点击 `生成日报` 或在 `Daily` 页点击 `手动生成`
8. 观察左侧 `运行能力` 与 `最近运行`

如果 OpenClaw 模型暂时不可用：

- 仍可完整浏览 Demo
- 问答会退化为知识库检索回答

如果配置好 OpenClaw agent 模型：

- 导入会走 `extract-agent`
- 日报会走 `digest-agent`
- 单卡问答会走 `chat-agent`

当前 Demo Mode 不要求：

- OpenClaw 模型认证可用
- 绑定微信
- 配置真实截图目录
