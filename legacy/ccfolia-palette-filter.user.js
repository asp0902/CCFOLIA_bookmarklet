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

  const SCRIPT_READY_KEY = "__ccfPaletteFilterReady__";
  if (window[SCRIPT_READY_KEY]) {
    const existingDebugApi = window.__CCF_PALETTE_FILTER_DEBUG__;
    let existingActive = false;
    try {
      existingActive = !!existingDebugApi?.isActive?.();
    } catch (error) {
      existingActive = true;
    }
    if (existingActive) return;
    try { delete window[SCRIPT_READY_KEY]; } catch (error) { window[SCRIPT_READY_KEY] = false; }
  }
  window[SCRIPT_READY_KEY] = true;

  const STYLE_ID = "ccf-palette-filter-style";
  const FILTER_ATTR = "data-ccf-palette-blob";
  const LISTBOX_SELECTOR = 'ul[role="listbox"][id^="downshift-"]';
  const LI_SELECTOR = 'li[role="option"]';
  const LONG_THRESHOLD = 80;
  const WHITESPACE_RATIO_THRESHOLD = 0.5;

  const CCF_SUITE_REGISTRY_KEY = "ccf-suite-registry-v1";
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_SUITE_REGISTER_EVENT = "ccf-suite:register";
  const CCF_SUITE_REQUEST_EVENT = "ccf-suite:request-register";
  const SCRIPT_INFO = Object.freeze({
    id: "ccf-palette-filter",
    name: "CCF Palette Filter",
    version: getUserscriptVersion("0.0.1"),
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-palette-filter"
  });

  const filterSignal = Symbol("ccf-palette-filter-signal");
  let active = true;
  let observer = null;
  let lastHiddenCount = 0;
  const teardownHooks = [];

  function registerTeardown(fn) {
    if (typeof fn === "function") teardownHooks.push(fn);
  }

  function teardown() {
    if (!active) return false;
    active = false;
    while (teardownHooks.length) {
      try { teardownHooks.pop()(); } catch (error) { /* ignore */ }
    }
    if (observer) {
      try { observer.disconnect(); } catch (error) { /* ignore */ }
      observer = null;
    }
    document.querySelectorAll(`[${FILTER_ATTR}="1"]`).forEach((li) => {
      li.removeAttribute(FILTER_ATTR);
    });
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    try {
      if (window.__CCF_PALETTE_FILTER_DEBUG__ && window.__CCF_PALETTE_FILTER_DEBUG__.__owner === filterSignal) {
        delete window.__CCF_PALETTE_FILTER_DEBUG__;
      }
    } catch (error) { /* ignore */ }
    try { delete window[SCRIPT_READY_KEY]; } catch (error) { window[SCRIPT_READY_KEY] = false; }
    return true;
  }

  window.__CCF_PALETTE_FILTER_DEBUG__ = {
    __owner: filterSignal,
    isActive() { return active; },
    rescan() { scanAll(); return lastHiddenCount; },
    lastHiddenCount() { return lastHiddenCount; },
    disable() { return teardown(); }
  };

  registerWithCcfSuite(SCRIPT_INFO);
  window.addEventListener(CCF_SUITE_REQUEST_EVENT, handleSuiteRegisterRequest);
  registerTeardown(() => window.removeEventListener(CCF_SUITE_REQUEST_EVENT, handleSuiteRegisterRequest));

  if (!isCcfSuiteScriptEnabled(SCRIPT_INFO.id)) {
    return;
  }

  start();

  function start() {
    const tryInit = () => {
      if (!active) return true;
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
      if (!active) { window.clearInterval(timer); return; }
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
    if (!active) return;
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
    if (!active) return;
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

  function handleSuiteRegisterRequest(event) {
    const targetId = event?.detail?.targetId;
    if (targetId && targetId !== SCRIPT_INFO.id) return;
    registerWithCcfSuite(SCRIPT_INFO);
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

  function registerWithCcfSuite(scriptInfo) {
    try {
      const registry = readCcfSuiteRegistry();
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

      window.localStorage.setItem(CCF_SUITE_REGISTRY_KEY, JSON.stringify(registry));
      window.dispatchEvent(new CustomEvent(CCF_SUITE_REGISTER_EVENT, {
        detail: registry.scripts[scriptInfo.id]
      }));
    } catch (error) {
      // Ignore suite registration failures.
    }
  }

  function readCcfSuiteRegistry() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CCF_SUITE_REGISTRY_KEY) || "{}");
      return parsed && typeof parsed.scripts === "object"
        ? { scripts: parsed.scripts }
        : { scripts: {} };
    } catch (error) {
      return { scripts: {} };
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
