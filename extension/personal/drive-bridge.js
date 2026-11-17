// 핸드아웃 Drive 동기화 — 격리 world 브리지: 페이지(핸드아웃 스크립트)의 요청을 확장 백그라운드에 넘기고 답을 돌려준다.
// 페이지에는 토큰·클라이언트 ID 를 넘기지 않는다(연결 여부만 표시: <html data-capybara-drive="1">).
(() => {
  "use strict";
  if (location.origin !== "https://ccfolia.com" || window.top !== window) return;
  const SOURCE = "capybara-drive";
  const OPS = new Set(["status", "upload", "download", "history", "read", "restore", "keep"]);
  const mark = (on) => { document.documentElement.dataset.capybaraDrive = on ? "1" : "0"; };
  const refresh = async () => { try { const { driveConnected } = await chrome.storage.local.get(["driveConnected"]); mark(!!driveConnected); } catch (_) { mark(false); } };
  refresh();
  chrome.storage.onChanged?.addListener((changes, area) => { if (area === "local" && changes.driveConnected) mark(!!changes.driveConnected.newValue); });
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== "page" || !OPS.has(data.op)) return;
    const reply = (payload) => window.postMessage({ source: SOURCE, direction: "bridge", id: data.id, ...payload }, location.origin);
    const { op, room, roomTitle, handouts, deletedIds, handoutId, revId, on } = data;
    try {
      chrome.runtime.sendMessage({ type: "drive-sync", op, room, roomTitle, handouts, deletedIds, handoutId, revId, on }, (res) => {
        if (chrome.runtime.lastError) { reply({ ok: false, error: chrome.runtime.lastError.message }); return; }
        reply(res || { ok: false, error: "응답 없음" });
      });
    } catch (error) { reply({ ok: false, error: String(error?.message || error) }); }
  });
})();
