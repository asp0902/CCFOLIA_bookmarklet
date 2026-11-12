// ==UserScript==
// @name         CCFOLIA Message Window Sync by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-message-window-sync
// @version      0.1.0
// @description  While CCFOLIA's on-board message window is hidden, fast-forwards its typing queue so the 3D dice effect (which starts when its roll message reaches the front of that queue) plays right away.
// @description:ko 코코포리아 화면 메시지창이 숨겨져 있는 동안 메시지창 큐를 빨리 넘겨, 그 큐의 맨 앞이 될 때 시작되는 3D 다이스 효과가 바로 뜨게 합니다.
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
 * 끄기: localStorage.ccfMsgWindowSync = "off". 액션이 큐를 줄이지 못하면 이 세션에서 스스로 꺼서 원래 동작으로 돌아간다.
 */
(() => {
  "use strict";
  if (location.hostname !== "ccfolia.com" && !location.hostname.endsWith(".ccfolia.com")) return;
  const VERSION = "0.1.0";
  const KEY = "ccfMsgWindowSync";
  const SHIFT_ACTION = { type: "roomMessages/shiftAddedRoomMessage" };
  const WINDOW_SELECTOR = '[role="status"][aria-live="polite"][aria-atomic="true"]';
  const ABSENT_SETTLE_MS = 150; // 창 요소가 아직 없는 것과 숨겨진 것을 구분: 이만큼 계속 없어야 숨김으로 본다(렌더 직전 오판 방지)
  const ROLL_RENDER_MS = 80;    // 롤 메시지가 맨 앞에서 한 번 렌더(다이스 effect)된 뒤 넘긴다
  const MAX_SHIFTS_PER_PUMP = 500;

  try { window.__CCF_MSG_WINDOW_SYNC__?.disable?.(); } catch (error) { /* 이전 인스턴스 정리 실패 */ }

  const state = { store: null, unsubscribe: null, timer: 0, finder: 0, hiddenSince: 0, headId: "", headSince: 0, shifts: 0, broken: false, lastReason: "", enabled: true };

  const isOff = () => { try { return localStorage.getItem(KEY) === "off"; } catch (error) { return false; } };

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

  function pump() {
    state.timer = 0;
    if (!state.enabled || state.broken || isOff()) return;
    try {
      const store = state.store;
      let queue = store.getState()?.entities?.roomMessages;
      if (!queue?.addedIds?.length) { state.hiddenSince = 0; state.headId = ""; return; }
      const hidden = windowHidden();
      if (!hidden) { state.hiddenSince = 0; state.headId = ""; state.lastReason = "visible"; schedule(250); return; }
      const now = Date.now();
      if (!state.hiddenSince) state.hiddenSince = now;
      if (hidden === "absent" && now - state.hiddenSince < ABSENT_SETTLE_MS) { schedule(ABSENT_SETTLE_MS - (now - state.hiddenSince) + 5); return; }
      state.lastReason = hidden;
      const uid = store.getState()?.app?.user?.uid || "";
      const hide3d = !!Object.values(store.getState()?.entities?.rooms?.entities || {})[0]?.hidden3dDice;
      for (let guard = 0; guard < MAX_SHIFTS_PER_PUMP; guard += 1) {
        queue = store.getState().entities.roomMessages;
        const id = queue.addedIds[0];
        if (id == null) { state.headId = ""; return; }
        const message = queue.entities[id];
        const mine = !message || message.to == null || message.to === uid; // 메시지창이 보여 주는 것(getFrontAddedRoomMessage 의 필터)
        const roll = message?.extend?.roll;
        if (mine && roll && !roll.secret && !hide3d) { // 3D 다이스 효과: 맨 앞이 된 채로 한 번 렌더되게 둔다
          if (state.headId !== id) { state.headId = id; state.headSince = Date.now(); }
          const wait = ROLL_RENDER_MS - (Date.now() - state.headSince);
          if (wait > 0) { schedule(wait + 5); return; }
        }
        const before = queue.addedIds.length;
        store.dispatch(SHIFT_ACTION);
        const after = store.getState().entities.roomMessages.addedIds.length;
        state.shifts += 1;
        if (after >= before) { state.broken = true; state.lastReason = "shift action had no effect: disabled for this page"; return; }
        state.headId = "";
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
