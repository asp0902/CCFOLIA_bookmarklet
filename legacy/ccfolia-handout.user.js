// ==UserScript==
// @name         CCFOLIA Handout by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-handout
// @version      0.1.43
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
  const CHAT_AUTHOR_ITEM_SELECTOR = "li.MuiListItem-root, [role='listitem'], .MuiListItem-root";
  const CHAT_AUTHOR_HEADING_SELECTOR = [
    "h6.MuiListItemText-primary",
    ".MuiListItemText-primary h6",
    ".MuiListItemText-root h6",
    "h6"
  ].join(", ");
  const CHAT_AUTHOR_SCOPE_SELECTOR = "[role='log'], [aria-live='polite'], [aria-live='assertive'], .MuiDrawer-paper, ul.MuiList-root, [role='list']";
  const CHAT_DRAWER_TITLE_RE = /룸\s*채팅|room\s*chat|チャット|chat/i;
  const CHAT_AUTHOR_IGNORE_RE = /^(?:룸\s*채팅|room\s*chat|chat|チャット|내\s*캐릭터\s*(?:목록|리스트)?|my\s*characters?|character\s*list|characters?)$/i;
  const CHAT_AUTHOR_CANDIDATE_LIMIT = 12;
  const CHAT_AUTHOR_BOTTOM_THRESHOLD_PX = 80;

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
    showGreeting() { maybeShowGreeting(); },
    resetGreetingFlags() { return clearGreetingFlags(); },
    forceGreeting() { clearGreetingFlags(); maybeShowGreeting(); },
    fb() { return fbState; },
    initFirebase() { return initFirebase(); },
    pushHandout(id) {
      const h = state.data.handouts.find((x) => x.id === id);
      if (!h) return Promise.reject(new Error("not found"));
      return pushHandoutToFirestore(h);
    },
    fetchAll() { return fetchAllFromFirestore(); },
    subscribe() {
      return Promise.all([subscribeToRoomHandouts(), subscribeToRoomShows()]);
    },
    unsubscribe() {
      try { unsubHandouts?.(); } catch (_) {}
      try { unsubShows?.(); } catch (_) {}
      unsubHandouts = null; unsubShows = null;
      subscribedRoom = null;
    },
    sendShow(handoutId, audience) { return sendShowSignal(handoutId, audience || "all"); },
    state() {
      return {
        myCharacter: state.data.myCharacter,
        plList: state.data.plList,
        myCharacterOptions: state.myCharacterOptions,
        visibleCharacter: getVisibleCharacterName(),
        adminMode: isAdminMode(),
        handoutCount: state.data.handouts.length,
        editingId: state.editingId,
        activeTab: state.activeTab,
        isOpen: state.isOpen,
        room: getCurrentRoomKey(),
        firebase: fbState ? { uid: fbState.uid } : null,
        subscribed: subscribedRoom
      };
    },
    autoDetect(force) { return autoDetectMyCharacter({ force: !!force }); },
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
      return { handouts: [], myCharacter: "", myCharacterOptions: [], plList: [] };
    }
    const record = await tk.storage.getRoomData(STORAGE_FEATURE, getCurrentRoomKey());
    const value = record?.value;
    if (!value || typeof value !== "object") return { handouts: [], myCharacter: "", plList: [] };
    const handouts = Array.isArray(value.handouts) ? value.handouts.map(ensurePermissions) : [];
    ensureOrderField(handouts);
    return {
      handouts,
      myCharacter: typeof value.myCharacter === "string" ? value.myCharacter : "",
      myCharacterOptions: Array.isArray(value.myCharacterOptions)
        ? [...new Set(value.myCharacterOptions.map((name) => String(name || "").trim()).filter(Boolean))]
        : [],
      plList: normalizePlList(value.plList)
    };
  }

  function normalizePlList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
      if (typeof item === "string") return { name: item.trim(), id: "", role: "player", aliases: [] };
      if (item && typeof item === "object") {
        const name = String(item.name || "").trim();
        const aliases = Array.isArray(item.aliases)
          ? item.aliases.map((alias) => String(alias || "").trim()).filter((alias) => alias && alias !== name)
          : [];
        return {
          name,
          id: String(item.id || "").trim(),
          role: item.role === "gm" ? "gm" : "player",
          aliases: [...new Set(aliases)]
        };
      }
      return null;
    }).filter((p) => p && p.name);
  }

  async function saveAll(data) {
    const tk = toolkit();
    if (!tk?.storage?.setRoomData) return;
    const payload = {
      ...data,
      myCharacterOptions: Array.isArray(state.myCharacterOptions)
        ? state.myCharacterOptions
        : (Array.isArray(data?.myCharacterOptions) ? data.myCharacterOptions : [])
    };
    await tk.storage.setRoomData(STORAGE_FEATURE, getCurrentRoomKey(), payload);
  }

  // ===== state =====
  const state = {
    isOpen: false,
    activeTab: "list",      // list | new | settings
    editingId: null,        // 편집 중인 handout id
    plPreview: false,       // PL 시점 미리보기 토글
    data: { handouts: [], myCharacter: "", myCharacterOptions: [], plList: [] },
    formPermissions: {},    // 편집 폼의 임시 권한 상태 — 저장 시 반영
    myCharacterOptions: [], // 설정 탭 드롭다운 옵션 (캐릭터 패널 스캔 결과)
    chatWatcher: null,      // 채팅 발신자 감시 MutationObserver
    chatScanScheduled: 0,
    chatPendingItems: new Set(),
    chatSeenAuthors: new Set(), // 룸별 중복 처리 방지 (메모리)
    chatSeenRoom: getCurrentRoomKey(),
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
  const escapeAttr = escapeHtml;

  function removeSpaces(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // ===== 간소 마크다운 렌더러 =====
  // bold **x**, italic *x*, code `x`, link [t](u), image ![](u) and [image]u,
  // heading # ## ###, list -, quote >, hr ---, line break
  // 핸드아웃 본문 렌더 — HTML 마크업(태그)으로 시작하면 그대로 사용 (contenteditable WYSIWYG 으로 편집된 본문),
  // 그렇지 않으면 기존 마크다운 렌더 (legacy 호환).
  function renderHandoutBody(src) {
    if (!src) return "";
    const t = String(src).trim();
    if (/^<(p|div|h[1-6]|ul|ol|li|blockquote|br|hr|img|span|b|i|u|s|strong|em|code|pre|a|font)\b/i.test(t)) {
      return t;
    }
    return renderMarkdown(src);
  }

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

  // ===== 정렬 모델 =====
  // 각 핸드아웃에 order: number. ORDER_STEP 간격으로 부여 → 중간 삽입 시 (prev + next) / 2.
  const ORDER_STEP = 1000;

  // 누락된 order 필드 채워넣기 — 현재 배열 인덱스 순서대로 ORDER_STEP 간격 부여.
  // 이미 order 가진 핸드아웃은 그대로 두고, 누락된 항목만 max + ORDER_STEP 로 뒤에 붙임.
  function ensureOrderField(handouts) {
    if (!Array.isArray(handouts)) return handouts;
    // 1차: 이미 유효한 order 가진 항목 분리
    let maxOrder = -Infinity;
    for (const h of handouts) {
      if (h && Number.isFinite(h.order)) {
        if (h.order > maxOrder) maxOrder = h.order;
      }
    }
    if (!Number.isFinite(maxOrder)) maxOrder = -ORDER_STEP; // 비어있으면 첫 항목이 0 부터 시작하지 않게
    // 2차: order 누락된 항목에 현재 배열 순서대로 뒤에 붙이기
    for (const h of handouts) {
      if (!h) continue;
      if (Number.isFinite(h.order)) continue;
      maxOrder += ORDER_STEP;
      h.order = maxOrder;
    }
    return handouts;
  }

  // 새 핸드아웃 order — 현재 최대 + ORDER_STEP. 비어있으면 ORDER_STEP.
  function getNextOrder() {
    const handouts = Array.isArray(state.data?.handouts) ? state.data.handouts : [];
    let max = -Infinity;
    for (const h of handouts) {
      if (h && Number.isFinite(h.order) && h.order > max) max = h.order;
    }
    return Number.isFinite(max) ? max + ORDER_STEP : ORDER_STEP;
  }

  function compareByOrder(a, b) {
    const ao = Number.isFinite(a?.order) ? a.order : 0;
    const bo = Number.isFinite(b?.order) ? b.order : 0;
    return ao - bo;
  }

  // ===== 권한 모델 =====
  // handout.permissions = { "<name|*>": { view, secret, edit } }
  // "*" = 플레이어 전체
  const PERM_COLS = ["view", "secret", "edit"];
  const ALL_KEY = "*";

  function ensurePermissions(h) {
    if (!h.permissions || typeof h.permissions !== "object") h.permissions = {};
    // 레거시 viewers 배열 → secret 권한자로 마이그레이션
    if (Array.isArray(h.viewers)) {
      for (const v of h.viewers) {
        if (!v) continue;
        const key = String(v).trim();
        if (!key) continue;
        if (!h.permissions[key]) h.permissions[key] = { view: false, secret: true, edit: false };
      }
    }
    return h;
  }

  function permFlag(h, key, col) {
    const p = h?.permissions?.[key];
    return !!p?.[col];
  }

  function canView(h, name) {
    if (!h) return false;
    if (permFlag(h, ALL_KEY, "view")) return true;
    if (!name) return false;
    return permFlag(h, name, "view");
  }
  function canViewSecret(h, name) {
    if (!h) return false;
    if (permFlag(h, ALL_KEY, "secret")) return true;
    if (!name) return false;
    return permFlag(h, name, "secret");
  }
  function canEdit(h, name) {
    if (!h) return false;
    if (permFlag(h, ALL_KEY, "edit")) return true;
    if (!name) return false;
    return permFlag(h, name, "edit");
  }

  // PL 1명에 대해 전체 핸드아웃 통틀어 view/secret/edit 권한 한 번이라도 받은 적 있는지 집계.
  // 대표 이름 + aliases 모두 검사. "*" (전체 공개) 도 점등 대상.
  function aggregatePermissionsForPl(pl) {
    const result = { view: false, secret: false, edit: false };
    if (!pl) return result;
    const handouts = Array.isArray(state.data?.handouts) ? state.data.handouts : [];
    if (!handouts.length) return result;
    const keys = [];
    if (pl.name) keys.push(String(pl.name));
    if (Array.isArray(pl.aliases)) {
      for (const a of pl.aliases) {
        const s = a == null ? "" : String(a);
        if (s && !keys.includes(s)) keys.push(s);
      }
    }
    for (const h of handouts) {
      for (const col of PERM_COLS) {
        if (result[col]) continue;
        if (permFlag(h, ALL_KEY, col)) { result[col] = true; continue; }
        for (const key of keys) {
          if (permFlag(h, key, col)) { result[col] = true; break; }
        }
      }
      if (result.view && result.secret && result.edit) break;
    }
    return result;
  }

  function getVisibleCharacterName() {
    const inputs = Array.from(document.querySelectorAll('input[name="name"]'));
    const visible = inputs.find((i) => i instanceof HTMLInputElement && i.offsetParent !== null && !i.disabled);
    return (visible?.value || "").trim();
  }

  function isAdminCharacter(name = getVisibleCharacterName()) {
    const admin = removeSpaces(state.data.myCharacter || "");
    if (!admin) return true;
    return removeSpaces(name || "") === admin;
  }

  function isAdminMode() {
    return isAdminCharacter();
  }

  function canManageHandout(handout) {
    return !!handout && isAdminMode();
  }

  function getPermissionCharacterName() {
    const visible = getVisibleCharacterName();
    if (isAdminCharacter(visible)) return state.data.myCharacter || visible;
    return visible || state.data.myCharacter || "";
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
      background-color: rgba(44, 44, 44, 0.87);
      color: rgba(255, 255, 255, 1);
      border: 0;
      border-radius: 0;
      /* MUI elevation6 */
      box-shadow:
        0px 3px 5px -1px rgba(0,0,0,0.20),
        0px 6px 10px 0px rgba(0,0,0,0.14),
        0px 1px 18px 0px rgba(0,0,0,0.12);
      overflow: hidden;
      min-width: 320px; min-height: 240px;
    }
    /* MUI AppBar + Toolbar dense */
    header {
      padding: 0 8px 0 16px;
      min-height: 48px;
      background-color: #212121;
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
      display: flex; gap: 0; padding: 0; background-color: #212121;
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
    .body-pad { padding: 20px 24px 24px; }
    .body-pad[data-tab="list"] {
      padding: 20px 0 9px;
      display: flex; flex-direction: column;
      min-height: 100%;
    }
    /* 목록 탭: PL 시점 미리보기 토글 — 푸터(.panel-footer) 바로 위 우하단에 위치 */
    .list-pl-preview-bar {
      margin-top: auto;
      position: sticky; bottom: 0;
      display: flex; justify-content: flex-end;
      padding: 8px 16px 4px 0;
      background: transparent;
    }
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
    /* ===== 편집 화면 (이미지 모방) ===== */
    .handout-edit-header {
      display: flex; align-items: center; gap: 4px; margin-bottom: 18px;
    }
    .handout-edit-header .title-input {
      flex: 1; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.18); border-radius: 4px;
      color: #fff; font-size: 0.875rem; padding: 8px 12px;
      transition: border-color 150ms cubic-bezier(0.4,0,0.2,1), background-color 150ms;
    }
    .handout-edit-header .title-input::placeholder { color: rgba(255,255,255,.4); }
    .handout-edit-header .title-input:hover { border-color: rgba(255,255,255,.4); }
    .handout-edit-header .title-input:focus { outline: none; border-color: #fff; background: rgba(0,0,0,.5); }
    .handout-edit-header .action-icon {
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 36px; height: 36px; border-radius: 4px;
      color: #fff; display: inline-grid; place-items: center;
      transition: background-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    .handout-edit-header .action-icon:hover { background: rgba(255,255,255,.1); }
    .handout-edit-cols {
      display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px;
    }
    .handout-edit-cols .col label {
      display: block; font-size: 0.9375rem; font-weight: 500; color: #fff;
      margin-bottom: 8px; margin-left: 3px;
    }
    .handout-edit-cols .col .rich-editor {
      width: 100%; min-height: 140px; max-height: 480px; overflow: auto; resize: vertical;
      background: rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.18); border-radius: 4px;
      padding: 6px 10px; color: #fff;
      font-family: "Noto Sans KR", "Noto Sans JP", "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif;
      font-size: 0.875rem; line-height: 1.45;
      transition: border-color 150ms cubic-bezier(0.4,0,0.2,1);
      cursor: text;
    }
    .handout-edit-cols .col .rich-editor:hover { border-color: rgba(255,255,255,.35); }
    .handout-edit-cols .col .rich-editor:focus { outline: none; border-color: #fff; }
    /* contenteditable 블록 wrap 기본 margin 제거 — 텍스트가 너무 아래로 내려가는 문제 해결 */
    .handout-edit-cols .col .rich-editor > * { margin-top: 0; }
    .handout-edit-cols .col .rich-editor > *:first-child { margin-top: 0; }
    .handout-edit-cols .col .rich-editor p,
    .handout-edit-cols .col .rich-editor div { margin: 0; }
    .handout-edit-cols .col .rich-editor h1 { font-size: 1.25rem; margin: 4px 0; color: #fff; }
    .handout-edit-cols .col .rich-editor h2 { font-size: 1.125rem; margin: 4px 0; color: #fff; }
    .handout-edit-cols .col .rich-editor h3 { font-size: 1rem; margin: 4px 0; color: #fff; }
    .handout-edit-cols .col .rich-editor blockquote {
      border-left: 3px solid rgba(255,255,255,.2); padding: 2px 12px;
      color: rgba(255,255,255,.8); margin: 4px 0;
    }
    .handout-edit-cols .col .rich-editor code {
      background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 4px;
      font-family: ui-monospace, Consolas, monospace; font-size: 90%;
    }
    .handout-edit-cols .col .rich-editor hr {
      border: 0; border-top: 1px solid rgba(255,255,255,.18); margin: 8px 0;
    }
    .handout-edit-cols .col .rich-editor a { color: #82b1ff; }
    .handout-edit-cols .col .rich-editor img { max-width: 100%; height: auto; }
    .handout-edit-cols .col .rich-editor ul { padding-left: 20px; }
    .handout-edit-cols .col .rich-editor:empty::before {
      content: attr(data-placeholder); color: rgba(255,255,255,.4); pointer-events: none;
    }
    /* #40 — 공개 본문 마크다운 서식 툴바 */
    .handout-format-toolbar {
      display: flex; flex-wrap: wrap; align-items: center;
      gap: 2px; margin-top: -8px; margin-bottom: 4px;
      padding: 2px 4px;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 4px;
    }
    .ft-btn {
      all: unset; box-sizing: border-box;
      cursor: pointer;
      min-width: 28px; height: 26px;
      padding: 0 6px;
      display: inline-grid; place-items: center;
      color: rgba(255,255,255,.7);
      font-size: 0.8125rem; font-weight: 600;
      border-radius: 3px;
      transition: background-color 120ms, color 120ms;
    }
    .ft-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
    .ft-btn:active { background: rgba(255,255,255,.14); }
    .ft-btn code { font-family: ui-monospace, Consolas, monospace; font-size: 0.6875rem; }
    .ft-color-btn {
      position: relative; overflow: hidden;
    }
    .ft-color-btn > span {
      font-weight: 700;
      border-bottom: 2px solid currentColor;
      padding-bottom: 1px;
    }
    .ft-color-btn input[type="color"] {
      position: absolute; inset: 0; opacity: 0; cursor: pointer;
      border: 0; padding: 0; background: transparent;
    }
    .ft-sep {
      width: 1px; align-self: stretch; margin: 2px 4px;
      background: rgba(255,255,255,.1);
    }
    .ft-target-hint {
      margin-left: auto;
      padding: 0 8px;
      font-size: 0.6875rem;
      color: rgba(255,255,255,.45);
      letter-spacing: .02em;
      white-space: nowrap;
    }
    .ft-target-hint.active {
      color: #82b1ff;
    }
    textarea[data-format-receiver="1"]:focus {
      box-shadow: inset 0 0 0 1px rgba(130,177,255,.4);
    }
    .perm-section { margin-top: 8px; }
    .perm-title {
      font-size: 0.9375rem; font-weight: 700; color: #fff; margin-bottom: 14px;
    }
    .perm-grid {
      display: grid; grid-template-columns: minmax(0, 1fr) 44px 44px 44px 64px;
      gap: 4px 6px; align-items: center;
    }
    .perm-grid .head {
      font-size: 0.8125rem; color: rgba(255,255,255,.75);
      padding: 6px 0; text-align: center; font-weight: 500;
    }
    .perm-grid .head.name-col { text-align: left; padding-left: 0; }
    .perm-grid .perm-name {
      color: #fff; padding: 8px 0; font-size: 0.875rem; line-height: 1.4;
    }
    .perm-grid .perm-cell {
      display: flex; justify-content: center; align-items: center;
    }
    .perm-grid .perm-cell input[type="checkbox"] {
      width: 18px; height: 18px; accent-color: #fff; cursor: pointer; margin: 0;
    }
    .popup-btn {
      background: #c62828; color: #fff; border: 0; border-radius: 4px;
      padding: 5px 16px; font-size: 0.8125rem; font-weight: 600;
      cursor: pointer; letter-spacing: 0;
      box-shadow: 0 2px 4px rgba(0,0,0,.25);
      transition: background-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    .popup-btn:hover { background: #b71c1c; }
    .popup-btn:active { background: #8e0000; }
    .perm-hint {
      margin-top: 12px; font-size: 0.75rem; color: rgba(255,255,255,.5);
    }
    .edit-footer-actions {
      display: flex; justify-content: flex-end; gap: 8px;
      margin-top: 20px; padding-top: 14px;
      border-top: 1px solid rgba(255,255,255,.06);
    }
    /* 목록 카드 — 제목 자체가 클릭 가능한 버튼 */
    .card-title-btn {
      all: unset; box-sizing: border-box; cursor: pointer;
      flex: 1; font-size: 0.875rem; font-weight: 500; color: #fff;
      line-height: 1.43; padding: 2px 0;
      transition: color 120ms;
    }
    .card-title-btn:hover { color: #82b1ff; text-decoration: underline; }
    .card-icon-btn {
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 28px; height: 28px; border-radius: 50%;
      color: rgba(255,255,255,.6); display: inline-grid; place-items: center;
      transition: background-color 120ms, color 120ms;
      flex: 0 0 auto;
    }
    .card-icon-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
    .card-icon-btn.danger:hover { background: rgba(244,67,54,.16); color: #ff6e60; }
    /* 핸드아웃 카드 드래그 핸들 (#33) */
    .handout-drag-handle {
      cursor: grab; touch-action: none; user-select: none;
      width: 20px; height: 28px; flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center;
      color: rgba(255,255,255,.35);
      transition: color 120ms;
    }
    .handout-drag-handle:hover { color: rgba(255,255,255,.85); }
    .handout-drag-handle:active { cursor: grabbing; color: #fff; }
    .card[data-dragging="1"] { opacity: 0.5; }
    .card[data-drag-over="above"] {
      box-shadow: inset 0 2px 0 0 #82b1ff;
    }
    .card[data-drag-over="below"] {
      box-shadow: inset 0 -2px 0 0 #82b1ff;
    }
    .card .badges-row {
      display: flex; gap: 4px; flex-wrap: wrap;
      flex: 0 0 auto; align-self: flex-start; margin-left: 8px;
    }
    .card .summary-row {
      display: flex; align-items: flex-start; gap: 8px; margin-top: 4px;
    }
    .card .summary-row .summary { flex: 1; margin-top: 0; }
    /* 설정 select */
    .settings-select {
      background-color: #1a1a1a; border: 1px solid rgba(255,255,255,.18);
      color: #fff; padding: 9px 36px 9px 12px; font-size: 0.875rem;
      border-radius: 4px; outline: none;
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='%23fff' d='M6 8L0 0h12z'/></svg>");
      background-repeat: no-repeat; background-position: right 12px center;
    }
    .settings-select:hover { border-color: rgba(255,255,255,.4); }
    .settings-select:focus { border-color: #fff; }
    .settings-icon-btn {
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 38px; height: 38px; border-radius: 50%; flex: 0 0 auto;
      background: transparent; color: #fff;
      display: inline-grid; place-items: center;
      transition: background-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    .settings-icon-btn:hover { background: rgba(255,255,255,.08); }
    .settings-icon-btn svg { pointer-events: none; }
    .settings-room {
      padding: 9px 12px; background: rgba(0,0,0,.35);
      border: 1px solid rgba(255,255,255,.12); border-radius: 4px;
      color: rgba(255,255,255,.85); font-size: 0.875rem;
      font-family: ui-monospace, Consolas, monospace;
    }
    /* 설정 탭 PL 리스트 + 권한 신호등 */
    .settings-pl-list {
      display: flex; flex-direction: column; gap: 4px;
      margin-top: 6px;
    }
    .settings-pl-empty {
      padding: 8px 4px; color: rgba(255,255,255,.45);
      font-size: 0.8125rem;
    }
    .settings-pl-row {
      display: grid;
      grid-template-columns: 3px minmax(0, 1fr) auto;
      gap: 8px; align-items: center;
      padding: 6px 8px;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06);
      border-radius: 4px;
      min-width: 0;
    }
    .settings-pl-row[data-pl-merged="1"] { background: rgba(255,255,255,.06); }
    .settings-pl-strip {
      align-self: stretch; border-radius: 2px;
      background: transparent;
    }
    .settings-pl-row[data-pl-role="gm"] .settings-pl-strip { background: #fff; }
    .settings-pl-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .settings-pl-name-row {
      display: flex; align-items: baseline; gap: 6px;
      min-width: 0;
    }
    .settings-pl-name {
      color: #fff; font-size: 0.875rem; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      min-width: 0;
    }
    .settings-pl-role {
      flex: 0 0 auto;
      font-size: 0.6875rem; line-height: 1;
      padding: 2px 5px; border-radius: 2px;
      color: rgba(255,255,255,.55);
      background: rgba(255,255,255,.06);
      letter-spacing: .03em;
    }
    .settings-pl-row[data-pl-role="gm"] .settings-pl-role {
      color: rgba(0,0,0,.85); background: #fff;
    }
    .settings-pl-id {
      flex: 0 0 auto;
      font-size: 0.6875rem;
      color: rgba(255,255,255,.45);
      font-family: ui-monospace, Consolas, monospace;
    }
    .settings-pl-aliases {
      display: flex; flex-wrap: wrap; gap: 3px;
      font-size: 0.6875rem;
      color: rgba(255,255,255,.55);
    }
    .settings-pl-aliases::before {
      content: "병합: "; opacity: .55;
    }
    .settings-pl-aliases:empty { display: none; }
    .settings-pl-alias {
      padding: 1px 5px;
      background: rgba(255,255,255,.06);
      border-radius: 2px;
      max-width: 120px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .settings-pl-signals {
      display: flex; gap: 4px; flex: 0 0 auto;
    }
    .settings-pl-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: rgba(255,255,255,.12);
      transition: background-color 150ms;
    }
    .settings-pl-dot[data-on="1"][data-perm="view"]   { background: #4caf50; }
    .settings-pl-dot[data-on="1"][data-perm="secret"] { background: #f44336; }
    .settings-pl-dot[data-on="1"][data-perm="edit"]   { background: #ffc107; }
    /* SVG 클릭 안 막힘 (button click 정상 통과) */
    header .header-btn svg, .handout-edit-header .action-icon svg,
    .pl-modal .action-icon svg, .pl-modal .row-x svg {
      pointer-events: none;
    }
    /* 패널 푸터 (내보내기/가져오기) */
    .panel-footer {
      background-color: #212121;
      padding: 6px 8px 6px 16px;
      display: flex; align-items: center; gap: 8px;
      border-top: 1px solid rgba(255,255,255,.06);
      flex: 0 0 auto;
    }
    .panel-footer .footer-meta {
      flex: 1; font-size: 0.75rem; color: rgba(255,255,255,.55);
    }
    .panel-footer .btn { box-shadow: none; border-radius: 0; }
    .panel-footer .btn.secondary {
      border: 0; background: transparent;
      color: rgba(255,255,255,.85);
      border-radius: 0;
    }
    .panel-footer .btn.secondary:hover {
      background: rgba(255,255,255,.08); color: #fff;
    }
    /* 푸터 바로 위 룸 정보 한 줄 — 패널 본체 배경 비치도록 transparent */
    .room-strip {
      flex: 0 0 auto;
      background: transparent;
      color: rgba(255,255,255,.55);
      font-size: 0.75rem;
      padding: 6px 16px;
      font-family: "Noto Sans KR", "Noto Sans JP", "Roboto", system-ui, -apple-system, "Segoe UI", sans-serif;
      display: none;
      align-items: center; gap: 8px;
    }
    .room-strip[data-tab-visible="1"] { display: flex; }
    .room-strip .room-info {
      flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* PL 목록 관리 모달 (Shadow DOM 안의 nested overlay) */
    .pl-modal-overlay {
      position: absolute; inset: 0; background: rgba(0,0,0,.55);
      display: none; align-items: center; justify-content: center;
      z-index: 20;
    }
    .pl-modal-overlay[data-pl-modal-open="1"] { display: flex; }
    .pl-modal {
      width: min(560px, 92%); max-height: 88%;
      background-color: #2c2c2c; color: #fff;
      box-shadow:
        0px 11px 15px -7px rgba(0,0,0,0.20),
        0px 24px 38px 3px rgba(0,0,0,0.14),
        0px 9px 46px 8px rgba(0,0,0,0.12);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .pl-modal-head {
      padding: 16px 8px 12px 20px;
      display: flex; align-items: center; gap: 10px;
    }
    .pl-modal-head .action-icon + .action-icon { margin-left: -10px; }
    .pl-modal-head h2 {
      margin: 0; font-size: 1.0625rem; font-weight: 700; flex: 1; color: #fff;
    }
    .pl-modal .action-icon {
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 36px; height: 36px; border-radius: 50%;
      color: #fff; display: inline-grid; place-items: center;
      transition: background-color 150ms cubic-bezier(0.4,0,0.2,1);
    }
    .pl-modal .action-icon:hover { background: rgba(255,255,255,.08); }
    .pl-modal-body {
      padding: 0 16px 12px 16px; overflow-y: auto; overflow-x: hidden;
    }
    .pl-modal .pl-row {
      display: flex; flex-direction: column; gap: 4px;
      margin-bottom: 8px; padding: 4px 4px 4px 6px; border-radius: 4px;
      border-left: 3px solid transparent; transition: background-color 150ms;
    }
    .pl-modal .pl-row[data-pl-role="gm"] { border-left-color: #fff; }
    .pl-modal .pl-row[data-pl-merged="1"] { background: rgba(255,255,255,.05); padding-top: 6px; padding-bottom: 6px; }
    .pl-modal .pl-row-main {
      display: grid;
      grid-template-columns: 24px minmax(0,1fr) minmax(0,140px) 60px 28px;
      gap: 4px 8px; align-items: center; min-width: 0;
    }
    .pl-modal .pl-row-main > * { min-width: 0; }
    .pl-modal .pl-row-main input[data-pl-field],
    .pl-modal .pl-row-main select[data-pl-field] { width: 100%; box-sizing: border-box; }
    .pl-modal .pl-row-main select[data-pl-field] {
      padding-left: 8px; padding-right: 22px;
      background-position: right 6px center;
    }
    .pl-modal .pl-row-meta {
      display: grid;
      grid-template-columns: 24px minmax(0,1fr) minmax(0,140px) 60px 28px;
      gap: 0 8px; align-items: center;
    }
    .pl-modal .pl-row-meta:not(:has(> :not([hidden]))) { display: none; }
    .pl-modal .pl-row-meta > .pl-row-aliases { grid-column: 2 / 3; min-width: 0; }
    .pl-modal .pl-row-meta > .pl-row-id-badge-slot { grid-column: 3 / 4; min-width: 0; }
    .pl-modal .pl-row-id-badge-slot[hidden] { display: none; }
    .pl-modal .pl-row-aliases {
      font-size: 0.72rem; color: rgba(255,255,255,.6);
      line-height: 1.3; word-break: break-word; padding-left: 1px;
    }
    .pl-modal .pl-row-aliases::before { content: "병합: "; opacity: .65; }
    .pl-modal .pl-alias-chip {
      display: inline-block; padding: 2px 8px; margin: 0 4px 2px 0;
      border-radius: 10px; background: rgba(255,255,255,.14);
      color: rgba(255,255,255,.9); cursor: pointer; user-select: none;
      font-size: 0.72rem; line-height: 1.3;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.25);
      transition: background-color 120ms, box-shadow 120ms;
    }
    .pl-modal .pl-alias-chip:hover {
      background: rgba(255,255,255,.22); color: #fff;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.45);
    }
    .pl-modal .pl-alias-chip[data-selected="1"] {
      background: rgba(245,0,87,.25); color: #fff;
      box-shadow: inset 0 0 0 1.5px #f50057;
    }
    .pl-modal .pl-row-badges { padding: 0 4px 0 32px; display: flex; gap: 4px; flex-wrap: wrap; }
    .pl-modal .pl-badge {
      font-size: 0.65rem; padding: 2px 6px; border-radius: 8px;
      background: rgba(255,255,255,.08); color: rgba(255,255,255,.7);
      line-height: 1.2;
    }
    .pl-modal .pl-badge[data-kind="admin"] { background: rgba(255,196,0,.18); color: #ffcd38; }
    .pl-modal .pl-badge[data-kind="group"] { background: rgba(255,255,255,.08); color: rgba(255,255,255,.7); }
    .pl-modal .pl-merge-check { width: 16px; height: 16px; accent-color: #fff; justify-self: center; }
    .pl-modal .pl-row input, .pl-modal .pl-row select {
      background-color: #1a1a1a; border: 0; border-radius: 4px;
      color: #fff; padding: 9px 12px; font-size: 0.875rem;
      outline: none;
    }
    .pl-modal .pl-row input::placeholder { color: rgba(255,255,255,.4); }
    .pl-modal .pl-row input:focus, .pl-modal .pl-row select:focus {
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.4);
    }
    .pl-modal .pl-row select {
      appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path fill='%23fff' d='M6 8L0 0h12z'/></svg>");
      background-repeat: no-repeat; background-position: right 12px center;
      padding-right: 30px;
    }
    .pl-modal .row-x {
      all: unset; box-sizing: border-box; cursor: pointer;
      width: 26px; height: 26px; border-radius: 50%;
      color: rgba(255,255,255,.7); display: grid; place-items: center;
      transition: background-color 150ms;
    }
    .pl-modal .row-x:hover { background: rgba(255,255,255,.08); color: #fff; }
    .pl-modal-foot {
      display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;
      padding: 8px 16px 16px;
    }
    /* CCFOLIA는 dark 전용 → light prefers 분기 없음 */
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
            <button class="tab" data-tab="edit" data-active="0" style="display:none;">새로 만들기</button>
            <button class="tab" data-tab="settings" data-active="0">설정</button>
          </div>
          <div class="body"></div>
          <div class="room-strip" data-room-strip="1"></div>
          <footer class="panel-footer">
            <button class="btn secondary small" data-action="export" title="현재 룸의 핸드아웃을 JSON 파일로 내보내기">내보내기</button>
            <button class="btn secondary small" data-action="import" title="JSON 파일에서 핸드아웃 가져오기 (기존 데이터 교체)">가져오기</button>
            <span class="footer-meta"></span>
          </footer>
          <div class="pl-modal-overlay" data-pl-modal-open="0">
            <div class="pl-modal" role="dialog" aria-label="플레이어 목록 설정">
              <div class="pl-modal-head">
                <h2>플레이어 목록 설정</h2>
                <button class="action-icon" data-action="pl-modal-refresh" aria-label="새로고침" title="새로고침 (누락 PL 복구)">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
                </button>
                <button class="action-icon" data-action="pl-modal-close" aria-label="닫기">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
              </div>
              <div class="pl-modal-body" data-pl-rows-host="1"></div>
              <div class="pl-modal-foot">
                <button class="btn secondary small" data-action="pl-modal-merge">병합</button>
                <button class="btn secondary small" data-action="pl-modal-unmerge" hidden>해제</button>
                <button class="btn secondary small" data-action="pl-modal-add">추가</button>
                <button class="btn small" data-action="pl-modal-save">저장</button>
              </div>
            </div>
          </div>
          <div class="toast" aria-live="polite"></div>
          <div class="resize-handle" data-resize-handle="1" title="크기 조절"></div>
        </section>
      </div>
    `;
    (document.body || document.documentElement).appendChild(root);
    // capture: false 로 등록 — pointerdown 캡처와 충돌 회피
    shadow.addEventListener("click", onShadowClick);
    shadow.addEventListener("change", onShadowChange);
    shadow.addEventListener("input", onShadowInput);
    shadow.addEventListener("pointerdown", onShadowPointerDown);
    shadow.addEventListener("pointermove", onShadowPointerMove);
    shadow.addEventListener("pointerup", onShadowPointerEnd);
    shadow.addEventListener("pointercancel", onShadowPointerEnd);
    shadow.addEventListener("focusin", onShadowFocusIn);
    shadow.addEventListener("paste", onShadowPaste);
    bindWindowControls(shadow);
    state.root = root;
    state.shadow = shadow;
    applyStoredRect();
    registerTeardown(() => root.remove());
    console.info("[ccf-handout] panel mounted; footer/PL-modal present:",
      !!shadow.querySelector(".panel-footer"),
      !!shadow.querySelector(".pl-modal-overlay")
    );
  }

  // ===== Firebase (송신 채널) =====
  // apiKey는 Firebase 설계상 공개 안전. 실제 권한 보호는 Firestore 보안 규칙으로 함.
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCHCnY5n9gG2bMluU_QZa4m3ua1dpBDnUM",
    authDomain: "ccfolia-handout-25c6b.firebaseapp.com",
    projectId: "ccfolia-handout-25c6b",
    storageBucket: "ccfolia-handout-25c6b.firebasestorage.app",
    messagingSenderId: "821478721514",
    appId: "1:821478721514:web:b909f3a85ea4d5a5795493"
  };
  const FIREBASE_SDK_VERSION = "10.13.2";
  const FIREBASE_APP_NAME = "ccf-handout";

  let fbState = null;       // { app, auth, db, user, uid, modules }
  let fbInitPromise = null;

  // Firestore 핸드아웃 push (GM → 룸 컬렉션)
  async function pushHandoutToFirestore(handout) {
    const fb = await initFirebase();
    if (!fb) throw new Error("Firebase not ready");
    const { doc, setDoc, serverTimestamp } = fb.modules.fs;
    const roomKey = getCurrentRoomKey();
    if (roomKey === "global") throw new Error("not in a room");
    const docRef = doc(fb.db, "rooms", roomKey, "handouts", handout.id);
    const payload = {
      id: handout.id,
      title: handout.title || "",
      image: handout.image || "",
      description: handout.description || "",
      gmNotes: handout.gmNotes || "",
      permissions: handout.permissions || {},
      tags: handout.tags || [],
      ownerUid: fb.uid,
      ownerName: state.data.myCharacter || "",
      updatedAt: serverTimestamp(),
      createdAt: handout.createdAt || new Date().toISOString(),
      // 정렬용 order 필드 (#32) — 수신측 ingestRemoteHandout 가 이 값을 우선 사용
      order: Number.isFinite(handout.order) ? handout.order : 0
    };
    await setDoc(docRef, payload);
    console.info("[ccf-handout] Firestore push OK:", handout.id);
    return docRef.path;
  }

  // Firestore 핸드아웃 삭제
  async function deleteHandoutFromFirestore(id) {
    const fb = await initFirebase();
    if (!fb) throw new Error("Firebase not ready");
    const { doc, deleteDoc } = fb.modules.fs;
    const roomKey = getCurrentRoomKey();
    if (roomKey === "global") throw new Error("not in a room");
    await deleteDoc(doc(fb.db, "rooms", roomKey, "handouts", id));
    console.info("[ccf-handout] Firestore delete OK:", id);
  }

  // 디버그 — 현재 룸의 모든 핸드아웃 한 번 조회
  async function fetchAllFromFirestore() {
    const fb = await initFirebase();
    if (!fb) throw new Error("Firebase not ready");
    const { collection, getDocs } = fb.modules.fs;
    const roomKey = getCurrentRoomKey();
    const snap = await getDocs(collection(fb.db, "rooms", roomKey, "handouts"));
    const docs = [];
    snap.forEach((d) => docs.push(d.data()));
    return docs;
  }

  // ===== Firestore 실시간 구독 (수신측) =====
  let unsubHandouts = null;
  let subscribedRoom = null;

  async function subscribeToRoomHandouts() {
    const fb = await initFirebase();
    if (!fb) return;
    const { collection, onSnapshot } = fb.modules.fs;
    const roomKey = getCurrentRoomKey();
    if (roomKey === "global") return;
    if (subscribedRoom === roomKey && unsubHandouts) return;

    if (unsubHandouts) { try { unsubHandouts(); } catch (_) {} unsubHandouts = null; }

    const col = collection(fb.db, "rooms", roomKey, "handouts");
    subscribedRoom = roomKey;
    console.info("[ccf-handout] subscribing to room:", roomKey);
    unsubHandouts = onSnapshot(col,
      (snap) => {
        snap.docChanges().forEach((change) => {
          const data = change.doc.data();
          if (change.type === "removed") {
            ingestRemoteRemove(data.id);
          } else {
            ingestRemoteHandout(data, change.type);
          }
        });
      },
      (error) => {
        console.error("[ccf-handout] subscribe error:", error);
        toast("실시간 수신 실패 — 콘솔 확인");
      }
    );
    registerTeardown(() => {
      try { unsubHandouts?.(); } catch (_) {}
      unsubHandouts = null;
      subscribedRoom = null;
    });
  }

  function ingestRemoteHandout(data, changeType) {
    if (!fbState) return;
    if (!data || !data.id) return;
    // 본인이 만든 핸드아웃 — 이미 local에 있음. skip
    if (data.ownerUid === fbState.uid) return;

    const me = state.data.myCharacter;
    const hasPublic = canView(data, me);
    const hasSecret = canViewSecret(data, me);
    if (!hasPublic && !hasSecret) {
      console.info("[ccf-handout] remote skipped (no permission):", data.id, "as", me || "(미설정)");
      ingestRemoteRemove(data.id);
      return;
    }

    const handout = {
      id: data.id,
      title: data.title || "",
      image: data.image || "",
      description: data.description || "",
      // 비밀 권한 없으면 gmNotes 비움 (Firestore에서 받지만 안 보여줌)
      gmNotes: hasSecret ? (data.gmNotes || "") : "",
      // 수신측 로컬 저장소에는 권한표를 남기지 않는다. 표시/비밀 여부는 수신 시점에 확정.
      permissions: {},
      tags: data.tags || [],
      ownerUid: data.ownerUid,
      ownerName: data.ownerName || "",
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _remote: true,
      _canSecret: hasSecret,
      _canView: hasPublic,
      // 원격 order 우선, 없으면 로컬에서 끝에 부여 (#32)
      order: Number.isFinite(data.order) ? data.order : getNextOrder()
    };

    const idx = state.data.handouts.findIndex((h) => h.id === data.id);
    const isNew = idx === -1;
    if (isNew) {
      state.data.handouts.push(handout);
      const who = data.ownerName ? ` (from ${data.ownerName})` : "";
      toast(`새 핸드아웃 도착: "${data.title || "(제목없음)"}"${who}`);
    } else {
      state.data.handouts[idx] = handout;
      if (changeType === "modified") {
        toast(`핸드아웃 갱신: "${data.title || "(제목없음)"}"`);
      }
    }
    saveAll(state.data).catch((error) => console.warn("[ccf-handout] saveAll failed:", error));
    if (state.isOpen) render();
  }

  // ===== Show to Players — 일회용 강제 팝업 신호 =====
  let unsubShows = null;
  const seenShowIds = new Set();
  let initialShowsBatch = true;

  async function sendShowSignal(handoutId, audience) {
    const fb = await initFirebase();
    if (!fb) throw new Error("Firebase not ready");
    const { collection, addDoc, serverTimestamp } = fb.modules.fs;
    const roomKey = getCurrentRoomKey();
    if (roomKey === "global") throw new Error("not in a room");
    const docRef = await addDoc(collection(fb.db, "rooms", roomKey, "shows"), {
      handoutId,
      audience: audience || "all",
      atUid: fb.uid,
      atName: state.data.myCharacter || "",
      at: serverTimestamp()
    });
    console.info("[ccf-handout] show signal:", docRef.id, handoutId, audience);
    return docRef.id;
  }

  async function subscribeToRoomShows() {
    const fb = await initFirebase();
    if (!fb) return;
    const { collection, onSnapshot } = fb.modules.fs;
    const roomKey = getCurrentRoomKey();
    if (roomKey === "global") return;
    if (unsubShows) { try { unsubShows(); } catch (_) {} unsubShows = null; }
    initialShowsBatch = true;
    const col = collection(fb.db, "rooms", roomKey, "shows");
    unsubShows = onSnapshot(col, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;
        if (initialShowsBatch) {
          // subscribe 시점에 이미 존재하던 신호는 stale 처리 — id만 기억하고 팝업 X
          seenShowIds.add(change.doc.id);
        } else {
          ingestShowSignal(change.doc.id, change.doc.data());
        }
      });
      initialShowsBatch = false;
    }, (error) => console.error("[ccf-handout] shows subscribe error:", error));
    registerTeardown(() => { try { unsubShows?.(); } catch (_) {} unsubShows = null; });
  }

  function ingestShowSignal(signalId, data) {
    if (!data || !data.handoutId) return;
    if (seenShowIds.has(signalId)) return;
    seenShowIds.add(signalId);
    if (data.atUid === fbState?.uid) return; // 본인이 보낸 신호는 자기 화면에 안 띄움
    const me = state.data.myCharacter || "";
    const audience = String(data.audience || "all").trim();
    const matched = audience === "all" || audience === "*" ||
                    removeSpaces(audience).toLowerCase() === removeSpaces(me).toLowerCase();
    if (!matched) {
      console.info("[ccf-handout] show signal skipped (audience mismatch):", audience, "vs", me);
      return;
    }
    const tryShow = (attempt) => {
      const h = state.data.handouts.find((x) => x.id === data.handoutId);
      if (h) { showHandoutModal(h, data.atName); return; }
      if (attempt < 5) setTimeout(() => tryShow(attempt + 1), 500);
      else console.warn("[ccf-handout] show signal: handout not found locally", data.handoutId);
    };
    tryShow(0);
  }

  function showHandoutModal(handout, fromName) {
    const me = state.data.myCharacter;
    const hasSecret = canViewSecret(handout, me);
    const host = document.createElement("div");
    host.setAttribute("data-ccf-handout-show", "1");
    // 카스케이드 초기 위치 — 기존 팝업 N개 있으면 (N%8) * 24px offset
    const POPUP_W = 400; // 기본 크기 (이전 600의 2/3)
    const POPUP_W_COLLAPSED = 200; // 접혔을 때 = 기본의 절반
    const POPUP_H_INIT = 320;
    const existingCount = document.querySelectorAll('[data-ccf-handout-show="1"]').length;
    const offset = (existingCount % 8) * 24;
    const initLeft = Math.max(8, Math.round((window.innerWidth - POPUP_W) / 2) + offset);
    const initTop = Math.max(8, Math.round((window.innerHeight - POPUP_H_INIT) / 2) + offset);
    host.style.cssText = `all: initial; position: fixed; left: ${initLeft}px; top: ${initTop}px; z-index: 2147483645;`;
    const sh = host.attachShadow({ mode: "open" });
    sh.innerHTML = `
      <style>
        :host { all: initial; display: block; }
        * { box-sizing: border-box; font-family: "Noto Sans KR","Noto Sans JP","Roboto",system-ui,sans-serif; }
        .show-paper {
          width: ${POPUP_W}px; max-width: 95vw; max-height: 88vh;
          display: flex; flex-direction: column;
          background-color: rgba(44,44,44,0.95); color: #fff;
          box-shadow:
            0px 11px 15px -7px rgba(0,0,0,0.20),
            0px 24px 38px 3px rgba(0,0,0,0.14),
            0px 9px 46px 8px rgba(0,0,0,0.12);
          overflow: hidden;
          transition: opacity 150ms;
        }
        .show-paper[data-collapsed="1"] {
          max-height: none;
          width: ${POPUP_W_COLLAPSED}px;
          opacity: 0.5;
        }
        .show-paper[data-collapsed="1"]:hover { opacity: 1; }
        .show-paper[data-collapsed="1"] .show-body { display: none; }
        .show-head {
          background-color: #212121; padding: 0 8px 0 20px; min-height: 56px;
          display: flex; align-items: center; gap: 12px;
          cursor: move; user-select: none; touch-action: none;
        }
        .show-head h2 {
          margin: 0; font-size: 1.0625rem; font-weight: 700; flex: 1; color: #fff;
          pointer-events: none;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
        }
        .show-close {
          all: unset; box-sizing: border-box; cursor: pointer;
          width: 36px; height: 36px; border-radius: 50%; color: #fff;
          display: inline-grid; place-items: center;
          transition: background-color 150ms;
        }
        .show-close:hover { background: rgba(255,255,255,.1); }
        .show-close svg { pointer-events: none; }
        .show-body { padding: 20px 24px; overflow: auto; }
        .show-img { width: 100%; max-height: 280px; object-fit: cover; margin-bottom: 16px; background: rgba(0,0,0,.25); }
        .rendered { font-size: 0.9375rem; line-height: 1.65; color: rgba(255,255,255,.95); }
        .rendered img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
        .rendered a { color: #82b1ff; }
        .rendered blockquote { border-left: 3px solid rgba(255,255,255,.2); padding: 2px 12px; color: rgba(255,255,255,.8); }
        .rendered code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, Consolas, monospace; font-size: 90%; }
        .rendered h1 { font-size: 1.25rem; color: #fff; margin: 10px 0; }
        .rendered h2 { font-size: 1.125rem; color: #fff; margin: 8px 0; }
        .rendered h3 { font-size: 1rem; color: #fff; margin: 8px 0; }
        .rendered hr { border: 0; border-top: 1px solid rgba(255,255,255,.12); margin: 10px 0; }
        .secret-block {
          margin-top: 18px; border: 1px dashed rgba(244,67,54,.5); padding: 12px 14px;
          background: rgba(244,67,54,.06);
        }
        .secret-head {
          font-size: 0.75rem; font-weight: 700; color: #ff8a80; margin-bottom: 8px;
          letter-spacing: .08em; text-transform: uppercase;
        }
      </style>
      <div class="show-paper" data-collapsed="0" role="dialog" aria-label="핸드아웃">
        <div class="show-head" data-drag-handle="1" title="더블클릭으로 접기/펼치기, 드래그로 이동">
          <h2 title="${escapeAttr(handout.title || "(제목 없음)")}">${escapeHtml(handout.title || "(제목 없음)")}</h2>
          <button class="show-close" data-action="close-show" aria-label="닫기">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="show-body">
          ${handout.image ? `<img class="show-img" src="${escapeAttr(handout.image)}" alt="">` : ""}
          <div class="rendered">${renderHandoutBody(handout.description)}</div>
          ${hasSecret && handout.gmNotes ? `
            <div class="secret-block">
              <div class="secret-head">🔒 비밀 핸드아웃</div>
              <div class="rendered">${renderHandoutBody(handout.gmNotes)}</div>
            </div>
          ` : ""}
        </div>
      </div>
    `;
    const paper = sh.querySelector(".show-paper");
    const head = sh.querySelector(".show-head");
    // 더블클릭 = 접기/펼치기 토글 (닫기 버튼 위 더블클릭은 제외)
    head.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      const collapsed = paper.getAttribute("data-collapsed") === "1";
      paper.setAttribute("data-collapsed", collapsed ? "0" : "1");
    });
    // 드래그 — 헤더에서 시작
    let dragState = null;
    head.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button")) return;
      const rect = host.getBoundingClientRect();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        startLeft: rect.left, startTop: rect.top
      };
      try { head.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    head.addEventListener("pointermove", (e) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const w = host.offsetWidth || POPUP_W;
      const headerH = head.offsetHeight || 56;
      // 헤더가 화면 밖으로 완전히 빠지지 않도록 clamp (최소 80px 잡힘)
      const minLeft = -(w - 80);
      const maxLeft = window.innerWidth - 80;
      const minTop = 0;
      const maxTop = window.innerHeight - headerH;
      let newLeft = dragState.startLeft + dx;
      let newTop = dragState.startTop + dy;
      newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
      newTop = Math.max(minTop, Math.min(maxTop, newTop));
      host.style.left = `${newLeft}px`;
      host.style.top = `${newTop}px`;
    });
    const endDrag = (e) => {
      if (!dragState || e.pointerId !== dragState.pointerId) return;
      try { head.releasePointerCapture(e.pointerId); } catch (_) {}
      dragState = null;
    };
    head.addEventListener("pointerup", endDrag);
    head.addEventListener("pointercancel", endDrag);
    // 닫기 버튼
    sh.addEventListener("click", (e) => {
      const closeBtn = e.target.closest('[data-action="close-show"]');
      if (closeBtn) host.remove();
    });
    (document.body || document.documentElement).appendChild(host);
    registerTeardown(() => host.remove());
  }

  function ingestRemoteRemove(id) {
    if (!id) return;
    const before = state.data.handouts.length;
    state.data.handouts = state.data.handouts.filter((h) => h.id !== id);
    if (state.data.handouts.length !== before) {
      saveAll(state.data).catch(() => {});
      if (state.isOpen) render();
      toast("핸드아웃이 삭제되었습니다.");
    }
  }

  function initFirebase() {
    if (fbState) return Promise.resolve(fbState);
    if (fbInitPromise) return fbInitPromise;
    fbInitPromise = (async () => {
      try {
        console.info("[ccf-handout] Firebase: loading SDK...");
        const [appMod, authMod, fsMod] = await Promise.all([
          import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
          import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
          import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
        ]);
        // 같은 페이지서 여러 번 init 충돌 방지 — 이름 지정
        const existing = appMod.getApps?.().find((a) => a.name === FIREBASE_APP_NAME);
        const app = existing || appMod.initializeApp(FIREBASE_CONFIG, FIREBASE_APP_NAME);
        const auth = authMod.getAuth(app);
        const db = fsMod.getFirestore(app);
        const cred = await authMod.signInAnonymously(auth);
        fbState = {
          app, auth, db,
          user: cred.user,
          uid: cred.user.uid,
          modules: { app: appMod, auth: authMod, fs: fsMod }
        };
        console.info("[ccf-handout] Firebase OK uid:", cred.user.uid);
        return fbState;
      } catch (error) {
        console.error("[ccf-handout] Firebase init failed:", error);
        fbInitPromise = null;
        throw error;
      }
    })();
    return fbInitPromise;
  }

  // ===== "카피바라와 함께합니다" 인사 팝업 =====
  const GREETING_STORAGE_PREFIX = "ccf-handout:greeted:";
  const GREETING_SKIP_DAY_KEY = "ccf-handout:greeted-skip-day";
  let greetingRoot = null;

  function isGreeted(roomKey) {
    try { return localStorage.getItem(GREETING_STORAGE_PREFIX + roomKey) === "1"; }
    catch (error) { return false; }
  }
  function markGreeted(roomKey) {
    try { localStorage.setItem(GREETING_STORAGE_PREFIX + roomKey, "1"); }
    catch (error) { /* quota */ }
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function isSkippedToday() {
    try { return localStorage.getItem(GREETING_SKIP_DAY_KEY) === todayKey(); }
    catch (error) { return false; }
  }
  function markSkipToday() {
    try { localStorage.setItem(GREETING_SKIP_DAY_KEY, todayKey()); }
    catch (error) { /* quota */ }
  }

  function maybeShowGreeting() {
    const room = getCurrentRoomKey();
    const skipped = isSkippedToday();
    const alreadyMounted = greetingRoot && greetingRoot.isConnected;
    let skipValue = null;
    try { skipValue = localStorage.getItem(GREETING_SKIP_DAY_KEY); } catch (_) {}
    console.info("[ccf-handout] maybeShowGreeting", {
      active, room, skipped, skipKey: GREETING_SKIP_DAY_KEY, skipValue, alreadyMounted
    });
    if (!active) return;
    if (room === "global") return;            // 룸 밖에서는 안 띄움
    if (skipped) return;                      // 오늘 다시 보지 않기 체크된 상태
    if (alreadyMounted) return;
    mountGreeting(room);
  }

  // 디버그 — 콘솔에서 호출 가능
  function clearGreetingFlags() {
    const room = getCurrentRoomKey();
    try {
      localStorage.removeItem(GREETING_STORAGE_PREFIX + room);
      localStorage.removeItem(GREETING_SKIP_DAY_KEY);
      console.info("[ccf-handout] greeting flags cleared for room", room);
    } catch (error) { console.warn(error); }
  }

  function mountGreeting(roomKey) {
    const host = document.createElement("div");
    host.setAttribute("data-ccf-handout-greeting", "1");
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483645;";
    const sh = host.attachShadow({ mode: "open" });
    sh.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .gd-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,.55);
          display: flex; align-items: center; justify-content: center;
          font-family: "Noto Sans KR","Noto Sans JP","Roboto",system-ui,sans-serif;
        }
        .gd-paper {
          width: min(420px, 92%); background-color: rgba(44,44,44,0.95);
          color: #fff; padding: 24px 24px 16px;
          box-shadow:
            0px 11px 15px -7px rgba(0,0,0,0.20),
            0px 24px 38px 3px rgba(0,0,0,0.14),
            0px 9px 46px 8px rgba(0,0,0,0.12);
        }
        .gd-title { font-size: 1.125rem; font-weight: 700; margin: 0 0 10px; }
        .gd-body { font-size: 0.875rem; line-height: 1.6; color: rgba(255,255,255,.85); margin-bottom: 18px; }
        .gd-options { margin-bottom: 14px; }
        .gd-check {
          display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
          font-size: 0.8125rem; color: rgba(255,255,255,.85);
        }
        .gd-check input { width: 16px; height: 16px; accent-color: #fff; cursor: pointer; margin: 0; }
        .gd-actions { display: flex; justify-content: flex-end; }
        .gd-ok {
          background: #fff; color: rgba(0,0,0,.87); border: 0;
          padding: 8px 20px; font-size: 0.875rem; font-weight: 600;
          letter-spacing: .02857em; text-transform: uppercase; cursor: pointer;
          border-radius: 4px;
          box-shadow: 0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);
          transition: background-color 250ms cubic-bezier(0.4,0,0.2,1);
        }
        .gd-ok:hover { background: #e0e0e0; }
      </style>
      <div class="gd-overlay">
        <div class="gd-paper" role="dialog" aria-modal="true" aria-label="카피바라 안내">
          <h2 class="gd-title">카피바라와 함께합니다</h2>
          <p class="gd-body">카피바라 툴킷이 활성화되었습니다.<br>아래 '확인'을 누르면 채팅 발신자 자동 인식이 시작됩니다.</p>
          <div class="gd-options">
            <label class="gd-check"><input type="checkbox" data-skip-today> 오늘은 다시 보지 않기</label>
          </div>
          <div class="gd-actions"><button class="gd-ok" data-action="greeting-ok">확인</button></div>
        </div>
      </div>
    `;
    sh.addEventListener("click", (e) => {
      const b = e.target.closest('button[data-action="greeting-ok"]');
      if (!b) return;
      const skipToday = !!sh.querySelector('input[data-skip-today]')?.checked;
      // 체크박스 ON 일 때만 오늘 하루 skip. OFF 면 다음 실행 시 다시 팝업.
      if (skipToday) markSkipToday();
      greetingRoot?.remove();
      greetingRoot = null;
      // 확인 시점부터 자동 감시 활성화. 다음 실행 때도 유지.
      markGreeted(roomKey);
      scanChatForAuthors();
      // myCharacter 자동 감지 (비어있을 때만)
      autoDetectMyCharacter().catch(() => {});
      toast("카피바라 툴킷이 활성화되었습니다.");
      // Firebase 연결 + 실시간 구독 (사용자 동의 후 자동)
      initFirebase().then((fb) => {
        toast(`송신 채널 연결됨 (uid: ${fb.uid.slice(0, 8)}...)`);
        return Promise.all([subscribeToRoomHandouts(), subscribeToRoomShows()]);
      }).catch((error) => {
        toast("송신 채널 연결 실패 — 콘솔 확인");
        console.error(error);
      });
    });
    (document.body || document.documentElement).appendChild(host);
    greetingRoot = host;
    registerTeardown(() => host.remove());
  }

  // ===== 채팅 발신자 감시 (plList 자동 추가) =====
  function startChatWatcher() {
    if (state.chatWatcher || !active) return;
    const target = document.body || document.documentElement;
    if (!target) return;
    state.chatWatcher = new MutationObserver((mutations) => {
      const candidates = collectChatAuthorCandidatesFromMutations(mutations);
      if (!candidates.length) return;
      candidates.forEach((item) => state.chatPendingItems.add(item));
      debouncedScanChat();
    });
    state.chatWatcher.observe(target, { childList: true, subtree: true });
    scanCurrentBottomChatAuthors();
    registerTeardown(() => {
      state.chatWatcher?.disconnect();
      state.chatWatcher = null;
    });
  }

  function collectChatAuthorCandidatesFromMutations(mutations) {
    const out = new Set();
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      if (mutation.target instanceof Element && mutation.target.closest(`#${ROOT_ID}, [data-ccf-handout-greeting]`)) continue;
      Array.from(mutation.addedNodes || []).forEach((node) => collectChatAuthorCandidateItems(node, out));
    }
    return Array.from(out);
  }

  function collectChatAuthorCandidateItems(node, out) {
    if (!(node instanceof HTMLElement)) return;
    if (node.closest(`#${ROOT_ID}, [data-ccf-handout-greeting]`)) return;
    if (node.matches?.(CHAT_AUTHOR_ITEM_SELECTOR)) out.add(node);
    node.querySelectorAll?.(CHAT_AUTHOR_ITEM_SELECTOR).forEach((item) => {
      if (item instanceof HTMLElement) out.add(item);
    });
    const owner = node.closest?.(CHAT_AUTHOR_ITEM_SELECTOR);
    if (owner instanceof HTMLElement) out.add(owner);
  }

  function debouncedScanChat() {
    if (state.chatScanScheduled) return;
    state.chatScanScheduled = requestAnimationFrame(() => {
      state.chatScanScheduled = 0;
      scanChatForAuthors();
    });
  }

  async function scanChatForAuthors() {
    if (!active) return;
    // 인사 팝업 안 끝났으면 대기 (사용자 동의 후 시작)
    const room = getCurrentRoomKey();
    resetChatSeenAuthorsForRoom(room);
    if (room !== "global" && !isGreeted(room)) return;
    // 데이터 미로드 시 skip
    if (!state.data || !Array.isArray(state.data.plList)) return;

    const candidates = consumePendingChatAuthorItems();
    if (!candidates.length) return;
    const names = collectChatAuthorNames(candidates);
    if (!names.length) return;

    const me = normalizePlNameKey(state.data.myCharacter || "");
    const existing = new Set((state.data.plList || []).flatMap((p) => [p.name, ...(p.aliases || [])].map(normalizePlNameKey)));
    const added = [];
    let merged = 0;

    names.forEach((name) => {
      const key = normalizePlNameKey(name);
      if (!key) return;
      if (state.chatSeenAuthors.has(key)) return;
      state.chatSeenAuthors.add(key);
      if (key === me) return;
      if (existing.has(key)) return;
      const sameId = findPlEntryByInferredId(name);
      if (sameId) {
        sameId.aliases = [...new Set([...(sameId.aliases || []), name].filter(Boolean))];
        existing.add(key);
        merged += 1;
        return;
      }
      existing.add(key);
      added.push({ name, id: "", role: "player", aliases: [] });
    });

    if (!added.length && !merged) return;
    state.data.plList.push(...added);
    console.info("[ccf-handout] chat autoadd", { added, merged }, "total plList:", state.data.plList.length);
    await saveAll(state.data);
    const parts = [];
    if (added.length) parts.push(`PL ${added.length}명 자동 추가: ${added.map((a) => a.name).join(", ")}`);
    if (merged) parts.push(`${merged}명 별칭 병합`);
    toast(parts.join(" / "));
    if (state.isOpen && state.activeTab === "settings") render();
  }

  function findPlEntryByInferredId(name) {
    const inferred = inferPlayerIdFromName(name);
    if (!inferred) return null;
    return (state.data.plList || []).find((p) => normalizePlNameKey(p.id) === inferred) || null;
  }

  function inferPlayerIdFromName(name) {
    const match = String(name || "").match(/(?:^|\s)[@#]([A-Za-z0-9_.-]{2,})(?:\s|$)/);
    return match ? normalizePlNameKey(match[1]) : "";
  }

  function resetChatSeenAuthorsForRoom(room) {
    if (state.chatSeenRoom === room) return;
    state.chatSeenRoom = room;
    state.chatSeenAuthors.clear();
    state.chatPendingItems.clear();
  }

  function scanCurrentBottomChatAuthors() {
    document.querySelectorAll(CHAT_AUTHOR_ITEM_SELECTOR).forEach((item) => {
      if (item instanceof HTMLElement && isRecentChatAuthorItem(item)) state.chatPendingItems.add(item);
    });
    debouncedScanChat();
  }

  function consumePendingChatAuthorItems() {
    const items = Array.from(state.chatPendingItems);
    state.chatPendingItems.clear();
    const connected = items.filter((item) => item instanceof HTMLElement && item.isConnected);
    const fresh = connected.filter(isRecentChatAuthorItem);
    return fresh.slice(-CHAT_AUTHOR_CANDIDATE_LIMIT);
  }

  function collectChatAuthorNames(items) {
    const names = [];
    const seen = new Set();
    items.forEach((item) => {
      if (!(item instanceof HTMLElement)) return;
      if (!isLikelyChatAuthorItem(item)) return;
      const name = extractChatAuthorName(item);
      const key = normalizePlNameKey(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
    return names;
  }

  function isRecentChatAuthorItem(item) {
    if (!(item instanceof HTMLElement)) return false;
    const scope = item.closest(CHAT_AUTHOR_SCOPE_SELECTOR);
    if (!(scope instanceof HTMLElement)) return false;
    if (!isLikelyChatAuthorScope(scope)) return false;
    const scroller = findScrollContainer(item) || findScrollContainer(scope);
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= CHAT_AUTHOR_BOTTOM_THRESHOLD_PX;
  }

  function findScrollContainer(start) {
    let cur = start instanceof HTMLElement ? start : null;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.scrollHeight > cur.clientHeight + 8) return cur;
      cur = cur.parentElement;
    }
    const doc = document.scrollingElement;
    return doc instanceof HTMLElement && doc.scrollHeight > doc.clientHeight + 8 ? doc : null;
  }

  function isLikelyChatAuthorItem(item) {
    if (!(item instanceof HTMLElement)) return false;
    const scope = item.closest(CHAT_AUTHOR_SCOPE_SELECTOR);
    return isLikelyChatAuthorScope(scope);
  }

  function isLikelyChatAuthorScope(scope) {
    if (!(scope instanceof HTMLElement)) return false;
    if (scope.closest(`#${ROOT_ID}, [data-ccf-handout-greeting]`)) return false;
    if (scope.closest("[role='dialog'], .MuiDialog-root, .MuiModal-root, .MuiPopover-root")) return false;
    if (scope.matches?.("[role='log'], [aria-live='polite'], [aria-live='assertive']")) return true;
    if (scope.matches?.(".MuiDrawer-paper") && looksLikeChatScope(scope)) return true;
    const drawer = scope.closest(".MuiDrawer-paper");
    if (drawer instanceof HTMLElement) return looksLikeChatScope(drawer);
    return looksLikeChatScope(scope);
  }

  function looksLikeChatScope(scope) {
    if (!(scope instanceof HTMLElement)) return false;
    const headings = Array.from(scope.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .map((node) => removeSpaces(node.textContent || ""))
      .filter(Boolean)
      .join(" ");
    if (CHAT_DRAWER_TITLE_RE.test(headings)) return true;
    const hasEditor = !!scope.querySelector('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    const hasSubmit = Array.from(scope.querySelectorAll('button[type="submit"]'))
      .some((button) => {
        const label = removeSpaces(button.textContent || button.getAttribute("aria-label") || "");
        return !label || /전송|send|送信/i.test(label);
      });
    return hasEditor && hasSubmit;
  }

  function extractChatAuthorName(item) {
    const heading = item.querySelector(CHAT_AUTHOR_HEADING_SELECTOR);
    if (!(heading instanceof HTMLElement)) return "";

    const direct = getDirectText(heading);
    const directName = cleanChatAuthorName(direct);
    if (directName) return directName;

    const aria = cleanChatAuthorName(heading.getAttribute("aria-label") || heading.getAttribute("title") || "");
    if (aria) return aria;

    return cleanChatAuthorName(heading.textContent || "");
  }

  function getDirectText(element) {
    let out = "";
    element.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue || "";
    });
    return out;
  }

  function cleanChatAuthorName(value) {
    let name = removeSpaces(value || "");
    if (!name) return "";
    name = name.replace(/\s*(?:\d{1,2}:\d{2}(?::\d{2})?|午前\s*\d{1,2}:\d{2}|午後\s*\d{1,2}:\d{2}|AM\s*\d{1,2}:\d{2}|PM\s*\d{1,2}:\d{2})\s*$/i, "").trim();
    name = name.replace(/\s*(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})\s*$/i, "").trim();
    if (!name || name.length > 80 || CHAT_AUTHOR_IGNORE_RE.test(name)) return "";
    return name;
  }

  function normalizePlNameKey(value) {
    return removeSpaces(value || "").toLowerCase();
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
      state.myCharacterOptions = Array.isArray(state.data.myCharacterOptions) ? state.data.myCharacterOptions : [];
    } else if (!state.data.handouts.length && !state.data.myCharacter) {
      state.data = await loadAll();
      state.myCharacterOptions = Array.isArray(state.data.myCharacterOptions) ? state.data.myCharacterOptions : [];
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
    // 탭 이동만으로 editingId 비우지 않음 — 저장/취소 누를 때만 초기화 → 편집 탭 유지
    render();
  }

  function render() {
    if (!state.shadow) return;
    const bd = state.shadow.querySelector(".container");
    bd.setAttribute("data-open", state.isOpen ? "1" : "0");
    const meta = state.shadow.querySelector("header .meta");
    meta.textContent = "";
    const roomStrip = state.shadow.querySelector("[data-room-strip]");
    if (roomStrip) {
      let stripHtml = "";
      if (state.activeTab === "settings") {
        stripHtml = `
          <span class="room-info">룸 ${escapeHtml(getCurrentRoomKey())} · 핸드아웃 ${state.data.handouts.length}건</span>
          <button class="btn small" data-action="save-settings">저장</button>
        `;
      } else if (state.activeTab === "edit") {
        const editing = (state.editingId && state.editingId !== "new") ? findHandout(state.editingId) : null;
        const isReadOnly = (editing && !canManageHandout(editing)) || (state.editingId === "new" && !isAdminMode());
        if (isReadOnly) {
          stripHtml = `
            <span class="room-info"></span>
            <button class="btn small secondary" data-action="cancel-edit">목록으로</button>
          `;
        } else {
          stripHtml = `
            <span class="room-info"></span>
            <button class="btn small secondary" data-action="cancel-edit">취소</button>
            <button class="btn small" data-action="save-handout">저장</button>
          `;
        }
      }
      const showStrip = stripHtml.length > 0;
      roomStrip.innerHTML = stripHtml;
      roomStrip.setAttribute("data-tab-visible", showStrip ? "1" : "0");
      roomStrip.style.display = "";
    }
    const adminMode = isAdminMode();
    const newButton = state.shadow.querySelector('[data-action="new-handout"]');
    if (newButton) newButton.style.display = adminMode ? "" : "none";
    const settingsTab = state.shadow.querySelector('.tab[data-tab="settings"]');
    if (settingsTab) {
      settingsTab.style.display = adminMode ? "" : "none";
      if (!adminMode && state.activeTab === "settings") state.activeTab = "list";
    }
    // 편집 탭 동적 표시 — editingId가 있을 때만 보임
    const editTab = state.shadow.querySelector('.tab[data-tab="edit"]');
    if (editTab) {
      if (state.editingId) {
        editTab.style.display = "";
        editTab.textContent = state.editingId === "new" ? "새로 만들기" : "편집";
      } else {
        editTab.style.display = "none";
        if (state.activeTab === "edit") state.activeTab = "list";
      }
    }
    state.shadow.querySelectorAll(".tab").forEach((t) => {
      t.setAttribute("data-active", t.dataset.tab === state.activeTab ? "1" : "0");
    });
    const body = state.shadow.querySelector(".body");
    let inner;
    if (state.activeTab === "list") inner = renderList();
    else if (state.activeTab === "edit") inner = renderEdit();
    else inner = renderSettings();
    body.innerHTML = `<div class="body-pad" data-tab="${escapeAttr(state.activeTab)}">${inner}</div>`;
  }

  function renderList() {
    const me = state.data.myCharacter;
    const adminMode = isAdminMode();
    const previewAsPl = adminMode && state.plPreview && !!me;
    // 내보내기/가져오기 바 (.panel-footer) 바로 위 우하단에 sticky로 배치
    const previewToggle = adminMode ? `
      <div class="list-pl-preview-bar">
        <label class="checkbox" title="현재 캐릭터의 권한대로만 표시">
          <input type="checkbox" data-action="toggle-pl-preview" ${previewAsPl ? "checked" : ""} ${me ? "" : "disabled"}>
          PL 시점 미리보기
        </label>
      </div>
    ` : "";
    if (!state.data.handouts.length) {
      return previewToggle;
    }
    // order 기준 정렬 (#32) — 원본 배열은 그대로 두고 표시용 복사본만 정렬
    const sortedHandouts = [...state.data.handouts].sort(compareByOrder);
    const cards = sortedHandouts.map((h) => {
      ensurePermissions(h);
      const manageable = canManageHandout(h);
      const permissionName = getPermissionCharacterName();
      const canSecret = previewAsPl
        ? canViewSecret(h, me)
        : (adminMode || h._canSecret === true || canViewSecret(h, permissionName));
      const hasSecret = !!(h.gmNotes && h.gmNotes.trim());
      const permKeys = Object.keys(h.permissions || {});
      const viewersLabel = adminMode
        ? (permKeys.length ? permKeys.map((k) => k === ALL_KEY ? "전체" : k).join(", ") : "GM 전용")
        : "핸드아웃";
      return `
        <article class="card" data-id="${escapeHtml(h.id)}" data-order="${Number.isFinite(h.order) ? h.order : ""}">
          <div class="head">
            ${adminMode ? `<span class="handout-drag-handle" data-handout-drag-handle="1" data-id="${escapeHtml(h.id)}" title="드래그로 순서 변경" aria-label="드래그 핸들">${ICON_DRAG_HANDLE}</span>` : ""}
            <button class="card-title-btn" data-action="view-handout" data-id="${escapeHtml(h.id)}" title="열기">${escapeHtml(h.title || "(제목 없음)")}</button>
            ${manageable ? `<button class="card-icon-btn" data-action="edit-handout" data-id="${escapeHtml(h.id)}" title="편집" aria-label="편집">${ICON_PENCIL}</button>` : ""}
            ${manageable ? `<button class="card-icon-btn danger" data-action="delete-handout" data-id="${escapeHtml(h.id)}" title="삭제" aria-label="삭제">${ICON_X_SMALL}</button>` : ""}
          </div>
          <div class="summary-row">
            <div class="summary">${escapeHtml(stripMarkdown(h.description).slice(0, 140))}</div>
            <div class="badges-row">
              ${hasSecret && canSecret ? `<span class="badge secret">비밀</span>` : ""}
              <span class="badge">${escapeHtml(viewersLabel)}</span>
            </div>
          </div>
          ${adminMode ? `<div class="actions"><button class="btn small secondary" data-action="show-to-players" data-id="${escapeHtml(h.id)}">Show to Players</button></div>` : ""}
        </article>
      `;
    }).join("");
    return `
      <div class="list">${cards}</div>
      ${previewToggle}
    `;
  }

  function stripMarkdown(s) {
    // HTML 태그 먼저 제거 (contenteditable 본문) + 마크다운 기호 제거
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/[#*`>!\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findHandout(id) {
    return state.data.handouts.find((h) => h.id === id) || null;
  }

  // 권한 표에 표시할 행 목록 만들기
  function permissionRowKeys(h) {
    const myChar = removeSpaces(state.data.myCharacter);
    const plList = mergePlListById(state.data.plList || []).filter((p) => p && p.name);
    const rows = [];
    rows.push({ key: ALL_KEY, label: "플레이어 전체" });
    if (myChar) {
      // GM 본인 행 — 실제 캐릭터명 + (GM) 배지. 관리자 = GM 으로 통일.
      const adminLabel = state.data.myCharacter || myChar;
      rows.push({ key: myChar, label: `${adminLabel} (GM)` });
    }
    for (const pl of plList) {
      const name = removeSpaces(pl.name);
      if (!name) continue;
      if (name === myChar) continue;
      if (rows.some((r) => r.key === name)) continue;
      const aliasText = (pl.aliases || []).filter(Boolean).length ? ` (${(pl.aliases || []).join(", ")})` : "";
      const label = `${pl.role === "gm" ? `${name} (GM)` : name}${aliasText}`;
      rows.push({ key: name, label });
    }
    // permissions 에만 있고 위 목록에 없는 orphan 키도 표시
    const perms = h.permissions || {};
    for (const k of Object.keys(perms)) {
      if (rows.some((r) => r.key === k)) continue;
      rows.push({ key: k, label: k });
    }
    return rows;
  }

  function mergePlListById(list) {
    const out = [];
    const byId = new Map();
    for (const raw of normalizePlList(list)) {
      const idKey = normalizePlNameKey(raw.id || "");
      if (!idKey) { out.push(raw); continue; }
      const existing = byId.get(idKey);
      if (!existing) {
        byId.set(idKey, raw);
        out.push(raw);
        continue;
      }
      const aliases = new Set([...(existing.aliases || [])]);
      if (raw.name && raw.name !== existing.name) aliases.add(raw.name);
      (raw.aliases || []).forEach((alias) => { if (alias && alias !== existing.name) aliases.add(alias); });
      existing.aliases = [...aliases];
      if (existing.role !== "gm" && raw.role === "gm") existing.role = "gm";
    }
    return out;
  }

  const ICON_SAVE = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  const ICON_TRASH = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>`;
  const ICON_X = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  const ICON_REFRESH = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="pointer-events:none;"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`;
  // MUI EditIcon (코코포리아 스타일 연필)
  const ICON_PENCIL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style="pointer-events:none;"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
  // MUI CloseIcon (코코포리아 스타일 X)
  const ICON_X_SMALL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style="pointer-events:none;"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  // MUI DragIndicatorIcon (6-dot grip)
  const ICON_DRAG_HANDLE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" style="pointer-events:none;"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`;

  // #40 — 공개 본문 마크다운 서식 툴바.
  // format-sync 의 inline-toolbar 는 shadow DOM 경계 + 내부 editor state 의존성 때문에 직접 attach 불가.
  // 대신 renderMarkdown 이 이미 지원하는 마크다운 syntax (**bold**, *italic*, `code`, # heading, > quote,
  // - list, --- hr, [text](url)) 를 textarea 에 직접 삽입하는 경량 툴바를 제공.
  // 핸드아웃 편집 공통 WYSIWYG 서식 툴바 — 공개/비밀 본문(contenteditable) 양쪽 적용.
  function renderFormatToolbar() {
    return `
      <div class="handout-format-toolbar" data-format-toolbar="1">
        <button type="button" class="ft-btn" data-format-cmd="bold" title="굵게" aria-label="굵게"><b>B</b></button>
        <button type="button" class="ft-btn" data-format-cmd="italic" title="기울임" aria-label="기울임"><i>I</i></button>
        <button type="button" class="ft-btn" data-format-cmd="underline" title="밑줄" aria-label="밑줄"><u>U</u></button>
        <button type="button" class="ft-btn" data-format-cmd="strike" title="취소선" aria-label="취소선"><s>S</s></button>
        <button type="button" class="ft-btn" data-format-cmd="code" title="인라인 코드" aria-label="인라인 코드"><code>&lt;/&gt;</code></button>
        <span class="ft-sep" aria-hidden="true"></span>
        <button type="button" class="ft-btn" data-format-cmd="h1" title="제목 1" aria-label="제목 1">H1</button>
        <button type="button" class="ft-btn" data-format-cmd="h2" title="제목 2" aria-label="제목 2">H2</button>
        <button type="button" class="ft-btn" data-format-cmd="h3" title="제목 3" aria-label="제목 3">H3</button>
        <span class="ft-sep" aria-hidden="true"></span>
        <button type="button" class="ft-btn" data-format-cmd="list" title="목록" aria-label="목록">•</button>
        <button type="button" class="ft-btn" data-format-cmd="quote" title="인용" aria-label="인용">&ldquo;</button>
        <button type="button" class="ft-btn" data-format-cmd="hr" title="가로줄" aria-label="가로줄">―</button>
        <span class="ft-sep" aria-hidden="true"></span>
        <button type="button" class="ft-btn" data-format-cmd="align-left" title="왼쪽 정렬" aria-label="왼쪽 정렬">⯇</button>
        <button type="button" class="ft-btn" data-format-cmd="align-center" title="가운데 정렬" aria-label="가운데 정렬">⯈⯇</button>
        <button type="button" class="ft-btn" data-format-cmd="align-right" title="오른쪽 정렬" aria-label="오른쪽 정렬">⯈</button>
        <span class="ft-sep" aria-hidden="true"></span>
        <label class="ft-btn ft-color-btn" title="폰트 색상" aria-label="폰트 색상">
          <span>A</span>
          <input type="color" data-format-cmd="color" value="#ffffff" aria-label="색상 선택">
        </label>
      </div>
    `;
  }

  // textarea selection 을 before+selection+after 로 래핑. 선택 없으면 cursor 자리에 삽입.
  function wrapTextareaSelection(ta, before, after = before) {
    if (!(ta instanceof HTMLTextAreaElement)) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const selected = ta.value.substring(start, end);
    const insertion = before + selected + after;
    ta.setRangeText(insertion, start, end, "end");
    ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
    ta.focus();
  }

  // 현재 cursor 위치 줄의 시작 부분에 prefix 삽입. 선택 영역이면 선택 안 줄 모두에 prefix.
  function prefixTextareaLines(ta, prefix) {
    if (!(ta instanceof HTMLTextAreaElement)) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const value = ta.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    // 선택이 여러 줄에 걸치는 경우
    if (end > start) {
      const segment = value.substring(lineStart, end);
      const replaced = segment.split("\n").map((line) => prefix + line).join("\n");
      ta.setRangeText(replaced, lineStart, end, "end");
    } else {
      ta.setRangeText(prefix, lineStart, lineStart, "end");
    }
    ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
    ta.focus();
  }

  function insertTextareaText(ta, text) {
    if (!(ta instanceof HTMLTextAreaElement)) return;
    const start = ta.selectionStart ?? 0;
    ta.setRangeText(text, start, start, "end");
    ta.dispatchEvent(new InputEvent("input", { bubbles: true }));
    ta.focus();
  }

  // 마지막으로 focus 된 본문 editor (data-format-receiver="1" 인 contenteditable 또는 textarea).
  let lastFocusedFormatEditor = null;

  function isFormatReceiver(el) {
    return el instanceof HTMLElement && el.getAttribute && el.getAttribute("data-format-receiver") === "1";
  }

  function getCurrentFormatTargetEditor() {
    const active = state.shadow?.activeElement;
    if (isFormatReceiver(active)) return active;
    if (lastFocusedFormatEditor && state.shadow?.contains(lastFocusedFormatEditor)) {
      return lastFocusedFormatEditor;
    }
    return null;
  }

  // hint UI 제거됨 — no-op (이전 호출 부 호환용)
  function updateFormatToolbarTargetHint() {}

  // contenteditable 본문에 execCommand 적용. shadow 안 selection 유지를 위해
  // 명령 직전에 editor.focus() — selection 이 다른 곳으로 빠진 상태에서도 안전.
  function execEditor(editor, command, value = null) {
    if (!editor) return false;
    editor.focus();
    try {
      const ok = document.execCommand(command, false, value);
      editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return ok;
    } catch (_) { return false; }
  }

  function handleFormatToolbarCommand(cmd, editor, payload = null) {
    if (!cmd || !editor) return;
    switch (cmd) {
      case "bold":         execEditor(editor, "bold"); return;
      case "italic":       execEditor(editor, "italic"); return;
      case "underline":    execEditor(editor, "underline"); return;
      case "strike":       execEditor(editor, "strikeThrough"); return;
      case "code": {
        editor.focus();
        const sel = state.shadow?.getSelection?.() || window.getSelection();
        const text = sel?.toString?.() || "";
        const html = text ? `<code>${escapeHtml(text)}</code>` : `<code>코드</code>`;
        execEditor(editor, "insertHTML", html);
        return;
      }
      case "h1":           execEditor(editor, "formatBlock", "h1"); return;
      case "h2":           execEditor(editor, "formatBlock", "h2"); return;
      case "h3":           execEditor(editor, "formatBlock", "h3"); return;
      case "list":         execEditor(editor, "insertUnorderedList"); return;
      case "quote":        execEditor(editor, "formatBlock", "blockquote"); return;
      case "hr":           execEditor(editor, "insertHTML", "<hr>"); return;
      case "align-left":   execEditor(editor, "justifyLeft"); return;
      case "align-center": execEditor(editor, "justifyCenter"); return;
      case "align-right":  execEditor(editor, "justifyRight"); return;
      case "color": {
        const color = payload || "#ffffff";
        execEditor(editor, "foreColor", color);
        return;
      }
    }
  }

  function renderEdit() {
    // editingId === "new" → 새로 만들기 모드 (editing = null)
    // editingId === <uuid> → 편집 모드
    const editing = (state.editingId && state.editingId !== "new") ? findHandout(state.editingId) : null;
    if ((editing && !canManageHandout(editing)) || (state.editingId === "new" && !isAdminMode())) {
      return `
        <div class="field">
          <label>읽기 전용 핸드아웃</label>
          <div class="hint">현재 캐릭터는 이 핸드아웃의 GM 권한이 없습니다.</div>
        </div>
      `;
    }
    const base = editing || { id: "", title: "", image: "", description: "", gmNotes: "", permissions: {}, tags: [] };
    const h = ensurePermissions({ ...base, permissions: { ...(base.permissions || {}) } });
    // 폼 권한 상태 초기화 (editingId 변경 시마다 갱신)
    if (state.formPermissionsForId !== state.editingId) {
      state.formPermissions = JSON.parse(JSON.stringify(h.permissions || {}));
      state.formPermissionsForId = state.editingId;
    }
    const permH = { permissions: state.formPermissions };
    const rows = permissionRowKeys(h);
    const rowsHtml = rows.map((r) => {
      const key = r.key;
      const view = permFlag(permH, key, "view");
      const secret = permFlag(permH, key, "secret");
      const edit = permFlag(permH, key, "edit");
      return `
        <div class="perm-name">${escapeHtml(r.label)}</div>
        <div class="perm-cell"><input type="checkbox" data-perm-key="${escapeAttr(key)}" data-perm-col="view" ${view ? "checked" : ""}></div>
        <div class="perm-cell"><input type="checkbox" data-perm-key="${escapeAttr(key)}" data-perm-col="secret" ${secret ? "checked" : ""}></div>
        <div class="perm-cell"><input type="checkbox" data-perm-key="${escapeAttr(key)}" data-perm-col="edit" ${edit ? "checked" : ""}></div>
        <div class="perm-cell"><button class="popup-btn" data-action="row-popup" data-key="${escapeAttr(key)}">팝업</button></div>
      `;
    }).join("");

    return `
      <div class="handout-edit-header">
        <input class="title-input" type="text" data-field="title" value="${escapeHtml(h.title)}" placeholder="핸드아웃 제목">
        ${editing ? `<button class="action-icon" data-action="delete-handout" data-id="${escapeHtml(editing.id)}" title="삭제" aria-label="삭제">${ICON_TRASH}</button>` : ""}
      </div>
      ${renderFormatToolbar()}
      <div class="handout-edit-cols">
        <div class="col">
          <label>공개 핸드아웃</label>
          <div class="rich-editor" contenteditable="true" data-field="description" data-format-receiver="1" data-placeholder="공개 핸드아웃 본문...">${renderHandoutBody(h.description)}</div>
        </div>
        <div class="col">
          <label>비밀 핸드아웃</label>
          <div class="rich-editor" contenteditable="true" data-field="gmNotes" data-format-receiver="1" data-placeholder="비밀 핸드아웃 본문...">${renderHandoutBody(h.gmNotes)}</div>
        </div>
      </div>
      <div class="perm-section">
        <div class="perm-title">플레이어 권한</div>
        <div class="perm-grid">
          <div class="head name-col">이름</div>
          <div class="head">공개</div>
          <div class="head">비밀</div>
          <div class="head">수정</div>
          <div class="head">팝업</div>
          ${rowsHtml}
        </div>
      </div>
      <input type="hidden" data-field="image" value="${escapeHtml(h.image || "")}">
    `;
  }

  function renderSettingsPlList() {
    const list = Array.isArray(state.data?.plList) ? state.data.plList : [];
    if (!list.length) {
      return `<div class="settings-pl-empty">등록된 플레이어가 없습니다.</div>`;
    }
    const rows = list.map((pl) => {
      const role = pl?.role === "gm" ? "gm" : "player";
      const roleLabel = role === "gm" ? "GM" : "PL";
      const name = pl?.name ? String(pl.name) : "(이름 없음)";
      const id = pl?.id ? String(pl.id) : "";
      const aliases = Array.isArray(pl?.aliases) ? pl.aliases.filter((a) => a) : [];
      const merged = aliases.length > 0 ? "1" : "0";
      const perms = aggregatePermissionsForPl(pl);
      const aliasHtml = aliases.map((a) => `<span class="settings-pl-alias" title="${escapeAttr(a)}">${escapeHtml(a)}</span>`).join("");
      return `
        <div class="settings-pl-row" data-pl-role="${role}" data-pl-merged="${merged}">
          <span class="settings-pl-strip" aria-hidden="true"></span>
          <div class="settings-pl-main">
            <div class="settings-pl-name-row">
              <span class="settings-pl-name" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
              <span class="settings-pl-role">${roleLabel}</span>
              ${id ? `<span class="settings-pl-id">#${escapeHtml(id)}</span>` : ""}
            </div>
            ${aliases.length ? `<div class="settings-pl-aliases">${aliasHtml}</div>` : ""}
          </div>
          <div class="settings-pl-signals" aria-label="권한 신호등 (전체 핸드아웃 집계)">
            <span class="settings-pl-dot" data-perm="view"   data-on="${perms.view   ? "1" : "0"}" title="공개${perms.view   ? "" : " (없음)"}"></span>
            <span class="settings-pl-dot" data-perm="secret" data-on="${perms.secret ? "1" : "0"}" title="비밀${perms.secret ? "" : " (없음)"}"></span>
            <span class="settings-pl-dot" data-perm="edit"   data-on="${perms.edit   ? "1" : "0"}" title="수정${perms.edit   ? "" : " (없음)"}"></span>
          </div>
        </div>
      `;
    }).join("");
    return `<div class="settings-pl-list">${rows}</div>`;
  }

  function renderSettings() {
    const plCount = (state.data.plList || []).length;
    const myChars = state.myCharacterOptions || [];
    const current = state.data.myCharacter || "";
    const allOpts = [...myChars];
    if (current && !allOpts.includes(current)) allOpts.unshift(current);
    const options = `<option value="">(미설정)</option>` + allOpts.map((c) => {
      const label = (c === current && !myChars.includes(c)) ? `${c} (저장됨)` : c;
      return `<option value="${escapeAttr(c)}" ${c === current ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
    return `
      <div class="field">
        <label>GM 설정</label>
        <div class="row">
          <select class="settings-select" data-field="myCharacter" style="flex:1;">${options}</select>
          <button class="settings-icon-btn" data-action="reload-my-characters" title="목록 새로고침" aria-label="목록 새로고침">${ICON_REFRESH}</button>
        </div>
      </div>
      <div class="field">
        <label>플레이어 목록</label>
        <div class="row">
          <button class="btn secondary small" data-action="pl-modal-open">PL 목록 관리</button>
          <span class="hint" style="margin:0 0 0 8px;">현재 ${plCount}명 등록됨.</span>
        </div>
        ${renderSettingsPlList()}
      </div>
    `;
  }

  // 코코포리아 "내 캐릭터 목록" 패널에서 캐릭터 이름들 추출
  function scanMyCharacters() {
    const titles = new Set(PANEL_TITLES_MY_CHARS.map(removeSpaces));
    const h6s = Array.from(document.querySelectorAll("h6"));
    const titleEl = h6s.find((h) => titles.has(removeSpaces(h.textContent)));
    if (!titleEl) return null; // 패널 자체 못 찾음
    const panel = titleEl.closest("div.MuiPaper-root.MuiPaper-elevation6")
              || titleEl.closest("div.MuiPaper-root");
    if (!panel) return null;
    const spans = Array.from(panel.querySelectorAll("span.MuiListItemText-primary"));
    const names = [];
    for (const s of spans) {
      const t = removeSpaces(s.textContent);
      if (t && !names.includes(t)) names.push(t);
    }
    return names;
  }

  // 패널 닫혀 있으면 토글 버튼 click() 후 잠깐 대기
  async function ensureCharPanelOpen() {
    if (scanMyCharacters() !== null) return true;
    const btn = findCharacterToolbarButton();
    if (!btn) return false;
    btn.click();
    // React 렌더 + 사이드패널 열림 애니메이션 대기
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 80));
      if (scanMyCharacters() !== null) return true;
    }
    return scanMyCharacters() !== null;
  }

  // myCharacter 자동 감지 — input[name="name"] 의 visible 값 (코코포리아 채팅 발화 캐릭터)
  async function autoDetectMyCharacter({ force = false } = {}) {
    if (!active) return null;
    if (!force && state.data.myCharacter) return null;
    const inputs = Array.from(document.querySelectorAll('input[name="name"]'));
    const visible = inputs.find((i) => i.offsetParent !== null && !i.disabled);
    const name = (visible?.value || "").trim();
    if (!name) {
      console.info("[ccf-handout] auto-detect myCharacter: no visible name input");
      return null;
    }
    if (state.data.myCharacter === name) return name;
    state.data.myCharacter = name;
    try { await saveAll(state.data); } catch (_) {}
    console.info("[ccf-handout] myCharacter auto-detected:", name);
    if (state.isOpen) render();
    return name;
  }

  // input[name="name"] 변경 감시 — myCharacter 비어있을 때만 자동 채움
  function watchMyCharacterInput() {
    if (!active) return;
    if (watchMyCharacterInput._bound) return;
    watchMyCharacterInput._bound = true;
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.name !== "name") return;
      if (state.data.myCharacter) return; // 이미 설정됨
      const name = (t.value || "").trim();
      if (!name) return;
      state.data.myCharacter = name;
      saveAll(state.data).catch(() => {});
      console.info("[ccf-handout] myCharacter detected on input change:", name);
      if (state.isOpen) render();
    }, true);
  }

  async function reloadMyCharacterOptions() {
    const opened = await ensureCharPanelOpen();
    if (!opened) {
      toast("'내 캐릭터 목록' 패널을 찾지 못했습니다.");
      return;
    }
    const names = scanMyCharacters();
    if (!names || !names.length) {
      toast("패널은 열렸지만 캐릭터가 비어있습니다.");
      state.myCharacterOptions = [];
      render();
      return;
    }
    state.myCharacterOptions = names;
    state.data.myCharacterOptions = names;
    try { await saveAll(state.data); } catch (error) { console.warn("[ccf-handout] myCharacterOptions save failed", error); }
    toast(`캐릭터 ${names.length}명 불러옴`);
    render();
  }

  // ===== 이벤트 핸들러 =====
  function onShadowClick(event) {
    const tabBtn = event.target.closest(".tab");
    if (tabBtn) {
      if (tabBtn.dataset.tab === "settings" && !isAdminMode()) return;
      setTab(tabBtn.dataset.tab);
      return;
    }
    const aliasChip = event.target.closest(".pl-alias-chip");
    if (aliasChip) {
      togglePlAliasChip(aliasChip);
      return;
    }
    // #40 — WYSIWYG 서식 툴바 (공용, 현재 focus 또는 마지막 focus 된 본문 editor 대상)
    const formatBtn = event.target.closest("button[data-format-cmd]");
    if (formatBtn) {
      event.preventDefault();
      const cmd = formatBtn.getAttribute("data-format-cmd");
      const editor = getCurrentFormatTargetEditor();
      if (!editor) {
        toast("공개 또는 비밀 본문 입력칸을 먼저 클릭해주세요.");
        return;
      }
      handleFormatToolbarCommand(cmd, editor);
      return;
    }
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    console.info("[ccf-handout] click", action, id || "");
    if (action === "close") { closePanel(); return; }
    if (action === "new-handout") {
      if (!isAdminMode()) return;
      state.editingId = "new"; state.formPermissionsForId = null; setTab("edit"); return;
    }
    if (action === "edit-handout") {
      const h = findHandout(id);
      if (!canManageHandout(h)) return;
      state.editingId = id; state.formPermissionsForId = null; setTab("edit"); return;
    }
    if (action === "view-handout") { openDetail(id); return; }
    if (action === "delete-handout") { deleteHandout(id); return; }
    if (action === "show-to-players") { showToPlayersPlaceholder(id); return; }
    if (action === "save-handout") { saveHandoutFromForm(); return; }
    if (action === "cancel-edit") { state.editingId = null; state.formPermissionsForId = null; setTab("list"); return; }
    if (action === "save-settings") { saveSettingsFromForm(); return; }
    if (action === "export") { exportJson(); return; }
    if (action === "import") { importJson(); return; }
    if (action === "close-detail") { closeDetail(); return; }
    if (action === "toggle-detail-secret") { toggleDetailSecret(btn); return; }
    if (action === "row-popup") { rowPopupPlaceholder(btn.dataset.key); return; }
    if (action === "pl-modal-open") { openPlListDialog(); return; }
    if (action === "pl-modal-close") { closePlListDialog(); return; }
    if (action === "pl-modal-add") { addPlRow(); return; }
    if (action === "pl-modal-merge") { mergeSelectedPlRows(); return; }
    if (action === "pl-modal-unmerge") { unmergeSelectedAliases(); return; }
    if (action === "pl-modal-refresh") { refreshPlListInDialog(); return; }
    if (action === "pl-modal-save") { savePlListFromDialog(); return; }
    if (action === "pl-modal-row-remove") { removePlRow(btn); return; }
    if (action === "reload-my-characters") { reloadMyCharacterOptions(); return; }
  }

  function onShadowChange(event) {
    // 폰트 색상 picker — 선택된 색상을 현재 본문 editor 에 적용
    const colorInp = event.target.closest('input[type="color"][data-format-cmd="color"]');
    if (colorInp) {
      const editor = getCurrentFormatTargetEditor();
      if (!editor) {
        toast("공개 또는 비밀 본문 입력칸을 먼저 클릭해주세요.");
        return;
      }
      handleFormatToolbarCommand("color", editor, colorInp.value);
      return;
    }
    const cb = event.target.closest('input[data-action="toggle-pl-preview"]');
    if (cb) {
      state.plPreview = !!cb.checked;
      render();
      return;
    }
    const perm = event.target.closest('input[data-perm-key][data-perm-col]');
    if (perm) {
      const key = perm.dataset.permKey;
      const col = perm.dataset.permCol;
      if (!state.formPermissions[key]) state.formPermissions[key] = { view: false, secret: false, edit: false };
      state.formPermissions[key][col] = !!perm.checked;
      return;
    }
    const roleSel = event.target.closest('.pl-row select[data-pl-field="role"]');
    if (roleSel) {
      const row = roleSel.closest('.pl-row');
      if (row) row.setAttribute('data-pl-role', roleSel.value === 'gm' ? 'gm' : 'player');
      return;
    }
  }

  function rowPopupPlaceholder(key) {
    // 호환용 — 권한 표 행별 팝업 버튼 핸들러. 편집 중인 handout이 있어야 의미 있음.
    const handoutId = (state.editingId && state.editingId !== "new") ? state.editingId : null;
    if (!handoutId) {
      toast("편집 중인 핸드아웃을 먼저 저장해주세요.");
      return;
    }
    rowPopupSend(handoutId, key);
  }

  // ===== 핸드아웃 D&D 정렬 (#33) =====
  let handoutDragState = null;

  function onShadowPointerDown(event) {
    const handle = event.target.closest('[data-handout-drag-handle="1"]');
    if (!handle) return;
    if (event.button !== 0) return;
    if (!isAdminMode()) return;
    const card = handle.closest('.card');
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    handoutDragState = {
      pointerId: event.pointerId,
      cardId: card.dataset.id
    };
    card.setAttribute('data-dragging', '1');
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function onShadowPointerMove(event) {
    if (!handoutDragState || event.pointerId !== handoutDragState.pointerId) return;
    const list = state.shadow?.querySelector('.list');
    if (!list) return;
    const cards = Array.from(list.querySelectorAll('.card'));
    cards.forEach((c) => c.removeAttribute('data-drag-over'));
    for (const c of cards) {
      if (c.dataset.id === handoutDragState.cardId) continue;
      const rect = c.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        const mid = rect.top + rect.height / 2;
        c.setAttribute('data-drag-over', event.clientY < mid ? 'above' : 'below');
        break;
      }
    }
  }

  function onShadowPointerEnd(event) {
    if (!handoutDragState || event.pointerId !== handoutDragState.pointerId) return;
    const draggedId = handoutDragState.cardId;
    handoutDragState = null;
    const list = state.shadow?.querySelector('.list');
    if (!list) return;
    const cards = Array.from(list.querySelectorAll('.card'));
    let target = null, pos = null;
    for (const c of cards) {
      const over = c.getAttribute('data-drag-over');
      if (over) { target = c; pos = over; }
      c.removeAttribute('data-drag-over');
      c.removeAttribute('data-dragging');
    }
    if (!target || !pos || target.dataset.id === draggedId) return;
    const dragged = findHandout(draggedId);
    const targetHandout = findHandout(target.dataset.id);
    if (!dragged || !targetHandout) return;
    const newOrder = computeInsertOrder(dragged, targetHandout, pos);
    if (!Number.isFinite(newOrder)) return;
    dragged.order = newOrder;
    saveAll(state.data).catch((error) => console.warn("[ccf-handout] saveAll failed:", error));
    // Firestore 부분 업데이트 — 변경된 항목만 push (관리자 본인이 만든 핸드아웃만)
    if (!dragged._remote) {
      pushHandoutToFirestore(dragged).catch((error) => {
        console.warn("[ccf-handout] order push 실패:", error);
      });
    }
    render();
  }

  // dragged 를 target 의 above/below 위치로 옮길 때 새 order 계산.
  // 정밀도 한계 도달 시 가장자리에 step 단위로 부여 (다음 슬라이스에서 renumber 헬퍼 추가 가능).
  function computeInsertOrder(dragged, target, pos) {
    const sorted = state.data.handouts
      .filter((h) => h && h.id !== dragged.id)
      .sort(compareByOrder);
    const targetIdx = sorted.findIndex((h) => h.id === target.id);
    if (targetIdx === -1) return getNextOrder();
    let prevOrder, nextOrder;
    if (pos === 'above') {
      prevOrder = targetIdx > 0 ? sorted[targetIdx - 1].order : null;
      nextOrder = sorted[targetIdx].order;
    } else {
      prevOrder = sorted[targetIdx].order;
      nextOrder = targetIdx < sorted.length - 1 ? sorted[targetIdx + 1].order : null;
    }
    if (!Number.isFinite(prevOrder) && !Number.isFinite(nextOrder)) return ORDER_STEP;
    if (!Number.isFinite(prevOrder)) return nextOrder - ORDER_STEP;
    if (!Number.isFinite(nextOrder)) return prevOrder + ORDER_STEP;
    const mid = (prevOrder + nextOrder) / 2;
    if (mid === prevOrder || mid === nextOrder) {
      // 정밀도 한계 — 경고만 남기고 prev+1 사용 (충분한 floating point 여유 남음)
      console.warn("[ccf-handout] order precision close — consider renumber");
      return prevOrder + 1;
    }
    return mid;
  }

  // 본문 editor focus 추적 — 서식 툴바 대상 결정
  function onShadowFocusIn(event) {
    if (isFormatReceiver(event.target)) {
      lastFocusedFormatEditor = event.target;
    }
  }

  // 본문 editor paste — 이미지 클립보드 / 이미지 URL / 일반 URL 자동 처리
  function onShadowPaste(event) {
    const editor = event.target instanceof Element ? event.target.closest('.rich-editor[contenteditable="true"]') : null;
    if (!editor) return;
    const cd = event.clipboardData;
    if (!cd) return;
    // 1) 이미지 파일 (스크린샷 등) — data URL 로 변환해 <img> 삽입
    const items = cd.items || [];
    for (const item of items) {
      if (item && item.kind === "file" && item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          editor.focus();
          execEditor(editor, "insertImage", String(reader.result || ""));
        };
        reader.readAsDataURL(file);
        return;
      }
    }
    // 2) 텍스트가 URL 한 줄 — 이미지 확장자면 <img>, 아니면 <a>
    const text = (cd.getData("text/plain") || "").trim();
    if (/^https?:\/\/\S+$/i.test(text)) {
      event.preventDefault();
      editor.focus();
      if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?|#|$)/i.test(text)) {
        execEditor(editor, "insertImage", text);
      } else {
        const sel = state.shadow?.getSelection?.() || window.getSelection();
        const hasSelection = !!(sel && String(sel).length > 0);
        if (hasSelection) {
          execEditor(editor, "createLink", text);
        } else {
          execEditor(editor, "insertHTML",
            `<a href="${escapeAttr(text)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`);
        }
      }
      return;
    }
    // 그 외: 브라우저 기본 paste 진행
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
    if (!el) return "";
    // contenteditable 본문 (rich-editor) 은 innerHTML 사용
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
      return el.innerHTML || "";
    }
    return el.value || "";
  }

  async function saveHandoutFromForm() {
    const title = getFieldValue("title").trim();
    if (!title) { toast("제목을 입력해주세요."); return; }
    const image = getFieldValue("image").trim();
    const description = getFieldValue("description");
    const gmNotes = getFieldValue("gmNotes");
    // 권한 — formPermissions 에서 비어있는(모두 false) 항목은 정리
    const permissions = {};
    for (const [k, v] of Object.entries(state.formPermissions || {})) {
      if (v && (v.view || v.secret || v.edit)) {
        permissions[k] = { view: !!v.view, secret: !!v.secret, edit: !!v.edit };
      }
    }
    const isNew = !state.editingId || state.editingId === "new";
    const id = isNew ? uuid() : state.editingId;
    const now = new Date().toISOString();
    const existing = isNew ? null : findHandout(state.editingId);
    const handout = {
      id, title, image, description, gmNotes, permissions,
      tags: existing?.tags || [],
      ownerUid: existing?.ownerUid,
      ownerName: existing?.ownerName,
      _remote: existing?._remote === true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      // order: 기존이면 유지, 신규면 getNextOrder 로 끝에 부여 (#32 사양)
      order: existing && Number.isFinite(existing.order) ? existing.order : getNextOrder()
    };
    if (existing) {
      const idx = state.data.handouts.findIndex((h) => h.id === id);
      state.data.handouts[idx] = handout;
    } else {
      state.data.handouts.push(handout);
    }
    await saveAll(state.data);
    state.editingId = null;
    state.formPermissionsForId = null;
    state.formPermissions = {};
    toast(existing ? "변경 저장됨" : "새 핸드아웃 추가됨");
    setTab("list");
    // Firestore에도 push (실패해도 local 저장은 유지)
    pushHandoutToFirestore(handout).catch((error) => {
      console.warn("[ccf-handout] Firestore push 실패:", error);
      toast("송신 실패 — 콘솔 확인 (로컬은 저장됨)");
    });
  }

  async function saveSettingsFromForm() {
    const me = getFieldValue("myCharacter").trim();
    state.data.myCharacter = me;
    state.data.myCharacterOptions = state.myCharacterOptions;
    await saveAll(state.data);
    toast("설정 저장됨");
    render();
  }

  // ===== PL 목록 관리 모달 =====
  function buildPlListForDialog() {
    const base = mergePlListById(state.data.plList || []).filter((p) => p && (p.name || p.id || (p.aliases || []).length));
    const adminName = String(state.data.myCharacter || "").trim();
    if (!adminName) return base;
    const adminKey = normalizePlNameKey(adminName);
    const exists = base.some((p) => {
      if (normalizePlNameKey(p.name) === adminKey) return true;
      return (p.aliases || []).some((alias) => normalizePlNameKey(alias) === adminKey);
    });
    if (exists) {
      return base.map((p) => {
        const nameMatches = normalizePlNameKey(p.name) === adminKey;
        const aliasMatches = (p.aliases || []).some((alias) => normalizePlNameKey(alias) === adminKey);
        return nameMatches || aliasMatches ? { ...p, _isAdmin: true } : p;
      });
    }
    return [{ name: adminName, id: "", role: "gm", aliases: [], _isAdmin: true }, ...base];
  }

  function colorForPlId(idKey) {
    if (!idKey) return null;
    let h = 0;
    for (const c of String(idKey)) h = ((h * 31) + c.charCodeAt(0)) & 0xffff;
    return `hsl(${h % 360}, 65%, 55%)`;
  }

  function openPlListDialog() {
    const overlay = state.shadow?.querySelector(".pl-modal-overlay");
    if (!overlay) return;
    const host = overlay.querySelector("[data-pl-rows-host]");
    host.innerHTML = "";
    const list = buildPlListForDialog();
    if (!list.length) list.push({ name: "", id: "", role: "player" });
    for (const item of list) appendPlRow(host, item);
    overlay.setAttribute("data-pl-modal-open", "1");
  }

  function closePlListDialog() {
    state.shadow?.querySelector(".pl-modal-overlay")?.setAttribute("data-pl-modal-open", "0");
  }

  function appendPlRow(host, item) {
    const row = document.createElement("div");
    row.className = "pl-row";
    row.innerHTML = `
      <div class="pl-row-main">
        <input class="pl-merge-check" type="checkbox" data-pl-merge-check title="병합 선택" aria-label="병합 선택">
        <input type="text" placeholder="대표 이름" data-pl-field="name">
        <input type="text" placeholder="ID" title="같은 ID끼리 병합됨" data-pl-field="id">
        <select data-pl-field="role">
          <option value="player">PL</option>
          <option value="gm">GM</option>
        </select>
        <button class="row-x" data-action="pl-modal-row-remove" title="행 삭제" aria-label="행 삭제">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="pl-row-meta">
        <div class="pl-row-aliases" data-pl-aliases-display hidden></div>
        <div class="pl-row-id-badge-slot" data-pl-id-badge hidden></div>
      </div>
      <div class="pl-row-badges" data-pl-badges hidden></div>
    `;
    host.appendChild(row);
    writePlRow(row, item || { name: "", id: "", role: "player", aliases: [] });
  }

  async function refreshPlListInDialog() {
    const host = state.shadow?.querySelector(".pl-modal-overlay [data-pl-rows-host]");
    if (!host) return;
    state.chatSeenAuthors.clear();
    try { scanCurrentBottomChatAuthors(); } catch (error) { console.warn("[ccf-handout] chat rescan failed", error); }
    await new Promise((resolve) => setTimeout(resolve, 120));

    const currentRows = Array.from(host.querySelectorAll(".pl-row"));
    const currentItems = currentRows.map(readPlRow).filter(Boolean);
    const currentKeys = new Set();
    currentItems.forEach((item) => {
      if (item.name) currentKeys.add(normalizePlNameKey(item.name));
      if (item.id) currentKeys.add("id:" + normalizePlNameKey(item.id));
      (item.aliases || []).forEach((alias) => currentKeys.add(normalizePlNameKey(alias)));
    });

    const known = buildPlListForDialog();
    const missing = known.filter((p) => {
      const nameKey = normalizePlNameKey(p.name);
      const idKey = p.id ? "id:" + normalizePlNameKey(p.id) : "";
      if (nameKey && currentKeys.has(nameKey)) return false;
      if (idKey && currentKeys.has(idKey)) return false;
      const aliasMatch = (p.aliases || []).some((alias) => currentKeys.has(normalizePlNameKey(alias)));
      if (aliasMatch) return false;
      return true;
    });

    if (currentRows.length === 1) {
      const only = currentItems[0];
      if (!only) host.innerHTML = "";
    }

    for (const item of missing) appendPlRow(host, item);
    toast(missing.length ? `${missing.length}명 복구됨` : "복구할 PL이 없습니다.");
  }

  function addPlRow() {
    const host = state.shadow?.querySelector(".pl-modal-overlay [data-pl-rows-host]");
    if (!host) return;
    appendPlRow(host, { name: "", id: "", role: "player" });
  }

  function removePlRow(btn) {
    const row = btn.closest(".pl-row");
    if (!row) return;
    const host = row.parentElement;
    row.remove();
    if (host && host.children.length === 0) appendPlRow(host, { name: "", id: "", role: "player" });
  }

  function readPlRow(row) {
    if (!(row instanceof HTMLElement)) return null;
    const name = row.querySelector('[data-pl-field="name"]')?.value.trim() || "";
    const id = row.querySelector('[data-pl-field="id"]')?.value.trim() || "";
    const role = row.querySelector('[data-pl-field="role"]')?.value === "gm" ? "gm" : "player";
    let aliases = [];
    try {
      const stored = row.getAttribute("data-pl-aliases-json");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) aliases = parsed.filter(Boolean);
      }
    } catch (error) { /* ignore */ }
    if (!aliases.length) aliases = findExistingPlAliases(name, id);
    const isAdmin = row.getAttribute("data-pl-admin") === "1";
    return name ? { name, id, role, aliases, _isAdmin: isAdmin } : null;
  }

  function writePlRow(row, item) {
    if (!(row instanceof HTMLElement) || !item) return;
    const nameEl = row.querySelector('[data-pl-field="name"]');
    const idEl = row.querySelector('[data-pl-field="id"]');
    const roleEl = row.querySelector('[data-pl-field="role"]');
    if (nameEl) nameEl.value = item.name || "";
    if (idEl) idEl.value = item.id || "";
    if (roleEl) roleEl.value = item.role === "gm" ? "gm" : "player";

    const idKey = normalizePlNameKey(item.id || "");
    if (item._isAdmin) row.setAttribute("data-pl-admin", "1");
    else row.removeAttribute("data-pl-admin");
    row.setAttribute("data-pl-role", item.role === "gm" ? "gm" : "player");

    const aliases = (item.aliases || []).filter(Boolean);
    row.setAttribute("data-pl-aliases-json", JSON.stringify(aliases));
    if (aliases.length) row.setAttribute("data-pl-merged", "1");
    else row.removeAttribute("data-pl-merged");

    const aliasEl = row.querySelector("[data-pl-aliases-display]");
    if (aliasEl) {
      if (aliases.length) {
        aliasEl.innerHTML = aliases
          .map((alias) => `<span class="pl-alias-chip" data-alias="${escapeAttr(alias)}">${escapeHtml(alias)}</span>`)
          .join("");
        aliasEl.hidden = false;
      } else {
        aliasEl.innerHTML = "";
        aliasEl.hidden = true;
      }
    }

    const idBadgeEl = row.querySelector("[data-pl-id-badge]");
    if (idBadgeEl) {
      if (idKey) {
        idBadgeEl.innerHTML = `<span class="pl-badge" data-kind="group">ID: ${escapeHtml(item.id)}</span>`;
        idBadgeEl.hidden = false;
      } else {
        idBadgeEl.innerHTML = "";
        idBadgeEl.hidden = true;
      }
    }

    const badgeEl = row.querySelector("[data-pl-badges]");
    if (badgeEl) {
      badgeEl.innerHTML = "";
      badgeEl.hidden = true;
    }
  }

  function mergeSelectedPlRows() {
    const host = state.shadow?.querySelector(".pl-modal-overlay [data-pl-rows-host]");
    if (!host) return;
    const selected = Array.from(host.querySelectorAll(".pl-row"))
      .filter((row) => row.querySelector("[data-pl-merge-check]")?.checked);
    if (selected.length < 2) { toast("병합할 행을 2개 이상 선택하세요."); return; }

    const items = selected.map(readPlRow).filter(Boolean);
    if (items.length < 2) { toast("병합할 이름이 부족합니다."); return; }
    const base = { ...items[0], aliases: [...(items[0].aliases || [])] };
    const aliases = new Set(base.aliases || []);
    for (const item of items.slice(1)) {
      if (item.name && item.name !== base.name) aliases.add(item.name);
      (item.aliases || []).forEach((alias) => { if (alias && alias !== base.name) aliases.add(alias); });
      if (!base.id && item.id) base.id = item.id;
      if (base.role !== "gm" && item.role === "gm") base.role = "gm";
      if (item._isAdmin) base._isAdmin = true;
    }
    base.aliases = [...aliases];
    writePlRow(selected[0], base);
    selected.slice(1).forEach((row) => row.remove());
    selected[0].querySelector("[data-pl-merge-check]").checked = false;
    toast(`${items.length}개 행 병합됨`);
  }

  function togglePlAliasChip(chip) {
    if (!(chip instanceof HTMLElement)) return;
    const selected = chip.getAttribute("data-selected") === "1";
    if (selected) chip.removeAttribute("data-selected");
    else chip.setAttribute("data-selected", "1");
    updateUnmergeButtonVisibility();
  }

  function updateUnmergeButtonVisibility() {
    const overlay = state.shadow?.querySelector(".pl-modal-overlay");
    if (!overlay) return;
    const anySelected = !!overlay.querySelector('.pl-alias-chip[data-selected="1"]');
    const btn = overlay.querySelector('[data-action="pl-modal-unmerge"]');
    if (btn) btn.hidden = !anySelected;
  }

  function unmergeSelectedAliases() {
    const host = state.shadow?.querySelector(".pl-modal-overlay [data-pl-rows-host]");
    if (!host) return;
    const rows = Array.from(host.querySelectorAll(".pl-row"));
    const splitOff = [];
    for (const row of rows) {
      const selectedChips = Array.from(row.querySelectorAll('.pl-alias-chip[data-selected="1"]'));
      if (!selectedChips.length) continue;
      const item = readPlRow(row);
      if (!item) continue;
      const selectedNames = selectedChips.map((c) => c.dataset.alias || c.textContent.trim()).filter(Boolean);
      const remaining = (item.aliases || []).filter((alias) => !selectedNames.includes(alias));
      item.aliases = remaining;
      writePlRow(row, item);
      for (const aliasName of selectedNames) {
        splitOff.push({ name: aliasName, id: item.id, role: "player", aliases: [] });
      }
    }
    for (const newItem of splitOff) appendPlRow(host, newItem);
    updateUnmergeButtonVisibility();
    if (splitOff.length) toast(`${splitOff.length}명 분리됨 (ID 동일 그룹 유지)`);
  }

  function findExistingPlAliases(name, id) {
    const nameKey = normalizePlNameKey(name);
    const idKey = normalizePlNameKey(id);
    const found = (state.data.plList || []).find((p) => {
      if (idKey && normalizePlNameKey(p.id) === idKey) return true;
      return normalizePlNameKey(p.name) === nameKey;
    });
    return Array.isArray(found?.aliases) ? found.aliases : [];
  }

  async function savePlListFromDialog() {
    const host = state.shadow?.querySelector(".pl-modal-overlay [data-pl-rows-host]");
    if (!host) return;
    const items = [];
    host.querySelectorAll(".pl-row").forEach((row) => {
      const item = readPlRow(row);
      if (item) items.push(item);
    });
    state.data.plList = mergePlListById(items);
    await saveAll(state.data);
    closePlListDialog();
    toast(`PL 목록 ${items.length}명 저장됨`);
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
    // Firestore에서도 삭제
    deleteHandoutFromFirestore(id).catch((error) => {
      console.warn("[ccf-handout] Firestore delete 실패:", error);
    });
  }

  // ===== 상세 다이얼로그 (Roll20 핸드아웃 다이얼로그 모방) =====
  function openDetail(id) {
    const h = findHandout(id);
    if (!h) return;
    const me = state.data.myCharacter;
    const adminMode = isAdminMode();
    const previewAsPl = adminMode && state.plPreview && !!me;
    const permissionName = getPermissionCharacterName();
    const canSecret = previewAsPl ? canViewSecret(h, me) : (adminMode || h._canSecret === true || canViewSecret(h, permissionName));
    const hasSecret = !!(h.gmNotes && h.gmNotes.trim());
    const manageable = canManageHandout(h);
    const body = state.shadow.querySelector(".body");
    body.innerHTML = `
      <div class="row" style="margin-bottom:12px;">
        <button class="btn secondary small" data-action="close-detail">← 목록</button>
        ${manageable ? `<button class="btn secondary small" data-action="edit-handout" data-id="${escapeHtml(h.id)}">편집</button>` : ""}
        ${adminMode ? `<button class="btn secondary small" data-action="show-to-players" data-id="${escapeHtml(h.id)}">Show to Players</button>` : ""}
        ${hasSecret && canSecret && adminMode ? `<button class="btn secondary small" data-action="toggle-detail-secret" data-show="1">GM Notes 숨기기</button>` : ""}
        <span class="spacer" style="flex:1"></span>
        <span class="meta">${adminMode ? (previewAsPl ? "PL 시점" : "GM 시점") : "PL 시점"}</span>
      </div>
      <h2 style="margin:8px 0 4px 0;">${escapeHtml(h.title || "(제목 없음)")}</h2>
      ${h.image ? `<img class="detail-img" src="${escapeHtml(h.image)}" alt="">` : ""}
      <div class="preview" style="max-height:none;">${renderHandoutBody(h.description)}</div>
      ${hasSecret ? (
        canSecret
          ? `<div class="secret-block" data-secret-block="1"><div class="secret-head">🔒 GM NOTES (비밀)</div><div class="preview" style="max-height:none; background:transparent; border:0; padding:0;">${renderHandoutBody(h.gmNotes)}</div></div>`
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
    // 관리자 본인 화면에도 즉시 표시 (#52 — Firestore roundtrip 이전에 로컬 표시)
    try { showHandoutModal(h, state.data.myCharacter || ""); } catch (_) {}
    sendShowSignal(id, "all").then(() => {
      toast(`"${h.title}" 권한자 전체에게 팝업 송신됨`);
    }).catch((error) => {
      console.error("[ccf-handout] show send failed:", error);
      toast("팝업 송신 실패 — 콘솔 확인");
    });
  }

  function rowPopupSend(handoutId, audienceKey) {
    const h = findHandout(handoutId);
    if (!h) return;
    // 관리자 본인 화면에도 즉시 표시 (#52)
    try { showHandoutModal(h, state.data.myCharacter || ""); } catch (_) {}
    sendShowSignal(handoutId, audienceKey).then(() => {
      const label = audienceKey === ALL_KEY ? "플레이어 전체" : audienceKey;
      toast(`"${h.title}" → ${label} 팝업 송신됨`);
    }).catch((error) => {
      console.error("[ccf-handout] row show failed:", error);
      toast("팝업 송신 실패 — 콘솔 확인");
    });
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
          myCharacter: typeof parsed.myCharacter === "string" ? parsed.myCharacter : state.data.myCharacter,
          myCharacterOptions: Array.isArray(parsed.myCharacterOptions) ? parsed.myCharacterOptions : state.myCharacterOptions,
          plList: normalizePlList(parsed.plList || state.data.plList)
        };
        state.myCharacterOptions = Array.isArray(state.data.myCharacterOptions) ? state.data.myCharacterOptions : [];
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
        loadAll().then((d) => {
          state.data = d;
          state.myCharacterOptions = Array.isArray(d.myCharacterOptions) ? d.myCharacterOptions : [];
          resetChatSeenAuthorsForRoom(room);
          if (state.isOpen) render();
          if (fbState) {
            subscribeToRoomHandouts().catch(() => {});
            subscribeToRoomShows().catch(() => {});
          }
        }).catch(() => {});
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
          loadAll().then((d) => {
          state.data = d;
          state.myCharacterOptions = Array.isArray(d.myCharacterOptions) ? d.myCharacterOptions : [];
          resetChatSeenAuthorsForRoom(room);
          if (state.isOpen) render();
          if (fbState) {
            subscribeToRoomHandouts().catch(() => {});
            subscribeToRoomShows().catch(() => {});
          }
        }).catch(() => {});
        }
      }, 50);
    };
    window.addEventListener("popstate", handler, { signal });
    window.addEventListener("hashchange", handler, { signal });
    window.addEventListener("capybara-toolkit:route-change", handler, { signal });
  }

  // ESC: 모달 스택 우선순위 pop + 입력 포커스 2단계 (blur → close)
  function bindGlobalKeys() {
    function isInputLike(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
    }
    function getActiveInScope() {
      const main = document.activeElement;
      const showHosts = Array.from(document.querySelectorAll('[data-ccf-handout-show="1"]'));
      for (let i = showHosts.length - 1; i >= 0; i--) {
        const sr = showHosts[i].shadowRoot;
        if (sr?.activeElement) return sr.activeElement;
      }
      const inShadow = state.shadow?.activeElement;
      if (inShadow) return inShadow;
      return main;
    }
    function popTopModal() {
      // 1. 수신 핸드아웃 팝업 (가장 최근)
      const showHosts = document.querySelectorAll('[data-ccf-handout-show="1"]');
      if (showHosts.length) { showHosts[showHosts.length - 1].remove(); return true; }
      // 2. PL 목록 관리 모달
      const plOverlay = state.shadow?.querySelector('.pl-modal-overlay[data-pl-modal-open="1"]');
      if (plOverlay) { closePlListDialog(); return true; }
      // 3. 핸드아웃 상세 view (패널 내부)
      if (state.isOpen && state.shadow?.querySelector('.body [data-action="close-detail"]')) {
        closeDetail();
        return true;
      }
      // 4. 핸드아웃 편집 view
      if (state.isOpen && state.activeTab === "edit") {
        state.editingId = null;
        state.formPermissionsForId = null;
        setTab("list");
        return true;
      }
      // 5. 핸드아웃 패널 자체 (기존 동작 유지)
      if (state.isOpen) { closePanel(); return true; }
      return false;
    }
    let escPrimedAt = 0;
    const ESC_PRIME_WINDOW = 1500; // ms — 1단계 ESC 후 2단계 인정 시간
    function onEscKey(e) {
      if (e.key !== "Escape") return;
      // 한글 IME 조합 중 → 브라우저 기본 동작에 맡김
      if (e.isComposing || e.keyCode === 229) return;
      // 우리 UI가 아무것도 안 열렸으면 간섭 안 함
      const anyOpen = state.isOpen
        || !!document.querySelector('[data-ccf-handout-show="1"]')
        || !!state.shadow?.querySelector('.pl-modal-overlay[data-pl-modal-open="1"]');
      if (!anyOpen) { escPrimedAt = 0; return; }
      const active = getActiveInScope();
      const now = Date.now();
      const primed = (now - escPrimedAt) < ESC_PRIME_WINDOW;
      if (isInputLike(active)) {
        if (primed) {
          // 2단계: 이미 1차 ESC로 prime됨 → blur + 모달 닫기
          // (React/CCFolia가 blur 후 input을 재포커스 했을 수 있음)
          try { active.blur(); } catch {}
          escPrimedAt = 0;
          if (popTopModal()) e.preventDefault();
          return;
        }
        // 1단계: blur만, prime 상태 진입
        try { active.blur(); } catch {}
        escPrimedAt = now;
        e.preventDefault();
        return;
      }
      escPrimedAt = 0;
      if (popTopModal()) e.preventDefault();
    }
    // capture phase: React/CCFolia가 ESC를 stopPropagation 하더라도 먼저 받기
    document.addEventListener("keydown", onEscKey, { signal, capture: true });
  }

  // ===== 초기화 =====
  function init() {
    console.info("[ccf-handout] init — version 0.1.43 (format toolbar nudge up 8px)");
    bindRouteEvents();
    bindGlobalKeys();
    startMountObserver();
    // 최초 + 지연 재시도 (React 렌더 늦을 수 있음)
    mountIcon();
    [200, 600, 1500, 3000].forEach((ms) => {
      setTimeout(() => { if (active) mountIcon(); }, ms);
    });
    // 데이터 로드 완료 후에야 watcher/팝업 시작 — 자동 추가 race 방지
    loadAll().then((d) => {
      state.data = d;
      state.myCharacterOptions = Array.isArray(d.myCharacterOptions) ? d.myCharacterOptions : [];
      startChatWatcher();
      watchMyCharacterInput();
      // 이미 인사 끝났으면 즉시 자동 감지 시도
      if (state.data.myCharacter === "") {
        setTimeout(() => autoDetectMyCharacter().catch(() => {}), 1000);
      }
      setTimeout(() => maybeShowGreeting(), 800);
    }).catch(reportError);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
