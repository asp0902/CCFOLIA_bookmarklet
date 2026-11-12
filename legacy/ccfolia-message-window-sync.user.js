// ==UserScript==
// @name         CCFOLIA Message Window Sync by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-message-window-sync
// @version      0.2.0
// @description  Keeps CCFOLIA's on-board message window in step with the room chat: when it is hidden its typing queue is fast-forwarded, when it is visible older queued messages are skipped (the newest one is typed) and the invisible format envelope is not typed, so the 3D dice effect (which starts when its roll message reaches the front of the queue) plays right away.
// @description:ko 코코포리아 화면 메시지창이 룸 채팅과 같이 가게 합니다: 숨겨져 있으면 큐를 빨리 넘기고, 보이면 밀린 앞 메시지는 건너뛰어 최신 것만 타이핑하며 보이지 않는 서식 봉투는 찍지 않습니다. 큐 맨 앞이 될 때 시작되는 3D 다이스 효과가 바로 뜹니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * 코코포리아(main.js 0f872b7d / chunk 216) 구조 — docs/message-window-sync-findings.md
 *  - 리덕스 entities.roomMessages.addedIds 가 메시지창 큐. 메시지창(z8)은 맨 앞 메시지를 80ms/글자로 찍고 1.2초 뒤 shiftAddedRoomMessage 로 넘긴다.
 *  - 3D 다이스 효과(ht)는 getFrontAddedRoomMessageId 가 바뀔 때, 그 메시지가 비밀 아닌 롤이면 시작한다 → 앞 메시지들의 타이핑이 끝나야 뜬다.
 *  - 메시지창을 닫아도(숨김) 타이핑 타이머는 계속 돈다.
 * 그래서 메시지창이 안 보이는 동안만 큐를 넘긴다(코코포리아의 '건너뛰기'와 같은 액션). 롤 메시지는 한 번 렌더된 뒤(약 80ms) 넘겨 효과가 시작되게 둔다.
 * 창이 보일 때(2차): 나(내게 보이는) 큐가 2개 이상이면 맨 앞(오래된 것)을 즉시 넘겨 항상 최신 메시지만 타이핑한다(롤이 맨 앞이면 80ms 렌더 뒤에 넘김).
 *   메시지 글 뒤에는 서식 봉투(보이지 않는 문자, 수백 자)가 붙어 있어 코코포리아가 그것까지 80ms/글자로 찍는다 → 보이는 글을 다 찍으면 봉투를 기다리지 않고 1.2초 뒤 넘기고, 찍히는 글에서 봉투 문자는 바로 지운다.
 *   봉투가 "숨긴 메시지"(blockStyle.hidden)면 창에 띄우지 않고 건너뛴다. 컷인 트리거 글은 코코포리아 기본 동작 그대로.
 * 끄기: localStorage.ccfMsgWindowSync = "off"(전체), ccfMsgWindowSkip = "off"(보이는 상태의 건너뛰기·봉투 정리만). 액션이 큐를 줄이지 못하면 이 세션에서 스스로 꺼서 원래 동작으로 돌아간다.
 */
(() => {
  "use strict";
  if (location.hostname !== "ccfolia.com" && !location.hostname.endsWith(".ccfolia.com")) return;
  const VERSION = "0.2.0";
  const KEY = "ccfMsgWindowSync";
  const SHIFT_ACTION = { type: "roomMessages/shiftAddedRoomMessage" };
  const WINDOW_SELECTOR = '[role="status"][aria-live="polite"][aria-atomic="true"]';
  const ABSENT_SETTLE_MS = 150; // 창 요소가 아직 없는 것과 숨겨진 것을 구분: 이만큼 계속 없어야 숨김으로 본다(렌더 직전 오판 방지)
  const ROLL_RENDER_MS = 80;    // 롤 메시지가 맨 앞에서 한 번 렌더(다이스 effect)된 뒤 넘긴다
  const MAX_SHIFTS_PER_PUMP = 500;
  const END_WAIT_MS = 1200;     // 코코포리아가 마지막 글자 뒤에 두는 시간(R8 의 setTimeout(onEnded, 1200))
  const TYPE_POLL_MS = 60;
  const INVIS_START = "\u2063\u2063\u2063", INVIS_END = "\u2062\u2062\u2062", INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
  const INVIS_RE = /[\u2062\u2063\u200B-\u200D\u2060]/g;

  try { window.__CCF_MSG_WINDOW_SYNC__?.disable?.(); } catch (error) { /* 이전 인스턴스 정리 실패 */ }

  const state = { store: null, unsubscribe: null, timer: 0, finder: 0, hiddenSince: 0, headId: "", headSince: 0, finishId: "", finishAt: 0, shifts: 0, broken: false, lastReason: "", enabled: true };

  const isOff = () => { try { return localStorage.getItem(KEY) === "off"; } catch (error) { return false; } };
  const skipOff = () => { try { return localStorage.getItem("ccfMsgWindowSkip") === "off"; } catch (error) { return false; } };

  function findStore() {
    if (state.store) return state.store;
    const root = document.getElementById("root") || document.body?.firstElementChild;
    const containerKey = root ? Object.keys(root).find((name) => name.startsWith("__reactContainer")) : "";
    const fiber = containerKey ? root[containerKey]?.stateNode?.current : null;
    if (!fiber) return null;
    const isStore = (value) => value && typeof value === "object" && typeof value.dispatch === "function" && typeof value.getState === "function" && typeof value.subscribe === "function";
    const seen = new WeakSet();
    let found = null;
    const visit = (value) => { if (found || !value || typeof value !== "object" || seen.has(value)) return; seen.add(value); if (isStore(value)) found = value; };
    const walk = (node, depth = 0) => {
      if (found || !node || depth > 50) return;
      visit(node.memoizedProps); visit(node.memoizedState); visit(node.stateNode);
      if (node.memoizedProps?.store) visit(node.memoizedProps.store);
      if (node.memoizedProps?.value) visit(node.memoizedProps.value);
      walk(node.child, depth + 1); walk(node.sibling, depth + 1);
    };
    walk(fiber);
    return found;
  }

  // 메시지창이 눈에 보이지 않는가(요소 없음 / visibility:hidden / display:none / 크기 0)
  function windowHidden() {
    const element = document.querySelector(WINDOW_SELECTOR);
    if (!element) return "absent";
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") return "hidden";
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? "" : "hidden";
  }

  function schedule(delay = 30) {
    if (state.timer || !state.enabled) return;
    state.timer = window.setTimeout(pump, delay);
  }

  // 서식 봉투 해독(format-sync 와 같은 형식: 시작 표식 + 2비트씩 보이지 않는 글자로 쓴 base64 JSON + 끝 표식). 실패하면 null.
  function decodeEnvelope(text) {
    const a = text.indexOf(INVIS_START);
    if (a < 0) return null;
    const b = text.indexOf(INVIS_END, a + INVIS_START.length);
    if (b < 0) return { visible: text.slice(0, a), envelope: null };
    let bits = "";
    for (const ch of text.slice(a + INVIS_START.length, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, "0"); }
    let envelope = null;
    try {
      const bytes = [];
      for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
      const json = new TextDecoder().decode(Uint8Array.from(atob(String.fromCharCode(...bytes).replace(/\0+$/g, "")), (c) => c.charCodeAt(0)));
      envelope = JSON.parse(json);
    } catch (error) { envelope = null; }
    return { visible: text.slice(0, a), envelope };
  }

  function currentRoom(storeState) {
    const rooms = storeState?.entities?.rooms?.entities || {};
    const roomId = storeState?.app?.state?.roomId;
    return (roomId && rooms[roomId]) || Object.values(rooms)[0];
  }

  // 메시지창이 글을 찍는 요소(white-space: pre-wrap 인 글 노드)
  function typedElement() {
    const windowElement = document.querySelector(WINDOW_SELECTOR);
    if (!windowElement) return null;
    return [...windowElement.querySelectorAll("p, span, div")].find((node) => node.children.length === 0 && getComputedStyle(node).whiteSpace === "pre-wrap") || null;
  }

  // 찍히는 글 노드에 봉투 문자가 들어오는 즉시 지운다(코코포리아가 다음 글자를 붙일 때마다 정리되므로 화면에는 보이는 글만 남는다).
  function watchTyped(element) {
    if (element.__ccfEnvWatch) return;
    const observer = new MutationObserver(() => {
      if (!state.enabled || skipOff() || isOff()) return;
      const text = element.textContent;
      const stripped = text.replace(INVIS_RE, "");
      if (stripped !== text) element.textContent = stripped;
    });
    observer.observe(element, { characterData: true, childList: true, subtree: true });
    element.__ccfEnvWatch = observer;
  }

  function shiftOnce(store) {
    const before = store.getState().entities.roomMessages.addedIds.length;
    store.dispatch(SHIFT_ACTION);
    const after = store.getState().entities.roomMessages.addedIds.length;
    state.shifts += 1;
    if (after >= before) { state.broken = true; state.lastReason = "shift action had no effect: disabled for this page"; return false; }
    state.headId = "";
    return true;
  }

  function pump() {
    state.timer = 0;
    if (!state.enabled || state.broken || isOff()) return;
    try {
      const store = state.store;
      let queue = store.getState()?.entities?.roomMessages;
      if (!queue?.addedIds?.length) { state.hiddenSince = 0; state.headId = ""; state.finishId = ""; return; }
      const hidden = windowHidden();
      const keepLatest = !hidden; // 보일 때는 최신 한 개를 타이핑하게 남긴다
      if (!hidden && skipOff()) { state.hiddenSince = 0; state.headId = ""; state.lastReason = "visible (skip off)"; schedule(250); return; }
      const now = Date.now();
      if (hidden) {
        if (!state.hiddenSince) state.hiddenSince = now;
        if (hidden === "absent" && now - state.hiddenSince < ABSENT_SETTLE_MS) { schedule(ABSENT_SETTLE_MS - (now - state.hiddenSince) + 5); return; }
        state.lastReason = hidden;
      } else { state.hiddenSince = 0; state.lastReason = "visible: keep the newest"; }
      const uid = store.getState()?.app?.user?.uid || "";
      const hide3d = !!currentRoom(store.getState())?.hidden3dDice;
      const isMine = (message) => !message || message.to == null || message.to === uid; // 메시지창이 보여 주는 것(getFrontAddedRoomMessage 의 필터)
      for (let guard = 0; guard < MAX_SHIFTS_PER_PUMP; guard += 1) {
        queue = store.getState().entities.roomMessages;
        const ids = queue.addedIds;
        const id = ids[0];
        if (id == null) { state.headId = ""; return; }
        const message = queue.entities[id];
        const mine = isMine(message);
        const decoded = mine && message?.text ? decodeEnvelope(String(message.text)) : null;
        const hiddenMessage = !!decoded?.envelope?.blockStyle?.hidden;
        if (keepLatest && mine && !hiddenMessage) {
          const mineCount = ids.filter((other) => isMine(queue.entities[other])).length;
          if (mineCount < 2) break; // 최신 하나 — 정상 타이핑(아래에서 봉투 정리)
        }
        const roll = message?.extend?.roll;
        if (mine && roll && !roll.secret && !hide3d && !hiddenMessage) { // 3D 다이스 효과: 맨 앞이 된 채로 한 번 렌더되게 둔다
          if (state.headId !== id) { state.headId = id; state.headSince = Date.now(); }
          const wait = ROLL_RENDER_MS - (Date.now() - state.headSince);
          if (wait > 0) { schedule(wait + 5); return; }
        }
        if (!shiftOnce(store)) return;
      }
      // 보이는 최신 메시지: 찍히는 글에서 봉투 문자를 지우고, 보이는 글을 다 찍었으면 봉투를 기다리지 않고 끝낸다
      if (keepLatest) {
        const head = store.getState().entities.roomMessages.addedIds[0];
        const headMessage = store.getState().entities.roomMessages.entities[head];
        const decoded = headMessage?.text ? decodeEnvelope(String(headMessage.text)) : null;
        const element = decoded ? typedElement() : null;
        if (decoded && element) {
          watchTyped(element);
          const stripped = element.textContent.replace(INVIS_RE, "");
          if (stripped !== element.textContent) element.textContent = stripped;
          if (stripped.length >= decoded.visible.replace(INVIS_RE, "").length) {
            if (state.finishId !== head) { state.finishId = head; state.finishAt = Date.now() + END_WAIT_MS; }
            if (Date.now() >= state.finishAt) { state.finishId = ""; shiftOnce(store); }
          }
        }
        schedule(TYPE_POLL_MS);
        return;
      }
      schedule(30);
    } catch (error) {
      state.broken = true; state.lastReason = `error: ${error?.message || error}`;
      console.warn("[ccf-msg-window-sync] disabled", error);
    }
  }

  function attach() {
    const store = findStore();
    if (!store) return false;
    state.store = store;
    state.unsubscribe = store.subscribe(() => {
      if (state.broken || !state.enabled) return;
      if (store.getState()?.entities?.roomMessages?.addedIds?.length) schedule(30);
      else state.hiddenSince = 0;
    });
    schedule(30);
    return true;
  }

  function disable() {
    state.enabled = false;
    clearTimeout(state.timer); state.timer = 0;
    clearInterval(state.finder); state.finder = 0;
    try { state.unsubscribe?.(); } catch (error) { /* ignore */ }
    state.unsubscribe = null;
  }

  window.__CCF_MSG_WINDOW_SYNC__ = { version: VERSION, state: () => ({ attached: !!state.store, enabled: state.enabled && !isOff(), broken: state.broken, shifts: state.shifts, reason: state.lastReason }), pump, disable };
  if (!attach()) state.finder = window.setInterval(() => { if (attach()) { clearInterval(state.finder); state.finder = 0; } }, 1000);
})();
