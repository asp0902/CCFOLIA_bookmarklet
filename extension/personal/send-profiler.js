// 진단 전용: localStorage.ccfNativeSendTiming="1" 인 상태로 룸을 (새로고침해) 열었을 때만 동작한다. 꺼져 있으면 아무것도 바꾸지 않는다.
// Enter 직후(record 창) 툴킷 스크립트별로 이벤트 처리기·MutationObserver·타이머·rAF 콜백이 쓴 시간을 합산한다.
// 어느 스크립트의 것인지는 등록하는 시점의 호출 스택(ccfolia-*.user.js / capybara-*.js 파일명)으로 정한다 — 그래서 툴킷 스크립트보다 먼저 실행돼야 한다.
// 결과는 format-sync 의 __CCF_FORMAT_SYNC_RUNTIME__.sendTimingDiag() 항목의 byScript / top 으로 붙는다. 코코포리아 자체 코드(스택에 툴킷 파일이 없는 것)는 세지 않는다.
(() => {
  "use strict";
  if (window.__CCF_SEND_PROFILE__) return;
  let on = false;
  try { on = localStorage.getItem("ccfNativeSendTiming") === "1"; } catch (_) { on = false; }
  if (!on) return;

  const state = { recording: false, byScript: {}, counts: {}, top: [], startedAt: 0 };
  const scriptOf = () => {
    const stack = String(new Error().stack || "");
    const match = stack.match(/(?:ccfolia|capybara)-([a-z0-9-]+?)(?:\.user)?\.js/i);
    return match ? match[1] : "";
  };
  const record = (script, kind, label, ms) => {
    state.byScript[script] = (state.byScript[script] || 0) + ms;
    state.counts[script] = (state.counts[script] || 0) + 1;
    if (ms >= 6) {
      state.top.push({ script, kind, label: String(label).slice(0, 40), ms: Math.round(ms * 10) / 10 });
      if (state.top.length > 60) { state.top.sort((a, b) => b.ms - a.ms); state.top.length = 20; }
    }
  };
  const timed = (script, kind, label, fn, self, args) => {
    if (!state.recording) return fn.apply(self, args);
    const t0 = performance.now();
    try { return fn.apply(self, args); } finally { record(script, kind, label, performance.now() - t0); }
  };

  // ---- 이벤트 처리기
  const wrappers = new WeakMap(); // 원래 처리기 → { 스크립트: 래퍼 }
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (typeof listener === "function") {
      const script = scriptOf();
      if (script) {
        let bySrc = wrappers.get(listener);
        if (!bySrc) { bySrc = {}; wrappers.set(listener, bySrc); }
        const wrapper = bySrc[script] || (bySrc[script] = function (...args) { return timed(script, "event", type, listener, this, args); });
        return origAdd.call(this, type, wrapper, options);
      }
    }
    return origAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const bySrc = typeof listener === "function" ? wrappers.get(listener) : null;
    if (bySrc) for (const script of Object.keys(bySrc)) origRemove.call(this, type, bySrc[script], options);
    return origRemove.call(this, type, listener, options);
  };

  // ---- MutationObserver / 타이머 / rAF
  const OrigMO = window.MutationObserver;
  window.MutationObserver = class extends OrigMO {
    constructor(callback) {
      const script = typeof callback === "function" ? scriptOf() : "";
      super(script ? function (...args) { return timed(script, "mutation", "observer", callback, this, args); } : callback);
    }
  };
  for (const name of ["setTimeout", "setInterval"]) {
    const orig = window[name];
    window[name] = function (callback, ...rest) {
      const script = typeof callback === "function" ? scriptOf() : "";
      if (!script) return orig.call(this, callback, ...rest);
      return orig.call(this, function (...args) { return timed(script, name === "setTimeout" ? "timeout" : "interval", name, callback, this, args); }, ...rest);
    };
  }
  const origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    const script = typeof callback === "function" ? scriptOf() : "";
    if (!script) return origRaf.call(this, callback);
    return origRaf.call(this, function (...args) { return timed(script, "raf", "rAF", callback, this, args); });
  };

  window.__CCF_SEND_PROFILE__ = {
    start() { state.recording = true; state.byScript = {}; state.counts = {}; state.top = []; state.startedAt = performance.now(); },
    stop() {
      state.recording = false;
      const byScript = {}; for (const [k, v] of Object.entries(state.byScript)) byScript[k] = Math.round(v * 10) / 10;
      const top = state.top.slice().sort((a, b) => b.ms - a.ms).slice(0, 8);
      return { byScript, counts: { ...state.counts }, top, windowMs: Math.round(performance.now() - state.startedAt) };
    }
  };
})();
