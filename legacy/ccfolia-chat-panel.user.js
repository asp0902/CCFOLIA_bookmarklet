// ==UserScript==
// @name         CCFOLIA Second Chat Panel by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-chat-panel
// @version      0.1.7
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

  const VERSION = "0.1.7";
  const PANEL_ID = "ccf-second-chat-panel";
  const SAFE_ATTR = "data-capybara-toolkit-chat-panel";
  const MENU_ITEM_ATTR = "data-capybara-toolkit-chat-panel-menu";
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
  // null = "아직 한 번도 안 그림". 빈 목록의 서명도 "" 이라, 초기값을 "" 로 두면
  // 처음 열었을 때 그릴 게 없다고 판단해 안내문조차 없이 빠져나간다(빈 패널).
  let lastSignature = null;
  let pinnedToBottom = true;
  let sending = false;
  let layoutTimer = 0;
  // "right" = 네이티브를 왼쪽으로 밀고 우리가 오른쪽. "left" = 네이티브 왼쪽 옆(밀지 않음).
  let panelSide = "right";

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
    // 저장소의 키 순서는 메시지가 들어온 순서라 뒤죽박죽이다(잡담·메인·정보).
    // 코코포리아 탭 순서(메인·정보·잡담)를 먼저 두고, 나머지 사용자 탭을 뒤에 붙인다.
    const base = ["main", "info", "other"];
    const rest = Object.keys(groups).filter((key) => !base.includes(key)).sort();
    return [...base, ...rest];
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

  // 코코포리아 표기와 맞춘다: "- 今日 15:02" / 지난 날짜는 "- 05/24 15:02".
  function formatTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    const clock = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    return sameDay ? `今日 ${clock}` : `${p(d.getMonth() + 1)}/${p(d.getDate())} ${clock}`;
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
        lastSignature = null;
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

    // 네이티브와 같은 구성: [아이콘] [이름 · 시각 / 본문].
    // 같은 화자가 이어 말하면 아이콘·이름을 생략하고 본문만 이어 붙인다.
    const frag = document.createDocumentFragment();
    let prevName = null;
    for (const msg of messages) {
      const isCont = msg.name === prevName;
      prevName = msg.name;

      // li + p 구조를 쓰는 이유: format-sync 의 렌더 대상 선택자에 'li p' 가 있어,
      // 봉투가 든 원문을 넣어두면 서식·나레이션·이미지를 그쪽이 그려준다.
      // MUI 클래스는 여전히 쓰지 않으므로 prose-mode/알림 스크립트는 이 패널을 건드리지 않는다.
      const row = document.createElement("li");
      row.className = "ccf-scp-row" + (isCont ? " is-cont" : "");

      const avatar = document.createElement("div");
      avatar.className = "ccf-scp-avatar";
      if (!isCont && msg.icon) {
        const img = document.createElement("img");
        img.src = msg.icon;
        img.alt = "";
        img.loading = "lazy";
        avatar.appendChild(img);
      }
      row.appendChild(avatar);

      const bodyWrap = document.createElement("div");
      bodyWrap.className = "ccf-scp-body";

      if (!isCont) {
        const head = document.createElement("div");
        head.className = "ccf-scp-head";
        const nameEl = document.createElement("span");
        nameEl.className = "ccf-scp-name";
        nameEl.textContent = msg.name;
        if (msg.color) nameEl.style.color = msg.color;
        head.appendChild(nameEl);
        const timeEl = document.createElement("span");
        timeEl.className = "ccf-scp-time";
        timeEl.textContent = `- ${formatTime(msg.at)}`;
        head.appendChild(timeEl);
        bodyWrap.appendChild(head);
      }

      const body = document.createElement("p");
      body.className = "ccf-scp-text";
      // 서식 스크립트가 있으면 봉투를 남긴 원문을 넣어 그쪽이 렌더하게 하고,
      // 없으면 보이지 않는 문자를 지운 평문을 넣는다.
      body.textContent = window.__CCF_FORMAT_SYNC_DEBUG__ ? msg.text : stripInvisible(msg.text);
      bodyWrap.appendChild(body);
      row.appendChild(bodyWrap);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        channel: currentChannel, open: !!panelEl, side: panelSide
      }));
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
      /* 색·글꼴·테두리는 네이티브 패널에서 읽어와 변수로 주입한다(syncTheme).
         하드코딩하면 테마 커스텀 기능을 쓸 때 혼자 다른 색이 된다. */
      #${PANEL_ID} {
        position: fixed; top: 0; height: 100%; width: 340px;
        display: flex; flex-direction: column; z-index: 1200;
        background: var(--scp-bg, rgba(24,24,26,.96));
        color: var(--scp-fg, #f0f0f0);
        border-left: 1px solid var(--scp-line, rgba(128,128,128,.32));
        box-shadow: var(--scp-shadow, none);
        font-family: var(--scp-font, system-ui, -apple-system, "Segoe UI", sans-serif);
        font-size: var(--scp-fontsize, 13px);
        line-height: 1.5;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      /* 아래 색들은 밝은 테마에서도 깨지지 않도록 글자색(currentColor) 기준으로만 만든다. */
      .ccf-scp-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
        border-bottom: 1px solid var(--scp-line, rgba(128,128,128,.32)); flex: 0 0 auto; }
      .ccf-scp-title { font-weight: 700; font-size: 12px; opacity: .75; margin-right: auto; }
      .ccf-scp-close { background: transparent; border: 0; color: inherit; cursor: pointer;
        font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
      .ccf-scp-close:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      /* 코코포리아 탭: 알약이 아니라 밑줄 표시 */
      .ccf-scp-tabs { display: flex; gap: 0; padding: 0 8px; flex: 0 0 auto;
        border-top: 1px solid var(--scp-line, rgba(128,128,128,.32));
        border-bottom: 1px solid var(--scp-line, rgba(128,128,128,.32)); }
      .ccf-scp-tab { padding: 10px 14px; cursor: pointer; border: 0; background: transparent;
        border-bottom: 2px solid transparent; color: inherit; opacity: .6;
        font-size: 13px; font-family: inherit; }
      .ccf-scp-tab:hover { opacity: .9; }
      .ccf-scp-tab.is-active { opacity: 1; font-weight: 700; border-bottom-color: #f44336; }
      .ccf-scp-list { flex: 1 1 auto; overflow-y: auto; padding: 10px 12px;
        margin: 0; list-style: none; }
      .ccf-scp-text { margin: 0; }
      /* 네이티브 메시지 줄: 아이콘 열 + 본문 열 */
      .ccf-scp-row { display: grid; grid-template-columns: 40px 1fr; gap: 8px;
        padding: 6px 0 2px; align-items: start; }
      .ccf-scp-row.is-cont { padding-top: 0; }
      .ccf-scp-avatar { width: 40px; height: 40px; }
      .ccf-scp-row.is-cont .ccf-scp-avatar { height: 0; }
      .ccf-scp-avatar img { width: 40px; height: 40px; border-radius: 4px;
        object-fit: cover; display: block; }
      .ccf-scp-body { min-width: 0; }
      .ccf-scp-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
      .ccf-scp-name { font-weight: var(--scp-name-weight, 700); font-size: var(--scp-name-size, 12px);
        color: var(--scp-name-color, inherit); }
      .ccf-scp-time { font-size: 10px; opacity: .5; }
      .ccf-scp-text { white-space: pre-wrap; word-break: break-word;
        font-size: var(--scp-text-size, inherit); line-height: var(--scp-text-line, 1.5);
        color: var(--scp-text-color, inherit); }
      .ccf-scp-empty { opacity: .55; padding: 16px 4px; text-align: center; }
      .ccf-scp-compose { flex: 0 0 auto; padding: 8px 10px;
        border-top: 1px solid var(--scp-line, rgba(128,128,128,.32)); }
      .ccf-scp-input { width: 100%; min-height: 56px; resize: vertical; border-radius: 8px;
        border: 1px solid var(--scp-line, rgba(128,128,128,.32));
        background: color-mix(in srgb, currentColor 8%, transparent); color: inherit;
        padding: 7px 9px; font: inherit; }
      .ccf-scp-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
      .ccf-scp-hint { font-size: 11px; opacity: .5; margin-right: auto; }
      .ccf-scp-send { padding: 5px 14px; border-radius: 8px; border: 0; cursor: pointer;
        background: #2196f3; color: #fff; font-weight: 700; }
      .ccf-scp-send:hover { filter: brightness(1.1); }
      .ccf-scp-status { font-size: 11px; margin-top: 4px; min-height: 14px; opacity: .7; }
      .ccf-scp-status.is-error { color: #ff8a8a; opacity: 1; }
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

    listEl = document.createElement("ul");
    listEl.className = "ccf-scp-list";
    listEl.addEventListener("scroll", () => {
      const gap = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      pinnedToBottom = gap < 40;
    });
    panel.appendChild(listEl);

    // 탭은 코코포리아처럼 메시지 목록과 입력창 사이에 둔다.
    tabsEl = document.createElement("div");
    tabsEl.className = "ccf-scp-tabs";
    panel.appendChild(tabsEl);

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

    lastSignature = null;
    // 배치가 실패해도 메시지는 보여야 한다 — 예전에 layoutPanel 의 예외가
    // 뒤따르는 renderTabs/renderList 까지 통째로 막아 빈 패널이 떴다.
    safeLayout();
    renderTabs();
    renderList();
    subscribeStore();
    // 네이티브 패널이 열리고 닫히거나 창 크기가 바뀌면 위치를 다시 맞춘다.
    window.addEventListener("resize", safeLayout);
    // 저장소 변화가 없어도 주기적으로 다시 그린다. 구독만 믿으면, 패널을 연 시점에
    // 아직 메시지가 안 실렸고 그 뒤로 방이 조용하면 영영 빈 화면으로 남는다.
    layoutTimer = window.setInterval(() => {
      safeLayout();
      renderTabs();
      renderList();
    }, 500);
    savePrefs();
  }

  function closePanel() {
    unsubscribeStore();
    window.removeEventListener("resize", safeLayout);
    if (layoutTimer) { window.clearInterval(layoutTimer); layoutTimer = 0; }
    clearNativeShift();
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

  /* ---------------- 네이티브 패널에 맞추기 ---------------- */

  // 룸 채팅 패널(드로어)을 찾는다. 채팅 메시지가 들어 있는 목록의 조상 중
  // 드로어/페이퍼가 곧 패널이다. 우리 패널은 당연히 제외한다.
  function findChatAnchor() {
    const item = [...document.querySelectorAll(".MuiListItem-root")]
      .find((li) => li instanceof HTMLElement
        && li.querySelector("h6.MuiListItemText-primary")
        && li.offsetParent !== null
        && !li.closest(".MuiPopover-root, .MuiMenu-root, .MuiDialog-root")
        && !li.closest(`#${PANEL_ID}`));
    if (item) return item;
    return [...document.querySelectorAll('[role="log"]')]
      .find((el) => el instanceof HTMLElement && isVisible(el) && !el.closest(`#${PANEL_ID}`)) || null;
  }

  function findNativeChatPanel() {
    const anchor = findChatAnchor();
    if (!anchor) return null;

    const drawer = anchor.closest(".MuiDrawer-paper");
    if (drawer instanceof HTMLElement && isVisible(drawer)) return drawer;

    // 드로어가 없으면 조상을 훑어 "사이드 패널 크기"인 가장 바깥 요소를 고른다.
    // .MuiPaper-root 를 그냥 closest 로 잡으면 화면 전체를 덮는 컨테이너가 걸려
    // 위치(우측 여백 0)와 색을 둘 다 엉뚱하게 가져온다.
    let best = null;
    for (let el = anchor; el && el !== document.body; el = el.parentElement) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 200) continue;
      if (rect.width > window.innerWidth * 0.7) break; // 여기부턴 패널이 아니라 컨테이너
      best = el;
    }
    return best;
  }

  // 색·글꼴을 네이티브에서 그대로 읽어온다. 하드코딩하면 테마 커스텀 기능과 어긋난다.
  function syncTheme(native) {
    if (!panelEl) return;
    const cs = native ? getComputedStyle(native) : null;
    const set = (key, value) => { if (value) panelEl.style.setProperty(key, value); };
    if (!cs) return;
    // 배경이 투명이면 조상에서 실제 색을 찾아 올라간다.
    let bg = cs.backgroundColor;
    for (let el = native.parentElement; el && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg); el = el.parentElement) {
      bg = getComputedStyle(el).backgroundColor;
    }
    set("--scp-bg", bg);
    set("--scp-fg", cs.color);
    set("--scp-font", cs.fontFamily);
    set("--scp-fontsize", cs.fontSize);
    const line = cs.borderLeftColor && cs.borderLeftWidth !== "0px" ? cs.borderLeftColor : "";
    set("--scp-line", line || "rgba(128,128,128,.32)");
    set("--scp-shadow", cs.boxShadow && cs.boxShadow !== "none" ? cs.boxShadow : "");

    // 메시지 글꼴/크기/색도 네이티브 메시지에서 그대로 읽어야 같아 보인다.
    const nameEl = document.querySelector(`h6.MuiListItemText-primary`);
    if (nameEl && !nameEl.closest(`#${PANEL_ID}`)) {
      const ns = getComputedStyle(nameEl);
      set("--scp-name-size", ns.fontSize);
      set("--scp-name-weight", ns.fontWeight);
      set("--scp-name-color", ns.color);
    }
    const textEl = document.querySelector(`p.MuiListItemText-secondary`);
    if (textEl && !textEl.closest(`#${PANEL_ID}`)) {
      const ts = getComputedStyle(textEl);
      set("--scp-text-size", ts.fontSize);
      set("--scp-text-line", ts.lineHeight);
      set("--scp-text-color", ts.color);
    }
  }

  // 룸 채팅 패널은 화면 오른쪽 끝에 붙어 있어(right = 창 너비) 그 오른쪽에는 공간이 없다.
  // 우리 패널을 오른쪽에 두려면 네이티브를 우리 폭만큼 왼쪽으로 밀어야 한다.
  // transform 만 건드리므로 레이아웃 계산에는 영향이 없고, 닫을 때 원래대로 되돌린다.
  function applyNativeShift(native, px) {
    if (!(native instanceof HTMLElement)) return;
    if (native.dataset.ccfScpShift === String(px)) return;
    if (native.dataset.ccfScpPrevTransform === undefined) {
      native.dataset.ccfScpPrevTransform = native.style.transform || "";
    }
    native.style.transform = px ? `translateX(${-px}px)` : (native.dataset.ccfScpPrevTransform || "");
    native.dataset.ccfScpShift = String(px);
  }

  function clearNativeShift() {
    document.querySelectorAll("[data-ccf-scp-shift]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.transform = el.dataset.ccfScpPrevTransform || "";
      delete el.dataset.ccfScpShift;
      delete el.dataset.ccfScpPrevTransform;
    });
  }

  // 위에 겹치지 않고 네이티브 패널 옆에 나란히 붙인다.
  function layoutPanel() {
    if (!panelEl) return;
    const native = findNativeChatPanel();
    syncTheme(native);

    if (!native) {
      // 패널을 못 찾으면(닫혀 있음 등) 화면 우측에 기본 배치.
      Object.assign(panelEl.style, {
        top: "0px", bottom: "0px", height: "", right: "0px", left: "", width: "340px"
      });
      return;
    }

    const MIN_WIDTH = 220;
    // 밀기 전 기준 위치 (transform 은 rect 에 반영되므로 먼저 해제하고 잰다).
    applyNativeShift(native, 0);
    const base = native.getBoundingClientRect();
    const width = Math.max(260, Math.min(base.width || 340, 460));
    const gapRight = window.innerWidth - base.right;

    let left;
    if (gapRight >= MIN_WIDTH) {
      // 오른쪽에 이미 자리가 있으면 밀 필요 없이 그 옆에.
      left = base.right;
    } else if (panelSide === "right" && base.left >= width) {
      // 오른쪽 끝에 붙어 있으면 네이티브를 왼쪽으로 밀고 그 자리를 쓴다.
      applyNativeShift(native, width);
      left = base.right - width;
    } else if (base.left >= MIN_WIDTH) {
      left = base.left - Math.min(width, base.left);
    } else {
      left = Math.max(0, window.innerWidth - width);
    }

    Object.assign(panelEl.style, {
      top: `${Math.round(base.top)}px`,
      height: `${Math.round(base.height)}px`,
      bottom: "",
      right: "",
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`
    });
  }

  // 배치 오류가 메시지 렌더까지 막지 않도록 격리한다.
  let layoutErrorLogged = false;
  function safeLayout() {
    try {
      layoutPanel();
    } catch (error) {
      if (!layoutErrorLogged) {
        layoutErrorLogged = true;
        console.error("[ccf-chat-panel] layout failed", error);
      }
    }
  }

  /* ---------------- 메뉴 항목 ---------------- */
  // 룸 채팅 패널 환경설정 메뉴의 "다른 창으로 보기(beta)" 바로 아래에 끼워 넣는다.

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isOtherWindowMenuItem(item) {
    const text = normalizeSpace(item.textContent || "").toLowerCase();
    if (!text) return false;
    return /다른\s*창/.test(text)
      || /別\s*ウ[ィイ]ンドウ/.test(text)
      || /(another|separate|new)\s*window/.test(text);
  }

  function menuItemLabel() {
    return panelEl ? "채팅 패널 닫기" : "채팅 패널 추가";
  }

  function createMenuItem(reference) {
    const item = document.createElement("li");
    // 네이티브 항목의 클래스를 그대로 빌려 생김새를 맞춘다.
    item.className = reference?.className || "MuiButtonBase-root MuiMenuItem-root MuiMenuItem-gutters";
    item.setAttribute(MENU_ITEM_ATTR, "1");
    item.setAttribute(SAFE_ATTR, "1");
    item.setAttribute("role", "menuitem");
    item.setAttribute("tabindex", "-1");
    item.textContent = menuItemLabel();

    const ripple = reference?.querySelector?.(".MuiTouchRipple-root");
    if (ripple instanceof HTMLElement) item.appendChild(ripple.cloneNode(false));

    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
      closeOpenMenus();
    });
    return item;
  }

  function closeOpenMenus() {
    const init = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent("keydown", init));
    document.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function ensureMenuItem() {
    if (!getRoomId()) return;
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!(menu instanceof HTMLElement) || !isVisible(menu)) continue;

      const existing = menu.querySelector(`[${MENU_ITEM_ATTR}="1"]`);
      if (existing) {
        // 패널 상태에 맞춰 라벨만 갱신 (ripple 자식은 건드리지 않는다).
        if (existing.firstChild?.nodeType === Node.TEXT_NODE) {
          existing.firstChild.nodeValue = menuItemLabel();
        }
        continue;
      }

      const items = [...menu.querySelectorAll('[role="menuitem"]')]
        .filter((el) => el instanceof HTMLElement && el.closest('[role="menu"]') === menu);
      const anchor = items.find(isOtherWindowMenuItem);
      if (!anchor || !anchor.parentElement) continue;

      injectStyle();
      anchor.parentElement.insertBefore(createMenuItem(anchor), anchor.nextSibling);
    }
  }

  function init() {
    const prefs = readPrefs();
    if (prefs.channel) currentChannel = prefs.channel;
    if (prefs.side === "left" || prefs.side === "right") panelSide = prefs.side;
    if (prefs.open) openPanel();

    // 메뉴는 열 때마다 새로 만들어지므로 DOM 변화를 보고 그때그때 항목을 끼운다.
    const observer = new MutationObserver(() => { if (active) ensureMenuItem(); });
    observer.observe(document.body, { childList: true, subtree: true });
    // 애니메이션 중 삽입이 밀리는 경우를 대비한 보조 폴링.
    const timer = window.setInterval(() => { if (active) ensureMenuItem(); }, 1000);
    ensureMenuItem();

    window.__CCF_SECOND_CHAT_PANEL__ = {
      version: VERSION,
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
      channels: listChannels,
      peek: () => readMessages(currentChannel)?.slice(-3),
      // 메시지를 못 읽을 때: 저장소가 실제로 어떤 모양인지 확인용.
      storeDiag() {
        const slice = getRoomMessagesSlice();
        if (!slice) return { 슬라이스: null, 저장소: !!findStore() };
        const groups = slice.idsGroupBy || {};
        const entities = slice.entities || {};
        const ids = Object.keys(entities);
        const sampleId = ids[0];
        const sample = sampleId ? entities[sampleId] : null;
        return {
          엔티티수: ids.length,
          그룹: Object.fromEntries(Object.entries(groups)
            .map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])),
          슬라이스키: Object.keys(slice),
          샘플필드: sample ? Object.keys(sample) : null,
          샘플: sample ? {
            channel: sample.channel, name: sample.name,
            text: String(sample.text || "").slice(0, 20), removed: sample.removed
          } : null
        };
      },
      // 네이티브를 미는 게 불편하면 "left" 로 바꾸면 밀지 않고 왼쪽 옆에 붙는다.
      setSide(side) {
        if (side !== "left" && side !== "right") return panelSide;
        panelSide = side;
        clearNativeShift();
        layoutPanel();
        savePrefs();
        return panelSide;
      },
      // 위치/디자인이 안 맞을 때: 어떤 요소를 네이티브 패널로 잡았는지 확인용.
      layoutDiag() {
        const native = findNativeChatPanel();
        const rect = native?.getBoundingClientRect();
        const cs = native ? getComputedStyle(native) : null;
        const round = (n) => Math.round(n);
        return {
          찾음: !!native,
          요소: native ? `${native.tagName}.${String(native.className).slice(0, 90)}` : null,
          위치: rect ? { left: round(rect.left), right: round(rect.right), top: round(rect.top), 폭: round(rect.width), 높이: round(rect.height) } : null,
          창너비: window.innerWidth,
          오른쪽여백: rect ? round(window.innerWidth - rect.right) : null,
          왼쪽여백: rect ? round(rect.left) : null,
          배경: cs?.backgroundColor,
          글자색: cs?.color,
          글꼴: cs?.fontFamily?.slice(0, 60),
          내패널: panelEl ? { left: panelEl.style.left, 폭: panelEl.style.width } : null
        };
      },
      // 메뉴 항목을 못 찾을 때 원인 확인용.
      menuDiag() {
        return [...document.querySelectorAll('[role="menu"]')]
          .filter(isVisible)
          .map((menu) => ({
            항목: [...menu.querySelectorAll('[role="menuitem"]')].map((i) => normalizeSpace(i.textContent)),
            앵커발견: [...menu.querySelectorAll('[role="menuitem"]')].some(isOtherWindowMenuItem)
          }));
      },
      disable() {
        active = false;
        observer.disconnect();
        window.clearInterval(timer);
        closePanel();
        document.querySelectorAll(`[${MENU_ITEM_ATTR}="1"]`).forEach((el) => el.remove());
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
