// 새 메시지 → 핸드폰 푸시(ntfy). 코코포리아 페이지(MAIN world)에서 도는 판정 쪽.
// 새 메시지 감지는 새로 만들지 않고 chat-notifier 의 것을 쓴다: notifier 가 새 메시지를 등록할 때 window.__CCF_NTFY_HOOK__({ name, text, key }) 를 부른다.
// 여기서는 설정(ntfy-bridge.js 가 chrome.storage 에서 읽어 postMessage 로 넘김)에 따라 보낼지 판정하고, 묶음·상한을 거쳐 ntfy-bridge.js 에 전송을 부탁한다
// (요청은 확장 백그라운드가 보낸다 — 코코포리아 페이지의 CSP 에 막히지 않게). 계정 정보는 다루지 않는다: 제목·짧은 본문·룸 주소만.
(() => {
  "use strict";
  if (window.__CCF_NTFY_HOOK__ && window.__CCF_NTFY_STATE__) return;
  const SOURCE = "capybara-ntfy";
  const BATCH_MS = 10_000;        // 이 시간 안에 더 오는 메시지는 한 알림으로 합친다
  const MAX_PER_MINUTE = 6;       // 분당 전송 상한
  const state = { config: null, windowEnd: 0, pending: [], flushTimer: 0, sent: [], lastSkip: "", total: 0, lastInputAt: Date.now() };
  window.__CCF_NTFY_STATE__ = state;

  // 룸 이름: 룸 화면 상단의 룸 이름(relay-page.js 와 같은 요소)을 먼저, 없으면 탭 제목에서 앞의 "(안읽음 수) "를 뗀 것.
  // 탭 제목이 "CCFOLIA 1.37.6 – TRPGオンラインセッションツール" 같은 사이트 기본 제목이면 룸 이름이 아니므로 쓰지 않는다.
  const roomName = () => {
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
    const heading = [...document.querySelectorAll('h6.MuiTypography-subtitle2, h6[class*="MuiTypography-subtitle2"]')].find((el) => el.offsetParent !== null && ownText(el));
    if (heading) return ownText(heading).slice(0, 40);
    const title = String(document.title || "").replace(/^\s*\(\d+\)\s*/, "").trim();
    if (/^(?:CCFOLIA|ココフォリア|코코포리아)(?:\s|$)/i.test(title)) return "코코포리아";
    return title.replace(/\s*[-|–—]\s*(?:CCFOLIA|ココフォリア|코코포리아).*$/i, "").trim().slice(0, 40) || "코코포리아";
  };
  const roomUrl = () => (/^\/rooms\//.test(location.pathname) ? `${location.origin}${location.pathname}` : location.origin);
  // 자리 비움: 탭이 숨겨졌거나 창이 비활성이거나, 이 페이지에서 마지막 조작 후 N분(설정, 기본 2, 1~60)이 지남.
  const awayMs = () => Math.min(60, Math.max(1, Math.round(Number(state.config?.awayMinutes) || 2))) * 60_000;
  const markInput = () => { state.lastInputAt = Date.now(); };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) window.addEventListener(type, markInput, { capture: true, passive: true });
  const awayReason = () => {
    if (document.visibilityState !== "visible") return "";
    if (!document.hasFocus()) return "";
    const idle = Date.now() - state.lastInputAt;
    return idle >= awayMs() ? "" : `룸 화면을 보고 있음(최근 조작 ${Math.round(idle / 1000)}초 전)`;
  };
  const mySpeakerName = () => String(document.querySelector('input[name="name"]')?.value || "").trim();

  const send = (payload) => {
    const now = Date.now();
    state.sent = state.sent.filter((t) => now - t < 60_000);
    if (state.sent.length >= MAX_PER_MINUTE) { state.lastSkip = "분당 상한"; return false; }
    state.sent.push(now);
    window.postMessage({ source: SOURCE, direction: "page", action: "send", payload }, location.origin);
    return true;
  };
  const buildPayload = (items) => {
    const config = state.config;
    const first = items[0];
    const extra = items.length - 1;
    const title = extra > 0 ? `${first.name} 외 ${extra}건 · ${roomName()}` : `${first.name}님 메시지 · ${roomName()}`;
    let message = "새 메시지가 도착했습니다.";
    if (config.includeText) message = items.slice(0, 3).map((item) => `${item.name}: ${item.text}`).join("\n").slice(0, 200) || message;
    return { title: title.slice(0, 100), message, click: roomUrl() };
  };
  const flush = () => {
    state.flushTimer = 0;
    const items = state.pending.splice(0);
    if (items.length && state.config?.enabled) send(buildPayload(items));
    state.windowEnd = items.length ? Date.now() + BATCH_MS : 0;
  };

  // notifier 가 새 메시지를 등록할 때 부른다. info = { name, text }
  window.__CCF_NTFY_HOOK__ = (info) => {
    const config = state.config;
    if (!config || !config.enabled || !config.topic) return false;
    const name = String(info?.name || "").trim() || "누군가";
    const text = String(info?.text || "").trim().slice(0, 60);
    if (config.onlyAway !== false) { const watching = awayReason(); if (watching) { state.lastSkip = watching; return false; } }
    if (name && name === mySpeakerName()) { state.lastSkip = "내 메시지"; return false; }
    if (config.scope === "keywords") {
      const keywords = (config.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
      const hay = `${name} ${info?.text || ""}`.toLowerCase();
      if (!keywords.length || !keywords.some((k) => hay.includes(k))) { state.lastSkip = "키워드 없음"; return false; }
    }
    state.total += 1;
    const now = Date.now();
    if (now >= state.windowEnd && !state.pending.length) {
      // 처음 오는 메시지는 바로 보낸다. 이후 BATCH_MS 안에 오는 것은 모아서 한 번에.
      if (!send(buildPayload([{ name, text }]))) return false;
      state.windowEnd = now + BATCH_MS;
      if (!state.flushTimer) state.flushTimer = window.setTimeout(flush, BATCH_MS);
      return true;
    }
    state.pending.push({ name, text });
    if (!state.flushTimer) state.flushTimer = window.setTimeout(flush, Math.max(200, state.windowEnd - now));
    return true;
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== "bridge") return;
    if (data.action === "config") state.config = data.config && typeof data.config === "object" ? data.config : null;
  });
  // 설정은 브리지가 로드 직후 보내 주지만, 이 스크립트가 늦게 뜬 경우를 위해 한 번 요청한다.
  window.postMessage({ source: SOURCE, direction: "page", action: "hello" }, location.origin);
})();
