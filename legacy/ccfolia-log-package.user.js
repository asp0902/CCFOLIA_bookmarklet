// ==UserScript==
// @name         CCF Capybara Log Launcher by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-capybara-log
// @version      0.0.12
// @description  Captures the current CCFOLIA room log and hands it off to the Capybara Log Editor.
// @description:ko 현재 CCFOLIA 룸의 로그를 캡처하여 카피바라 로그 편집기로 넘깁니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const STYLE_ID = "ccf-log-package-style";
  const EXPORT_BTN_ATTR = "data-ccf-log-package-btn";
  const EXPORT_BTN_SELECTOR = `[${EXPORT_BTN_ATTR}="1"]`;

  // ----------------------------------------------------
  // [수정 포인트 1] 커스텀 탭 삭제 버튼을 위한 상수 추가
  // ----------------------------------------------------
  const DELETE_TAB_BTN_ATTR = "data-ccf-delete-tab-btn";
  const DELETE_TAB_BTN_SELECTOR = `[${DELETE_TAB_BTN_ATTR}="1"]`;

  const CAPYBARA_LOG_LABEL = "카피바라 로그";
  // 편집기 HTML은 이 파일 끝의 CAPYBARA_LOG_EDITOR_HTML 상수에 임베드되어 있다.
  // 표준 사본은 "확장 프로그램 2판/로그 편집기/index.html" 에 있으며, 변경 시
  // 동일 파일을 다시 임베드(JSON.stringify)하여 본 스크립트의 상수를 갱신해야 한다.
  // Chrome은 https 페이지에서 file:// 로의 window.open을 차단하기 때문에,
  // 편집기를 로컬 file:// 로 띄우는 대신 Blob URL로 열어 ccfolia 오리진을 상속한다.
  const CAPYBARA_LOG_HANDOFF_MESSAGE_SOURCE = "capybara-log-userscript";
  const CAPYBARA_LOG_HANDOFF_MESSAGE_TYPE = "capybara-log:handoff";
  const CAPYBARA_LOG_HANDOFF_EDITOR_SOURCE = "capybara-log-editor";
  const CAPYBARA_LOG_HANDOFF_READY_TYPE = "capybara-log:editor-ready";
  const CAPYBARA_LOG_HANDOFF_ACK_TYPE = "capybara-log:handoff-received";
  const CAPYBARA_LOG_HANDOFF_ERROR_TYPE = "capybara-log:handoff-error";

  const EDITOR_SELECTOR = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]';
  const MESSAGE_SCOPE_SELECTOR = '[role="log"], [aria-live="polite"], [aria-live="assertive"], .MuiDrawer-paper, ul.MuiList-root';
  const MESSAGE_ITEM_SELECTOR = 'li, [role="listitem"], .MuiListItem-root, [data-index]';
  const MESSAGE_TEXT_SELECTOR = [
    'p.MuiTypography-root.MuiTypography-body2',
    'div.MuiTypography-root.MuiTypography-body2',
    'p.MuiTypography-root',
    'div.MuiTypography-root',
    '.MuiListItemText-root > p',
    '.MuiListItemText-root > div',
    '[data-index] p',
    '[data-index] div.MuiTypography-root',
    'li p'
  ].join(", ");
  const AVATAR_NODE_SELECTOR = [
    'img[alt="avatar"]',
    'img[alt*="avatar" i]',
    '.MuiAvatar-root',
    '.MuiAvatar-root img',
    '[class*="Avatar"]',
    '[class*="Avatar"] img',
    '[class*="avatar"]',
    '[class*="avatar"] img',
    '[data-testid*="avatar" i]',
    '[data-testid*="avatar" i] img',
    '[aria-label*="avatar" i]',
    '[aria-label*="avatar" i] img',
    '[role="img"][aria-label*="avatar" i]'
  ].join(", ");
  const RAW_ATTR = "data-ccf-raw";
  const SAFE_UI_ATTR = "data-ccf-safe-markup";
  const PACKAGE_VERSION = 1;
  const INVIS_START = "\u2063\u2063\u2063";
  const INVIS_END = "\u2062\u2062\u2062";
  const INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
  const INVIS_REVERSE = new Map(INVIS_MAP.map((char, index) => [char, index]));
  const LOCAL_IMAGE_TOKEN_PREFIX = "ccf-local://image/";
  const LOCAL_IMAGE_STORAGE_PREFIX = "ccf-inline-image:";
  const LOCAL_IMAGE_INDEX_KEY = "ccf-inline-image:index";
  const LOCAL_IMAGE_MAX_ENTRIES = 24;
  const FONT_SIZE_MIN = 1;
  const FONT_SIZE_MAX = 200;
  const DEFAULT_BLUR_VALUE = "4px";
  const CCF_SUITE_REGISTRY_KEY = "ccf-suite-registry-v1";
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_SUITE_REGISTER_EVENT = "ccf-suite:register";
  const CCF_SUITE_REQUEST_EVENT = "ccf-suite:request-register";
  const CCF_LOG_PACKAGE_SCRIPT_INFO = Object.freeze({
    id: "ccf-log-package",
    name: "CCF Log Package Exporter",
    version: getUserscriptVersion("0.0.11"),
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-log-package"
  });
  const buttonState = {
    scheduled: false,
    busy: false
  };
  const LOG_SCAN_MAX_ITERATIONS = 120;
  const LOG_SCAN_STEP_RATIO = 0.75;
  const LOG_SCAN_MIN_STEP = 360;
  const LOG_SETTLE_QUIET_MS = 120;
  const LOG_SETTLE_TIMEOUT_MS = 700;
  const CCF_LOG_ENABLE_DOM_SCROLL_FALLBACK = true;
  const CCF_LOG_ENABLE_LIVE_AVATAR_SCAN = false;
  const CCF_LOG_ENABLE_VISIBLE_AVATAR_SCAN = true;
  const CCF_LOG_ENABLE_CHARACTER_LIST_AVATAR_SCAN = true;
  const VISIBLE_AVATAR_SCAN_MAX_ROOTS = 8;
  const VISIBLE_AVATAR_SCAN_MAX_ENTRIES = 240;
  const CHARACTER_LIST_AVATAR_SCAN_MAX_ENTRIES = 120;
  const OFFICIAL_LOG_CAPTURE_TIMEOUT_MS = 12000;
  const RUNTIME_CAPTURE_MAX_RECORDS = 12;
  const RUNTIME_CAPTURE_MAX_TEXT_LENGTH = 256 * 1024;
  const RUNTIME_DISCOVERY_MAX_DEPTH = 6;
  const RUNTIME_DISCOVERY_MAX_ARRAY_ITEMS = 150;
  const PACKAGE_INCLUDE_IMAGE_ASSETS = false;
  const PACKAGE_INCLUDE_AVATAR_ASSETS = true;
  const PACKAGE_MAX_ASSETS = 80;
  const PACKAGE_MAX_AVATAR_ASSETS = 80;
  const runtimeCaptureState = {
    installed: false,
    sequence: 0,
    records: []
  };

  let ccfLpActive = true;
  const ccfLpDisposers = [];
  const ccfLpAbort = new AbortController();
  const ccfLpSignal = ccfLpAbort.signal;

  function ccfLpRegisterTeardown(fn) {
    if (typeof fn === "function") ccfLpDisposers.push(fn);
  }

  function ccfLpWithSignal(options) {
    if (options == null) return { signal: ccfLpSignal };
    if (typeof options === "boolean") return { capture: options, signal: ccfLpSignal };
    if (typeof options === "object") {
      if (options.signal && options.signal !== ccfLpSignal) return options;
      return { ...options, signal: ccfLpSignal };
    }
    return { signal: ccfLpSignal };
  }

  function ccfLpTeardown() {
    if (!ccfLpActive) return false;
    ccfLpActive = false;
    try { ccfLpAbort.abort(); } catch (error) { /* abort failed */ }
    while (ccfLpDisposers.length) {
      const disposer = ccfLpDisposers.pop();
      try { disposer(); } catch (error) { /* disposer failed */ }
    }
    try {
      document.querySelectorAll('[data-ccf-lp-injected="1"], style[data-ccf-lp-style]').forEach(el => el.remove());
    } catch (error) { /* dom sweep failed */ }
    try {
      if (window.__CCF_LOG_PACKAGE_DEBUG__ && window.__CCF_LOG_PACKAGE_DEBUG__.__owner === ccfLpSignal) {
        delete window.__CCF_LOG_PACKAGE_DEBUG__;
      }
    } catch (error) { /* debug api cleanup failed */ }
    return true;
  }

  window.__CCF_LOG_PACKAGE_DEBUG__ = {
    __owner: ccfLpSignal,
    isActive() { return ccfLpActive; },
    disable() { return ccfLpTeardown(); }
  };

  registerWithCcfSuite(CCF_LOG_PACKAGE_SCRIPT_INFO);
  window.addEventListener(CCF_SUITE_REQUEST_EVENT, handleCcfSuiteRegisterRequest, ccfLpWithSignal());
  if (!isCcfSuiteScriptEnabled(CCF_LOG_PACKAGE_SCRIPT_INFO.id)) {
    return;
  }
  init();

  function handleCcfSuiteRegisterRequest(event) {
    const targetId = event?.detail?.targetId;
    if (targetId && targetId !== CCF_LOG_PACKAGE_SCRIPT_INFO.id) return;
    registerWithCcfSuite(CCF_LOG_PACKAGE_SCRIPT_INFO);
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
      window.dispatchEvent(
        new CustomEvent(CCF_SUITE_REGISTER_EVENT, {
          detail: registry.scripts[scriptInfo.id]
        })
      );
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

  function init() {
    try {
      installRuntimeStateCapture();
    } catch (error) {
      console.warn("[CCF LOG PACKAGE] runtime capture init failed; falling back to UI scan", error);
    }
    injectStyle();
    scheduleEnsureButtons();
    observeDom();
  }

  function installRuntimeStateCapture() {
    if (runtimeCaptureState.installed) return;
    runtimeCaptureState.installed = true;
    installFetchRuntimeCapture();
    installXhrRuntimeCapture();
    installWebSocketRuntimeCapture();
  }

  function installFetchRuntimeCapture() {
    if (typeof window.fetch !== "function") return;
    if (window.fetch.__ccfLogPackageRuntimePatched) return;
    const beforeFetch = window.fetch;
    const originalFetch = beforeFetch.bind(window);

    const patchedFetch = function patchedFetch(...args) {
      const result = originalFetch(...args);
      if (!ccfLpActive) return result;
      return result.then((response) => {
        if (ccfLpActive) {
          tryCaptureResponsePayload(response, {
            source: "fetch",
            requestUrl: extractRequestUrl(args[0])
          });
        }
        return response;
      });
    };

    patchedFetch.__ccfLogPackageRuntimePatched = true;
    window.fetch = patchedFetch;
    ccfLpRegisterTeardown(() => {
      if (window.fetch === patchedFetch) {
        window.fetch = beforeFetch;
      }
    });
  }

  function installXhrRuntimeCapture() {
    const proto = window.XMLHttpRequest?.prototype;
    if (!proto || proto.__ccfLogPackageRuntimePatched) return;

    const originalOpen = proto.open;
    const originalSend = proto.send;

    const openPatched = function openPatched(method, url, ...rest) {
      if (ccfLpActive) {
        this.__ccfLogPackageRuntimeMeta = {
          method: String(method || ""),
          url: typeof url === "string" ? url : String(url || "")
        };
      }
      return originalOpen.call(this, method, url, ...rest);
    };

    const sendPatched = function sendPatched(...args) {
      if (ccfLpActive && !this.__ccfLogPackageRuntimeObserved) {
        this.__ccfLogPackageRuntimeObserved = true;
        this.addEventListener("load", () => {
          if (ccfLpActive) tryCaptureXhrPayload(this);
        });
      }
      return originalSend.apply(this, args);
    };

    proto.open = openPatched;
    proto.send = sendPatched;
    proto.__ccfLogPackageRuntimePatched = true;

    ccfLpRegisterTeardown(() => {
      if (proto.open === openPatched) proto.open = originalOpen;
      if (proto.send === sendPatched) proto.send = originalSend;
      delete proto.__ccfLogPackageRuntimePatched;
    });
  }

  function installWebSocketRuntimeCapture() {
    if (typeof window.WebSocket !== "function") return;
    const NativeWebSocket = window.WebSocket;
    if (NativeWebSocket.__ccfLogPackageRuntimePatched) return;

    function RuntimeWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      if (ccfLpActive) attachRuntimeWebSocketCapture(socket, args[0]);
      return socket;
    }

    RuntimeWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(RuntimeWebSocket, NativeWebSocket);
    RuntimeWebSocket.__ccfLogPackageRuntimePatched = true;
    window.WebSocket = RuntimeWebSocket;

    ccfLpRegisterTeardown(() => {
      if (window.WebSocket === RuntimeWebSocket) {
        window.WebSocket = NativeWebSocket;
      }
    });
  }

  function attachRuntimeWebSocketCapture(socket, urlLike = "") {
    if (!socket || typeof socket.addEventListener !== "function" || socket.__ccfLogPackageRuntimeObserved) return;
    socket.__ccfLogPackageRuntimeObserved = true;

    const meta = {
      source: "websocket",
      url: typeof urlLike === "string" ? urlLike : String(urlLike || "")
    };

    socket.addEventListener("message", (event) => {
      tryCaptureRuntimeSocketData(event?.data, meta);
    });

    if (typeof socket.send === "function" && !socket.send.__ccfLogPackageRuntimePatched) {
      const originalSend = socket.send;
      socket.send = function sendPatched(data) {
        tryCaptureRuntimeSocketData(data, {
          ...meta,
          source: "websocket-send"
        });
        return originalSend.call(this, data);
      };
      socket.send.__ccfLogPackageRuntimePatched = true;
    }
  }

  async function tryCaptureResponsePayload(response, meta = {}) {
    try {
      if (!(response instanceof Response)) return;

      const responseUrl = response.url || meta.requestUrl || "";
      if (!shouldInspectRuntimeResponseUrl(responseUrl)) return;

      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !/(json|javascript|text|graphql)/i.test(contentType)) return;

      const clone = response.clone();
      const payloadText = await clone.text();
      if (!payloadText || payloadText.length > RUNTIME_CAPTURE_MAX_TEXT_LENGTH) return;

      const payload = parseRuntimePayloadText(payloadText, contentType);
      if (payload == null) return;

      recordRuntimePayload(payload, {
        ...meta,
        url: responseUrl,
        contentType
      });
    } catch (error) {
      // Ignore runtime capture failures.
    }
  }

  function tryCaptureXhrPayload(xhr) {
    try {
      if (!(xhr instanceof XMLHttpRequest)) return;

      const responseUrl = xhr.responseURL || xhr.__ccfLogPackageRuntimeMeta?.url || "";
      if (!shouldInspectRuntimeResponseUrl(responseUrl)) return;

      const responseType = String(xhr.responseType || "").toLowerCase();
      if (responseType && responseType !== "text" && responseType !== "json") return;

      const contentType = String(xhr.getResponseHeader("content-type") || "").toLowerCase();
      if (contentType && !/(json|javascript|text|graphql)/i.test(contentType)) return;

      const payload = responseType === "json"
        ? xhr.response
        : parseRuntimePayloadText(String(xhr.responseText || ""), contentType);
      if (payload == null) return;

      recordRuntimePayload(payload, {
        source: "xhr",
        url: responseUrl,
        contentType
      });
    } catch (error) {
      // Ignore runtime capture failures.
    }
  }

  function tryCaptureRuntimeSocketData(data, meta = {}) {
    try {
      if (typeof data !== "string" || !data || data.length > RUNTIME_CAPTURE_MAX_TEXT_LENGTH) return;
      const payload = parseRuntimePayloadText(data, "application/json");
      if (payload == null) return;
      recordRuntimePayload(payload, meta);
    } catch (error) {
      // Ignore runtime capture failures.
    }
  }

  function shouldInspectRuntimeResponseUrl(value) {
    try {
      const parsed = new URL(String(value || ""), location.href);
      return parsed.origin === location.origin || /ccfolia/i.test(parsed.hostname);
    } catch (error) {
      return false;
    }
  }

  function extractRequestUrl(requestLike) {
    try {
      if (typeof requestLike === "string") return requestLike;
      if (requestLike instanceof Request) return requestLike.url || "";
      return String(requestLike || "");
    } catch (error) {
      return "";
    }
  }

  function parseRuntimePayloadText(value, contentType = "") {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return null;

    const looksJson = /json|graphql|javascript/i.test(contentType)
      || text.startsWith("{")
      || text.startsWith("[");
    if (!looksJson) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  function recordRuntimePayload(payload, meta = {}) {
    if (!isRuntimeObjectLike(payload)) return;

    runtimeCaptureState.sequence += 1;
    runtimeCaptureState.records.push({
      id: runtimeCaptureState.sequence,
      payload,
      meta: {
        source: meta.source || "runtime",
        url: meta.url || meta.requestUrl || "",
        contentType: meta.contentType || ""
      },
      capturedAt: Date.now()
    });

    if (runtimeCaptureState.records.length > RUNTIME_CAPTURE_MAX_RECORDS) {
      runtimeCaptureState.records.splice(0, runtimeCaptureState.records.length - RUNTIME_CAPTURE_MAX_RECORDS);
    }
  }

  function collectRuntimePackageSourceRecords() {
    const liveSources = collectLiveRuntimePayloadCandidates();
    const captured = runtimeCaptureState.records.slice(-40).reverse();
    return [...liveSources, ...captured];
  }

  function collectLiveRuntimePayloadCandidates() {
    const out = [];
    const push = (payload, meta = {}) => {
      if (!isRuntimeObjectLike(payload)) return;
      out.push({
        payload,
        meta: {
          source: meta.source || "runtime-live",
          url: meta.url || "",
          contentType: meta.contentType || ""
        }
      });
    };

    push(readInlineNextDataPayload(), { source: "__NEXT_DATA__" });
    collectNamedWindowRuntimePayloads(push);
    collectReactRuntimePayloads(push);
    return out;
  }

  function readInlineNextDataPayload() {
    try {
      if (isRuntimeObjectLike(window.__NEXT_DATA__)) {
        return window.__NEXT_DATA__;
      }
    } catch (error) {
      // Ignore access failures.
    }

    try {
      const script = document.getElementById("__NEXT_DATA__");
      if (!(script instanceof HTMLScriptElement)) return null;
      return parseRuntimePayloadText(script.textContent || "", "application/json");
    } catch (error) {
      return null;
    }
  }

  function collectNamedWindowRuntimePayloads(push) {
    const explicitNames = [
      "__APOLLO_STATE__",
      "__APOLLO_CLIENT__",
      "__INITIAL_STATE__",
      "__PRELOADED_STATE__",
      "__NEXT_REDUX_STORE__",
      "__NUXT__",
      "__STATE__",
      "apolloClient",
      "store"
    ];

    explicitNames.forEach((name) => {
      const value = safeGetWindowProperty(name);
      if (!value) return;

      if (typeof value?.getState === "function") {
        try {
          push(value.getState(), { source: `window.${name}.getState()` });
        } catch (error) {
          // Ignore access failures.
        }
      }

      if (typeof value?.extract === "function") {
        try {
          push(value.extract(), { source: `window.${name}.extract()` });
        } catch (error) {
          // Ignore access failures.
        }
      }

      push(value, { source: `window.${name}` });
    });

    try {
      Object.getOwnPropertyNames(window)
        .filter((name) => /(?:apollo|redux|store|query|room|state)/i.test(name))
        .slice(0, 40)
        .forEach((name) => {
          const value = safeGetWindowProperty(name);
          if (!value) return;

          if (typeof value?.getState === "function") {
            try {
              push(value.getState(), { source: `window.${name}.getState()` });
            } catch (error) {
              // Ignore access failures.
            }
            return;
          }

          if (typeof value?.extract === "function") {
            try {
              push(value.extract(), { source: `window.${name}.extract()` });
            } catch (error) {
              // Ignore access failures.
            }
            return;
          }

          push(value, { source: `window.${name}` });
        });
    } catch (error) {
      // Ignore access failures.
    }
  }

  function collectReactRuntimePayloads(push) {
    const elements = new Set();

    document.querySelectorAll('[role="tab"], [role="log"], .MuiDrawer-paper, #__next, button[type="submit"]').forEach((element) => {
      if (element instanceof HTMLElement) {
        elements.add(element);
      }
    });

    elements.forEach((element) => {
      collectReactPayloadsFromElement(element).forEach((payload, index) => {
        push(payload, {
          source: `react:${element.tagName.toLowerCase()}:${index + 1}`
        });
      });
    });
  }

  function collectReactPayloadsFromElement(element) {
    const out = [];
    const seen = new Set();
    const push = (value) => {
      if (!isRuntimeObjectLike(value) || seen.has(value)) return;
      seen.add(value);
      out.push(value);
    };

    push(getReactPropsFromElement(element));

    let current = getReactFiberFromElement(element);
    let hops = 0;
    while (current && hops < 18) {
      push(current.memoizedProps);
      push(current.memoizedState);
      if (current.stateNode && current.stateNode !== element && isRuntimeObjectLike(current.stateNode)) {
        push(current.stateNode);
      }
      current = current.return;
      hops += 1;
    }

    return out;
  }

  function getReactFiberFromElement(element) {
    if (!(element instanceof HTMLElement)) return null;
    const key = Object.keys(element).find((name) =>
      name.startsWith("__reactFiber$")
      || name.startsWith("__reactContainer$")
    );
    return key ? element[key] : null;
  }

  function getReactPropsFromElement(element) {
    if (!(element instanceof HTMLElement)) return null;
    const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
    return key ? element[key] : null;
  }

  function safeGetWindowProperty(name) {
    try {
      return window[name];
    } catch (error) {
      return null;
    }
  }

  function collectRuntimePackageTabGroups(roomTitle = "") {
    const candidates = collectRuntimePackageSourceRecords()
      .map((record) => {
        const groups = extractPackageTabGroupsFromRuntimeSource(record.payload, roomTitle, record.meta);
        if (!groups.length) return null;
        return {
          groups,
          meta: record.meta || {},
          score: scoreRuntimeGroupSet(groups, record.meta || {})
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.score - left.score);

    if (!candidates.length) return [];

    const merged = mergeRuntimeGroupSets(candidates, roomTitle);
    if (merged.length) return merged;
    return candidates[0]?.groups || [];
  }

  function extractPackageTabGroupsFromRuntimeSource(payload, roomTitle = "", meta = {}) {
    if (!isRuntimeObjectLike(payload)) return [];

    const state = {
      seen: new WeakSet(),
      tabs: new Map(),
      messages: new Map(),
      looseMessages: new Map(),
      roomTitleCandidates: roomTitle ? [roomTitle] : []
    };

    walkRuntimeCandidateNode(payload, {
      path: "",
      tab: null,
      collectionKey: "",
      inTabList: false,
      inMessageList: false
    }, state, 0);

    return finalizeRuntimeGroupSet(state, roomTitle, meta);
  }

  function walkRuntimeCandidateNode(node, ctx, state, depth) {
    if (!isRuntimeObjectLike(node) || depth > RUNTIME_DISCOVERY_MAX_DEPTH) return;

    if (Array.isArray(node)) {
      walkRuntimeCandidateArray(node, ctx, state, depth);
      return;
    }

    if (state.seen.has(node)) return;
    state.seen.add(node);

    const tabContext = buildRuntimeTabContextFromObject(node, ctx);
    if (tabContext) {
      registerRuntimeTabCandidate(state, tabContext);
    }

    const titleCandidate = resolveRuntimeRoomTitle(node);
    if (titleCandidate) {
      state.roomTitleCandidates.push(titleCandidate);
    }

    const messageEntry = buildRuntimeEntryFromMessage(node, tabContext || ctx.tab, ctx);
    if (messageEntry) {
      registerRuntimeMessageCandidate(state, messageEntry);
    }

    const entries = Object.entries(node).slice(0, 80);
    for (const [key, value] of entries) {
      if (!isRuntimeObjectLike(value)) continue;

      const nextCtx = {
        path: ctx.path ? `${ctx.path}.${key}` : key,
        tab: tabContext || ctx.tab,
        collectionKey: key,
        inTabList: isLikelyTabCollectionKey(key),
        inMessageList: isLikelyMessageCollectionKey(key)
      };

      if (Array.isArray(value)) {
        walkRuntimeCandidateArray(value, nextCtx, state, depth + 1);
        continue;
      }

      if (isLikelyTabReferenceKey(key)) {
        nextCtx.tab = buildRuntimeTabContextFromObject(value, nextCtx) || nextCtx.tab;
      }

      walkRuntimeCandidateNode(value, nextCtx, state, depth + 1);
    }
  }

  function walkRuntimeCandidateArray(items, ctx, state, depth) {
    const limit = Math.min(items.length, RUNTIME_DISCOVERY_MAX_ARRAY_ITEMS);
    for (let index = 0; index < limit; index += 1) {
      const item = items[index];
      if (!isRuntimeObjectLike(item)) continue;

      let tab = ctx.tab;
      if (ctx.inTabList) {
        tab = buildRuntimeTabContextFromObject(item, {
          ...ctx,
          inTabList: true,
          path: `${ctx.path}[${index}]`
        }) || createRuntimeTabContext({
          id: "",
          key: `${ctx.path || "tab"}#${index}`,
          name: `\uD0ED ${index + 1}`,
          order: index + 1
        });
        registerRuntimeTabCandidate(state, tab);
      }

      walkRuntimeCandidateNode(item, {
        path: `${ctx.path}[${index}]`,
        tab,
        collectionKey: ctx.collectionKey,
        inTabList: ctx.inTabList,
        inMessageList: ctx.inMessageList
      }, state, depth + 1);
    }
  }

  function registerRuntimeTabCandidate(state, tab) {
    if (!tab?.key) return;

    const existing = state.tabs.get(tab.key);
    if (!existing) {
      state.tabs.set(tab.key, { ...tab });
      return;
    }

    existing.id = existing.id || tab.id || "";
    existing.name = existing.name && !/^tab(?:\s+\d+)?$/i.test(existing.name) ? existing.name : (tab.name || existing.name);
    if (!Number.isFinite(existing.order) && Number.isFinite(tab.order)) {
      existing.order = tab.order;
    }
  }

  function registerRuntimeMessageCandidate(state, entry) {
    if (!entry) return;

    const targetTabKey = normalizeSpace(entry.tabKey || "");
    const targetMap = targetTabKey
      ? (state.messages.get(targetTabKey) || new Map())
      : state.looseMessages;
    const fingerprint = getEntryFingerprint(entry) || `${entry.id || ""}::${entry.rawText || entry.text || ""}`;
    const existing = targetMap.get(fingerprint);

    if (existing) {
      targetMap.set(fingerprint, preferRuntimeEntry(existing, entry));
    } else {
      targetMap.set(fingerprint, entry);
    }

    if (targetTabKey && !state.messages.has(targetTabKey)) {
      state.messages.set(targetTabKey, targetMap);
    }
  }

  function preferRuntimeEntry(current, candidate) {
    return scoreRuntimeEntry(candidate) >= scoreRuntimeEntry(current) ? candidate : current;
  }

  function scoreRuntimeEntry(entry) {
    if (!entry) return 0;
    let score = 0;
    if (entry.sender) score += 2;
    if (entry.timestamp) score += 1;
    if (entry.avatarSource) score += 1;
    if (entry.bodyHtml) score += Math.min(3, Math.floor(String(entry.bodyHtml).length / 80));
    if (entry.rawText) score += Math.min(3, Math.floor(String(entry.rawText).length / 80));
    return score;
  }

  function finalizeRuntimeGroupSet(state, roomTitle = "", meta = {}) {
    const tabs = [...state.tabs.values()];
    const groups = [];
    const fallbackTitle = state.roomTitleCandidates.find(Boolean) || roomTitle || "room";

    tabs.sort((left, right) => {
      const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
      const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.name || "").localeCompare(String(right.name || ""), "ko");
    });

    tabs.forEach((tab, index) => {
      const entryMap = state.messages.get(tab.key) || new Map();
      const entries = [...entryMap.values()]
        .sort((left, right) => {
          const leftIndex = Number.isFinite(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
          const rightIndex = Number.isFinite(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
          if (leftIndex !== rightIndex) return leftIndex - rightIndex;
          return String(left.timestamp || "").localeCompare(String(right.timestamp || ""), "ko");
        })
        .map((entry, entryIndex) => ({
          ...entry,
          index: entryIndex + 1,
          tabId: tab.id || `tab-${index + 1}`,
          tabName: tab.name || `\uD0ED ${index + 1}`
        }));

      groups.push({
        id: tab.id || `tab-${index + 1}`,
        key: tab.key || `tab-${index + 1}`,
        index,
        order: Number.isFinite(tab.order) ? tab.order : index + 1,
        name: tab.name || `\uD0ED ${index + 1}`,
        selected: false,
        entries
      });
    });

    if (!groups.length && state.looseMessages.size) {
      const tabName = resolvePackageTabLabel(fallbackTitle, "\uD0ED 1");
      groups.push({
        id: "tab-1",
        key: "tab-1",
        index: 0,
        order: 1,
        name: tabName,
        selected: false,
        entries: [...state.looseMessages.values()].map((entry, index) => ({
          ...entry,
          index: index + 1,
          tabId: "tab-1",
          tabName
        }))
      });
    }

    return groups
      .filter((group) => Array.isArray(group.entries) && group.entries.length)
      .filter((group) => !group.name || !/^(?:data|props|state)$/i.test(group.name));
  }

  function mergeRuntimeGroupSets(candidates, roomTitle = "") {
    const groupsByKey = new Map();

    candidates.forEach((candidate) => {
      candidate.groups.forEach((group, groupIndex) => {
        const key = normalizeSpace(group.key || group.id || group.name || `tab-${groupIndex + 1}`) || `tab-${groupIndex + 1}`;
        const existing = groupsByKey.get(key) || {
          id: group.id || `tab-${groupsByKey.size + 1}`,
          key,
          order: Number.isFinite(group.order) ? group.order : groupsByKey.size + 1,
          name: group.name || resolvePackageTabLabel(roomTitle, `\uD0ED ${groupsByKey.size + 1}`),
          entries: new Map()
        };

        existing.id = existing.id || group.id || "";
        existing.name = existing.name || group.name || "";
        if (Number.isFinite(group.order) && (!Number.isFinite(existing.order) || group.order < existing.order)) {
          existing.order = group.order;
        }

        group.entries.forEach((entry) => {
          const fingerprint = getEntryFingerprint(entry) || `${entry.id || ""}::${entry.rawText || entry.text || ""}`;
          const current = existing.entries.get(fingerprint);
          existing.entries.set(fingerprint, current ? preferRuntimeEntry(current, entry) : entry);
        });

        groupsByKey.set(key, existing);
      });
    });

    return [...groupsByKey.values()]
      .map((group, index) => ({
        id: group.id || `tab-${index + 1}`,
        key: group.key || `tab-${index + 1}`,
        index,
        order: Number.isFinite(group.order) ? group.order : index + 1,
        name: resolvePackageTabLabel(group.name || "", `\uD0ED ${index + 1}`),
        selected: false,
        entries: [...group.entries.values()]
          .sort((left, right) => {
            const leftIndex = Number.isFinite(left.index) ? left.index : Number.MAX_SAFE_INTEGER;
            const rightIndex = Number.isFinite(right.index) ? right.index : Number.MAX_SAFE_INTEGER;
            if (leftIndex !== rightIndex) return leftIndex - rightIndex;
            return String(left.timestamp || "").localeCompare(String(right.timestamp || ""), "ko");
          })
          .map((entry, entryIndex) => ({
            ...entry,
            index: entryIndex + 1,
            tabId: group.id || `tab-${index + 1}`,
            tabName: resolvePackageTabLabel(group.name || "", `\uD0ED ${index + 1}`)
          }))
      }))
      .filter((group) => group.entries.length)
      .sort((left, right) => left.order - right.order);
  }

  function scoreRuntimeGroupSet(groups, meta = {}) {
    const tabCount = groups.length;
    const totalEntries = groups.reduce((sum, group) => sum + group.entries.length, 0);
    const namedTabs = groups.filter((group) => group.name && !/^\uD0ED\s+\d+$/.test(group.name)).length;
    const sourceBonus = /react|apollo|store|__NEXT_DATA__/.test(String(meta.source || "")) ? 40 : 0;
    return (tabCount * 1000) + (totalEntries * 10) + (namedTabs * 20) + sourceBonus;
  }

  function buildRuntimeTabContextFromObject(value, ctx = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const directTabId = firstRuntimePrimitive(value, [
      ["tabId"],
      ["chatTabId"],
      ["channelId"],
      ["threadId"]
    ]);
    const directTabName = firstRuntimeString(value, [
      ["tabName"],
      ["channelName"],
      ["threadName"]
    ], true);
    const messageArray = firstRuntimeArray(value, [
      ["messages"],
      ["logs"],
      ["entries"],
      ["chatMessages"],
      ["chatLogs"],
      ["comments"]
    ]);
    const inTabList = !!ctx.inTabList || isLikelyTabCollectionKey(ctx.collectionKey || "");
    const hasMessages = Array.isArray(messageArray) && messageArray.length > 0;

    if (!inTabList && !hasMessages && !directTabId && !directTabName) {
      return null;
    }

    const fallbackId = inTabList || hasMessages
      ? firstRuntimePrimitive(value, [["id"], ["uuid"], ["key"]])
      : "";
    const fallbackName = inTabList || hasMessages
      ? firstRuntimeString(value, [["name"], ["label"], ["title"]], true)
      : "";

    return createRuntimeTabContext({
      id: directTabId || fallbackId || "",
      key: directTabId || fallbackId || directTabName || fallbackName || ctx.path || "",
      name: directTabName || fallbackName || "",
      order: Number.isFinite(value.order) ? Number(value.order) : (Number.isFinite(value.index) ? Number(value.index) + 1 : null)
    });
  }

  function createRuntimeTabContext(tab) {
    const key = normalizeSpace(String(tab?.key || tab?.id || tab?.name || ""));
    if (!key) return null;

    return {
      id: normalizeSpace(String(tab?.id || "")),
      key,
      name: resolvePackageTabLabel(String(tab?.name || ""), ""),
      order: Number.isFinite(tab?.order) ? Number(tab.order) : null
    };
  }

  function buildRuntimeEntryFromMessage(value, tabContext = null, ctx = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const rawTextCandidate = firstRuntimeString(value, [
      ["rawText"],
      ["text"],
      ["message"],
      ["body"],
      ["content"],
      ["comment"],
      ["memo"],
      ["plainText"],
      ["displayText"],
      ["message", "text"],
      ["content", "text"]
    ]);
    const formatRuns = firstRuntimeArray(value, [
      ["formatRuns"],
      ["message", "formatRuns"]
    ]) || [];
    const alignRuns = firstRuntimeArray(value, [
      ["alignRuns"],
      ["message", "alignRuns"]
    ]) || [];
    const blockStyle = firstRuntimeObject(value, [
      ["blockStyle"],
      ["message", "blockStyle"]
    ]) || {};

    const hasFormatting = (Array.isArray(formatRuns) && formatRuns.length > 0)
      || (Array.isArray(alignRuns) && alignRuns.length > 0)
      || (blockStyle && Object.keys(blockStyle).length > 0);
    if (!rawTextCandidate && !hasFormatting) return null;
    if (!rawTextCandidate && !ctx.inMessageList) return null;

    const messageId = normalizeSpace(String(firstRuntimePrimitive(value, [
      ["messageId"],
      ["id"],
      ["uuid"],
      ["key"]
    ]) || ""));
    const sender = resolveRuntimeSenderName(value, ctx);
    const timestamp = normalizeRuntimeTimestamp(firstRuntimePrimitive(value, [
      ["timestamp"],
      ["createdAt"],
      ["sentAt"],
      ["postedAt"],
      ["date"],
      ["time"]
    ]));
    const tabFromMessage = buildRuntimeTabContextFromMessage(value) || tabContext;
    const hasMessageSignal = ctx.inMessageList
      || !!sender
      || !!timestamp
      || !!messageId
      || !!tabFromMessage
      || hasFormatting
      || /(?:message|log|entry|comment|talk)/i.test(String(ctx.collectionKey || ctx.path || ""));
    if (!hasMessageSignal) return null;

    const extracted = rawTextCandidate ? extractEnvelope(rawTextCandidate) : null;
    const rawText = rawTextCandidate || "";
    const text = extracted?.envelope?.text != null
      ? normalizeText(String(extracted.envelope.text))
      : normalizeText(stripInvisibleEnvelope(rawText));
    if (!text && !hasFormatting) return null;

    const effectiveFormatRuns = extracted?.envelope?.formatRuns || formatRuns || [];
    const effectiveAlignRuns = extracted?.envelope?.alignRuns || alignRuns || [];
    const effectiveBlockStyle = extracted?.envelope?.blockStyle || blockStyle || {};
    const avatarSource = firstRuntimeString(value, [
      ["avatarSource"],
      ["avatarUrl"],
      ["iconUrl"],
      ["imageUrl"],
      ["sender", "avatarUrl"],
      ["sender", "iconUrl"],
      ["character", "iconUrl"],
      ["character", "imageUrl"],
      ["user", "avatarUrl"],
      ["player", "avatarUrl"]
    ]);
    const baseColor = normalizeCssColor(firstRuntimeString(value, [
      ["baseColor"],
      ["color"],
      ["textColor"],
      ["sender", "color"],
      ["character", "color"]
    ]));
    const channel = firstRuntimeString(value, [
      ["channel"],
      ["channelName"]
    ], true) || "";
    const bodyHtml = buildRenderedMessageHtml({
      text,
      formatRuns: effectiveFormatRuns,
      alignRuns: effectiveAlignRuns,
      blockStyle: effectiveBlockStyle,
      baseColor
    });
    const assetSources = collectAssetSourcesFromHtml(bodyHtml);
    const id = messageId || `runtime-${Math.random().toString(36).slice(2, 10)}`;

    return {
      index: Number.isFinite(value.index) ? Number(value.index) + 1 : Number.NaN,
      id,
      sender,
      avatarSource: normalizeAssetSource(avatarSource) || avatarSource || "",
      timestamp,
      metaTexts: [channel, sender, timestamp].filter(Boolean),
      channel,
      text,
      visibleText: text,
      rawText: rawText || text,
      baseColor,
      formatEnvelopeVersion: extracted?.envelope?.v ?? null,
      formatRuns: cloneJson(effectiveFormatRuns),
      alignRuns: cloneJson(effectiveAlignRuns),
      blockStyle: cloneJson(effectiveBlockStyle),
      assetSources,
      bodyHtml,
      packageHtml: "",
      tabKey: tabFromMessage?.key || "",
      tabId: tabFromMessage?.id || "",
      tabName: tabFromMessage?.name || ""
    };
  }

  function buildRuntimeTabContextFromMessage(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const directId = firstRuntimePrimitive(value, [
      ["tabId"],
      ["chatTabId"],
      ["channelId"],
      ["threadId"]
    ]);
    const directName = firstRuntimeString(value, [
      ["tabName"],
      ["channelName"],
      ["threadName"]
    ], true);
    const nestedTab = firstRuntimeObject(value, [
      ["tab"],
      ["channel"],
      ["thread"]
    ]);

    if (nestedTab) {
      return buildRuntimeTabContextFromObject(nestedTab, {
        collectionKey: "tab"
      });
    }

    if (!directId && !directName) return null;
    return createRuntimeTabContext({
      id: directId || "",
      key: directId || directName || "",
      name: directName || ""
    });
  }

  function resolveRuntimeSenderName(value, ctx = {}) {
    const explicit = firstRuntimeString(value, [
      ["senderName"],
      ["userName"],
      ["playerName"],
      ["characterName"],
      ["speakerName"],
      ["sender", "name"],
      ["sender", "displayName"],
      ["user", "name"],
      ["player", "name"],
      ["character", "name"],
      ["speaker", "name"]
    ], true);
    if (explicit) return explicit;

    if (ctx.inMessageList) {
      return firstRuntimeString(value, [["name"]], true);
    }
    return "";
  }

  function resolveRuntimeRoomTitle(value) {
    return firstRuntimeString(value, [
      ["room", "title"],
      ["room", "name"],
      ["roomName"],
      ["roomTitle"]
    ], true);
  }

  function normalizeRuntimeTimestamp(value) {
    if (value == null || value === "") return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const epoch = value > 1e12 ? value : value * 1000;
      const date = new Date(epoch);
      return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return "";
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber) && /^\d{10,13}$/.test(trimmed)) {
        return normalizeRuntimeTimestamp(asNumber);
      }
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
    }
    return "";
  }

  function firstRuntimeString(value, paths, trimSpaces = false) {
    const resolved = firstRuntimePrimitive(value, paths);
    if (resolved == null) return "";
    const text = typeof resolved === "string" ? resolved : String(resolved);
    return trimSpaces ? normalizeSpace(text) : normalizeText(text);
  }

  function firstRuntimePrimitive(value, paths) {
    for (const path of paths || []) {
      const resolved = getRuntimeValueByPath(value, path);
      if (resolved == null) continue;
      if (typeof resolved === "string" && !resolved.trim()) continue;
      if (typeof resolved === "number" && !Number.isFinite(resolved)) continue;
      if (typeof resolved === "boolean") continue;
      if (typeof resolved === "string" || typeof resolved === "number") {
        return resolved;
      }
    }
    return null;
  }

  function firstRuntimeArray(value, paths) {
    for (const path of paths || []) {
      const resolved = getRuntimeValueByPath(value, path);
      if (Array.isArray(resolved)) return resolved;
    }
    return null;
  }

  function firstRuntimeObject(value, paths) {
    for (const path of paths || []) {
      const resolved = getRuntimeValueByPath(value, path);
      if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
        return resolved;
      }
    }
    return null;
  }

  function getRuntimeValueByPath(root, path) {
    let current = root;
    for (const segment of path || []) {
      if (!current || typeof current !== "object") return null;
      current = current[segment];
    }
    return current;
  }

  function isRuntimeObjectLike(value) {
    if (!value || typeof value !== "object") return false;
    if (value instanceof Element) return false;
    if (value instanceof Node) return false;
    if (value instanceof Date) return false;
    if (value instanceof RegExp) return false;
    if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) return false;
    if (typeof Window !== "undefined" && value instanceof Window) return false;
    return true;
  }

  function isLikelyTabCollectionKey(value) {
    return /(?:^|\.)(?:tabs?|chatTabs?|channels?|threads?|tabList)$/i.test(String(value || ""));
  }

  function isLikelyMessageCollectionKey(value) {
    return /(?:^|\.)(?:messages?|logs?|entries|chatMessages?|chatLogs?|comments?|talks?)$/i.test(String(value || ""));
  }

  function isLikelyTabReferenceKey(value) {
    return /(?:tab|channel|thread)/i.test(String(value || ""));
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ccf-log-package-menu-item {
        position: relative;
      }

      .ccf-log-package-menu-label {
        pointer-events: none;
      }

      .ccf-log-package-menu-item[data-busy="1"] {
        opacity: 0.68;
        pointer-events: none;
      }

      .ccf-log-package-menu-item[data-busy="1"]::after {
        content: "";
        position: absolute;
        top: 50%;
        right: 16px;
        width: 12px;
        height: 12px;
        margin-top: -6px;
        border-radius: 0;
        border: 2px solid currentColor;
        border-right-color: transparent;
        animation: ccf-log-package-spin 1s linear infinite;
      }

      @keyframes ccf-log-package-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function observeDom() {
    const observer = new MutationObserver(() => {
      if (!ccfLpActive) return;
      scheduleEnsureButtons();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    ccfLpRegisterTeardown(() => observer.disconnect());
  }


  // ----------------------------------------------------
  // [수정 포인트 2] 스케줄러 내부에 버튼 주입 함수 호출 추가
  // ----------------------------------------------------
  function scheduleEnsureButtons() {
    if (buttonState.scheduled) return;
    buttonState.scheduled = true;
    requestAnimationFrame(() => {
      buttonState.scheduled = false;
      ensureExportButtons();
      ensureCustomDeleteButtons(); // ← 새로 추가된 부분
    });
  }

  function ensureExportButtons() {
    const menus = findTargetMenus();
    for (const menu of menus) {
      if (!(menu instanceof HTMLElement)) continue;

      const anchors = findMenuAnchors(menu);
      if (!anchors.exportAllLogsItem && !anchors.exportLogsItem && !anchors.tabEditItem) continue;
      const existingButtons = cleanupDuplicateExportButtons(menu, anchors);
      if (existingButtons.length) {
        existingButtons.forEach((button) => syncExportButtonState(button));
        continue;
      }

      const referenceItem = anchors.tabEditItem || anchors.exportAllLogsItem || anchors.exportLogsItem;
      const button = createExportButton(referenceItem);
      const parent = referenceItem?.parentElement || menu;

      if (anchors.tabEditItem && anchors.tabEditItem.parentElement === parent) {
        parent.insertBefore(button, anchors.tabEditItem);
      } else if (anchors.exportAllLogsItem && anchors.exportAllLogsItem.parentElement === parent) {
        anchors.exportAllLogsItem.insertAdjacentElement("afterend", button);
      } else if (anchors.exportLogsItem && anchors.exportLogsItem.parentElement === parent) {
        anchors.exportLogsItem.insertAdjacentElement("afterend", button);
      } else {
        parent.appendChild(button);
      }
    }
  }

  // ----------------------------------------------------
  // [수정 포인트 3] 커스텀 삭제 버튼 주입 및 클릭 이벤트 핸들러 추가
  // (ensureExportButtons 함수가 끝나는 바로 밑에 아래 함수들을 통째로 추가하세요)
  // ----------------------------------------------------
  function ensureCustomDeleteButtons() {
    const menus = document.querySelectorAll('[role="menu"]');
    
    for (const menu of menus) {
      if (!(menu instanceof HTMLElement) || !isVisible(menu)) continue;

      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      
      const nativeDeleteBtn = items.find((item) => {
        const text = normalizeSpace(item.textContent || "").toLowerCase();
        return text.includes("룸 로그 삭제") || text.includes("delete room log") || text.includes("ルームログ削除");
      });

      if (nativeDeleteBtn && !menu.querySelector(DELETE_TAB_BTN_SELECTOR)) {
        const customDeleteBtn = document.createElement("li");
        
        customDeleteBtn.className = cleanupMenuItemClassName(nativeDeleteBtn.className);
        customDeleteBtn.setAttribute(DELETE_TAB_BTN_ATTR, "1");
        customDeleteBtn.setAttribute("role", "menuitem");
        customDeleteBtn.setAttribute("tabindex", "-1");

        const label = document.createElement("span");
        label.textContent = "현재 탭 룸 로그 삭제";
        customDeleteBtn.appendChild(label);

        const ripple = nativeDeleteBtn.querySelector(".MuiTouchRipple-root");
        if (ripple) {
          customDeleteBtn.appendChild(ripple.cloneNode(false));
        }

        customDeleteBtn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          
          await handleDeleteCurrentTabLogs();
          await dismissTransientMenusAndOverlays();
        });

        nativeDeleteBtn.insertAdjacentElement("afterend", customDeleteBtn);
      }
    }
  }

  async function handleDeleteCurrentTabLogs() {
    const roomTitle = getRoomTitle("");
    const currentTab = getCurrentPackageTabDescriptor(roomTitle);

    if (!currentTab) {
      alert("현재 활성화된 탭을 찾을 수 없습니다.");
      return;
    }

    const confirmDelete = confirm(`정말 [ ${currentTab.name} ] 탭의 로그만 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
    if (!confirmDelete) return;

    console.log(`[CCF LOG PACKAGE] ${currentTab.name} 탭 로그 삭제 요청됨.`);
    setButtonsBusy(true);

    try {
      const scope = findPrimaryLogScope(currentTab);
      if (!scope) {
        throw new Error("탭 로그 영역을 찾을 수 없습니다.");
      }

      const scroller = findLogScrollContainer(scope);
      if (scroller) {
        scroller.style.scrollBehavior = "auto";
      }

      let deletedCount = 0;
      let emptyCount = 0;
      
      const toastId = "ccf-delete-toast";
      let toast = document.getElementById(toastId);
      if (!toast) {
        toast = document.createElement("div");
        toast.id = toastId;
        toast.style.cssText = "position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.8); color: white; padding: 10px 20px; border-radius: 8px; z-index: 9999; font-size: 14px; pointer-events: none;";
        document.body.appendChild(toast);
      }
      
      const updateToast = (msg) => {
        if (toast) toast.textContent = msg;
      };

      while (emptyCount < 3) {
        const itemRoots = findLogMessageItemRoots([scope]);

        // React의 동적 렌더링 최적화(마우스 오버 시에만 휴지통 렌더링)에 대응하기 위해 Hover 이벤트를 강제 발생시킵니다.
        for (const root of itemRoots) {
          root.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          root.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, cancelable: true }));
        }
        // DOM에 버튼이 추가될 수 있도록 아주 짧게 대기합니다.
        await new Promise((r) => setTimeout(r, 60));

        const deleteBtns = [];
        
        for (const root of itemRoots) {
          const btn = root.querySelector('button[aria-label*="삭제"], button[aria-label*="delete" i], button[aria-label*="削除"], button[title*="삭제"], button[title*="delete" i], button[title*="削除"], svg[data-testid*="Delete" i], path[d^="M6 19c0"]')?.closest('button');
          if (btn) {
            deleteBtns.push(btn);
          }
        }

        if (deleteBtns.length === 0) {
          emptyCount++;
          if (scroller) {
            scroller.scrollTop = Math.max(0, scroller.scrollTop - scroller.clientHeight);
          }
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        emptyCount = 0;
        
        for (let i = deleteBtns.length - 1; i >= 0; i--) {
          const btn = deleteBtns[i];
          try {
            btn.click();

            // 간혹 개별 삭제 시 확인 다이얼로그가 뜨는 버전을 대비
            await new Promise((r) => setTimeout(r, 30));
            const confirmDialog = document.querySelector('[role="dialog"]');
            if (confirmDialog) {
              const confirmBtn = confirmDialog.querySelector('button[aria-label*="삭제"], button[aria-label*="delete" i], button[aria-label*="削除"], button[title*="삭제"], button[title*="delete" i], button[title*="削除"], button.MuiButton-containedSecondary, button.MuiButton-containedPrimary:not(:first-of-type)');
              if (confirmBtn) {
                confirmBtn.click();
                await new Promise((r) => setTimeout(r, 30));
              }
            }

            deletedCount++;
            updateToast(`[ ${currentTab.name} ] 탭 삭제 중... (${deletedCount}개 삭제됨)`);
          } catch (e) {
            console.warn("[CCF LOG PACKAGE] 개별 메시지 삭제 클릭 실패:", e);
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        
        await new Promise((r) => setTimeout(r, 500));
      }

      if (toast) toast.remove();
      alert(`[ ${currentTab.name} ] 탭에서 총 ${deletedCount}개의 메시지를 삭제했습니다.`);
    } catch (error) {
      console.error("[CCF LOG PACKAGE] delete failed", error);
      alert(error?.message || "로그 삭제 중 오류가 발생했습니다.");
    } finally {
      setButtonsBusy(false);
    }
  }
  // ----------------------------------------------------

  function cleanupDuplicateExportButtons(menu, anchors) {
    const buttons = [...menu.querySelectorAll(EXPORT_BTN_SELECTOR)]
      .filter((button) => button instanceof HTMLElement)
      .filter((button) => button.closest('[role="menu"]') === menu);

    if (buttons.length <= 1) return buttons;

    const parent =
      anchors.tabEditItem?.parentElement ||
      anchors.exportLogsItem?.parentElement ||
      buttons[0]?.parentElement ||
      menu;

    const sorted = buttons.slice().sort((left, right) => {
      if (left.parentElement !== parent) return 1;
      if (right.parentElement !== parent) return -1;
      return getNodeIndex(left) - getNodeIndex(right);
    });

    const keep = sorted[0];
    for (const button of sorted.slice(1)) {
      button.remove();
    }

    return keep ? [keep] : [];
  }

  function getNodeIndex(node) {
    if (!(node instanceof Node) || !node.parentNode) return Number.MAX_SAFE_INTEGER;
    return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
  }

  function createExportButton(referenceItem = null) {
    const button = document.createElement("li");
    button.className = cleanupMenuItemClassName(referenceItem?.className || "MuiButtonBase-root MuiMenuItem-root MuiMenuItem-gutters");
    button.classList.add("ccf-log-package-menu-item");
    button.setAttribute(EXPORT_BTN_ATTR, "1");
    button.setAttribute("role", "menuitem");
    button.setAttribute("tabindex", "-1");
    button.setAttribute("aria-label", CAPYBARA_LOG_LABEL);
    button.setAttribute("title", CAPYBARA_LOG_LABEL);
    button.dataset.defaultLabel = CAPYBARA_LOG_LABEL;

    const label = document.createElement("span");
    label.className = "ccf-log-package-menu-label";
    button.appendChild(label);

    const ripple = referenceItem?.querySelector?.(".MuiTouchRipple-root");
    if (ripple instanceof HTMLElement) {
      button.appendChild(ripple.cloneNode(false));
    }

    syncExportButtonState(button);

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // 사용자 제스처 컨텍스트가 살아있는 동안 즉시 새 탭을 연다.
      // (await 후 window.open을 호출하면 팝업 차단됨)
      const editorWin = openCapybaraLogEditorTab();
      if (!editorWin) return;
      void handleCapybaraLogLaunch(button, editorWin);
    });

    return button;
  }

  async function handleExport(originButton = null) {
    if (buttonState.busy) return;

    setButtonsBusy(true);
    try {
      const result = await buildLogPackage(originButton);
      downloadBlob(result.fileName, result.blob);
    } catch (error) {
      console.error("[CCF LOG PACKAGE] export failed", error);
      alert(error?.message || "로그 패키지를 만들지 못했습니다.");
    } finally {
      setButtonsBusy(false);
    }
  }

  function openCapybaraLogEditorTab() {
    const roomId = getCurrentCcfRoomId();
    if (!roomId) {
      alert("현재 페이지에서 코코포리아 룸 ID를 찾지 못했습니다.\n룸 주소가 /rooms/ROOM_ID 형식인지 확인해 주세요.");
      return null;
    }

    let blobUrl = "";
    try {
      const blob = new Blob([getCapybaraLogEditorHtml()], { type: "text/html;charset=utf-8" });
      blobUrl = URL.createObjectURL(blob);
    } catch (error) {
      console.error("[CAPYBARA LOG] failed to build editor blob", error);
      alert("편집기 페이지를 준비하지 못했습니다. 콘솔을 확인해 주세요.");
      return null;
    }

    // 새 탭이 blob을 다 읽기 전에 revoke되면 안 되므로 충분히 길게 잡고 회수.
    setTimeout(() => {
      try { URL.revokeObjectURL(blobUrl); } catch {}
    }, 60000);

    // 사용자 제스처 컨텍스트 안에서 즉시 호출되어야 팝업 차단을 피할 수 있다.
    // window 참조를 유지해야 postMessage 핸드오프가 가능하므로 noopener 미사용.
    const editorWin = window.open(blobUrl, "_blank");
    if (!editorWin) {
      alert("편집기 창을 열지 못했습니다. 팝업 차단을 확인해 주세요.");
      return null;
    }
    return editorWin;
  }

  async function handleCapybaraLogLaunch(originButton = null, editorWin = null) {
    if (buttonState.busy) {
      try { editorWin?.close?.(); } catch {}
      return;
    }

    const roomId = getCurrentCcfRoomId();
    const roomUrl = `https://ccfolia.com/rooms/${encodeURIComponent(roomId)}`;

    setButtonsBusy(true);
    try {
      const payload = await collectLogPayload(originButton);
      const record = {
        version: 1,
        roomId,
        roomUrl,
        capturedAt: Date.now(),
        payload
      };
      await deliverHandoffToEditor(editorWin, { roomId, roomUrl, record });
      const totalTabs = Array.isArray(payload?.tabs) ? payload.tabs.length : 0;
      const totalMessages = Array.isArray(payload?.entries) ? payload.entries.length : 0;
      alert([
        "카피바라 로그 출력이 완료되었습니다.",
        "",
        `탭: ${totalTabs}개`,
        `메시지: ${totalMessages}개`,
        "",
        "편집기 창에서 출력할 탭을 선택해 주세요."
      ].join("\n"));
    } catch (error) {
      console.error("[CAPYBARA LOG] launch failed", error);
      alert(error?.message || "카피바라 로그를 준비하지 못했습니다.");
      try { editorWin?.close?.(); } catch {}
    } finally {
      setButtonsBusy(false);
    }
  }

  function deliverHandoffToEditor(editorWin, message) {
    return new Promise((resolve, reject) => {
      if (!editorWin) {
        reject(new Error("편집기 창 참조를 잃어버렸습니다."));
        return;
      }

      const settle = (fn) => {
        try { window.removeEventListener("message", onMessage); } catch {}
        clearTimeout(timeoutTimer);
        clearInterval(retryTimer);
        fn();
      };

      const send = () => {
        try {
          editorWin.postMessage({
            source: CAPYBARA_LOG_HANDOFF_MESSAGE_SOURCE,
            type: CAPYBARA_LOG_HANDOFF_MESSAGE_TYPE,
            roomId: message.roomId,
            roomUrl: message.roomUrl,
            record: message.record
          }, "*");
        } catch (error) {
          settle(() => reject(error));
        }
      };

      const onMessage = (event) => {
        const data = event?.data;
        if (!data || typeof data !== "object") return;
        if (data.source !== CAPYBARA_LOG_HANDOFF_EDITOR_SOURCE) return;
        if (data.type === CAPYBARA_LOG_HANDOFF_READY_TYPE) {
          send();
        } else if (data.type === CAPYBARA_LOG_HANDOFF_ACK_TYPE) {
          settle(() => resolve());
        } else if (data.type === CAPYBARA_LOG_HANDOFF_ERROR_TYPE) {
          settle(() => reject(new Error(String(data.message || "편집기에서 오류가 발생했습니다."))));
        }
      };

      // 편집기가 ready 메시지를 놓쳐도 동작하도록, 일정 주기로 재전송한다.
      let retryTimer = setInterval(send, 1500);
      const timeoutTimer = setTimeout(() => {
        settle(() => reject(new Error("편집기 응답 시간 초과 (30초). 편집기 페이지가 정상적으로 로드됐는지 확인해 주세요.")));
      }, 30000);

      window.addEventListener("message", onMessage);
      // 편집기 로드가 빠를 수도 있으니 한 번은 즉시 시도.
      send();
    });
  }

  function getCurrentCcfRoomId() {
    const pathMatch = location.pathname.match(/\/rooms\/([^/?#]+)/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
    const hrefMatch = location.href.match(/ccfolia\.com\/rooms\/([^/?#]+)/i);
    if (hrefMatch?.[1]) return decodeURIComponent(hrefMatch[1]);
    return "";
  }

  function getCapybaraLogEditorHtml() {
    return CAPYBARA_LOG_EDITOR_HTML.replace(
      [
        "function resolveAvatarUrl(entry, assetMaps) {",
        "    const source = entry?.avatarSource || \"\";",
        "    if (!source) return \"\";",
        "    return assetMaps.bySource.get(source) || \"\";",
        "  }"
      ].join("\n"),
      [
        "function resolveAvatarUrl(entry, assetMaps) {",
        "    const source = String(entry?.avatarSource || \"\").trim();",
        "    if (!source) return \"\";",
        "    const bundled = assetMaps.bySource.get(source);",
        "    if (bundled) return bundled;",
        "    if (/^\\/\\//.test(source)) return \"https:\" + source;",
        "    if (/^(https?:|data:image\\/)/i.test(source)) return source;",
        "    return \"\";",
        "  }"
      ].join("\n")
    );
  }

  function setButtonsBusy(nextBusy) {
    buttonState.busy = !!nextBusy;
    document.querySelectorAll(EXPORT_BTN_SELECTOR).forEach((button) => {
      syncExportButtonState(button);
      button.setAttribute("aria-disabled", buttonState.busy ? "true" : "false");
    });
  }

  function syncExportButtonState(button) {
    if (!(button instanceof HTMLElement)) return;
    button.dataset.busy = buttonState.busy ? "1" : "0";
    const label = button.querySelector(".ccf-log-package-menu-label");
    if (label instanceof HTMLElement) {
      label.textContent = buttonState.busy
        ? "카피바라 로그 준비 중..."
        : (button.dataset.defaultLabel || CAPYBARA_LOG_LABEL);
    }
  }

  async function buildLogPackage(originButton = null) {
    const payload = await collectLogPayload(originButton);
    const blob = await buildStoredZipFromPayload(payload);
    return {
      fileName: buildPackageFileName(payload.roomTitle, payload.roomAddress, payload.exportedAt),
      blob
    };
  }

  async function collectLogPayload(originButton = null) {
    const exportedAt = new Date();
    let roomTitle = getRoomTitle("");
    const roomAddress = getRoomAddressLabel();
    const currentTab = getCurrentPackageTabDescriptor(roomTitle);
    let tabGroups = [];

    const t0 = Date.now();
    const officialLog = await captureOfficialLogHtml(originButton, {
      preferAll: true,
      allowAllFallback: true
    });
    console.info("[CAPYBARA LOG][timing] official-log", {
      ms: Date.now() - t0,
      hasHtml: !!officialLog?.html,
      htmlLength: officialLog?.html?.length || 0
    });
    if (officialLog?.html) {
      roomTitle = getRoomTitle(officialLog.fileName || roomTitle || "");
      const officialGroups = buildPackageTabGroupsFromOfficialLogHtml(officialLog.html, roomTitle);
      if (officialGroups.length) {
        tabGroups = officialGroups;
      } else {
        tabGroups = await collectSinglePackageTabGroup(originButton, roomTitle, currentTab, 0, officialLog);
      }
    }

    if (!tabGroups.length) {
      const tRuntime = Date.now();
      tabGroups = collectRuntimePackageTabGroups(roomTitle);
      console.info("[CAPYBARA LOG][timing] runtime-state-scan", {
        ms: Date.now() - tRuntime,
        groups: tabGroups.length,
        entries: tabGroups.reduce((n, g) => n + (g?.entries?.length || 0), 0)
      });
    }

    if (!tabGroups.length && CCF_LOG_ENABLE_DOM_SCROLL_FALLBACK) {
      const t1 = Date.now();
      tabGroups = await collectPackageTabGroups(originButton, roomTitle, officialLog);
      console.info("[CAPYBARA LOG][timing] dom-scroll-scan", {
        ms: Date.now() - t1,
        groups: tabGroups.length,
        entries: tabGroups.reduce((n, g) => n + (g?.entries?.length || 0), 0)
      });
    }

    tabGroups = finalizeAllPackageTabGroups(tabGroups, roomTitle);

    const tabs = tabGroups.map((tab, index) => ({
      id: tab.id || `tab-${index + 1}`,
      name: tab.name || `\uD0ED ${index + 1}`,
      order: index + 1,
      messageCount: Array.isArray(tab.entries) ? tab.entries.length : 0
    }));
    const entries = tabGroups.flatMap((tab) => Array.isArray(tab.entries) ? tab.entries : []);
    console.info("[CCF LOG PACKAGE] avatar stats before enrich", {
      totalEntries: entries.length,
      entriesWithAvatar: countEntriesWithAvatar(entries)
    });
    if (!entries.length) {
      throw new Error("내보낼 채팅 로그를 찾지 못했습니다.");
    }
    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      const roomId = getCurrentCcfRoomId();
      if (roomId) {
        const tFirestore = Date.now();
        const result = await enrichEntriesWithFirestoreAvatars(entries, roomId);
        console.info("[CAPYBARA LOG][timing] firestore-avatar-enrich", {
          ms: Date.now() - tFirestore,
          charactersFetched: result.charactersFetched,
          entriesFilled: result.entriesFilled,
          totalEntries: entries.length
        });
      }
    }
    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      enrichEntriesWithRuntimeAvatars(entries);
    }
    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      const tCharacterList = Date.now();
      const result = await enrichEntriesWithCharacterListAvatars(entries);
      console.info("[CAPYBARA LOG][timing] character-list-avatar-enrich", {
        ms: Date.now() - tCharacterList,
        profilesFound: result.profilesFound,
        entriesFilled: result.entriesFilled,
        totalEntries: entries.length
      });
    }
    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      await dismissTransientMenusAndOverlays();
      const tVisibleAvatar = Date.now();
      const result = enrichEntriesWithVisibleLiveAvatars(entries, currentTab);
      console.info("[CAPYBARA LOG][timing] visible-avatar-enrich", {
        ms: Date.now() - tVisibleAvatar,
        liveEntries: result.liveEntries,
        entriesFilled: result.entriesFilled,
        totalEntries: entries.length
      });
    }
    console.info("[CCF LOG PACKAGE] avatar stats after runtime enrich", {
      totalEntries: entries.length,
      entriesWithAvatar: countEntriesWithAvatar(entries)
    });
    // 라이브 아바타 스캔은 매우 비싼 작업이라 누락 비율이 임계값을 넘을 때만 시도.
    // (collectSinglePackageTabGroup 안에서도 동일 가드를 사용한다)
    if (CCF_LOG_ENABLE_LIVE_AVATAR_SCAN && shouldRunLiveAvatarScan(entries)) {
      const t2 = Date.now();
      await dismissTransientMenusAndOverlays();
      await enrichPackageTabGroupsWithLiveAvatars(tabGroups, roomTitle);
      console.info("[CAPYBARA LOG][timing] live-avatar-scan done", { ms: Date.now() - t2 });
    }
    console.info("[CCF LOG PACKAGE] avatar stats after live enrich", {
      totalEntries: entries.length,
      entriesWithAvatar: countEntriesWithAvatar(entries)
    });
    const uniqueAvatarSources = collectUniqueAvatarSources(entries);
    console.info("[CCF LOG PACKAGE] avatar asset summary before bundle", {
      uniqueAvatarSources: uniqueAvatarSources.length,
      sampleAvatarSource: uniqueAvatarSources[0] || ""
    });
    const assets = await buildAssetBundle(entries);
    const avatarAssets = assets.filter((asset) => uniqueAvatarSources.includes(normalizeAssetSource(asset?.source || "")));
    console.info("[CCF LOG PACKAGE] avatar asset summary after bundle", {
      uniqueAvatarSources: uniqueAvatarSources.length,
      avatarAssets: avatarAssets.length,
      includedAvatarAssets: avatarAssets.filter((asset) => asset?.included).length,
      sampleAvatarRenderUrl: avatarAssets[0]?.renderUrl || "",
      sampleAvatarError: avatarAssets.find((asset) => asset && !asset.included)?.error || ""
    });
    const assetMap = new Map(assets.map((asset) => [asset.source, asset]));
    for (const entry of entries) {
      entry.packageHtml = rewriteEntryHtmlForPackage(entry.bodyHtml, assetMap);
    }
    const currentThemeDefinition = getPackageThemeDefinition();
    const themeOptionModel = getPackageThemeOptionModel(currentThemeDefinition.mode);
    const themeDefinition = themeOptionModel.definitions[themeOptionModel.selectedMode] || currentThemeDefinition;

    const logJson = buildLogJson({
      roomTitle,
      exportedAt,
      entries,
      assets,
      tabs
    });
    const tistoryContentHtml = buildTistoryContentHtml({
      roomTitle,
      exportedAt,
      entries,
      assets,
      themeDefinition,
      tabs
    });
    const tistoryContentHtmlByMode = {
      [themeOptionModel.selectedMode]: tistoryContentHtml
    };
    const indexHtml = buildIndexHtml({
      roomTitle,
      exportedAt,
      entries,
      assets,
      tistoryContentHtml,
      themeDefinition,
      themeOptionModel,
      tistoryContentHtmlByMode,
      tabs
    });

    return {
      roomTitle,
      roomAddress,
      exportedAt,
      entries,
      assets,
      tabs,
      tabGroups,
      logJson,
      indexHtml,
      tistoryContentHtml,
      tistoryContentHtmlByMode,
      themeDefinition,
      themeOptionModel
    };
  }

  async function buildStoredZipFromPayload(payload) {
    const { exportedAt, assets, logJson, indexHtml } = payload;
    const zipEntries = [
      makeZipEntry("log.json", encodeUtf8(logJson), exportedAt),
      makeZipEntry("index.html", encodeUtf8(indexHtml), exportedAt)
    ];

    for (const asset of assets) {
      if (!asset.included || !(asset.bytes instanceof Uint8Array) || !asset.fileName) continue;
      zipEntries.push(makeZipEntry(asset.fileName, asset.bytes, exportedAt));
    }

    const zipBytes = buildStoredZip(zipEntries);
    return new Blob([zipBytes], { type: "application/zip" });
  }

  function getCurrentPackageTabDescriptor(roomTitle = "") {
    const discoveredTabs = findChatTabDescriptors()
      .map((tab, index) => normalizePackageTabDescriptor(tab, index, roomTitle));
    return discoveredTabs.find((tab) => tab.selected) || discoveredTabs[0] || null;
  }

  function selectCurrentPackageTabGroups(tabGroups, currentTab = null, roomTitle = "") {
    const groups = (Array.isArray(tabGroups) ? tabGroups : []).filter(Boolean);
    if (groups.length <= 1) return groups;

    const fallbackTab = currentTab || getCurrentPackageTabDescriptor(roomTitle);
    const tabIndex = Number.isFinite(fallbackTab?.index) ? Number(fallbackTab.index) : 0;
    const normalizedTab = fallbackTab
      ? normalizePackageTabDescriptor(fallbackTab, tabIndex, roomTitle)
      : null;
    const nonEmptyGroups = groups.filter((group) => Array.isArray(group?.entries) && group.entries.length);
    const candidateGroups = nonEmptyGroups.length ? nonEmptyGroups : groups;

    let matchedGroup = null;
    if (normalizedTab) {
      matchedGroup = candidateGroups.find((group) => isPackageGroupMatchingPanelTab(group, normalizedTab))
        || candidateGroups.find((group) => isPackageTabDescriptorMatching(group, normalizedTab));
    }

    matchedGroup = matchedGroup
      || candidateGroups.find((group) => group?.selected)
      || candidateGroups[0]
      || null;

    return matchedGroup ? [matchedGroup] : [];
  }

  function finalizeCurrentPackageTabGroups(tabGroups, currentTab = null, roomTitle = "") {
    const groups = selectCurrentPackageTabGroups(tabGroups, currentTab, roomTitle);
    if (!groups.length) return [];

    const fallbackTab = currentTab || getCurrentPackageTabDescriptor(roomTitle);
    if (!fallbackTab) {
      return finalizePackageTabGroupsWithoutPanel([{ ...groups[0], index: 0, order: 1 }]);
    }

    const tab = normalizePackageTabDescriptor(fallbackTab, 0, roomTitle);
    return finalizePackageTabGroupsWithoutPanel([
      applyPanelTabDescriptorToGroup(groups[0], tab, 0)
    ]);
  }

  function finalizeAllPackageTabGroups(tabGroups, roomTitle = "") {
    const groups = Array.isArray(tabGroups) ? tabGroups.filter(Boolean) : [];
    if (!groups.length) return [];

    const reconciled = reconcilePackageTabGroupsWithPanel(groups, roomTitle);
    return finalizePackageTabGroupsWithoutPanel(reconciled);
  }

  function selectCurrentPackagePanelTab(panelTabs, currentTab = null, roomTitle = "") {
    const tabs = (Array.isArray(panelTabs) ? panelTabs : []).filter(Boolean);
    if (!tabs.length) return null;

    const fallbackTab = currentTab || getCurrentPackageTabDescriptor(roomTitle);
    if (fallbackTab) {
      const tabIndex = Number.isFinite(fallbackTab?.index) ? Number(fallbackTab.index) : 0;
      const normalizedTab = normalizePackageTabDescriptor(fallbackTab, tabIndex, roomTitle);
      const matchedTab = tabs.find((tab) => isPackageTabDescriptorMatching(tab, normalizedTab));
      if (matchedTab) return matchedTab;
    }

    return tabs.find((tab) => tab?.selected) || tabs[0] || null;
  }

  function isPackageTabDescriptorMatching(left, right) {
    if (!left || !right) return false;

    const leftKey = normalizeSpace(left?.key || "");
    const rightKey = normalizeSpace(right?.key || "");
    if (leftKey && rightKey && leftKey === rightKey) return true;

    const leftName = normalizePackageTabMatchKey(left?.name || "");
    const rightName = normalizePackageTabMatchKey(right?.name || "");
    if (leftName && rightName && leftName === rightName) return true;

    const leftIndex = Number.isFinite(left?.index)
      ? Number(left.index)
      : (Number.isFinite(left?.order) ? Number(left.order) - 1 : null);
    const rightIndex = Number.isFinite(right?.index)
      ? Number(right.index)
      : (Number.isFinite(right?.order) ? Number(right.order) - 1 : null);

    return leftIndex !== null && rightIndex !== null && leftIndex === rightIndex;
  }

  function reconcilePackageTabGroupsWithPanel(tabGroups, roomTitle = "") {
    if (!Array.isArray(tabGroups) || !tabGroups.length) return Array.isArray(tabGroups) ? tabGroups : [];

    const panelTabs = findPackagePanelTabDescriptors(tabGroups, roomTitle)
      .map((tab, index) => normalizePackageTabDescriptor(tab, index, roomTitle));
    if (!panelTabs.length) {
      return finalizePackageTabGroupsWithoutPanel(tabGroups);
    }

    const groups = tabGroups.map((group, index) => ({
      ...group,
      id: group?.id || `tab-${index + 1}`,
      key: normalizeSpace(group?.key || "") || `tab-${index + 1}`,
      index: Number.isFinite(group?.index) ? Number(group.index) : index,
      order: Number.isFinite(group?.order) ? Number(group.order) : index + 1,
      name: resolvePackageTabLabel(group?.name || "", `\uD0ED ${index + 1}`),
      entries: Array.isArray(group?.entries) ? group.entries.slice() : []
    }));

    const usedGroups = new Set();
    const ordered = [];

    for (let panelIndex = 0; panelIndex < panelTabs.length; panelIndex += 1) {
      const panelTab = panelTabs[panelIndex];
      let matchedIndex = groups.findIndex((group, index) =>
        !usedGroups.has(index)
        && isPackageGroupMatchingPanelTab(group, panelTab)
      );

      if (matchedIndex < 0 && groups.length === panelTabs.length) {
        matchedIndex = groups.findIndex((group, index) =>
          !usedGroups.has(index)
          && (group.index === panelIndex || group.order === panelIndex + 1)
        );
      }

      if (matchedIndex < 0) {
        matchedIndex = groups.findIndex((_, index) => !usedGroups.has(index));
      }

      if (matchedIndex < 0) {
        ordered.push(createEmptyPackageTabGroupFromPanel(panelTab, panelIndex));
        continue;
      }

      usedGroups.add(matchedIndex);
      ordered.push(applyPanelTabDescriptorToGroup(groups[matchedIndex], panelTab, panelIndex));
    }

    groups.forEach((group, index) => {
      if (usedGroups.has(index)) return;
      ordered.push(applyPanelTabDescriptorToGroup(group, null, ordered.length));
    });

    return finalizePackageTabGroupsWithoutPanel(ordered);
  }

  function finalizePackageTabGroupsWithoutPanel(tabGroups) {
    return (Array.isArray(tabGroups) ? tabGroups : [])
      .map((group, index) => {
        const nextName = resolveDisplayPackageTabName(group?.name || "", `\uD0ED ${index + 1}`);
        const nextEntries = (Array.isArray(group?.entries) ? group.entries : []).map((entry, entryIndex) => ({
          ...entry,
          index: entryIndex + 1,
          tabId: group?.id || `tab-${index + 1}`,
          tabName: resolveDisplayPackageTabName(entry?.tabName || nextName, nextName),
          channel: resolveDisplayPackageTabName(entry?.channel || "", entry?.channel || "")
        }));

        return {
          ...group,
          id: group?.id || `tab-${index + 1}`,
          key: normalizeSpace(group?.key || "") || `tab-${index + 1}`,
          index,
          order: index + 1,
          name: nextName,
          entries: nextEntries
        };
      })
      .sort((left, right) => {
        const leftRank = getPackageTabDisplayRank(left, left.index);
        const rightRank = getPackageTabDisplayRank(right, right.index);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.index - right.index;
      })
      .map((group, index) => ({
        ...group,
        index,
        order: index + 1,
        entries: (Array.isArray(group.entries) ? group.entries : []).map((entry, entryIndex) => ({
          ...entry,
          index: entryIndex + 1,
          tabId: group.id || `tab-${index + 1}`,
          tabName: group.name || `\uD0ED ${index + 1}`
        }))
      }));
  }

  function getPackageTabDisplayRank(group, fallbackIndex = 0) {
    const kind = getPackageTabCanonicalKind(group?.name || group?.key || "");
    if (kind === "main") return 0;
    if (kind === "info") return 1;
    if (kind === "other") return 2;
    return 100 + (Number.isFinite(fallbackIndex) ? fallbackIndex : 0);
  }

  function resolveDisplayPackageTabName(value, fallback = "") {
    const kind = getPackageTabCanonicalKind(value);
    if (kind === "main") return "메인";
    if (kind === "info") return "정보";
    if (kind === "other") return "잡담";

    const normalized = normalizeSpace(String(value || ""));
    const stripped = normalized
      .replace(/^[\[\(\{<\s]+/, "")
      .replace(/[\]\)\}>\s]+$/, "");
    return stripped || fallback;
  }

  function getPackageTabCanonicalKind(value) {
    const key = normalizePackageTabMatchKey(value || "");
    if (key === "main" || key === "info" || key === "other") return key;
    return "";
  }

  function findPackagePanelTabDescriptors(tabGroups = [], roomTitle = "") {
    const containers = findChatTabContainers();
    const expectedKeys = collectExpectedPackageTabMatchKeys(tabGroups, roomTitle);
    if (!containers.length) {
      const looseTabs = findLoosePackagePanelTabDescriptors(expectedKeys);
      return looseTabs.length ? looseTabs : findChatTabDescriptors();
    }

    let bestTabs = [];
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const container of containers) {
      const buttons = getPackagePanelTabButtonsFromContainer(container);
      if (!buttons.length) continue;

      const tabs = buttons.map((button, index) => createChatTabDescriptor(button, index));
      const score = scorePackagePanelTabContainer(container, tabs, expectedKeys);
      if (score > bestScore) {
        bestScore = score;
        bestTabs = tabs;
      }
    }

    if (bestTabs.length) return bestTabs;

    const looseTabs = findLoosePackagePanelTabDescriptors(expectedKeys);
    if (looseTabs.length) return looseTabs;
    return findChatTabDescriptors();
  }

  function collectExpectedPackageTabMatchKeys(tabGroups = [], roomTitle = "") {
    const keys = new Set();
    const push = (value) => {
      const key = normalizePackageTabMatchKey(value || "");
      if (key) keys.add(key);
    };

    tabGroups.forEach((group) => {
      push(group?.name || "");
      (Array.isArray(group?.entries) ? group.entries : [])
        .slice(0, 8)
        .forEach((entry) => push(entry?.channel || ""));
    });

    push(roomTitle);
    return keys;
  }

  function scorePackagePanelTabContainer(container, tabs, expectedKeys) {
    let score = scoreChatTabContainer(container, findPrimaryLogScope(), findPrimaryLogScope()?.closest?.(".MuiDrawer-paper") || null);
    score += tabs.length * 25;

    const uniqueKeys = new Set(tabs.map((tab) => normalizePackageTabMatchKey(tab?.name || "")).filter(Boolean));
    score += uniqueKeys.size * 10;

    tabs.forEach((tab, index) => {
      const key = normalizePackageTabMatchKey(tab?.name || "");
      if (expectedKeys.has(key)) score += 120;
      if (index === 0 && key === "main") score += 40;
      if (index === 1 && key === "info") score += 20;
      if (key === "other") score += 18;
    });

    return score;
  }

  function getPackagePanelTabButtonsFromContainer(container) {
    if (!(container instanceof HTMLElement)) return [];

    const selectors = [
      '[role="tab"]',
      '.MuiTab-root',
      'button[aria-controls]',
      'button[aria-selected]'
    ].join(", ");

    const out = [];
    const seen = new Set();
    container.querySelectorAll(selectors).forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      if (!isVisible(button)) return;
      if (seen.has(button)) return;
      if (!looksLikePackageTabButton(button, container)) return;
      seen.add(button);
      out.push(button);
    });

    return out;
  }

  function findLoosePackagePanelTabDescriptors(expectedKeys = new Set()) {
    const candidates = [];
    const seenElements = new Set();
    const seenMatchKeys = new Set();
    const searchRoots = [
      ...document.querySelectorAll(".MuiDrawer-paper"),
      document.body
    ].filter((root, index, array) =>
      root instanceof HTMLElement && isVisible(root) && array.indexOf(root) === index
    );

    searchRoots.forEach((root) => {
      root.querySelectorAll?.('button, [role="button"], [role="tab"], [aria-selected], [tabindex]').forEach((button) => {
        if (!(button instanceof HTMLElement)) return;
        if (!isVisible(button)) return;
        if (seenElements.has(button)) return;
        if (button.hasAttribute(EXPORT_BTN_ATTR)) return;
        if (button.closest('[role="menu"], [role="dialog"], form')) return;

        const label = getPreferredTabButtonText(button);
        const matchKey = normalizePackageTabMatchKey(label || "");
        if (!label || !matchKey) return;
        if (expectedKeys.size && !expectedKeys.has(matchKey)) return;
        if (!looksLikeLoosePackageTabButton(button, label)) return;
        if (seenMatchKeys.has(matchKey)) return;

        seenElements.add(button);
        seenMatchKeys.add(matchKey);
        candidates.push({
          button,
          matchKey,
          rect: button.getBoundingClientRect()
        });
      });
    });

    if (!candidates.length && expectedKeys.size) {
      collectLoosePackagePanelTabCandidatesFromTextMatches(searchRoots, expectedKeys).forEach((candidate) => {
        if (!(candidate?.button instanceof HTMLElement)) return;
        if (!candidate.matchKey || seenMatchKeys.has(candidate.matchKey)) return;
        if (seenElements.has(candidate.button)) return;
        seenElements.add(candidate.button);
        seenMatchKeys.add(candidate.matchKey);
        candidates.push(candidate);
      });
    }

    candidates.sort((left, right) => {
      const topDiff = Math.abs(left.rect.top) - Math.abs(right.rect.top);
      if (topDiff !== 0) return topDiff;
      return left.rect.left - right.rect.left;
    });

    return candidates.map((item, index) => createChatTabDescriptor(item.button, index));
  }

  function collectLoosePackagePanelTabCandidatesFromTextMatches(searchRoots = [], expectedKeys = new Set()) {
    if (!expectedKeys.size) return [];

    const candidates = [];
    const seenElements = new Set();
    const seenMatchKeys = new Set();
    const matchedByParent = new Map();
    const roots = Array.isArray(searchRoots)
      ? searchRoots.filter((root, index, array) =>
        root instanceof HTMLElement &&
        isVisible(root) &&
        array.indexOf(root) === index
      )
      : [];

    roots.forEach((root) => {
      root.querySelectorAll?.("span, p, div, button, [role], [aria-label], [tabindex], .MuiButtonBase-root, .MuiTab-root").forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        if (!isVisible(element)) return;
        if (seenElements.has(element)) return;
        if (element.hasAttribute(EXPORT_BTN_ATTR)) return;
        if (element.closest('[role="menu"], [role="dialog"], form')) return;
        if (element.childElementCount > 8) return;

        const label = getPreferredLoosePackageTabText(element);
        const matchKey = normalizePackageTabMatchKey(label || "");
        if (!label || !matchKey || !expectedKeys.has(matchKey)) return;
        if (!looksLikeLoosePackageTabLabel(label)) return;

        const button = resolveLoosePackageTabInteractiveElement(element);
        if (!(button instanceof HTMLElement)) return;
        if (!isVisible(button)) return;
        if (button.hasAttribute(EXPORT_BTN_ATTR)) return;
        if (button.closest('[role="menu"], [role="dialog"], form')) return;
        if (!looksLikeLoosePackageTabButton(button, label) && !looksLikeLoosePackageTabTextMatch(button, label)) return;

        seenElements.add(element);

        let parentSet = matchedByParent.get(button.parentElement || root);
        if (!parentSet) {
          parentSet = new Set();
          matchedByParent.set(button.parentElement || root, parentSet);
        }
        parentSet.add(matchKey);

        if (seenMatchKeys.has(matchKey)) return;
        seenMatchKeys.add(matchKey);
        candidates.push({
          button,
          matchKey,
          rect: button.getBoundingClientRect()
        });
      });
    });

    return candidates
      .map((candidate) => ({
        ...candidate,
        groupSize: matchedByParent.get(candidate.button.parentElement || null)?.size || 0
      }))
      .sort((left, right) => {
        if (right.groupSize !== left.groupSize) return right.groupSize - left.groupSize;
        const topDiff = Math.abs(left.rect.top) - Math.abs(right.rect.top);
        if (topDiff !== 0) return topDiff;
        return left.rect.left - right.rect.left;
      });
  }

  function getPreferredLoosePackageTabText(element) {
    if (!(element instanceof HTMLElement)) return "";

    const candidates = [
      typeof element.innerText === "string" ? element.innerText : "",
      element.textContent || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || ""
    ];

    for (const candidate of candidates) {
      const normalized = normalizeSpace(candidate || "");
      if (!normalized) continue;
      if (normalized.length > 40) continue;
      return normalized;
    }

    return "";
  }

  function looksLikeLoosePackageTabLabel(label = "") {
    const normalized = normalizeSpace(label);
    if (!normalized) return false;
    if (normalized === "+" || /^\++$/.test(normalized)) return false;
    if (/^(?:add|new|create)$/i.test(normalized)) return false;
    if (/\uD0ED\s*\uCD94\uAC00/.test(normalized) || /\uC0C8\s*\uD0ED/.test(normalized)) return false;
    return normalized.length <= 32;
  }

  function resolveLoosePackageTabInteractiveElement(element) {
    if (!(element instanceof HTMLElement)) return null;

    let current = element;
    for (let depth = 0; depth < 5 && current instanceof HTMLElement; depth += 1) {
      if (looksLikeLoosePackageTabTextMatch(current, getPreferredLoosePackageTabText(element))) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function looksLikeLoosePackageTabTextMatch(element, label = "") {
    if (!(element instanceof HTMLElement)) return false;
    const tokens = [
      label,
      element.className || "",
      element.getAttribute("role") || "",
      element.getAttribute("data-testid") || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("tabindex") || ""
    ].join(" ").toLowerCase();

    if (element.matches?.('button, [role="button"], [role="tab"], .MuiTab-root, .MuiButtonBase-root, [tabindex]')) {
      return true;
    }
    if (element.onclick || element.hasAttribute("onclick")) return true;
    if (/tab|channel|thread|mui(buttonbase|tab)|clickable|select/.test(tokens)) return true;
    return getComputedStyle(element).cursor === "pointer";
  }

  function looksLikeLoosePackageTabButton(button, label = "") {
    if (!(button instanceof HTMLElement)) return false;
    const tokens = [
      label,
      button.className || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("data-testid") || "",
      button.getAttribute("role") || ""
    ].join(" ").toLowerCase();

    if (
      label === "+"
      || /^\++$/.test(label)
      || /(?:^|\s)(?:add|new|create)\s*tab(?:$|\s)/i.test(tokens)
      || /\uD0ED\s*\uCD94\uAC00/.test(label)
      || /\uC0C8\s*\uD0ED/.test(label)
    ) {
      return false;
    }

    if (button.matches?.('[role="tab"], .MuiTab-root')) return true;
    if (button.closest?.(".MuiTabs-root, [role='tablist']")) return true;
    if (/tab|mui(buttonbase|tab)|channel|thread/.test(tokens)) return true;
    if (button.tagName === "BUTTON" || button.getAttribute("role") === "button") return true;
    return false;
  }

  function looksLikePackageTabButton(button, container = null) {
    if (!(button instanceof HTMLElement)) return false;

    const label = getPreferredTabButtonText(button);
    if (!label) return false;

    const tokenText = [
      label,
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || "",
      button.className || ""
    ].join(" ").toLowerCase();

    if (
      label === "+"
      || /^\++$/.test(label)
      || /(?:^|\s)(?:add|new|create)\s*tab(?:$|\s)/i.test(tokenText)
      || /\uD0ED\s*\uCD94\uAC00/.test(label)
      || /\uC0C8\s*\uD0ED/.test(label)
    ) {
      return false;
    }

    if (hasChatTabSemantics(button)) return true;
    if (container instanceof HTMLElement && (container.getAttribute("role") === "tablist" || container.classList.contains("MuiTabs-root"))) {
      return true;
    }

    return false;
  }

  function isPackageGroupMatchingPanelTab(group, panelTab) {
    if (!group || !panelTab) return false;

    const panelName = normalizePackageTabMatchKey(panelTab.name || "");
    const groupName = normalizePackageTabMatchKey(group.name || "");
    if (panelName && groupName && panelName === groupName) {
      return true;
    }

    const panelKey = normalizePackageTabMatchKey(panelTab.key || "");
    const groupKey = normalizePackageTabMatchKey(group.key || "");
    if (panelKey && groupKey && panelKey === groupKey) {
      return true;
    }

    const channelNames = (Array.isArray(group.entries) ? group.entries : [])
      .slice(0, 6)
      .map((entry) => normalizePackageTabMatchKey(entry?.channel || ""))
      .filter(Boolean);
    return !!(panelName && channelNames.includes(panelName));
  }

  function normalizePackageTabMatchKey(value) {
    const normalized = normalizeSpace(String(value || "")).toLowerCase();
    if (!normalized) return "";

    const stripped = normalized
      .replace(/^[\[\(\{<\s]+/, "")
      .replace(/[\]\)\}>\s]+$/, "")
      .replace(/\s+/g, "");

    if (!stripped) return "";
    if (stripped === "main" || stripped === "메인" || stripped === "メイン") return "main";
    if (stripped === "info" || stripped === "정보" || stripped === "インフォ" || stripped === "information") return "info";
    if (stripped === "other" || stripped === "잡담" || stripped === "雑談" || stripped === "chat") return "other";
    return stripped;
  }

  function applyPanelTabDescriptorToGroup(group, panelTab = null, index = 0) {
    const nextId = panelTab?.id || group?.id || `tab-${index + 1}`;
    const nextKey = normalizeSpace(panelTab?.key || group?.key || "") || `tab-${index + 1}`;
    const nextName = resolvePackageTabLabel(
      panelTab?.name || group?.name || "",
      `\uD0ED ${index + 1}`
    );
    const nextEntries = (Array.isArray(group?.entries) ? group.entries : []).map((entry, entryIndex) => ({
      ...entry,
      index: entryIndex + 1,
      tabId: nextId,
      tabName: nextName
    }));

    return {
      ...group,
      id: nextId,
      key: nextKey,
      index,
      order: index + 1,
      name: nextName,
      selected: !!panelTab?.selected,
      entries: nextEntries
    };
  }

  function createEmptyPackageTabGroupFromPanel(panelTab, index = 0) {
    const nextId = panelTab?.id || `tab-${index + 1}`;
    const nextName = resolvePackageTabLabel(panelTab?.name || "", `\uD0ED ${index + 1}`);
    return {
      id: nextId,
      key: normalizeSpace(panelTab?.key || "") || nextId,
      index,
      order: index + 1,
      name: nextName,
      selected: !!panelTab?.selected,
      entries: []
    };
  }

  async function collectPackageTabGroups(originButton = null, roomTitle = "", initialOfficialLog = null) {
    const panelTabs = findPackagePanelTabDescriptors([], roomTitle)
      .map((tab, index) => normalizePackageTabDescriptor(tab, index, roomTitle));

    if (!panelTabs.length) {
      const currentTab = getCurrentPackageTabDescriptor(roomTitle);
      const tabIndex = Number.isFinite(currentTab?.index) ? Number(currentTab.index) : 0;
      return collectSinglePackageTabGroup(originButton, roomTitle, currentTab, tabIndex, null, {
        allowOfficialLogCapture: false
      });
    }

    const out = [];

    for (let i = 0; i < panelTabs.length; i += 1) {
      const tab = panelTabs[i];

      try {
        await activateChatTab(tab);
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        console.warn("[CAPYBARA LOG] tab activation failed", tab?.name || i, error);
      }

      const groups = await collectSinglePackageTabGroup(originButton, roomTitle, tab, i, null, {
        allowOfficialLogCapture: false
      });

      for (const group of groups) {
        if (!group || !Array.isArray(group.entries) || !group.entries.length) continue;
        out.push(applyPanelTabDescriptorToGroup(group, tab, i));
      }
    }

    return out;
  }

  async function collectSinglePackageTabGroup(originButton = null, roomTitle = "", baseTab = null, index = 0, initialOfficialLog = null, options = {}) {
    const allowOfficialLogCapture = options?.allowOfficialLogCapture !== false;
    const officialLog = initialOfficialLog?.html
      ? initialOfficialLog
      : (allowOfficialLogCapture
        ? await captureOfficialLogHtml(originButton, { preferAll: false, allowAllFallback: false })
        : null);
    const entries = officialLog?.html
      ? parseOfficialLogEntries(officialLog.html)
      : await collectLogEntries(baseTab);
    if (!entries.length) return [];

    // 1차: 코코포리아 Firestore에서 캐릭터 아바타를 일괄 조회해 채운다.
    // 라이브 DOM 스캔보다 훨씬 빠르고 진짜 캐릭터 이미지를 얻을 수 있다.
    const roomId = getCurrentCcfRoomId();
    if (roomId) {
      const t = Date.now();
      const result = await enrichEntriesWithFirestoreAvatars(entries, roomId);
      console.info("[CAPYBARA LOG][timing] firestore-avatar-enrich", {
        ms: Date.now() - t,
        charactersFetched: result.charactersFetched,
        entriesFilled: result.entriesFilled,
        totalEntries: entries.length
      });
    }

    // 2차: 그래도 누락 비율이 큰 경우만 라이브 DOM 스캔으로 보완.
    // (스크롤 기반 가상 DOM 렌더링이라 매우 느린 작업)
    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      enrichEntriesWithRuntimeAvatars(entries);
    }

    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      const tCharacterList = Date.now();
      const result = await enrichEntriesWithCharacterListAvatars(entries);
      console.info("[CAPYBARA LOG][timing] character-list-avatar-enrich", {
        ms: Date.now() - tCharacterList,
        profilesFound: result.profilesFound,
        entriesFilled: result.entriesFilled,
        totalEntries: entries.length
      });
    }

    if (entries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) {
      await dismissTransientMenusAndOverlays();
      const tVisibleAvatar = Date.now();
      const result = enrichEntriesWithVisibleLiveAvatars(entries, baseTab);
      console.info("[CAPYBARA LOG][timing] visible-avatar-enrich", {
        ms: Date.now() - tVisibleAvatar,
        liveEntries: result.liveEntries,
        entriesFilled: result.entriesFilled,
        totalEntries: entries.length
      });
    }

    if (CCF_LOG_ENABLE_LIVE_AVATAR_SCAN && shouldRunLiveAvatarScan(entries)) {
      await enrichEntriesWithLiveAvatars(entries);
    }

    const sampleSources = [...new Set(
      entries.map((e) => e?.avatarSource || "").filter(Boolean)
    )].slice(0, 5);
    console.info("[CAPYBARA LOG][diag] avatar source samples", {
      uniqueSources: sampleSources.length,
      samples: sampleSources.map((s) => s.length > 80 ? s.slice(0, 80) + "..." : s)
    });

    const tab = normalizePackageTabDescriptor(baseTab, index, roomTitle);
    annotateEntriesWithTabInfo(entries, tab);
    return [{ ...tab, entries }];
  }

  function shouldRunLiveAvatarScan(entries, threshold = 0.3) {
    if (!Array.isArray(entries) || !entries.length) return false;
    const missing = entries.filter((entry) => !normalizeAssetSource(entry?.avatarSource || "")).length;
    if (!missing) return false;
    return (missing / entries.length) >= threshold;
  }

  // 코코포리아의 공개 Firestore REST API에서 룸 캐릭터 목록을 가져온다.
  // 인증 불필요. 참조: sukenell/cclog_custom, eon-00/eon-ccfolia-log-converter.
  async function fetchCcfoliaCharacterMap(roomId) {
    const out = new Map();
    if (!roomId) return out;
    const baseUrl = `https://firestore.googleapis.com/v1/projects/ccfolia-160aa/databases/(default)/documents/rooms/${encodeURIComponent(roomId)}/characters`;
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const url = new URL(baseUrl);
      url.searchParams.set("pageSize", "300");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      let response;
      try {
        response = await fetch(url.toString(), { credentials: "omit", mode: "cors" });
      } catch (error) {
        console.warn("[CAPYBARA LOG] firestore character fetch failed", error);
        return out;
      }
      if (!response.ok) {
        console.warn("[CAPYBARA LOG] firestore character fetch http", response.status);
        return out;
      }
      let data;
      try {
        data = await response.json();
      } catch (error) {
        console.warn("[CAPYBARA LOG] firestore character parse failed", error);
        return out;
      }
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      for (const doc of docs) {
        const fields = doc?.fields || {};
        const name = String(fields.name?.stringValue || "").trim();
        const iconUrl = normalizeFirestoreAvatarUrl(readFirestoreAvatarUrl(fields));
        if (name && iconUrl && !out.has(name)) {
          out.set(name, iconUrl);
        }
        const normalizedName = normalizeSenderKey(name);
        if (normalizedName && iconUrl && !out.has(normalizedName)) {
          out.set(normalizedName, iconUrl);
        }
      }
      pageToken = data?.nextPageToken || "";
      if (!pageToken) break;
    }
    return out;
  }

  function readFirestoreAvatarUrl(fields) {
    if (!fields || typeof fields !== "object") return "";
    const directKeys = [
      "iconUrl",
      "imageUrl",
      "avatarUrl",
      "portraitUrl",
      "thumbnailUrl",
      "url"
    ];
    for (const key of directKeys) {
      const value = readFirestoreStringValue(fields[key]);
      if (value) return value;
    }
    const nestedKeys = ["icon", "image", "avatar", "portrait", "thumbnail"];
    for (const key of nestedKeys) {
      const nested = fields[key]?.mapValue?.fields;
      if (!nested) continue;
      for (const childKey of directKeys) {
        const value = readFirestoreStringValue(nested[childKey]);
        if (value) return value;
      }
    }
    return "";
  }

  function readFirestoreStringValue(value) {
    if (!value || typeof value !== "object") return "";
    if (typeof value.stringValue === "string") return value.stringValue.trim();
    if (typeof value.referenceValue === "string") return value.referenceValue.trim();
    const values = value.arrayValue?.values;
    if (Array.isArray(values)) {
      for (const item of values) {
        const nested = readFirestoreStringValue(item);
        if (nested) return nested;
      }
    }
    return "";
  }

  function normalizeFirestoreAvatarUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const gsMatch = raw.match(/^gs:\/\/([^/]+)\/(.+)$/i);
    if (gsMatch) {
      return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(gsMatch[1])}/o/${encodeURIComponent(gsMatch[2])}?alt=media`;
    }
    return normalizeImageUrl(raw) || normalizeAssetSource(raw);
  }

  async function enrichEntriesWithFirestoreAvatars(entries, roomId) {
    if (!Array.isArray(entries) || !entries.length || !roomId) {
      return { charactersFetched: 0, entriesFilled: 0 };
    }
    const map = await fetchCcfoliaCharacterMap(roomId);
    if (!map.size) return { charactersFetched: 0, entriesFilled: 0 };
    let filled = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (normalizeAssetSource(entry.avatarSource || "")) continue;
      const sender = String(entry.sender || "").trim();
      if (!sender) continue;
      const iconUrl = normalizeFirestoreAvatarUrl(map.get(sender) || map.get(normalizeSenderKey(sender)));
      if (!iconUrl) continue;
      entry.avatarSource = iconUrl;
      if (Array.isArray(entry.assetSources)) {
        if (!entry.assetSources.includes(iconUrl)) entry.assetSources.push(iconUrl);
      } else {
        entry.assetSources = [iconUrl];
      }
      filled++;
    }
    return { charactersFetched: map.size, entriesFilled: filled };
  }

  async function enrichEntriesWithCharacterListAvatars(entries) {
    if (!CCF_LOG_ENABLE_CHARACTER_LIST_AVATAR_SCAN || !Array.isArray(entries) || !entries.length) {
      return { profilesFound: 0, entriesFilled: 0 };
    }

    const profileMap = await collectCharacterListAvatarMap();
    if (!profileMap.size) return { profilesFound: 0, entriesFilled: 0 };

    let filled = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (normalizeAssetSource(entry.avatarSource || "")) continue;

      const senderKey = normalizeSenderKey(entry.sender || "");
      if (!senderKey) continue;

      const avatarSource = profileMap.get(senderKey) || "";
      if (!avatarSource) continue;

      addAvatarSourceToEntry(entry, avatarSource);
      filled += 1;
    }

    return { profilesFound: profileMap.size, entriesFilled: filled };
  }

  async function collectCharacterListAvatarMap() {
    const out = new Map();
    if (!CCF_LOG_ENABLE_CHARACTER_LIST_AVATAR_SCAN) return out;

    await dismissTransientMenusAndOverlays();

    const visibleProfiles = extractCharacterProfilesFromVisibleRoots();
    mergeCharacterProfileMaps(out, visibleProfiles);
    if (out.size) return out;

    const buttons = findCharacterListButtons().slice(0, 4);
    for (const button of buttons) {
      const profileMap = await collectCharacterProfilesFromButton(button);
      mergeCharacterProfileMaps(out, profileMap);
      if (out.size) break;
    }

    return out;
  }

  async function collectCharacterProfilesFromButton(button) {
    const out = new Map();
    if (!(button instanceof HTMLElement) || !isVisible(button)) return out;

    const wasExpanded = button.getAttribute("aria-expanded") === "true";
    let root = wasExpanded ? findCharacterListRoot(button) : null;

    if (!root && !wasExpanded) {
      button.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }

    try {
      for (let i = 0; i < 10; i += 1) {
        await waitForAnimationFrame();
        await waitForAnimationFrame();
        await new Promise((resolve) => setTimeout(resolve, 60));

        root = findCharacterListRoot(button);
        if (!(root instanceof HTMLElement)) continue;

        mergeCharacterProfileMaps(out, extractCharacterProfilesFromRoot(root));
        if (out.size) break;
      }
    } finally {
      if (!wasExpanded) {
        await closeCharacterListPopup(button, root);
      }
    }

    return out;
  }

  function findCharacterListButtons() {
    const directLabels = [
      "\uB0B4 \uCE90\uB9AD\uD130 \uBAA9\uB85D",
      "\uCE90\uB9AD\uD130 \uBAA9\uB85D",
      "\uCE90\uB9AD\uD130 \uC120\uD0DD",
      "\uB9C8\uC774 \uCE90\uB9AD\uD130",
      "\u30DE\u30A4\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u4E00\u89A7",
      "\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u9078\u629E",
      "My character list",
      "My characters",
      "Character list",
      "Character selection",
      "Select character",
      "Characters"
    ];
    const fragments = [
      "\uCE90\uB9AD\uD130",
      "\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC",
      "character"
    ].map((value) => value.toLowerCase());

    const buttons = [...document.querySelectorAll("button, [role=\"button\"]")]
      .filter((button) => button instanceof HTMLElement && isVisible(button));
    const seen = new Set();
    const out = [];
    const add = (button) => {
      if (!(button instanceof HTMLElement) || seen.has(button)) return;
      seen.add(button);
      out.push(button);
    };

    for (const label of directLabels) {
      buttons
        .filter((button) => getButtonAccessibleText(button) === label)
        .forEach(add);
    }

    buttons
      .filter((button) => {
        const text = getButtonAccessibleText(button).toLowerCase();
        if (!text) return false;
        return fragments.some((fragment) => text.includes(fragment));
      })
      .forEach(add);

    return out;
  }

  function getButtonAccessibleText(button) {
    if (!(button instanceof HTMLElement)) return "";
    return normalizeSpace(
      button.getAttribute("aria-label")
      || button.getAttribute("title")
      || button.getAttribute("data-testid")
      || button.textContent
      || ""
    );
  }

  function findCharacterListRoot(button = null) {
    const roots = [];
    const push = (root) => {
      if (!(root instanceof HTMLElement)) return;
      if (!isVisible(root)) return;
      roots.push(root);
    };

    if (button instanceof HTMLElement) {
      [
        button.getAttribute("aria-controls"),
        button.getAttribute("aria-owns")
      ].forEach((id) => {
        const root = id ? document.getElementById(id) : null;
        push(root);
      });
    }

    document.querySelectorAll([
      ".MuiPopover-root",
      ".MuiModal-root",
      ".MuiMenu-root",
      "[role=\"dialog\"]",
      "[role=\"presentation\"]",
      ".MuiPaper-root"
    ].join(", ")).forEach(push);

    return roots
      .map((root) => ({ root, score: scoreCharacterListRoot(root) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.root || null;
  }

  function extractCharacterProfilesFromVisibleRoots() {
    const out = new Map();
    document.querySelectorAll([
      ".MuiPopover-root",
      ".MuiModal-root",
      ".MuiMenu-root",
      "[role=\"dialog\"]",
      "[role=\"listbox\"]"
    ].join(", ")).forEach((root) => {
      if (!(root instanceof HTMLElement) || !isVisible(root)) return;
      if (scoreCharacterListRoot(root) <= 0) return;
      mergeCharacterProfileMaps(out, extractCharacterProfilesFromRoot(root));
    });
    return out;
  }

  function scoreCharacterListRoot(root) {
    if (!(root instanceof HTMLElement)) return 0;
    const itemCount = root.querySelectorAll([
      ".MuiListItemButton-root",
      ".MuiListItem-root",
      "[role=\"option\"]",
      "[role=\"menuitem\"]",
      "li"
    ].join(", ")).length;
    const avatarCount = root.querySelectorAll(AVATAR_NODE_SELECTOR).length;
    if (!avatarCount) return 0;
    const text = normalizeSpace(root.textContent || "").toLowerCase();
    const labelScore = /character|\uCE90\uB9AD\uD130|\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC/.test(text) ? 2 : 0;
    return (Math.min(itemCount, 20) * 2) + (Math.min(avatarCount, 20) * 4) + labelScore;
  }

  function extractCharacterProfilesFromRoot(root) {
    const out = new Map();
    if (!(root instanceof HTMLElement)) return out;

    const items = [...root.querySelectorAll([
      ".MuiListItemButton-root",
      ".MuiListItem-root",
      "[role=\"option\"]",
      "[role=\"menuitem\"]",
      "li",
      "button"
    ].join(", "))]
      .filter((item) => item instanceof HTMLElement && isVisible(item))
      .slice(0, CHARACTER_LIST_AVATAR_SCAN_MAX_ENTRIES);

    for (const item of items) {
      const avatarSource = extractElementImageSource(item);
      if (!avatarSource) continue;

      const name = getCharacterProfileItemName(item);
      const senderKey = normalizeSenderKey(name);
      if (!senderKey || out.has(senderKey)) continue;

      out.set(senderKey, avatarSource);
    }

    return out;
  }

  function getCharacterProfileItemName(item) {
    if (!(item instanceof HTMLElement)) return "";

    const preferredSelectors = [
      ".MuiListItemText-primary",
      "[class*=\"MuiListItemText-primary\"]",
      ".MuiTypography-body1",
      ".MuiTypography-subtitle1",
      "[class*=\"primary\"]"
    ];

    for (const selector of preferredSelectors) {
      const node = item.querySelector(selector);
      const text = normalizeCharacterProfileName(node?.textContent || "");
      if (text) return text;
    }

    const lines = readNodeTextWithBreaks(item)
      .split(/\n+/)
      .map(normalizeCharacterProfileName)
      .filter(Boolean);
    return lines[0] || normalizeCharacterProfileName(item.textContent || "");
  }

  function normalizeCharacterProfileName(value) {
    const text = normalizeSpace(value);
    if (!text || text.length > 120) return "";
    if (looksLikeTimestamp(text)) return "";
    return text;
  }

  function mergeCharacterProfileMaps(target, source) {
    if (!(target instanceof Map) || !(source instanceof Map)) return target;
    source.forEach((avatarSource, senderKey) => {
      if (!senderKey || !avatarSource || target.has(senderKey)) return;
      target.set(senderKey, avatarSource);
    });
    return target;
  }

  async function closeCharacterListPopup(button, root) {
    const escapeEventInit = {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true
    };
    const target = root instanceof HTMLElement ? root : (button instanceof HTMLElement ? button : document.body);
    target.dispatchEvent(new KeyboardEvent("keydown", escapeEventInit));
    target.dispatchEvent(new KeyboardEvent("keyup", escapeEventInit));
    document.dispatchEvent(new KeyboardEvent("keydown", escapeEventInit));
    document.dispatchEvent(new KeyboardEvent("keyup", escapeEventInit));

    if (document.activeElement instanceof HTMLElement) {
      try {
        document.activeElement.blur();
      } catch (error) {
        // Ignore blur failures.
      }
    }

    await waitForAnimationFrame();
    await waitForAnimationFrame();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  function normalizePackageTabDescriptor(tab, index = 0, roomTitle = "") {
    const order = index + 1;
    const fallbackName = normalizeSpace(roomTitle || "") || `\uD0ED ${order}`;
    const name = resolvePackageTabLabel(tab?.name || "", fallbackName);

    return {
      id: `tab-${order}`,
      key: normalizeSpace(tab?.key || "") || `tab-key-${order}`,
      index: Number.isFinite(tab?.index) ? Number(tab.index) : index,
      name,
      selected: !!tab?.selected
    };
  }

  function annotateEntriesWithTabInfo(entries, tab) {
    if (!Array.isArray(entries) || !tab) return;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      entry.tabId = tab.id || "";
      entry.tabName = tab.name || "";
    }
  }

  function resolvePackageTabLabel(value, fallback) {
    const normalized = normalizeSpace(value || "");
    if (!normalized) return fallback;
    return /^\?+(?:\s+\d+)?$/.test(normalized) ? fallback : normalized;
  }

  function findChatTabDescriptors() {
    const containers = findChatTabContainers();
    if (!containers.length) return [];

    const out = [];
    const seenButtons = new Set();

    for (const container of containers) {
      const buttons = getChatTabButtonsFromContainer(container);
      for (const button of buttons) {
        if (!(button instanceof HTMLElement)) continue;
        if (seenButtons.has(button)) continue;

        const tab = createChatTabDescriptor(button, out.length);
        if (!tab?.key) continue;

        seenButtons.add(button);
        out.push(tab);
      }
    }

    return out;
  }

  function findChatTabContainers() {
    const primaryScope = findPrimaryLogScope();
    const primaryDrawer = primaryScope?.closest?.(".MuiDrawer-paper") || null;
    const searchRoots = [
      primaryDrawer,
      ...findComposerBars()
        .map((bar) => bar?.closest?.(".MuiDrawer-paper"))
        .filter((root) => root instanceof HTMLElement),
      document.body
    ].filter((root, index, array) => root instanceof HTMLElement && array.indexOf(root) === index);

    const candidates = [];
    const seen = new Set();

    for (const root of searchRoots) {
      root.querySelectorAll?.('[role="tablist"], .MuiTabs-root').forEach((container) => {
        if (!(container instanceof HTMLElement)) return;
        if (!isVisible(container)) return;
        if (seen.has(container)) return;
        seen.add(container);
        candidates.push(container);
      });
    }

    candidates.sort((left, right) =>
      scoreChatTabContainer(right, primaryScope, primaryDrawer)
      - scoreChatTabContainer(left, primaryScope, primaryDrawer)
    );

    return candidates;
  }

  function findBestChatTabContainer() {
    return findChatTabContainers()[0] || null;
  }

  function scoreChatTabContainer(container, primaryScope = null, primaryDrawer = null) {
    const buttons = getChatTabButtonsFromContainer(container);
    if (!buttons.length) return Number.NEGATIVE_INFINITY;

    let score = buttons.length * 12;
    if (container.getAttribute("role") === "tablist") score += 12;
    if (buttons.some((button) => isChatTabSelected(button))) score += 20;

    const drawer = container.closest(".MuiDrawer-paper");
    if (primaryDrawer && drawer === primaryDrawer) score += 44;
    if (primaryScope && (container.contains(primaryScope) || primaryScope.contains(container))) score += 60;

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      score += Math.min(18, Math.round(rect.width / 80));
    }
    if (buttons.length === 1) score -= 8;
    return score;
  }

  function getChatTabButtonsFromContainer(container) {
    if (!(container instanceof HTMLElement)) return [];

    const out = [];
    const seen = new Set();
    container.querySelectorAll('[role="tab"], .MuiTab-root[aria-selected], .MuiTab-root[aria-controls]').forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      if (!isVisible(button)) return;
      if (seen.has(button)) return;
      if (!hasChatTabSemantics(button)) return;
      if (!isChatLogTabButton(button)) return;
      seen.add(button);
      out.push(button);
    });
    return out;
  }

  function isChatLogTabButton(button) {
    if (!(button instanceof HTMLElement)) return false;
    if (!hasChatTabSemantics(button)) return false;

    const ariaSelected = button.getAttribute("aria-selected");
    const ariaControls = normalizeSpace(button.getAttribute("aria-controls") || "");
    const label = normalizeSpace(
      button.getAttribute("aria-label")
      || button.getAttribute("title")
      || button.textContent
      || ""
    );
    const tokenText = [
      label,
      button.getAttribute("data-testid") || "",
      button.className || ""
    ].join(" ").toLowerCase();

    if (
      label === "+"
      || label === "＋"
      || /^\++$/.test(label)
      || /^[+＋]\s*(?:tab)?$/i.test(label)
      || /(?:^|\s)(?:add|new|create)\s*tab(?:$|\s)/i.test(tokenText)
      || /\uD0ED\s*\uCD94\uAC00/.test(label)
      || /\uC0C8\s*\uD0ED/.test(label)
      || /tab[-_\s]*add|add[-_\s]*tab|new[-_\s]*tab|create[-_\s]*tab/.test(tokenText)
    ) {
      return false;
    }

    if (!ariaControls && ariaSelected !== "true" && ariaSelected !== "false") {
      return false;
    }

    return !!(label || ariaControls);
  }

  function hasChatTabSemantics(button) {
    if (!(button instanceof HTMLElement)) return false;
    const role = normalizeSpace(button.getAttribute("role") || "").toLowerCase();
    const ariaSelected = button.getAttribute("aria-selected");
    const ariaControls = normalizeSpace(button.getAttribute("aria-controls") || "");
    return role === "tab" || ariaSelected === "true" || ariaSelected === "false" || !!ariaControls;
  }

  function createChatTabDescriptor(button, index) {
    return {
      button,
      index,
      key: getChatTabKey(button, index),
      name: getChatTabName(button, index),
      selected: isChatTabSelected(button),
      panelId: normalizeSpace(button.getAttribute("aria-controls") || ""),
      buttonId: normalizeSpace(button.id || "")
    };
  }

  function getChatTabKey(button, index) {
    if (!(button instanceof HTMLElement)) return "";
    return [
      normalizeSpace(button.id || ""),
      normalizeSpace(button.getAttribute("aria-controls") || ""),
      normalizeSpace(button.getAttribute("aria-label") || ""),
      normalizeSpace(button.getAttribute("title") || ""),
      normalizeSpace(button.textContent || ""),
      String(index)
    ].filter(Boolean).join("||");
  }

  function getChatTabName(button, index) {
    if (!(button instanceof HTMLElement)) return `\uD0ED ${index + 1}`;
    return getPreferredTabButtonText(button) || `\uD0ED ${index + 1}`;
  }

  function getPreferredTabButtonText(button) {
    if (!(button instanceof HTMLElement)) return "";

    const candidates = [
      typeof button.innerText === "string" ? button.innerText : "",
      button.textContent || "",
      button.querySelector?.('.MuiTab-wrapper, .MuiTab-iconWrapper + *, span, p, div')?.textContent || "",
      button.getAttribute("aria-label") || "",
      button.getAttribute("title") || ""
    ];

    for (const candidate of candidates) {
      const normalized = normalizeSpace(candidate || "");
      if (!normalized) continue;
      return normalized;
    }

    return "";
  }

  function isChatTabSelected(button) {
    if (!(button instanceof HTMLElement)) return false;
    return button.getAttribute("aria-selected") === "true"
      || button.classList.contains("Mui-selected")
      || button.getAttribute("tabindex") === "0";
  }

  function resolveChatTabDescriptor(tab) {
    const currentTabs = findChatTabDescriptors();
    if (!currentTabs.length) return null;

    return currentTabs.find((candidate) => candidate.key === tab?.key)
      || currentTabs.find((candidate) => candidate.index === tab?.index && candidate.name === tab?.name)
      || currentTabs.find((candidate) => candidate.index === tab?.index)
      || currentTabs.find((candidate) => candidate.name === tab?.name)
      || null;
  }

  async function activateChatTab(tab) {
    const target = resolveChatTabDescriptor(tab);
    if (!(target?.button instanceof HTMLElement)) return false;

    const previousSignature = getCurrentLogScopeSignature();
    if (!isChatTabSelected(target.button)) {
      target.button.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }

    await waitForChatTabActivation(target, previousSignature);
    return true;
  }

  async function waitForChatTabActivation(tab, previousSignature = "") {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const resolved = resolveChatTabDescriptor(tab) || tab;
      const scope = findPrimaryLogScope(resolved) || findPrimaryLogScope();
      if (scope instanceof HTMLElement) {
        await waitForLogSettle(scope);
      } else {
        await waitForAnimationFrame();
        await waitForAnimationFrame();
      }

      const currentSignature = getCurrentLogScopeSignature(scope);
      const selected = resolved?.button instanceof HTMLElement ? isChatTabSelected(resolved.button) : true;
      if (selected && (attempt >= 1 || !previousSignature || currentSignature !== previousSignature)) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }

  function getCurrentLogScopeSignature(scope = findPrimaryLogScope()) {
    const resolvedScope = scope instanceof HTMLElement ? scope : findPrimaryLogScope(scope);
    if (!(resolvedScope instanceof HTMLElement)) return "";

    const scroller = findLogScrollContainer(resolvedScope);
    const fingerprints = findLogMessageElements([resolvedScope])
      .slice(0, 4)
      .map((element) => getElementFingerprint(element))
      .filter(Boolean)
      .join("\n--\n");

    return [
      fingerprints,
      scroller?.scrollHeight || 0,
      normalizeSpace(resolvedScope.textContent || "").slice(0, 200)
    ].join("||");
  }

  async function captureOfficialLogHtml(originButton = null, options = {}) {
    const officialItem = findOfficialExportMenuItem(originButton, options);
    if (!(officialItem instanceof HTMLElement)) return null;

    try {
      return await interceptOfficialLogDownload(() => {
        officialItem.dispatchEvent(new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      });
    } catch (error) {
      console.warn("[CCF LOG PACKAGE] official log capture failed; falling back to live DOM scan", error);
      return null;
    }
  }

  function findOfficialExportMenuItem(originButton = null, options = {}) {
    const preferAll = options?.preferAll !== false;
    const allowAllFallback = options?.allowAllFallback !== false;
    const menu = originButton?.closest?.('[role="menu"]');
    if (menu instanceof HTMLElement) {
      const anchors = findMenuAnchors(menu);
      if (preferAll && anchors.exportAllLogsItem instanceof HTMLElement) return anchors.exportAllLogsItem;
      if (anchors.exportLogsItem instanceof HTMLElement) return anchors.exportLogsItem;
      if (allowAllFallback && anchors.exportAllLogsItem instanceof HTMLElement) return anchors.exportAllLogsItem;
    }

    for (const candidateMenu of findTargetMenus()) {
      const anchors = findMenuAnchors(candidateMenu);
      if (preferAll && anchors.exportAllLogsItem instanceof HTMLElement) return anchors.exportAllLogsItem;
      if (anchors.exportLogsItem instanceof HTMLElement) return anchors.exportLogsItem;
      if (allowAllFallback && anchors.exportAllLogsItem instanceof HTMLElement) return anchors.exportAllLogsItem;
    }

    return null;
  }

  function interceptOfficialLogDownload(trigger) {
    return new Promise((resolve, reject) => {
      const objectUrlMap = new Map();
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
      const originalClick = HTMLAnchorElement.prototype.click;
      const originalDispatchEvent = HTMLAnchorElement.prototype.dispatchEvent;
      let timeoutId = 0;
      let settled = false;

      const restore = () => {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        HTMLAnchorElement.prototype.click = originalClick;
        HTMLAnchorElement.prototype.dispatchEvent = originalDispatchEvent;
        clearTimeout(timeoutId);
      };

      const finish = (result, error = null) => {
        if (settled) return;
        settled = true;
        restore();
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };

      const tryCaptureAnchor = (anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) return false;

        const href = anchor.href || anchor.getAttribute("href") || "";
        const download = anchor.download || anchor.getAttribute("download") || "";
        const blob = objectUrlMap.get(href);
        if (!blob || !looksLikeOfficialLogBlob(blob, download)) return false;

        blob.text()
          .then((html) => finish({ html, fileName: download || "" }))
          .catch((error) => finish(null, error));
        return true;
      };

      URL.createObjectURL = function createObjectURLPatched(blob) {
        const url = originalCreateObjectURL(blob);
        objectUrlMap.set(url, blob);
        return url;
      };

      URL.revokeObjectURL = function revokeObjectURLPatched(url) {
        objectUrlMap.delete(url);
        return originalRevokeObjectURL(url);
      };

      HTMLAnchorElement.prototype.click = function clickPatched(...args) {
        if (tryCaptureAnchor(this)) return;
        return originalClick.apply(this, args);
      };

      HTMLAnchorElement.prototype.dispatchEvent = function dispatchEventPatched(event) {
        if (event?.type === "click" && tryCaptureAnchor(this)) return true;
        return originalDispatchEvent.call(this, event);
      };

      timeoutId = window.setTimeout(() => {
        finish(null, new Error("공식 로그 HTML을 가로채는 시간이 초과되었습니다."));
      }, OFFICIAL_LOG_CAPTURE_TIMEOUT_MS);

      Promise.resolve()
        .then(() => trigger())
        .catch((error) => finish(null, error));
    });
  }

  function looksLikeOfficialLogBlob(blob, downloadName = "") {
    const type = String(blob?.type || "").toLowerCase();
    const name = String(downloadName || "").toLowerCase();
    if (type.includes("html")) return true;
    return /\.html?$/.test(name);
  }

  async function collectLogEntries(tab = null) {
    const scope = findPrimaryLogScope(tab);
    if (!scope) return [];

    const scroller = findLogScrollContainer(scope);
    if (!scroller) {
      return collectVisibleLogEntries(scope);
    }

    const collected = await collectAllLogEntriesFromScroller(scope, scroller);
    if (collected.length) return collected;

    return collectVisibleLogEntries(scope);
  }

  function parseOfficialLogEntries(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const paragraphs = [...doc.body.querySelectorAll("p")];

    return paragraphs
      .map((paragraph, index) => parseOfficialLogParagraph(paragraph, index))
      .filter(Boolean);
  }

  function buildPackageTabGroupsFromOfficialLogHtml(html, roomTitle = "") {
    const entries = parseOfficialLogEntries(html);
    if (!entries.length) return [];

    const groups = [];
    const byKey = new Map();
    const fallbackName = resolvePackageTabLabel(roomTitle || "", "\uD0ED 1");

    entries.forEach((entry) => {
      const channelName = resolvePackageTabLabel(entry.channel || "", fallbackName);
      const groupKey = normalizeSpace(channelName || "") || fallbackName;
      let group = byKey.get(groupKey);

      if (!group) {
        group = {
          id: `tab-${groups.length + 1}`,
          key: groupKey,
          index: groups.length,
          order: groups.length + 1,
          name: channelName,
          selected: false,
          entries: []
        };
        byKey.set(groupKey, group);
        groups.push(group);
      }

      group.entries.push({
        ...entry,
        tabId: group.id,
        tabName: group.name
      });
    });

    groups.forEach((group) => {
      group.entries = group.entries.map((entry, index) => ({
        ...entry,
        index: index + 1,
        tabId: group.id,
        tabName: group.name
      }));
    });

    return groups.filter((group) => group.entries.length);
  }

  function parseOfficialLogParagraph(paragraph, index) {
    if (!(paragraph instanceof HTMLElement)) return null;

    const spans = [...paragraph.querySelectorAll(":scope > span")];
    const channel = normalizeSpace(spans[0]?.textContent || "");
    const sender = normalizeSpace(spans[1]?.textContent || "");
    const messageSpan = spans[spans.length - 1] || paragraph;
    const rawText = normalizeText(readNodeTextWithBreaks(messageSpan));
    const extracted = extractEnvelope(rawText);
    const text = extracted?.envelope?.text != null
      ? normalizeText(String(extracted.envelope.text))
      : normalizeText(stripInvisibleEnvelope(rawText));
    const baseColor = normalizeCssColor(paragraph.style?.color || "");
    const bodyHtml = buildRenderedMessageHtml({
      text,
      formatRuns: extracted?.envelope?.formatRuns || [],
      alignRuns: extracted?.envelope?.alignRuns || [],
      blockStyle: extracted?.envelope?.blockStyle || {},
      baseColor
    });
    const assetSources = collectAssetSourcesFromHtml(bodyHtml);

    return {
      index: index + 1,
      id: `official-${index + 1}`,
      sender,
      avatarSource: "",
      timestamp: "",
      metaTexts: channel ? [channel, sender].filter(Boolean) : [sender].filter(Boolean),
      channel,
      text,
      visibleText: text,
      rawText,
      baseColor,
      formatEnvelopeVersion: extracted?.envelope?.v ?? null,
      formatRuns: cloneJson(extracted?.envelope?.formatRuns || []),
      alignRuns: cloneJson(extracted?.envelope?.alignRuns || []),
      blockStyle: cloneJson(extracted?.envelope?.blockStyle || {}),
      assetSources,
      bodyHtml,
      packageHtml: ""
    };
  }

  function readNodeTextWithBreaks(node) {
    if (!node) return "";
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (node.nodeName === "BR") {
      return "\n";
    }
    return [...node.childNodes].map((child) => readNodeTextWithBreaks(child)).join("");
  }

  function buildRenderedMessageHtml({ text, formatRuns, alignRuns, blockStyle, baseColor }) {
    const wrapper = document.createElement("div");
    wrapper.className = "ccf-render-root";

    renderStyledText(wrapper, text || "", formatRuns || [], getEffectiveAlignRuns(text || "", alignRuns || [], blockStyle || {}));
    return wrapper.innerHTML;
  }

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
  }

  function normalizeCssColor(value) {
    if (value == null) return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";

    const probe = document.createElement("span");
    probe.style.color = "";
    probe.style.color = trimmed;
    return probe.style.color || "";
  }

  function renderStyledText(container, text, runs, alignRuns = []) {
    if (!container) return;

    if (!text) {
      container.style.textAlign = "";
      container.textContent = "";
      return;
    }

    const normalizedRuns = normalizeRuns(runs, text.length);
    const normalizedAlignRuns = getEffectiveAlignRuns(text, alignRuns);
    if (!normalizedRuns.length && !normalizedAlignRuns.length) {
      container.style.textAlign = "";
      container.textContent = text;
      return;
    }

    container.innerHTML = "";
    container.style.textAlign = "";

    const lines = getTextLines(text);
    let activeCodeGroup = null;
    let activeCodeGroupKey = "";

    for (const line of lines) {
      const lineEl = document.createElement("span");
      lineEl.className = "ccf-line";
      lineEl.dataset.ccfLine = "1";
      lineEl.dataset.lineIndex = String(line.index);
      lineEl.dataset.start = String(line.start);
      lineEl.dataset.end = String(line.end);
      lineEl.style.textAlign = getLineAlign(normalizedAlignRuns, line.index);

      const lineRuns = normalizedRuns
        .filter((run) => run.start < line.end && run.end > line.start)
        .map((run) => ({
          start: clamp(run.start - line.start, 0, line.text.length),
          end: clamp(run.end - line.start, 0, line.text.length),
          style: { ...run.style }
        }))
        .filter((run) => run.end > run.start);

      if (!line.text.length) {
        const blockCodeGroupKey = getBlockCodeGroupKeyForLine(line, normalizedRuns);
        lineEl.appendChild(document.createElement("br"));
        if (blockCodeGroupKey) {
          if (!activeCodeGroup || activeCodeGroupKey !== blockCodeGroupKey) {
            activeCodeGroup = document.createElement("span");
            activeCodeGroup.className = "ccf-frag ccf-code-frag is-block ccf-code-block-group";
            activeCodeGroupKey = blockCodeGroupKey;
            container.appendChild(activeCodeGroup);
          }
          activeCodeGroup.appendChild(lineEl);
          continue;
        }
        activeCodeGroup = null;
        activeCodeGroupKey = "";
      } else if (!lineRuns.length) {
        lineEl.textContent = line.text;
        activeCodeGroup = null;
        activeCodeGroupKey = "";
      } else {
        const fragments = buildFragments(line.text, lineRuns);
        const blockCodeGroupKey = getBlockCodeGroupKeyForLine(line, normalizedRuns, fragments);
        if (blockCodeGroupKey) {
          if (!activeCodeGroup || activeCodeGroupKey !== blockCodeGroupKey) {
            activeCodeGroup = document.createElement("span");
            activeCodeGroup.className = "ccf-frag ccf-code-frag is-block ccf-code-block-group";
            activeCodeGroupKey = blockCodeGroupKey;
            container.appendChild(activeCodeGroup);
          }

          for (const frag of fragments) {
            appendStyledFragment(lineEl, {
              ...frag,
              style: stripCodeModeFromStyle(frag.style)
            });
          }
          activeCodeGroup.appendChild(lineEl);
          continue;
        }

        activeCodeGroup = null;
        activeCodeGroupKey = "";
        for (const frag of fragments) {
          appendStyledFragment(lineEl, frag);
        }
      }

      container.appendChild(lineEl);
    }
  }

  function normalizeRuns(runs, textLength) {
    if (!Array.isArray(runs)) return [];

    const cleaned = runs
      .map((run) => ({
        start: clamp(Number(run.start) || 0, 0, textLength),
        end: clamp(Number(run.end) || 0, 0, textLength),
        style: cleanupStyle(run.style || {})
      }))
      .filter((run) => run.end > run.start && Object.keys(run.style).length > 0)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const merged = [];
    for (const cur of cleaned) {
      const prev = merged[merged.length - 1];
      if (prev && prev.end === cur.start && JSON.stringify(prev.style) === JSON.stringify(cur.style)) {
        prev.end = cur.end;
      } else {
        merged.push(cur);
      }
    }

    return merged;
  }

  function cleanupStyle(style) {
    const out = {};
    if (style.bold) out.bold = true;
    if (style.italic) out.italic = true;
    if (style.underline) out.underline = true;
    if (style.strike) out.strike = true;
    const rubyText = normalizeRubyText(style.rubyText);
    if (rubyText) out.rubyText = rubyText;
    const tooltipText = normalizeTooltipText(style.tooltipText);
    if (tooltipText) out.tooltipText = tooltipText;
    const codeMode = normalizeCodeMode(style.codeMode);
    if (codeMode) out.codeMode = codeMode;
    const blur = normalizeBlurValue(style.blur);
    if (blur) out.blur = blur;
    if (style.color && style.color !== "#ffffff") out.color = style.color;
    if (style.backgroundColor && style.backgroundColor !== "#000000") out.backgroundColor = style.backgroundColor;
    const imageUrl = normalizeImageUrl(style.imageUrl);
    if (imageUrl) out.imageUrl = imageUrl;
    const imageAlt = normalizeImageAlt(style.imageAlt);
    if (imageAlt) out.imageAlt = imageAlt;
    if (style.backgroundImage) out.backgroundImage = String(style.backgroundImage).trim();
    const fontSize = normalizeFontSizeValue(style.fontSize);
    if (fontSize != null) out.fontSize = fontSize;
    const display = String(style.display || "").trim().toLowerCase();
    if (["inline", "inline-block", "block"].includes(display)) out.display = display;
    const padding = String(style.padding || "").trim();
    if (padding) out.padding = padding;
    const margin = String(style.margin || "").trim();
    if (margin) out.margin = margin;
    const border = String(style.border || "").trim();
    if (border) out.border = border;
    const letterSpacing = String(style.letterSpacing || "").trim();
    if (letterSpacing) out.letterSpacing = letterSpacing;
    const lineHeight = String(style.lineHeight || "").trim();
    if (lineHeight) out.lineHeight = lineHeight;
    const textAlign = cleanupAlign(style.textAlign);
    if (textAlign) out.textAlign = textAlign;
    const textShadow = String(style.textShadow || "").trim();
    if (textShadow) out.textShadow = textShadow;
    const opacity = Number(style.opacity);
    if (Number.isFinite(opacity)) out.opacity = clamp(opacity, 0, 1);
    return out;
  }

  function normalizeRubyText(value) {
    if (value == null) return "";
    return String(value).trim().slice(0, 120);
  }

  function normalizeTooltipText(value) {
    if (value == null) return "";
    return String(value)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 240);
  }

  function normalizeCodeMode(value) {
    if (value === true) return "inline";
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "inline" || normalized === "block") return normalized;
    if (normalized === "true" || normalized === "1" || normalized === "code") return "inline";
    return "";
  }

  function normalizeBlurValue(value) {
    if (value == null || value === false) return "";
    let trimmed = String(value).trim();
    if (!trimmed) return "";

    const blurMatch = trimmed.match(/blur\(([^)]+)\)/i);
    if (blurMatch) {
      trimmed = blurMatch[1].trim();
    }

    if (/^(?:\d+|\d*\.\d+)$/.test(trimmed)) {
      trimmed = `${trimmed}px`;
    }

    const match = trimmed.match(/^(-?(?:\d+|\d*\.\d+))(px|em|rem)$/i);
    if (!match) return "";

    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return "";
    return `${Number(amount.toFixed(2))}${match[2].toLowerCase()}`;
  }

  function normalizeImageUrl(value) {
    if (typeof value !== "string") return "";
    let trimmed = value.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith(LOCAL_IMAGE_TOKEN_PREFIX)) {
      return trimmed;
    }

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
      return trimmed.replace(/\s+/g, "");
    }

    if (/^\/\//.test(trimmed)) {
      trimmed = `https:${trimmed}`;
    } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && /^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(trimmed)) {
      trimmed = `https://${trimmed}`;
    }

    try {
      const parsed = new URL(trimmed, location.href);
      if (!/^https?:$/i.test(parsed.protocol)) return "";
      return parsed.toString();
    } catch (error) {
      return "";
    }
  }

  function normalizeImageAlt(value) {
    if (value == null) return "";
    return String(value).trim().slice(0, 200);
  }

  function isLocalImageToken(value) {
    return typeof value === "string" && value.startsWith(LOCAL_IMAGE_TOKEN_PREFIX);
  }

  function getLocalImageTokenId(value) {
    return isLocalImageToken(value) ? value.slice(LOCAL_IMAGE_TOKEN_PREFIX.length) : "";
  }

  function getLocalImageStorageKey(id) {
    return `${LOCAL_IMAGE_STORAGE_PREFIX}${id}`;
  }

  function resolveStoredLocalImageUrl(value) {
    const id = getLocalImageTokenId(value);
    if (!id) return "";

    try {
      const stored = window.localStorage.getItem(getLocalImageStorageKey(id));
      return /^data:image\/[a-z0-9.+-]+;base64,/i.test(stored || "")
        ? String(stored).replace(/\s+/g, "")
        : "";
    } catch (error) {
      return "";
    }
  }

  function resolveRenderableImageUrl(value) {
    const normalized = normalizeImageUrl(value);
    if (!normalized) return "";
    if (isLocalImageToken(normalized)) {
      return resolveStoredLocalImageUrl(normalized);
    }
    return normalized;
  }

  function normalizeFontSizeValue(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const numeric = Math.round(Number(trimmed));
    if (!Number.isFinite(numeric)) return null;
    return clamp(numeric, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }

  function getTextLines(text) {
    const normalized = typeof text === "string" ? text : "";
    if (!normalized.length) {
      return [{ index: 0, start: 0, end: 0, text: "", hasBreak: false }];
    }

    const out = [];
    let start = 0;
    let lineIndex = 0;
    for (let i = 0; i <= normalized.length; i += 1) {
      if (i !== normalized.length && normalized[i] !== "\n") continue;
      out.push({
        index: lineIndex,
        start,
        end: i,
        text: normalized.slice(start, i),
        hasBreak: i < normalized.length
      });
      start = i + 1;
      lineIndex += 1;
    }
    return out;
  }

  function getTextLineCount(text) {
    return getTextLines(text).length;
  }

  function cleanupAlign(value) {
    return value === "center" || value === "right" ? value : null;
  }

  function normalizeAlignRuns(runs, lineCount) {
    if (!Array.isArray(runs)) return [];

    const cleaned = runs
      .map((run) => ({
        start: clamp(Number(run.start) || 0, 0, lineCount),
        end: clamp(Number(run.end) || 0, 0, lineCount),
        align: cleanupAlign(run.align)
      }))
      .filter((run) => run.end > run.start && !!run.align)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const merged = [];
    for (const cur of cleaned) {
      const prev = merged[merged.length - 1];
      if (prev && prev.end >= cur.start) {
        if (prev.align === cur.align) {
          prev.end = Math.max(prev.end, cur.end);
          continue;
        }
        if (prev.end > cur.start) {
          cur.start = prev.end;
        }
      }
      if (cur.end > cur.start) {
        merged.push(cur);
      }
    }

    return merged;
  }

  function cleanupBlockStyle(style) {
    const out = {};
    if (style && ["center", "right"].includes(style.align)) {
      out.align = style.align;
    }
    return out;
  }

  function getLegacyAlignRuns(text, blockStyle) {
    const legacy = cleanupBlockStyle(blockStyle);
    const align = cleanupAlign(legacy.align);
    if (!align) return [];
    return [{ start: 0, end: getTextLineCount(text), align }];
  }

  function getEffectiveAlignRuns(text, alignRuns, blockStyle = null) {
    const normalized = normalizeAlignRuns(alignRuns, getTextLineCount(text));
    if (normalized.length) return normalized;
    return getLegacyAlignRuns(text, blockStyle);
  }

  function getLineAlign(alignRuns, lineIndex) {
    const run = alignRuns.find((item) => item.start <= lineIndex && item.end > lineIndex);
    return run?.align || "";
  }

  function buildFragments(text, runs) {
    const points = new Set([0, text.length]);
    for (const run of runs) {
      points.add(run.start);
      points.add(run.end);
    }

    const sorted = [...points].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (start === end) continue;
      out.push({
        text: text.slice(start, end),
        style: mergeStyles(
          runs
            .filter((run) => run.start <= start && run.end >= end)
            .map((run) => run.style)
        )
      });
    }
    return out;
  }

  function stripCodeModeFromStyle(style) {
    if (!style || !Object.prototype.hasOwnProperty.call(style, "codeMode")) {
      return style ? { ...style } : style;
    }

    const nextStyle = { ...style };
    delete nextStyle.codeMode;
    return nextStyle;
  }

  function getBlockCodeGroupKeyForLine(line, runs, fragments = null) {
    const coveringRun = runs.find((run) =>
      normalizeCodeMode(run.style?.codeMode) === "block" &&
      run.start <= line.start &&
      run.end >= line.end
    );

    if (!coveringRun) return "";
    if (!line.text.length) return `${coveringRun.start}:${coveringRun.end}`;
    if (!Array.isArray(fragments) || !fragments.length) return "";
    return fragments.every((frag) => normalizeCodeMode(frag.style?.codeMode) === "block")
      ? `${coveringRun.start}:${coveringRun.end}`
      : "";
  }

  function mergeStyles(styleList) {
    const out = {};
    for (const style of styleList) {
      if (style) Object.assign(out, style);
    }
    return out;
  }

  function applyInlineStyle(el, style) {
    if (!style) return;
    if (style.bold) el.style.fontWeight = "700";
    if (style.italic) el.style.fontStyle = "italic";
    if (style.underline || style.strike) {
      const parts = [];
      if (style.underline) parts.push("underline");
      if (style.strike) parts.push("line-through");
      el.style.textDecoration = parts.join(" ");
    }
    if (style.color) el.style.color = style.color;
    if (style.backgroundColor) el.style.backgroundColor = style.backgroundColor;
    if (style.backgroundImage) el.style.backgroundImage = style.backgroundImage;
    if (style.fontSize) el.style.fontSize = `${style.fontSize}px`;
    if (style.display) el.style.display = style.display;
    if (style.padding) el.style.padding = style.padding;
    if (style.margin) el.style.margin = style.margin;
    if (style.border) el.style.border = style.border;
    if (style.letterSpacing) el.style.letterSpacing = style.letterSpacing;
    if (style.lineHeight) el.style.lineHeight = style.lineHeight;
    if (style.textAlign) el.style.textAlign = style.textAlign;
    if (style.textShadow) el.style.textShadow = style.textShadow;
    if (style.blur) el.style.filter = `blur(${style.blur})`;
    if (style.opacity != null) el.style.opacity = String(style.opacity);
  }

  function appendStyledFragment(container, frag) {
    if (!container || !frag) return;
    container.appendChild(createStyledFragmentNode(frag));
  }

  function createStyledFragmentNode(frag) {
    if (frag.style?.imageUrl) return createImageFragmentNode(frag);
    if (frag.style?.tooltipText) return createTooltipFragmentNode(frag);
    if (frag.style?.codeMode) return createCodeFragmentNode(frag);
    if (frag.style?.rubyText) return createRubyFragmentNode(frag);
    return createPlainTextFragmentNode(frag);
  }

  function createPlainTextFragmentNode(frag) {
    const span = document.createElement("span");
    span.className = "ccf-frag";
    span.textContent = frag.text || "";
    applyInlineStyle(span, frag.style);
    return span;
  }

  function createTooltipFragmentNode(frag) {
    const tooltipText = normalizeTooltipText(frag.style?.tooltipText);
    if (!tooltipText) {
      const fallbackStyle = frag.style ? { ...frag.style } : null;
      if (fallbackStyle) delete fallbackStyle.tooltipText;
      return createStyledFragmentNode({ ...frag, style: fallbackStyle });
    }

    const wrapper = document.createElement("span");
    wrapper.className = "ccf-frag ccf-tooltip-frag";
    wrapper.dataset.tooltip = tooltipText;
    wrapper.dataset.tooltipMultiline = tooltipText.includes("\n") ? "1" : "0";

    const innerStyle = frag.style ? { ...frag.style } : null;
    if (innerStyle) delete innerStyle.tooltipText;
    wrapper.appendChild(createStyledFragmentNode({ ...frag, style: innerStyle }));
    return wrapper;
  }

  function createCodeFragmentNode(frag) {
    const codeMode = normalizeCodeMode(frag.style?.codeMode);
    if (!codeMode) {
      const fallbackStyle = frag.style ? { ...frag.style } : null;
      if (fallbackStyle) delete fallbackStyle.codeMode;
      return createStyledFragmentNode({ ...frag, style: fallbackStyle });
    }

    const wrapper = document.createElement("span");
    wrapper.className = `ccf-frag ccf-code-frag is-${codeMode}`;

    const innerStyle = frag.style ? { ...frag.style } : null;
    if (innerStyle) delete innerStyle.codeMode;
    wrapper.appendChild(createStyledFragmentNode({ ...frag, style: innerStyle }));
    return wrapper;
  }

  function createRubyFragmentNode(frag) {
    const rubyText = normalizeRubyText(frag.style?.rubyText);
    if (!rubyText) {
      const fallback = document.createElement("span");
      fallback.className = "ccf-frag";
      fallback.textContent = frag.text || "";
      applyInlineStyle(fallback, frag.style);
      return fallback;
    }

    const wrapper = document.createElement("span");
    wrapper.className = "ccf-frag ccf-ruby-frag";
    wrapper.dataset.ruby = rubyText;
    if (frag.style?.color) wrapper.style.color = frag.style.color;
    if (frag.style?.fontSize) wrapper.style.fontSize = `${frag.style.fontSize}px`;
    if (frag.style?.bold) wrapper.style.fontWeight = "700";
    if (frag.style?.italic) wrapper.style.fontStyle = "italic";
    if (frag.style?.letterSpacing) wrapper.style.letterSpacing = frag.style.letterSpacing;
    if (frag.style?.lineHeight) wrapper.style.lineHeight = frag.style.lineHeight;
    if (frag.style?.blur) wrapper.style.filter = `blur(${frag.style.blur})`;

    const base = document.createElement("span");
    base.className = "ccf-ruby-base";
    base.textContent = frag.text || "";
    const baseStyle = frag.style ? { ...frag.style } : null;
    if (baseStyle) delete baseStyle.blur;
    applyInlineStyle(base, baseStyle);
    wrapper.appendChild(base);
    return wrapper;
  }

  function createImageFragmentNode(frag) {
    const wrapper = document.createElement("span");
    wrapper.className = "ccf-image-frag";

    const token = document.createElement("span");
    token.className = "ccf-image-token";
    token.textContent = frag.text || "";
    wrapper.appendChild(token);

    const imageUrl = resolveRenderableImageUrl(frag.style.imageUrl);
    if (!imageUrl) {
      const fallback = document.createElement("span");
      fallback.textContent = frag.style.imageAlt || frag.text || "image";
      applyInlineStyle(fallback, frag.style);
      wrapper.appendChild(fallback);
      return wrapper;
    }

    const img = document.createElement("img");
    img.className = "ccf-image";
    img.src = imageUrl;
    img.alt = frag.style.imageAlt || frag.text || "image";
    img.loading = "lazy";
    img.decoding = "async";
    applyInlineStyle(img, frag.style);
    wrapper.appendChild(img);
    return wrapper;
  }

  function findLogMessageElements(scopes = findChatLogScopes()) {
    const seen = new Set();
    const out = [];

    for (const scope of scopes) {
      if (!(scope instanceof Element)) continue;

      if (scope.matches?.(MESSAGE_TEXT_SELECTOR) && isLogMessageTextElement(scope)) {
        seen.add(scope);
        out.push(scope);
      }

      scope.querySelectorAll?.(MESSAGE_TEXT_SELECTOR).forEach((element) => {
        if (!(element instanceof HTMLElement)) return;
        if (seen.has(element)) return;
        if (!isLogMessageTextElement(element)) return;
        seen.add(element);
        out.push(element);
      });
    }

    appendFallbackMessageElementsFromItemRoots(scopes, out, seen);
    return out;
  }

  function appendFallbackMessageElementsFromItemRoots(scopes, out, seen) {
    findLogMessageItemRoots(scopes).forEach((itemRoot) => {
      const element = findPrimaryMessageTextElement(itemRoot);
      if (!(element instanceof HTMLElement)) return;
      if (seen.has(element)) return;
      seen.add(element);
      out.push(element);
    });
  }

  function findLogMessageItemRoots(scopes = findChatLogScopes()) {
    const seen = new Set();
    const out = [];

    for (const scope of scopes) {
      if (!(scope instanceof HTMLElement)) continue;

      if (scope.matches?.(MESSAGE_ITEM_SELECTOR) && isPotentialLogMessageItem(scope)) {
        seen.add(scope);
        out.push(scope);
      }

      scope.querySelectorAll?.(MESSAGE_ITEM_SELECTOR).forEach((item) => {
        if (!(item instanceof HTMLElement)) return;
        if (seen.has(item)) return;
        if (!isPotentialLogMessageItem(item)) return;
        seen.add(item);
        out.push(item);
      });
    }

    return out;
  }

  function isPotentialLogMessageItem(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!isVisible(element)) return false;
    if (!element.closest(MESSAGE_SCOPE_SELECTOR)) return false;
    if (element.closest(`[${SAFE_UI_ATTR}="1"]`)) return false;
    if (element.closest('button, form, [role="dialog"]')) return false;
    if (element.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;

    const visibleText = normalizeText(
      typeof element.innerText === "string" ? element.innerText : (element.textContent || "")
    );
    if (!visibleText.trim() && !element.querySelector(AVATAR_NODE_SELECTOR)) return false;

    const nestedItem = element.parentElement?.closest?.(MESSAGE_ITEM_SELECTOR) || null;
    if (nestedItem instanceof HTMLElement && nestedItem !== element) return false;
    return true;
  }

  function findPrimaryMessageTextElement(itemRoot) {
    if (!(itemRoot instanceof HTMLElement)) return null;

    const selectorCandidates = [...itemRoot.querySelectorAll(MESSAGE_TEXT_SELECTOR)]
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => isLogMessageTextElement(node));
    if (selectorCandidates.length) {
      selectorCandidates.sort((left, right) =>
        scoreMessageTextCandidate(right, itemRoot) - scoreMessageTextCandidate(left, itemRoot)
      );
      return selectorCandidates[0] || null;
    }

    const candidates = [...itemRoot.querySelectorAll("p, div, span")]
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => isFallbackMessageTextElement(node, itemRoot))
      .sort((left, right) =>
        scoreMessageTextCandidate(right, itemRoot) - scoreMessageTextCandidate(left, itemRoot)
      );

    return candidates[0] || null;
  }

  function isFallbackMessageTextElement(element, itemRoot) {
    if (!(element instanceof HTMLElement) || !(itemRoot instanceof HTMLElement)) return false;
    if (!itemRoot.contains(element)) return false;
    if (!isVisible(element)) return false;
    if (element.closest(`[${SAFE_UI_ATTR}="1"]`)) return false;
    if (element.closest('button, form, [role="dialog"]')) return false;
    if (element.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;

    const text = normalizeSpace(
      typeof element.innerText === "string" ? element.innerText : (element.textContent || "")
    );
    if (!text) return false;
    if (text.length > 6000) return false;
    return true;
  }

  function scoreMessageTextCandidate(element, itemRoot) {
    if (!(element instanceof HTMLElement)) return Number.NEGATIVE_INFINITY;

    const text = normalizeSpace(
      typeof element.innerText === "string" ? element.innerText : (element.textContent || "")
    );
    if (!text) return Number.NEGATIVE_INFINITY;

    const tokens = [
      element.className || "",
      element.getAttribute("role") || "",
      element.getAttribute("data-testid") || "",
      element.getAttribute("aria-label") || "",
      element.parentElement?.className || ""
    ].join(" ").toLowerCase();

    let score = Math.min(80, text.length);
    if (element.matches?.(MESSAGE_TEXT_SELECTOR)) score += 120;
    if (element.closest(".MuiListItemText-root")) score += 28;
    if (/body|message|content|text|comment|chat|primary/.test(tokens)) score += 18;
    if (/secondary|caption|meta|time|date|sender|author|name|header/.test(tokens)) score -= 32;
    if (element.childElementCount > 0) score -= Math.min(48, element.childElementCount * 8);
    if (element.querySelector('time, h1, h2, h3, h4, h5, h6, strong, b, small')) score -= 18;
    if (looksLikeTimestamp(text)) score -= 40;
    if (text.length <= 1) score -= 20;
    if (text.length <= 12 && !/\s/.test(text)) score -= 12;
    if (element === itemRoot.firstElementChild || element === itemRoot.lastElementChild) score += 4;
    return score;
  }

  function findPrimaryLogScope(tab = null) {
    const targetPanel = getChatTabPanelElement(tab);
    const targetDrawer = getChatTabOwnerDrawer(tab);
    const scopes = findChatLogScopes(tab)
      .filter((scope) => scope instanceof HTMLElement && isVisible(scope));
    if (!scopes.length) return null;

    scopes.sort((left, right) => {
      const rightPanelScore = scoreLogScopeForTab(right, targetPanel, targetDrawer);
      const leftPanelScore = scoreLogScopeForTab(left, targetPanel, targetDrawer);
      if (rightPanelScore !== leftPanelScore) return rightPanelScore - leftPanelScore;

      const rightCount = findLogMessageElements([right]).length;
      const leftCount = findLogMessageElements([left]).length;
      if (rightCount !== leftCount) return rightCount - leftCount;

      const rightRect = right.getBoundingClientRect();
      const leftRect = left.getBoundingClientRect();
      return (rightRect.height * rightRect.width) - (leftRect.height * leftRect.width);
    });

    return scopes[0] || null;
  }

  function scoreLogScopeForTab(scope, targetPanel = null, targetDrawer = null) {
    if (!(scope instanceof HTMLElement)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (targetPanel instanceof HTMLElement) {
      if (scope === targetPanel) score += 120;
      if (targetPanel.contains(scope)) score += 92;
      if (scope.contains(targetPanel)) score += 72;
    }

    const scopeDrawer = scope.closest(".MuiDrawer-paper");
    if (targetDrawer instanceof HTMLElement && scopeDrawer === targetDrawer) {
      score += 36;
    }

    return score;
  }

  function findLogScrollContainer(scope) {
    if (!(scope instanceof HTMLElement)) return null;

    let current = scope;
    while (current && current !== document.body) {
      if (isScrollableElement(current)) {
        return current;
      }
      current = current.parentElement;
    }

    return findScrollableElementInDrawer(scope.closest(".MuiDrawer-paper")) || null;
  }

  function findScrollableElementInDrawer(drawer) {
    if (!(drawer instanceof HTMLElement)) return null;

    const scrollables = findScrollableElementsForAvatarScan(drawer);

    return scrollables[0] || null;
  }

  function findScrollableElementsForAvatarScan(root) {
    if (!(root instanceof HTMLElement)) return [];

    const candidates = [root, ...root.querySelectorAll("*")];
    return candidates
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => isScrollableElement(element))
      .sort((left, right) =>
        scoreAvatarScrollContainer(right, root) - scoreAvatarScrollContainer(left, root)
      );
  }

  function scoreAvatarScrollContainer(element, root = null) {
    if (!(element instanceof HTMLElement)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    const avatarCount = element.querySelectorAll?.(AVATAR_NODE_SELECTOR)?.length || 0;
    const itemCount = element.querySelectorAll?.(MESSAGE_ITEM_SELECTOR)?.length || 0;
    const textCount = element.querySelectorAll?.(MESSAGE_TEXT_SELECTOR)?.length || 0;

    score += avatarCount * 80;
    score += itemCount * 24;
    score += textCount * 12;
    score += Math.min(400, element.clientHeight);

    if (root instanceof HTMLElement) {
      if (element === root) score -= 30;
      if (root.contains(element)) score += 10;
    }

    if (element.closest(".MuiDrawer-paper")) score += 16;
    if (element.querySelector('button[type="submit"]')) score -= 40;
    return score;
  }

  function isScrollableElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (!/(auto|scroll|overlay)/i.test(style.overflowY || "")) return false;
    return element.scrollHeight > element.clientHeight + 24;
  }

  async function collectAllLogEntriesFromScroller(scope, scroller) {
    const originalTop = scroller.scrollTop;
    const originalBehavior = scroller.style.scrollBehavior;
    const entries = [];
    let previousVisibleFingerprints = [];

    scroller.style.scrollBehavior = "auto";

    try {
      await scrollLogToStart(scroller, scope);
      await waitForLogSettle(scope);

      for (let i = 0; i < LOG_SCAN_MAX_ITERATIONS; i += 1) {
        previousVisibleFingerprints = appendVisibleEntries(scope, entries, previousVisibleFingerprints);

        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (scroller.scrollTop >= maxTop - 1) {
          await waitForLogSettle(scope);
          previousVisibleFingerprints = appendVisibleEntries(scope, entries, previousVisibleFingerprints);
          break;
        }

        const step = Math.max(LOG_SCAN_MIN_STEP, Math.floor(scroller.clientHeight * LOG_SCAN_STEP_RATIO));
        const nextTop = Math.min(maxTop, scroller.scrollTop + step);
        if (nextTop === scroller.scrollTop) {
          break;
        }

        scroller.scrollTop = nextTop;
        await waitForLogSettle(scope);
      }
    } finally {
      scroller.scrollTop = originalTop;
      scroller.style.scrollBehavior = originalBehavior;
    }

    return entries.map((entry, index) => ({
      ...entry,
      index: index + 1
    }));
  }

  async function scrollLogToStart(scroller, scope) {
    let stableCount = 0;
    let previousSignature = "";
    let previousHeight = -1;

    for (let i = 0; i < LOG_SCAN_MAX_ITERATIONS; i += 1) {
      scroller.scrollTop = 0;
      await waitForLogSettle(scope);

      const firstElement = findLogMessageElements([scope])[0] || null;
      const signature = firstElement ? getElementFingerprint(firstElement) : "";
      const height = scroller.scrollHeight;
      const atTop = scroller.scrollTop <= 1;

      if (atTop && signature === previousSignature && height === previousHeight) {
        stableCount += 1;
      } else {
        stableCount = 0;
      }

      if (stableCount >= 2) {
        break;
      }

      previousSignature = signature;
      previousHeight = height;
    }
  }

  function appendVisibleEntries(scope, entries, previousFingerprints = []) {
    const visibleEntries = collectVisibleLogEntries(scope, entries.length)
      .filter((entry) => !!getEntryFingerprint(entry));

    if (!visibleEntries.length) return [];

    const visibleFingerprints = visibleEntries.map((entry) => getEntryFingerprint(entry));
    const overlap = getFingerprintOverlapLength(previousFingerprints, visibleFingerprints);

    for (let i = overlap; i < visibleEntries.length; i += 1) {
      entries.push(visibleEntries[i]);
    }

    return visibleFingerprints;
  }

  function collectVisibleLogEntries(scope, startIndex = 0) {
    return findLogMessageItemRoots([scope])
      .map((itemRoot, index) => buildLogEntryFromItemRoot(itemRoot, startIndex + index))
      .filter((entry) => !!entry);
  }

  function getEntryFingerprint(entry) {
    if (!entry) return "";
    if (entry.id && !/^message-\d+$/.test(entry.id)) {
      return `id:${entry.id}`;
    }

    return [
      entry.sender || "",
      entry.timestamp || "",
      entry.rawText || "",
      entry.text || "",
      entry.visibleText || ""
    ].join("\n@@\n");
  }

  function getElementFingerprint(element) {
    return getEntryFingerprint(buildLogEntry(element, 0));
  }

  async function waitForLogSettle(scope) {
    await new Promise((resolve) => {
      let done = false;
      let quietTimer = 0;
      let timeoutTimer = 0;
      const observer = new MutationObserver(() => {
        restartQuietTimer();
      });

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(quietTimer);
        clearTimeout(timeoutTimer);
        observer.disconnect();
        resolve();
      };

      const restartQuietTimer = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, LOG_SETTLE_QUIET_MS);
      };

      if (scope instanceof Element) {
        observer.observe(scope, {
          childList: true,
          subtree: true,
          characterData: true
        });
      }

      timeoutTimer = setTimeout(finish, LOG_SETTLE_TIMEOUT_MS);
      restartQuietTimer();
    });

    await waitForAnimationFrame();
    await waitForAnimationFrame();
  }

  function waitForAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function findChatLogScopes(tab = null) {
    const contextualScopes = findChatLogScopesFromRoots(getChatTabSearchRoots(tab));
    if (contextualScopes.length) {
      return contextualScopes;
    }

    const scopes = new Set();
    const drawers = new Set();

    for (const composer of findComposerBars()) {
      const drawer = composer.closest(".MuiDrawer-paper");
      if (drawer instanceof HTMLElement) {
        drawers.add(drawer);
      }
    }

    if (!drawers.size) {
      document.querySelectorAll(".MuiDrawer-paper").forEach((drawer) => {
        if (!(drawer instanceof HTMLElement)) return;
        if (!drawer.querySelector('button[type="submit"]')) return;
        drawers.add(drawer);
      });
    }

    if (drawers.size) {
      for (const drawer of drawers) {
        if (drawer.matches?.(MESSAGE_SCOPE_SELECTOR)) {
          scopes.add(drawer);
        }
        drawer.querySelectorAll?.(MESSAGE_SCOPE_SELECTOR).forEach((scope) => {
          scopes.add(scope);
        });
      }
      return [...scopes];
    }

    document.querySelectorAll(MESSAGE_SCOPE_SELECTOR).forEach((scope) => {
      scopes.add(scope);
    });
    return [...scopes];
  }

  function findChatLogScopesFromRoots(roots = []) {
    const scopes = new Set();

    for (const root of roots) {
      if (!(root instanceof HTMLElement)) continue;
      if (root.matches?.(MESSAGE_SCOPE_SELECTOR)) {
        scopes.add(root);
      }
      root.querySelectorAll?.(MESSAGE_SCOPE_SELECTOR).forEach((scope) => {
        scopes.add(scope);
      });
    }

    return [...scopes];
  }

  function getChatTabSearchRoots(tab = null) {
    const resolved = tab ? (resolveChatTabDescriptor(tab) || tab) : null;
    if (!resolved) return [];

    const roots = [];
    const seen = new Set();
    const pushRoot = (root) => {
      if (!(root instanceof HTMLElement)) return;
      if (seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    };

    const panel = getChatTabPanelElement(resolved);
    pushRoot(panel);
    pushRoot(panel?.closest?.(".MuiDrawer-paper") || null);
    pushRoot(resolved?.button?.closest?.('[role="tabpanel"]') || null);
    pushRoot(resolved?.button?.closest?.(".MuiDrawer-paper") || null);
    return roots;
  }

  function getChatTabOwnerDrawer(tab = null) {
    const resolved = tab ? (resolveChatTabDescriptor(tab) || tab) : null;
    if (!resolved) return null;

    return resolved?.button?.closest?.(".MuiDrawer-paper")
      || getChatTabPanelElement(resolved)?.closest?.(".MuiDrawer-paper")
      || null;
  }

  function getChatTabPanelElement(tab = null) {
    const resolved = tab ? (resolveChatTabDescriptor(tab) || tab) : null;
    if (!resolved) return null;

    const panelId = normalizeSpace(
      resolved?.panelId
      || resolved?.button?.getAttribute?.("aria-controls")
      || ""
    );
    if (panelId) {
      const panel = document.getElementById(panelId);
      if (panel instanceof HTMLElement) {
        return panel;
      }
    }

    const buttonId = normalizeSpace(
      resolved?.buttonId
      || resolved?.button?.id
      || ""
    );
    if (buttonId) {
      const labelledPanel = document.querySelector(`[aria-labelledby~="${escapeCssAttributeValue(buttonId)}"]`);
      if (labelledPanel instanceof HTMLElement) {
        return labelledPanel;
      }
    }

    return resolved?.button?.closest?.('[role="tabpanel"]') || null;
  }

  function escapeCssAttributeValue(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, "\\\"");
  }

  function isLogMessageTextElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!isVisible(element)) return false;
    if (!element.matches?.(MESSAGE_TEXT_SELECTOR)) return false;
    if (!element.closest(MESSAGE_SCOPE_SELECTOR)) return false;
    if (element.closest(`[${SAFE_UI_ATTR}="1"]`)) return false;
    if (element.closest('button, form, [role="dialog"]')) return false;
    if (element.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;
    if (element.querySelector(MESSAGE_TEXT_SELECTOR)) return false;

    const rawText = normalizeText(element.getAttribute(RAW_ATTR) || "");
    const visibleText = normalizeText(
      typeof element.innerText === "string" ? element.innerText : (element.textContent || "")
    );
    return !!(rawText.trim() || visibleText.trim());
  }

  function buildLogEntry(element, index) {
    const rawText = normalizeText(element.getAttribute(RAW_ATTR) || element.textContent || "");
    const visibleText = normalizeText(
      typeof element.innerText === "string" ? element.innerText : stripInvisibleEnvelope(element.textContent || "")
    );
    const extracted = extractEnvelope(rawText);
    const text = extracted?.envelope?.text != null
      ? normalizeText(String(extracted.envelope.text))
      : normalizeText(stripInvisibleEnvelope(rawText || visibleText));
    const itemRoot = findMessageItemRoot(element);
    const meta = extractMessageMeta(itemRoot, element, visibleText);
    const bodyHtml = captureBodyHtml(element, !!extracted, text);
    const assetSources = collectAssetSourcesFromHtml(bodyHtml);
    const avatarSource = extractMessageAvatarSource(itemRoot, element);
    if (avatarSource && !assetSources.includes(avatarSource)) {
      assetSources.unshift(avatarSource);
    }
    const baseColor = normalizeCssColor(element.style?.color || "");

    return {
      index: index + 1,
      id: getMessageId(itemRoot, index),
      sender: meta.sender,
      avatarSource,
      timestamp: meta.timestamp,
      metaTexts: meta.metaTexts,
      channel: "",
      text,
      visibleText,
      rawText,
      baseColor,
      formatEnvelopeVersion: extracted?.envelope?.v ?? null,
      formatRuns: cloneJson(extracted?.envelope?.formatRuns || []),
      alignRuns: cloneJson(extracted?.envelope?.alignRuns || []),
      blockStyle: cloneJson(extracted?.envelope?.blockStyle || {}),
      assetSources,
      bodyHtml,
      packageHtml: ""
    };
  }

  function buildLogEntryFromItemRoot(itemRoot, index) {
    if (!(itemRoot instanceof HTMLElement)) return null;
    const textElement = findPrimaryMessageTextElement(itemRoot);
    if (!(textElement instanceof HTMLElement)) return null;
    return buildLogEntry(textElement, index);
  }

  function captureBodyHtml(element, hasEnvelope, text) {
    const wrapper = document.createElement("div");
    wrapper.className = "ccf-render-root";

    const alreadyRendered =
      element.classList.contains("ccf-render-root") ||
      element.hasAttribute(RAW_ATTR) ||
      !!element.querySelector(".ccf-line, .ccf-frag, .ccf-image, .ccf-code-frag, .ccf-ruby-frag, .ccf-tooltip-frag");

    if (alreadyRendered || !hasEnvelope) {
      wrapper.innerHTML = element.innerHTML;
    } else {
      wrapper.textContent = text;
    }

    if (!wrapper.textContent && text) {
      wrapper.textContent = text;
    }

    return wrapper.innerHTML;
  }

  function findComposerBars() {
    const submits = findVisibleSubmitButtons();
    const result = new Set();

    submits.forEach((submit) => {
      const bar = findClosestComposerBar(submit);
      if (bar) {
        result.add(bar);
      }
    });

    return [...result];
  }

  function findClosestComposerBar(node) {
    let current = node instanceof Element ? node : null;
    while (current && current !== document.body) {
      if (looksLikeComposerBar(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function looksLikeComposerBar(element) {
    if (!(element instanceof HTMLElement)) return false;
    const submit = element.querySelector('button[type="submit"]');
    if (!submit) return false;

    const editors = [...element.querySelectorAll(EDITOR_SELECTOR)].filter((editor) => isVisible(editor));
    return editors.length > 0;
  }

  function findVisibleSubmitButtons() {
    return [...document.querySelectorAll('button[type="submit"]')].filter((button) => isVisible(button));
  }

  function findTargetMenus() {
    return [...document.querySelectorAll('[role="menu"]')]
      .filter((menu) => menu instanceof HTMLElement && isVisible(menu))
      .filter((menu) => {
        const anchors = findMenuAnchors(menu);
        return !!(anchors.exportAllLogsItem || anchors.exportLogsItem || anchors.tabEditItem);
      });
  }

  async function dismissTransientMenusAndOverlays() {
    const menus = [...document.querySelectorAll('[role="menu"]')]
      .filter((menu) => menu instanceof HTMLElement)
      .filter((menu) => isVisible(menu));
    if (!menus.length) return;

    const escapeEventInit = {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true
    };

    for (const menu of menus) {
      const target = menu instanceof HTMLElement ? menu : document.body;
      target.dispatchEvent(new KeyboardEvent("keydown", escapeEventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", escapeEventInit));
    }

    if (document.activeElement instanceof HTMLElement) {
      try {
        document.activeElement.blur();
      } catch (error) {
        // Ignore blur failures.
      }
    }

    await waitForAnimationFrame();
    await waitForAnimationFrame();
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  function findMenuAnchors(menu) {
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
      .filter((item) => item instanceof HTMLElement)
      .filter((item) => item.closest('[role="menu"]') === menu)
      .filter((item) => !item.hasAttribute(EXPORT_BTN_ATTR));

    return {
      exportAllLogsItem: items.find((item) => isExportAllLogsMenuItem(item)) || null,
      exportLogsItem: items.find((item) => isExportLogsMenuItem(item)) || null,
      tabEditItem: items.find((item) => isTabEditMenuItem(item)) || null
    };
  }

  function isExportAllLogsMenuItem(item) {
    const text = normalizeSpace(item.textContent || "").toLowerCase();
    if (!text) return false;

    return /export\s*all\s*logs?/.test(text)
      || /all\s*logs?\s*export/.test(text)
      || /full\s*log/.test(text)
      || /全\s*ログ\s*出力/.test(text)
      || /전체\s*로그\s*(출력|내보내기|익스포트)/.test(text);
  }

  function isExportLogsMenuItem(item) {
    const text = normalizeSpace(item.textContent || "").toLowerCase();
    if (!text) return false;
    if (isExportAllLogsMenuItem(item)) return false;

    return /export\s*logs?/.test(text)
      || /logs?\s*export/.test(text)
      || /로그\s*(출력|내보내기|익스포트)/.test(text)
      || /ログ/.test(text);
  }

  function isTabEditMenuItem(item) {
    const text = normalizeSpace(item.textContent || "").toLowerCase();
    if (!text) return false;

    return /탭\s*편집/.test(text)
      || /edit\s*tab/.test(text)
      || /tab\s*edit/.test(text)
      || /タブ\s*編集/.test(text);
  }

  function cleanupMenuItemClassName(value) {
    return String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter((className) => className !== "Mui-disabled")
      .join(" ");
  }

  function findMessageItemRoot(element) {
    if (!(element instanceof Element)) return null;

    return element.closest(MESSAGE_ITEM_SELECTOR)
      || findIndexedMessageRoot(element)
      || element.parentElement
      || element;
  }

  function findIndexedMessageRoot(element) {
    if (!(element instanceof Element)) return null;

    let current = element;
    while (current && current !== document.body) {
      if (
        current.hasAttribute("data-index") &&
        findPrimaryMessageTextElement(current)
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function getMessageId(itemRoot, index) {
    if (itemRoot instanceof Element) {
      return itemRoot.getAttribute("data-index")
        || itemRoot.getAttribute("data-id")
        || itemRoot.id
        || `message-${index + 1}`;
    }
    return `message-${index + 1}`;
  }

  function extractMessageMeta(itemRoot, textElement, visibleText) {
    if (!(itemRoot instanceof Element)) {
      return { sender: "", timestamp: "", metaTexts: [] };
    }

    const seen = new Set();
    const metaCandidates = [];
    const nodes = itemRoot.querySelectorAll('time, h1, h2, h3, h4, h5, h6, strong, b, small, span, div, p');

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node === textElement) return;
      if (node.contains(textElement) || textElement.contains(node)) return;
      if (node.querySelector(MESSAGE_TEXT_SELECTOR)) return;

      const text = normalizeSpace(node.textContent || "");
      if (!text || text === normalizeSpace(visibleText) || text.length > 120 || seen.has(text)) return;
      const parsed = splitSenderTimestampMeta(text);
      seen.add(text);
      metaCandidates.push({
        text,
        senderText: parsed.senderText,
        timestampText: parsed.timestampText,
        score: scoreSenderCandidate(node, text)
      });
    });

    const metaTexts = metaCandidates.map((item) => item.text);
    const timestamp = metaCandidates.find((item) => item.timestampText)?.timestampText
      || metaTexts.find((text) => looksLikeTimestamp(text))
      || "";
    const sender = metaCandidates
      .map((item) => ({
        ...item,
        resolvedSender: item.senderText || item.text
      }))
      .filter((item) => item.resolvedSender && item.resolvedSender !== timestamp && !looksLikeTimestamp(item.resolvedSender))
      .sort((left, right) => right.score - left.score || left.resolvedSender.length - right.resolvedSender.length)[0]?.resolvedSender || "";

    return { sender, timestamp, metaTexts };
  }

  function splitSenderTimestampMeta(text) {
    const normalized = normalizeSpace(text);
    if (!normalized) {
      return { senderText: "", timestampText: "" };
    }

    if (looksLikeTimestamp(normalized)) {
      return { senderText: "", timestampText: normalized };
    }

    const combinedPatterns = [
      /^(.*?)(?:\s*[-|/]\s*|\s+)((?:(?:today|yesterday|tomorrow|昨日|今日|明日|오늘|어제|내일)\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|AM|PM|오전|오후))?)$/,
      /^(.*?)(?:\s*[-|/]\s*|\s+)((?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/
    ];

    for (const pattern of combinedPatterns) {
      const match = normalized.match(pattern);
      if (!match) continue;

      const senderText = normalizeSpace(match[1] || "");
      const timestampText = normalizeSpace(match[2] || "");
      if (!senderText || !timestampText) continue;
      if (!looksLikeTimestamp(timestampText)) continue;
      return {
        senderText,
        timestampText
      };
    }

    return { senderText: normalized, timestampText: "" };
  }

  function enrichEntriesWithRuntimeAvatars(entries) {
    if (!Array.isArray(entries) || !entries.length) return;

    const senderMap = buildRuntimeSenderAvatarSourceMap();
    if (!senderMap.size) return;

    for (const entry of entries) {
      if (normalizeAssetSource(entry?.avatarSource || "")) continue;
      const senderKey = normalizeSenderKey(entry?.sender || "");
      if (!senderKey) continue;

      const avatarSource = senderMap.get(senderKey) || "";
      if (!avatarSource) continue;
      addAvatarSourceToEntry(entry, avatarSource);
    }
  }

  function buildRuntimeSenderAvatarSourceMap() {
    const counts = new Map();
    const state = {
      seen: new WeakSet(),
      counts
    };

    collectRuntimePackageSourceRecords().forEach((record) => {
      walkRuntimeAvatarCandidateNode(record?.payload, state, 0);
    });

    const result = new Map();
    counts.forEach((sourceMap, senderKey) => {
      let bestSource = "";
      let bestCount = -1;
      sourceMap.forEach((count, source) => {
        if (count > bestCount) {
          bestCount = count;
          bestSource = source;
        }
      });
      if (bestSource) {
        result.set(senderKey, bestSource);
      }
    });

    return result;
  }

  function walkRuntimeAvatarCandidateNode(node, state, depth) {
    if (!isRuntimeObjectLike(node) || depth > RUNTIME_DISCOVERY_MAX_DEPTH) return;

    if (Array.isArray(node)) {
      const limit = Math.min(node.length, RUNTIME_DISCOVERY_MAX_ARRAY_ITEMS);
      for (let index = 0; index < limit; index += 1) {
        walkRuntimeAvatarCandidateNode(node[index], state, depth + 1);
      }
      return;
    }

    if (state.seen.has(node)) return;
    state.seen.add(node);

    registerRuntimeAvatarCandidate(state.counts, extractRuntimeAvatarCandidate(node));

    Object.entries(node)
      .slice(0, 80)
      .forEach(([, value]) => {
        if (!isRuntimeObjectLike(value)) return;
        walkRuntimeAvatarCandidateNode(value, state, depth + 1);
      });
  }

  function extractRuntimeAvatarCandidate(value) {
    if (!isRuntimeObjectLike(value) || Array.isArray(value)) return null;

    const name = firstRuntimeString(value, [
      ["name"],
      ["displayName"],
      ["senderName"],
      ["userName"],
      ["playerName"],
      ["characterName"],
      ["speakerName"],
      ["label"],
      ["title"],
      ["sender", "name"],
      ["sender", "displayName"],
      ["user", "name"],
      ["user", "displayName"],
      ["player", "name"],
      ["player", "displayName"],
      ["character", "name"],
      ["character", "displayName"],
      ["speaker", "name"],
      ["speaker", "displayName"]
    ], true);
    if (!name || name.length > 120 || looksLikeTimestamp(name)) return null;

    const avatarSource = normalizeAssetSource(firstRuntimeString(value, [
      ["avatarSource"],
      ["avatarUrl"],
      ["iconUrl"],
      ["imageUrl"],
      ["portraitUrl"],
      ["faceUrl"],
      ["thumbnailUrl"],
      ["photoUrl"],
      ["sender", "avatarSource"],
      ["sender", "avatarUrl"],
      ["sender", "iconUrl"],
      ["sender", "imageUrl"],
      ["user", "avatarSource"],
      ["user", "avatarUrl"],
      ["user", "iconUrl"],
      ["user", "imageUrl"],
      ["player", "avatarSource"],
      ["player", "avatarUrl"],
      ["player", "iconUrl"],
      ["player", "imageUrl"],
      ["character", "avatarSource"],
      ["character", "avatarUrl"],
      ["character", "iconUrl"],
      ["character", "imageUrl"],
      ["character", "portraitUrl"],
      ["character", "faceUrl"],
      ["speaker", "avatarSource"],
      ["speaker", "avatarUrl"],
      ["speaker", "iconUrl"],
      ["speaker", "imageUrl"]
    ]));
    if (!avatarSource) return null;

    return {
      senderKey: normalizeSenderKey(name),
      avatarSource
    };
  }

  function registerRuntimeAvatarCandidate(counts, candidate) {
    if (!(counts instanceof Map) || !candidate?.senderKey || !candidate?.avatarSource) return;

    let sourceMap = counts.get(candidate.senderKey);
    if (!sourceMap) {
      sourceMap = new Map();
      counts.set(candidate.senderKey, sourceMap);
    }
    sourceMap.set(candidate.avatarSource, (sourceMap.get(candidate.avatarSource) || 0) + 1);
  }

  async function enrichPackageTabGroupsWithLiveAvatars(tabGroups, roomTitle = "") {
    if (!CCF_LOG_ENABLE_LIVE_AVATAR_SCAN) return;
    if (!Array.isArray(tabGroups) || !tabGroups.length) return;

    const currentTab = getCurrentPackageTabDescriptor(roomTitle);
    const currentGroups = selectCurrentPackageTabGroups(tabGroups, currentTab, roomTitle);
    const entries = currentGroups.flatMap((group) => Array.isArray(group?.entries) ? group.entries : []);
    const panelTabs = findPackagePanelTabDescriptors(currentGroups, roomTitle)
      .map((tab, index) => normalizePackageTabDescriptor(tab, index, roomTitle));
    const currentPanelTab = selectCurrentPackagePanelTab(panelTabs, currentTab, roomTitle);

    if (!currentPanelTab) {
      const globalLiveEntries = await collectLiveAvatarEntries();
      const sampleEntry = globalLiveEntries.find((entry) => normalizeAssetSource(entry?.avatarSource || "")) || null;
      console.info("[CCF LOG PACKAGE] live avatar scan summary", {
        tabCount: 0,
        panelTabsFound: false,
        liveEntries: globalLiveEntries.length,
        liveEntriesWithAvatar: countEntriesWithAvatar(globalLiveEntries),
        uniqueAvatarSources: collectUniqueAvatarSources(globalLiveEntries).length,
        sampleSender: sampleEntry?.sender || "",
        sampleText: normalizeSpace(sampleEntry?.text || sampleEntry?.visibleText || "").slice(0, 80)
      });
      if (countEntriesWithAvatar(globalLiveEntries) <= 1 || collectUniqueAvatarSources(globalLiveEntries).length <= 1) {
        console.info("[CCF LOG PACKAGE] avatar debug snapshot", buildAvatarDebugSnapshot());
      }
      if (globalLiveEntries.length) {
        applySenderAvatarMapFallback(entries, globalLiveEntries);
        applyTextAvatarMapFallback(entries, globalLiveEntries);
      }
      await enrichEntriesWithLiveAvatars(entries);
      return;
    }

    let liveEntries = [];
    const activated = await activateChatTab(currentPanelTab);
    if (activated) {
      liveEntries = await collectLiveAvatarEntries(currentPanelTab);
    }
    if (!liveEntries.length) {
      liveEntries = await collectLiveAvatarEntries();
    }

    if (liveEntries.length) {
      applySenderAvatarMapFallback(entries, liveEntries);
      applyTextAvatarMapFallback(entries, liveEntries);
    }
    const sampleEntry = liveEntries.find((entry) => normalizeAssetSource(entry?.avatarSource || "")) || null;
    console.info("[CCF LOG PACKAGE] live avatar scan summary", {
      tabCount: currentPanelTab ? 1 : 0,
      panelTabsFound: true,
      liveEntries: liveEntries.length,
      liveEntriesWithAvatar: countEntriesWithAvatar(liveEntries),
      uniqueAvatarSources: collectUniqueAvatarSources(liveEntries).length,
      sampleSender: sampleEntry?.sender || "",
      sampleText: normalizeSpace(sampleEntry?.text || sampleEntry?.visibleText || "").slice(0, 80)
    });
    if (countEntriesWithAvatar(liveEntries) <= 1 || collectUniqueAvatarSources(liveEntries).length <= 1) {
      console.info("[CCF LOG PACKAGE] avatar debug snapshot", buildAvatarDebugSnapshot(currentPanelTab));
    }

    for (const group of currentGroups) {
      const groupEntries = Array.isArray(group?.entries) ? group.entries : [];
      if (!groupEntries.length) continue;
      if (!groupEntries.some((entry) => !normalizeAssetSource(entry?.avatarSource || ""))) continue;

      if (liveEntries.length) {
        mergeEntriesWithLiveAvatars(groupEntries, liveEntries);
        continue;
      }

      await enrichEntriesWithLiveAvatars(groupEntries, currentPanelTab);
    }
  }

  function getLiveAvatarPanelCacheKey(panelTab) {
    if (!panelTab || typeof panelTab !== "object") return "";
    return [
      normalizeSpace(panelTab.key || ""),
      normalizeSpace(panelTab.id || ""),
      normalizeSpace(panelTab.name || ""),
      Number.isFinite(panelTab.index) ? String(panelTab.index) : ""
    ].filter(Boolean).join("||");
  }

  function enrichEntriesWithVisibleLiveAvatars(entries, tab = null) {
    if (!CCF_LOG_ENABLE_VISIBLE_AVATAR_SCAN) return { liveEntries: 0, entriesFilled: 0 };
    if (!Array.isArray(entries) || !entries.length) return { liveEntries: 0, entriesFilled: 0 };

    const before = countEntriesWithAvatar(entries);
    const liveAvatarEntries = collectVisiblePackageAvatarEntries(tab);
    if (liveAvatarEntries.length) {
      mergeEntriesWithLiveAvatars(entries, liveAvatarEntries);
    }

    return {
      liveEntries: liveAvatarEntries.length,
      entriesFilled: Math.max(0, countEntriesWithAvatar(entries) - before)
    };
  }

  function collectVisiblePackageAvatarEntries(tab = null) {
    const roots = [];
    const seenRoots = new Set();
    const addRoot = (root) => {
      if (!(root instanceof HTMLElement)) return;
      if (seenRoots.has(root)) return;
      if (!isVisible(root)) return;
      seenRoots.add(root);
      roots.push(root);
    };

    addRoot(findPrimaryLogScope(tab));
    findChatLogScopes(tab).forEach(addRoot);
    findChatLogScopes().forEach(addRoot);
    document.querySelectorAll(".MuiDrawer-paper").forEach(addRoot);

    const entries = [];
    let cursor = 0;
    for (const root of roots.slice(0, VISIBLE_AVATAR_SCAN_MAX_ROOTS)) {
      const nextEntries = collectVisibleLiveAvatarEntries(root, cursor);
      cursor += nextEntries.length;
      entries.push(...nextEntries);
      if (entries.length >= VISIBLE_AVATAR_SCAN_MAX_ENTRIES) break;
    }

    return dedupeLiveAvatarEntries(entries)
      .filter((entry) => normalizeAssetSource(entry?.avatarSource || ""))
      .slice(0, VISIBLE_AVATAR_SCAN_MAX_ENTRIES);
  }

  async function enrichEntriesWithLiveAvatars(entries, tab = null) {
    if (!CCF_LOG_ENABLE_LIVE_AVATAR_SCAN) return;
    if (!Array.isArray(entries) || !entries.length) return;

    const liveAvatarEntries = await collectLiveAvatarEntries(tab);
    if (!liveAvatarEntries.length) return;

    mergeEntriesWithLiveAvatars(entries, liveAvatarEntries);
  }

  async function collectLiveAvatarEntries(tab = null) {
    const scope = findPrimaryLogScope(tab);
    const collected = await collectLiveAvatarEntriesFromScope(scope);
    const merged = Array.isArray(collected) ? collected.slice() : [];
    const seenFingerprints = new Set(
      merged.map((entry) => getLiveAvatarEntryFingerprint(entry)).filter(Boolean)
    );

    const fallbackScopes = [...new Set([
      ...findChatLogScopes(tab),
      ...findChatLogScopes()
    ])].filter((candidate) =>
      candidate instanceof HTMLElement &&
      isVisible(candidate) &&
      candidate !== scope
    );

    for (const fallbackScope of fallbackScopes) {
      const nextEntries = await collectLiveAvatarEntriesFromScope(fallbackScope);
      for (const entry of nextEntries) {
        const fingerprint = getLiveAvatarEntryFingerprint(entry);
        if (!fingerprint || seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);
        merged.push(entry);
      }
    }

    const documentEntries = collectDocumentLevelLiveAvatarEntries();
    const scrolledEntries = await collectDocumentLevelScrolledAvatarEntries();
    const extraEntries = mergeLiveAvatarEntryLists(documentEntries, scrolledEntries);
    extraEntries.forEach((entry) => {
      const fingerprint = getLiveAvatarEntryFingerprint(entry)
        || [
          normalizeAssetSource(entry?.avatarSource || ""),
          buildAvatarTextKey(entry),
          normalizeSenderKey(entry?.sender || "")
        ].filter(Boolean).join("::");
      if (!fingerprint || seenFingerprints.has(fingerprint)) return;
      seenFingerprints.add(fingerprint);
      merged.push(entry);
    });

    return merged;
  }

  async function collectLiveAvatarEntriesFromScope(scope) {
    if (!(scope instanceof HTMLElement)) return [];

    const scroller = findLogScrollContainer(scope);
    if (!(scroller instanceof HTMLElement)) {
      return collectVisibleLiveAvatarEntries(scope);
    }

    return collectLiveAvatarEntriesFromScroller(scope, scroller);
  }

  async function collectLiveAvatarEntriesFromScroller(scope, scroller) {
    const originalTop = scroller.scrollTop;
    const originalBehavior = scroller.style.scrollBehavior;
    const entries = [];
    const seenFingerprints = [];

    scroller.style.scrollBehavior = "auto";

    try {
      await scrollLogToStart(scroller, scope);
      await waitForLogSettle(scope);

      for (let i = 0; i < LOG_SCAN_MAX_ITERATIONS; i += 1) {
        appendVisibleAvatarEntries(scope, entries, seenFingerprints);

        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (scroller.scrollTop >= maxTop - 1) {
          await waitForLogSettle(scope);
          appendVisibleAvatarEntries(scope, entries, seenFingerprints);
          break;
        }

        const step = Math.max(LOG_SCAN_MIN_STEP, Math.floor(scroller.clientHeight * LOG_SCAN_STEP_RATIO));
        const nextTop = Math.min(maxTop, scroller.scrollTop + step);
        if (nextTop === scroller.scrollTop) {
          break;
        }

        scroller.scrollTop = nextTop;
        await waitForLogSettle(scope);
      }
    } finally {
      scroller.scrollTop = originalTop;
      scroller.style.scrollBehavior = originalBehavior;
    }

    return entries;
  }

  function appendVisibleAvatarEntries(scope, entries, seenFingerprints) {
    const visibleEntries = collectVisibleLiveAvatarEntries(scope, entries.length)
      .filter((entry) => !!getLiveAvatarEntryFingerprint(entry));

    if (!visibleEntries.length) return;

    const visibleFingerprints = visibleEntries.map((entry) => getLiveAvatarEntryFingerprint(entry));
    const overlap = getFingerprintOverlapLength(seenFingerprints, visibleFingerprints);

    for (let i = overlap; i < visibleEntries.length; i += 1) {
      const entry = visibleEntries[i];
      const fingerprint = visibleFingerprints[i];
      if (!fingerprint) continue;

      seenFingerprints.push(fingerprint);
      if (seenFingerprints.length > 400) {
        seenFingerprints.splice(0, seenFingerprints.length - 400);
      }

      entries.push(entry);
    }
  }

  function collectVisibleLiveAvatarEntries(scope, startIndex = 0) {
    const messageEntries = findLogMessageElements([scope])
      .map((element, index) => buildLiveAvatarEntry(element, startIndex + index))
      .filter((entry) => !!entry);

    const itemEntries = findLogMessageItemRoots([scope])
      .map((itemRoot, index) => buildLiveAvatarEntryFromItemRoot(itemRoot, startIndex + messageEntries.length + index))
      .filter((entry) => !!entry);

    const avatarEntries = collectVisibleLiveAvatarEntriesFromAvatarNodes(
      scope,
      startIndex + messageEntries.length + itemEntries.length
    );
    return dedupeLiveAvatarEntries([...messageEntries, ...itemEntries, ...avatarEntries]);
  }

  function collectVisibleLiveAvatarEntriesFromAvatarNodes(scope, startIndex = 0) {
    if (!(scope instanceof HTMLElement)) return [];

    const entries = [];
    const seen = new Set();
    const nodes = [scope, ...scope.querySelectorAll(AVATAR_NODE_SELECTOR)];

    nodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const avatarSource = extractElementImageSource(node);
      if (!avatarSource) return;
      if (!isVisible(node)) return;

      const rect = node.getBoundingClientRect();
      const fingerprint = [
        normalizeAssetSource(avatarSource),
        Math.round(rect.top || 0),
        Math.round(rect.left || 0)
      ].join("::");
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);

      const entry = buildLiveAvatarEntryFromAvatarNode(node, startIndex + entries.length);
      if (entry) {
        entries.push(entry);
      }
    });

    return entries;
  }

  function collectDocumentLevelLiveAvatarEntries() {
    const roots = [];
    const seen = new Set();
    const pushRoot = (root) => {
      if (!(root instanceof HTMLElement)) return;
      if (seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    };

    document.querySelectorAll(".MuiDrawer-paper").forEach((drawer) => {
      if (!(drawer instanceof HTMLElement)) return;
      if (!isVisible(drawer)) return;
      pushRoot(drawer);
    });

    findComposerBars().forEach((bar) => {
      pushRoot(bar?.closest?.(".MuiDrawer-paper") || null);
      pushRoot(bar instanceof HTMLElement ? bar : null);
    });

    pushRoot(document.body);

    const entries = [];
    let cursor = 0;
    roots.forEach((root) => {
      const nextEntries = collectVisibleLiveAvatarEntries(root, cursor);
      cursor += nextEntries.length;
      entries.push(...nextEntries);
    });

    return dedupeLiveAvatarEntries(entries);
  }

  async function collectDocumentLevelScrolledAvatarEntries() {
    const drawers = [...document.querySelectorAll(".MuiDrawer-paper")]
      .filter((drawer) => drawer instanceof HTMLElement)
      .filter((drawer) => isVisible(drawer));
    const roots = drawers.length ? drawers : [document.body].filter((root) => root instanceof HTMLElement);
    const scrollers = [];
    const seen = new Set();

    roots.forEach((root) => {
      const candidates = root instanceof HTMLElement
        ? findScrollableElementsForAvatarScan(root).slice(0, 6)
        : [];
      if (!candidates.length && root instanceof HTMLElement && isScrollableElement(root)) {
        candidates.push(root);
      }

      candidates.forEach((scroller) => {
        if (!(scroller instanceof HTMLElement)) return;
        if (seen.has(scroller)) return;
        seen.add(scroller);
        scrollers.push({
          root: resolveAvatarScanRoot(root, scroller),
          scroller
        });
      });
    });

    const collected = [];
    for (const item of scrollers) {
      const entries = await collectAvatarEntriesFromDocumentScroller(item.root, item.scroller);
      collected.push(...entries);
    }

    return dedupeLiveAvatarEntries(collected);
  }

  function resolveAvatarScanRoot(root, scroller) {
    if (!(scroller instanceof HTMLElement)) return root instanceof HTMLElement ? root : document.body;

    let current = scroller;
    for (let depth = 0; depth < 4 && current instanceof HTMLElement; depth += 1) {
      const avatarCount = current.querySelectorAll?.(AVATAR_NODE_SELECTOR)?.length || 0;
      const itemCount = current.querySelectorAll?.(MESSAGE_ITEM_SELECTOR)?.length || 0;
      if (avatarCount > 0 || itemCount > 0) {
        return current;
      }
      current = current.parentElement;
    }

    return root instanceof HTMLElement ? root : (scroller.closest(".MuiDrawer-paper") || document.body);
  }

  async function collectAvatarEntriesFromDocumentScroller(root, scroller) {
    if (!(root instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return [];

    const originalTop = scroller.scrollTop;
    const originalBehavior = scroller.style.scrollBehavior;
    const entries = [];
    const seenFingerprints = [];

    scroller.style.scrollBehavior = "auto";

    try {
      await scrollLogToStart(scroller, root);
      await waitForLogSettle(root);

      for (let i = 0; i < LOG_SCAN_MAX_ITERATIONS; i += 1) {
        const visibleEntries = collectVisibleLiveAvatarEntries(root, entries.length)
          .filter((entry) => !!getLiveAvatarEntryFingerprint(entry));
        appendDedupedLiveAvatarEntries(entries, seenFingerprints, visibleEntries);

        const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (scroller.scrollTop >= maxTop - 1) {
          await waitForLogSettle(root);
          const tailEntries = collectVisibleLiveAvatarEntries(root, entries.length)
            .filter((entry) => !!getLiveAvatarEntryFingerprint(entry));
          appendDedupedLiveAvatarEntries(entries, seenFingerprints, tailEntries);
          break;
        }

        const step = Math.max(LOG_SCAN_MIN_STEP, Math.floor(scroller.clientHeight * LOG_SCAN_STEP_RATIO));
        const nextTop = Math.min(maxTop, scroller.scrollTop + step);
        if (nextTop === scroller.scrollTop) {
          break;
        }

        scroller.scrollTop = nextTop;
        await waitForLogSettle(root);
      }
    } finally {
      scroller.scrollTop = originalTop;
      scroller.style.scrollBehavior = originalBehavior;
    }

    return entries;
  }

  function appendDedupedLiveAvatarEntries(targetEntries, seenFingerprints, nextEntries) {
    if (!Array.isArray(targetEntries) || !Array.isArray(seenFingerprints) || !Array.isArray(nextEntries)) return;

    const nextFingerprints = nextEntries.map((entry) => getLiveAvatarEntryFingerprint(entry));
    const overlap = getFingerprintOverlapLength(seenFingerprints, nextFingerprints);

    for (let i = overlap; i < nextEntries.length; i += 1) {
      const entry = nextEntries[i];
      const fingerprint = nextFingerprints[i];
      if (!fingerprint) continue;
      seenFingerprints.push(fingerprint);
      if (seenFingerprints.length > 400) {
        seenFingerprints.splice(0, seenFingerprints.length - 400);
      }
      targetEntries.push(entry);
    }
  }

  function mergeLiveAvatarEntryLists(baseEntries, extraEntries) {
    return dedupeLiveAvatarEntries([
      ...(Array.isArray(baseEntries) ? baseEntries : []),
      ...(Array.isArray(extraEntries) ? extraEntries : [])
    ]);
  }

  function buildLiveAvatarEntryFromAvatarNode(avatarNode, index) {
    if (!(avatarNode instanceof HTMLElement)) return null;

    const avatarSource = extractElementImageSource(avatarNode);
    if (!avatarSource) return null;

    const itemRoot = findAvatarMessageItemRoot(avatarNode);
    const textElement = findAvatarMessageBodyElement(avatarNode, itemRoot)
      || (itemRoot && findPrimaryMessageTextElement(itemRoot))
      || findNearestMessageTextElementForAvatar(avatarNode)
      || avatarNode;
    const effectiveRoot = itemRoot || findMessageItemRoot(textElement) || avatarNode.parentElement || avatarNode;
    const rawText = normalizeText(
      textElement.getAttribute?.(RAW_ATTR) || textElement.textContent || effectiveRoot.textContent || ""
    );
    const visibleText = normalizeText(
      typeof textElement.innerText === "string"
        ? textElement.innerText
        : stripInvisibleEnvelope(textElement.textContent || effectiveRoot.textContent || "")
    );
    const extracted = extractEnvelope(rawText);
    const text = extracted?.envelope?.text != null
      ? normalizeText(String(extracted.envelope.text))
      : normalizeText(stripInvisibleEnvelope(rawText || visibleText));
    const meta = extractMessageMeta(effectiveRoot, textElement, visibleText);

    return {
      id: getMessageId(effectiveRoot, index),
      sender: meta.sender,
      timestamp: meta.timestamp,
      mergeKey: buildAvatarMergeKey({ sender: meta.sender, text, visibleText, rawText }),
      text,
      visibleText,
      rawText,
      avatarSource
    };
  }

  function findAvatarMessageBodyElement(avatarNode, itemRoot) {
    const root = itemRoot instanceof HTMLElement
      ? itemRoot
      : findAvatarMessageItemRoot(avatarNode);
    if (!(root instanceof HTMLElement) || !(avatarNode instanceof HTMLElement)) return null;

    const avatarRect = avatarNode.getBoundingClientRect();
    if (!avatarRect || avatarRect.width <= 0 || avatarRect.height <= 0) return null;

    const candidates = [root, ...root.querySelectorAll("p, div, span")]
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => isAvatarMessageBodyCandidate(node, root, avatarNode))
      .map((node) => ({
        node,
        score: scoreAvatarMessageBodyCandidate(node, avatarRect)
      }))
      .filter((item) => Number.isFinite(item.score))
      .sort((left, right) => right.score - left.score);

    return candidates[0]?.node || null;
  }

  function isAvatarMessageBodyCandidate(node, root, avatarNode) {
    if (!(node instanceof HTMLElement) || !(root instanceof HTMLElement) || !(avatarNode instanceof HTMLElement)) return false;
    if (!root.contains(node)) return false;
    if (!isVisible(node)) return false;
    if (node === avatarNode || node.contains(avatarNode)) return false;
    if (node.closest(`[${SAFE_UI_ATTR}="1"]`)) return false;
    if (node.closest('button, form, [role="dialog"]')) return false;
    if (node.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;

    const text = normalizeSpace(
      typeof node.innerText === "string" ? node.innerText : (node.textContent || "")
    );
    if (!text) return false;
    if (text.length > 6000) return false;
    return true;
  }

  function scoreAvatarMessageBodyCandidate(node, avatarRect) {
    if (!(node instanceof HTMLElement) || !avatarRect) return Number.NEGATIVE_INFINITY;

    const text = normalizeSpace(
      typeof node.innerText === "string" ? node.innerText : (node.textContent || "")
    );
    if (!text) return Number.NEGATIVE_INFINITY;

    const rect = node.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return Number.NEGATIVE_INFINITY;

    const horizontalGap = rect.left - avatarRect.right;
    const verticalDelta = Math.abs((rect.top + rect.height / 2) - (avatarRect.top + avatarRect.height / 2));
    if (horizontalGap < -24 || horizontalGap > 520) return Number.NEGATIVE_INFINITY;
    if (verticalDelta > Math.max(120, avatarRect.height * 3.2)) return Number.NEGATIVE_INFINITY;

    const tokens = [
      node.className || "",
      node.getAttribute("role") || "",
      node.getAttribute("data-testid") || "",
      node.getAttribute("aria-label") || "",
      node.parentElement?.className || ""
    ].join(" ").toLowerCase();

    let score = Math.min(180, text.length * 2);
    if (node.matches?.(MESSAGE_TEXT_SELECTOR)) score += 120;
    if (node.closest(".MuiListItemText-root")) score += 40;
    if (/body|message|content|text|comment|chat|primary/.test(tokens)) score += 20;
    if (/secondary|caption|meta|time|date|sender|author|name|header/.test(tokens)) score -= 36;
    if (looksLikeTimestamp(text)) score -= 64;
    if (text.length <= 2) score -= 40;
    if (text.length <= 12 && !/\s/.test(text)) score -= 22;
    if (node.childElementCount > 0) score -= Math.min(56, node.childElementCount * 10);
    score -= Math.max(0, verticalDelta) * 0.45;
    score -= Math.max(0, horizontalGap) * 0.08;
    return score;
  }

  function findAvatarMessageItemRoot(avatarNode) {
    if (!(avatarNode instanceof HTMLElement)) return null;

    const direct = avatarNode.closest(
      `${MESSAGE_ITEM_SELECTOR}, [class*="ListItem"], [class*="message"], [class*="comment"]`
    );
    if (direct instanceof HTMLElement) return direct;

    let current = avatarNode.parentElement;
    for (let depth = 0; depth < 8 && current instanceof HTMLElement; depth += 1) {
      if (!isVisible(current)) {
        current = current.parentElement;
        continue;
      }

      const textElement = findPrimaryMessageTextElement(current);
      if (textElement instanceof HTMLElement) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function findNearestMessageTextElementForAvatar(avatarNode) {
    if (!(avatarNode instanceof HTMLElement)) return null;

    const searchRoot = avatarNode.closest(".MuiDrawer-paper")
      || avatarNode.closest(MESSAGE_SCOPE_SELECTOR)
      || document.body;
    if (!(searchRoot instanceof HTMLElement)) return null;

    const avatarRect = avatarNode.getBoundingClientRect();
    if (!avatarRect || avatarRect.width <= 0 || avatarRect.height <= 0) return null;

    const candidates = findLogMessageElements([searchRoot]).map((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;

      const verticalDelta = Math.abs((rect.top + rect.height / 2) - (avatarRect.top + avatarRect.height / 2));
      const horizontalGap = rect.left - avatarRect.right;
      if (verticalDelta > Math.max(84, avatarRect.height * 2.8)) return null;
      if (horizontalGap < -24 || horizontalGap > 420) return null;

      return {
        element,
        score: verticalDelta + Math.max(0, horizontalGap) * 0.2
      };
    }).filter(Boolean);

    candidates.sort((left, right) => left.score - right.score);
    return candidates[0]?.element || null;
  }

  function dedupeLiveAvatarEntries(entries) {
    const out = [];
    const seen = new Set();

    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") continue;
      const fingerprint = getLiveAvatarEntryFingerprint(entry)
        || [
          normalizeAssetSource(entry.avatarSource || ""),
          buildAvatarTextKey(entry),
          normalizeSenderKey(entry.sender || "")
        ].filter(Boolean).join("::");
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      out.push(entry);
    }

    return out;
  }

  function getFingerprintOverlapLength(previousFingerprints, nextFingerprints) {
    if (!Array.isArray(previousFingerprints) || !previousFingerprints.length) return 0;
    if (!Array.isArray(nextFingerprints) || !nextFingerprints.length) return 0;

    const maxOverlap = Math.min(previousFingerprints.length, nextFingerprints.length);
    for (let size = maxOverlap; size > 0; size -= 1) {
      let matched = true;
      for (let i = 0; i < size; i += 1) {
        if (previousFingerprints[previousFingerprints.length - size + i] !== nextFingerprints[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return size;
    }

    return 0;
  }

  function buildLiveAvatarEntry(element, index) {
    if (!(element instanceof HTMLElement)) {
      return {
        id: `message-${index + 1}`,
        sender: "",
        timestamp: "",
        mergeKey: "",
        text: "",
        visibleText: "",
        rawText: "",
        avatarSource: ""
      };
    }

    const rawText = normalizeText(element.getAttribute(RAW_ATTR) || element.textContent || "");
    const visibleText = normalizeText(
      typeof element.innerText === "string" ? element.innerText : stripInvisibleEnvelope(element.textContent || "")
    );
    const extracted = extractEnvelope(rawText);
    const text = extracted?.envelope?.text != null
      ? normalizeText(String(extracted.envelope.text))
      : normalizeText(stripInvisibleEnvelope(rawText || visibleText));
    const itemRoot = findMessageItemRoot(element);
    const meta = extractMessageMeta(itemRoot, element, visibleText);

    return {
      id: getMessageId(itemRoot, index),
      sender: meta.sender,
      timestamp: meta.timestamp,
      mergeKey: buildAvatarMergeKey({ sender: meta.sender, text, visibleText, rawText }),
      text,
      visibleText,
      rawText,
      avatarSource: extractMessageAvatarSource(itemRoot, element)
    };
  }

  function buildLiveAvatarEntryFromItemRoot(itemRoot, index) {
    if (!(itemRoot instanceof HTMLElement)) return null;

    const textElement = findPrimaryMessageTextElement(itemRoot) || itemRoot;
    const rawText = normalizeText(
      textElement.getAttribute?.(RAW_ATTR) || textElement.textContent || itemRoot.textContent || ""
    );
    const visibleText = normalizeText(
      typeof textElement.innerText === "string"
        ? textElement.innerText
        : stripInvisibleEnvelope(textElement.textContent || itemRoot.textContent || "")
    );
    const extracted = extractEnvelope(rawText);
    const text = extracted?.envelope?.text != null
      ? normalizeText(String(extracted.envelope.text))
      : normalizeText(stripInvisibleEnvelope(rawText || visibleText));
    const meta = extractMessageMeta(itemRoot, textElement, visibleText);
    const avatarSource = extractMessageAvatarSource(itemRoot, textElement);

    return {
      id: getMessageId(itemRoot, index),
      sender: meta.sender,
      timestamp: meta.timestamp,
      mergeKey: buildAvatarMergeKey({ sender: meta.sender, text, visibleText, rawText }),
      text,
      visibleText,
      rawText,
      avatarSource
    };
  }

  function getLiveAvatarEntryFingerprint(entry) {
    if (!entry || typeof entry !== "object") return "";
    if (entry.id && !/^message-\d+$/.test(entry.id)) {
      return `id:${entry.id}`;
    }
    const senderKey = normalizeSenderKey(entry.sender || "");
    const timestampKey = normalizeSpace(entry.timestamp || "");
    return [senderKey, timestampKey, entry.mergeKey || ""].filter(Boolean).join("\n@@\n");
  }

  function buildAvatarMergeKey(entry) {
    const senderKey = normalizeSenderKey(entry?.sender || "");
    const text = normalizeText(
      entry?.text || entry?.visibleText || stripInvisibleEnvelope(entry?.rawText || "")
    );
    const textKey = normalizeSpace(text).slice(0, 500);
    return [senderKey, textKey].filter(Boolean).join("\n@@\n");
  }

  function mergeEntriesWithLiveAvatars(entries, liveEntries) {
    if (!Array.isArray(entries) || !entries.length || !Array.isArray(liveEntries) || !liveEntries.length) return;

    if (entries.length === liveEntries.length) {
      for (let i = 0; i < entries.length; i += 1) {
        if (liveEntries[i]?.avatarSource) {
          addAvatarSourceToEntry(entries[i], liveEntries[i].avatarSource);
        }
      }
    }

    const usedLiveIndexes = new Set();
    let cursor = 0;

    for (const entry of entries) {
      let matchedIndex = -1;
      for (let i = cursor; i < liveEntries.length; i += 1) {
        if (usedLiveIndexes.has(i)) continue;
        if (!isAvatarEntryMatch(entry, liveEntries[i])) continue;
        matchedIndex = i;
        break;
      }

      if (matchedIndex < 0) continue;

      usedLiveIndexes.add(matchedIndex);
      cursor = matchedIndex + 1;
      if (liveEntries[matchedIndex]?.avatarSource) {
        addAvatarSourceToEntry(entry, liveEntries[matchedIndex].avatarSource);
      }
    }

    applySenderOrderedAvatarFallback(entries, liveEntries, usedLiveIndexes);
    applySenderAvatarMapFallback(entries, liveEntries);
    applyTextAvatarMapFallback(entries, liveEntries);
  }

  function applySenderOrderedAvatarFallback(entries, liveEntries, usedLiveIndexes = new Set()) {
    if (!Array.isArray(entries) || !Array.isArray(liveEntries)) return;

    let cursor = 0;
    for (const entry of entries) {
      if (normalizeAssetSource(entry?.avatarSource || "")) continue;
      const targetSender = normalizeSenderKey(entry?.sender || "");
      if (!targetSender) continue;

      for (let i = cursor; i < liveEntries.length; i += 1) {
        if (usedLiveIndexes.has(i)) continue;
        const liveEntry = liveEntries[i];
        if (!liveEntry?.avatarSource) continue;
        if (normalizeSenderKey(liveEntry.sender || "") !== targetSender) continue;

        addAvatarSourceToEntry(entry, liveEntry.avatarSource);
        usedLiveIndexes.add(i);
        cursor = i + 1;
        break;
      }
    }
  }

  function applySenderAvatarMapFallback(entries, liveEntries) {
    if (!Array.isArray(entries) || !Array.isArray(liveEntries)) return;

    const senderMap = buildSenderAvatarSourceMap(liveEntries);
    if (!senderMap.size) return;

    for (const entry of entries) {
      if (normalizeAssetSource(entry?.avatarSource || "")) continue;
      const senderKey = normalizeSenderKey(entry?.sender || "");
      if (!senderKey) continue;

      const avatarSource = senderMap.get(senderKey) || "";
      if (!avatarSource) continue;
      addAvatarSourceToEntry(entry, avatarSource);
    }
  }

  function applyTextAvatarMapFallback(entries, liveEntries) {
    if (!Array.isArray(entries) || !Array.isArray(liveEntries)) return;

    const textMap = buildTextAvatarSourceMap(liveEntries);
    if (!textMap.size) return;

    for (const entry of entries) {
      if (normalizeAssetSource(entry?.avatarSource || "")) continue;
      const textKey = buildAvatarTextKey(entry);
      if (!textKey) continue;

      const avatarSource = textMap.get(textKey) || "";
      if (!avatarSource) continue;
      addAvatarSourceToEntry(entry, avatarSource);
    }
  }

  function buildSenderAvatarSourceMap(liveEntries) {
    const counts = new Map();

    for (const liveEntry of liveEntries) {
      const senderKey = normalizeSenderKey(liveEntry?.sender || "");
      const avatarSource = normalizeAssetSource(liveEntry?.avatarSource || "");
      if (!senderKey || !avatarSource) continue;

      let sourceMap = counts.get(senderKey);
      if (!sourceMap) {
        sourceMap = new Map();
        counts.set(senderKey, sourceMap);
      }
      sourceMap.set(avatarSource, (sourceMap.get(avatarSource) || 0) + 1);
    }

    const result = new Map();
    counts.forEach((sourceMap, senderKey) => {
      let bestSource = "";
      let bestCount = -1;
      sourceMap.forEach((count, source) => {
        if (count > bestCount) {
          bestCount = count;
          bestSource = source;
        }
      });
      if (bestSource) {
        result.set(senderKey, bestSource);
      }
    });

    return result;
  }

  function buildTextAvatarSourceMap(liveEntries) {
    const counts = new Map();

    for (const liveEntry of liveEntries) {
      const textKey = buildAvatarTextKey(liveEntry);
      const avatarSource = normalizeAssetSource(liveEntry?.avatarSource || "");
      if (!textKey || !avatarSource) continue;

      let sourceMap = counts.get(textKey);
      if (!sourceMap) {
        sourceMap = new Map();
        counts.set(textKey, sourceMap);
      }
      sourceMap.set(avatarSource, (sourceMap.get(avatarSource) || 0) + 1);
    }

    const result = new Map();
    counts.forEach((sourceMap, textKey) => {
      let bestSource = "";
      let bestCount = -1;
      sourceMap.forEach((count, source) => {
        if (count > bestCount) {
          bestCount = count;
          bestSource = source;
        }
      });
      if (bestSource) {
        result.set(textKey, bestSource);
      }
    });

    return result;
  }

  function buildAvatarTextKey(entry) {
    const text = normalizeText(
      entry?.text || entry?.visibleText || stripInvisibleEnvelope(entry?.rawText || "")
    );
    return normalizeSpace(text).slice(0, 500);
  }

  function isAvatarEntryMatch(entry, liveEntry) {
    if (!entry || !liveEntry) return false;

    const targetKey = buildAvatarMergeKey(entry);
    const liveKey = buildAvatarMergeKey(liveEntry);
    const targetSender = normalizeSenderKey(entry.sender || "");
    const liveSender = normalizeSenderKey(liveEntry.sender || "");
    const senderMatches = !!targetSender && !!liveSender && targetSender === liveSender;

    if (targetKey && liveKey && targetKey === liveKey) {
      return !targetSender || !liveSender || senderMatches;
    }

    if (senderMatches && targetKey && liveKey) {
      return targetKey.includes(liveKey) || liveKey.includes(targetKey);
    }

    if (!targetKey && senderMatches) return true;
    return false;
  }

  function extractMessageAvatarSource(itemRoot, textElement) {
    if (!(itemRoot instanceof Element)) return "";

    const searchRoots = getAvatarSearchRoots(itemRoot);
    const directAvatarNode = findDirectAvatarNode(searchRoots, textElement);
    const directAvatarSource = extractElementImageSource(directAvatarNode);
    if (directAvatarSource) return directAvatarSource;

    const nearbyAvatarNode = findNearbyAvatarNode(textElement);
    const nearbyAvatarSource = extractElementImageSource(nearbyAvatarNode);
    if (nearbyAvatarSource) return nearbyAvatarSource;

    const candidates = [];
    const nodes = searchRoots.flatMap((root) => [...root.querySelectorAll("*")]);
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (node === textElement || textElement?.contains?.(node)) continue;
      if (!isVisible(node)) continue;

      const source = extractElementImageSource(node);
      if (!source) continue;

      const score = scoreAvatarCandidate(node);
      if (score <= 0) continue;
      candidates.push({ source, score });
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.source || "";
  }

  function findNearbyAvatarNode(textElement) {
    if (!(textElement instanceof HTMLElement)) return null;

    const searchRoot = findNearbyAvatarSearchRoot(textElement);
    if (!(searchRoot instanceof HTMLElement)) return null;

    const textRect = textElement.getBoundingClientRect();
    if (!textRect || textRect.width <= 0 || textRect.height <= 0) return null;

    const candidates = [];
    searchRoot.querySelectorAll(AVATAR_NODE_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;

      const rect = node.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      const score = scoreNearbyAvatarCandidate(textRect, rect, node);
      if (!Number.isFinite(score)) return;
      candidates.push({ node, score });
    });

    candidates.sort((left, right) => left.score - right.score);
    return candidates[0]?.node || null;
  }

  function findNearbyAvatarSearchRoot(textElement) {
    if (!(textElement instanceof HTMLElement)) return null;

    return textElement.closest(".MuiDrawer-paper")
      || textElement.closest('[role="presentation"]')
      || textElement.closest(MESSAGE_SCOPE_SELECTOR)
      || document.body;
  }

  function scoreNearbyAvatarCandidate(textRect, avatarRect, node) {
    const textCenterY = textRect.top + (textRect.height / 2);
    const avatarCenterY = avatarRect.top + (avatarRect.height / 2);
    const verticalDelta = Math.abs(textCenterY - avatarCenterY);
    if (verticalDelta > Math.max(72, textRect.height * 2.4)) return Number.POSITIVE_INFINITY;

    const leftGap = textRect.left - avatarRect.right;
    if (leftGap < -12) return Number.POSITIVE_INFINITY;
    if (leftGap > 220) return Number.POSITIVE_INFINITY;

    let score = verticalDelta + Math.max(0, leftGap) * 0.18;
    const width = avatarRect.width;
    const height = avatarRect.height;
    const sizeDelta = Math.abs(width - 40) + Math.abs(height - 40);
    score += sizeDelta * 0.1;

    const tokens = [
      node.getAttribute("alt") || "",
      node.className || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("data-testid") || ""
    ].join(" ").toLowerCase();

    if (/avatar/.test(tokens)) score -= 12;
    if (/muiavatar/.test(tokens)) score -= 8;
    return score;
  }

  function getAvatarSearchRoots(itemRoot) {
    if (!(itemRoot instanceof HTMLElement)) return [];

    const roots = [];
    const seen = new Set();
    let current = itemRoot;

    for (let depth = 0; depth < 4 && current instanceof HTMLElement; depth += 1) {
      if (!seen.has(current)) {
        seen.add(current);
        roots.push(current);
      }

      const parent = current.parentElement;
      if (!(parent instanceof HTMLElement)) break;
      if (parent.matches?.(MESSAGE_SCOPE_SELECTOR)) break;

      const textCount = parent.querySelectorAll(MESSAGE_TEXT_SELECTOR).length;
      if (textCount > 2) break;
      current = parent;
    }

    return roots;
  }

  function findDirectAvatarNode(searchRoots, textElement) {
    if (!Array.isArray(searchRoots) || !searchRoots.length) return null;

    const textRect = textElement instanceof HTMLElement
      ? textElement.getBoundingClientRect()
      : null;
    const textItemRoot = textElement instanceof HTMLElement
      ? findMessageItemRoot(textElement)
      : null;
    const candidates = [];
    const seen = new Set();

    for (const root of searchRoots) {
      if (!(root instanceof HTMLElement)) continue;

      const rootCandidates = [
        ...(root.matches?.(AVATAR_NODE_SELECTOR) ? [root] : []),
        ...root.querySelectorAll(AVATAR_NODE_SELECTOR)
      ];

      rootCandidates.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!isVisible(node)) return;
        if (node === textElement || textElement?.contains?.(node)) return;

        const source = extractElementImageSource(node);
        if (!source) return;

        const rect = node.getBoundingClientRect();
        const key = [
          normalizeAssetSource(source),
          Math.round(rect.top || 0),
          Math.round(rect.left || 0)
        ].join("::");
        if (seen.has(key)) return;
        seen.add(key);

        candidates.push({
          node,
          score: scoreDirectAvatarNodeCandidate(node, textRect, textItemRoot, root)
        });
      });
    }

    candidates.sort((left, right) => left.score - right.score);
    return candidates[0]?.node || null;
  }

  function scoreDirectAvatarNodeCandidate(node, textRect = null, textItemRoot = null, searchRoot = null) {
    if (!(node instanceof HTMLElement)) return Number.POSITIVE_INFINITY;

    const rect = node.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return Number.POSITIVE_INFINITY;

    let score = 0;
    const nodeItemRoot = findMessageItemRoot(node);
    if (textItemRoot instanceof HTMLElement && nodeItemRoot instanceof HTMLElement) {
      if (nodeItemRoot === textItemRoot) {
        score -= 240;
      } else {
        score += 120;
      }
    }

    if (searchRoot instanceof HTMLElement && searchRoot === textItemRoot) {
      score -= 40;
    }

    if (textRect) {
      const proximityScore = scoreNearbyAvatarCandidate(textRect, rect, node);
      if (Number.isFinite(proximityScore)) {
        score += proximityScore;
      } else {
        score += 320;
      }
    }

    score -= scoreAvatarCandidate(node) * 4;
    return score;
  }

  function extractElementImageSource(node, allowDescendants = true) {
    if (!(node instanceof Element)) return "";

    if (node instanceof HTMLImageElement) {
      const currentSource = normalizeAssetSource(node.currentSrc || "");
      if (currentSource) return currentSource;

      const attrSource = normalizeAssetSource(node.getAttribute("src") || node.src || "");
      if (attrSource) return attrSource;
    }

    for (const attrName of [
      "data-src",
      "data-original",
      "data-image",
      "data-avatar-url",
      "data-icon-url",
      "data-url",
      "src",
      "href",
      "xlink:href"
    ]) {
      const attrSource = normalizeAssetSource(node.getAttribute(attrName) || "");
      if (attrSource) return attrSource;
    }

    if (node instanceof HTMLElement) {
      const inlineBackground = extractCssUrls(node.style?.backgroundImage || "")[0] || "";
      if (inlineBackground) return inlineBackground;

      const computedBackground = extractCssUrls(getComputedStyle(node).backgroundImage || "")[0] || "";
      if (computedBackground) return computedBackground;
    }

    if (allowDescendants && typeof node.querySelectorAll === "function") {
      const descendants = [...node.querySelectorAll('img, image, .MuiAvatar-root, [class*="Avatar"], [class*="avatar"], [style*="background-image"]')];
      for (const descendant of descendants) {
        if (!(descendant instanceof Element) || descendant === node) continue;
        const descendantSource = extractElementImageSource(descendant, false);
        if (descendantSource) return descendantSource;
      }
    }

    return "";
  }

  function scoreAvatarCandidate(node) {
    if (!(node instanceof HTMLElement)) return 0;

    const tokens = [
      node.className || "",
      node.getAttribute("alt") || "",
      node.getAttribute("aria-label") || "",
      node.getAttribute("data-testid") || "",
      node.getAttribute("role") || ""
    ].join(" ").toLowerCase();

    let score = 0;
    if (node instanceof HTMLImageElement) score += 7;
    if (/avatar|icon|portrait|character|profile|user|face/.test(tokens)) score += 8;
    if (/muiavatar/.test(tokens)) score += 6;

    const rect = node.getBoundingClientRect?.();
    const width = Number(rect?.width) || Number(node.getAttribute("width")) || 0;
    const height = Number(rect?.height) || Number(node.getAttribute("height")) || 0;
    if (width > 0 && height > 0) {
      const maxSize = Math.max(width, height);
      const minSize = Math.min(width, height);
      if (maxSize <= 96) score += 4;
      if (maxSize >= 24 && minSize >= 24) score += 2;
      if (Math.abs(width - height) <= 18) score += 2;
      if (maxSize >= 180) score -= 8;
    }

    if (node.childElementCount > 6) score -= 2;
    return score;
  }

  function normalizeSenderKey(value) {
    return normalizeSpace(value).toLowerCase();
  }

  function addAvatarSourceToEntry(entry, source) {
    if (!entry || typeof entry !== "object") return;
    const normalized = normalizeAssetSource(source);
    if (!normalized) return;

    entry.avatarSource = normalized;
    entry.assetSources = mergeUniqueStrings(entry.assetSources || [], [normalized]);
  }

  function countEntriesWithAvatar(entries) {
    if (!Array.isArray(entries)) return 0;
    return entries.reduce((count, entry) =>
      count + (normalizeAssetSource(entry?.avatarSource || "") ? 1 : 0)
    , 0);
  }

  function collectUniqueAvatarSources(entries) {
    const seen = new Set();
    const out = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
      const source = normalizeAssetSource(entry?.avatarSource || "");
      if (!source || seen.has(source)) continue;
      seen.add(source);
      out.push(source);
    }

    return out;
  }

  function buildAvatarDebugSnapshot(tab = null) {
    const primaryScope = findPrimaryLogScope(tab);
    const chatScopes = findChatLogScopes(tab)
      .filter((scope) => scope instanceof HTMLElement && isVisible(scope));
    const debugRoot = primaryScope instanceof HTMLElement
      ? primaryScope
      : (chatScopes[0] instanceof HTMLElement ? chatScopes[0] : document.body);
    const messageElements = findLogMessageElements([debugRoot]).slice(0, 8);

    return {
      primaryScope: describeAvatarDebugNode(primaryScope),
      chatScopeCount: chatScopes.length,
      scopeSummaries: chatScopes.slice(0, 4).map((scope) => summarizeAvatarDebugScope(scope)),
      debugRoot: describeAvatarDebugNode(debugRoot),
      debugRootAvatarNodeCount: countVisibleAvatarNodes(debugRoot),
      debugRootAvatarSamples: collectAvatarNodeDebugSamples(debugRoot, 8),
      documentAvatarNodeCount: countVisibleAvatarNodes(document.body),
      documentAvatarSamples: collectAvatarNodeDebugSamples(document.body, 8),
      messageSamples: messageElements.map((element, index) => buildAvatarMessageDebugSample(element, index)).filter(Boolean)
    };
  }

  function summarizeAvatarDebugScope(scope) {
    if (!(scope instanceof HTMLElement)) return null;
    return {
      node: describeAvatarDebugNode(scope),
      textCount: findLogMessageElements([scope]).length,
      itemCount: findLogMessageItemRoots([scope]).length,
      avatarNodeCount: countVisibleAvatarNodes(scope),
      rect: summarizeAvatarDebugRect(scope.getBoundingClientRect())
    };
  }

  function buildAvatarMessageDebugSample(element, index = 0) {
    if (!(element instanceof HTMLElement)) return null;

    const itemRoot = findMessageItemRoot(element);
    const visibleText = normalizeText(
      typeof element.innerText === "string"
        ? element.innerText
        : stripInvisibleEnvelope(element.textContent || "")
    );
    const meta = extractMessageMeta(itemRoot, element, visibleText);
    const searchRoots = getAvatarSearchRoots(itemRoot);
    const directAvatarNode = findDirectAvatarNode(searchRoots, element);
    const nearbyAvatarNode = findNearbyAvatarNode(element);
    const resolvedAvatarSource = extractMessageAvatarSource(itemRoot, element);

    return {
      index: index + 1,
      sender: meta.sender || "",
      text: clipAvatarDebugText(stripInvisibleEnvelope(visibleText || ""), 80),
      resolvedAvatarSource: clipAvatarDebugText(normalizeAssetSource(resolvedAvatarSource || ""), 120),
      directAvatarSource: clipAvatarDebugText(normalizeAssetSource(extractElementImageSource(directAvatarNode) || ""), 120),
      nearbyAvatarSource: clipAvatarDebugText(normalizeAssetSource(extractElementImageSource(nearbyAvatarNode) || ""), 120),
      itemRoot: describeAvatarDebugNode(itemRoot),
      itemChildren: collectAvatarDebugChildSignatures(itemRoot),
      searchRoots: searchRoots.slice(0, 4).map((root) => ({
        node: describeAvatarDebugNode(root),
        avatarNodeCount: countVisibleAvatarNodes(root),
        textCount: root instanceof HTMLElement ? root.querySelectorAll(MESSAGE_TEXT_SELECTOR).length : 0
      })),
      candidateSamples: collectAvatarCandidateDebugSamples(searchRoots, element, itemRoot)
    };
  }

  function collectAvatarCandidateDebugSamples(searchRoots, textElement, itemRoot = null) {
    if (!Array.isArray(searchRoots) || !(textElement instanceof HTMLElement)) return [];

    const textRect = textElement.getBoundingClientRect();
    const candidates = [];
    const seen = new Set();

    searchRoots.forEach((root) => {
      if (!(root instanceof HTMLElement)) return;
      root.querySelectorAll("*").forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (!isVisible(node)) return;
        if (node === textElement || textElement.contains(node)) return;

        const source = normalizeAssetSource(extractElementImageSource(node) || "");
        if (!source) return;

        const rect = node.getBoundingClientRect();
        const key = [
          source,
          Math.round(rect.top || 0),
          Math.round(rect.left || 0)
        ].join("::");
        if (seen.has(key)) return;
        seen.add(key);

        candidates.push({
          source,
          node,
          score: scoreDirectAvatarNodeCandidate(node, textRect, itemRoot, root),
          avatarScore: scoreAvatarCandidate(node),
          sameItemRoot: (findMessageItemRoot(node) || findAvatarMessageItemRoot(node) || null) === itemRoot
        });
      });
    });

    return candidates
      .sort((left, right) => left.score - right.score)
      .slice(0, 5)
      .map((candidate) => ({
        source: clipAvatarDebugText(candidate.source, 120),
        score: Math.round(candidate.score * 100) / 100,
        avatarScore: Math.round(candidate.avatarScore * 100) / 100,
        sameItemRoot: candidate.sameItemRoot,
        node: describeAvatarDebugNode(candidate.node),
        rect: summarizeAvatarDebugRect(candidate.node.getBoundingClientRect())
      }));
  }

  function collectAvatarNodeDebugSamples(root, limit = 8) {
    if (!(root instanceof HTMLElement)) return [];

    const out = [];
    const seen = new Set();
    root.querySelectorAll(AVATAR_NODE_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (!isVisible(node)) return;
      if (out.length >= limit) return;

      const source = normalizeAssetSource(extractElementImageSource(node) || "");
      if (!source) return;

      const rect = node.getBoundingClientRect();
      const key = [
        source,
        Math.round(rect.top || 0),
        Math.round(rect.left || 0)
      ].join("::");
      if (seen.has(key)) return;
      seen.add(key);

      out.push({
        source: clipAvatarDebugText(source, 120),
        node: describeAvatarDebugNode(node),
        itemRoot: describeAvatarDebugNode(findMessageItemRoot(node) || findAvatarMessageItemRoot(node) || null),
        rect: summarizeAvatarDebugRect(rect)
      });
    });

    return out;
  }

  function countVisibleAvatarNodes(root) {
    if (!(root instanceof HTMLElement)) return 0;

    let count = 0;
    root.querySelectorAll(AVATAR_NODE_SELECTOR).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (!isVisible(node)) return;
      if (!normalizeAssetSource(extractElementImageSource(node) || "")) return;
      count += 1;
    });
    return count;
  }

  function collectAvatarDebugChildSignatures(root, limit = 8) {
    if (!(root instanceof HTMLElement)) return [];
    return [...root.children]
      .slice(0, limit)
      .map((child) => describeAvatarDebugNode(child));
  }

  function describeAvatarDebugNode(node) {
    if (!(node instanceof HTMLElement)) return "";

    const parts = [node.tagName.toLowerCase()];
    const className = getAvatarDebugClassName(node);
    const role = normalizeSpace(node.getAttribute("role") || "");
    const dataIndex = normalizeSpace(node.getAttribute("data-index") || "");
    const alt = normalizeSpace(node.getAttribute("alt") || "");

    if (className) parts.push(`.${className}`);
    if (role) parts.push(`[role=${role}]`);
    if (dataIndex) parts.push(`[data-index=${dataIndex}]`);
    if (alt) parts.push(`[alt=${alt}]`);

    return parts.join("");
  }

  function getAvatarDebugClassName(node) {
    if (!(node instanceof HTMLElement)) return "";
    const raw = typeof node.className === "string"
      ? node.className
      : (typeof node.className?.baseVal === "string" ? node.className.baseVal : "");
    return normalizeSpace(raw).split(" ").filter(Boolean).slice(0, 3).join(".");
  }

  function summarizeAvatarDebugRect(rect) {
    if (!rect) return null;
    return {
      top: Math.round(rect.top || 0),
      left: Math.round(rect.left || 0),
      width: Math.round(rect.width || 0),
      height: Math.round(rect.height || 0)
    };
  }

  function clipAvatarDebugText(value, maxLength = 120) {
    const normalized = normalizeSpace(String(value || ""));
    if (!normalized) return "";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
  }

  function mergeUniqueStrings(existing, extras) {
    const out = [];
    const seen = new Set();

    for (const value of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(extras) ? extras : [])]) {
      const normalized = typeof value === "string" ? value : "";
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }

    return out;
  }

  function scoreSenderCandidate(node, text) {
    const className = `${node.className || ""} ${node.getAttribute("aria-label") || ""}`.toLowerCase();
    let score = 0;

    if (/subtitle|primary|author|sender|name|user|character/.test(className)) score += 4;
    if (/caption|time|date|meta/.test(className)) score -= 3;
    if (/^H[1-6]$/.test(node.tagName)) score += 3;
    if (node.tagName === "STRONG" || node.tagName === "B") score += 2;
    if (text.length >= 1 && text.length <= 40) score += 1;
    if (!/\d{1,2}:\d{2}/.test(text)) score += 1;
    return score;
  }

  function looksLikeTimestamp(value) {
    const text = normalizeSpace(value);
    if (!text) return false;
    return /^(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm|오전|오후)?|\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/.test(text);
  }

  function looksLikeTimestamp(value) {
    const text = normalizeSpace(value);
    if (!text) return false;
    return /^(((?:today|yesterday|tomorrow|昨日|今日|明日|오늘|어제|내일)\s+)?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm|오전|오후)?|\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/.test(text);
  }

  function collectAssetSourcesFromHtml(html) {
    if (!html) return [];

    const container = document.createElement("div");
    container.innerHTML = html;

    const seen = new Set();
    const out = [];
    const addSource = (value) => {
      const normalized = normalizeAssetSource(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    const nodes = [container, ...container.querySelectorAll("*")];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;

      if (node instanceof HTMLImageElement) {
        addSource(node.getAttribute("src") || node.src || "");
      }

      const backgroundImage = node.style?.backgroundImage || "";
      extractCssUrls(backgroundImage).forEach(addSource);
    }

    return out;
  }

  async function buildAssetBundle(entries) {
    if (!PACKAGE_INCLUDE_IMAGE_ASSETS && !PACKAGE_INCLUDE_AVATAR_ASSETS) {
      return [];
    }

    const sources = [];
    const seen = new Set();
    const addSource = (value) => {
      const source = normalizeAssetSource(value || "");
      if (!source || seen.has(source)) return;
      seen.add(source);
      sources.push(source);
    };

    for (const entry of entries) {
      if (PACKAGE_INCLUDE_IMAGE_ASSETS) {
        for (const source of entry.assetSources || []) {
          addSource(source);
        }
      } else if (PACKAGE_INCLUDE_AVATAR_ASSETS) {
        addSource(entry?.avatarSource || "");
      }
    }

    const maxAssets = PACKAGE_INCLUDE_IMAGE_ASSETS ? PACKAGE_MAX_ASSETS : PACKAGE_MAX_AVATAR_ASSETS;
    const limitedSources = sources.slice(0, maxAssets);
    const assets = [];
    for (let index = 0; index < limitedSources.length; index += 1) {
      const source = limitedSources[index];
      try {
        assets.push(await resolveAsset(source, index));
      } catch (error) {
        assets.push({
          index: index + 1,
          source,
          fileName: "",
          included: false,
          renderUrl: source,
          mimeType: guessMimeTypeFromUrl(source),
          size: 0,
          error: error?.message || String(error),
          bytes: null
        });
      }

      await waitForAnimationFrame();
    }

    return assets;
  }

  async function resolveAsset(source, index) {
    let bytes = null;
    let mimeType = "";
    let error = "";
    let included = false;

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) {
      const parsed = parseDataUrl(source);
      if (parsed) {
        bytes = parsed.bytes;
        mimeType = parsed.mimeType;
        included = true;
      } else {
        error = "invalid-data-url";
      }
    } else {
      try {
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        bytes = new Uint8Array(await blob.arrayBuffer());
        mimeType = blob.type || guessMimeTypeFromUrl(source);
        included = true;
      } catch (fetchError) {
        error = fetchError?.message || String(fetchError);
      }
    }

    const fileName = included
      ? `images/asset-${String(index + 1).padStart(3, "0")}.${guessFileExtension(mimeType, source)}`
      : "";

    return {
      index: index + 1,
      source,
      fileName,
      included,
      renderUrl: fileName || source,
      mimeType: mimeType || guessMimeTypeFromUrl(source),
      size: bytes?.length || 0,
      error,
      bytes
    };
  }

  function rewriteEntryHtmlForPackage(html, assetMap) {
    const container = document.createElement("div");
    container.className = "ccf-render-root";
    container.innerHTML = html || "";
    rewriteAssetSourcesInTree(container, assetMap);
    trimBoundaryBlankLinesInTree(container);
    return container.innerHTML;
  }

  function trimBoundaryBlankLinesInTree(root) {
    if (!(root instanceof HTMLElement)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current);
      current = walker.nextNode();
    }

    if (!textNodes.length) return;

    const first = textNodes.find((node) => typeof node.textContent === "string" && node.textContent.length);
    const last = [...textNodes].reverse().find((node) => typeof node.textContent === "string" && node.textContent.length);

    if (first) {
      first.textContent = trimLeadingBlankLines(first.textContent);
    }

    if (last) {
      last.textContent = trimTrailingBlankLines(last.textContent);
    }
  }

  function trimLeadingBlankLines(value) {
    return String(value || "").replace(/^(?:[ \t\f\v\u00a0]*\n)+[ \t\f\v\u00a0]*/, "");
  }

  function trimTrailingBlankLines(value) {
    return String(value || "").replace(/[ \t\f\v\u00a0]*(?:\n[ \t\f\v\u00a0]*)+$/, "");
  }

  function rewriteAssetSourcesInTree(root, assetMap) {
    const nodes = [root, ...root.querySelectorAll("*")];
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;

      if (node instanceof HTMLImageElement) {
        const source = normalizeAssetSource(node.getAttribute("src") || node.src || "");
        const mapped = source ? assetMap.get(source) : null;
        if (mapped?.renderUrl) {
          node.setAttribute("src", mapped.renderUrl);
        }
      }

      const backgroundImage = node.style?.backgroundImage || "";
      if (backgroundImage) {
        node.style.backgroundImage = rewriteCssUrls(backgroundImage, assetMap);
      }
    }
  }

  function buildLogJson({ roomTitle, exportedAt, entries, assets, tabs = [] }) {
    const payload = {
      version: PACKAGE_VERSION,
      exportedAt: exportedAt.toISOString(),
      room: {
        title: roomTitle,
        url: location.href,
        path: location.pathname
      },
      tabs: (Array.isArray(tabs) ? tabs : []).map((tab, index) => ({
        id: tab?.id || `tab-${index + 1}`,
        name: resolvePackageTabLabel(tab?.name || "", `\uD0ED ${index + 1}`),
        order: Number.isFinite(tab?.order) ? Number(tab.order) : index + 1,
        messageCount: Number.isFinite(tab?.messageCount) ? Number(tab.messageCount) : 0
      })),
      assets: assets.map((asset) => ({
        index: asset.index,
        source: asset.source,
        fileName: asset.fileName,
        included: asset.included,
        renderUrl: asset.renderUrl,
        mimeType: asset.mimeType,
        size: asset.size,
        error: asset.error || ""
      })),
      messages: entries.map((entry) => ({
        index: entry.index,
        id: entry.id,
        sender: entry.sender,
        avatarSource: entry.avatarSource || "",
        tabId: entry.tabId || "",
        tabName: entry.tabName || "",
        timestamp: entry.timestamp,
        metaTexts: entry.metaTexts,
        channel: entry.channel || "",
        text: entry.text,
        visibleText: entry.visibleText,
        rawText: entry.rawText,
        baseColor: entry.baseColor || "",
        formatEnvelopeVersion: entry.formatEnvelopeVersion,
        formatRuns: entry.formatRuns,
        alignRuns: entry.alignRuns,
        blockStyle: entry.blockStyle,
        assetSources: entry.assetSources,
        html: entry.packageHtml
      }))
    };

    return JSON.stringify(payload, null, 2);
  }

  const PACKAGE_THEME_STORAGE_KEY = "ccf-theme-switcher-settings-v1";
  const PACKAGE_THEME_MODE_DEFAULT = "default";
  const PACKAGE_THEME_MODE_LIGHT = "light";
  const PACKAGE_THEME_MODE_CUSTOM = "custom";
  const PACKAGE_THEME_SAVED_MODE_PREFIX = "saved:";
  const PACKAGE_THEME_DEFAULT_FALLBACK = Object.freeze({
    bg: "#202020",
    appbar: "#212121",
    paper: "#2a2a2a",
    border: "#444444",
    text: "#ffffff",
    inputBg: "#202020"
  });
  const PACKAGE_THEME_LIGHT_PRESET = Object.freeze({
    bg: "#f1f1f1",
    appbar: "#dddddd",
    paper: "#fbfbfb",
    border: "#b9b9b9",
    text: "#2f2f2f",
    inputBg: "#ffffff"
  });
  const PACKAGE_THEME_CUSTOM_FALLBACK = Object.freeze({
    bg: "#151414",
    appbar: "#22201f",
    paper: "#1d1c1e",
    border: "#413d3a",
    text: "#f4f0eb",
    inputBg: "#1a191b"
  });
  const PACKAGE_THEME_FIELD_DEFS = Object.freeze([
    { key: "bg", label: "\uBC30\uACBD" },
    { key: "appbar", label: "\uC0C1\uB2E8 \uBC14" },
    { key: "paper", label: "\uD328\uB110" },
    { key: "border", label: "\uD14C\uB450\uB9AC" },
    { key: "text", label: "\uD14D\uC2A4\uD2B8" }
  ]);

  function getPackageGmOptionModel(entries, currentSenderKey = "") {
    const options = [
      { value: "", label: "\uC120\uD0DD \uC548 \uD568" },
      ...buildPackageSenderOptions(entries)
    ];
    const selectedSenderKey = options.some((option) => option.value === currentSenderKey)
      ? currentSenderKey
      : "";

    return {
      selectedSenderKey,
      options
    };
  }

  function buildPackageSenderOptions(entries) {
    const seen = new Set();
    const out = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
      const sender = normalizeSpace(entry?.sender || "");
      const senderKey = normalizeSenderKey(sender);
      if (!sender || !senderKey || seen.has(senderKey)) continue;
      seen.add(senderKey);
      out.push({
        value: senderKey,
        label: sender
      });
    }

    return out;
  }

  function getPackageThemeDefinition() {
    const context = readActivePackageThemeContext() || readStoredPackageThemeContext();
    return buildPackageThemeDefinition(context);
  }

  function readActivePackageThemeContext() {
    const root = document.documentElement;
    if (!(root instanceof HTMLElement)) return null;

    const styles = getComputedStyle(root);
    const rawTheme = {
      bg: styles.getPropertyValue("--ccf-theme-bg"),
      appbar: styles.getPropertyValue("--ccf-theme-appbar"),
      paper: styles.getPropertyValue("--ccf-theme-paper"),
      border: styles.getPropertyValue("--ccf-theme-border"),
      text: styles.getPropertyValue("--ccf-theme-text"),
      inputBg: styles.getPropertyValue("--ccf-theme-input-bg")
    };
    const hasLiveTheme = Object.values(rawTheme)
      .map((value) => normalizeCssColor(value))
      .filter(Boolean)
      .length >= 4;
    if (!hasLiveTheme) return null;

    return {
      mode: normalizePackageThemeMode(root.getAttribute("data-ccf-theme-mode") || ""),
      theme: normalizePackageThemePalette(rawTheme, PACKAGE_THEME_DEFAULT_FALLBACK)
    };
  }

  function readStoredPackageThemeContext() {
    const state = readStoredPackageThemeState();

    return {
      mode: state.mode,
      theme: resolvePackageThemePaletteForMode(state.mode, state),
      savedThemes: state.savedThemes
    };
  }

  function readStoredPackageThemeState() {
    let raw = null;
    try {
      raw = JSON.parse(window.localStorage.getItem(PACKAGE_THEME_STORAGE_KEY) || "null");
    } catch (error) {
      raw = null;
    }

    const savedThemes = normalizePackageSavedThemes(raw?.savedThemes);
    return {
      hasThemeSwitcher: !!(raw && typeof raw === "object"),
      mode: normalizePackageThemeMode(raw?.mode, savedThemes),
      defaultTheme: normalizeOptionalPackageThemePalette(raw?.defaultTheme),
      customTheme: normalizePackageThemePalette(
        raw?.customTheme || raw?.theme || null,
        PACKAGE_THEME_CUSTOM_FALLBACK
      ),
      savedThemes
    };
  }

  function normalizePackageSavedThemes(value) {
    if (!Array.isArray(value)) return [];

    return value
      .map((item) => {
        const id = normalizeSpace(item?.id || "");
        if (!id) return null;
        return {
          id,
          name: normalizeSpace(item?.name || ""),
          theme: normalizePackageThemePalette(item?.theme || null, PACKAGE_THEME_CUSTOM_FALLBACK)
        };
      })
      .filter(Boolean);
  }

  function normalizePackageThemeMode(value, savedThemes = []) {
    if (isPackageSavedThemeMode(value) && savedThemes.some((item) => makePackageSavedThemeMode(item.id) === value)) {
      return value;
    }

    return [
      PACKAGE_THEME_MODE_DEFAULT,
      PACKAGE_THEME_MODE_LIGHT,
      PACKAGE_THEME_MODE_CUSTOM
    ].includes(value) ? value : PACKAGE_THEME_MODE_DEFAULT;
  }

  function isPackageSavedThemeMode(value) {
    return typeof value === "string" && value.startsWith(PACKAGE_THEME_SAVED_MODE_PREFIX);
  }

  function makePackageSavedThemeMode(id) {
    return `${PACKAGE_THEME_SAVED_MODE_PREFIX}${id}`;
  }

  function normalizeOptionalPackageThemePalette(value) {
    if (!value || typeof value !== "object") return null;
    const normalized = normalizePackageThemePalette(value, PACKAGE_THEME_DEFAULT_FALLBACK);
    return Object.values(normalized).some(Boolean) ? normalized : null;
  }

  function normalizePackageThemePalette(value, fallback = PACKAGE_THEME_DEFAULT_FALLBACK) {
    const base = fallback || PACKAGE_THEME_DEFAULT_FALLBACK;
    return {
      bg: normalizeCssColor(value?.bg) || base.bg,
      appbar: normalizeCssColor(value?.appbar) || base.appbar,
      paper: normalizeCssColor(value?.paper) || base.paper,
      border: normalizeCssColor(value?.border) || base.border,
      text: normalizeCssColor(value?.text) || base.text,
      inputBg: normalizeCssColor(value?.inputBg) || base.inputBg
    };
  }

  function resolvePackageThemePaletteForMode(mode, state = readStoredPackageThemeState()) {
    const savedTheme = state.savedThemes.find((item) => makePackageSavedThemeMode(item.id) === mode) || null;
    if (savedTheme?.theme) {
      return normalizePackageThemePalette(savedTheme.theme, PACKAGE_THEME_CUSTOM_FALLBACK);
    }
    if (mode === PACKAGE_THEME_MODE_LIGHT) {
      return normalizePackageThemePalette(PACKAGE_THEME_LIGHT_PRESET, PACKAGE_THEME_LIGHT_PRESET);
    }
    if (mode === PACKAGE_THEME_MODE_CUSTOM) {
      return normalizePackageThemePalette(state.customTheme, PACKAGE_THEME_CUSTOM_FALLBACK);
    }
    return normalizePackageThemePalette(state.defaultTheme, PACKAGE_THEME_DEFAULT_FALLBACK);
  }

  function getPackageThemeOptionModel(currentMode = "") {
    const state = readStoredPackageThemeState();
    const hasThemeSwitcher = state.hasThemeSwitcher;
    const options = [
      {
        value: PACKAGE_THEME_MODE_DEFAULT,
        label: hasThemeSwitcher ? "\uAE30\uBCF8" : "\uB2E4\uD06C \uBAA8\uB4DC"
      },
      {
        value: PACKAGE_THEME_MODE_LIGHT,
        label: hasThemeSwitcher ? "\uB77C\uC774\uD2B8" : "\uB77C\uC774\uD2B8 \uBAA8\uB4DC"
      },
      {
        value: PACKAGE_THEME_MODE_CUSTOM,
        label: hasThemeSwitcher ? "\uCEE4\uC2A4\uD140" : "\uCEE4\uC2A4\uD140 \uBAA8\uB4DC"
      },
      ...(
        hasThemeSwitcher
          ? state.savedThemes.map((item) => ({
            value: makePackageSavedThemeMode(item.id),
            label: item.name || "\uC800\uC7A5 \uD14C\uB9C8"
          }))
          : []
      )
    ];

    const selectedMode = options.some((option) => option.value === currentMode)
      ? currentMode
      : (options.some((option) => option.value === state.mode) ? state.mode : options[0]?.value || PACKAGE_THEME_MODE_DEFAULT);

    const definitions = options.reduce((out, option) => {
      out[option.value] = buildPackageThemeDefinition({
        mode: option.value,
        theme: resolvePackageThemePaletteForMode(option.value, state),
        savedThemes: state.savedThemes
      });
      return out;
    }, {});

    return {
      selectedMode,
      options,
      definitions
    };
  }

  function buildPackageThemeDefinition(context = {}) {
    const theme = normalizePackageThemePalette(context.theme || null, PACKAGE_THEME_DEFAULT_FALLBACK);
    const isLight = getPackageColorLuminance(theme.bg) >= 0.62;
    const accent = mixPackageColors(theme.text, theme.appbar, isLight ? 0.38 : 0.22);
    const accentContrast = pickPackageReadableText(accent);
    const accentBorder = mixPackageColors(accent, theme.border, 0.34);
    const chipBg = mixPackageColors(theme.appbar, theme.paper, 0.58);
    const chipBorder = mixPackageColors(theme.border, theme.paper, 0.72);
    const codeBg = mixPackageColors(theme.appbar, theme.inputBg, 0.62);
    const codeBorder = mixPackageColors(theme.border, theme.paper, 0.8);
    const shadowColor = withPackageColorAlpha("#000000", isLight ? 0.12 : 0.26);
    const buttonShadow = withPackageColorAlpha("#000000", isLight ? 0.12 : 0.22);

    return {
      mode: isPackageSavedThemeMode(context.mode)
        ? String(context.mode)
        : normalizePackageThemeMode(context.mode || "", normalizePackageSavedThemes(context.savedThemes)),
      palette: theme,
      colorScheme: isLight ? "light" : "dark",
      vars: {
        "--page-bg": theme.bg,
        "--panel-bg": theme.paper,
        "--panel-border": theme.border,
        "--panel-shadow": `0 18px 48px ${shadowColor}`,
        "--text-main": theme.text,
        "--text-subtle": mixPackageColors(theme.text, theme.bg, 0.58),
        "--accent": accent,
        "--accent-contrast": accentContrast,
        "--accent-border": accentBorder,
        "--accent-shadow": `0 4px 12px ${buttonShadow}`,
        "--chip-bg": chipBg,
        "--chip-border": chipBorder,
        "--chip-text": theme.text,
        "--code-bg": codeBg,
        "--code-border": codeBorder,
        "--code-text": pickPackageReadableText(codeBg),
        "--helper-bg": mixPackageColors(theme.paper, theme.bg, 0.22)
      }
    };
  }

  function buildPackageThemeCssText(themeDefinition) {
    if (!themeDefinition?.vars) return "";
    return Object.entries(themeDefinition.vars)
      .map(([key, value]) => `${key}: ${value};`)
      .join("\n      ");
  }

  function applyPackageThemeVariables(target, themeDefinition) {
    if (!(target instanceof HTMLElement) || !themeDefinition?.vars) return;
    Object.entries(themeDefinition.vars).forEach(([key, value]) => {
      target.style.setProperty(key, value);
    });
  }

  function parsePackageColorChannels(value) {
    const normalized = normalizeCssColor(value);
    if (!normalized) return null;

    const match = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) return null;

    const parts = match[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;
    return {
      r: clamp(Number(parts[0]), 0, 255),
      g: clamp(Number(parts[1]), 0, 255),
      b: clamp(Number(parts[2]), 0, 255),
      a: parts.length >= 4 ? clamp(Number(parts[3]), 0, 1) : 1
    };
  }

  function mixPackageColors(primary, secondary, amount = 0.5) {
    const left = parsePackageColorChannels(primary);
    const right = parsePackageColorChannels(secondary);
    if (!left && !right) return normalizeCssColor(primary) || normalizeCssColor(secondary) || String(primary || secondary || "");
    if (!left) return normalizeCssColor(secondary) || String(secondary || "");
    if (!right) return normalizeCssColor(primary) || String(primary || "");

    const ratio = clamp(Number(amount), 0, 1);
    const inverse = 1 - ratio;
    const red = Math.round((left.r * ratio) + (right.r * inverse));
    const green = Math.round((left.g * ratio) + (right.g * inverse));
    const blue = Math.round((left.b * ratio) + (right.b * inverse));
    const alpha = (left.a * ratio) + (right.a * inverse);
    return alpha >= 0.999
      ? `rgb(${red}, ${green}, ${blue})`
      : `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "")})`;
  }

  function withPackageColorAlpha(value, alpha = 1) {
    const channels = parsePackageColorChannels(value);
    if (!channels) return String(value || "");
    const nextAlpha = clamp(Number(alpha), 0, 1);
    if (nextAlpha >= 0.999) {
      return `rgb(${channels.r}, ${channels.g}, ${channels.b})`;
    }
    return `rgba(${channels.r}, ${channels.g}, ${channels.b}, ${nextAlpha.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "")})`;
  }

  function getPackageColorLuminance(value) {
    const channels = parsePackageColorChannels(value);
    if (!channels) return 0;
    return ((0.2126 * channels.r) + (0.7152 * channels.g) + (0.0722 * channels.b)) / 255;
  }

  function pickPackageReadableText(background) {
    return getPackageColorLuminance(background) >= 0.56 ? "#202020" : "#ffffff";
  }

  function buildPackageTabGroups(entries, tabs = []) {
    const groups = [];
    const groupMap = new Map();

    const ensureGroup = (tabId, tabName) => {
      const nextId = normalizeSpace(tabId || "") || `tab-${groups.length + 1}`;
      if (groupMap.has(nextId)) return groupMap.get(nextId);

      const group = {
        id: nextId,
        name: resolvePackageTabLabel(tabName || "", `\uD0ED ${groups.length + 1}`),
        entries: []
      };
      groupMap.set(nextId, group);
      groups.push(group);
      return group;
    };

    (Array.isArray(tabs) ? tabs : []).forEach((tab, index) => {
      ensureGroup(tab?.id || `tab-${index + 1}`, tab?.name || `\uD0ED ${index + 1}`);
    });

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const group = ensureGroup(entry.tabId || "", entry.tabName || "");
      group.entries.push(entry);
    });

    if (!groups.length) {
      groups.push({
        id: "tab-1",
        name: "\uD604\uC7AC \uD0ED",
        entries: Array.isArray(entries) ? entries.filter(Boolean) : []
      });
    }

    return groups;
  }

  function getPackageTabAnchorId(tabGroup, index = 0) {
    const id = normalizeSpace(tabGroup?.id || "") || `tab-${index + 1}`;
    return `ccf-tab-section-${id}`;
  }

  function createPackageEntryArticle(entry, packageAssetMap) {
    const article = document.createElement("article");
    article.className = "ccf-log-entry";
    article.setAttribute("data-ccf-sender-key", normalizeSenderKey(entry.sender || ""));
    article.setAttribute("data-ccf-gm-entry", "0");

    const avatarUrl = resolvePackageRenderableImageUrl(entry.avatarSource, packageAssetMap);
    const mainRow = document.createElement("div");
    mainRow.className = "ccf-log-entry-main";

    if (avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "ccf-log-entry-avatar";
      avatar.src = avatarUrl;
      avatar.alt = entry.sender ? `${entry.sender} avatar` : "avatar";
      avatar.loading = "eager";
      avatar.decoding = "sync";
      mainRow.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "ccf-log-entry-content";

    const meta = document.createElement("div");
    meta.className = "ccf-log-entry-header";

    const metaMain = document.createElement("div");
    metaMain.className = "ccf-log-entry-meta-main";

    const metaAux = document.createElement("div");
    metaAux.className = "ccf-log-entry-meta-aux";

    if (entry.sender) {
      const sender = document.createElement("span");
      sender.className = "ccf-log-entry-sender";
      sender.textContent = entry.sender;
      if (entry.baseColor) {
        sender.style.color = entry.baseColor;
      }
      metaMain.appendChild(sender);
    }

    if (entry.timestamp) {
      const timestamp = document.createElement("span");
      timestamp.className = "ccf-log-entry-timestamp";
      timestamp.textContent = entry.timestamp;
      metaMain.appendChild(timestamp);
    }

    if (Number.isFinite(entry.index)) {
      const indexTag = document.createElement("span");
      indexTag.className = "ccf-log-entry-index";
      indexTag.textContent = `#${String(entry.index).padStart(3, "0")}`;
      metaAux.appendChild(indexTag);
    }

    if (entry.channel) {
      const channel = document.createElement("span");
      channel.className = "ccf-log-entry-channel";
      channel.textContent = entry.channel;
      metaAux.appendChild(channel);
    }

    if (metaMain.childNodes.length) {
      meta.appendChild(metaMain);
    }
    if (metaAux.childNodes.length) {
      meta.appendChild(metaAux);
    }
    if (meta.childNodes.length) {
      content.appendChild(meta);
    }

    const body = document.createElement("div");
    body.className = "ccf-log-entry-body ccf-render-root";
    if (entry.packageHtml) {
      body.innerHTML = entry.packageHtml;
    } else {
      body.textContent = trimTrailingBlankLines(trimLeadingBlankLines(entry.text || entry.visibleText || ""));
    }

    content.appendChild(body);
    mainRow.appendChild(content);
    article.appendChild(mainRow);
    return article;
  }

  function buildPackageTabPanelHtml(tabGroup, tabIndex, packageAssetMap) {
    const panel = document.createElement("section");
    panel.className = "ccf-log-entry-list ccf-log-preview-tab-panel";
    panel.setAttribute("data-ccf-tab-panel", getPackageTabAnchorId(tabGroup, tabIndex));

    const groupHeader = document.createElement("div");
    groupHeader.className = "ccf-log-tab-group-header";
    groupHeader.id = getPackageTabAnchorId(tabGroup, tabIndex);

    const groupTitle = document.createElement("h2");
    groupTitle.className = "ccf-log-tab-group-title";
    groupTitle.textContent = tabGroup.name;
    groupHeader.appendChild(groupTitle);
    panel.appendChild(groupHeader);

    if (!tabGroup.entries.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "ccf-log-tab-group-empty";
      emptyState.textContent = "\uC774 \uD0ED\uC5D0\uB294 \uB0B4\uBCF4\uB0BC \uBA54\uC2DC\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
      panel.appendChild(emptyState);
      return panel.outerHTML;
    }

    tabGroup.entries.forEach((entry) => {
      panel.appendChild(createPackageEntryArticle(entry, packageAssetMap));
    });

    return panel.outerHTML;
  }

  function buildIndexHtml({
    roomTitle,
    exportedAt,
    entries,
    assets,
    tistoryContentHtml = "",
    themeDefinition = null,
    themeOptionModel = null,
    tistoryContentHtmlByMode = null,
    tabs = []
  }) {
    const fallbackTheme = themeDefinition || getPackageThemeDefinition();
    const themeModel = themeOptionModel || getPackageThemeOptionModel(fallbackTheme.mode);
    const gmModel = getPackageGmOptionModel(entries);
    const tabGroups = buildPackageTabGroups(entries, tabs);
    const showTabGroups = tabGroups.length > 1;
    const theme = themeModel.definitions[themeModel.selectedMode] || fallbackTheme;
    const themeCssText = buildPackageThemeCssText(theme);
    const packageAssetMap = buildPackageAssetMap(assets);
    const previewTabs = tabGroups.map((tabGroup, index) => ({
      id: getPackageTabAnchorId(tabGroup, index),
      name: tabGroup.name,
      html: buildPackageTabPanelHtml(tabGroup, index, packageAssetMap)
    }));
    const tistoryHtmlMap = tistoryContentHtmlByMode && typeof tistoryContentHtmlByMode === "object"
      ? tistoryContentHtmlByMode
      : { [themeModel.selectedMode]: tistoryContentHtml || "" };
    const serializedThemeDefinitions = JSON.stringify(
      Object.entries(themeModel.definitions).reduce((out, [mode, definition]) => {
        out[mode] = {
          colorScheme: definition.colorScheme,
          vars: definition.vars,
          palette: definition.palette
        };
        return out;
      }, {})
    ).replace(/</g, "\\u003c");
    const serializedTistoryHtmlMap = JSON.stringify(tistoryHtmlMap).replace(/</g, "\\u003c");
    const serializedThemeFieldDefs = JSON.stringify(PACKAGE_THEME_FIELD_DEFS).replace(/</g, "\\u003c");
    const serializedCustomFallbackPalette = JSON.stringify(PACKAGE_THEME_CUSTOM_FALLBACK).replace(/</g, "\\u003c");
    const serializedInitialGmSenderKey = JSON.stringify(gmModel.selectedSenderKey).replace(/</g, "\\u003c");
    const serializedPreviewTabs = JSON.stringify(previewTabs).replace(/</g, "\\u003c");
    const main = document.createElement("main");
    main.className = "ccf-log-package-page";

    const header = document.createElement("header");
    header.className = "ccf-log-package-header";

    const title = document.createElement("h1");
    title.textContent = roomTitle;
    header.appendChild(title);

    const summary = document.createElement("p");
    summary.className = "ccf-log-package-summary";
    summary.textContent = `메시지 ${entries.length}개 · 이미지 자산 ${assets.filter((asset) => asset.included).length}개 · 내보낸 시각 ${formatDisplayDate(exportedAt)}`;
    if (showTabGroups) {
      const tabNav = document.createElement("nav");
      tabNav.className = "ccf-log-package-tab-nav";
      tabNav.setAttribute("aria-label", "\uB0B4\uBCF4\uB0B8 \uD0ED \uBAA9\uB85D");
      tabNav.setAttribute("role", "tablist");
      previewTabs.forEach((tab) => {
        const button = document.createElement("button");
        button.className = "ccf-log-package-tab-link";
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.setAttribute("aria-controls", "ccf-log-preview-panel");
        button.setAttribute("data-ccf-preview-tab", tab.id);
        button.textContent = tab.name;
        tabNav.appendChild(button);
      });
      header.appendChild(tabNav);
    }

    const actions = document.createElement("div");
    actions.className = "ccf-log-package-actions";

    const themeField = document.createElement("label");
    themeField.className = "ccf-log-package-theme-field";
    themeField.setAttribute("for", "ccf-theme-mode");

    const themeLabel = document.createElement("span");
    themeLabel.className = "ccf-log-package-theme-label";
    themeLabel.textContent = "\uD14C\uB9C8";
    themeField.appendChild(themeLabel);

    const themeSelect = document.createElement("select");
    themeSelect.className = "ccf-log-package-theme-select";
    themeSelect.id = "ccf-theme-mode";
    themeModel.options.forEach((optionDef) => {
      const option = document.createElement("option");
      option.value = optionDef.value;
      option.textContent = optionDef.label;
      if (optionDef.value === themeModel.selectedMode) {
        option.selected = true;
      }
      themeSelect.appendChild(option);
    });
    themeField.appendChild(themeSelect);
    actions.appendChild(themeField);

    const gmField = document.createElement("label");
    gmField.className = "ccf-log-package-theme-field";
    gmField.setAttribute("for", "ccf-gm-sender");

    const gmLabel = document.createElement("span");
    gmLabel.className = "ccf-log-package-theme-label";
    gmLabel.textContent = "GM";
    gmField.appendChild(gmLabel);

    const gmSelect = document.createElement("select");
    gmSelect.className = "ccf-log-package-theme-select";
    gmSelect.id = "ccf-gm-sender";
    gmSelect.disabled = gmModel.options.length <= 1;
    gmModel.options.forEach((optionDef) => {
      const option = document.createElement("option");
      option.value = optionDef.value;
      option.textContent = optionDef.label;
      if (optionDef.value === gmModel.selectedSenderKey) {
        option.selected = true;
      }
      gmSelect.appendChild(option);
    });
    gmField.appendChild(gmSelect);
    actions.appendChild(gmField);

    const copyButton = document.createElement("button");
    copyButton.className = "ccf-log-package-copy-btn";
    copyButton.type = "button";
    copyButton.id = "ccf-tistory-copy-btn";
    copyButton.textContent = "티스토리 HTML 복사";
    copyButton.textContent = "티스토리 HTML 복사";
    copyButton.textContent = "\uD2F0\uC2A4\uD1A0\uB9AC HTML \uBCF5\uC0AC";
    actions.appendChild(copyButton);

    const copyHint = document.createElement("p");
    copyHint.className = "ccf-log-package-copy-hint";
    copyHint.id = "ccf-tistory-copy-status";
    copyHint.textContent = "선택한 테마 기준으로 티스토리 HTML 복사용 본문이 갱신됩니다.";
    copyHint.textContent = "버튼을 누르면 티스토리 HTML 모드에 붙여넣을 본문 HTML이 복사됩니다.";
    copyHint.textContent = "\uC120\uD0DD\uD55C \uD14C\uB9C8 \uAE30\uC900\uC73C\uB85C \uD2F0\uC2A4\uD1A0\uB9AC HTML \uBCF5\uC0AC\uC6A9 \uBCF8\uBB38\uC774 \uAC31\uC2E0\uB429\uB2C8\uB2E4.";
    copyHint.textContent = "\uC120\uD0DD\uD55C \uD14C\uB9C8\uC640 GM \uAE30\uC900\uC73C\uB85C \uD2F0\uC2A4\uD1A0\uB9AC HTML \uBCF5\uC0AC\uC6A9 \uBCF8\uBB38\uC774 \uAC31\uC2E0\uB429\uB2C8\uB2E4.";
    actions.appendChild(copyHint);

    const customPanel = document.createElement("section");
    customPanel.className = "ccf-log-package-custom-theme";
    customPanel.id = "ccf-theme-custom-panel";
    customPanel.hidden = themeModel.selectedMode !== PACKAGE_THEME_MODE_CUSTOM;

    const customTitle = document.createElement("h2");
    customTitle.className = "ccf-log-package-custom-theme-title";
    customTitle.textContent = "\uCEE4\uC2A4\uD140 \uD14C\uB9C8 \uC0C9\uC0C1";
    customPanel.appendChild(customTitle);

    const customHint = document.createElement("p");
    customHint.className = "ccf-log-package-custom-theme-hint";
    customHint.textContent = "\uAC01 \uD56D\uBAA9 \uC0C9\uC0C1\uC744 \uBC14\uAFB8\uBA74 \uBBF8\uB9AC\uBCF4\uAE30\uC640 \uD2F0\uC2A4\uD1A0\uB9AC \uBCF5\uC0AC\uC6A9 HTML\uC5D0 \uBC14\uB85C \uBC18\uC601\uB429\uB2C8\uB2E4.";
    customPanel.appendChild(customHint);

    const customGrid = document.createElement("div");
    customGrid.className = "ccf-log-package-custom-theme-grid";

    PACKAGE_THEME_FIELD_DEFS.forEach((fieldDef) => {
      const item = document.createElement("label");
      item.className = "ccf-log-package-custom-theme-item";

      const itemLabel = document.createElement("span");
      itemLabel.className = "ccf-log-package-custom-theme-item-label";
      itemLabel.textContent = fieldDef.label;
      item.appendChild(itemLabel);

      const controls = document.createElement("div");
      controls.className = "ccf-log-package-custom-theme-controls";

      const colorInput = document.createElement("input");
      colorInput.className = "ccf-log-package-custom-theme-color";
      colorInput.type = "color";
      colorInput.id = `ccf-theme-custom-${fieldDef.key}`;
      colorInput.setAttribute("data-theme-key", fieldDef.key);
      controls.appendChild(colorInput);

      const codeInput = document.createElement("input");
      codeInput.className = "ccf-log-package-custom-theme-code";
      codeInput.type = "text";
      codeInput.inputMode = "text";
      codeInput.autocomplete = "off";
      codeInput.spellcheck = false;
      codeInput.id = `ccf-theme-custom-${fieldDef.key}-text`;
      codeInput.setAttribute("data-theme-key-text", fieldDef.key);
      controls.appendChild(codeInput);

      item.appendChild(controls);
      customGrid.appendChild(item);
    });

    customPanel.appendChild(customGrid);

    header.appendChild(actions);
    header.appendChild(customPanel);
    main.appendChild(header);

    if (showTabGroups) {
      const previewSection = document.createElement("section");
      previewSection.className = "ccf-log-package-preview";

      const previewPanel = document.createElement("div");
      previewPanel.className = "ccf-log-package-preview-panel";
      previewPanel.id = "ccf-log-preview-panel";
      previewPanel.setAttribute("role", "tabpanel");
      previewPanel.setAttribute("aria-live", "polite");
      previewPanel.setAttribute("aria-busy", "false");

      const previewState = document.createElement("p");
      previewState.className = "ccf-log-preview-state";
      previewState.textContent = "\uD0ED\uC744 \uC120\uD0DD\uD558\uBA74 \uD574\uB2F9 \uB85C\uADF8 \uBBF8\uB9AC\uBCF4\uAE30\uAC00 \uC544\uB798\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4.";
      previewPanel.appendChild(previewState);
      previewSection.appendChild(previewPanel);
      main.appendChild(previewSection);
    } else {
      const list = document.createElement("section");
      list.className = "ccf-log-entry-list";
      entries.forEach((entry) => {
        list.appendChild(createPackageEntryArticle(entry, packageAssetMap));
      });
      main.appendChild(list);
    }

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(roomTitle)} - CCF Log Package</title>
  <style>
    :root {
      color-scheme: ${theme.colorScheme};
      ${themeCssText}
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--page-bg);
      color: var(--text-main);
      font-family: "Segoe UI", "Noto Sans KR", sans-serif;
      line-height: 1.6;
    }

    body {
      padding: 28px 18px 56px;
    }

    .ccf-log-package-page {
      max-width: 1080px;
      margin: 0 auto;
    }

    .ccf-log-package-header {
      margin-bottom: 18px;
    }

    .ccf-log-package-header h1 {
      margin: 0;
      font-size: clamp(24px, 3vw, 36px);
      line-height: 1.15;
    }

    .ccf-log-package-tab-nav {
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .ccf-log-package-tab-link {
      appearance: none;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--chip-border);
      background: var(--chip-bg);
      color: var(--chip-text);
      padding: 6px 12px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
      cursor: pointer;
    }

    .ccf-log-package-tab-link:hover {
      border-color: var(--accent-border);
      color: var(--text-main);
    }

    .ccf-log-package-tab-link:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px ${withPackageColorAlpha(theme.vars["--accent"] || "#000000", 0.16)};
    }

    .ccf-log-package-tab-link.is-active,
    .ccf-log-package-tab-link[aria-selected="true"] {
      border-color: var(--accent-border);
      background: var(--accent);
      color: var(--accent-contrast);
      box-shadow: var(--accent-shadow);
    }

    .ccf-log-package-actions {
      margin-top: 14px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }

    .ccf-log-package-theme-field {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .ccf-log-package-theme-label {
      color: var(--text-subtle);
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }

    .ccf-log-package-theme-select {
      min-width: 160px;
      border: 1px solid var(--panel-border);
      border-radius: 0;
      background: var(--panel-bg);
      color: var(--text-main);
      padding: 8px 14px;
      font: inherit;
      font-size: 13px;
      line-height: 1.3;
      outline: none;
      cursor: pointer;
    }

    .ccf-log-package-theme-select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px ${withPackageColorAlpha(theme.vars["--accent"] || "#000000", 0.16)};
    }

    .ccf-log-package-custom-theme {
      margin-top: 14px;
      padding: 14px 16px;
      border: 1px solid var(--panel-border);
      border-radius: 0;
      background: var(--helper-bg);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .ccf-log-package-custom-theme[hidden] {
      display: none;
    }

    .ccf-log-package-custom-theme-title {
      margin: 0;
      font-size: 15px;
      line-height: 1.3;
      color: var(--text-main);
    }

    .ccf-log-package-custom-theme-hint {
      margin: 6px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-subtle);
    }

    .ccf-log-package-custom-theme-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .ccf-log-package-custom-theme-item {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .ccf-log-package-custom-theme-item-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-subtle);
    }

    .ccf-log-package-custom-theme-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .ccf-log-package-custom-theme-color {
      flex: 0 0 44px;
      width: 44px;
      height: 36px;
      padding: 0;
      border: 1px solid var(--panel-border);
      border-radius: 0;
      background: var(--panel-bg);
      cursor: pointer;
    }

    .ccf-log-package-custom-theme-code {
      flex: 1 1 auto;
      min-width: 0;
      border: 1px solid var(--panel-border);
      border-radius: 0;
      background: var(--panel-bg);
      color: var(--text-main);
      padding: 9px 12px;
      font: inherit;
      font-size: 13px;
      line-height: 1.2;
      outline: none;
    }

    .ccf-log-package-custom-theme-code:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px ${withPackageColorAlpha(theme.vars["--accent"] || "#000000", 0.16)};
    }

    .ccf-log-package-copy-btn {
      appearance: none;
      border: 1px solid var(--accent-border);
      border-radius: 0;
      padding: 10px 16px;
      background: var(--accent);
      color: #151414;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
      text-shadow: none;
      cursor: pointer;
      box-shadow: var(--accent-shadow);
    }

    .ccf-log-package-copy-btn:hover {
      filter: brightness(1.04);
    }

    .ccf-log-package-copy-hint {
      margin: 0;
      color: var(--text-subtle);
      font-size: 13px;
    }

    .ccf-log-entry-list {
      display: grid;
      gap: 14px;
    }

    .ccf-log-package-preview {
      margin-top: 18px;
    }

    .ccf-log-package-preview-panel {
      min-height: 68px;
    }

    .ccf-log-preview-state {
      margin: 0;
      padding: 14px 16px;
      border: 1px dashed var(--panel-border);
      background: var(--helper-bg);
      color: var(--text-subtle);
      font-size: 13px;
    }

    .ccf-log-tab-group-header {
      padding: 12px 14px;
      border: 1px solid var(--panel-border);
      background: var(--helper-bg);
    }

    .ccf-log-tab-group-title {
      margin: 0;
      font-size: 18px;
      line-height: 1.35;
    }

    .ccf-log-tab-group-empty {
      margin: 0;
      padding: 14px 16px;
      border: 1px dashed var(--panel-border);
      background: var(--helper-bg);
      color: var(--text-subtle);
      font-size: 13px;
    }

    .ccf-log-entry {
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 0;
      box-shadow: var(--panel-shadow);
      padding: 16px 18px;
    }

    .ccf-log-entry-main {
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .ccf-log-entry-content {
      min-width: 0;
      flex: 1 1 auto;
    }

    .ccf-log-entry-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 2px;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-subtle);
    }

    .ccf-log-entry-meta-main {
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 6px;
      flex: 1 1 auto;
    }

    .ccf-log-entry-avatar {
      width: 40px;
      min-width: 40px;
      max-width: 40px;
      height: 40px;
      min-height: 40px;
      max-height: 40px;
      flex: 0 0 40px;
      flex-shrink: 0;
      align-self: flex-start;
      display: block;
      object-fit: cover;
      border-radius: 0;
      background: var(--helper-bg);
      border: 1px solid var(--panel-border);
    }

    .ccf-log-entry-meta-aux {
      display: inline-flex;
      align-items: baseline;
      justify-content: flex-end;
      gap: 6px;
      margin-left: auto;
      flex: 0 0 auto;
    }

    .ccf-log-entry-index {
      color: var(--accent);
      font-weight: 700;
    }

    .ccf-log-entry-channel {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border: 1px solid var(--chip-border);
      border-radius: 0;
      background: var(--chip-bg);
      color: var(--chip-text);
      font-weight: 700;
    }

    .ccf-log-entry-sender {
      font-size: 14px;
      font-weight: 700;
      line-height: 1.4;
      color: var(--text-main);
    }

    .ccf-log-entry-timestamp {
      line-height: 1.4;
    }

    .ccf-log-entry-body {
      margin: 0;
      padding: 0;
      font-size: 14px;
      line-height: 1.6;
    }

    .ccf-log-entry[data-ccf-gm-entry="1"] .ccf-log-entry-body {
      text-align: center;
    }

    .ccf-log-entry-body > * {
      margin-top: 0;
      margin-bottom: 0;
    }

    .ccf-log-entry-body p {
      margin: 0;
    }

    .ccf-render-root {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .ccf-render-root .ccf-frag {
      white-space: pre-wrap;
    }

    .ccf-render-root .ccf-line {
      display: block;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .ccf-render-root .ccf-ruby-frag {
      position: relative;
      display: inline-block;
      vertical-align: baseline;
      white-space: pre-wrap;
      overflow: visible;
    }

    .ccf-render-root .ccf-ruby-frag::before {
      content: attr(data-ruby);
      position: absolute;
      bottom: calc(100% - 0.08em);
      left: 50%;
      transform: translateX(-50%);
      font-size: 0.62em;
      line-height: 1;
      white-space: nowrap;
      color: currentColor;
      pointer-events: none;
    }

    .ccf-render-root .ccf-tooltip-frag {
      position: relative;
      display: inline-block;
      vertical-align: baseline;
      white-space: pre-wrap;
      overflow: visible;
      cursor: help;
      border-bottom: 1px dashed currentColor;
      padding-bottom: 0.02em;
    }

    .ccf-render-root .ccf-tooltip-frag::before,
    .ccf-render-root .ccf-tooltip-frag::after {
      position: absolute;
      left: calc(100% + 6px);
      opacity: 0;
      visibility: hidden;
      transition: opacity 120ms ease;
      pointer-events: none;
      z-index: 2;
    }

    .ccf-render-root .ccf-tooltip-frag::before {
      content: "";
      left: calc(100% + 12px);
      bottom: calc(100% + 2px);
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid var(--code-bg);
    }

    .ccf-render-root .ccf-tooltip-frag::after {
      content: attr(data-tooltip);
      bottom: calc(100% + 8px);
      min-width: 40px;
      max-width: min(320px, calc(100vw - 32px));
      padding: 7px 10px;
      border-radius: 0;
      background: var(--code-bg);
      color: var(--code-text);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .ccf-render-root .ccf-tooltip-frag:hover::before,
    .ccf-render-root .ccf-tooltip-frag:hover::after {
      opacity: 1;
      visibility: visible;
    }

    .ccf-render-root .ccf-code-frag {
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.92em;
      line-height: 1.5;
      color: var(--code-text);
      background: var(--code-bg);
      border: 1px solid var(--code-border);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      box-sizing: border-box;
    }

    .ccf-render-root .ccf-code-frag.is-inline {
      display: inline-block;
      padding: 0.08em 0.45em 0.12em;
      vertical-align: baseline;
    }

    .ccf-render-root .ccf-code-frag.is-block {
      display: block;
      width: 100%;
      margin: 6px 0;
      padding: 10px 12px;
    }

    .ccf-render-root .ccf-image-frag {
      position: relative;
      display: inline-block;
      width: 100%;
      margin: 4px 0;
      vertical-align: top;
    }

    .ccf-render-root .ccf-image {
      display: block;
      width: auto;
      max-width: min(100%, 420px);
      height: auto;
      border: 0;
      border-radius: 0;
      box-sizing: border-box;
      margin: 0 auto;
    }

    .ccf-render-root .ccf-image-token {
      display: inline-block;
      width: 0;
      height: 0;
      overflow: hidden;
      opacity: 0;
      font-size: 0;
      line-height: 0;
      white-space: pre;
      pointer-events: none;
      user-select: none;
    }
  </style>
  <script>
    (function () {
      var themeDefinitions = ${serializedThemeDefinitions};
      var tistoryHtmlByMode = ${serializedTistoryHtmlMap};
      var previewTabs = ${serializedPreviewTabs};
      var themeFieldDefs = ${serializedThemeFieldDefs};
      var customFallbackPalette = ${serializedCustomFallbackPalette};
      var initialThemeMode = ${JSON.stringify(themeModel.selectedMode)};
      var initialGmSenderKey = ${serializedInitialGmSenderKey};
      var currentThemeMode = initialThemeMode;
      var currentGmSenderKey = initialGmSenderKey;
      var pendingSourceUpdateTimer = 0;
      var pendingPreviewRenderTimer = 0;
      var activePreviewTabId = '';
      var previewTabTemplateCache = Object.create(null);
      var previewTabMap = previewTabs.reduce(function (out, tab) {
        if (tab && tab.id) {
          out[tab.id] = tab;
        }
        return out;
      }, Object.create(null));
      var customPalette = normalizeThemePalette(
        (themeDefinitions.custom && themeDefinitions.custom.palette) || customFallbackPalette,
        customFallbackPalette
      );

      function clampNumber(value, min, max) {
        var numeric = Number(value);
        if (!Number.isFinite(numeric)) return min;
        if (numeric < min) return min;
        if (numeric > max) return max;
        return numeric;
      }

      function normalizeCssColorValue(value) {
        if (value == null) return '';
        var probe = document.createElement('span');
        probe.style.color = '';
        probe.style.color = String(value).trim();
        return probe.style.color || '';
      }

      function normalizeSenderKeyValue(value) {
        return String(value == null ? '' : value)
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
      }

      function normalizeHexColor(value) {
        var match = String(value || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (!match) return '';
        var hex = match[1];
        if (hex.length === 3) {
          hex = hex.split('').map(function (char) { return char + char; }).join('');
        }
        return ('#' + hex).toUpperCase();
      }

      function colorToHex(value) {
        var direct = normalizeHexColor(value);
        if (direct) return direct;

        var normalized = normalizeCssColorValue(value);
        var match = normalized.match(/^rgba?\(([^)]+)\)$/i);
        if (!match) return '';

        var parts = match[1].split(',').map(function (part) { return part.trim(); });
        if (parts.length < 3) return '';
        return '#' + [0, 1, 2]
          .map(function (index) {
            return clampNumber(Number(parts[index]), 0, 255)
              .toString(16)
              .padStart(2, '0');
          })
          .join('')
          .toUpperCase();
      }

      function parseColorChannels(value) {
        var normalized = normalizeCssColorValue(value);
        if (!normalized) return null;

        var match = normalized.match(/^rgba?\(([^)]+)\)$/i);
        if (!match) return null;

        var parts = match[1].split(',').map(function (part) { return part.trim(); });
        if (parts.length < 3) return null;
        return {
          r: clampNumber(Number(parts[0]), 0, 255),
          g: clampNumber(Number(parts[1]), 0, 255),
          b: clampNumber(Number(parts[2]), 0, 255),
          a: parts.length >= 4 ? clampNumber(Number(parts[3]), 0, 1) : 1
        };
      }

      function mixColors(primary, secondary, amount) {
        var left = parseColorChannels(primary);
        var right = parseColorChannels(secondary);
        if (!left && !right) return normalizeCssColorValue(primary) || normalizeCssColorValue(secondary) || String(primary || secondary || '');
        if (!left) return normalizeCssColorValue(secondary) || String(secondary || '');
        if (!right) return normalizeCssColorValue(primary) || String(primary || '');

        var ratio = clampNumber(amount, 0, 1);
        var inverse = 1 - ratio;
        var red = Math.round((left.r * ratio) + (right.r * inverse));
        var green = Math.round((left.g * ratio) + (right.g * inverse));
        var blue = Math.round((left.b * ratio) + (right.b * inverse));
        var alpha = (left.a * ratio) + (right.a * inverse);
        return alpha >= 0.999
          ? 'rgb(' + red + ', ' + green + ', ' + blue + ')'
          : 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '') + ')';
      }

      function withColorAlpha(value, alpha) {
        var channels = parseColorChannels(value);
        if (!channels) return String(value || '');
        var nextAlpha = clampNumber(alpha, 0, 1);
        if (nextAlpha >= 0.999) {
          return 'rgb(' + channels.r + ', ' + channels.g + ', ' + channels.b + ')';
        }
        return 'rgba(' + channels.r + ', ' + channels.g + ', ' + channels.b + ', ' + nextAlpha.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '') + ')';
      }

      function getColorLuminance(value) {
        var channels = parseColorChannels(value);
        if (!channels) return 0;
        return ((0.2126 * channels.r) + (0.7152 * channels.g) + (0.0722 * channels.b)) / 255;
      }

      function pickReadableText(value) {
        return getColorLuminance(value) >= 0.56 ? '#202020' : '#FFFFFF';
      }

      function normalizeThemePalette(palette, fallback) {
        var base = fallback || customFallbackPalette;
        return {
          bg: colorToHex(palette && palette.bg) || colorToHex(base.bg) || '#151414',
          appbar: colorToHex(palette && palette.appbar) || colorToHex(base.appbar) || '#22201F',
          paper: colorToHex(palette && palette.paper) || colorToHex(base.paper) || '#1D1C1E',
          border: colorToHex(palette && palette.border) || colorToHex(base.border) || '#413D3A',
          text: colorToHex(palette && palette.text) || colorToHex(base.text) || '#F4F0EB',
          inputBg: colorToHex(palette && palette.inputBg) || colorToHex(base.inputBg) || '#1A191B'
        };
      }

      function buildThemeDefinitionFromPalette(mode, palette) {
        var normalizedPalette = normalizeThemePalette(palette, customFallbackPalette);
        var isLight = getColorLuminance(normalizedPalette.bg) >= 0.62;
        var accent = mixColors(normalizedPalette.text, normalizedPalette.appbar, isLight ? 0.38 : 0.22);
        var accentContrast = pickReadableText(accent);
        var accentBorder = mixColors(accent, normalizedPalette.border, 0.34);
        var chipBg = mixColors(normalizedPalette.appbar, normalizedPalette.paper, 0.58);
        var chipBorder = mixColors(normalizedPalette.border, normalizedPalette.paper, 0.72);
        var codeBg = mixColors(normalizedPalette.appbar, normalizedPalette.inputBg, 0.62);
        var codeBorder = mixColors(normalizedPalette.border, normalizedPalette.paper, 0.8);
        var shadowColor = withColorAlpha('#000000', isLight ? 0.12 : 0.26);
        var buttonShadow = withColorAlpha('#000000', isLight ? 0.12 : 0.22);

        return {
          mode: mode,
          palette: normalizedPalette,
          colorScheme: isLight ? 'light' : 'dark',
          vars: {
            '--page-bg': normalizedPalette.bg,
            '--panel-bg': normalizedPalette.paper,
            '--panel-border': normalizedPalette.border,
            '--panel-shadow': '0 18px 48px ' + shadowColor,
            '--text-main': normalizedPalette.text,
            '--text-subtle': mixColors(normalizedPalette.text, normalizedPalette.bg, 0.58),
            '--accent': accent,
            '--accent-contrast': accentContrast,
            '--accent-border': accentBorder,
            '--accent-shadow': '0 4px 12px ' + buttonShadow,
            '--chip-bg': chipBg,
            '--chip-border': chipBorder,
            '--chip-text': normalizedPalette.text,
            '--code-bg': codeBg,
            '--code-border': codeBorder,
            '--code-text': pickReadableText(codeBg),
            '--helper-bg': mixColors(normalizedPalette.paper, normalizedPalette.bg, 0.22)
          }
        };
      }

      function getSourceValue() {
        var source = document.getElementById('ccf-tistory-source');
        return source ? source.value : '';
      }

      function setSourceValue(value) {
        var source = document.getElementById('ccf-tistory-source');
        if (!source) return;
        source.value = String(value || '');
      }

      function getPreviewPanel() {
        return document.getElementById('ccf-log-preview-panel');
      }

      function renderPreviewState(message, busy) {
        var panel = getPreviewPanel();
        if (!panel) return;

        panel.innerHTML = '';
        panel.setAttribute('aria-busy', busy ? 'true' : 'false');
        panel.removeAttribute('data-ccf-loaded-tab');

        var state = document.createElement('p');
        state.className = 'ccf-log-preview-state';
        state.textContent = String(message || '');
        panel.appendChild(state);
      }

      function updatePreviewTabButtons(activeTabId) {
        document.querySelectorAll('[data-ccf-preview-tab]').forEach(function (button) {
          var isActive = button.getAttribute('data-ccf-preview-tab') === activeTabId;
          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
      }

      function getPreviewTabTemplate(tabId) {
        if (!tabId || !previewTabMap[tabId]) return null;
        if (!previewTabTemplateCache[tabId]) {
          var template = document.createElement('template');
          template.innerHTML = String(previewTabMap[tabId].html || '');
          previewTabTemplateCache[tabId] = template;
        }
        return previewTabTemplateCache[tabId];
      }

      function renderPreviewTab(tabId) {
        var panel = getPreviewPanel();
        var tab = tabId ? previewTabMap[tabId] : null;
        if (!panel) return;
        if (!tab) {
          activePreviewTabId = '';
          updatePreviewTabButtons('');
          renderPreviewState('\uD0ED \uB85C\uADF8\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.', false);
          return;
        }
        if (activePreviewTabId === tabId && panel.getAttribute('data-ccf-loaded-tab') === tabId) {
          return;
        }

        activePreviewTabId = tabId;
        updatePreviewTabButtons(tabId);

        if (pendingPreviewRenderTimer) {
          window.clearTimeout(pendingPreviewRenderTimer);
          pendingPreviewRenderTimer = 0;
        }

        renderPreviewState(tab.name + ' \uD0ED \uB85C\uADF8\uB97C \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.', true);
        pendingPreviewRenderTimer = window.setTimeout(function () {
          pendingPreviewRenderTimer = 0;
          if (activePreviewTabId !== tabId) return;

          var template = getPreviewTabTemplate(tabId);
          if (!template) {
            activePreviewTabId = '';
            updatePreviewTabButtons('');
            renderPreviewState('\uD0ED \uB85C\uADF8\uB97C \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.', false);
            return;
          }

          panel.innerHTML = '';
          panel.appendChild(template.content.cloneNode(true));
          panel.setAttribute('aria-busy', 'false');
          panel.setAttribute('data-ccf-loaded-tab', tabId);
          applyGmSelectionToPreview(currentGmSenderKey);
        }, 0);
      }

      function setCustomPanelVisible(visible) {
        var panel = document.getElementById('ccf-theme-custom-panel');
        if (!panel) return;
        panel.hidden = !visible;
      }

      function syncCustomThemeInputs(palette) {
        var normalizedPalette = normalizeThemePalette(palette, customFallbackPalette);
        themeFieldDefs.forEach(function (fieldDef) {
          var colorInput = document.getElementById('ccf-theme-custom-' + fieldDef.key);
          var codeInput = document.getElementById('ccf-theme-custom-' + fieldDef.key + '-text');
          var value = normalizedPalette[fieldDef.key] || '#000000';
          if (colorInput && colorInput.value !== value) {
            colorInput.value = value;
          }
          if (codeInput && codeInput.value !== value) {
            codeInput.value = value;
          }
        });
      }

      function getBaseTistoryHtmlForMode(mode) {
        if (tistoryHtmlByMode && tistoryHtmlByMode[mode]) return tistoryHtmlByMode[mode];
        if (tistoryHtmlByMode && tistoryHtmlByMode[initialThemeMode]) return tistoryHtmlByMode[initialThemeMode];
        if (tistoryHtmlByMode) {
          var keys = Object.keys(tistoryHtmlByMode);
          for (var i = 0; i < keys.length; i += 1) {
            if (tistoryHtmlByMode[keys[i]]) return tistoryHtmlByMode[keys[i]];
          }
        }
        return '';
      }

      function buildThemedTistoryHtml(mode, themeDefinition) {
        var baseHtml = getBaseTistoryHtmlForMode(mode);
        if (!baseHtml || !themeDefinition || !themeDefinition.vars) return '';

        try {
          var doc = new DOMParser().parseFromString(baseHtml, 'text/html');
          var content = doc.querySelector('.content');
          if (!content) return baseHtml;

          content.setAttribute('data-ccf-theme-mode', mode);
          content.setAttribute('data-ccf-gm-sender-key', currentGmSenderKey);
          Object.keys(themeDefinition.vars).forEach(function (key) {
            content.style.setProperty(key, themeDefinition.vars[key]);
          });
          applyGmSelectionToTistoryContent(content, currentGmSenderKey);
          return content.outerHTML;
        } catch (error) {
          return baseHtml;
        }
      }

      function getThemeDefinitionForMode(mode) {
        if (mode === 'custom') {
          var customDefinition = buildThemeDefinitionFromPalette('custom', customPalette);
          themeDefinitions.custom = customDefinition;
          return customDefinition;
        }
        return themeDefinitions && themeDefinitions[mode];
      }

      function commitThemeSource(mode, theme) {
        setSourceValue(buildThemedTistoryHtml(mode, theme));
      }

      function setPreviewGmState(entry, isGm) {
        if (!entry) return;
        entry.setAttribute('data-ccf-gm-entry', isGm ? '1' : '0');
      }

      function applyGmSelectionToPreview(senderKey) {
        currentGmSenderKey = normalizeSenderKeyValue(senderKey);
        document.querySelectorAll('.ccf-log-entry[data-ccf-sender-key]').forEach(function (entry) {
          setPreviewGmState(
            entry,
            !!currentGmSenderKey && entry.getAttribute('data-ccf-sender-key') === currentGmSenderKey
          );
        });
      }

      function setTistoryEntryGmState(entry, isGm) {
        if (!entry) return;
        entry.setAttribute('data-ccf-gm-entry', isGm ? '1' : '0');
        var body = entry.querySelector('.ccf-tistory-entry-body');
        if (body) {
          body.style.textAlign = isGm ? 'center' : '';
        }
      }

      function applyGmSelectionToTistoryContent(content, senderKey) {
        if (!content) return;
        var normalizedSenderKey = normalizeSenderKeyValue(senderKey);
        content.querySelectorAll('.ccf-tistory-entry[data-ccf-sender-key]').forEach(function (entry) {
          setTistoryEntryGmState(
            entry,
            !!normalizedSenderKey && entry.getAttribute('data-ccf-sender-key') === normalizedSenderKey
          );
        });
      }

      function scheduleThemeSourceUpdate() {
        if (pendingSourceUpdateTimer) {
          window.clearTimeout(pendingSourceUpdateTimer);
        }
        pendingSourceUpdateTimer = window.setTimeout(function () {
          pendingSourceUpdateTimer = 0;
          var theme = getThemeDefinitionForMode(currentThemeMode);
          if (!theme) return;
          commitThemeSource(currentThemeMode, theme);
        }, 120);
      }

      function applyThemeMode(mode, options) {
        var opts = options || {};
        var theme = getThemeDefinitionForMode(mode);
        if (!theme || !theme.vars) return;

        var root = document.documentElement;
        if (!root) return;

        currentThemeMode = mode;
        root.style.colorScheme = theme.colorScheme || '';
        root.setAttribute('data-ccf-theme-mode', mode);
        Object.keys(theme.vars).forEach(function (key) {
          root.style.setProperty(key, theme.vars[key]);
        });

        if (opts.deferSourceUpdate) {
          scheduleThemeSourceUpdate();
        } else {
          if (pendingSourceUpdateTimer) {
            window.clearTimeout(pendingSourceUpdateTimer);
            pendingSourceUpdateTimer = 0;
          }
          commitThemeSource(mode, theme);
        }
        setCustomPanelVisible(mode === 'custom');
        if (mode === 'custom' && opts.syncInputs !== false) {
          syncCustomThemeInputs(customPalette);
        }
      }

      function applyCustomThemeField(key, value, options) {
        var normalized = colorToHex(value);
        if (!normalized) return false;
        customPalette[key] = normalized;
        if (!options || options.syncInputs !== false) {
          syncCustomThemeInputs(customPalette);
        }
        if (currentThemeMode === 'custom') {
          applyThemeMode('custom', {
            deferSourceUpdate: !!(options && options.deferSourceUpdate),
            syncInputs: false
          });
        }
        return true;
      }

      function setCopyStatus(message, isError) {
        var status = document.getElementById('ccf-tistory-copy-status');
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? '#a61b1b' : 'var(--text-subtle)';
      }

      function fallbackCopy(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        var copied = false;
        try {
          copied = document.execCommand('copy');
        } catch (error) {
          copied = false;
        }
        document.body.removeChild(textarea);
        return copied;
      }

      async function copyTistoryHtml() {
        if (pendingSourceUpdateTimer) {
          window.clearTimeout(pendingSourceUpdateTimer);
          pendingSourceUpdateTimer = 0;
          var latestTheme = getThemeDefinitionForMode(currentThemeMode);
          if (latestTheme) {
            commitThemeSource(currentThemeMode, latestTheme);
          }
        }
        var html = getSourceValue();
        if (!html) {
          setCopyStatus('복사할 티스토리 HTML이 비어 있습니다.', true);
          return;
        }

        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(html);
          } else if (!fallbackCopy(html)) {
            throw new Error('clipboard-unavailable');
          }
          setCopyStatus('티스토리용 HTML이 복사되었습니다. 티스토리 HTML 모드에 붙여넣어 주세요.', false);
        } catch (error) {
          if (fallbackCopy(html)) {
            setCopyStatus('티스토리용 HTML이 복사되었습니다. 티스토리 HTML 모드에 붙여넣어 주세요.', false);
            return;
          }
          setCopyStatus('복사에 실패했습니다. 브라우저 클립보드 권한을 확인해 주세요.', true);
        }
      }

      document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-ccf-preview-tab]').forEach(function (button) {
          button.addEventListener('click', function () {
            renderPreviewTab(button.getAttribute('data-ccf-preview-tab'));
          });
        });

        var button = document.getElementById('ccf-tistory-copy-btn');
        if (button) {
          button.addEventListener('click', function () {
            void copyTistoryHtml();
          });
        }

        var themeSelect = document.getElementById('ccf-theme-mode');
        if (themeSelect) {
          themeSelect.addEventListener('change', function () {
            applyThemeMode(themeSelect.value);
          });
          themeSelect.value = initialThemeMode;
        }

        var gmSelect = document.getElementById('ccf-gm-sender');
        if (gmSelect) {
          gmSelect.addEventListener('change', function () {
            applyGmSelectionToPreview(gmSelect.value);
            scheduleThemeSourceUpdate();
          });
          gmSelect.value = initialGmSenderKey;
        }

        themeFieldDefs.forEach(function (fieldDef) {
          var colorInput = document.getElementById('ccf-theme-custom-' + fieldDef.key);
          var codeInput = document.getElementById('ccf-theme-custom-' + fieldDef.key + '-text');

          if (colorInput) {
            colorInput.addEventListener('input', function () {
              applyCustomThemeField(fieldDef.key, colorInput.value, {
                syncInputs: true,
                deferSourceUpdate: true
              });
            });
            colorInput.addEventListener('change', function () {
              applyCustomThemeField(fieldDef.key, colorInput.value, {
                syncInputs: true,
                deferSourceUpdate: false
              });
            });
          }

          if (codeInput) {
            codeInput.addEventListener('change', function () {
              if (!applyCustomThemeField(fieldDef.key, codeInput.value)) {
                syncCustomThemeInputs(customPalette);
              }
            });
            codeInput.addEventListener('blur', function () {
              syncCustomThemeInputs(customPalette);
            });
            codeInput.addEventListener('keydown', function (event) {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (!applyCustomThemeField(fieldDef.key, codeInput.value)) {
                syncCustomThemeInputs(customPalette);
              }
            });
          }
        });

        applyGmSelectionToPreview(initialGmSenderKey);
        applyThemeMode(initialThemeMode);
      });
    })();
  </script>
</head>
<body>
<textarea id="ccf-tistory-source" hidden></textarea>
${main.outerHTML}
</body>
</html>`;
  }

  function buildTistoryContentHtml({ roomTitle, exportedAt, entries, assets, themeDefinition = null, tabs = [] }) {
    const theme = themeDefinition || getPackageThemeDefinition();
    const assetMap = buildTistoryAssetMap(assets);
    const tabGroups = buildPackageTabGroups(entries, tabs);
    const showTabGroups = tabGroups.length > 1;
    const root = document.createElement("div");
    root.className = "content";
    root.setAttribute("data-ccf-export", "tistory-body");
    root.setAttribute("data-ccf-room-title", roomTitle);
    root.setAttribute("data-ccf-exported-at", exportedAt.toISOString());
    root.setAttribute("data-ccf-theme-mode", theme.mode || PACKAGE_THEME_MODE_DEFAULT);
    root.setAttribute("data-ccf-gm-sender-key", "");
    root.style.boxSizing = "border-box";
    root.style.width = "100%";
    root.style.maxWidth = "100%";
    root.style.margin = "0";
    root.style.padding = "0";
    root.style.color = "var(--text-main)";
    root.style.fontFamily = "\"Segoe UI\", \"Noto Sans KR\", sans-serif";
    root.style.fontSize = "14px";
    root.style.lineHeight = "1.6";
    root.style.wordBreak = "break-word";
    root.style.overflowWrap = "anywhere";
    applyPackageThemeVariables(root, theme);

    tabGroups.forEach((tabGroup, tabIndex) => {
      if (showTabGroups) {
        const heading = document.createElement("section");
        heading.style.margin = tabIndex === 0 ? "0 0 14px" : "24px 0 14px";
        heading.style.padding = "12px 14px";
        heading.style.border = "1px solid var(--panel-border)";
        heading.style.background = "var(--helper-bg)";

        const title = document.createElement("div");
        title.textContent = tabGroup.name;
        title.style.fontSize = "18px";
        title.style.fontWeight = "700";
        title.style.lineHeight = "1.35";
        heading.appendChild(title);
        root.appendChild(heading);
      }

      if (!tabGroup.entries.length) {
        const emptyState = document.createElement("div");
        emptyState.textContent = "\uC774 \uD0ED\uC5D0\uB294 \uB0B4\uBCF4\uB0BC \uBA54\uC2DC\uC9C0\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
        emptyState.style.margin = "0 0 14px";
        emptyState.style.padding = "14px 16px";
        emptyState.style.border = "1px dashed var(--panel-border)";
        emptyState.style.background = "var(--helper-bg)";
        emptyState.style.color = "var(--text-subtle)";
        emptyState.style.fontSize = "13px";
        root.appendChild(emptyState);
        return;
      }

      tabGroup.entries.forEach((entry, index) => {
        const article = createTistoryEntryNode(entry, assetMap, theme);
        if (index < tabGroup.entries.length - 1) {
          article.style.marginBottom = "14px";
        }
        root.appendChild(article);
      });
    });

    return root.outerHTML;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(roomTitle)} - Tistory Body</title>
  <script>
    (function () {
      function getContentHtml() {
        var content = document.querySelector('.content');
        return content ? content.outerHTML : '';
      }

      function setStatus(message, isError) {
        var status = document.getElementById('copy-status');
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? '#a61b1b' : '#2d241c';
      }

      function fallbackCopyText(text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        var copied = false;
        try {
          copied = document.execCommand('copy');
        } catch (error) {
          copied = false;
        }
        document.body.removeChild(textarea);
        return copied;
      }

      async function copyContentHtml() {
        var html = getContentHtml();
        if (!html) {
          setStatus('복사할 HTML을 찾지 못했습니다.', true);
          return;
        }

        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(html);
          } else if (!fallbackCopyText(html)) {
            throw new Error('clipboard-unavailable');
          }
          setStatus('HTML이 클립보드에 복사되었습니다. 티스토리 HTML 모드에 붙여넣어 주세요.', false);
        } catch (error) {
          if (fallbackCopyText(html)) {
            setStatus('HTML이 클립보드에 복사되었습니다. 티스토리 HTML 모드에 붙여넣어 주세요.', false);
            return;
          }
          setStatus('복사에 실패했습니다. 브라우저의 클립보드 권한을 확인해 주세요.', true);
        }
      }

      document.addEventListener('DOMContentLoaded', function () {
        var copyButton = document.getElementById('copy-html-button');
        if (copyButton) {
          copyButton.addEventListener('click', function () {
            void copyContentHtml();
          });
        }
      });

      document.addEventListener('keydown', function (event) {
        if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyC') {
          event.preventDefault();
          void copyContentHtml();
        }
      });
    })();
  </script>
</head>
<body style="margin:0;padding:18px;background:#ffffff;color:#2d241c;font-family:&quot;Segoe UI&quot;,&quot;Noto Sans KR&quot;,sans-serif;">
<div style="box-sizing:border-box;max-width:960px;margin:0 auto 18px;padding:14px 16px;border:1px solid #e5dbcf;border-radius:0;background:#fff8ef;">
  <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">
    <div>
      <div style="font-size:16px;font-weight:700;line-height:1.4;">티스토리 HTML 복사용 파일</div>
      <div style="margin-top:4px;font-size:13px;line-height:1.5;color:#6b5d51;">이 페이지를 전체 선택해서 복사하지 말고, 아래 버튼이나 <strong>Alt+C</strong>로 HTML을 복사한 뒤 티스토리 HTML 모드에 붙여넣어 주세요.</div>
    </div>
    <button id="copy-html-button" type="button" style="cursor:pointer;border:0;border-radius:0;background:#8b5e34;color:#ffffff;padding:10px 16px;font-size:14px;font-weight:700;">HTML 복사</button>
  </div>
  <div id="copy-status" style="margin-top:10px;font-size:12px;line-height:1.5;color:#2d241c;">복사 대기 중</div>
</div>
${root.outerHTML}
</body>
</html>`;
  }

  function buildTistoryAssetMap(assets) {
    return new Map(
      (Array.isArray(assets) ? assets : []).map((asset) => [
        asset.source,
        {
          ...asset,
          renderUrl: buildTistoryAssetRenderUrl(asset)
        }
      ])
    );
  }

  function buildTistoryAssetRenderUrl(asset) {
    if (!asset || typeof asset !== "object") return "";
    if (asset.included && asset.bytes instanceof Uint8Array) {
      const mimeType = asset.mimeType || guessMimeTypeFromUrl(asset.source) || "image/png";
      return `data:${mimeType};base64,${uint8ArrayToBase64(asset.bytes)}`;
    }
    return normalizeAssetSource(asset.source) || String(asset.source || "");
  }

  function buildPackageAssetMap(assets) {
    return new Map(
      (Array.isArray(assets) ? assets : []).map((asset) => [
        asset.source,
        {
          ...asset,
          renderUrl: buildPackageAssetRenderUrl(asset)
        }
      ])
    );
  }

  function buildPackageAssetRenderUrl(asset) {
    if (!asset || typeof asset !== "object") return "";
    if (asset.included && asset.bytes instanceof Uint8Array) {
      const mimeType = asset.mimeType || guessMimeTypeFromUrl(asset.source) || "image/png";
      return `data:${mimeType};base64,${uint8ArrayToBase64(asset.bytes)}`;
    }
    return normalizeAssetSource(asset.source) || String(asset.source || "");
  }

  function resolvePackageRenderableImageUrl(value, assetMap) {
    const directSource = normalizeAssetSource(value);
    if (directSource) {
      const mappedAsset = assetMap.get(directSource);
      if (mappedAsset?.renderUrl) return mappedAsset.renderUrl;
      if (!/^blob:/i.test(directSource)) return directSource;
      return "";
    }

    const renderable = resolveRenderableImageUrl(value);
    if (!renderable) return "";
    const source = normalizeAssetSource(renderable);
    const mapped = source ? assetMap.get(source) : null;
    return mapped?.renderUrl || renderable;
  }

  function createTistoryEntryNode(entry, assetMap, themeDefinition = null) {
    const article = document.createElement("section");
    article.className = "ccf-tistory-entry";
    article.setAttribute("data-ccf-sender-key", normalizeSenderKey(entry.sender || ""));
    article.setAttribute("data-ccf-gm-entry", "0");
    article.style.boxSizing = "border-box";
    article.style.width = "100%";
    article.style.margin = "0";
    article.style.padding = "16px 18px";
    article.style.background = "var(--panel-bg)";
    article.style.border = "1px solid var(--panel-border)";
    article.style.borderRadius = "0";
    article.style.boxShadow = "var(--panel-shadow)";

    const avatarUrl = resolvePackageRenderableImageUrl(entry.avatarSource, assetMap);
    const mainRow = document.createElement("div");
    mainRow.className = "ccf-tistory-entry-main";
    mainRow.style.display = "flex";
    mainRow.style.alignItems = "flex-start";
    mainRow.style.gap = "16px";

    if (avatarUrl) {
      const avatar = document.createElement("img");
      avatar.src = avatarUrl;
      avatar.alt = entry.sender ? `${entry.sender} avatar` : "avatar";
      avatar.loading = "eager";
      avatar.decoding = "sync";
      avatar.style.display = "block";
      avatar.style.width = "40px";
      avatar.style.minWidth = "40px";
      avatar.style.maxWidth = "40px";
      avatar.style.height = "40px";
      avatar.style.minHeight = "40px";
      avatar.style.maxHeight = "40px";
      avatar.style.flex = "0 0 40px";
      avatar.style.flexShrink = "0";
      avatar.style.alignSelf = "flex-start";
      avatar.style.objectFit = "cover";
      avatar.style.borderRadius = "0";
      avatar.style.background = "var(--helper-bg)";
      avatar.style.border = "1px solid var(--panel-border)";
      mainRow.appendChild(avatar);
    }

    const content = document.createElement("div");
    content.className = "ccf-tistory-entry-content";
    content.style.minWidth = "0";
    content.style.flex = "1 1 auto";

    if (entry.sender || entry.timestamp) {
      const header = document.createElement("div");
      header.className = "ccf-tistory-entry-header";
      header.style.display = "flex";
      header.style.alignItems = "flex-start";
      header.style.justifyContent = "space-between";
      header.style.gap = "12px";
      header.style.margin = "0 0 2px";
      header.style.fontSize = "12px";
      header.style.lineHeight = "1.4";
      header.style.color = "var(--text-subtle)";

      const headerMain = document.createElement("div");
      headerMain.className = "ccf-tistory-entry-header-main";
      headerMain.style.minWidth = "0";
      headerMain.style.display = "flex";
      headerMain.style.flexWrap = "wrap";
      headerMain.style.alignItems = "baseline";
      headerMain.style.gap = "6px";
      headerMain.style.flex = "1 1 auto";

      if (entry.sender) {
        const sender = document.createElement("span");
        sender.textContent = entry.sender;
        sender.style.color = entry.baseColor || "var(--text-main)";
        sender.style.fontSize = "14px";
        sender.style.fontWeight = "700";
        sender.style.lineHeight = "1.4";
        headerMain.appendChild(sender);
      }

      if (entry.timestamp) {
        const timestamp = document.createElement("span");
        timestamp.textContent = entry.timestamp;
        timestamp.style.lineHeight = "1.4";
        headerMain.appendChild(timestamp);
      }

      header.appendChild(headerMain);
      content.appendChild(header);
    }

    const body = buildTistoryRenderedMessageNode({
      text: entry.text || entry.visibleText || "",
      formatRuns: entry.formatRuns || [],
      alignRuns: entry.alignRuns || [],
      blockStyle: entry.blockStyle || {},
      baseColor: entry.baseColor || "",
      assetMap
    });
    body.className = "ccf-tistory-entry-body";
    body.style.margin = "0";
    body.style.padding = "0";
    content.appendChild(body);
    mainRow.appendChild(content);
    article.appendChild(mainRow);

    return article;
  }

  function buildTistoryRenderedMessageNode({ text, formatRuns, alignRuns, blockStyle, baseColor, assetMap }) {
    const wrapper = document.createElement("div");
    wrapper.style.boxSizing = "border-box";
    wrapper.style.width = "100%";
    wrapper.style.margin = "0";
    wrapper.style.padding = "0";
    wrapper.style.wordBreak = "break-word";
    wrapper.style.overflowWrap = "anywhere";

    const normalizedText = typeof text === "string" ? text : "";
    if (!normalizedText) {
      wrapper.appendChild(document.createElement("br"));
      return wrapper;
    }

    const normalizedRuns = normalizeRuns(formatRuns, normalizedText.length);
    const normalizedAlignRuns = getEffectiveAlignRuns(normalizedText, alignRuns, blockStyle || {});
    if (!normalizedRuns.length && !normalizedAlignRuns.length) {
      wrapper.style.whiteSpace = "pre-wrap";
      wrapper.textContent = normalizedText;
      return wrapper;
    }

    const lines = getTextLines(normalizedText);
    let activeCodeGroup = null;
    let activeCodeGroupKey = "";

    for (const line of lines) {
      const lineEl = document.createElement("div");
      lineEl.style.margin = "0";
      lineEl.style.padding = "0";
      lineEl.style.whiteSpace = "pre-wrap";
      lineEl.style.wordBreak = "break-word";
      lineEl.style.overflowWrap = "anywhere";

      const lineAlign = getLineAlign(normalizedAlignRuns, line.index);
      if (lineAlign) {
        lineEl.style.textAlign = lineAlign;
      }

      const lineRuns = normalizedRuns
        .filter((run) => run.start < line.end && run.end > line.start)
        .map((run) => ({
          start: clamp(run.start - line.start, 0, line.text.length),
          end: clamp(run.end - line.start, 0, line.text.length),
          style: { ...run.style }
        }))
        .filter((run) => run.end > run.start);

      if (!line.text.length) {
        const blockCodeGroupKey = getBlockCodeGroupKeyForLine(line, normalizedRuns);
        lineEl.appendChild(document.createElement("br"));
        if (blockCodeGroupKey) {
          if (!activeCodeGroup || activeCodeGroupKey !== blockCodeGroupKey) {
            activeCodeGroup = createTistoryCodeBlockContainer();
            activeCodeGroupKey = blockCodeGroupKey;
            wrapper.appendChild(activeCodeGroup);
          }
          activeCodeGroup.appendChild(lineEl);
          continue;
        }
        activeCodeGroup = null;
        activeCodeGroupKey = "";
        wrapper.appendChild(lineEl);
        continue;
      }

      if (!lineRuns.length) {
        lineEl.textContent = line.text;
        activeCodeGroup = null;
        activeCodeGroupKey = "";
        wrapper.appendChild(lineEl);
        continue;
      }

      const fragments = buildFragments(line.text, lineRuns);
      const blockCodeGroupKey = getBlockCodeGroupKeyForLine(line, normalizedRuns, fragments);
      if (blockCodeGroupKey) {
        if (!activeCodeGroup || activeCodeGroupKey !== blockCodeGroupKey) {
          activeCodeGroup = createTistoryCodeBlockContainer();
          activeCodeGroupKey = blockCodeGroupKey;
          wrapper.appendChild(activeCodeGroup);
        }

        for (const frag of fragments) {
          lineEl.appendChild(
            createTistoryStyledFragmentNode(
              { ...frag, style: stripCodeModeFromStyle(frag.style) },
              assetMap
            )
          );
        }
        activeCodeGroup.appendChild(lineEl);
        continue;
      }

      activeCodeGroup = null;
      activeCodeGroupKey = "";
      for (const frag of fragments) {
        lineEl.appendChild(createTistoryStyledFragmentNode(frag, assetMap));
      }
      wrapper.appendChild(lineEl);
    }

    return wrapper;
  }

  function createTistoryCodeBlockContainer() {
    const block = document.createElement("div");
    block.style.display = "block";
    block.style.width = "100%";
    block.style.margin = "6px 0";
    block.style.padding = "10px 12px";
    block.style.background = "var(--code-bg)";
    block.style.border = "1px solid var(--code-border)";
    block.style.borderRadius = "0";
    block.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.03)";
    block.style.boxSizing = "border-box";
    block.style.color = "var(--code-text)";
    block.style.fontFamily = "Consolas, \"Courier New\", monospace";
    block.style.fontSize = "0.92em";
    block.style.lineHeight = "1.5";
    return block;
  }

  function createTistoryStyledFragmentNode(frag, assetMap) {
    if (frag.style?.imageUrl) return createTistoryImageFragmentNode(frag, assetMap);
    if (frag.style?.tooltipText) return createTistoryTooltipFragmentNode(frag, assetMap);
    if (frag.style?.codeMode) return createTistoryCodeFragmentNode(frag, assetMap);
    if (frag.style?.rubyText) return createTistoryRubyFragmentNode(frag, assetMap);
    return createTistoryPlainTextFragmentNode(frag, assetMap);
  }

  function createTistoryPlainTextFragmentNode(frag, assetMap) {
    const span = document.createElement("span");
    span.textContent = frag.text || "";
    applyTistoryInlineStyle(span, frag.style, assetMap);
    return span;
  }

  function createTistoryTooltipFragmentNode(frag, assetMap) {
    const tooltipText = normalizeTooltipText(frag.style?.tooltipText);
    if (!tooltipText) {
      return createTistoryStyledFragmentNode(
        { ...frag, style: cloneStyleWithoutKeys(frag.style, ["tooltipText"]) },
        assetMap
      );
    }

    const wrapper = document.createElement("span");
    wrapper.title = tooltipText;
    wrapper.style.borderBottom = "1px dashed currentColor";
    wrapper.style.paddingBottom = "0.02em";
    wrapper.style.cursor = "help";
    wrapper.appendChild(
      createTistoryStyledFragmentNode(
        { ...frag, style: cloneStyleWithoutKeys(frag.style, ["tooltipText"]) },
        assetMap
      )
    );
    return wrapper;
  }

  function createTistoryCodeFragmentNode(frag, assetMap) {
    const codeMode = normalizeCodeMode(frag.style?.codeMode);
    if (!codeMode) {
      return createTistoryStyledFragmentNode(
        { ...frag, style: cloneStyleWithoutKeys(frag.style, ["codeMode"]) },
        assetMap
      );
    }

    const wrapper = document.createElement(codeMode === "block" ? "div" : "code");
    wrapper.style.fontFamily = "Consolas, \"Courier New\", monospace";
    wrapper.style.fontSize = "0.92em";
    wrapper.style.lineHeight = "1.5";
    wrapper.style.color = "var(--code-text)";
    wrapper.style.background = "var(--code-bg)";
    wrapper.style.border = "1px solid var(--code-border)";
    wrapper.style.boxShadow = "inset 0 1px 0 rgba(255, 255, 255, 0.03)";
    wrapper.style.boxSizing = "border-box";

    if (codeMode === "block") {
      wrapper.style.display = "block";
      wrapper.style.width = "100%";
      wrapper.style.margin = "6px 0";
      wrapper.style.padding = "10px 12px";
      wrapper.style.borderRadius = "0";
      wrapper.style.whiteSpace = "pre-wrap";
      wrapper.style.wordBreak = "break-word";
      wrapper.style.overflowWrap = "anywhere";
    } else {
      wrapper.style.display = "inline-block";
      wrapper.style.padding = "0.08em 0.45em 0.12em";
      wrapper.style.borderRadius = "0";
      wrapper.style.verticalAlign = "baseline";
      wrapper.style.whiteSpace = "pre-wrap";
      wrapper.style.overflowWrap = "anywhere";
    }

    wrapper.appendChild(
      createTistoryStyledFragmentNode(
        { ...frag, style: cloneStyleWithoutKeys(frag.style, ["codeMode"]) },
        assetMap
      )
    );
    return wrapper;
  }

  function createTistoryRubyFragmentNode(frag, assetMap) {
    const rubyText = normalizeRubyText(frag.style?.rubyText);
    if (!rubyText) {
      return createTistoryStyledFragmentNode(
        { ...frag, style: cloneStyleWithoutKeys(frag.style, ["rubyText"]) },
        assetMap
      );
    }

    const ruby = document.createElement("ruby");
    ruby.style.whiteSpace = "pre-wrap";
    applyTistoryInlineStyle(ruby, cloneStyleWithoutKeys(frag.style, ["rubyText"]), assetMap);
    ruby.appendChild(document.createTextNode(frag.text || ""));

    const rt = document.createElement("rt");
    rt.textContent = rubyText;
    rt.style.fontSize = "0.62em";
    rt.style.lineHeight = "1";
    ruby.appendChild(rt);
    return ruby;
  }

  function createTistoryImageFragmentNode(frag, assetMap) {
    const wrapper = document.createElement("span");
    wrapper.style.display = "block";
    wrapper.style.width = "100%";
    wrapper.style.margin = "4px 0";
    wrapper.style.textAlign = "center";

    const imageUrl = resolveTistoryRenderableImageUrl(frag.style?.imageUrl, assetMap);
    if (!imageUrl) {
      const fallback = document.createElement("span");
      fallback.textContent = frag.style?.imageAlt || frag.text || "image";
      applyTistoryInlineStyle(fallback, cloneStyleWithoutKeys(frag.style, ["imageUrl", "imageAlt"]), assetMap);
      wrapper.appendChild(fallback);
      return wrapper;
    }

    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = frag.style?.imageAlt || frag.text || "image";
    img.loading = "lazy";
    img.decoding = "async";
    img.style.display = "inline-block";
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.style.border = "0";
    img.style.borderRadius = "0";
    img.style.boxSizing = "border-box";
    applyTistoryInlineStyle(img, cloneStyleWithoutKeys(frag.style, ["imageUrl", "imageAlt"]), assetMap);
    wrapper.appendChild(img);
    return wrapper;
  }

  function resolveTistoryRenderableImageUrl(value, assetMap) {
    const directSource = normalizeAssetSource(value);
    if (directSource) {
      const mappedAsset = assetMap.get(directSource);
      if (mappedAsset?.renderUrl) return mappedAsset.renderUrl;
      if (!/^blob:/i.test(directSource)) return directSource;
      return "";
    }

    const renderable = resolveRenderableImageUrl(value);
    if (!renderable) return "";
    const source = normalizeAssetSource(renderable);
    const mapped = source ? assetMap.get(source) : null;
    return mapped?.renderUrl || renderable;
  }

  function applyTistoryInlineStyle(el, style, assetMap) {
    if (!el || !style) return;
    if (style.bold) el.style.fontWeight = "700";
    if (style.italic) el.style.fontStyle = "italic";
    if (style.underline || style.strike) {
      const parts = [];
      if (style.underline) parts.push("underline");
      if (style.strike) parts.push("line-through");
      el.style.textDecoration = parts.join(" ");
    }
    if (style.color) el.style.color = style.color;
    if (style.backgroundColor) el.style.backgroundColor = style.backgroundColor;
    if (style.backgroundImage) {
      const rewritten = rewriteCssUrls(style.backgroundImage, assetMap);
      if (rewritten) el.style.backgroundImage = rewritten;
    }
    if (style.fontSize) el.style.fontSize = `${style.fontSize}px`;
    if (style.display) el.style.display = style.display;
    if (style.padding) el.style.padding = style.padding;
    if (style.margin) el.style.margin = style.margin;
    if (style.border) el.style.border = style.border;
    if (style.letterSpacing) el.style.letterSpacing = style.letterSpacing;
    if (style.lineHeight) el.style.lineHeight = style.lineHeight;
    if (style.textAlign) el.style.textAlign = style.textAlign;
    if (style.textShadow) el.style.textShadow = style.textShadow;
    if (style.blur) el.style.filter = `blur(${style.blur})`;
    if (style.opacity != null) el.style.opacity = String(style.opacity);
  }

  function cloneStyleWithoutKeys(style, keys) {
    if (!style || typeof style !== "object") return style ? { ...style } : {};
    const nextStyle = { ...style };
    for (const key of keys || []) {
      delete nextStyle[key];
    }
    return nextStyle;
  }

  function extractEnvelope(fullText) {
    if (typeof fullText !== "string" || !fullText) return null;

    const startIndex = fullText.indexOf(INVIS_START);
    const endIndex = fullText.indexOf(INVIS_END, startIndex + INVIS_START.length);
    if (startIndex < 0 || endIndex < 0) return null;

    const visibleText = fullText.slice(0, startIndex);
    const encodedPart = fullText.slice(startIndex + INVIS_START.length, endIndex);

    try {
      const json = decodeInvisibleToJson(encodedPart);
      const envelope = JSON.parse(json);
      return { visibleText, envelope };
    } catch (error) {
      console.warn("[CCF LOG PACKAGE] failed to decode payload", error);
      return null;
    }
  }

  function decodeInvisibleToJson(encodedPart) {
    let bits = "";
    for (const char of encodedPart) {
      const index = INVIS_REVERSE.get(char);
      if (index == null) continue;
      bits += index.toString(2).padStart(2, "0");
    }

    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }

    const base64 = String.fromCharCode(...bytes).replace(/\0+$/g, "");
    return base64ToUtf8(base64);
  }

  function base64ToUtf8(base64) {
    return decodeURIComponent(escape(atob(base64)));
  }

  function stripInvisibleEnvelope(text) {
    if (typeof text !== "string" || !text) return "";

    const startIndex = text.indexOf(INVIS_START);
    if (startIndex < 0) return text;

    const endIndex = text.indexOf(INVIS_END, startIndex + INVIS_START.length);
    if (endIndex < 0) return text;

    return text.slice(0, startIndex) + text.slice(endIndex + INVIS_END.length);
  }

  function normalizeAssetSource(value) {
    if (typeof value !== "string") return "";
    let trimmed = value.trim();
    if (!trimmed) return "";

    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
      return trimmed.replace(/\s+/g, "");
    }

    if (/^\/\//.test(trimmed)) {
      trimmed = `https:${trimmed}`;
    }

    try {
      const parsed = new URL(trimmed, location.href);
      if (!/^(https?|blob):$/i.test(parsed.protocol)) return "";
      return parsed.toString();
    } catch (error) {
      return "";
    }
  }

  function extractCssUrls(value) {
    if (typeof value !== "string" || !value) return [];

    const out = [];
    const re = /url\((.*?)\)/gi;
    let match = re.exec(value);
    while (match) {
      const raw = String(match[1] || "").trim().replace(/^['"]|['"]$/g, "");
      const normalized = normalizeAssetSource(raw);
      if (normalized) out.push(normalized);
      match = re.exec(value);
    }

    return out;
  }

  function rewriteCssUrls(value, assetMap) {
    if (typeof value !== "string" || !value) return "";

    return value.replace(/url\((.*?)\)/gi, (match, raw) => {
      const source = normalizeAssetSource(String(raw || "").trim().replace(/^['"]|['"]$/g, ""));
      const mapped = source ? assetMap.get(source) : null;
      if (!mapped?.renderUrl) return match;
      return `url("${escapeCssUrl(mapped.renderUrl)}")`;
    });
  }

  function escapeCssUrl(value) {
    return String(value || "").replace(/["\\\r\n]/g, "\\$&");
  }

  function parseDataUrl(value) {
    const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) return null;

    try {
      const mimeType = match[1].toLowerCase();
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { mimeType, bytes };
    } catch (error) {
      return null;
    }
  }

  function uint8ArrayToBase64(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length) return "";

    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function guessFileExtension(mimeType, source) {
    const byMime = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/bmp": "bmp",
      "image/svg+xml": "svg",
      "image/avif": "avif"
    };

    if (byMime[mimeType]) return byMime[mimeType];

    const cleaned = String(source || "").split(/[?#]/, 1)[0];
    const extMatch = cleaned.match(/\.([a-z0-9]{2,6})$/i);
    if (extMatch) {
      return extMatch[1].toLowerCase();
    }

    return "bin";
  }

  function guessMimeTypeFromUrl(source) {
    const ext = guessFileExtension("", source);
    const byExt = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      avif: "image/avif"
    };
    return byExt[ext] || "";
  }

  function buildPackageFileName(roomTitle, roomAddress, exportedAt) {
    const safeTitle = sanitizeFilePart(roomTitle || roomAddress || "ccfolia-room");
    const stamp = formatFileDate(exportedAt);
    return `${safeTitle}-${stamp}.zip`;
  }

  function sanitizeFilePart(value) {
    const normalized = normalizeSpace(String(value || "")).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "");
    return normalized.slice(0, 80) || "ccfolia-room";
  }

  function getRoomTitle(preferredFileName = "") {
    const exportedTitle = normalizeExportedLogTitle(preferredFileName);
    if (isUsableRoomTitle(exportedTitle)) {
      return exportedTitle;
    }

    const subtitle = [...document.querySelectorAll('h6.MuiTypography-subtitle2, h6[class*="MuiTypography-subtitle2"]')]
      .find((element) => element instanceof HTMLElement && isVisible(element));
    if (subtitle instanceof HTMLElement) {
      const ownText = getOwnTextContent(subtitle);
      if (isUsableRoomTitle(ownText)) {
        return ownText;
      }
    }

    const heading = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      .find((element) => element instanceof HTMLElement && isVisible(element) && isUsableRoomTitle(getOwnTextContent(element)));
    if (heading instanceof HTMLElement) {
      return getOwnTextContent(heading);
    }

    const cleanedTitle = normalizeSpace(String(document.title || "").replace(/\s*[|-]\s*CCFOLIA.*$/i, ""));
    if (isUsableRoomTitle(cleanedTitle)) {
      return cleanedTitle;
    }

    const slug = location.pathname.split("/").filter(Boolean).pop();
    return slug || "CCFOLIA Room";
  }

  function normalizeExportedLogTitle(fileName) {
    const raw = String(fileName || "").trim();
    if (!raw) return "";

    const withoutQuery = raw.split(/[?#]/, 1)[0];
    const baseName = withoutQuery.split(/[\\/]/).pop() || "";
    return normalizeSpace(baseName.replace(/\.(html?|zip)$/i, ""));
  }

  function getOwnTextContent(element) {
    if (!(element instanceof HTMLElement)) return "";

    const directText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ");
    const normalizedDirect = normalizeSpace(directText);
    if (normalizedDirect) return normalizedDirect;

    return normalizeSpace(element.textContent || "");
  }

  function isUsableRoomTitle(value) {
    const text = normalizeSpace(value);
    if (!text) return false;
    if (/^ccfolia\b/i.test(text)) return false;
    if (/trpgオンラインセッションツール/i.test(text)) return false;
    return true;
  }

  function getRoomAddressLabel() {
    const parts = location.pathname.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1] || "";
    if (lastPart) return lastPart;

    const fallback = `${location.hostname}${location.pathname}`.replace(/[/:]+/g, "-");
    return fallback || "room";
  }

  function downloadBlob(fileName, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function makeZipEntry(name, data, date) {
    return {
      name,
      data,
      date: date instanceof Date ? date : new Date()
    };
  }

  function buildStoredZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encodeUtf8(entry.name);
      const dataBytes = entry.data instanceof Uint8Array ? entry.data : encodeUtf8(String(entry.data || ""));
      const crc = crc32(dataBytes);
      const dos = getDosDateTime(entry.date);

      const localHeader = new Uint8Array(30);
      const localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, dos.time, true);
      localView.setUint16(12, dos.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, dataBytes.length, true);
      localView.setUint32(22, dataBytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      locals.push(localHeader, nameBytes, dataBytes);

      const centralHeader = new Uint8Array(46);
      const centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, dos.time, true);
      centralView.setUint16(14, dos.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, dataBytes.length, true);
      centralView.setUint32(24, dataBytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      centrals.push(centralHeader, nameBytes);

      offset += localHeader.length + nameBytes.length + dataBytes.length;
    }

    const centralOffset = offset;
    const centralSize = sumLengths(centrals);
    const centralRecordCount = entries.length;

    const endHeader = new Uint8Array(22);
    const endView = new DataView(endHeader.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, centralRecordCount, true);
    endView.setUint16(10, centralRecordCount, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, centralOffset, true);
    endView.setUint16(20, 0, true);

    return concatUint8Arrays([...locals, ...centrals, endHeader]);
  }

  function getDosDateTime(value) {
    const date = value instanceof Date ? value : new Date();
    const year = Math.max(1980, date.getFullYear());
    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
    };
  }

  function crc32(bytes) {
    const table = getCrc32Table();
    let crc = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
  }

  let CRC32_TABLE = null;
  function getCrc32Table() {
    if (CRC32_TABLE) return CRC32_TABLE;

    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let current = i;
      for (let j = 0; j < 8; j += 1) {
        current = (current & 1) ? (0xEDB88320 ^ (current >>> 1)) : (current >>> 1);
      }
      table[i] = current >>> 0;
    }

    CRC32_TABLE = table;
    return table;
  }

  function concatUint8Arrays(parts) {
    const total = sumLengths(parts);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function sumLengths(parts) {
    return parts.reduce((sum, part) => sum + part.length, 0);
  }

  function encodeUtf8(value) {
    return new TextEncoder().encode(String(value || ""));
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return Array.isArray(value) ? [] : {};
    }
  }

  function formatDisplayDate(date) {
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  }

  function formatFileDate(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("") + "-" + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join("");
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  }

  function normalizeSpace(value) {
    return normalizeText(value).replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    let current = element;
    while (current && current !== document.body) {
      if (!(current instanceof HTMLElement)) return false;
      if (current.hidden) return false;
      if (current.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  const CAPYBARA_LOG_EDITOR_HTML = "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>카피바라 로그 편집기</title>\n<style>\n  :root {\n    --bg: #ffffff;\n    --bg-alt: #f4f4f4;\n    --bg-elev: #fafafa;\n    --fg: #111111;\n    --fg-muted: #666666;\n    --border: #d4d4d4;\n    --border-strong: #111111;\n    --accent: #111111;\n    --accent-fg: #ffffff;\n    --danger: #8a0000;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --bg: #0e0e0e;\n      --bg-alt: #161616;\n      --bg-elev: #1c1c1c;\n      --fg: #f0f0f0;\n      --fg-muted: #9a9a9a;\n      --border: #2a2a2a;\n      --border-strong: #f0f0f0;\n      --accent: #f0f0f0;\n      --accent-fg: #0e0e0e;\n      --danger: #ff8a8a;\n    }\n  }\n  * { box-sizing: border-box; }\n  html, body {\n    margin: 0;\n    padding: 0;\n    height: 100%;\n    background: var(--bg);\n    color: var(--fg);\n    font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Pretendard\", \"Noto Sans KR\", sans-serif;\n    font-size: 14px;\n    line-height: 1.5;\n  }\n  body {\n    display: grid;\n    grid-template-columns: 280px 1fr;\n    grid-template-rows: 100vh;\n  }\n  aside.sidebar {\n    border-right: 1px solid var(--border);\n    background: var(--bg-alt);\n    display: flex;\n    flex-direction: column;\n    overflow: hidden;\n  }\n  aside.sidebar header {\n    padding: 16px;\n    border-bottom: 1px solid var(--border);\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n  }\n  aside.sidebar h1 {\n    font-size: 16px;\n    margin: 0;\n    font-weight: 700;\n    letter-spacing: -0.01em;\n  }\n  aside.sidebar .room-list {\n    flex: 1;\n    overflow-y: auto;\n    padding: 8px 0;\n    list-style: none;\n    margin: 0;\n  }\n  aside.sidebar .room-list li {\n    padding: 0;\n    margin: 0;\n  }\n  aside.sidebar .room-item {\n    width: 100%;\n    text-align: left;\n    background: transparent;\n    border: 0;\n    padding: 10px 16px;\n    color: inherit;\n    font: inherit;\n    cursor: pointer;\n    display: block;\n    border-left: 3px solid transparent;\n  }\n  aside.sidebar .room-item:hover {\n    background: var(--bg-elev);\n  }\n  aside.sidebar .room-item.active {\n    background: var(--bg);\n    border-left-color: var(--border-strong);\n    font-weight: 600;\n  }\n  aside.sidebar .room-item .title {\n    display: block;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n  aside.sidebar .room-item .meta {\n    display: block;\n    font-size: 11px;\n    color: var(--fg-muted);\n    margin-top: 2px;\n  }\n  aside.sidebar .empty {\n    padding: 16px;\n    color: var(--fg-muted);\n    font-size: 13px;\n  }\n  aside.sidebar footer {\n    padding: 12px 16px;\n    border-top: 1px solid var(--border);\n    font-size: 12px;\n    color: var(--fg-muted);\n  }\n  main.content {\n    overflow-y: auto;\n    padding: 24px 32px;\n  }\n  .empty-state {\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    height: 100%;\n    color: var(--fg-muted);\n    text-align: center;\n    gap: 12px;\n  }\n  .empty-state h2 {\n    margin: 0;\n    font-size: 18px;\n    color: var(--fg);\n  }\n  .empty-state p {\n    margin: 0;\n    max-width: 460px;\n  }\n  .empty-state code {\n    font-family: ui-monospace, \"SF Mono\", Menlo, Consolas, monospace;\n    background: var(--bg-alt);\n    padding: 1px 6px;\n    border-radius: 3px;\n    font-size: 12px;\n  }\n  .room-header {\n    border-bottom: 1px solid var(--border);\n    padding-bottom: 16px;\n    margin-bottom: 16px;\n  }\n  .room-header h2 {\n    margin: 0 0 4px;\n    font-size: 20px;\n    font-weight: 700;\n  }\n  .room-header .room-meta {\n    color: var(--fg-muted);\n    font-size: 12px;\n    display: flex;\n    gap: 16px;\n    flex-wrap: wrap;\n  }\n  .room-header .room-actions {\n    margin-top: 12px;\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 8px;\n  }\n  button.btn {\n    background: transparent;\n    border: 1px solid var(--border);\n    color: var(--fg);\n    padding: 6px 12px;\n    border-radius: 4px;\n    cursor: pointer;\n    font: inherit;\n    font-size: 12px;\n  }\n  button.btn:hover {\n    border-color: var(--border-strong);\n  }\n  button.btn.danger {\n    color: var(--danger);\n    border-color: var(--danger);\n  }\n  button.btn.primary {\n    background: var(--accent);\n    color: var(--accent-fg);\n    border-color: var(--accent);\n  }\n  .tab-nav {\n    display: flex;\n    gap: 4px;\n    border-bottom: 1px solid var(--border);\n    margin-bottom: 16px;\n    overflow-x: auto;\n  }\n  .tab-nav button {\n    background: transparent;\n    border: 0;\n    border-bottom: 2px solid transparent;\n    padding: 8px 12px;\n    color: var(--fg-muted);\n    cursor: pointer;\n    font: inherit;\n    font-size: 13px;\n    white-space: nowrap;\n  }\n  .tab-nav button.active {\n    color: var(--fg);\n    border-bottom-color: var(--border-strong);\n    font-weight: 600;\n  }\n  .editor-option-panel {\n    margin: 14px 0 18px;\n    padding: 14px;\n    border: 1px solid var(--border);\n    border-radius: 8px;\n    background: var(--bg-elev);\n  }\n  .editor-option-title {\n    font-size: 12px;\n    font-weight: 800;\n    color: var(--fg-muted);\n    margin-bottom: 8px;\n  }\n  .tab-check-list {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n    margin-bottom: 12px;\n  }\n  .tab-check-item {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    padding: 6px 10px;\n    border: 1px solid var(--border);\n    border-radius: 999px;\n    background: var(--bg);\n    font-size: 12px;\n    cursor: pointer;\n    user-select: none;\n  }\n  .tab-check-item input {\n    accent-color: var(--accent);\n  }\n  .tab-check-item small {\n    color: var(--fg-muted);\n  }\n  .editor-option-row {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 12px;\n    margin-top: 8px;\n  }\n  .editor-option-row label {\n    font-size: 12px;\n    color: var(--fg-muted);\n  }\n  .editor-option-row select {\n    margin-left: 6px;\n    padding: 5px 8px;\n    border: 1px solid var(--border);\n    border-radius: 4px;\n    background: var(--bg);\n    color: var(--fg);\n  }\n  .merge-option-label {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n  }\n  .editor-option-actions {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n    margin-top: 12px;\n  }\n  .entry-list {\n    list-style: none;\n    margin: 0;\n    padding: 0;\n    display: flex;\n    flex-direction: column;\n    gap: 10px;\n  }\n  .entry {\n    display: grid;\n    grid-template-columns: 48px 1fr;\n    gap: 12px;\n    padding: 12px;\n    background: var(--bg-elev);\n    border: 1px solid var(--border);\n    border-radius: 6px;\n  }\n  .entry .avatar {\n    width: 48px;\n    height: 48px;\n    border-radius: 0;\n    background: var(--bg-alt);\n    overflow: hidden;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    border: 1px solid var(--border);\n    flex: 0 0 48px;\n  }\n  .entry .avatar img {\n    width: 100%;\n    height: 100%;\n    object-fit: cover;\n    display: block;\n  }\n  /* 화자에게 이미지가 지정되지 않은 경우, 아바타 슬롯은 비워두되\n     옅은 사람 실루엣을 배경으로 표시한다 (외부 의존성 없는 inline SVG). */\n  .entry .avatar:empty {\n    background-color: #f3f4f6;\n    background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23d1d5db'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E\");\n    background-size: 60%;\n    background-repeat: no-repeat;\n    background-position: center bottom;\n  }\n  @media (prefers-color-scheme: dark) {\n    .entry .avatar:empty {\n      background-color: #1c1c1c;\n      background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234a4a4a'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E\");\n    }\n  }\n  .entry .body { min-width: 0; }\n  .entry .head {\n    display: flex;\n    align-items: flex-start;\n    justify-content: space-between;\n    gap: 8px;\n    margin-bottom: 4px;\n  }\n  .entry .head-main {\n    min-width: 0;\n    display: flex;\n    align-items: baseline;\n    gap: 8px;\n    flex-wrap: wrap;\n  }\n  .entry .head-aux {\n    flex: 0 0 auto;\n    margin-left: auto;\n    display: flex;\n    justify-content: flex-end;\n    align-items: center;\n    gap: 6px;\n  }\n  .entry-actions {\n    display: inline-flex;\n    align-items: center;\n    gap: 4px;\n    margin-left: 4px;\n  }\n  .entry.system-entry .entry-actions {\n    justify-content: flex-end;\n    margin: 0;\n  }\n  .system-entry-actions {\n    position: absolute;\n    top: 12px;\n    right: 12px;\n    z-index: 1;\n    display: flex;\n    justify-content: flex-end;\n    margin: 0;\n  }\n  .entry.system-entry .system-entry-actions .entry-actions {\n    justify-content: flex-end;\n    margin: 0;\n  }\n  .entry-action-btn {\n    min-width: 28px;\n    height: 24px;\n    padding: 0 7px;\n    border: 1px solid var(--border);\n    border-radius: 4px;\n    background: var(--bg);\n    color: var(--fg-muted);\n    font: inherit;\n    font-size: 11px;\n    line-height: 1;\n    cursor: pointer;\n  }\n  .entry-action-btn:hover {\n    border-color: var(--border-strong);\n    color: var(--fg);\n  }\n  .entry-action-btn.danger {\n    color: var(--danger);\n    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));\n  }\n  .entry-edit-backdrop {\n    position: fixed;\n    inset: 0;\n    z-index: 2000;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    padding: 20px;\n    background: rgba(0, 0, 0, 0.46);\n  }\n  .entry-edit-dialog {\n    width: min(760px, 100%);\n    max-height: min(720px, calc(100vh - 40px));\n    display: flex;\n    flex-direction: column;\n    background: var(--bg);\n    color: var(--fg);\n    border: 1px solid var(--border);\n    border-radius: 8px;\n    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);\n    overflow: hidden;\n  }\n  .entry-edit-header {\n    display: flex;\n    align-items: flex-start;\n    justify-content: space-between;\n    gap: 12px;\n    padding: 14px 16px;\n    border-bottom: 1px solid var(--border);\n  }\n  .entry-edit-title {\n    min-width: 0;\n    font-size: 14px;\n    font-weight: 800;\n  }\n  .entry-edit-meta {\n    margin-top: 2px;\n    color: var(--fg-muted);\n    font-size: 12px;\n    font-weight: 400;\n  }\n  .entry-edit-body {\n    overflow-y: auto;\n    padding: 14px 16px 16px;\n  }\n  .entry-edit-toolbar {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px;\n    align-items: center;\n    margin-bottom: 10px;\n  }\n  .entry-edit-tool {\n    min-width: 30px;\n    height: 30px;\n    padding: 0 8px;\n    border: 1px solid var(--border);\n    border-radius: 4px;\n    background: var(--bg-alt);\n    color: var(--fg);\n    font: inherit;\n    font-size: 12px;\n    cursor: pointer;\n  }\n  .entry-edit-tool:hover {\n    border-color: var(--border-strong);\n  }\n  .entry-edit-color {\n    width: 34px;\n    height: 30px;\n    padding: 2px;\n    border: 1px solid var(--border);\n    border-radius: 4px;\n    background: var(--bg-alt);\n  }\n  .entry-rich-editor {\n    min-height: 180px;\n    max-height: 360px;\n    overflow: auto;\n    padding: 12px;\n    border: 1px solid var(--border);\n    border-radius: 6px;\n    background: var(--bg-elev);\n    outline: none;\n    white-space: pre-wrap;\n    word-break: break-word;\n  }\n  .entry-rich-editor:focus {\n    border-color: var(--border-strong);\n  }\n  .entry-edit-footer {\n    display: flex;\n    justify-content: flex-end;\n    gap: 8px;\n    padding: 12px 16px;\n    border-top: 1px solid var(--border);\n    background: var(--bg-alt);\n  }\n  .entry .speaker {\n    font-weight: 700;\n    font-size: 14px;\n  }\n  .entry .timestamp {\n    font-size: 11px;\n    color: var(--fg-muted);\n  }\n  .entry .channel {\n    font-size: 11px;\n    color: var(--fg-muted);\n    border: 1px solid var(--border);\n    border-radius: 3px;\n    padding: 0 6px;\n    line-height: 1.4;\n  }\n  .entry .text {\n    white-space: pre-wrap;\n    word-break: break-word;\n    font-size: 14px;\n  }\n  .entry .text img {\n    max-width: 100%;\n    height: auto;\n  }\n  .entry .text p {\n    margin: 0 0 4px;\n  }\n  .entry .text p:last-child {\n    margin-bottom: 0;\n  }\n  .entry.system-entry {\n    display: block;\n    position: relative;\n  }\n  .entry.system-entry .avatar,\n  .entry.system-entry .head {\n    display: none;\n  }\n  .entry.system-entry .body {\n    max-width: 86%;\n    margin: 0 auto;\n    text-align: center;\n    opacity: 0.92;\n  }\n  .entry.system-entry .text {\n    font-style: italic;\n    color: var(--fg-muted);\n  }\n\n  /* 패키지 렌더러(buildRenderedMessageHtml)가 만드는 구조용 규칙. */\n  .ccf-render-root .ccf-line {\n    display: block;\n  }\n  .ccf-render-root .ccf-image-frag {\n    position: relative;\n    display: inline-block;\n    width: 100%;\n    margin: 4px 0;\n    vertical-align: top;\n  }\n  .ccf-render-root .ccf-image {\n    display: block;\n    width: auto;\n    max-width: min(100%, 420px);\n    height: auto;\n    border: 0;\n    border-radius: 4px;\n    box-sizing: border-box;\n    margin: 0 auto;\n  }\n  /* 이미지 fragment에 함께 박혀있는 원본 URL 토큰을 숨긴다. */\n  .ccf-render-root .ccf-image-token {\n    display: inline-block;\n    width: 0;\n    height: 0;\n    overflow: hidden;\n    opacity: 0;\n    font-size: 0;\n    line-height: 0;\n    white-space: pre;\n    pointer-events: none;\n    user-select: none;\n  }\n  .ccf-render-root .ccf-frag {\n    white-space: pre-wrap;\n  }\n  .ccf-render-root .ccf-tooltip-frag {\n    border-bottom: 1px dotted var(--fg-muted);\n    cursor: help;\n  }\n  .ccf-render-root .ccf-code-frag {\n    font-family: ui-monospace, \"SF Mono\", Menlo, Consolas, monospace;\n    background: var(--bg-alt);\n    padding: 1px 4px;\n    border-radius: 3px;\n    font-size: 0.94em;\n  }\n  .ccf-render-root .ccf-code-frag.is-block {\n    display: block;\n    padding: 8px 10px;\n    margin: 4px 0;\n    white-space: pre;\n    overflow-x: auto;\n  }\n  .ccf-render-root .ccf-ruby-frag {\n    position: relative;\n    display: inline-block;\n    line-height: 1.8;\n  }\n  .ccf-render-root .ccf-ruby-frag::before {\n    content: attr(data-ruby);\n    position: absolute;\n    top: -0.85em;\n    left: 50%;\n    transform: translateX(-50%);\n    font-size: 0.55em;\n    font-weight: normal;\n    line-height: 1;\n    white-space: nowrap;\n    pointer-events: none;\n  }\n  .toast {\n    position: fixed;\n    right: 16px;\n    bottom: 16px;\n    background: var(--accent);\n    color: var(--accent-fg);\n    padding: 10px 14px;\n    border-radius: 4px;\n    font-size: 13px;\n    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);\n    opacity: 0;\n    transform: translateY(8px);\n    transition: opacity 0.18s ease, transform 0.18s ease;\n    pointer-events: none;\n    z-index: 1000;\n  }\n  .toast.visible {\n    opacity: 1;\n    transform: translateY(0);\n  }\n</style>\n</head>\n<body>\n<aside class=\"sidebar\">\n  <header>\n    <h1>카피바라 로그</h1>\n    <button class=\"btn\" id=\"btn-refresh\" title=\"목록 새로고침\">새로고침</button>\n  </header>\n  <ul class=\"room-list\" id=\"room-list\"></ul>\n  <footer id=\"storage-info\">v0.1</footer>\n</aside>\n<main class=\"content\" id=\"main-content\">\n  <div class=\"empty-state\" id=\"empty-state\">\n    <h2>대기 중</h2>\n    <p>코코포리아 룸의 환경설정 메뉴에서 <code>카피바라 로그</code> 버튼을 누르면 이 편집기로 로그가 전달됩니다.</p>\n    <p>이전에 받은 로그가 있다면 왼쪽 목록에서 선택할 수 있습니다.</p>\n  </div>\n</main>\n<div class=\"toast\" id=\"toast\"></div>\n\n<script>\n(() => {\n  \"use strict\";\n\n  const HANDOFF_MESSAGE_SOURCE = \"capybara-log-userscript\";\n  const HANDOFF_MESSAGE_TYPE = \"capybara-log:handoff\";\n  const HANDOFF_EDITOR_SOURCE = \"capybara-log-editor\";\n  const HANDOFF_READY_TYPE = \"capybara-log:editor-ready\";\n  const HANDOFF_ACK_TYPE = \"capybara-log:handoff-received\";\n  const HANDOFF_ERROR_TYPE = \"capybara-log:handoff-error\";\n  const DB_NAME = \"capybara-log-editor\";\n  const DB_VERSION = 1;\n  const STORE_ROOMS = \"rooms\";\n\n  const state = {\n    db: null,\n    rooms: [],\n    currentRoomId: \"\",\n    objectUrls: [],\n    selectedTabIds: new Set(),\n    selectedTabRoomId: \"\",\n    systemSpeaker: \"\",\n    mergeSameSpeaker: false\n  };\n\n  const els = {\n    roomList: document.getElementById(\"room-list\"),\n    main: document.getElementById(\"main-content\"),\n    emptyState: document.getElementById(\"empty-state\"),\n    refresh: document.getElementById(\"btn-refresh\"),\n    toast: document.getElementById(\"toast\"),\n    storageInfo: document.getElementById(\"storage-info\")\n  };\n\n  // ---------- IndexedDB ----------\n\n  function openDb() {\n    return new Promise((resolve, reject) => {\n      const req = indexedDB.open(DB_NAME, DB_VERSION);\n      req.onupgradeneeded = () => {\n        const db = req.result;\n        if (!db.objectStoreNames.contains(STORE_ROOMS)) {\n          db.createObjectStore(STORE_ROOMS, { keyPath: \"roomId\" });\n        }\n      };\n      req.onsuccess = () => resolve(req.result);\n      req.onerror = () => reject(req.error);\n    });\n  }\n\n  function tx(storeName, mode, op) {\n    return new Promise((resolve, reject) => {\n      const transaction = state.db.transaction(storeName, mode);\n      const store = transaction.objectStore(storeName);\n      const req = op(store);\n      req.onsuccess = () => resolve(req.result);\n      req.onerror = () => reject(req.error);\n    });\n  }\n\n  const putRoom = (room) => tx(STORE_ROOMS, \"readwrite\", (s) => s.put(room));\n  const getRoom = (roomId) => tx(STORE_ROOMS, \"readonly\", (s) => s.get(roomId));\n  const deleteRoom = (roomId) => tx(STORE_ROOMS, \"readwrite\", (s) => s.delete(roomId));\n  const listRooms = () =>\n    tx(STORE_ROOMS, \"readonly\", (s) => s.getAll())\n      .then((rooms) => (rooms || []).sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0)));\n\n  // ---------- Handoff bridge ----------\n\n  const seenHandoffKeys = new Set();\n\n  function setupMessageBridge() {\n    window.addEventListener(\"message\", async (event) => {\n      const data = event.data;\n      if (!data || typeof data !== \"object\") return;\n      if (data.source !== HANDOFF_MESSAGE_SOURCE) return;\n      if (data.type !== HANDOFF_MESSAGE_TYPE) return;\n\n      // 같은 핸드오프가 재전송 루프로 여러 번 들어올 수 있으니 중복 무시.\n      const key = makeHandoffKey(data);\n      if (seenHandoffKeys.has(key)) {\n        replyToOpener(event.source, { type: HANDOFF_ACK_TYPE });\n        return;\n      }\n      seenHandoffKeys.add(key);\n\n      try {\n        await ingestHandoff(data);\n        replyToOpener(event.source, { type: HANDOFF_ACK_TYPE });\n      } catch (error) {\n        console.error(\"[capybara-log-editor] handoff failed\", error);\n        showToast(\"핸드오프 처리 실패: \" + (error?.message || error));\n        replyToOpener(event.source, {\n          type: HANDOFF_ERROR_TYPE,\n          message: String(error?.message || error)\n        });\n      }\n    });\n\n    // 페이지가 준비되었음을 opener에게 알린다 (재전송 트리거).\n    notifyOpenerReady();\n  }\n\n  function makeHandoffKey(data) {\n    const ts = data?.record?.capturedAt || 0;\n    return `${data?.roomId || \"\"}::${ts}`;\n  }\n\n  function notifyOpenerReady() {\n    if (!window.opener) return;\n    try {\n      window.opener.postMessage({\n        source: HANDOFF_EDITOR_SOURCE,\n        type: HANDOFF_READY_TYPE\n      }, \"*\");\n    } catch (error) {\n      console.warn(\"[capybara-log-editor] notifyOpenerReady failed\", error);\n    }\n  }\n\n  function replyToOpener(target, message) {\n    const dest = target || window.opener;\n    if (!dest) return;\n    try {\n      dest.postMessage({\n        source: HANDOFF_EDITOR_SOURCE,\n        ...message\n      }, \"*\");\n    } catch (error) {\n      console.warn(\"[capybara-log-editor] reply failed\", error);\n    }\n  }\n\n  async function ingestHandoff({ roomId, roomUrl, record }) {\n    if (!roomId || !record || !record.payload) {\n      throw new Error(\"핸드오프 데이터가 비어있거나 형식이 올바르지 않습니다.\");\n    }\n    const payload = record.payload;\n    const room = {\n      roomId,\n      roomUrl: roomUrl || record.roomUrl || \"\",\n      roomTitle: payload.roomTitle || \"(제목 없음)\",\n      roomAddress: payload.roomAddress || \"\",\n      capturedAt: record.capturedAt || Date.now(),\n      lastUpdatedAt: Date.now(),\n      payload\n    };\n    await putRoom(room);\n    showToast(`「${room.roomTitle}」 로그를 저장했습니다.`);\n    await refreshRoomList();\n    await selectRoom(roomId);\n  }\n\n  // ---------- Asset / HTML rewriting ----------\n\n  function buildAssetMaps(assets) {\n    const bySource = new Map();\n    const byRenderUrl = new Map();\n    for (const asset of assets || []) {\n      if (!asset) continue;\n      const bytes = asset.bytes;\n      if (!(bytes instanceof Uint8Array) || !bytes.length) continue;\n      const blob = new Blob([bytes], { type: asset.mimeType || \"application/octet-stream\" });\n      const objectUrl = URL.createObjectURL(blob);\n      state.objectUrls.push(objectUrl);\n      if (asset.source) bySource.set(asset.source, objectUrl);\n      if (asset.fileName) byRenderUrl.set(asset.fileName, objectUrl);\n      if (asset.renderUrl) byRenderUrl.set(asset.renderUrl, objectUrl);\n    }\n    return { bySource, byRenderUrl };\n  }\n\n  function revokeObjectUrls() {\n    for (const url of state.objectUrls) {\n      try { URL.revokeObjectURL(url); } catch {}\n    }\n    state.objectUrls = [];\n  }\n\n  function rewriteEntryHtml(html, byRenderUrl) {\n    if (!html) return \"\";\n    const tpl = document.createElement(\"template\");\n    tpl.innerHTML = html;\n    for (const img of tpl.content.querySelectorAll(\"img[src]\")) {\n      const src = img.getAttribute(\"src\") || \"\";\n      const replacement = byRenderUrl.get(src);\n      if (replacement) img.setAttribute(\"src\", replacement);\n    }\n    for (const node of tpl.content.querySelectorAll(\"[style]\")) {\n      const style = node.getAttribute(\"style\") || \"\";\n      const updated = style.replace(/url\\((['\"]?)([^'\")]+)\\1\\)/g, (match, quote, url) => {\n        const replacement = byRenderUrl.get(url);\n        return replacement ? `url(${quote}${replacement}${quote})` : match;\n      });\n      if (updated !== style) node.setAttribute(\"style\", updated);\n    }\n    return tpl.innerHTML;\n  }\n\n  function resolveAvatarUrl(entry, assetMaps) {\n    const source = String(entry?.avatarSource || \"\").trim();\n    if (!source) return \"\";\n    const bundled = assetMaps.bySource.get(source);\n    if (bundled) return bundled;\n    if (/^\\/\\//.test(source)) return \"https:\" + source;\n    if (/^(https?:|data:image\\/)/i.test(source)) return source;\n    return \"\";\n  }\n\n  function buildTistoryAssetMaps(assets) {\n    const bySource = new Map();\n    const byRenderUrl = new Map();\n    for (const asset of assets || []) {\n      if (!asset) continue;\n      const dataUrl = assetToDataUrl(asset);\n      if (!dataUrl) continue;\n      addAssetMapKey(bySource, asset.source, dataUrl);\n      addAssetMapKey(byRenderUrl, asset.source, dataUrl);\n      addAssetMapKey(byRenderUrl, asset.fileName, dataUrl);\n      addAssetMapKey(byRenderUrl, asset.renderUrl, dataUrl);\n    }\n    return { bySource, byRenderUrl };\n  }\n\n  function addAssetMapKey(map, key, value) {\n    if (!key || !value) return;\n    map.set(String(key), value);\n  }\n\n  function assetToDataUrl(asset) {\n    const bytes = toUint8Array(asset?.bytes);\n    if (!bytes || !bytes.length) return \"\";\n    const mimeType = asset.mimeType || guessMimeTypeFromName(asset.fileName || asset.source || \"\") || \"image/png\";\n    return `data:${mimeType};base64,${uint8ArrayToBase64(bytes)}`;\n  }\n\n  function toUint8Array(value) {\n    if (value instanceof Uint8Array) return value;\n    if (value instanceof ArrayBuffer) return new Uint8Array(value);\n    if (Array.isArray(value)) return Uint8Array.from(value);\n    return null;\n  }\n\n  function uint8ArrayToBase64(bytes) {\n    let binary = \"\";\n    const chunkSize = 0x8000;\n    for (let i = 0; i < bytes.length; i += chunkSize) {\n      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));\n    }\n    return btoa(binary);\n  }\n\n  function guessMimeTypeFromName(value) {\n    const lower = String(value || \"\").split(\"?\")[0].toLowerCase();\n    if (lower.endsWith(\".jpg\") || lower.endsWith(\".jpeg\")) return \"image/jpeg\";\n    if (lower.endsWith(\".png\")) return \"image/png\";\n    if (lower.endsWith(\".gif\")) return \"image/gif\";\n    if (lower.endsWith(\".webp\")) return \"image/webp\";\n    if (lower.endsWith(\".svg\")) return \"image/svg+xml\";\n    return \"\";\n  }\n\n  // ---------- Render ----------\n\n  async function refreshRoomList() {\n    state.rooms = await listRooms();\n    renderRoomList();\n    updateStorageInfo();\n  }\n\n  function renderRoomList() {\n    if (!state.rooms.length) {\n      els.roomList.innerHTML = '<li class=\"empty\">저장된 룸이 없습니다.</li>';\n      return;\n    }\n    const fmt = new Intl.DateTimeFormat(\"ko-KR\", {\n      month: \"2-digit\", day: \"2-digit\", hour: \"2-digit\", minute: \"2-digit\"\n    });\n    const html = state.rooms.map((room) => {\n      const isActive = room.roomId === state.currentRoomId ? \" active\" : \"\";\n      const captured = room.capturedAt ? fmt.format(new Date(room.capturedAt)) : \"\";\n      const title = escapeHtml(room.roomTitle || \"(제목 없음)\");\n      const subtitle = `${escapeHtml(room.roomId)}${captured ? ` · ${captured}` : \"\"}`;\n      return `<li>\n        <button class=\"room-item${isActive}\" data-room-id=\"${escapeAttr(room.roomId)}\">\n          <span class=\"title\">${title}</span>\n          <span class=\"meta\">${subtitle}</span>\n        </button>\n      </li>`;\n    }).join(\"\");\n    els.roomList.innerHTML = html;\n    els.roomList.querySelectorAll(\".room-item\").forEach((btn) => {\n      btn.addEventListener(\"click\", () => selectRoom(btn.dataset.roomId || \"\"));\n    });\n  }\n\n  async function selectRoom(roomId) {\n    if (!roomId) return;\n    const room = await getRoom(roomId);\n    if (!room) {\n      showToast(\"룸 데이터를 찾지 못했습니다.\");\n      return;\n    }\n    state.currentRoomId = roomId;\n    renderRoomList();\n    renderRoom(room);\n  }\n\n  function renderRoom(room) {\n    revokeObjectUrls();\n    const payload = room.payload || {};\n    const assets = Array.isArray(payload.assets) ? payload.assets : [];\n    const entries = Array.isArray(payload.entries) ? payload.entries : [];\n    const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];\n    const assetMaps = buildAssetMaps(assets);\n\n    const fmtFull = new Intl.DateTimeFormat(\"ko-KR\", {\n      year: \"numeric\", month: \"2-digit\", day: \"2-digit\",\n      hour: \"2-digit\", minute: \"2-digit\", second: \"2-digit\"\n    });\n    const capturedAt = room.capturedAt ? fmtFull.format(new Date(room.capturedAt)) : \"\";\n    const exportedAt = payload.exportedAt ? fmtFull.format(new Date(payload.exportedAt)) : \"\";\n\n    const meta = [];\n    if (room.roomId) meta.push(`룸 ID: <code>${escapeHtml(room.roomId)}</code>`);\n    if (capturedAt) meta.push(`캡처: ${capturedAt}`);\n    if (exportedAt && exportedAt !== capturedAt) meta.push(`추출: ${exportedAt}`);\n    meta.push(`메시지: ${entries.length.toLocaleString(\"ko-KR\")}건`);\n\n    const speakerOptions = getSpeakerOptions(entries);\n    const tabIds = tabs.length\n      ? tabs.map((tab, i) => tab?.id || `tab-${i + 1}`)\n      : [\"tab-1\"];\n    const roomSelectionId = room.roomId || room.roomUrl || room.roomTitle || \"\";\n    if (state.selectedTabRoomId !== roomSelectionId) {\n      state.selectedTabIds = new Set(tabIds);\n      state.selectedTabRoomId = roomSelectionId;\n    } else {\n      const validTabIds = new Set(tabIds);\n      state.selectedTabIds = new Set([...state.selectedTabIds].filter((id) => validTabIds.has(id)));\n    }\n\n    const tabsHtml = entries.length\n      ? `<div class=\"editor-option-panel\">\n          ${tabs.length ? `\n            <div class=\"editor-option-title\">출력 탭 선택</div>\n            <div class=\"tab-check-list\">\n              ${tabs.map((tab, i) => {\n                const id = tab?.id || `tab-${i + 1}`;\n                const label = escapeHtml(tab?.name || `탭 ${i + 1}`);\n                const count = Number.isFinite(tab?.messageCount) ? tab.messageCount : 0;\n                const checked = state.selectedTabIds.has(id) ? \" checked\" : \"\";\n                return `<label class=\"tab-check-item\">\n                  <input type=\"checkbox\" class=\"js-output-tab-check\" value=\"${escapeAttr(id)}\"${checked}>\n                  <span>${label}</span>\n                  <small>${count}</small>\n                </label>`;\n              }).join(\"\")}\n            </div>\n          ` : \"\"}\n          <div class=\"editor-option-row\">\n            <label>\n              시스템/나레이터 화자\n              <select id=\"system-speaker-select\">\n                <option value=\"\">지정 안 함</option>\n                ${speakerOptions.map((name) => `\n                  <option value=\"${escapeAttr(name)}\"${state.systemSpeaker === name ? \" selected\" : \"\"}>\n                    ${escapeHtml(name)}\n                  </option>\n                `).join(\"\")}\n              </select>\n            </label>\n            <label class=\"merge-option-label\">\n              <input type=\"checkbox\" id=\"merge-same-speaker\"${state.mergeSameSpeaker ? \" checked\" : \"\"}>\n              동일 화자 연속 발언 병합\n            </label>\n          </div>\n        </div>`\n      : \"\";\n    const tistoryActionHtml = entries.length\n      ? `\n          <button class=\"btn\" id=\"btn-copy-tistory-html\">티스토리용 HTML 복사</button>\n          <button class=\"btn\" id=\"btn-preview-tistory-html\">티스토리 HTML 보기</button>`\n      : \"\";\n\n    els.main.innerHTML = `\n      <section class=\"room-header\">\n        <h2>${escapeHtml(room.roomTitle || \"(제목 없음)\")}</h2>\n        <div class=\"room-meta\">${meta.join(\" · \")}</div>\n        <div class=\"room-actions\">\n          <button class=\"btn danger\" id=\"btn-delete-room\">이 룸 데이터 삭제</button>\n          ${tistoryActionHtml}\n        </div>\n      </section>\n      ${tabsHtml}\n      <ol class=\"entry-list\" id=\"entry-list\"></ol>\n    `;\n\n    renderSelectedTabEntries(room, assetMaps);\n\n    const deleteBtn = document.getElementById(\"btn-delete-room\");\n    if (deleteBtn) {\n      deleteBtn.addEventListener(\"click\", async () => {\n        if (!confirm(`「${room.roomTitle}」 의 저장 데이터를 삭제할까요?`)) return;\n        await deleteRoom(room.roomId);\n        state.currentRoomId = \"\";\n        revokeObjectUrls();\n        await refreshRoomList();\n        showEmpty();\n      });\n    }\n\n    els.main.querySelectorAll(\".js-output-tab-check\").forEach((checkbox) => {\n      checkbox.addEventListener(\"change\", () => {\n        state.selectedTabIds = new Set(\n          [...els.main.querySelectorAll(\".js-output-tab-check:checked\")]\n            .map((input) => input.value)\n            .filter(Boolean)\n        );\n        renderSelectedTabEntries(room, assetMaps);\n      });\n    });\n\n    const systemSpeakerSelect = document.getElementById(\"system-speaker-select\");\n    if (systemSpeakerSelect) {\n      systemSpeakerSelect.addEventListener(\"change\", () => {\n        state.systemSpeaker = systemSpeakerSelect.value || \"\";\n        renderSelectedTabEntries(room, assetMaps);\n      });\n    }\n\n    const mergeCheckbox = document.getElementById(\"merge-same-speaker\");\n    if (mergeCheckbox) {\n      mergeCheckbox.addEventListener(\"change\", () => {\n        state.mergeSameSpeaker = !!mergeCheckbox.checked;\n        renderSelectedTabEntries(room, assetMaps);\n      });\n    }\n\n    const copyTistoryBtn = document.getElementById(\"btn-copy-tistory-html\");\n    if (copyTistoryBtn) {\n      copyTistoryBtn.addEventListener(\"click\", async () => {\n        try {\n          const html = buildEditorTistoryHtml(room);\n          await navigator.clipboard.writeText(html);\n          showToast(\"티스토리용 HTML을 복사했습니다.\");\n        } catch (error) {\n          showToast(\"티스토리 HTML 복사 실패: \" + (error?.message || error));\n        }\n      });\n    }\n\n    const previewTistoryBtn = document.getElementById(\"btn-preview-tistory-html\");\n    if (previewTistoryBtn) {\n      previewTistoryBtn.addEventListener(\"click\", () => {\n        const html = buildEditorTistoryHtml(room);\n        openTistoryPreview(html);\n      });\n    }\n  }\n\n  function getSpeakerOptions(entries) {\n    const seen = new Set();\n    const out = [];\n    for (const entry of Array.isArray(entries) ? entries : []) {\n      const name = String(entry?.sender || \"\").trim();\n      if (!name || seen.has(name)) continue;\n      seen.add(name);\n      out.push(name);\n    }\n    return out.sort((a, b) => a.localeCompare(b, \"ko\"));\n  }\n\n  function getSelectedTabEntries(room) {\n    const payload = room?.payload || {};\n    const entries = Array.isArray(payload.entries) ? payload.entries : [];\n    const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];\n    if (!tabs.length) return entries.slice();\n    if (!state.selectedTabIds.size) return [];\n\n    return entries.filter((entry) => {\n      const tabId = String(entry?.tabId || \"\");\n      if (tabId) return state.selectedTabIds.has(tabId);\n\n      const tabIndex = Number.isFinite(entry?.tabIndex)\n        ? Number(entry.tabIndex)\n        : (Number.isFinite(entry?.tabOrder) ? Number(entry.tabOrder) - 1 : NaN);\n      if (Number.isFinite(tabIndex)) {\n        const fallbackId = tabs[tabIndex]?.id || `tab-${tabIndex + 1}`;\n        return state.selectedTabIds.has(fallbackId);\n      }\n\n      return true;\n    });\n  }\n\n  function mergeConsecutiveSpeakerEntries(entries, systemSpeaker = \"\") {\n    const out = [];\n    for (const entry of Array.isArray(entries) ? entries : []) {\n      if (!entry) continue;\n\n      const sender = String(entry.sender || \"\").trim();\n      const tabId = String(entry.tabId || \"\").trim();\n      const isSystem = !!(systemSpeaker && sender === systemSpeaker);\n      const prev = out[out.length - 1];\n      const prevSender = String(prev?.sender || \"\").trim();\n      const prevTabId = String(prev?.tabId || \"\").trim();\n\n      const canMerge =\n        !!sender &&\n        prev &&\n        prevSender === sender &&\n        prevTabId === tabId;\n\n      if (!canMerge) {\n        out.push({\n          ...entry,\n          __isSystemSpeaker: isSystem,\n          __mergedEntries: [entry]\n        });\n        continue;\n      }\n\n      if (!Array.isArray(prev.__mergedEntries)) prev.__mergedEntries = [];\n      prev.__mergedEntries.push(entry);\n\n      prev.text = [prev.text || \"\", entry.text || \"\"].filter(Boolean).join(\"\\n\");\n      prev.visibleText = [prev.visibleText || \"\", entry.visibleText || \"\"].filter(Boolean).join(\"\\n\");\n\n      const prevHtml = prev.packageHtml || prev.bodyHtml || \"\";\n      const nextHtml = entry.packageHtml || entry.bodyHtml || \"\";\n      const mergedHtml = [prevHtml, nextHtml].filter(Boolean).join(\"<br>\");\n      prev.packageHtml = mergedHtml;\n      prev.bodyHtml = mergedHtml;\n\n      if (!prev.timestamp && entry.timestamp) prev.timestamp = entry.timestamp;\n    }\n    return out;\n  }\n\n  function renderSelectedTabEntries(room, assetMaps) {\n    let selectedEntries = getSelectedTabEntries(room);\n    if (state.mergeSameSpeaker) {\n      selectedEntries = mergeConsecutiveSpeakerEntries(selectedEntries, state.systemSpeaker);\n    }\n    renderEntries(selectedEntries, assetMaps, room);\n  }\n\n  function renderEntries(entries, assetMaps, room = null) {\n    const listEl = document.getElementById(\"entry-list\");\n    if (!listEl) return;\n    if (!entries.length) {\n      listEl.innerHTML = '<li class=\"empty-state\"><p>표시할 메시지가 없습니다.</p></li>';\n      return;\n    }\n    const html = entries.map((entry, displayIndex) => {\n      const senderText = entry?.sender || \"\";\n      const speaker = escapeHtml(senderText || \"(이름 없음)\");\n      const speakerStyle = entry?.baseColor\n        ? ` style=\"color:${escapeAttr(entry.baseColor)}\"`\n        : \"\";\n      const timestamp = formatEntryTimestamp(entry?.timestamp);\n      const channel = entry?.channel ? escapeHtml(entry.channel) : \"\";\n      const avatarUrl = resolveAvatarUrl(entry, assetMaps);\n      const isSystemSpeaker = !!(entry?.__isSystemSpeaker || (state.systemSpeaker && senderText === state.systemSpeaker));\n      const avatarHtml = !isSystemSpeaker && avatarUrl\n        ? `<img src=\"${escapeAttr(avatarUrl)}\" alt=\"${escapeAttr(senderText ? `${senderText} avatar` : \"avatar\")}\">`\n        : \"\";\n      const bodyHtml = rewriteEntryHtml(entry?.packageHtml || entry?.bodyHtml || \"\", assetMaps.byRenderUrl);\n      const entryIndex = getRoomEntryIndex(room, entry);\n      const mergedEntries = Array.isArray(entry?.__mergedEntries) ? entry.__mergedEntries : [];\n      const canEditEntry = state.mergeSameSpeaker ? mergedEntries.length > 0 : entryIndex >= 0;\n      const canDeleteEntry = !state.mergeSameSpeaker && entryIndex >= 0;\n      const actionHtml = canEditEntry\n        ? `<div class=\"entry-actions\">\n            <button type=\"button\" class=\"entry-action-btn js-edit-entry\" data-entry-index=\"${entryIndex}\" data-display-index=\"${displayIndex}\" title=\"메시지 수정\">수정</button>\n            ${canDeleteEntry ? `<button type=\"button\" class=\"entry-action-btn danger js-delete-entry\" data-entry-index=\"${entryIndex}\" title=\"메시지 삭제\">삭제</button>` : \"\"}\n          </div>`\n        : \"\";\n      const systemActionHtml = isSystemSpeaker && actionHtml\n        ? `<div class=\"system-entry-actions\">${actionHtml}</div>`\n        : \"\";\n      return `<li class=\"entry${isSystemSpeaker ? \" system-entry\" : \"\"}\">\n        ${systemActionHtml}\n        <div class=\"avatar\">${avatarHtml}</div>\n        <div class=\"body\">\n          <div class=\"head\">\n            <div class=\"head-main\">\n              <span class=\"speaker\"${speakerStyle}>${speaker}</span>\n              ${timestamp ? `<span class=\"timestamp\">${escapeHtml(timestamp)}</span>` : \"\"}\n            </div>\n            <div class=\"head-aux\">\n              ${channel ? `<span class=\"channel\">${channel}</span>` : \"\"}\n              ${isSystemSpeaker ? \"\" : actionHtml}\n            </div>\n          </div>\n          <div class=\"text ccf-render-root\">${bodyHtml}</div>\n        </div>\n      </li>`;\n    }).join(\"\");\n    listEl.innerHTML = html;\n\n    listEl.querySelectorAll(\".js-edit-entry\").forEach((button) => {\n      button.addEventListener(\"click\", () => {\n        const displayIndex = Number(button.dataset.displayIndex);\n        const displayEntry = Number.isInteger(displayIndex) ? entries[displayIndex] : null;\n        openEntryEditDialog(room, Number(button.dataset.entryIndex), displayEntry);\n      });\n    });\n\n    listEl.querySelectorAll(\".js-delete-entry\").forEach((button) => {\n      button.addEventListener(\"click\", () => {\n        deleteEntryAtIndex(room, Number(button.dataset.entryIndex)).catch((error) => {\n          showToast(\"메시지 삭제 실패: \" + (error?.message || error));\n        });\n      });\n    });\n  }\n\n  function getRoomEntryIndex(room, entry) {\n    const entries = Array.isArray(room?.payload?.entries) ? room.payload.entries : [];\n    if (!entry || !entries.length) return -1;\n\n    const directIndex = entries.indexOf(entry);\n    if (directIndex >= 0) return directIndex;\n\n    const id = String(entry.id || \"\");\n    if (id) {\n      const idIndex = entries.findIndex((candidate) => String(candidate?.id || \"\") === id);\n      if (idIndex >= 0) return idIndex;\n    }\n\n    return -1;\n  }\n\n  async function deleteEntryAtIndex(room, entryIndex) {\n    const entries = Array.isArray(room?.payload?.entries) ? room.payload.entries : [];\n    if (!room || !entries[entryIndex]) return;\n\n    const entry = entries[entryIndex];\n    const speaker = String(entry.sender || \"\").trim() || \"(이름 없음)\";\n    if (!confirm(`「${speaker}」 메시지를 삭제할까요?`)) return;\n\n    entries.splice(entryIndex, 1);\n    await persistRoomMutation(room, \"메시지를 삭제했습니다.\");\n  }\n\n  function openEntryEditDialog(room, entryIndex, displayEntry = null) {\n    const sourceEntries = Array.isArray(room?.payload?.entries) ? room.payload.entries : [];\n    const entry = displayEntry || sourceEntries[entryIndex] || null;\n    if (!room || !entry) return;\n\n    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;\n    const overlay = document.createElement(\"div\");\n    overlay.className = \"entry-edit-backdrop\";\n    overlay.innerHTML = `\n      <section class=\"entry-edit-dialog\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"entry-edit-title\">\n        <header class=\"entry-edit-header\">\n          <div>\n            <div class=\"entry-edit-title\" id=\"entry-edit-title\">${escapeHtml(entry.sender || \"(이름 없음)\")}</div>\n            <div class=\"entry-edit-meta\">${escapeHtml([entry.channel, formatEntryTimestamp(entry.timestamp)].filter(Boolean).join(\" · \"))}</div>\n          </div>\n          <button type=\"button\" class=\"entry-action-btn js-entry-edit-close\" title=\"닫기\">×</button>\n        </header>\n        <div class=\"entry-edit-body\">\n          <div class=\"entry-edit-toolbar\" aria-label=\"텍스트 서식\">\n            <button type=\"button\" class=\"entry-edit-tool\" data-command=\"bold\" title=\"굵게\"><b>B</b></button>\n            <button type=\"button\" class=\"entry-edit-tool\" data-command=\"italic\" title=\"기울임\"><i>I</i></button>\n            <button type=\"button\" class=\"entry-edit-tool\" data-command=\"underline\" title=\"밑줄\"><u>U</u></button>\n            <button type=\"button\" class=\"entry-edit-tool\" data-command=\"strikeThrough\" title=\"취소선\"><s>S</s></button>\n            <input type=\"color\" class=\"entry-edit-color\" value=\"${escapeAttr(readEntryTextColor(entry) || \"#111111\")}\" title=\"글자색\">\n            <button type=\"button\" class=\"entry-edit-tool\" data-command=\"removeFormat\" title=\"서식 제거\">Tx</button>\n          </div>\n          <div class=\"entry-rich-editor ccf-render-root\" contenteditable=\"true\" spellcheck=\"false\"></div>\n        </div>\n        <footer class=\"entry-edit-footer\">\n          <button type=\"button\" class=\"btn js-entry-edit-cancel\">취소</button>\n          <button type=\"button\" class=\"btn primary js-entry-edit-save\">저장</button>\n        </footer>\n      </section>\n    `;\n\n    document.body.appendChild(overlay);\n\n    const editor = overlay.querySelector(\".entry-rich-editor\");\n    if (editor instanceof HTMLElement) {\n      editor.innerHTML = getEditableEntryHtml(entry);\n      editor.focus();\n      placeCursorAtEnd(editor);\n    }\n\n    const close = () => {\n      overlay.remove();\n      if (previousActive) {\n        try { previousActive.focus(); } catch {}\n      }\n    };\n\n    overlay.addEventListener(\"click\", (event) => {\n      if (event.target === overlay) close();\n    });\n\n    overlay.querySelector(\".js-entry-edit-close\")?.addEventListener(\"click\", close);\n    overlay.querySelector(\".js-entry-edit-cancel\")?.addEventListener(\"click\", close);\n\n    overlay.querySelectorAll(\"[data-command]\").forEach((button) => {\n      button.addEventListener(\"click\", () => {\n        const command = button.getAttribute(\"data-command\") || \"\";\n        if (!command || !(editor instanceof HTMLElement)) return;\n        editor.focus();\n        document.execCommand(command, false, null);\n      });\n    });\n\n    const colorInput = overlay.querySelector(\".entry-edit-color\");\n    if (colorInput instanceof HTMLInputElement) {\n      colorInput.addEventListener(\"input\", () => {\n        if (!(editor instanceof HTMLElement)) return;\n        editor.focus();\n        document.execCommand(\"foreColor\", false, colorInput.value);\n      });\n    }\n\n    overlay.querySelector(\".js-entry-edit-save\")?.addEventListener(\"click\", async () => {\n      if (!(editor instanceof HTMLElement)) return;\n      try {\n        const editedHtml = sanitizeEditedEntryHtml(editor.innerHTML);\n        if (getMergedSourceEntries(room, entry).length) {\n          applyEditedMergedEntryHtml(room, entry, editedHtml);\n        } else {\n          applyEditedEntryHtml(sourceEntries[entryIndex] || entry, editedHtml);\n        }\n        await persistRoomMutation(room, \"메시지를 수정했습니다.\");\n        close();\n      } catch (error) {\n        showToast(\"메시지 수정 실패: \" + (error?.message || error));\n      }\n    });\n\n    overlay.addEventListener(\"keydown\", (event) => {\n      if (event.key === \"Escape\") {\n        event.preventDefault();\n        close();\n      }\n      if ((event.ctrlKey || event.metaKey) && event.key === \"Enter\") {\n        event.preventDefault();\n        overlay.querySelector(\".js-entry-edit-save\")?.dispatchEvent(new MouseEvent(\"click\", { bubbles: true }));\n      }\n    });\n  }\n\n  function getEditableEntryHtml(entry) {\n    const mergedEntries = Array.isArray(entry?.__mergedEntries) ? entry.__mergedEntries : [];\n    if (mergedEntries.length > 1) {\n      return mergedEntries\n        .map((sourceEntry) => getSingleEditableEntryHtml(sourceEntry))\n        .join('<br data-capybara-merge-break=\"1\">');\n    }\n    return getSingleEditableEntryHtml(entry);\n  }\n\n  function getSingleEditableEntryHtml(entry) {\n    const html = String(entry?.packageHtml || entry?.bodyHtml || \"\").trim();\n    if (html) return html;\n    return escapeHtml(entry?.text || entry?.visibleText || \"\").replace(/\\n/g, \"<br>\");\n  }\n\n  function getMergedSourceEntries(room, entry) {\n    const roomEntries = Array.isArray(room?.payload?.entries) ? room.payload.entries : [];\n    const mergedEntries = Array.isArray(entry?.__mergedEntries) ? entry.__mergedEntries : [];\n    if (!roomEntries.length || !mergedEntries.length) return [];\n\n    return mergedEntries.map((sourceEntry) => {\n      const index = getRoomEntryIndex(room, sourceEntry);\n      return index >= 0 ? roomEntries[index] : null;\n    }).filter(Boolean);\n  }\n\n  function applyEditedMergedEntryHtml(room, mergedEntry, html) {\n    const sourceEntries = getMergedSourceEntries(room, mergedEntry);\n    if (!sourceEntries.length) {\n      applyEditedEntryHtml(mergedEntry, stripMergeBoundaryBreaks(html));\n      return;\n    }\n\n    if (sourceEntries.length === 1) {\n      applyEditedEntryHtml(sourceEntries[0], stripMergeBoundaryBreaks(html));\n      return;\n    }\n\n    const parts = splitMergedEditableHtml(html).map((part) => stripMergeBoundaryBreaks(part));\n    if (parts.length <= 1) {\n      applyEditedEntryHtml(sourceEntries[0], stripMergeBoundaryBreaks(html));\n      removeRoomEntries(room, sourceEntries.slice(1));\n      return;\n    }\n\n    const usableParts = parts.slice(0, sourceEntries.length);\n    const overflowParts = parts.slice(sourceEntries.length).filter((part) => String(part || \"\").trim());\n    if (overflowParts.length) {\n      const lastIndex = usableParts.length - 1;\n      usableParts[lastIndex] = [usableParts[lastIndex], ...overflowParts].filter(Boolean).join(\"<br>\");\n    }\n\n    usableParts.forEach((part, index) => {\n      applyEditedEntryHtml(sourceEntries[index], part);\n    });\n\n    if (usableParts.length < sourceEntries.length) {\n      removeRoomEntries(room, sourceEntries.slice(usableParts.length));\n    }\n  }\n\n  function splitMergedEditableHtml(html) {\n    return String(html || \"\").split(/<br\\b(?=[^>]*\\bdata-capybara-merge-break\\s*=\\s*(?:\"1\"|'1'|1))[^>]*>/gi);\n  }\n\n  function stripMergeBoundaryBreaks(html) {\n    return String(html || \"\").replace(/<br\\b(?=[^>]*\\bdata-capybara-merge-break\\s*=\\s*(?:\"1\"|'1'|1))[^>]*>/gi, \"<br>\");\n  }\n\n  function removeRoomEntries(room, entriesToRemove) {\n    const roomEntries = Array.isArray(room?.payload?.entries) ? room.payload.entries : [];\n    if (!roomEntries.length || !entriesToRemove?.length) return;\n\n    const removeSet = new Set(entriesToRemove);\n    for (let index = roomEntries.length - 1; index >= 0; index -= 1) {\n      if (removeSet.has(roomEntries[index])) {\n        roomEntries.splice(index, 1);\n      }\n    }\n  }\n\n  function applyEditedEntryHtml(entry, html) {\n    if (!entry || typeof entry !== \"object\") return;\n    const plainText = htmlToPlainText(html);\n    entry.bodyHtml = html;\n    entry.packageHtml = html;\n    entry.text = plainText;\n    entry.visibleText = plainText;\n    entry.rawText = plainText;\n    entry.formatRuns = [];\n    entry.alignRuns = [];\n    entry.blockStyle = {};\n    entry.formatEnvelopeVersion = null;\n    entry.editedAt = new Date().toISOString();\n  }\n\n  async function persistRoomMutation(room, message) {\n    if (!room || !room.payload) return;\n    room.lastUpdatedAt = Date.now();\n    room.payload.editedAt = new Date().toISOString();\n    refreshTabMessageCounts(room);\n    await putRoom(room);\n    await refreshRoomList();\n    renderRoom(room);\n    if (message) showToast(message);\n  }\n\n  function refreshTabMessageCounts(room) {\n    const entries = Array.isArray(room?.payload?.entries) ? room.payload.entries : [];\n    const tabs = Array.isArray(room?.payload?.tabs) ? room.payload.tabs : [];\n    if (!tabs.length) return;\n\n    tabs.forEach((tab, index) => {\n      const tabId = String(tab?.id || `tab-${index + 1}`);\n      tab.messageCount = entries.filter((entry) => isEntryInTab(entry, tabId, index, tabs.length)).length;\n    });\n  }\n\n  function isEntryInTab(entry, tabId, tabIndex, tabCount) {\n    if (!entry || typeof entry !== \"object\") return false;\n    const entryTabId = String(entry.tabId || \"\");\n    if (entryTabId) return entryTabId === tabId;\n\n    const entryTabIndex = Number.isFinite(entry.tabIndex)\n      ? Number(entry.tabIndex)\n      : (Number.isFinite(entry.tabOrder) ? Number(entry.tabOrder) - 1 : NaN);\n    if (Number.isFinite(entryTabIndex)) return entryTabIndex === tabIndex;\n    return tabCount <= 1;\n  }\n\n  function sanitizeEditedEntryHtml(html) {\n    const tpl = document.createElement(\"template\");\n    tpl.innerHTML = String(html || \"\");\n    tpl.content.querySelectorAll(\"script, iframe, object, embed, link, meta\").forEach((node) => node.remove());\n\n    tpl.content.querySelectorAll(\"*\").forEach((node) => {\n      [...node.attributes].forEach((attr) => {\n        const name = attr.name.toLowerCase();\n        const value = attr.value || \"\";\n        if (name.startsWith(\"on\")) {\n          node.removeAttribute(attr.name);\n          return;\n        }\n        if ((name === \"href\" || name === \"src\") && /^\\s*javascript:/i.test(value)) {\n          node.removeAttribute(attr.name);\n          return;\n        }\n        if (name === \"style\" && /(?:expression\\s*\\(|javascript:)/i.test(value)) {\n          node.removeAttribute(attr.name);\n        }\n      });\n    });\n\n    return tpl.innerHTML.trim();\n  }\n\n  function htmlToPlainText(html) {\n    const container = document.createElement(\"div\");\n    container.innerHTML = String(html || \"\");\n    container.querySelectorAll(\"br\").forEach((br) => br.replaceWith(\"\\n\"));\n    container.querySelectorAll(\"p, div, li, .ccf-line\").forEach((node) => {\n      if (!node.textContent?.endsWith(\"\\n\")) {\n        node.appendChild(document.createTextNode(\"\\n\"));\n      }\n    });\n    return container.textContent\n      .replace(/\\r\\n?/g, \"\\n\")\n      .replace(/\\n{3,}/g, \"\\n\\n\")\n      .trim();\n  }\n\n  function readEntryTextColor(entry) {\n    const color = String(entry?.baseColor || \"\").trim();\n    const probe = document.createElement(\"span\");\n    probe.style.color = color;\n    const normalized = probe.style.color || \"\";\n    if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;\n\n    const match = normalized.match(/^rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)$/i);\n    if (!match) return \"\";\n    return \"#\" + match.slice(1).map((part) => Number(part).toString(16).padStart(2, \"0\")).join(\"\");\n  }\n\n  function normalizeCssColorForHtml(value) {\n    const color = String(value || \"\").trim();\n    if (!color) return \"\";\n    const probe = document.createElement(\"span\");\n    probe.style.color = color;\n    return probe.style.color || \"\";\n  }\n\n  function placeCursorAtEnd(element) {\n    const selection = window.getSelection();\n    if (!selection) return;\n    const range = document.createRange();\n    range.selectNodeContents(element);\n    range.collapse(false);\n    selection.removeAllRanges();\n    selection.addRange(range);\n  }\n\n  function buildEditorTistoryHtml(room) {\n    const payload = room?.payload || {};\n    const roomTitle = room?.roomTitle || payload.roomTitle || \"(제목 없음)\";\n    const tistoryAssetMaps = buildTistoryAssetMaps(payload.assets || []);\n    let entries = getSelectedTabEntries(room);\n\n    if (state.mergeSameSpeaker) {\n      entries = mergeConsecutiveSpeakerEntries(entries, state.systemSpeaker);\n    }\n\n    const htmlEntries = entries.map((entry) => {\n      const sender = String(entry?.sender || \"\").trim();\n      const isSystem = !!(state.systemSpeaker && sender === state.systemSpeaker);\n      const bodyHtml = rewriteEntryHtml(entry?.packageHtml || entry?.bodyHtml || \"\", tistoryAssetMaps.byRenderUrl);\n      const avatarUrl = resolveAvatarUrl(entry, tistoryAssetMaps);\n      const speakerColor = normalizeCssColorForHtml(entry?.baseColor || \"\");\n      const speakerStyle = speakerColor ? ` style=\"color:${escapeAttr(speakerColor)}\"` : \"\";\n\n      if (isSystem) {\n        return `\n          <div class=\"ccf-tistory-system\">\n            <div class=\"ccf-tistory-system-text\">${bodyHtml}</div>\n          </div>`;\n      }\n\n      return `\n        <div class=\"ccf-tistory-entry\">\n          ${avatarUrl ? `<div class=\"ccf-tistory-avatar\"><img src=\"${escapeAttr(avatarUrl)}\" alt=\"\"></div>` : `<div class=\"ccf-tistory-avatar\"></div>`}\n          <div class=\"ccf-tistory-body\">\n            <div class=\"ccf-tistory-speaker\"${speakerStyle}>${escapeHtml(sender || \"(이름 없음)\")}</div>\n            <div class=\"ccf-tistory-text\">${bodyHtml}</div>\n          </div>\n        </div>`;\n    }).join(\"\\n\");\n\n    return `<!-- Capybara Log: Tistory HTML -->\n<div class=\"ccf-tistory-log\">\n  <style>\n    .ccf-tistory-log {\n      max-width: 760px;\n      margin: 0 auto;\n      font-family: \"Pretendard\", \"Apple SD Gothic Neo\", \"Noto Sans KR\", sans-serif;\n      color: #222;\n      line-height: 1.7;\n    }\n    .ccf-tistory-title {\n      margin: 0 0 20px;\n      padding: 0 0 12px;\n      border-bottom: 1px solid #ddd;\n      font-size: 22px;\n      font-weight: 800;\n    }\n    .ccf-tistory-entry {\n      display: flex;\n      gap: 10px;\n      margin: 12px 0;\n      align-items: flex-start;\n    }\n    .ccf-tistory-avatar {\n      width: 42px;\n      height: 42px;\n      flex: 0 0 42px;\n      border-radius: 8px;\n      overflow: hidden;\n      background: #f2f2f2;\n    }\n    .ccf-tistory-avatar img {\n      width: 100%;\n      height: 100%;\n      object-fit: cover;\n      display: block;\n    }\n    .ccf-tistory-body {\n      flex: 1;\n      min-width: 0;\n    }\n    .ccf-tistory-speaker {\n      display: inline-block;\n      margin-bottom: 3px;\n      font-size: 13px;\n      font-weight: 800;\n    }\n    .ccf-tistory-text {\n      padding: 9px 12px;\n      border-radius: 10px;\n      background: #f7f7f7;\n      word-break: break-word;\n    }\n    .ccf-tistory-system {\n      margin: 16px auto;\n      text-align: center;\n    }\n    .ccf-tistory-system-text {\n      display: inline-block;\n      max-width: 86%;\n      padding: 8px 12px;\n      color: #666;\n      font-style: italic;\n      border-top: 1px solid #ddd;\n      border-bottom: 1px solid #ddd;\n    }\n    .ccf-tistory-log img {\n      max-width: 100%;\n    }\n  </style>\n\n  <h2 class=\"ccf-tistory-title\">${escapeHtml(roomTitle)}</h2>\n  ${htmlEntries}\n</div>`;\n  }\n\n  function openTistoryPreview(html) {\n    const win = window.open(\"\", \"_blank\");\n    if (!win) {\n      showToast(\"미리보기 창을 열지 못했습니다. 팝업 차단을 확인해 주세요.\");\n      return;\n    }\n\n    win.document.open();\n    win.document.write(`<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"UTF-8\">\n<title>티스토리 HTML 미리보기</title>\n</head>\n<body>\n${html}\n</body>\n</html>`);\n    win.document.close();\n  }\n\n  function formatEntryTimestamp(value) {\n    if (value == null) return \"\";\n    if (value instanceof Date) {\n      return Number.isFinite(value.getTime()) ? formatTimeOfDay(value) : \"\";\n    }\n    if (typeof value === \"number\" && Number.isFinite(value)) {\n      return formatTimeOfDay(new Date(value));\n    }\n    if (typeof value === \"string\") {\n      const trimmed = value.trim();\n      if (!trimmed) return \"\";\n      // 코코포리아 공식 로그는 이미 표시용 시간 문자열이 들어오기도 한다.\n      const numericLike = /^\\d{4,}$/.test(trimmed) ? Number(trimmed) : NaN;\n      if (Number.isFinite(numericLike)) {\n        const d = new Date(numericLike);\n        if (Number.isFinite(d.getTime())) return formatTimeOfDay(d);\n      }\n      const parsed = Date.parse(trimmed);\n      if (Number.isFinite(parsed)) {\n        return formatTimeOfDay(new Date(parsed));\n      }\n      return trimmed;\n    }\n    return \"\";\n  }\n\n  const _fmtTimeOfDay = new Intl.DateTimeFormat(\"ko-KR\", {\n    hour: \"2-digit\", minute: \"2-digit\", second: \"2-digit\"\n  });\n  function formatTimeOfDay(d) {\n    return _fmtTimeOfDay.format(d);\n  }\n\n  function showEmpty() {\n    els.main.innerHTML = `\n      <div class=\"empty-state\">\n        <h2>대기 중</h2>\n        <p>코코포리아 룸의 환경설정 메뉴에서 <code>카피바라 로그</code> 버튼을 누르면 이 편집기로 로그가 전달됩니다.</p>\n        <p>이전에 받은 로그가 있다면 왼쪽 목록에서 선택할 수 있습니다.</p>\n      </div>\n    `;\n  }\n\n  // ---------- Misc ----------\n\n  async function updateStorageInfo() {\n    try {\n      const total = state.rooms.length;\n      let bytes = 0;\n      for (const room of state.rooms) {\n        for (const asset of room?.payload?.assets || []) {\n          if (asset?.bytes instanceof Uint8Array) {\n            bytes += asset.bytes.byteLength;\n          } else if (typeof asset?.size === \"number\") {\n            bytes += asset.size;\n          }\n        }\n      }\n      els.storageInfo.textContent = `v0.1 · 룸 ${total}개 · 자산 약 ${formatBytes(bytes)}`;\n    } catch {\n      els.storageInfo.textContent = \"v0.1\";\n    }\n  }\n\n  function formatBytes(n) {\n    if (!n) return \"0B\";\n    const units = [\"B\", \"KB\", \"MB\", \"GB\"];\n    let i = 0;\n    let v = n;\n    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }\n    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)}${units[i]}`;\n  }\n\n  let toastTimer = 0;\n  function showToast(msg) {\n    els.toast.textContent = msg;\n    els.toast.classList.add(\"visible\");\n    clearTimeout(toastTimer);\n    toastTimer = setTimeout(() => els.toast.classList.remove(\"visible\"), 2400);\n  }\n\n  function escapeHtml(s) {\n    return String(s ?? \"\")\n      .replace(/&/g, \"&amp;\")\n      .replace(/</g, \"&lt;\")\n      .replace(/>/g, \"&gt;\")\n      .replace(/\"/g, \"&quot;\")\n      .replace(/'/g, \"&#39;\");\n  }\n  function escapeAttr(s) { return escapeHtml(s); }\n\n  // ---------- Bootstrap ----------\n\n  async function bootstrap() {\n    try {\n      state.db = await openDb();\n    } catch (error) {\n      console.error(\"[capybara-log-editor] failed to open IndexedDB\", error);\n      els.main.innerHTML = `<div class=\"empty-state\"><h2>저장소 열기 실패</h2><p>${escapeHtml(error?.message || error)}</p></div>`;\n      return;\n    }\n\n    setupMessageBridge();\n    await refreshRoomList();\n\n    const params = new URLSearchParams(location.search);\n    const wantedRoomId = params.get(\"roomId\") || \"\";\n    if (wantedRoomId) {\n      const existing = await getRoom(wantedRoomId);\n      if (existing) {\n        await selectRoom(wantedRoomId);\n        return;\n      }\n      // 핸드오프 메시지가 곧 도착할 가능성이 높으므로 빈 화면을 그대로 둔다.\n    }\n\n    if (state.rooms.length && !state.currentRoomId) {\n      await selectRoom(state.rooms[0].roomId);\n    }\n  }\n\n  els.refresh.addEventListener(\"click\", () => {\n    refreshRoomList().catch((e) => showToast(\"새로고침 실패: \" + (e?.message || e)));\n  });\n\n  bootstrap().catch((error) => {\n    console.error(\"[capybara-log-editor] bootstrap failed\", error);\n    showToast(\"초기화 실패: \" + (error?.message || error));\n  });\n})();\n</script>\n</body>\n</html>\n";
})();
