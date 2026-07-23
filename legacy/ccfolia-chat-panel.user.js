// ==UserScript==
// @name         CCFOLIA Second Chat Panel by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-chat-panel
// @version      0.1.0
// @description  Adds a second, independent room chat panel beside the native one.
// @description:ko 룸 채팅 패널을 하나 더 띄워 다른 탭을 동시에 보고 전송합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  // 이 패널은 코코포리아 패널을 복제하지 않는다. 코코포리아 패널은 React 소유이고
  // 보이는 줄만 만들어 쓰는 가상 스크롤이라, 복제해도 원본과 같은 탭·같은 스크롤만
  // 따라간다(= 두 탭을 동시에 못 봄). 대신 같은 원본 데이터(Redux store)를 읽어
  // 우리 DOM 으로 직접 그린다.
  //
  // ⚠ MUI 클래스명(.MuiListItem-root 등)을 쓰지 않는다. 다른 카피바라 스크립트들이
  //   그 클래스로 채팅 메시지를 찾아 가공하므로, 이 패널까지 건드리면 서로 망가진다.

  const VERSION = "0.1.0";
  const PANEL_ID = "ccf-second-chat-panel";
  const SAFE_ATTR = "data-capybara-toolkit-chat-panel";
  const FIRESTORE_PROJECT_ID = "ccfolia-160aa";
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  const STORAGE_KEY = "ccf-second-chat-panel:v1";
  const MAX_RENDER = 300;

  const CHANNEL_LABELS = Object.freeze({
    main: "메인", info: "정보", other: "잡담"
  });

  let active = true;
  let storeRef = null;
  let unsubscribe = null;
  let panelEl = null;
  let listEl = null;
  let tabsEl = null;
  let inputEl = null;
  let statusEl = null;
  let currentChannel = "main";
  let lastSignature = "";
  let pinnedToBottom = true;
  let sending = false;

  /* ---------------- Redux store ---------------- */

  function findStore() {
    if (storeRef) return storeRef;
    const root = document.getElementById("root") || document.body?.firstElementChild;
    if (!root) return null;
    const containerKey = Object.keys(root).find((k) => k.startsWith("__reactContainer"));
    if (!containerKey) return null;
    const fiber = root[containerKey]?.stateNode?.current;
    if (!fiber) return null;

    const isStore = (v) => v && typeof v === "object"
      && typeof v.dispatch === "function"
      && typeof v.getState === "function"
      && typeof v.subscribe === "function";

    const seen = new WeakSet();
    let found = null;
    const visit = (v) => {
      if (found || !v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      if (isStore(v)) found = v;
    };
    const walk = (node, depth = 0) => {
      if (found || !node || depth > 50) return;
      visit(node.memoizedProps);
      visit(node.memoizedState);
      visit(node.stateNode);
      if (node.memoizedProps?.store) visit(node.memoizedProps.store);
      if (node.memoizedProps?.value) visit(node.memoizedProps.value);
      walk(node.child, depth + 1);
      walk(node.sibling, depth + 1);
    };
    walk(fiber);
    if (found) storeRef = found;
    return found;
  }

  function getRoomMessagesSlice() {
    try {
      return findStore()?.getState()?.entities?.roomMessages || null;
    } catch (error) {
      return null;
    }
  }

  function getRoomId() {
    const match = location.pathname.match(/\/rooms\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  /* ---------------- 메시지 읽기 ---------------- */

  // 필드 이름은 코코포리아 업데이트로 바뀔 수 있으니 후보를 여러 개 본다.
  function pick(obj, keys) {
    for (const key of keys) {
      const value = key.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
      if (value != null && value !== "") return value;
    }
    return "";
  }

  function readCreatedAt(msg) {
    const raw = msg?.createdAt ?? msg?.timestamp ?? msg?.time;
    if (raw == null) return 0;
    if (typeof raw === "number") return raw;
    if (typeof raw?.toMillis === "function") { try { return raw.toMillis(); } catch (e) { return 0; } }
    if (typeof raw?.seconds === "number") return raw.seconds * 1000;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function listChannels() {
    const slice = getRoomMessagesSlice();
    const groups = slice?.idsGroupBy || {};
    const keys = Object.keys(groups);
    // 기본 3개는 메시지가 없어도 항상 보여준다.
    for (const base of ["main", "info", "other"]) {
      if (!keys.includes(base)) keys.push(base);
    }
    return keys;
  }

  function readMessages(channel) {
    const slice = getRoomMessagesSlice();
    if (!slice) return null;
    const entities = slice.entities || {};
    const ids = Array.isArray(slice.idsGroupBy?.[channel]) ? slice.idsGroupBy[channel] : [];
    const out = [];
    for (const id of ids) {
      const msg = entities[id];
      if (!msg || msg.removed) continue;
      out.push({
        id,
        name: String(pick(msg, ["name", "character.name", "sender.name"]) || "이름 없음"),
        text: String(pick(msg, ["text", "message", "body"]) || ""),
        color: String(pick(msg, ["color", "character.color"]) || ""),
        icon: String(pick(msg, ["iconUrl", "character.iconUrl", "sender.iconUrl"]) || ""),
        at: readCreatedAt(msg)
      });
    }
    out.sort((a, b) => a.at - b.at);
    return out.slice(-MAX_RENDER);
  }

  /* ---------------- 렌더 ---------------- */

  function formatTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 서식용 보이지 않는 문자(다른 스크립트가 붙인 봉투)는 표시에서 제거한다.
  function stripInvisible(text) {
    return String(text || "").replace(/[\u200B-\u200F\u2028\u2029\u2060-\u2064\uFEFF]/g, "");
  }

  function renderTabs() {
    if (!tabsEl) return;
    const channels = listChannels();
    const signature = channels.join("|") + "::" + currentChannel;
    if (tabsEl.dataset.sig === signature) return;
    tabsEl.dataset.sig = signature;
    tabsEl.textContent = "";
    for (const channel of channels) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ccf-scp-tab" + (channel === currentChannel ? " is-active" : "");
      btn.textContent = CHANNEL_LABELS[channel] || channel;
      btn.title = channel;
      btn.addEventListener("click", () => {
        currentChannel = channel;
        savePrefs();
        lastSignature = "";
        pinnedToBottom = true;
        renderTabs();
        renderList();
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderList() {
    if (!listEl) return;
    const messages = readMessages(currentChannel);
    if (messages == null) {
      listEl.textContent = "";
      const empty = document.createElement("div");
      empty.className = "ccf-scp-empty";
      empty.textContent = "코코포리아 룸 데이터를 아직 찾지 못했습니다. 잠시 후 자동으로 표시됩니다.";
      listEl.appendChild(empty);
      return;
    }

    const signature = messages.map((m) => m.id).join(",");
    if (signature === lastSignature) return;
    lastSignature = signature;

    listEl.textContent = "";
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "ccf-scp-empty";
      empty.textContent = "이 탭에는 아직 메시지가 없습니다.";
      listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    let prevName = null;
    for (const msg of messages) {
      const row = document.createElement("div");
      row.className = "ccf-scp-row" + (msg.name === prevName ? " is-cont" : "");
      prevName = msg.name;

      if (row.className.indexOf("is-cont") === -1) {
        const head = document.createElement("div");
        head.className = "ccf-scp-head";
        const nameEl = document.createElement("span");
        nameEl.className = "ccf-scp-name";
        nameEl.textContent = msg.name;
        if (msg.color) nameEl.style.color = msg.color;
        head.appendChild(nameEl);
        const timeEl = document.createElement("span");
        timeEl.className = "ccf-scp-time";
        timeEl.textContent = formatTime(msg.at);
        head.appendChild(timeEl);
        row.appendChild(head);
      }

      const body = document.createElement("div");
      body.className = "ccf-scp-text";
      body.textContent = stripInvisible(msg.text);
      row.appendChild(body);
      frag.appendChild(row);
    }
    listEl.appendChild(frag);

    if (pinnedToBottom) listEl.scrollTop = listEl.scrollHeight;
  }

  /* ---------------- 전송 ---------------- */

  function readFirebaseAuthRecord() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open("firebaseLocalStorageDb"); }
      catch (error) { reject(error); return; }
      req.onerror = () => reject(new Error("firebaseLocalStorageDb 열기 실패"));
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction("firebaseLocalStorage", "readonly");
          const all = tx.objectStore("firebaseLocalStorage").getAll();
          all.onsuccess = () => {
            const row = (all.result || []).find((r) => r?.value?.stsTokenManager?.accessToken);
            resolve(row?.value || null);
          };
          all.onerror = () => reject(new Error("인증 레코드 읽기 실패"));
        } catch (error) { reject(error); }
      };
    });
  }

  async function getAuthContext() {
    const roomId = getRoomId();
    if (!roomId) throw new Error("룸 페이지가 아닙니다.");
    const record = await readFirebaseAuthRecord();
    const token = record?.stsTokenManager?.accessToken;
    if (!token) throw new Error("로그인 정보를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    const expiresAt = record?.stsTokenManager?.expirationTime || 0;
    if (expiresAt && expiresAt < Date.now()) {
      throw new Error("로그인 정보가 만료되었습니다. 새로고침해 주세요.");
    }
    return { roomId, token, uid: record?.uid || "" };
  }

  // 보낼 메시지의 형식은 추측하지 않는다. 룸에 실제로 저장된 최근 메시지를
  // 그대로 본떠서(같은 필드·같은 타입) 본문과 탭만 바꿔 넣는다.
  // 이러면 코코포리아가 형식을 바꾸더라도 따라간다.
  async function fetchTemplateFields(ctx) {
    const url = `${FIRESTORE_BASE}/rooms/${encodeURIComponent(ctx.roomId)}:runQuery`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "messages" }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit: 30
        }
      })
    });
    if (!response.ok) throw new Error(`최근 메시지를 읽지 못했습니다 (${response.status})`);
    const rows = await response.json();
    const docs = (Array.isArray(rows) ? rows : [])
      .map((row) => row?.document?.fields)
      .filter((fields) => fields && fields.text);
    if (!docs.length) throw new Error("본뜰 메시지가 없습니다. 이 룸에서 채팅을 한 번 보낸 뒤 다시 시도해 주세요.");
    // 내가 보낸 메시지를 우선 — 이름/아이콘/색이 내 것으로 유지된다.
    const mine = ctx.uid ? docs.find((f) => f.from?.stringValue === ctx.uid) : null;
    return mine || docs[0];
  }

  function makeTimestampLike(templateField) {
    if (templateField?.timestampValue !== undefined) {
      return { timestampValue: new Date().toISOString() };
    }
    if (templateField?.integerValue !== undefined) {
      return { integerValue: String(Date.now()) };
    }
    return { timestampValue: new Date().toISOString() };
  }

  async function sendMessage(text) {
    const ctx = await getAuthContext();
    const template = await fetchTemplateFields(ctx);
    const fields = {};
    // 템플릿의 필드 구조를 그대로 유지하되, 우리가 정하는 값만 덮어쓴다.
    for (const [key, value] of Object.entries(template)) {
      if (key === "removed") continue;
      fields[key] = value;
    }
    fields.text = { stringValue: text };
    fields.channel = { stringValue: currentChannel };
    if ("createdAt" in template) fields.createdAt = makeTimestampLike(template.createdAt);
    if ("updatedAt" in template) fields.updatedAt = makeTimestampLike(template.updatedAt);
    if (ctx.uid && "from" in template) fields.from = { stringValue: ctx.uid };

    const url = `${FIRESTORE_BASE}/rooms/${encodeURIComponent(ctx.roomId)}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`전송 실패 (${response.status}) ${detail.slice(0, 120)}`);
    }
  }

  function setStatus(message, kind = "") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = "ccf-scp-status" + (kind ? ` is-${kind}` : "");
  }

  async function handleSend() {
    if (sending || !inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    sending = true;
    setStatus("전송 중…");
    try {
      await sendMessage(text);
      inputEl.value = "";
      setStatus("");
      pinnedToBottom = true;
    } catch (error) {
      console.error("[ccf-chat-panel] send failed", error);
      setStatus(error?.message || "전송에 실패했습니다.", "error");
    } finally {
      sending = false;
    }
  }

  /* ---------------- 설정 저장 ---------------- */

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ channel: currentChannel, open: !!panelEl }));
    } catch (error) { /* 저장 실패는 무시 */ }
  }

  function readPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (error) { return {}; }
  }

  /* ---------------- 패널 ---------------- */

  function injectStyle() {
    if (document.getElementById("ccf-scp-style")) return;
    const style = document.createElement("style");
    style.id = "ccf-scp-style";
    style.setAttribute(SAFE_ATTR, "1");
    style.textContent = `
      #${PANEL_ID} {
        position: fixed; right: 0; top: 0; bottom: 0; width: 340px;
        display: flex; flex-direction: column; z-index: 1200;
        background: rgba(24,24,26,.96); color: #f0f0f0;
        border-left: 1px solid rgba(255,255,255,.14);
        font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      .ccf-scp-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
        border-bottom: 1px solid rgba(255,255,255,.12); flex: 0 0 auto; }
      .ccf-scp-title { font-weight: 700; font-size: 12px; opacity: .75; margin-right: auto; }
      .ccf-scp-close { background: transparent; border: 0; color: #f0f0f0; cursor: pointer;
        font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
      .ccf-scp-close:hover { background: rgba(255,255,255,.12); }
      .ccf-scp-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 10px;
        border-bottom: 1px solid rgba(255,255,255,.12); flex: 0 0 auto; }
      .ccf-scp-tab { padding: 4px 10px; border-radius: 999px; cursor: pointer;
        border: 1px solid rgba(255,255,255,.18); background: transparent; color: #ddd; font-size: 12px; }
      .ccf-scp-tab:hover { background: rgba(255,255,255,.10); }
      .ccf-scp-tab.is-active { background: #2196f3; border-color: #2196f3; color: #fff; font-weight: 700; }
      .ccf-scp-list { flex: 1 1 auto; overflow-y: auto; padding: 10px; }
      .ccf-scp-row { padding: 2px 0 6px; }
      .ccf-scp-row.is-cont { padding-top: 0; }
      .ccf-scp-head { display: flex; align-items: baseline; gap: 6px; }
      .ccf-scp-name { font-weight: 700; font-size: 12px; }
      .ccf-scp-time { font-size: 10px; opacity: .5; }
      .ccf-scp-text { white-space: pre-wrap; word-break: break-word; }
      .ccf-scp-empty { opacity: .55; padding: 16px 4px; text-align: center; }
      .ccf-scp-compose { flex: 0 0 auto; border-top: 1px solid rgba(255,255,255,.12); padding: 8px 10px; }
      .ccf-scp-input { width: 100%; min-height: 56px; resize: vertical; border-radius: 8px;
        border: 1px solid rgba(255,255,255,.18); background: rgba(0,0,0,.35); color: #f0f0f0;
        padding: 7px 9px; font: inherit; }
      .ccf-scp-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
      .ccf-scp-hint { font-size: 11px; opacity: .5; margin-right: auto; }
      .ccf-scp-send { padding: 5px 14px; border-radius: 8px; border: 0; cursor: pointer;
        background: #2196f3; color: #fff; font-weight: 700; }
      .ccf-scp-send:hover { filter: brightness(1.1); }
      .ccf-scp-status { font-size: 11px; margin-top: 4px; min-height: 14px; opacity: .7; }
      .ccf-scp-status.is-error { color: #ff8a8a; opacity: 1; }
      #ccf-scp-launch { position: fixed; right: 12px; bottom: 12px; z-index: 1199;
        padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.2);
        background: rgba(24,24,26,.92); color: #fff; cursor: pointer; font-size: 12px; }
      #ccf-scp-launch:hover { filter: brightness(1.2); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function openPanel() {
    if (panelEl) return;
    injectStyle();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute(SAFE_ATTR, "1");

    const bar = document.createElement("div");
    bar.className = "ccf-scp-bar";
    const title = document.createElement("span");
    title.className = "ccf-scp-title";
    title.textContent = "룸 채팅 (추가 패널)";
    bar.appendChild(title);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ccf-scp-close";
    close.textContent = "×";
    close.title = "닫기";
    close.addEventListener("click", closePanel);
    bar.appendChild(close);
    panel.appendChild(bar);

    tabsEl = document.createElement("div");
    tabsEl.className = "ccf-scp-tabs";
    panel.appendChild(tabsEl);

    listEl = document.createElement("div");
    listEl.className = "ccf-scp-list";
    listEl.addEventListener("scroll", () => {
      const gap = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      pinnedToBottom = gap < 40;
    });
    panel.appendChild(listEl);

    const compose = document.createElement("div");
    compose.className = "ccf-scp-compose";
    inputEl = document.createElement("textarea");
    inputEl.className = "ccf-scp-input";
    inputEl.placeholder = "메시지 입력 (Enter 전송 / Shift+Enter 줄바꿈)";
    // 다른 스크립트가 이 입력창을 채팅 입력창으로 오인해 가공하지 않도록 표시.
    inputEl.setAttribute(SAFE_ATTR, "1");
    inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      handleSend();
    });
    compose.appendChild(inputEl);

    const actions = document.createElement("div");
    actions.className = "ccf-scp-actions";
    const hint = document.createElement("span");
    hint.className = "ccf-scp-hint";
    hint.textContent = "선택한 탭으로 전송됩니다";
    actions.appendChild(hint);
    const send = document.createElement("button");
    send.type = "button";
    send.className = "ccf-scp-send";
    send.textContent = "전송";
    send.addEventListener("click", handleSend);
    actions.appendChild(send);
    compose.appendChild(actions);

    statusEl = document.createElement("div");
    statusEl.className = "ccf-scp-status";
    compose.appendChild(statusEl);
    panel.appendChild(compose);

    document.body.appendChild(panel);
    panelEl = panel;

    lastSignature = "";
    renderTabs();
    renderList();
    subscribeStore();
    savePrefs();
  }

  function closePanel() {
    unsubscribeStore();
    panelEl?.remove();
    panelEl = null; listEl = null; tabsEl = null; inputEl = null; statusEl = null;
    savePrefs();
  }

  function togglePanel() {
    if (panelEl) closePanel(); else openPanel();
  }

  /* ---------------- 갱신 ---------------- */

  let renderQueued = false;
  function queueRender() {
    if (renderQueued || !panelEl) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!panelEl) return;
      renderTabs();
      renderList();
    });
  }

  function subscribeStore() {
    unsubscribeStore();
    const store = findStore();
    if (!store) {
      // 아직 준비 전이면 잠시 후 다시 시도.
      window.setTimeout(() => { if (panelEl) subscribeStore(); }, 800);
      return;
    }
    unsubscribe = store.subscribe(queueRender);
  }

  function unsubscribeStore() {
    if (typeof unsubscribe === "function") {
      try { unsubscribe(); } catch (error) { /* 해제 실패 무시 */ }
    }
    unsubscribe = null;
  }

  /* ---------------- 실행 ---------------- */

  function ensureLaunchButton() {
    if (document.getElementById("ccf-scp-launch")) return;
    if (!getRoomId()) return;
    injectStyle();
    const btn = document.createElement("button");
    btn.id = "ccf-scp-launch";
    btn.type = "button";
    btn.setAttribute(SAFE_ATTR, "1");
    btn.textContent = "채팅 패널 +";
    btn.title = "룸 채팅 패널을 하나 더 엽니다";
    btn.addEventListener("click", togglePanel);
    document.body.appendChild(btn);
  }

  function init() {
    const prefs = readPrefs();
    if (prefs.channel) currentChannel = prefs.channel;
    ensureLaunchButton();
    if (prefs.open) openPanel();
    const timer = window.setInterval(() => {
      if (!active) return;
      ensureLaunchButton();
    }, 2000);
    window.__CCF_SECOND_CHAT_PANEL__ = {
      version: VERSION,
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
      channels: listChannels,
      peek: () => readMessages(currentChannel)?.slice(-3),
      disable() {
        active = false;
        window.clearInterval(timer);
        closePanel();
        document.getElementById("ccf-scp-launch")?.remove();
        document.getElementById("ccf-scp-style")?.remove();
        return true;
      }
    };
    console.info(`[CCF SCP] second chat panel loaded (v${VERSION})`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
