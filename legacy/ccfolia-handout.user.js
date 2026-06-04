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
  // 사용자 제공 PNG(assets/handout-icon.png) 형태를 SVG로 재현.
  // 투명 배경, currentColor로 다크/라이트 자동 적응, MUI IconButton 표준 24px.
  const JOURNAL_ICON_HTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;pointer-events:none;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M16 4.2l.7 1.5 1.5.7-1.5.7L16 8.5l-.7-1.4-1.5-.7 1.5-.7z" fill="currentColor" stroke="none"/></svg>`;

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

  // ===== UI — 코코포리아 다크 톤, 이동/리사이즈 floating window =====
  const STYLE_CSS = `
    :host {
      all: initial;
      color: #e8e8e8;
      font-family: "Roboto","Noto Sans KR","Noto Sans JP", system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    button, input, textarea, select { font: inherit; color: inherit; }
    .container {
      position: fixed; inset: 0; z-index: 2147483646;
      pointer-events: none; display: none;
    }
    .container[data-open="1"] { display: block; }
    .panel {
      position: absolute; pointer-events: auto;
      display: flex; flex-direction: column;
      background: rgba(44, 44, 44, 0.87);
      color: #fff;
      border: 0;
      border-radius: 0;
      /* MUI elevation6 */
      box-shadow:
        0px 3px 5px -1px rgba(0,0,0,0.20),
        0px 6px 10px 0px rgba(0,0,0,0.14),
        0px 1px 18px 0px rgba(0,0,0,0.12);
      overflow: hidden;
      min-width: 320px; min-height: 240px;
      backdrop-filter: blur(2px);
    }
    /* MUI AppBar colorTransparent + Toolbar dense */
    header {
      padding: 0 8px 0 16px;
      min-height: 48px;
      background: transparent;
      border: 0;
      display: flex; align-items: center; gap: 8px;
      cursor: move; user-select: none;
      flex: 0 0 auto;
    }
    header.dragging { cursor: grabbing; }
    /* MUI Typography subtitle2 */
    header h1 {
      margin: 0; font-size: 0.875rem; font-weight: 500; line-height: 1.57;
      color: #fff; letter-spacing: .00714em;
    }
    header .meta { font-size: 11px; color: rgba(255,255,255,.55); }
    header .spacer { flex: 1; }
    /* MUI IconButton sizeSmall */
    header .header-btn {
      all: unset; box-sizing: border-box; cursor: pointer;
      padding: 5px; border-radius: 50%;
      display: inline-grid; place-items: center; color: #fff;
      transition: background-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    header .header-btn:hover { background: rgba(255,255,255,.08); }
    header .header-btn.edge-end { margin-right: -3px; }
    .tabs {
      display: flex; gap: 0; padding: 0; background: transparent;
      border-bottom: 1px solid rgba(255,255,255,.12); flex: 0 0 auto;
    }
    .tab {
      padding: 9px 16px; border: 0; background: transparent; cursor: pointer;
      font-size: 0.8125rem; font-weight: 500; color: rgba(255,255,255,.7);
      border-bottom: 2px solid transparent; letter-spacing: .02857em;
      transition: color 150ms cubic-bezier(0.4,0,0.2,1), background-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    .tab:hover { color: #fff; background: rgba(255,255,255,.04); }
    .tab[data-active="1"] { color: #fff; border-bottom-color: #fff; }
    .body { overflow: auto; padding: 0; flex: 1; background: transparent; }
    .body-pad { padding: 14px; }
    .body::-webkit-scrollbar { width: 10px; }
    .body::-webkit-scrollbar-track { background: transparent; }
    .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 6px; }
    .body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.22); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .field label {
      font-size: 12px; font-weight: 400; color: rgba(255,255,255,.7);
      letter-spacing: .00938em;
    }
    .field input[type="text"], .field textarea, .field input[type="url"] {
      padding: 8.5px 14px; border: 1px solid rgba(255,255,255,.23); border-radius: 4px;
      background: transparent; color: #fff;
      font-size: 1rem; width: 100%; resize: vertical;
      transition: border-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    .field input[type="text"]:hover, .field textarea:hover, .field input[type="url"]:hover {
      border-color: #fff;
    }
    .field input[type="text"]:focus, .field textarea:focus, .field input[type="url"]:focus {
      outline: none; border-color: #fff; border-width: 2px; padding: 7.5px 13px;
    }
    .field textarea { min-height: 110px; line-height: 1.5; font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 0.875rem; }
    .field .hint { font-size: 0.75rem; color: rgba(255,255,255,.5); margin: 3px 14px 0; }
    /* MUI Button contained */
    .btn {
      height: 36.5px; padding: 0 16px; border: 0; border-radius: 4px;
      background: #fff; color: rgba(0,0,0,.87); cursor: pointer;
      font-size: 0.875rem; font-weight: 500; letter-spacing: .02857em; text-transform: uppercase;
      transition: background-color 250ms cubic-bezier(0.4,0,0.2,1), box-shadow 250ms;
      box-shadow: 0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);
    }
    .btn:hover { background: #e0e0e0; box-shadow: 0 2px 4px -1px rgba(0,0,0,.2), 0 4px 5px 0 rgba(0,0,0,.14), 0 1px 10px 0 rgba(0,0,0,.12); }
    .btn.secondary { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.5); box-shadow: none; }
    .btn.secondary:hover { background: rgba(255,255,255,.08); border-color: #fff; box-shadow: none; }
    .btn.danger { background: transparent; color: #f44336; border: 1px solid rgba(244,67,54,.5); box-shadow: none; }
    .btn.danger:hover { background: rgba(244,67,54,.08); border-color: #f44336; box-shadow: none; }
    .btn.small { height: 30.75px; padding: 0 10px; font-size: 0.8125rem; }
    .btn[disabled] { opacity: .38; cursor: default; pointer-events: none; }
    /* MUI List dense — 카드는 ListItem 톤 */
    .list { display: flex; flex-direction: column; }
    .card {
      border: 0; border-radius: 0; padding: 8px 16px;
      background: transparent;
      border-bottom: 1px solid rgba(255,255,255,.08);
      transition: background-color 150ms cubic-bezier(0.4,0,0.2,1);
      cursor: default;
    }
    .card:hover { background: rgba(255,255,255,.04); }
    .card .head { display: flex; align-items: center; gap: 10px; }
    .card .title { font-size: 0.875rem; font-weight: 500; flex: 1; color: #fff; line-height: 1.43; }
    .card .badge {
      font-size: 0.6875rem; padding: 2px 8px; border-radius: 4px;
      border: 0; color: rgba(255,255,255,.7); background: rgba(255,255,255,.08);
      letter-spacing: .02em; font-weight: 500;
    }
    .card .badge.secret { background: rgba(244,67,54,.18); color: #ff8a80; }
    .card .summary { margin-top: 4px; font-size: 0.8125rem; color: rgba(255,255,255,.6); max-height: 40px; overflow: hidden; line-height: 1.43; }
    .card .actions { margin-top: 8px; display: flex; gap: 4px; flex-wrap: wrap; }
    .empty { padding: 56px 16px; text-align: center; color: rgba(255,255,255,.4); font-size: 0.875rem; }
    .preview {
      border: 1px solid rgba(255,255,255,.12); border-radius: 4px; padding: 12px;
      background: rgba(0,0,0,.25); margin-top: 6px;
      max-height: 220px; overflow: auto; font-size: 0.875rem; line-height: 1.6; color: rgba(255,255,255,.92);
    }
    .preview img.cch-img { max-width: 100%; height: auto; display: block; margin: 6px 0; border-radius: 6px; }
    .preview a { color: #82b1ff; }
    .preview blockquote { border-left: 3px solid rgba(255,255,255,.18); margin: 6px 0; padding: 2px 12px; color: #b9b9c1; }
    .preview h1 { font-size: 18px; margin: 8px 0; color: #fff; }
    .preview h2 { font-size: 16px; margin: 7px 0; color: #fff; }
    .preview h3 { font-size: 14px; margin: 6px 0; color: #fff; }
    .preview code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 90%; }
    .preview hr { border: 0; border-top: 1px solid rgba(255,255,255,.1); margin: 8px 0; }
    .preview ul { padding-left: 20px; margin: 4px 0; }
    .preview strong { color: #fff; }
    /* 상세 다이얼로그 (핸드아웃 1장 열람) */
    .detail-img { width: 100%; max-height: 280px; object-fit: cover; border-radius: 4px; margin-bottom: 14px; background: rgba(0,0,0,.25); }
    .secret-block {
      margin-top: 14px; border: 1px dashed rgba(244,67,54,.5); border-radius: 4px;
      padding: 12px 14px; background: rgba(244,67,54,.06);
    }
    .secret-block .secret-head {
      font-size: 0.75rem; font-weight: 500; color: #ff8a80; margin-bottom: 8px; letter-spacing: .08em; text-transform: uppercase;
    }
    .hidden-secret {
      margin-top: 14px; border: 1px dashed rgba(255,255,255,.18); border-radius: 4px;
      padding: 18px; background: rgba(255,255,255,.03);
      color: rgba(255,255,255,.5); text-align: center; font-size: 0.8125rem;
    }
    .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .chip {
      font-size: 0.75rem; padding: 3px 10px; border-radius: 4px;
      background: rgba(255,255,255,.08); color: rgba(255,255,255,.85); font-weight: 500;
    }
    /* MUI Snackbar */
    .toast {
      position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
      background: rgba(50,50,50,1); color: #fff; padding: 6px 16px; border-radius: 4px;
      font-size: 0.875rem; font-weight: 400; line-height: 1.43;
      box-shadow: 0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px 0 rgba(0,0,0,.14), 0 1px 18px 0 rgba(0,0,0,.12);
      opacity: 0; transition: opacity 195ms cubic-bezier(0.4,0,0.2,1), transform 195ms cubic-bezier(0.4,0,0.2,1);
      pointer-events: none; z-index: 10;
    }
    .toast[data-visible="1"] { opacity: 1; transform: translateX(-50%) translateY(-2px); }
    .checkbox {
      display: inline-flex; gap: 6px; align-items: center;
      font-size: 0.875rem; color: rgba(255,255,255,.7); cursor: pointer;
    }
    .checkbox input { accent-color: #fff; }
    /* 리사이즈 핸들 (우하단 코너) */
    .resize-handle {
      position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
      cursor: nwse-resize; touch-action: none;
      background-image: linear-gradient(135deg, transparent 0%, transparent 50%, rgba(255,255,255,.18) 50%, rgba(255,255,255,.18) 60%, transparent 60%, transparent 70%, rgba(255,255,255,.18) 70%, rgba(255,255,255,.18) 80%, transparent 80%);
      z-index: 5;
    }
    @media (prefers-color-scheme: light) {
      :host { color: #1a1a1a; }
      .panel { background: #ffffff; border-color: rgba(0,0,0,.12); }
      header { background: #f5f5f7; border-color: rgba(0,0,0,.08); }
      header h1 { color: #1a1a1a; }
      header .meta { color: #6e6e75; }
      header .close { color: #555; }
      header .close:hover { background: rgba(0,0,0,.06); color: #111; }
      .tabs { background: #fafafa; border-color: rgba(0,0,0,.08); }
      .tab { color: #6e6e75; }
      .tab[data-active="1"] { color: #111; border-bottom-color: #111; }
      .body { background: #ffffff; }
      .field label { color: #555; }
      .field input, .field textarea { background: #fafafa; border-color: rgba(0,0,0,.12); color: #1a1a1a; }
      .field .hint { color: #888; }
      .btn { background: #1a1a1a; color: #fff; }
      .btn:hover { background: #000; }
      .btn.secondary { background: rgba(0,0,0,.06); color: #1a1a1a; }
      .btn.secondary:hover { background: rgba(0,0,0,.12); }
      .card { background: #fafafa; border-color: rgba(0,0,0,.08); }
      .card:hover { background: #f0f0f0; }
      .card .title { color: #1a1a1a; }
      .card .summary { color: #666; }
      .card .badge { color: #666; border-color: rgba(0,0,0,.16); }
      .preview { background: #fafafa; border-color: rgba(0,0,0,.08); color: #1a1a1a; }
      .preview strong { color: #000; }
      .preview a { color: #1763b8; }
      .preview blockquote { color: #555; border-color: rgba(0,0,0,.18); }
      .preview code { background: rgba(0,0,0,.06); }
      .secret-block { background: rgba(239,83,80,.06); border-color: rgba(239,83,80,.4); }
      .secret-block .secret-head { color: #c62828; }
      .hidden-secret { background: rgba(0,0,0,.03); color: #888; border-color: rgba(0,0,0,.18); }
      .chip { background: rgba(0,0,0,.06); color: #555; }
      .checkbox { color: #555; }
      .toast { background: #1a1a1a; color: #fff; }
      .resize-handle {
        background-image: linear-gradient(135deg, transparent 0%, transparent 50%, rgba(0,0,0,.2) 50%, rgba(0,0,0,.2) 60%, transparent 60%, transparent 70%, rgba(0,0,0,.2) 70%, rgba(0,0,0,.2) 80%, transparent 80%);
      }
    }
  `;

  function ensureRoot() {
    if (state.root && state.shadow) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${STYLE_CSS}</style>
      <div class="container" data-open="0">
        <section class="panel" role="dialog" aria-label="핸드아웃" data-rect-applied="0">
          <header data-drag-handle="1">
            <h1>핸드아웃</h1>
            <span class="meta"></span>
            <span class="spacer"></span>
            <button class="header-btn" data-action="new-handout" title="추가" aria-label="추가">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <button class="header-btn edge-end" data-action="close" title="닫기" aria-label="닫기">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </header>
          <div class="tabs">
            <button class="tab" data-tab="list" data-active="1">목록</button>
            <button class="tab" data-tab="edit" data-active="0">새로 만들기</button>
            <button class="tab" data-tab="settings" data-active="0">설정</button>
          </div>
          <div class="body"></div>
          <div class="toast" aria-live="polite"></div>
          <div class="resize-handle" data-resize-handle="1" title="크기 조절"></div>
        </section>
      </div>
    `;
    (document.body || document.documentElement).appendChild(root);
    shadow.addEventListener("click", onShadowClick);
    shadow.addEventListener("change", onShadowChange);
    shadow.addEventListener("input", onShadowInput);
    bindWindowControls(shadow);
    state.root = root;
    state.shadow = shadow;
    applyStoredRect();
    registerTeardown(() => root.remove());
  }

  // ===== floating window 위치/크기 =====
  const RECT_STORAGE_KEY = "ccf-handout:window-rect-v1";
  const DEFAULT_RECT = { w: 720, h: 560 };

  function loadStoredRect() {
    try {
      const raw = localStorage.getItem(RECT_STORAGE_KEY);
      if (!raw) return null;
      const r = JSON.parse(raw);
      if (typeof r?.x !== "number" || typeof r?.y !== "number" || typeof r?.w !== "number" || typeof r?.h !== "number") return null;
      return r;
    } catch (error) { return null; }
  }

  function saveRect(rect) {
    try { localStorage.setItem(RECT_STORAGE_KEY, JSON.stringify(rect)); }
    catch (error) { /* quota */ }
  }

  function clampRectToViewport(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(Math.max(rect.w, 360), Math.max(360, vw - 20));
    const h = Math.min(Math.max(rect.h, 280), Math.max(280, vh - 20));
    const x = Math.min(Math.max(rect.x, 10), Math.max(10, vw - w - 10));
    const y = Math.min(Math.max(rect.y, 10), Math.max(10, vh - h - 10));
    return { x, y, w, h };
  }

  function applyRect(rect) {
    if (!state.shadow) return;
    const panel = state.shadow.querySelector(".panel");
    if (!panel) return;
    const c = clampRectToViewport(rect);
    panel.style.left = `${c.x}px`;
    panel.style.top = `${c.y}px`;
    panel.style.width = `${c.w}px`;
    panel.style.height = `${c.h}px`;
    panel.dataset.rectApplied = "1";
  }

  function applyStoredRect() {
    const stored = loadStoredRect();
    if (stored) { applyRect(stored); return; }
    // 첫 열기 — 중앙
    const w = DEFAULT_RECT.w;
    const h = DEFAULT_RECT.h;
    const x = Math.max(10, Math.round((window.innerWidth - w) / 2));
    const y = Math.max(10, Math.round((window.innerHeight - h) / 2));
    applyRect({ x, y, w, h });
  }

  function currentRect() {
    const panel = state.shadow?.querySelector(".panel");
    if (!panel) return null;
    return {
      x: parseFloat(panel.style.left) || 0,
      y: parseFloat(panel.style.top) || 0,
      w: parseFloat(panel.style.width) || DEFAULT_RECT.w,
      h: parseFloat(panel.style.height) || DEFAULT_RECT.h
    };
  }

  function bindWindowControls(shadow) {
    const panel = shadow.querySelector(".panel");
    if (!panel) return;

    // 드래그 (헤더)
    const header = shadow.querySelector("header[data-drag-handle]");
    let drag = null;
    header?.addEventListener("pointerdown", (e) => {
      // 닫기 버튼은 통과
      if (e.target.closest("button, input, textarea, select, a[href]")) return;
      if (e.button !== 0) return;
      const start = currentRect(); if (!start) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: start.x, oy: start.y, w: start.w, h: start.h };
      header.classList.add("dragging");
      header.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    header?.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      applyRect({ x: drag.ox + (e.clientX - drag.sx), y: drag.oy + (e.clientY - drag.sy), w: drag.w, h: drag.h });
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      header.classList.remove("dragging");
      const r = currentRect(); if (r) saveRect(r);
    };
    header?.addEventListener("pointerup", endDrag);
    header?.addEventListener("pointercancel", endDrag);

    // 리사이즈 (우하단 코너)
    const rh = shadow.querySelector("[data-resize-handle]");
    let resize = null;
    rh?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const start = currentRect(); if (!start) return;
      resize = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: start.x, y: start.y, ow: start.w, oh: start.h };
      rh.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    });
    rh?.addEventListener("pointermove", (e) => {
      if (!resize || e.pointerId !== resize.id) return;
      applyRect({ x: resize.x, y: resize.y, w: resize.ow + (e.clientX - resize.sx), h: resize.oh + (e.clientY - resize.sy) });
    });
    const endResize = (e) => {
      if (!resize || e.pointerId !== resize.id) return;
      resize = null;
      const r = currentRect(); if (r) saveRect(r);
    };
    rh?.addEventListener("pointerup", endResize);
    rh?.addEventListener("pointercancel", endResize);

    // 뷰포트 리사이즈 시 잘림 보정
    window.addEventListener("resize", () => {
      if (!state.isOpen) return;
      const r = currentRect(); if (r) applyRect(r);
    }, { signal });
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

  function togglePanel() {
    if (state.isOpen) closePanel(); else openPanel();
  }

  function setTab(tab) {
    state.activeTab = tab;
    if (tab !== "edit") state.editingId = null;
    render();
  }

  function render() {
    if (!state.shadow) return;
    const bd = state.shadow.querySelector(".container");
    bd.setAttribute("data-open", state.isOpen ? "1" : "0");
    const meta = state.shadow.querySelector("header .meta");
    meta.textContent = `룸: ${getCurrentRoomKey()} · 내 캐릭터: ${state.data.myCharacter || "(미설정)"} · ${state.data.handouts.length}건`;
    state.shadow.querySelectorAll(".tab").forEach((t) => {
      t.setAttribute("data-active", t.dataset.tab === state.activeTab ? "1" : "0");
    });
    const body = state.shadow.querySelector(".body");
    let inner;
    if (state.activeTab === "list") inner = renderList();
    else if (state.activeTab === "edit") inner = renderEdit();
    else inner = renderSettings();
    body.innerHTML = `<div class="body-pad">${inner}</div>`;
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
      width: 32px; height: 32px; border-radius: 50%;
      color: currentColor; display: inline-grid; place-items: center;
      margin-left: 4px; vertical-align: middle;
    `;
    btn.innerHTML = JOURNAL_ICON_HTML;
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); togglePanel(); }, true);
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
    // MUI IconButton 매치 — 40x40 hit, 24 icon, color inherits from app bar
    btn.style.cssText = `
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 40px; height: 40px; border-radius: 50%;
      color: inherit; display: inline-grid; place-items: center;
      margin: 0 2px; vertical-align: middle;
      transition: background-color 120ms ease;
    `;
    btn.innerHTML = JOURNAL_ICON_HTML;
    btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(255,255,255,.1)"; }, { signal });
    btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; }, { signal });
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); togglePanel(); }, true);
    return btn;
  }

  function mountFloatingIcon() {
    if (document.querySelector(`[${ICON_MARKER}="floating"]`)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(ICON_MARKER, "floating");
    btn.title = "핸드아웃 (Capybara Toolkit) — 폴백 위치";
    btn.innerHTML = JOURNAL_ICON_HTML;
    btn.style.cssText = `
      all: unset; box-sizing: border-box; cursor: pointer; position: fixed;
      top: 64px; right: 80px; z-index: 2147483647;
      width: 44px; height: 44px; border-radius: 50%;
      background: #b53030; color: #fff; display: grid; place-items: center;
      border: 2px solid #fff; box-shadow: 0 8px 24px rgba(0,0,0,.42);
    `;
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); togglePanel(); }, true);
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

  // ESC로 패널 닫기
  function bindGlobalKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.isOpen) {
        // 채팅 등 입력 중일 땐 무시
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
          // 단, 우리 shadow 안에서의 ESC는 닫기
          if (!state.root?.contains(active) && active.getRootNode?.() !== state.shadow) return;
        }
        closePanel();
      }
    }, { signal });
  }

  // ===== 초기화 =====
  function init() {
    console.info("[ccf-handout] init — version 0.1.2 (floating window)");
    bindRouteEvents();
    bindGlobalKeys();
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
