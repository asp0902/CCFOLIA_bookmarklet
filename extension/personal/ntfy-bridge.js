// 새 메시지 → 핸드폰 푸시(ntfy). 격리 world 쪽: chrome.storage 의 설정을 페이지(ntfy-page.js)에 전하고, 페이지가 보내 달라는 알림을 확장 백그라운드에 넘긴다.
(() => {
  "use strict";
  if (location.origin !== "https://ccfolia.com" || window.top !== window) return;
  const SOURCE = "capybara-ntfy";
  const toPage = (action, extra = {}) => window.postMessage({ source: SOURCE, direction: "bridge", action, ...extra }, location.origin);
  const publishConfig = (config) => toPage("config", { config: config && typeof config === "object" ? config : null });
  const load = async () => {
    try { publishConfig((await chrome.storage.local.get(["ntfy"])).ntfy); } catch (_) { publishConfig(null); }
  };
  load();
  chrome.storage.onChanged?.addListener((changes, area) => { if (area === "local" && changes.ntfy) publishConfig(changes.ntfy.newValue); });
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.direction !== "page") return;
    if (data.action === "hello") { load(); return; }
    if (data.action !== "send" || !data.payload || typeof data.payload !== "object") return;
    const { title, message, click } = data.payload;
    // 보내는 것은 제목·짧은 본문·룸 주소뿐. 서버·topic 은 저장된 설정을 백그라운드가 직접 읽어 쓴다(페이지가 바꿀 수 없다).
    try { Promise.resolve(chrome.runtime.sendMessage({ type: "ntfy-send", payload: { title: String(title || ""), message: String(message || ""), click: String(click || "") } })).catch(() => {}); } catch (_) { /* 확장 재로딩 중 */ }
  });
})();
