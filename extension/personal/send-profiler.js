// 진단 전용: localStorage.ccfNativeSendTiming="1" 인 상태로 룸을 (새로고침해) 열었을 때만 동작한다. 꺼져 있으면 아무것도 바꾸지 않는다.
// Enter 직후(record 창) 또는 유휴 구간 동안 툴킷 스크립트별로 이벤트 처리기·MutationObserver·타이머·rAF 콜백이 쓴 시간을 합산한다.
// 어느 스크립트의 것인지는 등록하는 시점의 호출 스택(ccfolia-*.user.js / capybara-*.js 파일명과 함수이름:줄)으로 정한다 — 그래서 툴킷 스크립트보다 먼저 실행돼야 한다.
// 결과는 format-sync 의 __CCF_FORMAT_SYNC_RUNTIME__.sendTimingDiag() 항목의 byScript / top, 그리고 idleProfile(ms) 로 나온다. 코코포리아 자체 코드(스택에 툴킷 파일이 없는 것)는 세지 않는다.
(() => {
  "use strict";
  if (window.__CCF_SEND_PROFILE__) return;
  let on = false;
  try { on = localStorage.getItem("ccfNativeSendTiming") === "1"; } catch (_) { on = false; }
  if (!on) return;

  const state = { recording: false, byScript: {}, counts: {}, top: [], startedAt: 0 };
  // 등록한 곳: 호출 스택에서 처음 나오는 툴킷 파일 줄 → { script, where: "함수이름:줄" }
  const SITE_RE = /(?:ccfolia|capybara)-([a-z0-9-]+?)(?:\.user)?\.js[^:\s)]*:(\d+):\d+/i;
  const siteOf = () => {
    const lines = String(new Error().stack || "").split("\n");
    for (const line of lines) {
      const match = line.match(SITE_RE);
      if (!match) continue;
      const fn = (line.match(/at\s+(?:async\s+)?([^\s(]+)\s+\(/) || [])[1] || "";
      return { script: match[1], where: `${fn}:${match[2]}` };
    }
    return null;
  };
  const labelOf = (site, fn) => `${site.where}${fn && fn.name ? ` ${fn.name}` : ""}`;
  const record = (script, kind, label, ms) => {
    state.byScript[script] = (state.byScript[script] || 0) + ms;
    state.counts[script] = (state.counts[script] || 0) + 1;
    if (ms >= 3) {
      state.top.push({ script, kind, label: String(label).slice(0, 70), ms: Math.round(ms * 10) / 10 });
      if (state.top.length > 400) state.top.splice(0, 200);
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
      const site = siteOf();
      if (site) {
        const script = site.script;
        let bySrc = wrappers.get(listener);
        if (!bySrc) { bySrc = {}; wrappers.set(listener, bySrc); }
        const wrapper = bySrc[script] || (bySrc[script] = function (...args) { return timed(script, "event", `${type} @ ${labelOf(site, listener)}`, listener, this, args); });
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
      const site = typeof callback === "function" ? siteOf() : null;
      super(site ? function (...args) { return timed(site.script, "mutation", `observer @ ${labelOf(site, callback)}`, callback, this, args); } : callback);
    }
  };
  for (const name of ["setTimeout", "setInterval"]) {
    const orig = window[name];
    window[name] = function (callback, ...rest) {
      const site = typeof callback === "function" ? siteOf() : null;
      if (!site) return orig.call(this, callback, ...rest);
      return orig.call(this, function (...args) { return timed(site.script, name === "setTimeout" ? "timeout" : "interval", `${name} @ ${labelOf(site, callback)}`, callback, this, args); }, ...rest);
    };
  }
  const origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    const site = typeof callback === "function" ? siteOf() : null;
    if (!site) return origRaf.call(this, callback);
    return origRaf.call(this, function (...args) { return timed(site.script, "raf", `rAF @ ${labelOf(site, callback)}`, callback, this, args); });
  };

  const api = {
    start() { state.recording = true; state.byScript = {}; state.counts = {}; state.top = []; state.startedAt = performance.now(); },
    stop() {
      state.recording = false;
      const byScript = {}; for (const [k, v] of Object.entries(state.byScript)) byScript[k] = Math.round(v * 10) / 10;
      // 같은 등록 위치는 합쳐서(횟수·합계·최대) 위에서부터 8개 — 30ms 짜리 rAF 가 수십 번 돌면 한 줄로 보인다.
      const merged = new Map();
      for (const item of state.top) {
        const key = `${item.script}|${item.kind}|${item.label}`;
        const cur = merged.get(key) || { script: item.script, kind: item.kind, label: item.label, n: 0, total: 0, max: 0 };
        cur.n += 1; cur.total += item.ms; cur.max = Math.max(cur.max, item.ms);
        merged.set(key, cur);
      }
      const top = [...merged.values()].map((x) => ({ ...x, total: Math.round(x.total * 10) / 10, max: Math.round(x.max * 10) / 10 })).sort((a, b) => b.total - a.total).slice(0, 8);
      return { byScript, counts: { ...state.counts }, top, windowMs: Math.round(performance.now() - state.startedAt) };
    },
    // 유휴 프로파일: 입력·전송 없이 ms 동안 스크립트별 실행 시간 + 문서 변화 기록(어느 요소의 어떤 속성이 얼마나 바뀌는지)을 모은다.
    idle(ms) {
      return new Promise((resolve) => {
        const counts = {};
        let total = 0;
        const mo = new OrigMO((records) => {
          for (const r of records) {
            total += 1;
            const t = r.target;
            const name = t && t.nodeType === 1 ? `${t.tagName.toLowerCase()}${typeof t.className === "string" && t.className ? "." + t.className.split(" ")[0] : ""}` : "#text";
            const key = `${r.type}${r.attributeName ? ":" + r.attributeName : ""} ${name}`;
            counts[key] = (counts[key] || 0) + 1;
          }
        });
        mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        api.start();
        setTimeout(() => {
          const result = api.stop();
          mo.takeRecords(); mo.disconnect();
          result.mutations = total;
          result.mutationTop = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v}× ${k}`);
          resolve(result);
        }, ms);
      });
    }
  };
  window.__CCF_SEND_PROFILE__ = api;
})();
