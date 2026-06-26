// ==UserScript==
// @name         CCF Palette Filter by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-palette-filter
// @version      0.0.1
// @description  Hides foreign-character palette blobs from the active speaker's macro dropdown.
// @description:ko 활성 화자 매크로 드롭다운에 끼어드는 다른 캐릭터 팔레트 통짜 항목을 숨깁니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const STYLE_ID = "ccf-palette-filter-style";
  const FILTER_ATTR = "data-ccf-palette-blob";
  const LISTBOX_SELECTOR = 'ul[role="listbox"][id^="downshift-"]';
  const LI_SELECTOR = 'li[role="option"]';
  const LONG_THRESHOLD = 80;
  const WHITESPACE_RATIO_THRESHOLD = 0.5;

  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const SCRIPT_INFO = Object.freeze({
    id: "ccf-palette-filter",
    name: "CCF Palette Filter",
    version: getUserscriptVersion("0.0.1"),
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-palette-filter"
  });

  let observer = null;
  let lastHiddenCount = 0;

  const lifecycle = createLegacyLifecycle(SCRIPT_INFO, {
    debugKey: "__CCF_PALETTE_FILTER_DEBUG__",
    onTeardown() {
      if (observer) {
        try { observer.disconnect(); } catch (error) { /* ignore */ }
        observer = null;
      }
      document.querySelectorAll(`[${FILTER_ATTR}="1"]`).forEach((li) => {
        li.removeAttribute(FILTER_ATTR);
      });
      document.getElementById(STYLE_ID)?.remove();
    }
  });
  const signal = lifecycle.signal;
  const isActive = () => lifecycle.isActive();
  const registerTeardown = (fn) => lifecycle.registerTeardown(fn);

  lifecycle.installDebugApi({
    rescan() { scanAll(); return lastHiddenCount; },
    lastHiddenCount() { return lastHiddenCount; }
  });

  if (!isCcfSuiteScriptEnabled(SCRIPT_INFO.id)) {
    return;
  }

  start();

  // ----- legacy lifecycle (shared shape, copied per script) -------------------

  function createLegacyLifecycle(scriptInfo, options) {
    const debugKey = options.debugKey;
    const onTeardown = typeof options.onTeardown === "function" ? options.onTeardown : null;

    try { window[debugKey]?.disable?.(); } catch (error) { /* prior instance cleanup failed */ }

    let active = true;
    const disposers = [];
    const abort = new AbortController();
    const signal = abort.signal;

    function registerTeardown(fn) {
      if (typeof fn === "function") disposers.push(fn);
    }

    function withSignal(options) {
      if (options == null) return { signal };
      if (typeof options === "boolean") return { capture: options, signal };
      if (typeof options === "object") {
        if (options.signal && options.signal !== signal) return options;
        return { ...options, signal };
      }
      return { signal };
    }

    function registerWithSuite() {
      try {
        const registryKey = "ccf-suite-registry-v1";
        let registry;
        try {
          const parsed = JSON.parse(window.localStorage.getItem(registryKey) || "{}");
          registry = parsed && typeof parsed.scripts === "object" ? { scripts: parsed.scripts } : { scripts: {} };
        } catch (error) {
          registry = { scripts: {} };
        }
        const previous = registry.scripts[scriptInfo.id] && typeof registry.scripts[scriptInfo.id] === "object"
          ? registry.scripts[scriptInfo.id]
          : {};
        const now = new Date().toISOString();
        const sessionId = typeof window.__CCF_SUITE_MANAGER_SESSION_ID === "string"
          ? window.__CCF_SUITE_MANAGER_SESSION_ID
          : "";
        registry.scripts[scriptInfo.id] = {
          ...previous,
          ...scriptInfo,
          installedAt: previous.installedAt || now,
          lastSeenAt: now,
          lastSeenUrl: location.href,
          lastSeenSessionId: sessionId
        };
        window.localStorage.setItem(registryKey, JSON.stringify(registry));
        window.dispatchEvent(new CustomEvent("ccf-suite:register", { detail: registry.scripts[scriptInfo.id] }));
      } catch (error) { /* suite 등록 실패 무시 */ }
    }

    function disable() {
      if (!active) return false;
      active = false;
      try { abort.abort(); } catch (error) { /* abort failed */ }
      while (disposers.length) {
        const disposer = disposers.pop();
        try { disposer(); } catch (error) { /* disposer failed */ }
      }
      try { onTeardown?.(); } catch (error) { /* dom sweep failed */ }
      try {
        if (window[debugKey] && window[debugKey].__owner === signal) {
          delete window[debugKey];
        }
      } catch (error) { /* debug api cleanup failed */ }
      return true;
    }

    function installDebugApi(extra = {}) {
      window[debugKey] = {
        __owner: signal,
        isActive() { return active; },
        disable,
        ...extra
      };
    }

    registerWithSuite();
    window.addEventListener("ccf-suite:request-register", (event) => {
      const targetId = event?.detail?.targetId;
      if (targetId && targetId !== scriptInfo.id) return;
      registerWithSuite();
    }, withSignal());

    return {
      signal,
      registerTeardown,
      withSignal,
      isActive() { return active; },
      disable,
      installDebugApi
    };
  }

  // ----- feature --------------------------------------------------------------

  function start() {
    const tryInit = () => {
      if (!isActive()) return true;
      if (!document.documentElement) return false;
      init();
      return true;
    };

    if (tryInit()) return;

    const onReady = () => {
      if (tryInit()) {
        document.removeEventListener("DOMContentLoaded", onReady, true);
        window.removeEventListener("load", onReady, true);
      }
    };
    document.addEventListener("DOMContentLoaded", onReady, true);
    window.addEventListener("load", onReady, true);

    const timer = window.setInterval(() => {
      if (!isActive()) { window.clearInterval(timer); return; }
      if (tryInit()) window.clearInterval(timer);
    }, 500);
    registerTeardown(() => window.clearInterval(timer));
    window.setTimeout(() => window.clearInterval(timer), 15000);
  }

  function init() {
    injectStyle();
    setupObserver();
    scanAll();
    console.info(`[CCF Palette Filter] loaded v${SCRIPT_INFO.version}`);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute("data-ccf-palette-filter", "1");
    style.textContent = `li[${FILTER_ATTR}="1"]{display:none!important}`;
    (document.head || document.documentElement).appendChild(style);
  }

  function setupObserver() {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    registerTeardown(() => {
      if (observer) {
        try { observer.disconnect(); } catch (error) { /* ignore */ }
        observer = null;
      }
    });
  }

  function onMutations(mutations) {
    if (!isActive()) return;
    for (const m of mutations) {
      if (touchesListbox(m)) {
        scanAll();
        return;
      }
    }
  }

  function touchesListbox(mutation) {
    const target = mutation.target;
    if (target && target.nodeType === 1) {
      if (target.matches?.(LISTBOX_SELECTOR)) return true;
      if (target.closest?.(LISTBOX_SELECTOR)) return true;
    }
    for (const node of mutation.addedNodes || []) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.(LISTBOX_SELECTOR)) return true;
      if (node.querySelector?.(LISTBOX_SELECTOR)) return true;
    }
    return false;
  }

  function scanAll() {
    if (!isActive()) return;
    let hidden = 0;
    document.querySelectorAll(LISTBOX_SELECTOR).forEach((ul) => {
      ul.querySelectorAll(LI_SELECTOR).forEach((li) => {
        const text = li.textContent || "";
        if (isBlobItem(text)) {
          if (li.getAttribute(FILTER_ATTR) !== "1") li.setAttribute(FILTER_ATTR, "1");
          hidden += 1;
        } else if (li.hasAttribute(FILTER_ATTR)) {
          li.removeAttribute(FILTER_ATTR);
        }
      });
    });
    lastHiddenCount = hidden;
  }

  function isBlobItem(text) {
    if (!text) return false;
    if (text.indexOf("\n") !== -1) return true;
    if (text.length > LONG_THRESHOLD) {
      const trimmedLen = text.trim().length;
      if (trimmedLen === 0) return true;
      if (trimmedLen / text.length < WHITESPACE_RATIO_THRESHOLD) return true;
    }
    return false;
  }

  function getUserscriptVersion(fallbackVersion) {
    try {
      const runtimeVersion = typeof GM_info !== "undefined" && typeof GM_info?.script?.version === "string"
        ? GM_info.script.version.trim()
        : "";
      return runtimeVersion || fallbackVersion;
    } catch (error) {
      return fallbackVersion;
    }
  }

  function isCcfSuiteScriptEnabled(scriptId) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CCF_SUITE_SCRIPT_STATE_KEY) || "{}");
      return !parsed || typeof parsed !== "object" || parsed[scriptId] !== false;
    } catch (error) {
      return true;
    }
  }
})();
