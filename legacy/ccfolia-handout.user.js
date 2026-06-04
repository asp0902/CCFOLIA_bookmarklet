// ==UserScript==
// @name         CCFOLIA Handout by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-handout
// @version      0.1.0
// @description  Roll20 스타일 핸드아웃(공개/비밀, 이미지, 캐릭터 할당) 기능. 1단계는 GM 본인 화면 전용 로컬 도구.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  try { window.__CCF_HANDOUT_DEBUG__?.disable?.(); } catch (error) { /* previous cleanup failed */ }

  const FEATURE_ID = "ccf-handout";
  const STORAGE_FEATURE = FEATURE_ID;
  const ROOT_ID = "ccfolia-handout-root";
  const STYLE_ID = "ccfolia-handout-style";
  const ICON_MARKER = "data-ccf-handout-icon";
  // Roll20 저널 책 아이콘 (Lucide book 기반)
  const JOURNAL_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;pointer-events:none;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 6h7"/><path d="M9 10h7"/></svg>`;

  const PANEL_TITLES_MY_CHARS = [
    "내 캐릭터 목록", "내 캐릭터 리스트",
    "My character list", "My characters", "Character list", "Characters",
    "マイキャラクター一覧", "自分のキャラクター一覧",
    "我的角色一覽", "我的角色一览", "我的角色列表"
  ];

  let active = true;
  const disposers = [];
  const abort = new AbortController();
  const signal = abort.signal;

  function registerTeardown(fn) {
    if (typeof fn === "function") disposers.push(fn);
  }

  function teardown() {
    if (!active) return false;
    active = false;
    try { abort.abort(); } catch (error) { /* abort failed */ }
    while (disposers.length) {
      try { disposers.pop()(); } catch (error) { /* disposer failed */ }
    }
    try {
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      document.querySelectorAll(`[${ICON_MARKER}]`).forEach((el) => el.remove());
    } catch (error) { /* sweep failed */ }
    try {
      if (window.__CCF_HANDOUT_DEBUG__ && window.__CCF_HANDOUT_DEBUG__.__owner === signal) {
        delete window.__CCF_HANDOUT_DEBUG__;
      }
    } catch (error) { /* debug cleanup failed */ }
    return true;
  }

  window.__CCF_HANDOUT_DEBUG__ = {
    __owner: signal,
    isActive() { return active; },
    open() { openPanel(); },
    close() { closePanel(); },
    locateAnchor() { return diagnoseAnchors(); },
    forceFloating() { document.querySelectorAll(`[${ICON_MARKER}]`).forEach((el) => el.remove()); mountFloatingIcon(); return true; },
    remount() { document.querySelectorAll(`[${ICON_MARKER}]`).forEach((el) => el.remove()); mountIcon(); return true; },
    disable() { return teardown(); }
  };

  // ===== storage (capybara toolkit roomData) =====
  function toolkit() {
    return window.__CAPYBARA_TOOLKIT__ || null;
  }

  function getCurrentRoomKey() {
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "global";
  }

  async function loadAll() {
    const tk = toolkit();
    if (!tk?.storage?.getRoomData) {
      return { handouts: [], myCharacter: "" };
    }
    const record = await tk.storage.getRoomData(STORAGE_FEATURE, getCurrentRoomKey());
    const value = record?.value;
    if (!value || typeof value !== "object") return { handouts: [], myCharacter: "" };
    return {
      handouts: Array.isArray(value.handouts) ? value.handouts : [],
      myCharacter: typeof value.myCharacter === "string" ? value.myCharacter : ""
    };
  }

  async function saveAll(data) {
    const tk = toolkit();
    if (!tk?.storage?.setRoomData) return;
    await tk.storage.setRoomData(STORAGE_FEATURE, getCurrentRoomKey(), data);
  }

  // ===== state =====
  const state = {
    isOpen: false,
    activeTab: "list",      // list | new | settings
    editingId: null,        // 편집 중인 handout id
    plPreview: false,       // PL 시점 미리보기 토글
    data: { handouts: [], myCharacter: "" },
    root: null,
    shadow: null,
    mountObserver: null,
    routeObserver: null,
    lastRoomKey: getCurrentRoomKey()
  };

  // ===== util =====
  function uuid() {
    return "h-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function removeSpaces(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // ===== 간소 마크다운 렌더러 =====
  // bold **x**, italic *x*, code `x`, link [t](u), image ![](u) and [image]u,
  // heading # ## ###, list -, quote >, hr ---, line break
  function renderMarkdown(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let inList = false;
    let inQuote = false;
    let inPara = false;

    function closeBlocks() {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      if (inPara) { out.push("</p>"); inPara = false; }
    }

    function inline(text) {
      let t = escapeHtml(text);
      // [image]url  (legacy 호환)
      t = t.replace(/\[image\]\s*(https?:\/\/[^\s<>"']+)/gi, (_m, u) => `<img class="cch-img" src="${u}" alt="">`);
      // markdown image ![alt](url)
      t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, alt, u) => `<img class="cch-img" src="${u}" alt="${alt}">`);
      // link [text](url)
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, txt, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
      // bold
      t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      // italic
      t = t.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
      // inline code
      t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      return t;
    }

    for (const raw of lines) {
      const line = raw;
      if (/^\s*$/.test(line)) { closeBlocks(); continue; }
      if (/^---+\s*$/.test(line)) { closeBlocks(); out.push("<hr>"); continue; }
      const h = line.match(/^(#{1,3})\s+(.+)$/);
      if (h) { closeBlocks(); const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
      const li = line.match(/^\s*-\s+(.+)$/);
      if (li) {
        if (inPara) { out.push("</p>"); inPara = false; }
        if (inQuote) { out.push("</blockquote>"); inQuote = false; }
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }
      const q = line.match(/^>\s?(.*)$/);
      if (q) {
        if (inPara) { out.push("</p>"); inPara = false; }
        if (inList) { out.push("</ul>"); inList = false; }
        if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
        out.push(inline(q[1]) + "<br>");
        continue;
      }
      if (inList) { out.push("</ul>"); inList = false; }
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      if (!inPara) { out.push("<p>"); inPara = true; out.push(inline(line)); }
      else { out.push("<br>" + inline(line)); }
    }
    closeBlocks();
    return out.join("");
  }

  // ===== viewers 매칭 =====
  // viewers: 캐릭터명 배열. "*" 또는 "all" 포함 시 전체 공개.
  function canViewSecret(handout, myCharacter) {
    if (!handout) return false;
    const viewers = Array.isArray(handout.viewers) ? handout.viewers : [];
    if (viewers.some((v) => v === "*" || /^all$/i.test(String(v).trim()))) return true;
    const me = removeSpaces(myCharacter).toLowerCase();
    if (!me) return false;
    return viewers.some((v) => removeSpaces(v).toLowerCase() === me);
  }

  // ===== UI =====
  const STYLE_CSS = `
    :host { all: initial; color: #111; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    button, input, textarea, select { font: inherit; color: inherit; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,.42); z-index: 2147483646;
      display: none; align-items: center; justify-content: center; padding: 32px 16px;
    }
    .backdrop[data-open="1"] { display: flex; }
    .panel {
      width: min(820px, 100%); max-height: 100%; display: flex; flex-direction: column;
      background: #fff; border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,.32);
      overflow: hidden; border: 1px solid #d7d7d7;
    }
    header {
      padding: 14px 16px; border-bottom: 1px solid #e5e5e5;
      display: flex; align-items: center; gap: 12px;
    }
    header h1 { margin: 0; font-size: 16px; font-weight: 800; }
    header .meta { font-size: 12px; color: #666; }
    header .spacer { flex: 1; }
    .tabs { display: flex; gap: 4px; border-bottom: 1px solid #e5e5e5; padding: 0 16px; background: #fafafa; }
    .tab {
      padding: 10px 14px; border: 0; background: transparent; cursor: pointer;
      font-size: 13px; font-weight: 700; color: #666; border-bottom: 2px solid transparent;
    }
    .tab[data-active="1"] { color: #111; border-bottom-color: #111; }
    .body { overflow: auto; padding: 16px; flex: 1; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .field label { font-size: 12px; font-weight: 700; color: #444; }
    .field input[type="text"], .field textarea, .field input[type="url"] {
      padding: 8px 10px; border: 1px solid #d1d1d1; border-radius: 6px; background: #fff;
      font-size: 13px; width: 100%; resize: vertical;
    }
    .field textarea { min-height: 96px; line-height: 1.5; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
    .field .hint { font-size: 11px; color: #888; }
    .btn {
      height: 32px; padding: 0 12px; border: 1px solid #111; border-radius: 6px;
      background: #111; color: #fff; cursor: pointer; font-size: 12px; font-weight: 700;
    }
    .btn.secondary { border-color: #d1d1d1; background: #fff; color: #222; }
    .btn.danger { border-color: #b53030; background: #fff; color: #b53030; }
    .btn.small { height: 26px; padding: 0 8px; font-size: 11px; }
    .btn[disabled] { opacity: .5; cursor: default; }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .card {
      border: 1px solid #e1e1e1; border-radius: 10px; padding: 12px; background: #fbfbfb;
    }
    .card .head { display: flex; align-items: center; gap: 10px; }
    .card .title { font-size: 14px; font-weight: 800; flex: 1; }
    .card .badge {
      font-size: 10px; padding: 2px 6px; border-radius: 10px; border: 1px solid #d1d1d1; color: #555; background: #fff;
    }
    .card .badge.secret { border-color: #b53030; color: #b53030; }
    .card .summary { margin-top: 6px; font-size: 12px; color: #555; max-height: 60px; overflow: hidden; }
    .card .actions { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
    .empty { padding: 40px 12px; text-align: center; color: #999; font-size: 13px; }
    .preview {
      border: 1px solid #e1e1e1; border-radius: 10px; padding: 12px; background: #fff; margin-top: 6px;
      max-height: 200px; overflow: auto; font-size: 13px; line-height: 1.55;
    }
    .preview img.cch-img { max-width: 100%; height: auto; display: block; margin: 6px 0; border-radius: 6px; }
    .preview a { color: #1763b8; }
    .preview blockquote { border-left: 3px solid #ccc; margin: 6px 0; padding: 2px 10px; color: #555; }
    .preview h1 { font-size: 18px; margin: 8px 0; }
    .preview h2 { font-size: 16px; margin: 7px 0; }
    .preview h3 { font-size: 14px; margin: 6px 0; }
    .preview code { background: #f0f0f0; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 90%; }
    .preview hr { border: 0; border-top: 1px solid #e1e1e1; margin: 8px 0; }
    .preview ul { padding-left: 20px; margin: 4px 0; }
    /* 상세 다이얼로그 (핸드아웃 1장 열람) */
    .detail-img { width: 100%; max-height: 240px; object-fit: cover; border-radius: 8px; margin-bottom: 12px; background: #f0f0f0; }
    .secret-block {
      margin-top: 12px; border: 1px dashed #b53030; border-radius: 8px; padding: 10px; background: #fff8f6;
    }
    .secret-block .secret-head { font-size: 11px; font-weight: 800; color: #b53030; margin-bottom: 6px; letter-spacing: .04em; }
    .hidden-secret {
      margin-top: 12px; border: 1px dashed #999; border-radius: 8px; padding: 14px; background: #f5f5f5;
      color: #999; text-align: center; font-size: 12px;
    }
    .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #eee; color: #444; }
    .toast {
      position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
      background: #111; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 12px;
      opacity: 0; transition: opacity 160ms ease; pointer-events: none;
    }
    .toast[data-visible="1"] { opacity: 1; }
    .checkbox { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: #444; cursor: pointer; }
    @media (prefers-color-scheme: dark) {
      :host { color: #eee; }
      .panel { background: #1a1a1a; border-color: #333; }
      header, .tabs { border-color: #303030; background: #181818; }
      .body { background: #1a1a1a; }
      .tab { color: #888; }
      .tab[data-active="1"] { color: #fff; border-bottom-color: #fff; }
      .field input, .field textarea { background: #222; border-color: #444; color: #eee; }
      .btn.secondary { background: #222; border-color: #444; color: #eee; }
      .card { background: #222; border-color: #333; }
      .card .title { color: #f0f0f0; }
      .card .summary { color: #aaa; }
      .card .badge { background: #1a1a1a; border-color: #444; color: #aaa; }
      .preview { background: #1f1f1f; border-color: #333; }
      .preview blockquote { color: #aaa; border-color: #444; }
      .preview code { background: #2a2a2a; }
      .secret-block { background: #2a1a1a; }
      .hidden-secret { background: #222; color: #777; }
      .chip { background: #2a2a2a; color: #ccc; }
    }
  `;

  function ensureRoot() {
    if (state.root && state.shadow) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${STYLE_CSS}</style>
      <div class="backdrop" data-open="0">
        <section class="panel" role="dialog" aria-label="핸드아웃">
          <header>
            <h1>핸드아웃</h1>
            <span class="meta"></span>
            <span class="spacer"></span>
            <button class="btn secondary small" data-action="close">닫기</button>
          </header>
          <div class="tabs">
            <button class="tab" data-tab="list" data-active="1">목록</button>
            <button class="tab" data-tab="edit" data-active="0">새로 만들기</button>
            <button class="tab" data-tab="settings" data-active="0">설정</button>
          </div>
          <div class="body"></div>
          <div class="toast" aria-live="polite"></div>
        </section>
      </div>
    `;
    (document.body || document.documentElement).appendChild(root);
    shadow.addEventListener("click", onShadowClick);
    shadow.addEventListener("change", onShadowChange);
    shadow.addEventListener("input", onShadowInput);
    state.root = root;
    state.shadow = shadow;
    registerTeardown(() => root.remove());
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = state.shadow?.querySelector(".toast");
    if (!el) return;
    el.textContent = msg;
    el.setAttribute("data-visible", "1");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.removeAttribute("data-visible"), 1600);
  }

  async function openPanel() {
    ensureRoot();
    // 룸 변경 감지
    const room = getCurrentRoomKey();
    if (room !== state.lastRoomKey) {
      state.lastRoomKey = room;
      state.data = await loadAll();
    } else if (!state.data.handouts.length && !state.data.myCharacter) {
      state.data = await loadAll();
    }
    state.isOpen = true;
    render();
  }

  function closePanel() {
    state.isOpen = false;
    state.editingId = null;
    render();
  }

  function setTab(tab) {
    state.activeTab = tab;
    if (tab !== "edit") state.editingId = null;
    render();
  }

  function render() {
    if (!state.shadow) return;
    const bd = state.shadow.querySelector(".backdrop");
    bd.setAttribute("data-open", state.isOpen ? "1" : "0");
    const meta = state.shadow.querySelector("header .meta");
    meta.textContent = `룸: ${getCurrentRoomKey()} · 내 캐릭터: ${state.data.myCharacter || "(미설정)"} · ${state.data.handouts.length}건`;
    state.shadow.querySelectorAll(".tab").forEach((t) => {
      t.setAttribute("data-active", t.dataset.tab === state.activeTab ? "1" : "0");
    });
    const body = state.shadow.querySelector(".body");
    if (state.activeTab === "list") body.innerHTML = renderList();
    else if (state.activeTab === "edit") body.innerHTML = renderEdit();
    else body.innerHTML = renderSettings();
  }

  function renderList() {
    const me = state.data.myCharacter;
    const previewAsPl = state.plPreview && !!me;
    if (!state.data.handouts.length) {
      return `
        <div class="row" style="margin-bottom:12px;">
          <button class="btn" data-action="new-handout">+ 새 핸드아웃</button>
          <label class="checkbox" title="현재 캐릭터의 권한대로만 표시">
            <input type="checkbox" data-action="toggle-pl-preview" ${previewAsPl ? "checked" : ""} ${me ? "" : "disabled"}>
            PL 시점 미리보기
          </label>
        </div>
        <div class="empty">아직 핸드아웃이 없습니다. "+ 새 핸드아웃"으로 첫 카드를 만들어보세요.</div>
      `;
    }
    const cards = state.data.handouts.map((h) => {
      const canSecret = previewAsPl ? canViewSecret(h, me) : true;
      const hasSecret = !!(h.gmNotes && h.gmNotes.trim());
      const viewersLabel = (Array.isArray(h.viewers) && h.viewers.length)
        ? h.viewers.map((v) => v === "*" ? "전체" : v).join(", ")
        : "GM 전용";
      return `
        <article class="card" data-id="${escapeHtml(h.id)}">
          <div class="head">
            <div class="title">${escapeHtml(h.title || "(제목 없음)")}</div>
            ${hasSecret ? `<span class="badge secret">비밀</span>` : ""}
            <span class="badge">${escapeHtml(viewersLabel)}</span>
          </div>
          <div class="summary">${escapeHtml(stripMarkdown(h.description).slice(0, 140))}</div>
          <div class="actions">
            <button class="btn small" data-action="view-handout" data-id="${escapeHtml(h.id)}">열기</button>
            <button class="btn small secondary" data-action="show-to-players" data-id="${escapeHtml(h.id)}">Show to Players</button>
            <button class="btn small secondary" data-action="edit-handout" data-id="${escapeHtml(h.id)}">편집</button>
            <button class="btn small danger" data-action="delete-handout" data-id="${escapeHtml(h.id)}">삭제</button>
          </div>
        </article>
      `;
    }).join("");
    return `
      <div class="row" style="margin-bottom:12px;">
        <button class="btn" data-action="new-handout">+ 새 핸드아웃</button>
        <label class="checkbox" title="현재 캐릭터의 권한대로만 표시">
          <input type="checkbox" data-action="toggle-pl-preview" ${previewAsPl ? "checked" : ""} ${me ? "" : "disabled"}>
          PL 시점 미리보기
        </label>
      </div>
      <div class="list">${cards}</div>
    `;
  }

  function stripMarkdown(s) {
    return String(s || "").replace(/[#*`>!\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  }

  function findHandout(id) {
    return state.data.handouts.find((h) => h.id === id) || null;
  }

  function renderEdit() {
    const editing = state.editingId ? findHandout(state.editingId) : null;
    const h = editing || { id: "", title: "", image: "", description: "", gmNotes: "", viewers: [], tags: [] };
    const viewersStr = (h.viewers || []).join(", ");
    const tagsStr = (h.tags || []).join(", ");
    return `
      <div class="field">
        <label>제목</label>
        <input type="text" data-field="title" value="${escapeHtml(h.title)}" placeholder="예: 0번 핸드아웃 - 마을의 비밀">
      </div>
      <div class="field">
        <label>이미지 URL (선택)</label>
        <input type="url" data-field="image" value="${escapeHtml(h.image)}" placeholder="https://...">
      </div>
      <div class="field">
        <label>공개 본문 (마크다운)</label>
        <textarea data-field="description" placeholder="모두 또는 viewer로 지정된 PL에게 보이는 내용">${escapeHtml(h.description)}</textarea>
        <span class="hint">**굵게** *기울임* \`코드\` [링크](url) ![이미지](url) # 제목 - 리스트 > 인용</span>
        <div class="preview" data-preview="description">${renderMarkdown(h.description)}</div>
      </div>
      <div class="field">
        <label>GM 전용 본문 (비밀)</label>
        <textarea data-field="gmNotes" placeholder="GM만 볼 수 있는 내용. 1단계에선 본인 화면 + viewer로 지정된 PL의 툴킷에서만 노출">${escapeHtml(h.gmNotes)}</textarea>
        <div class="preview" data-preview="gmNotes">${renderMarkdown(h.gmNotes)}</div>
      </div>
      <div class="field">
        <label>비밀 열람 권한 (viewers)</label>
        <input type="text" data-field="viewers" value="${escapeHtml(viewersStr)}" placeholder="캐릭터명을 콤마로 구분. * 입력 시 전체 공개">
        <span class="hint">예: 김탐정, 이조수 / 전체 공개는 *</span>
      </div>
      <div class="field">
        <label>태그 (선택)</label>
        <input type="text" data-field="tags" value="${escapeHtml(tagsStr)}" placeholder="콤마로 구분">
      </div>
      <div class="row">
        <button class="btn" data-action="save-handout">${editing ? "변경 저장" : "핸드아웃 만들기"}</button>
        <button class="btn secondary" data-action="cancel-edit">취소</button>
        ${editing ? `<span class="spacer" style="flex:1"></span><button class="btn danger" data-action="delete-handout" data-id="${escapeHtml(editing.id)}">삭제</button>` : ""}
      </div>
    `;
  }

  function renderSettings() {
    return `
      <div class="field">
        <label>내 캐릭터명 (PL 시점 판정용)</label>
        <input type="text" data-field="myCharacter" value="${escapeHtml(state.data.myCharacter)}" placeholder="현재 사용 중인 캐릭터의 이름. 핸드아웃 viewers와 일치하면 비밀 열람 가능">
        <span class="hint">상단 캐릭터 드롭다운에서 고른 이름과 정확히 같게 적어주세요. (1단계는 수동 입력, 자동 감지는 2단계 예정)</span>
      </div>
      <div class="row">
        <button class="btn" data-action="save-settings">저장</button>
      </div>
      <div class="field" style="margin-top:24px;">
        <label>데이터 내보내기 / 가져오기</label>
        <div class="row">
          <button class="btn secondary small" data-action="export">JSON 내보내기</button>
          <button class="btn secondary small" data-action="import">JSON 가져오기</button>
        </div>
        <span class="hint">현재 룸(${escapeHtml(getCurrentRoomKey())})의 핸드아웃 전체. 다른 PC로 옮길 때 사용.</span>
      </div>
    `;
  }

  // ===== 이벤트 핸들러 =====
  function onShadowClick(event) {
    const tabBtn = event.target.closest(".tab");
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (action === "close") { closePanel(); return; }
    if (action === "new-handout") { state.editingId = null; setTab("edit"); return; }
    if (action === "edit-handout") { state.editingId = id; setTab("edit"); return; }
    if (action === "delete-handout") { deleteHandout(id); return; }
    if (action === "view-handout") { openDetail(id); return; }
    if (action === "show-to-players") { showToPlayersPlaceholder(id); return; }
    if (action === "save-handout") { saveHandoutFromForm(); return; }
    if (action === "cancel-edit") { state.editingId = null; setTab("list"); return; }
    if (action === "save-settings") { saveSettingsFromForm(); return; }
    if (action === "export") { exportJson(); return; }
    if (action === "import") { importJson(); return; }
    if (action === "close-detail") { closeDetail(); return; }
    if (action === "toggle-detail-secret") { toggleDetailSecret(btn); return; }
  }

  function onShadowChange(event) {
    const cb = event.target.closest('input[data-action="toggle-pl-preview"]');
    if (cb) {
      state.plPreview = !!cb.checked;
      render();
    }
  }

  // 실시간 마크다운 프리뷰
  function onShadowInput(event) {
    const ta = event.target.closest('textarea[data-field]');
    if (!ta) return;
    const field = ta.dataset.field;
    if (field !== "description" && field !== "gmNotes") return;
    const previewEl = state.shadow?.querySelector(`.preview[data-preview="${field}"]`);
    if (previewEl) previewEl.innerHTML = renderMarkdown(ta.value);
  }

  function getFieldValue(name) {
    const el = state.shadow?.querySelector(`[data-field="${name}"]`);
    return el ? (el.value || "") : "";
  }

  async function saveHandoutFromForm() {
    const title = getFieldValue("title").trim();
    if (!title) { toast("제목을 입력해주세요."); return; }
    const image = getFieldValue("image").trim();
    const description = getFieldValue("description");
    const gmNotes = getFieldValue("gmNotes");
    const viewers = getFieldValue("viewers").split(",").map((s) => s.trim()).filter(Boolean);
    const tags = getFieldValue("tags").split(",").map((s) => s.trim()).filter(Boolean);
    const id = state.editingId || uuid();
    const now = new Date().toISOString();
    const existing = state.editingId ? findHandout(state.editingId) : null;
    const handout = {
      id, title, image, description, gmNotes, viewers, tags,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    if (existing) {
      const idx = state.data.handouts.findIndex((h) => h.id === id);
      state.data.handouts[idx] = handout;
    } else {
      state.data.handouts.unshift(handout);
    }
    await saveAll(state.data);
    state.editingId = null;
    toast(existing ? "변경 저장됨" : "새 핸드아웃 추가됨");
    setTab("list");
  }

  async function saveSettingsFromForm() {
    const me = getFieldValue("myCharacter").trim();
    state.data.myCharacter = me;
    await saveAll(state.data);
    toast("설정 저장됨");
    render();
  }

  async function deleteHandout(id) {
    if (!id) return;
    if (!confirm("이 핸드아웃을 삭제할까요? 되돌릴 수 없습니다.")) return;
    state.data.handouts = state.data.handouts.filter((h) => h.id !== id);
    await saveAll(state.data);
    state.editingId = null;
    toast("삭제됨");
    setTab("list");
  }

  // ===== 상세 다이얼로그 (Roll20 핸드아웃 다이얼로그 모방) =====
  function openDetail(id) {
    const h = findHandout(id);
    if (!h) return;
    const me = state.data.myCharacter;
    const previewAsPl = state.plPreview && !!me;
    const canSecret = previewAsPl ? canViewSecret(h, me) : true;
    const hasSecret = !!(h.gmNotes && h.gmNotes.trim());
    const body = state.shadow.querySelector(".body");
    body.innerHTML = `
      <div class="row" style="margin-bottom:12px;">
        <button class="btn secondary small" data-action="close-detail">← 목록</button>
        <button class="btn secondary small" data-action="edit-handout" data-id="${escapeHtml(h.id)}">편집</button>
        <button class="btn secondary small" data-action="show-to-players" data-id="${escapeHtml(h.id)}">Show to Players</button>
        ${hasSecret && canSecret ? `<button class="btn secondary small" data-action="toggle-detail-secret" data-show="1">GM Notes 숨기기</button>` : ""}
        <span class="spacer" style="flex:1"></span>
        <span class="meta">${previewAsPl ? "PL 시점" : "GM 시점"}</span>
      </div>
      <h2 style="margin:8px 0 4px 0;">${escapeHtml(h.title || "(제목 없음)")}</h2>
      ${h.image ? `<img class="detail-img" src="${escapeHtml(h.image)}" alt="">` : ""}
      <div class="preview" style="max-height:none;">${renderMarkdown(h.description)}</div>
      ${hasSecret ? (
        canSecret
          ? `<div class="secret-block" data-secret-block="1"><div class="secret-head">🔒 GM NOTES (비밀)</div><div class="preview" style="max-height:none; background:transparent; border:0; padding:0;">${renderMarkdown(h.gmNotes)}</div></div>`
          : `<div class="hidden-secret">이 핸드아웃에는 GM 전용 정보가 있지만, 현재 캐릭터(${escapeHtml(me)})에게는 공개되지 않았습니다.</div>`
      ) : ""}
      <div class="chip-row">
        ${(h.viewers || []).map((v) => `<span class="chip">${v === "*" ? "전체 공개" : escapeHtml(v)}</span>`).join("")}
        ${(h.tags || []).map((t) => `<span class="chip">#${escapeHtml(t)}</span>`).join("")}
      </div>
    `;
  }

  function closeDetail() {
    setTab("list");
  }

  function toggleDetailSecret(btn) {
    const block = state.shadow.querySelector('[data-secret-block="1"]');
    if (!block) return;
    const show = btn.dataset.show === "1";
    block.style.display = show ? "none" : "block";
    btn.dataset.show = show ? "0" : "1";
    btn.textContent = show ? "GM Notes 보기" : "GM Notes 숨기기";
  }

  function showToPlayersPlaceholder(id) {
    const h = findHandout(id);
    if (!h) return;
    // 1단계 placeholder — 본인 화면에 상세 팝업만 뜸. 2단계에서 실제 송신 연결.
    toast("(1단계) 본인 화면에 미리보기만 표시됩니다.");
    openDetail(id);
  }

  // ===== JSON 내보내기/가져오기 =====
  function exportJson() {
    try {
      const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ccfolia-handouts-${getCurrentRoomKey()}.json`;
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
      toast("JSON 파일이 다운로드되었습니다.");
    } catch (error) {
      console.error("[handout] export failed", error);
      toast("내보내기 실패");
    }
  }

  function importJson() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.handouts)) {
          toast("JSON 형식이 올바르지 않습니다.");
          return;
        }
        if (!confirm(`현재 룸의 핸드아웃 ${state.data.handouts.length}건을 ${parsed.handouts.length}건으로 교체합니다. 진행할까요?`)) return;
        state.data = {
          handouts: parsed.handouts,
          myCharacter: typeof parsed.myCharacter === "string" ? parsed.myCharacter : state.data.myCharacter
        };
        await saveAll(state.data);
        toast("가져오기 완료");
        render();
      } catch (error) {
        console.error("[handout] import failed", error);
        toast("가져오기 실패");
      }
    });
    input.click();
  }

  // ===== 아이콘 마운트 =====
  function buildIcon() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(ICON_MARKER, "1");
    btn.title = "핸드아웃 (Capybara Toolkit)";
    btn.setAttribute("aria-label", "핸드아웃");
    btn.style.cssText = `
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 30px; height: 30px; border-radius: 8px;
      background: #1a1a1a; color: #fff; display: inline-grid; place-items: center;
      margin-left: 6px; vertical-align: middle;
      border: 1px solid rgba(255,255,255,.18);
    `;
    btn.innerHTML = JOURNAL_SVG;
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPanel(); }, true);
    return btn;
  }

  // ===== 앵커 탐색 =====
  // 1) 상단 탑바의 "내 캐릭터 목록" 토글 버튼 옆 (가장 우선)
  // 2) 상단 탑바 우측 끝
  // 3) 사이드 패널 h6 (열려 있을 때만)
  // 4) floating fallback
  const TOOLBAR_BUTTON_LABELS = [
    "내 캐릭터", "캐릭터 목록", "캐릭터",
    "My character", "My characters", "Character list", "Characters",
    "マイキャラクター", "キャラクター一覧", "キャラクター",
    "我的角色", "角色一覽", "角色一览", "角色"
  ];

  function findCharacterToolbarButton() {
    const candidates = [];
    // aria-label, title, data-testid에서 매칭
    for (const label of TOOLBAR_BUTTON_LABELS) {
      const esc = label.replace(/"/g, '\\"');
      const sel = [
        `button[aria-label*="${esc}"]`,
        `[role="button"][aria-label*="${esc}"]`,
        `button[title*="${esc}"]`,
        `[role="button"][title*="${esc}"]`
      ].join(",");
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!candidates.includes(el)) candidates.push(el);
        });
      } catch (error) { /* selector error */ }
    }
    // 상단 탑바(MuiAppBar 등) 안에 있는 것 우선
    const appbar = findTopAppBar();
    const inAppbar = candidates.find((el) => appbar?.contains(el));
    if (inAppbar) return inAppbar;
    return candidates[0] || null;
  }

  function findTopAppBar() {
    return document.querySelector("header.MuiAppBar-root")
        || document.querySelector("nav.MuiAppBar-root")
        || document.querySelector("header[role='banner']")
        || document.querySelector(".MuiAppBar-root")
        || null;
  }

  function findCharPanelH6() {
    const titles = new Set(PANEL_TITLES_MY_CHARS.map(removeSpaces));
    const h6s = Array.from(document.querySelectorAll("h6"));
    return h6s.find((h) => titles.has(removeSpaces(h.textContent))) || null;
  }

  function diagnoseAnchors() {
    const charBtn = findCharacterToolbarButton();
    const appbar = findTopAppBar();
    const h6 = findCharPanelH6();
    const report = {
      charToolbarButton: charBtn ? describe(charBtn) : null,
      topAppBar: appbar ? describe(appbar) : null,
      charPanelH6: h6 ? describe(h6) : null,
      existingIcons: Array.from(document.querySelectorAll(`[${ICON_MARKER}]`)).map(describe)
    };
    console.info("[ccf-handout] anchor diagnosis", report, { charBtn, appbar, h6 });
    return report;
  }

  function describe(el) {
    if (!el) return null;
    return {
      tag: el.tagName,
      cls: el.className && typeof el.className === "string" ? el.className.slice(0, 80) : "",
      aria: el.getAttribute?.("aria-label") || "",
      title: el.getAttribute?.("title") || "",
      text: (el.textContent || "").trim().slice(0, 40)
    };
  }

  function mountIcon() {
    if (!active) return;
    const existing = document.querySelector(`[${ICON_MARKER}]`);
    if (existing && existing.isConnected) return;

    // 1순위: 상단 탑바의 "내 캐릭터 목록" 토글 버튼 옆
    const charBtn = findCharacterToolbarButton();
    if (charBtn?.parentElement) {
      const icon = buildToolbarIcon();
      charBtn.parentElement.insertBefore(icon, charBtn.nextSibling);
      console.info("[ccf-handout] mounted next to character toolbar button");
      return;
    }
    // 2순위: 상단 탑바 우측 끝
    const appbar = findTopAppBar();
    if (appbar) {
      const icon = buildToolbarIcon();
      icon.setAttribute(ICON_MARKER, "appbar");
      appbar.appendChild(icon);
      console.info("[ccf-handout] mounted at app bar end");
      return;
    }
    // 3순위: 사이드 패널 h6
    const h6 = findCharPanelH6();
    if (h6) {
      const icon = buildIcon();
      h6.appendChild(icon);
      console.info("[ccf-handout] mounted next to side panel h6");
      return;
    }
    // 4순위: floating
    mountFloatingIcon();
    console.info("[ccf-handout] mounted as floating fallback (no anchor found)");
  }

  function buildToolbarIcon() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(ICON_MARKER, "toolbar");
    btn.title = "핸드아웃 (Capybara Toolkit)";
    btn.setAttribute("aria-label", "핸드아웃");
    btn.style.cssText = `
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 40px; height: 40px; border-radius: 50%;
      color: #fff; display: inline-grid; place-items: center;
      margin: 0 4px; vertical-align: middle;
    `;
    btn.innerHTML = JOURNAL_SVG;
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,.12)"; }, { signal });
    btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; }, { signal });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openPanel(); }, true);
    return btn;
  }

  function mountFloatingIcon() {
    if (document.querySelector(`[${ICON_MARKER}="floating"]`)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(ICON_MARKER, "floating");
    btn.title = "핸드아웃 (Capybara Toolkit) — 폴백 위치";
    btn.innerHTML = JOURNAL_SVG;
    btn.style.cssText = `
      all: unset; box-sizing: border-box; cursor: pointer; position: fixed;
      top: 64px; right: 80px; z-index: 2147483647;
      width: 42px; height: 42px; border-radius: 50%;
      background: #b53030; color: #fff; display: grid; place-items: center;
      border: 2px solid #fff; box-shadow: 0 8px 24px rgba(0,0,0,.42);
    `;
    btn.addEventListener("click", openPanel, true);
    (document.body || document.documentElement).appendChild(btn);
    registerTeardown(() => btn.remove());
  }

  // React 리렌더 대응 — body 변경 감시
  function startMountObserver() {
    if (state.mountObserver) return;
    const obs = new MutationObserver(() => {
      if (!active) return;
      mountIcon();
      // 룸 변경 감지
      const room = getCurrentRoomKey();
      if (room !== state.lastRoomKey) {
        state.lastRoomKey = room;
        loadAll().then((d) => { state.data = d; if (state.isOpen) render(); }).catch(() => {});
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    state.mountObserver = obs;
    registerTeardown(() => obs.disconnect());
  }

  // 라우트 변경 이벤트
  function bindRouteEvents() {
    const handler = () => {
      setTimeout(() => {
        mountIcon();
        const room = getCurrentRoomKey();
        if (room !== state.lastRoomKey) {
          state.lastRoomKey = room;
          loadAll().then((d) => { state.data = d; if (state.isOpen) render(); }).catch(() => {});
        }
      }, 50);
    };
    window.addEventListener("popstate", handler, { signal });
    window.addEventListener("hashchange", handler, { signal });
    window.addEventListener("capybara-toolkit:route-change", handler, { signal });
  }

  // ===== 초기화 =====
  function init() {
    console.info("[ccf-handout] init — version 0.1.1");
    bindRouteEvents();
    startMountObserver();
    // 최초 + 지연 재시도 (React 렌더 늦을 수 있음)
    mountIcon();
    [200, 600, 1500, 3000].forEach((ms) => {
      setTimeout(() => { if (active) mountIcon(); }, ms);
    });
    // 데이터 사전 로드
    loadAll().then((d) => { state.data = d; }).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
