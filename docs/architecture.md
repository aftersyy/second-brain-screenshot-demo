# Architecture

当前实现采用四层结构：

- Workflow Layer
  - `workflow_run`、`workflow_step`
  - `ingest_workflow`
  - `review_workflow`
  - `daily_digest_workflow`
  - OpenClaw cron 只负责调度，业务状态仍落在本地 workflow 表
- Agent Layer
  - `agent-runtime` 封装 OpenClaw CLI、本地 agent、模型覆盖、超时和 JSON 解析
  - `pipeline` 拆分 ingest / extract / digest / chat agent 职责
  - OpenClaw 不可用时回退到本地规则链路，保证 Demo 和主流程不断
- Data Layer
  - 当前主运行时仍以 SQLite 为主
  - Markdown 作为卡片归档和日报导出层
  - Docker Compose 已为 PostgreSQL / Temporal 预置运行基础设施
- UI Layer
  - Today / Library / Review / Daily
  - Run Status / Health / Capabilities

后续正式重构方向：

- Temporal 成为真正的 durable execution runtime
- OpenClaw agent 输出进一步 schema 化，并接入更强模型
- 推送渠道从预留步骤升级为可观测的可选 output adapter
