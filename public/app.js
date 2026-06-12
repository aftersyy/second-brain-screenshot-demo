const TODAY_DATE = new Date().toISOString().slice(0, 10);

const state = {
  currentView: "today",
  detailPanel: "overview",
  libraryMode: "read",
  reviewFilter: "all",
  activeLibraryFilters: { status: "published" },
  spotlightOpen: false,
  spotlightResults: [],
  inbox: [],
  library: [],
  todayCards: [],
  dailyCards: [],
  wechatPreview: null,
  capabilities: {},
  health: {},
  latestRun: null,
  selectedTodayId: null,
  selectedLibraryId: null,
  selectedReviewId: null,
  threadOrder: [],
  threadByCardId: {},
  lastImportState: "空闲",
  lastOpenedCardId: null
};

const PRESET_PROMPTS = [
  "用更通俗的话解释这个概念",
  "它和相近概念有什么区别",
  "给我一个真实使用场景",
  "为什么这个知识值得记住"
];

function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function importanceLabel(value) {
  return value === "high" ? "高" : value === "low" ? "低" : "中";
}

function statusLabel(value) {
  return {
    review: "待审核",
    published: "已发布",
    archived: "已归档",
    draft: "草稿"
  }[value] || value;
}

function showToast(message, tone = "default") {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.className = `toast ${tone}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = "toast hidden";
  }, 2400);
}

function renderCapabilities() {
  const capabilities = state.capabilities || {};
  const rows = [
    ["Demo", capabilities.demo_mode],
    ["OpenClaw", capabilities.openclaw_agent_runtime],
    ["Agent Model", capabilities.openclaw_model_available],
    ["Temporal", capabilities.temporal],
    ["Web Search", capabilities.web_search],
    ["Push", capabilities.push_channel]
  ];
  qs("#capability-list").innerHTML = rows
    .map(
      ([label, enabled]) => `
        <div class="capability-row">
          <span>${escapeHtml(label)}</span>
          <span class="capability-badge ${enabled ? "" : "off"}">${enabled ? "ON" : "OFF"}</span>
        </div>
      `
    )
    .join("");
}

function renderLatestRun() {
  const run = state.latestRun;
  qs("#latest-run").textContent = run
    ? `${run.workflow_type}\n${run.status}\n${run.summary || "暂无摘要"}`
    : "暂无 workflow run";
}

function todayPrimaryCards() {
  return state.todayCards.filter((card) => card.importance === "high").slice(0, 3);
}

function currentTodayCard() {
  return state.todayCards.find((card) => card.card_id === state.selectedTodayId) || state.todayCards[0] || null;
}

function getThread(cardId) {
  if (!state.threadByCardId[cardId]) {
    state.threadByCardId[cardId] = {
      messages: [],
      draft: "",
      lastQuestion: ""
    };
    if (!state.threadOrder.includes(cardId)) state.threadOrder.push(cardId);
  }
  return state.threadByCardId[cardId];
}

function setViewMeta(viewName) {
  const metadata = {
    today: { label: "Today Workspace", title: "今天的知识更新" },
    library: { label: "Knowledge Library", title: "卡片库" },
    review: { label: "Review Flow", title: "待审核" },
    daily: { label: "Daily Digest", title: "日报" }
  };
  const meta = metadata[viewName];
  qs("#view-label").textContent = meta.label;
  qs("#view-title").textContent = meta.title;
}

function switchView(viewName) {
  state.currentView = viewName;
  qsa(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  qsa(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewName}`);
  });
  setViewMeta(viewName);
}

function renderListCard(card, selectedId, tone = "default") {
  const tags = (card.tags || []).slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  return `
    <button class="list-card ${card.card_id === selectedId ? "selected" : ""} ${tone}" data-card-id="${card.card_id}" type="button">
      <div class="list-card-top">
        <div>
          <strong>${escapeHtml(card.title)}</strong>
          <p>${escapeHtml(card.summary || "暂无摘要")}</p>
        </div>
        <span class="status-badge ${escapeHtml(card.status)}">${escapeHtml(statusLabel(card.status))}</span>
      </div>
      <div class="list-card-bottom">
        <span>${escapeHtml(card.knowledge_date || "")}</span>
        <span>${escapeHtml(importanceLabel(card.importance))}</span>
      </div>
      <div class="tag-row">${tags}</div>
    </button>
  `;
}

function renderStackList(items, selectedId, tone = "default") {
  if (!items.length) return '<div class="empty-state">当前没有符合条件的卡片。</div>';
  return items.map((card) => renderListCard(card, selectedId, tone)).join("");
}

function attachCardClickHandlers(container, callback) {
  qsa("[data-card-id]", container).forEach((button) => {
    button.addEventListener("click", () => callback(button.dataset.cardId));
  });
}

function renderHero() {
  const primary = todayPrimaryCards();
  const summary = state.todayCards.length
    ? `今天新增 ${state.todayCards.length} 张卡片，重点集中在 ${primary.map((card) => (card.tags || [card.title])[0]).join("、") || "多个主题"}。`
    : "今天还没有正式发布的卡片，先运行导入流程或查看审核队列。";
  qs("#today-summary").textContent = summary;
  qs("#today-hero-metrics").innerHTML = `
    <div class="metric-card">
      <span>新增卡片</span>
      <strong>${state.todayCards.length}</strong>
    </div>
    <div class="metric-card">
      <span>重点推荐</span>
      <strong>${primary.length}</strong>
    </div>
    <div class="metric-card">
      <span>待审核</span>
      <strong>${state.inbox.length}</strong>
    </div>
  `;
}

function renderTodayRail() {
  const selectedId = state.selectedTodayId;
  const html = state.todayCards.length
    ? state.todayCards
        .map((card) => {
          const bullets = String(card.content || "")
            .split("\n")
            .map((line) => line.replace(/^- /u, "").trim())
            .filter(Boolean)
            .slice(0, 3)
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("");
          return `
            <article class="today-card ${card.card_id === selectedId ? "selected" : ""}" data-card-id="${card.card_id}">
              <div class="today-card-top">
                <span class="badge importance-${escapeHtml(card.importance)}">${escapeHtml(importanceLabel(card.importance))}</span>
                <span class="badge">${escapeHtml((card.tags || [card.source_type || "知识"]).slice(0, 1)[0])}</span>
              </div>
              <div class="today-card-body">
                <h4>${escapeHtml(card.title)}</h4>
                <p>${escapeHtml(card.summary || "暂无摘要")}</p>
                <ul>${bullets}</ul>
              </div>
              <div class="today-card-actions">
                <button class="ghost-button compact-button" type="button" data-open-detail="${card.card_id}">深入理解</button>
                <button class="ghost-button compact-button" type="button" data-open-chat="${card.card_id}">问 AI</button>
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="empty-state wide">今天还没有正式卡片。</div>';

  const container = qs("#today-rail");
  container.innerHTML = html;
  qsa("[data-card-id]", container).forEach((item) => {
    item.addEventListener("click", () => selectTodayCard(item.dataset.cardId));
  });
  qsa("[data-open-detail]", container).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.detailPanel = "overview";
      updateDetailSegments();
      selectTodayCard(button.dataset.openDetail);
    });
  });
  qsa("[data-open-chat]", container).forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectTodayCard(button.dataset.openChat);
      focusCurrentChatInput();
    });
  });
}

function renderCardOverview(card) {
  const quickPrompts = PRESET_PROMPTS.map(
    (prompt) => `<button class="chip prompt-chip" type="button" data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`
  ).join("");
  const related = state.library
    .filter((item) => item.card_id !== card.card_id && (item.tags || []).some((tag) => (card.tags || []).includes(tag)))
    .slice(0, 3);
  const relatedHtml = related.length
    ? related
        .map(
          (item) => `<button class="related-card" type="button" data-related-card="${item.card_id}">
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml((item.tags || []).join(" / "))}</span>
            </button>`
        )
        .join("")
    : '<div class="empty-inline">暂时没有检测到强关联卡片。</div>';

  return `
    <div class="detail-hero">
      <div>
        <p class="eyebrow">${escapeHtml(card.knowledge_date)} · ${escapeHtml(statusLabel(card.status))}</p>
        <h3>${escapeHtml(card.title)}</h3>
        <p class="body-md subtle">${escapeHtml(card.summary || "暂无摘要")}</p>
      </div>
      <div class="detail-meta">
        <span class="meta-chip">${escapeHtml(importanceLabel(card.importance))}</span>
        <span class="meta-chip">${escapeHtml(card.source_type || "manual")}</span>
        <span class="meta-chip">置信度 ${escapeHtml(String(card.confidence ?? ""))}</span>
      </div>
    </div>

    <div class="info-grid">
      <article class="info-panel">
        <div class="section-title">这张卡在说什么</div>
        <div class="rich-block">${renderContentLines(card.content)}</div>
      </article>
      <article class="info-panel">
        <div class="section-title">为什么重要</div>
        <p class="body-md">${escapeHtml(card.insights || "这张卡目前还没有补充思考，可以通过下方 AI 提问继续延展。")}</p>
      </article>
    </div>

    <article class="info-panel">
      <div class="section-title">你可以这样继续问</div>
      <div class="chip-row">${quickPrompts}</div>
    </article>

    <article class="info-panel">
      <div class="section-title">外部补充</div>
      <p class="body-md subtle">当前界面已经为单卡问答保留“知识库 + 外部补充”模式。后端联网补充接入后，这里会展示该概念的背景、来源与相关文章摘要。</p>
      <div class="inline-actions">
        <button class="ghost-button compact-button" type="button" data-prompt="请结合更广泛的背景资料，补充解释这个概念的来源和上下文">展开更多背景</button>
        <button class="ghost-button compact-button" type="button" id="force-knowledge-only">只看我的知识库</button>
      </div>
    </article>

    <article class="info-panel">
      <div class="section-title">关联卡片</div>
      <div class="related-list">${relatedHtml}</div>
    </article>
  `;
}

function renderContentLines(content) {
  const lines = String(content || "")
    .split("\n")
    .map((line) => line.replace(/^- /u, "").trim())
    .filter(Boolean);
  if (!lines.length) return '<p class="body-md subtle">暂无结构化要点。</p>';
  return `<ul class="content-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

function renderCardSources(card) {
  return `
    <div class="detail-hero">
      <div>
        <p class="eyebrow">Traceability</p>
        <h3>来源与追溯</h3>
        <p class="body-md subtle">这一层帮助你确认这张卡如何生成，以及它来自什么原始材料。</p>
      </div>
    </div>
    <div class="info-grid">
      <article class="info-panel">
        <div class="section-title">来源文件</div>
        <p class="body-md">${escapeHtml((card.source_files || []).join(", ") || "无")}</p>
      </article>
      <article class="info-panel">
        <div class="section-title">OCR 原文摘要</div>
        <p class="body-md">${escapeHtml(card.source_text || "无")}</p>
      </article>
    </div>
  `;
}

function updateDetailSegments() {
  qsa("[data-detail-panel]").forEach((button) => {
    button.classList.toggle("active", button.dataset.detailPanel === state.detailPanel);
  });
}

function renderTodayDetail() {
  const card = currentTodayCard();
  const container = qs("#today-card-detail");
  if (!card) {
    container.innerHTML = '<div class="empty-state wide">选择一张今日卡片开始阅读。</div>';
    return;
  }

  container.innerHTML = state.detailPanel === "overview" ? renderCardOverview(card) : renderCardSources(card);

  qsa("[data-prompt]", container).forEach((button) => {
    button.addEventListener("click", () => {
      askAboutCard(card.card_id, button.dataset.prompt);
    });
  });
  qsa("[data-related-card]", container).forEach((button) => {
    button.addEventListener("click", () => {
      const target = state.todayCards.find((item) => item.card_id === button.dataset.relatedCard);
      if (target) {
        selectTodayCard(target.card_id);
      } else {
        switchView("library");
        selectLibraryCard(button.dataset.relatedCard);
      }
    });
  });
  const forceKnowledgeOnly = qs("#force-knowledge-only", container);
  if (forceKnowledgeOnly) {
    forceKnowledgeOnly.addEventListener("click", () => {
      qs("#today-chat-mode").value = "knowledge_only";
      showToast("当前卡片已切换为仅基于知识库回答");
    });
  }
}

function renderThreadRail() {
  const html = state.todayCards.length
    ? state.todayCards
        .map((card) => {
          const thread = getThread(card.card_id);
          const count = thread.messages.filter((message) => message.role === "assistant").length;
          return `
            <button class="thread-chip ${card.card_id === state.selectedTodayId ? "selected" : ""}" type="button" data-thread-card="${card.card_id}">
              <strong>${escapeHtml(card.title)}</strong>
              <span>${count ? `${count} 条回答` : "未开始"}</span>
            </button>
          `;
        })
        .join("")
    : '<div class="empty-state wide">暂无可讨论的卡片。</div>';
  const container = qs("#thread-rail");
  container.innerHTML = html;
  qsa("[data-thread-card]", container).forEach((button) => {
    button.addEventListener("click", () => selectTodayCard(button.dataset.threadCard));
  });
}

function renderThreadMessages(cardId) {
  const card = state.todayCards.find((item) => item.card_id === cardId) || state.library.find((item) => item.card_id === cardId);
  const thread = getThread(cardId);
  const messagesHtml = thread.messages.length
    ? thread.messages
        .map((message) => {
          if (message.role === "assistant") {
            return `
              <article class="message assistant">
                <div class="message-label">AI 回答</div>
                <div class="message-body">${escapeHtml(message.content)}</div>
              </article>
            `;
          }
          return `
            <article class="message user">
              <div class="message-label">你的问题</div>
              <div class="message-body">${escapeHtml(message.content)}</div>
            </article>
          `;
        })
        .join("")
    : '<div class="empty-state">这张卡还没有对话。你可以从推荐问题开始。</div>';

  const suggestions = PRESET_PROMPTS.map(
    (prompt) => `<button class="chip prompt-chip" type="button" data-chat-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`
  ).join("");

  return `
    <div class="chat-header">
      <div>
        <p class="eyebrow">Current Context</p>
        <h3>${escapeHtml(card?.title || "当前卡片")}</h3>
      </div>
      <div class="chat-meta">
        <span class="meta-chip">当前线程独立保存</span>
      </div>
    </div>

    <div class="info-panel compact-panel">
      <div class="section-title">推荐追问</div>
      <div class="chip-row">${suggestions}</div>
    </div>

    <div class="message-stack">${messagesHtml}</div>

    <form class="chat-composer" data-chat-form="${cardId}">
      <label class="field">
        <span>继续理解这张卡</span>
        <textarea name="question" rows="4" placeholder="例如：Harness Engineering 和 Context Engineering 的关键区别是什么？">${escapeHtml(thread.draft || "")}</textarea>
      </label>
      <div class="composer-actions">
        <button class="primary-button" type="submit">继续理解</button>
        <button class="ghost-button" type="button" data-clear-thread="${cardId}">清空本卡线程</button>
      </div>
    </form>
  `;
}

function focusCurrentChatInput() {
  requestAnimationFrame(() => {
    qs('.chat-composer textarea')?.focus();
  });
}

function renderTodayChatPanel() {
  const card = currentTodayCard();
  const container = qs("#today-chat-panel");
  if (!card) {
    container.innerHTML = '<div class="empty-state wide">选择一张卡片开始讨论。</div>';
    return;
  }
  container.innerHTML = renderThreadMessages(card.card_id);
  qsa("[data-chat-prompt]", container).forEach((button) => {
    button.addEventListener("click", () => askAboutCard(card.card_id, button.dataset.chatPrompt));
  });
  const form = qs("[data-chat-form]", container);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = new FormData(form).get("question");
    await askAboutCard(card.card_id, question);
  });
  const clearButton = qs("[data-clear-thread]", container);
  clearButton.addEventListener("click", () => {
    state.threadByCardId[card.card_id] = { messages: [], draft: "", lastQuestion: "" };
    renderThreadRail();
    renderTodayChatPanel();
    showToast("已清空当前卡片的讨论线程");
  });
}

async function askAboutCard(cardId, rawQuestion) {
  const card = state.todayCards.find((item) => item.card_id === cardId) || state.library.find((item) => item.card_id === cardId);
  const question = String(rawQuestion || "").trim();
  if (!card || !question) return;

  const thread = getThread(cardId);
  thread.draft = "";
  thread.lastQuestion = question;
  thread.messages.push({ role: "user", content: question });
  renderTodayChatPanel();

  const mode = qs("#today-chat-mode")?.value || "knowledge_only";
  const composedQuestion = `请围绕这张知识卡片回答，并优先帮助用户理解概念。\n\n卡片标题：${card.title}\n卡片摘要：${card.summary || ""}\n卡片要点：${card.content || ""}\n卡片思考：${card.insights || ""}\n\n用户问题：${question}`;
  const response = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      question: composedQuestion,
      mode,
      tag: (card.tags || [])[0] || "",
      date: card.knowledge_date || ""
    })
  });

  thread.messages.push({
    role: "assistant",
    content: response.answer
  });
  renderThreadRail();
  renderTodayChatPanel();
}

function selectTodayCard(cardId) {
  state.selectedTodayId = cardId;
  state.lastOpenedCardId = cardId;
  getThread(cardId);
  renderTodayRail();
  renderTodayDetail();
  renderThreadRail();
  renderTodayChatPanel();
}

function nextTodayCard(direction) {
  if (!state.todayCards.length) return;
  const currentIndex = state.todayCards.findIndex((card) => card.card_id === state.selectedTodayId);
  const index = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = Math.min(state.todayCards.length - 1, Math.max(0, index + direction));
  selectTodayCard(state.todayCards[nextIndex].card_id);
}

function renderLibraryActiveFilters() {
  const filters = Object.entries(state.activeLibraryFilters).filter(([, value]) => value && value !== "published");
  qs("#library-active-filters").innerHTML = filters
    .map(
      ([key, value]) => `<button class="filter-pill" type="button" data-remove-filter="${key}">
          <span>${escapeHtml(key)}</span>
          <strong>${escapeHtml(value)}</strong>
        </button>`
    )
    .join("");
  qsa("[data-remove-filter]").forEach((button) => {
    button.addEventListener("click", async () => {
      delete state.activeLibraryFilters[button.dataset.removeFilter];
      await loadLibrary(new URLSearchParams(state.activeLibraryFilters));
    });
  });
}

function syncLibraryForm() {
  const form = qs("#library-filters");
  const defaults = { q: "", importance: "", date: "" };
  for (const [key, value] of Object.entries({ ...defaults, ...state.activeLibraryFilters })) {
    if (form.elements[key]) form.elements[key].value = value;
  }
}

function renderLibraryDetail(card, mode, events = []) {
  if (!card) {
    return '<div class="empty-state wide">从左侧选择一张卡片查看详情。</div>';
  }

  if (mode === "edit") {
    const tags = (card.tags || []).join(", ");
    return `
      <form class="editor-form" data-library-editor="${card.card_id}">
        <div class="detail-hero">
          <div>
            <p class="eyebrow">Edit Card</p>
            <h3>${escapeHtml(card.title)}</h3>
          </div>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>标题</span>
            <input name="title" value="${escapeHtml(card.title)}" />
          </label>
          <label class="field">
            <span>标签</span>
            <input name="tags" value="${escapeHtml(tags)}" />
          </label>
          <label class="field">
            <span>重要性</span>
            <select name="importance">
              <option value="high" ${card.importance === "high" ? "selected" : ""}>高</option>
              <option value="medium" ${card.importance === "medium" ? "selected" : ""}>中</option>
              <option value="low" ${card.importance === "low" ? "selected" : ""}>低</option>
            </select>
          </label>
          <label class="field">
            <span>状态</span>
            <select name="status">
              <option value="published" ${card.status === "published" ? "selected" : ""}>published</option>
              <option value="review" ${card.status === "review" ? "selected" : ""}>review</option>
              <option value="draft" ${card.status === "draft" ? "selected" : ""}>draft</option>
              <option value="archived" ${card.status === "archived" ? "selected" : ""}>archived</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>摘要</span>
          <textarea name="summary" rows="3">${escapeHtml(card.summary || "")}</textarea>
        </label>
        <label class="field">
          <span>要点</span>
          <textarea name="content" rows="8">${escapeHtml(card.content || "")}</textarea>
        </label>
        <label class="field">
          <span>思考</span>
          <textarea name="insights" rows="5">${escapeHtml(card.insights || "")}</textarea>
        </label>
        <div class="composer-actions">
          <button class="primary-button" type="submit">保存卡片</button>
          <button class="ghost-button" type="button" data-open-in-today="${card.card_id}">在 Today 中查看</button>
        </div>
      </form>
    `;
  }

  return `
    <div class="detail-hero">
      <div>
        <p class="eyebrow">${escapeHtml(card.knowledge_date)} · ${escapeHtml(statusLabel(card.status))}</p>
        <h3>${escapeHtml(card.title)}</h3>
        <p class="body-md subtle">${escapeHtml(card.summary || "暂无摘要")}</p>
      </div>
      <div class="detail-meta">
        <span class="meta-chip">${escapeHtml((card.tags || []).join(" / ") || "未分类")}</span>
      </div>
    </div>
    <article class="info-panel">
      <div class="section-title">要点</div>
      <div class="rich-block">${renderContentLines(card.content)}</div>
    </article>
    <article class="info-panel">
      <div class="section-title">思考</div>
      <p class="body-md">${escapeHtml(card.insights || "暂无补充思考")}</p>
    </article>
    <article class="info-panel">
      <div class="section-title">追溯记录</div>
      <div class="timeline-block">${renderTimeline(events)}</div>
    </article>
    <div class="inline-actions">
      <button class="ghost-button compact-button" type="button" data-open-in-today="${card.card_id}">在 Today 中查看</button>
      <button class="ghost-button compact-button" type="button" data-ask-from-library="${card.card_id}">围绕这张卡提问</button>
    </div>
  `;
}

function renderTimeline(events) {
  if (!events.length) return '<div class="empty-inline">暂无流水记录。</div>';
  return events
    .map(
      (event) => `
        <div class="timeline-row">
          <div class="timeline-dot"></div>
          <div>
            <div class="timeline-title">${escapeHtml(event.stage)} <span>${escapeHtml(event.status)}</span></div>
            <p class="body-sm subtle">${escapeHtml(JSON.stringify(event.payload))}</p>
          </div>
        </div>
      `
    )
    .join("");
}

async function loadLibrary(params = new URLSearchParams(state.activeLibraryFilters)) {
  const query = params.toString();
  const data = await api(`/api/cards?${query}`);
  state.library = data.items;
  state.activeLibraryFilters = Object.fromEntries(params.entries());
  syncLibraryForm();
  renderLibraryActiveFilters();
  qs("#library-count-label").textContent = `${state.library.length} 张卡片`;
  const container = qs("#library-list");
  container.innerHTML = renderStackList(state.library, state.selectedLibraryId);
  attachCardClickHandlers(container, selectLibraryCard);

  if (state.selectedLibraryId && !state.library.some((card) => card.card_id === state.selectedLibraryId)) {
    state.selectedLibraryId = null;
  }
  if (!state.selectedLibraryId && state.library[0]) state.selectedLibraryId = state.library[0].card_id;
  if (state.selectedLibraryId) await selectLibraryCard(state.selectedLibraryId, false);
  updateStats();
}

async function selectLibraryCard(cardId, fetchRemote = true) {
  state.selectedLibraryId = cardId;
  const data = fetchRemote ? await api(`/api/cards/${encodeURIComponent(cardId)}`) : null;
  const card = data?.item || state.library.find((item) => item.card_id === cardId);
  const events = data?.events || [];
  qs("#library-detail").innerHTML = renderLibraryDetail(card, state.libraryMode, events);

  const container = qs("#library-list");
  container.innerHTML = renderStackList(state.library, state.selectedLibraryId);
  attachCardClickHandlers(container, selectLibraryCard);

  const editor = qs("[data-library-editor]");
  if (editor) {
    editor.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(editor));
      await api(`/api/cards/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      showToast("卡片已保存");
      await refreshAllData();
      await selectLibraryCard(cardId);
    });
  }

  qsa("[data-open-in-today]").forEach((button) => {
    button.addEventListener("click", () => {
      switchView("today");
      const existsInToday = state.todayCards.find((item) => item.card_id === button.dataset.openInToday);
      if (existsInToday) selectTodayCard(button.dataset.openInToday);
    });
  });

  qsa("[data-ask-from-library]").forEach((button) => {
    button.addEventListener("click", () => {
      switchView("today");
      const exists = state.todayCards.find((item) => item.card_id === button.dataset.askFromLibrary);
      if (exists) {
        selectTodayCard(button.dataset.askFromLibrary);
      } else {
        const card = state.library.find((item) => item.card_id === button.dataset.askFromLibrary);
        if (card) {
          state.todayCards = [card, ...state.todayCards.filter((item) => item.card_id !== card.card_id)];
          selectTodayCard(card.card_id);
        }
      }
      focusCurrentChatInput();
    });
  });
}

function reviewItems() {
  if (state.reviewFilter === "high") {
    return state.inbox.filter((card) => card.importance === "high");
  }
  return state.inbox;
}

function renderReviewDetail(card, events = []) {
  if (!card) return '<div class="empty-state wide">从左侧选择一张候选卡片开始审核。</div>';
  const tags = (card.tags || []).join(", ");
  return `
    <form class="editor-form" data-review-editor="${card.card_id}">
      <div class="detail-hero">
        <div>
          <p class="eyebrow">Candidate Review</p>
          <h3>${escapeHtml(card.title)}</h3>
          <p class="body-md subtle">${escapeHtml(card.summary || "暂无摘要")}</p>
        </div>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>标题</span>
          <input name="title" value="${escapeHtml(card.title)}" />
        </label>
        <label class="field">
          <span>标签</span>
          <input name="tags" value="${escapeHtml(tags)}" />
        </label>
        <label class="field">
          <span>重要性</span>
          <select name="importance">
            <option value="high" ${card.importance === "high" ? "selected" : ""}>高</option>
            <option value="medium" ${card.importance === "medium" ? "selected" : ""}>中</option>
            <option value="low" ${card.importance === "low" ? "selected" : ""}>低</option>
          </select>
        </label>
        <label class="field">
          <span>状态</span>
          <select name="status">
            <option value="review" ${card.status === "review" ? "selected" : ""}>review</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>
      <label class="field">
        <span>摘要</span>
        <textarea name="summary" rows="3">${escapeHtml(card.summary || "")}</textarea>
      </label>
      <label class="field">
        <span>要点</span>
        <textarea name="content" rows="7">${escapeHtml(card.content || "")}</textarea>
      </label>
      <label class="field">
        <span>思考</span>
        <textarea name="insights" rows="5">${escapeHtml(card.insights || "")}</textarea>
      </label>
      <div class="info-grid">
        <article class="info-panel">
          <div class="section-title">来源文件</div>
          <p class="body-md">${escapeHtml((card.source_files || []).join(", ") || "无")}</p>
        </article>
        <article class="info-panel">
          <div class="section-title">OCR 原文摘要</div>
          <p class="body-md">${escapeHtml(card.source_text || "无")}</p>
        </article>
      </div>
      <article class="info-panel">
        <div class="section-title">追溯记录</div>
        <div class="timeline-block">${renderTimeline(events)}</div>
      </article>
      <div class="composer-actions">
        <button class="primary-button" type="submit">保存修改</button>
        <button class="ghost-button success" type="button" data-approve="${card.card_id}">通过入库</button>
        <button class="ghost-button danger" type="button" data-reject="${card.card_id}">归档拒绝</button>
      </div>
    </form>
  `;
}

async function loadReview() {
  const data = await api("/api/cards?status=review");
  state.inbox = data.items;
  const items = reviewItems();
  qs("#review-list").innerHTML = renderStackList(items, state.selectedReviewId, "review");
  attachCardClickHandlers(qs("#review-list"), selectReviewCard);
  if (state.selectedReviewId && !items.some((card) => card.card_id === state.selectedReviewId)) {
    state.selectedReviewId = null;
  }
  if (!state.selectedReviewId && items[0]) state.selectedReviewId = items[0].card_id;
  if (state.selectedReviewId) await selectReviewCard(state.selectedReviewId);
  else qs("#review-detail").innerHTML = '<div class="empty-state wide">当前没有待审核卡片。</div>';
  updateStats();
}

async function selectReviewCard(cardId) {
  state.selectedReviewId = cardId;
  const data = await api(`/api/cards/${encodeURIComponent(cardId)}`);
  qs("#review-detail").innerHTML = renderReviewDetail(data.item, data.events);
  qs("#review-list").innerHTML = renderStackList(reviewItems(), state.selectedReviewId, "review");
  attachCardClickHandlers(qs("#review-list"), selectReviewCard);

  const form = qs("[data-review-editor]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form));
    await api(`/api/cards/${encodeURIComponent(cardId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    showToast("候选卡片已保存");
    await refreshAllData();
    await selectReviewCard(cardId);
  });

  qs("[data-approve]")?.addEventListener("click", async () => {
    const payload = Object.fromEntries(new FormData(form));
    await api(`/api/review/${encodeURIComponent(cardId)}/approve`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showToast("卡片已通过审核", "success");
    state.selectedReviewId = null;
    await refreshAllData();
    switchView("today");
  });

  qs("[data-reject]")?.addEventListener("click", async () => {
    await api(`/api/review/${encodeURIComponent(cardId)}/reject`, {
      method: "POST",
      body: "{}"
    });
    showToast("卡片已归档", "warning");
    state.selectedReviewId = null;
    await refreshAllData();
  });
}

async function loadTodayCards() {
  const published = await api(`/api/cards?status=published&date=${TODAY_DATE}&limit=100`);
  state.todayCards = published.items
    .filter((card) => {
      if (card.source_type !== "screenshot") return true;
      if (card.metadata?.review_approved) return true;
      return card.metadata?.ingest_strategy !== "ocr-heuristic-v1";
    })
    .sort((left, right) => {
    if (left.source_type === right.source_type) {
      if (left.importance === right.importance) return String(right.updated_at).localeCompare(String(left.updated_at));
      return left.importance === "high" ? -1 : right.importance === "high" ? 1 : 0;
    }
    return left.source_type === "knowledge-base" ? -1 : 1;
    });
  renderHero();
  if (state.selectedTodayId && !state.todayCards.some((card) => card.card_id === state.selectedTodayId)) {
    state.selectedTodayId = null;
  }
  if (!state.selectedTodayId && state.lastOpenedCardId && state.todayCards.some((card) => card.card_id === state.lastOpenedCardId)) {
    state.selectedTodayId = state.lastOpenedCardId;
  }
  if (!state.selectedTodayId && state.todayCards[0]) state.selectedTodayId = state.todayCards[0].card_id;
  updateStats();
  renderTodayRail();
  renderTodayDetail();
  renderThreadRail();
  renderTodayChatPanel();
}

async function loadDaily(date) {
  const response = await api(`/api/daily/${date}`);
  state.dailyCards = response.cards;
  qs("#daily-metrics").innerHTML = `
    <div class="metric-card compact-metric">
      <span>已发布</span>
      <strong>${response.published_count}</strong>
    </div>
    <div class="metric-card compact-metric">
      <span>待审核</span>
      <strong>${response.review_count}</strong>
    </div>
    <div class="metric-card compact-metric">
      <span>已归档</span>
      <strong>${response.archived_count}</strong>
    </div>
  `;
  qs("#daily-list").innerHTML = renderStackList(response.cards, null);
  attachCardClickHandlers(qs("#daily-list"), (cardId) => {
    switchView("library");
    selectLibraryCard(cardId);
  });
  qs("#daily-summary").textContent = response.summary;
  state.wechatPreview = null;
  renderWechatPreview();
}

function renderWechatPreview() {
  const target = qs("#wechat-preview");
  if (!target) return;
  if (!state.wechatPreview) {
    target.textContent = "点击“微信预览”生成将要发送的内容。";
    return;
  }
  const preview = state.wechatPreview;
  target.textContent = [
    `通道：${preview.channel} -> ${preview.target}`,
    `卡片：${preview.cards?.length || 0} 张`,
    "",
    preview.message
  ].join("\n");
}

async function previewWechatPush() {
  const date = qs('#daily-form input[name="date"]').value || TODAY_DATE;
  const result = await api("/api/push/wechat", {
    method: "POST",
    body: JSON.stringify({
      date,
      limit: 5,
      dry_run: true
    })
  });
  state.wechatPreview = result;
  renderWechatPreview();
  switchView("daily");
  showToast("微信推荐预览已生成", "success");
  return result;
}

async function sendWechatPush() {
  const preview = state.wechatPreview || await previewWechatPush();
  const confirmed = window.confirm(`确认把 ${preview.cards?.length || 0} 张卡片推荐发送到微信 ${preview.target} 吗？`);
  if (!confirmed) return;
  const result = await api("/api/push/wechat", {
    method: "POST",
    body: JSON.stringify({
      date: preview.date || qs('#daily-form input[name="date"]').value || TODAY_DATE,
      limit: 5,
      dry_run: false,
      confirm: true
    })
  });
  state.wechatPreview = result;
  renderWechatPreview();
  await loadWorkflowRuns();
  showToast(result.ok ? "微信推荐已发送" : "微信推送失败", result.ok ? "success" : "warning");
}

async function loadCapabilities() {
  state.capabilities = await api("/api/system/capabilities");
  state.health = await api("/api/system/health");
  renderCapabilities();
}

async function loadWorkflowRuns() {
  const response = await api("/api/workflows?limit=1");
  state.latestRun = response.items?.[0] || null;
  renderLatestRun();
}

function updateStats() {
  const todayCount = state.todayCards.length;
  const publishedCount = state.library.filter((card) => card.status === "published").length;
  qs("#nav-count-today").textContent = String(todayCount);
  qs("#nav-count-library").textContent = String(publishedCount);
  qs("#nav-count-review").textContent = String(state.inbox.length);
  qs("#status-today-count").textContent = String(todayCount);
  qs("#status-review-count").textContent = String(state.inbox.length);
  qs("#status-published-count").textContent = String(publishedCount);
}

async function refreshAllData() {
  await loadReview();
  await loadLibrary(new URLSearchParams(state.activeLibraryFilters));
  await loadTodayCards();
  await loadDaily(qs('#daily-form input[name="date"]').value || TODAY_DATE);
  await loadCapabilities();
  await loadWorkflowRuns();
}

function openSpotlight() {
  state.spotlightOpen = true;
  qs("#spotlight").classList.remove("hidden");
  qs("#spotlight").setAttribute("aria-hidden", "false");
  qs("#spotlight-input").focus();
  runSpotlightSearch(qs("#spotlight-input").value || "");
}

function closeSpotlight() {
  state.spotlightOpen = false;
  qs("#spotlight").classList.add("hidden");
  qs("#spotlight").setAttribute("aria-hidden", "true");
}

async function runSpotlightSearch(query) {
  if (!query.trim()) {
    state.spotlightResults = state.library.slice(0, 8);
  } else {
    const data = await api(`/api/cards?q=${encodeURIComponent(query)}&limit=12`);
    state.spotlightResults = data.items;
  }
  qs("#spotlight-results").innerHTML = state.spotlightResults.length
    ? state.spotlightResults
        .map(
          (card) => `
            <button class="spotlight-item" type="button" data-spotlight-id="${card.card_id}">
              <div>
                <strong>${escapeHtml(card.title)}</strong>
                <p class="body-sm subtle">${escapeHtml(card.summary || "暂无摘要")}</p>
              </div>
              <span>${escapeHtml(card.knowledge_date || "")}</span>
            </button>
          `
        )
        .join("")
    : '<div class="empty-state">没有匹配结果。</div>';
  qsa("[data-spotlight-id]").forEach((button) => {
    button.addEventListener("click", () => {
      closeSpotlight();
      switchView("library");
      selectLibraryCard(button.dataset.spotlightId);
    });
  });
}

function updateClock() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  qs("#clock").textContent = formatter.format(new Date());
}

function bindGlobalHandlers() {
  qsa(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  qsa("[data-detail-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.detailPanel = button.dataset.detailPanel;
      updateDetailSegments();
      renderTodayDetail();
    });
  });

  qsa("[data-library-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.libraryMode = button.dataset.libraryMode;
      qsa("[data-library-mode]").forEach((item) => {
        item.classList.toggle("active", item.dataset.libraryMode === state.libraryMode);
      });
      if (state.selectedLibraryId) await selectLibraryCard(state.selectedLibraryId);
    });
  });

  qsa("[data-review-filter]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.reviewFilter = button.dataset.reviewFilter;
      qsa("[data-review-filter]").forEach((item) => {
        item.classList.toggle("active", item.dataset.reviewFilter === state.reviewFilter);
      });
      await loadReview();
    });
  });

  qs("#library-filters").addEventListener("submit", async (event) => {
    event.preventDefault();
    const params = new URLSearchParams(
      Object.entries({ status: "published", ...Object.fromEntries(new FormData(event.currentTarget)) }).filter(([, value]) => value)
    );
    await loadLibrary(params);
  });

  qs("#library-reset").addEventListener("click", async () => {
    state.activeLibraryFilters = { status: "published" };
    await loadLibrary(new URLSearchParams(state.activeLibraryFilters));
  });

  qs("#daily-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = new FormData(event.currentTarget).get("date");
    if (date) await loadDaily(date);
  });

  qs("#run-ingest").addEventListener("click", async () => {
    state.lastImportState = "运行中";
    showToast("开始触发导入 workflow");
    const result = await api("/api/workflows/ingest", {
      method: "POST",
      body: JSON.stringify({
        mode: state.capabilities.demo_mode ? "demo_upload" : "screenshot_scan"
      })
    });
    state.lastImportState = "已完成";
    await refreshAllData();
    showToast(result.item?.summary || "导入流程已完成", "success");
  });

  qs("#run-digest").addEventListener("click", async () => {
    const date = qs('#daily-form input[name="date"]').value || TODAY_DATE;
    const result = await api("/api/workflows/digest", {
      method: "POST",
      body: JSON.stringify({ date })
    });
    await refreshAllData();
    showToast(result.item?.summary || "日报已生成", "success");
  });

  qs("#push-wechat-preview").addEventListener("click", previewWechatPush);
  qs("#push-wechat-send").addEventListener("click", sendWechatPush);

  qs("#demo-seed").addEventListener("click", async () => {
    await api("/api/demo/seed", { method: "POST", body: "{}" });
    await refreshAllData();
    showToast("Demo 数据已注入", "success");
  });

  qs("#demo-reset").addEventListener("click", async () => {
    await api("/api/demo/reset", { method: "POST", body: "{}" });
    await refreshAllData();
    showToast("Demo 数据已重置", "success");
  });

  qs("#start-browsing").addEventListener("click", () => {
    qs("#today-rail")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  qs("#resume-thread").addEventListener("click", () => {
    if (state.lastOpenedCardId && state.todayCards.some((card) => card.card_id === state.lastOpenedCardId)) {
      selectTodayCard(state.lastOpenedCardId);
      focusCurrentChatInput();
    }
  });

  qs("#today-prev").addEventListener("click", () => nextTodayCard(-1));
  qs("#today-next").addEventListener("click", () => nextTodayCard(1));
  qs("#daily-run-manual").addEventListener("click", async () => {
    const date = qs('#daily-form input[name="date"]').value || TODAY_DATE;
    const result = await api("/api/workflows/digest", {
      method: "POST",
      body: JSON.stringify({ date })
    });
    await refreshAllData();
    showToast(result.item?.summary || "日报已生成", "success");
  });
  qs("#daily-push-preview").addEventListener("click", previewWechatPush);
  qs("#daily-push-send").addEventListener("click", sendWechatPush);

  qs("#global-search-trigger").addEventListener("click", openSpotlight);
  qs("#focus-search").addEventListener("click", openSpotlight);
  qs("#spotlight-close").addEventListener("click", closeSpotlight);
  qs("#spotlight-input").addEventListener("input", (event) => runSpotlightSearch(event.currentTarget.value));
  qsa("[data-close-spotlight]").forEach((element) => {
    element.addEventListener("click", closeSpotlight);
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (state.spotlightOpen) closeSpotlight();
      else openSpotlight();
    }
    if (event.key === "Escape" && state.spotlightOpen) closeSpotlight();
  });
}

async function bootstrap() {
  bindGlobalHandlers();
  updateClock();
  setInterval(updateClock, 60_000);
  qs('#daily-form input[name="date"]').value = TODAY_DATE;
  switchView("today");
  await refreshAllData();
}

bootstrap().catch((error) => {
  console.error(error);
  showToast(`初始化失败：${error.message}`, "warning");
});
