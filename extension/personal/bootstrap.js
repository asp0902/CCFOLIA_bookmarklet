(() => {
  "use strict";
  if (location.origin !== "https://ccfolia.com" || window.top !== window) return false;
  const ready = () => typeof window.__CAPYBARA_TOOLKIT__?.openPanel === "function";
  if (ready()) return true;
  const pendingKey = "__CAPYBARA_PERSONAL_EXTENSION_START__";
  if (window[pendingKey]) return window[pendingKey];

  const loaderUrl = "https://asp0902.github.io/CCFOLIA_bookmarklet/src/capybara-toolkit-loader.js";
  const pending = new Promise((resolve, reject) => {
    // A bookmarklet may already be loading. Wait for it instead of starting another loader.
    const existing = Array.from(document.querySelectorAll("script[data-capybara-toolkit-loader]"))
      .find(script => script.src.split("?")[0] === loaderUrl);
    const script = existing || document.createElement("script");
    const finish = (error) => {
      clearTimeout(timer);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (error) {
        if (!existing) script.remove();
        reject(error);
      } else resolve(true);
    };
    const onLoad = () => finish(ready() ? null : new Error("로더가 실행되지 않았습니다. CSP 또는 콘솔 오류를 확인해주세요."));
    const onError = () => finish(new Error("카피바라 로더를 불러오지 못했습니다. 연결 상태 확인 후 룸을 새로고침해주세요."));
    const timer = setTimeout(() => finish(new Error("카피바라 로딩 시간 초과. 룸 새로고침 후 다시 시도해주세요.")), 20000);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) {
      script.src = `${loaderUrl}?t=${Date.now()}`;
      script.dataset.capybaraToolkitLoader = "1";
      (document.head || document.documentElement).appendChild(script);
    }
  }).catch(error => {
    console.error("[Capybara personal extension]", error);
    return false;
  }).finally(() => {
    delete window[pendingKey];
  });
  window[pendingKey] = pending;
  return pending;
})();
