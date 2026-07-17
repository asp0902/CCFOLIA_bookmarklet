// ==UserScript==
// @name         CCF Format Editor Tool by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-format-sync
// @version      0.1.22
// @description  Adds a rich formatting editor, renderer, effects, and cut-in image mirroring to CCFOLIA chat.
// @description:ko CCFOLIA 채팅에 서식 편집/렌더링 기능과 컷인 이미지 미러링을 추가합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // [CCF NAR] 스크립트 로드 자체 확인용 - IIFE 진입 직후 무조건 실행
  console.info("[CCF NAR] format-sync IIFE entry v0.1.22 @", new Date().toISOString());

  // ensureRenderOverlay가 React 소유 text node를 .ccf-original-hidden 래퍼로
  // 재부모화하므로, React가 원래 부모 기준으로 removeChild/insertBefore를 호출하면
  // NotFoundError로 앱 전체가 크래시한다(탭 전환 시 가상화 리스트 재사용 경로).
  // 노드의 실제 부모로 위임하는 전역 가드로 흡수한다. 한 번만 설치.
  (function installDomReparentGuards() {
    if (window.__CCF_DOM_REPARENT_GUARDS__) return;
    window.__CCF_DOM_REPARENT_GUARDS__ = true;
    const origRemoveChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function (child) {
      if (child && child.parentNode !== this) {
        console.warn("[CCF FORMAT SYNC] removeChild guard: reparented node, delegating", child);
        if (child.parentNode) return origRemoveChild.call(child.parentNode, child);
        return child;
      }
      return origRemoveChild.call(this, child);
    };
    const origInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (newNode, refNode) {
      if (refNode && refNode.parentNode !== this) {
        console.warn("[CCF FORMAT SYNC] insertBefore guard: reference node moved, appending", refNode);
        return this.appendChild(newNode);
      }
      return origInsertBefore.call(this, newNode, refNode);
    };
  })();

  // IIFE 상단 hoist: initRenderer() → scanAndRenderAll → ... → applySoftBlur →
  // ensureBlurRevealHandler 흐름이 IIFE 실행 초기에 일어남. var 로 함수 스코프 hoist
  // 해서 TDZ 위반 방지.
  var _blurRevealHandlerBound = false;
  let lastChatScrollUpAt = 0;
  let chatRenderPausedUntil = 0;

  const CCF_RENDERED_ATTR = "data-ccf-rendered";
  const CCF_RAW_ATTR = "data-ccf-raw";
  const CCF_SAFE_UI_ATTR = "data-ccf-safe-markup";
  const CCF_NARRATION_ATTR = "data-ccf-narration";
  const CCF_NARRATION_PANEL_ATTR = "data-ccf-narration-panel";
  const MESSAGE_SCOPE_SELECTOR = '[role="log"], [aria-live="polite"], [aria-live="assertive"], .MuiDrawer-paper, .MuiPaper-root, ul.MuiList-root';
  const MESSAGE_ITEM_SELECTOR = 'li, [role="listitem"], .MuiListItem-root, [data-index]';
  const MESSAGE_TEXT_SELECTOR = [
    'p.MuiTypography-root.MuiTypography-body1',
    'div.MuiTypography-root.MuiTypography-body1',
    'span.MuiTypography-root.MuiTypography-body1',
    'p.MuiTypography-root.MuiTypography-body2',
    'div.MuiTypography-root.MuiTypography-body2',
    'span.MuiTypography-root.MuiTypography-body2',
    '.MuiTypography-root.MuiListItemText-secondary',
    '.MuiListItemText-secondary',
    '.MuiListItemText-root > p',
    '.MuiListItemText-root > div',
    '.MuiListItemText-root > span.MuiTypography-root',
    '[data-index] p',
    '[data-index] div.MuiTypography-root',
    '[data-index] span.MuiTypography-root',
    'li p'
  ].join(", ");
  const HISTORY_RENDER_BOTTOM_THRESHOLD_PX = 160;
  const CHAT_RENDER_PAUSE_AFTER_SCROLL_UP_MS = 1200;
  const CHAT_HISTORY_LOAD_PAUSE_MS = 6000;
  const ENCODED_RENDER_RETRY_DELAYS = Object.freeze([120, 360, 900, 1800]);

  const INVIS_START = "\u2063\u2063\u2063";
  const INVIS_END = "\u2062\u2062\u2062";
  const INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
  const INVIS_REVERSE = new Map(INVIS_MAP.map((ch, i) => [ch, i]));
  const FONT_SIZE_MIN = 1;
  const FONT_SIZE_MAX = 200;
  const DEFAULT_BLUR_VALUE = "4px";
  const LOCAL_IMAGE_TOKEN_PREFIX = "ccf-local://image/";
  const FIRESTORE_IMAGE_TOKEN_PREFIX = "ccf-fs-image://";
  const LOCAL_IMAGE_STORAGE_PREFIX = "ccf-inline-image:";
  const STYLE_CLIPBOARD_STORAGE_KEY = "ccf-format-style-clipboard-v1";
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_FORMAT_SYNC_SCRIPT_INFO = Object.freeze({
    id: "ccf-format-sync",
    name: "CCF Format Editor Tool",
    version: getUserscriptVersion("0.1.21"),
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-format-sync"
  });
  const IS_CCFOLIA_HOST = /(?:^|\.)ccfolia\.com$/i.test(location.hostname);
  const IS_IFH_HOST = location.hostname === "ifh.cc";
  const IFH_ORIGIN = "https://ifh.cc";
  const IFH_HELPER_FRAME_ID = "ccf-ifh-helper-frame";
  const IFH_HELPER_URL = `${IFH_ORIGIN}/ko?ccf_ifh_bridge=1`;
  const IFH_BRIDGE_READY_TYPE = "ccf-ifh-ready";
  const IFH_BRIDGE_REQUEST_TYPE = "ccf-ifh-upload";
  const IFH_BRIDGE_RESULT_TYPE = "ccf-ifh-upload-result";
  const IFH_BRIDGE_ERROR_TYPE = "ccf-ifh-upload-error";
  const IFH_HELPER_TIMEOUT_MS = 60000;
  const IFH_UPLOAD_CT_FALLBACK = "dadb61fc2990b7b1";
  const IFH_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const IFH_SUPPORTED_IMAGE_EXT_RE = /\.(gif|png|bmp|jpe?g|webp|heic)$/i;
  const pendingEncodedRenderRetries = new WeakMap();

  if (IS_IFH_HOST) {
    initIfhBridgePage();
    return;
  }

  if (!IS_CCFOLIA_HOST) {
    return;
  }

  const ccfFsLifecycle = createLegacyLifecycle(CCF_FORMAT_SYNC_SCRIPT_INFO, {
    debugKey: "__CCF_FORMAT_SYNC_DEBUG__",
    onTeardown() {
      try {
        document.querySelectorAll([
          '[data-ccf-fs-injected="1"]',
          'style[data-ccf-fs-style]',
          '[data-ccf-inline-toolbar="1"]',
          '.ccf-open-btn[data-ccf-open-btn="1"]',
          '#ccf-render-style',
          '#ccf-format-modal',
          '#ccf-format-backdrop',
          '#ccf-format-style',
          '#ccf-format-style-fix',
          '.ccf-editor-preview-layer[data-ccf-safe-markup="1"]'
        ].join(", ")).forEach(el => el.remove());
      } catch (error) { /* dom sweep failed */ }
      try {
        if (document.body?.dataset?.ccfUserscriptReady === "1") {
          delete document.body.dataset.ccfUserscriptReady;
        }
      } catch (error) { /* ready marker cleanup failed */ }
      try {
        if (window.__CCF_FORMAT_SYNC_RUNTIME__ && window.__CCF_FORMAT_SYNC_RUNTIME__.__owner === ccfFsSignal) {
          delete window.__CCF_FORMAT_SYNC_RUNTIME__;
        }
      } catch (error) { /* runtime cleanup failed */ }
    }
  });
  const ccfFsSignal = ccfFsLifecycle.signal;
  const ccfFsRegisterTeardown = (fn) => ccfFsLifecycle.registerTeardown(fn);
  const ccfFsWithSignal = (options) => ccfFsLifecycle.withSignal(options);
  const ccfFsTeardown = () => ccfFsLifecycle.disable();

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

  ccfFsLifecycle.installDebugApi();

  window.__CCF_FORMAT_SYNC_RUNTIME__ = {
    __owner: ccfFsSignal,
    withSignal: ccfFsWithSignal,
    registerTeardown: ccfFsRegisterTeardown,
    isActive() { return ccfFsLifecycle.isActive(); },
    teardown: ccfFsTeardown,
    // 두 번째 IIFE 의 preparePayloadForSend 등이 봉투 디코딩에 사용 (cross-IIFE bridge).
    extractEnvelope
  };

  // [v0.0.42] 나레이션 가디언 WeakMap — initRenderer()가 즉시 기존 메시지를 스캔하면서
  // applyNarrationMessageLayout()→installNarrationGuardian/uninstallNarrationGuardian를
  // 호출할 수 있으므로 반드시 initRenderer() 호출 전에 선언/초기화되어야 한다(TDZ 방지).
  const NARRATION_GUARDIANS = new WeakMap();

  const _ccfEnabled = isCcfSuiteScriptEnabled(CCF_FORMAT_SYNC_SCRIPT_INFO.id);
  console.info("[CCF NAR] suite-script-enabled gate: %o, scriptId=%o", _ccfEnabled, CCF_FORMAT_SYNC_SCRIPT_INFO.id);
  if (!_ccfEnabled) {
    return;
  }
  console.info("[CCF NAR] initRenderer about to run");
  // initRenderer() throw 가 같은 <script> tag 안 다음 IIFE 들을 차단하지 않도록 격리.
  // throw 가 발생해도 stack trace 를 console.error 로 남겨 진단 가능하게 유지.
  try {
    initRenderer();
    console.info("[CCF NAR] initRenderer completed");
  } catch (error) {
    console.error("[CCF NAR] initRenderer threw, continuing to next IIFE", error);
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

  function initIfhBridgePage() {
    window.addEventListener("message", handleIfhBridgePageMessage, ccfFsWithSignal());

    const announceReady = () => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: IFH_BRIDGE_READY_TYPE }, "*");
        }
      } catch (error) {
        // Ignore postMessage failures on helper pages.
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", announceReady, { once: true });
    } else {
      announceReady();
    }
  }

  async function handleIfhBridgePageMessage(event) {
    if (!isTrustedCcfoliaOrigin(event?.origin)) return;

    const payload = event?.data;
    if (!payload || payload.type !== IFH_BRIDGE_REQUEST_TYPE) return;

    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    const source = event.source;
    if (!requestId || !source || typeof source.postMessage !== "function") return;

    try {
      const uploads = await uploadFilesToIfh(payload.files);
      source.postMessage({
        type: IFH_BRIDGE_RESULT_TYPE,
        requestId,
        uploads
      }, event.origin);
    } catch (error) {
      source.postMessage({
        type: IFH_BRIDGE_ERROR_TYPE,
        requestId,
        code: typeof error?.code === "string" ? error.code : "",
        message: getIfhUploadErrorMessage(error)
      }, event.origin);
    }
  }

  function isTrustedCcfoliaOrigin(origin) {
    if (typeof origin !== "string" || !origin) return false;
    try {
      const parsed = new URL(origin);
      return /^https?:$/i.test(parsed.protocol) && /(?:^|\.)ccfolia\.com$/i.test(parsed.hostname);
    } catch (error) {
      return false;
    }
  }

  function createIfhUploadError(message, code = "") {
    const error = new Error(message || "iFH upload failed");
    error.code = code;
    return error;
  }

  function getIfhUploadErrorMessage(error) {
    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    return "iFH 이미지 업로드에 실패했습니다.";
  }

  function extractIfhUploadToken() {
    const scripts = [...document.scripts]
      .map((script) => script.textContent || "")
      .filter(Boolean)
      .join("\n");
    const matched = scripts.match(/formData\.append\("ct",\s*"([^"]+)"\)/);
    return matched?.[1] || IFH_UPLOAD_CT_FALLBACK;
  }

  function isIfhCompatibleImageFile(file) {
    if (!(file instanceof File)) return false;
    const lowerName = typeof file.name === "string" ? file.name.toLowerCase() : "";
    const lowerType = typeof file.type === "string" ? file.type.toLowerCase() : "";
    return IFH_SUPPORTED_IMAGE_EXT_RE.test(lowerName) || [
      "image/gif",
      "image/png",
      "image/bmp",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/heic",
      "image/heif"
    ].includes(lowerType);
  }

  async function uploadFilesToIfh(files) {
    const imageFiles = Array.isArray(files) ? files.filter((file) => file instanceof File) : [];
    if (!imageFiles.length) {
      throw createIfhUploadError("업로드할 이미지 파일을 찾지 못했습니다.", "no-files");
    }

    const unsupportedFile = imageFiles.find((file) => !isIfhCompatibleImageFile(file));
    if (unsupportedFile) {
      throw createIfhUploadError(
        `iFH에서 지원하지 않는 이미지 형식입니다: ${unsupportedFile.name || "image"}`,
        "unsupported-type"
      );
    }

    const oversizedFile = imageFiles.find((file) => Number(file.size) > IFH_MAX_IMAGE_BYTES);
    if (oversizedFile) {
      throw createIfhUploadError(
        `iFH는 10MB 이하 이미지 업로드만 지원합니다: ${oversizedFile.name || "image"}`,
        "file-too-large"
      );
    }

    const userInfo = await fetchIfhUserInfo();
    if (userInfo?.authRequired) {
      throw createIfhUploadError("iFH 로그인이 필요합니다. iFH 사이트에서 로그인한 뒤 다시 시도해주세요.", "auth-required");
    }

    const captchaNeeded = await fetchIfhCaptchaNeeded(imageFiles.length);
    if (captchaNeeded) {
      throw createIfhUploadError("iFH에서 CAPTCHA 확인이 필요합니다. iFH 업로드 페이지를 열어 확인을 마친 뒤 다시 시도해주세요.", "captcha-required");
    }

    const uploads = [];
    for (const file of imageFiles) {
      uploads.push(await uploadSingleFileToIfh(file));
    }
    return uploads;
  }

  async function fetchIfhUserInfo() {
    let response;
    try {
      response = await fetch(`${IFH_ORIGIN}/userinfo.php?full=true`, {
        credentials: "include",
        cache: "no-store"
      });
    } catch (error) {
      throw createIfhUploadError("iFH 로그인 상태를 확인하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.", "userinfo-failed");
    }

    if (!response.ok) {
      throw createIfhUploadError("iFH 로그인 상태를 확인하지 못했습니다.", "userinfo-failed");
    }

    try {
      return await response.json();
    } catch (error) {
      throw createIfhUploadError("iFH 로그인 상태 응답을 해석하지 못했습니다.", "userinfo-failed");
    }
  }

  async function fetchIfhCaptchaNeeded(batchSize = 1) {
    let response;
    try {
      response = await fetch(`${IFH_ORIGIN}/captcha_check.php?batchSize=${encodeURIComponent(Math.max(1, Number(batchSize) || 1))}`, {
        credentials: "include",
        cache: "no-store"
      });
    } catch (error) {
      throw createIfhUploadError("iFH CAPTCHA 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.", "captcha-check-failed");
    }

    if (!response.ok) {
      throw createIfhUploadError("iFH CAPTCHA 상태를 확인하지 못했습니다.", "captcha-check-failed");
    }

    try {
      return !!(await response.json());
    } catch (error) {
      throw createIfhUploadError("iFH CAPTCHA 상태 응답을 해석하지 못했습니다.", "captcha-check-failed");
    }
  }

  async function uploadSingleFileToIfh(file) {
    const formData = new FormData();
    formData.append("Filedata", file, file.name || "image");
    formData.append("ct", extractIfhUploadToken());

    let response;
    try {
      response = await fetch(`${IFH_ORIGIN}/upload.php`, {
        method: "POST",
        body: formData,
        credentials: "include"
      });
    } catch (error) {
      throw createIfhUploadError(`iFH에 ${file.name || "image"} 업로드를 요청하지 못했습니다.`, "upload-request-failed");
    }

    const text = String(await response.text()).trim();
    if (!response.ok) {
      throw createIfhUploadError(`iFH 업로드 요청이 실패했습니다. (${response.status})`, "upload-request-failed");
    }

    if (!/^success\|/i.test(text)) {
      throw createIfhUploadError(text || `iFH가 ${file.name || "image"} 업로드를 거부했습니다.`, "upload-failed");
    }

    const imageId = text.split("|")[1]?.trim();
    if (!imageId) {
      throw createIfhUploadError("iFH 업로드 결과에서 이미지 ID를 찾지 못했습니다.", "missing-image-id");
    }

    const imageUrl = await fetchIfhImageUrl(imageId);
    return {
      id: imageId,
      imageUrl
    };
  }

  async function fetchIfhImageUrl(imageId) {
    let response;
    try {
      response = await fetch(`${IFH_ORIGIN}/i-${encodeURIComponent(imageId)}`, {
        credentials: "include",
        cache: "no-store"
      });
    } catch (error) {
      throw createIfhUploadError("iFH 공유 주소를 확인하지 못했습니다.", "share-page-failed");
    }

    if (!response.ok) {
      throw createIfhUploadError("iFH 공유 주소를 확인하지 못했습니다.", "share-page-failed");
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imageUrl = normalizeImageUrl(doc.querySelector('input[name="imgcode1"]')?.value || "");
    if (!imageUrl) {
      throw createIfhUploadError("iFH 업로드 후 이미지 주소를 찾지 못했습니다.", "missing-image-url");
    }
    return imageUrl;
  }

  function isCcfSuiteScriptEnabled(scriptId) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CCF_SUITE_SCRIPT_STATE_KEY) || "{}");
      return !parsed || typeof parsed !== "object" || parsed[scriptId] !== false;
    } catch (error) {
      return true;
    }
  }

  function initRenderer() {
    // v0.0.51: 마커 전체 제거가 첫 진입 시 throw/지연 유발해 init() 호출이 차단되는 회귀를 일으킴.
    // 일회 마이그레이션은 try/catch + 비동기 dispatch 로 분리해 동기 흐름 차단 방지.
    try {
      window.setTimeout(() => {
        try {
          document.querySelectorAll(`[${CCF_RENDERED_ATTR}="1"][style*="filter"]`).forEach((el) => {
            el.removeAttribute(CCF_RENDERED_ATTR);
          });
        } catch (error) {
          console.warn("[CCF NAR] legacy blur marker migration failed", error);
        }
      }, 0);
    } catch (error) {
      console.warn("[CCF NAR] legacy blur marker migration schedule failed", error);
    }
    // 각 단계 try/catch 로 격리 — scanAndRenderAll 가 throw 해도 observeRenderDom
    // mount 보장. mount 안 되면 새 메시지 수신 시 디코딩 흐름 자체 발동 안 됨.
    try { injectStyle(); } catch (error) {
      console.error("[CCF NAR] injectStyle threw", error);
    }
    try { scanAndRenderAll(); } catch (error) {
      console.error("[CCF NAR] scanAndRenderAll threw, observeRenderDom 는 계속 진행", error);
    }
    try { observeRenderDom(); } catch (error) {
      console.error("[CCF NAR] observeRenderDom threw — 메시지 수신 디코딩 불가", error);
    }
  }

  function injectStyle() {
    if (document.getElementById("ccf-render-style")) return;

    const style = document.createElement("style");
    style.id = "ccf-render-style";
    style.setAttribute("data-ccf-fs-style", "1");
    style.textContent = `
      /* CCFOLIA 우하단 연필 FAB가 펼치는 "추가 메뉴"의 폭을 북마클릿 실행 전 상태로 고정.
         WallpaperIcon(전경/배경 변경 항목)이 들어있는 메뉴만 선택적으로 타깃하므로
         다른 컨텍스트 메뉴(드롭다운/팔레트 등)에는 영향이 없다.
         항목이 추가되어도 폭이 유지되어 메뉴가 FAB 기준으로 같은 위치에 표시된다. */
      .MuiPopover-paper.MuiMenu-paper:has([data-testid="WallpaperIcon"]) {
        max-width: 392.781px !important;
        width: 392.781px !important;
        padding-top: 4px !important;
        padding-bottom: 4px !important;
        padding-left: 16px !important;
        padding-right: 16px !important;
        box-sizing: border-box !important;
      }

      .ccf-render-root {
        white-space: pre-wrap;
        word-break: break-word;
      }

      /* React 소유 원본 text node(invisible envelope 포함)는 지우지 않고
         .ccf-original-hidden 래퍼(display:none)로 감싸 완전히 레이아웃에서 빼낸다.
         실제 표시는 .ccf-render-overlay가 담당 — 탭 전환 시 React가 원본 text node를
         위치 기반으로 재사용해도 detached node 업데이트가 되지 않도록 함. */
      .ccf-render-root > .ccf-original-hidden {
        display: none;
      }

      .ccf-render-root > .ccf-render-overlay {
        display: inline;
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
        box-sizing: border-box;
        padding-top: 0.82em;
      }

      .ccf-render-root .ccf-ruby-frag::before {
        content: attr(data-ruby);
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        font-size: 0.62em;
        line-height: 1;
        white-space: nowrap;
        color: currentColor;
        pointer-events: none;
      }

      .ccf-render-root .ccf-ruby-base {
        display: inline;
      }

      .ccf-render-root .ccf-tooltip-frag {
        position: relative;
        display: inline-block;
        vertical-align: baseline;
        white-space: pre-wrap;
        overflow: visible;
        cursor: help;
        border-bottom: 1px dashed rgba(255, 255, 255, 0.96);
        padding-bottom: 0.02em;
        transition: background-color 120ms ease, color 120ms ease;
      }

      .ccf-render-root .ccf-tooltip-frag::before,
      .ccf-render-root .ccf-tooltip-frag::after {
        position: absolute;
        left: calc(100% + 6px);
        opacity: 0;
        visibility: hidden;
        transform: none;
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
        border-top: 6px solid rgba(18, 18, 18, 0.96);
      }

      .ccf-render-root .ccf-tooltip-frag::after {
        content: attr(data-tooltip);
        bottom: calc(100% + 8px);
        min-width: 40px;
        max-width: min(260px, calc(100vw - 32px));
        padding: 7px 10px;
        border-radius: 0;
        background: rgba(18, 18, 18, 0.96);
        color: #ffffff;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
        font-size: 12px;
        line-height: 1.35;
        text-align: left;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .ccf-render-root .ccf-tooltip-frag[data-tooltip-multiline="0"]::after {
        width: max-content;
        max-width: min(360px, calc(100vw - 32px));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ccf-render-root .ccf-tooltip-frag:hover::before,
      .ccf-render-root .ccf-tooltip-frag:hover::after {
        opacity: 1;
        visibility: visible;
      }

      .ccf-render-root .ccf-tooltip-frag:hover {
        background: rgba(255, 255, 255, 0.96);
        color: #000000;
        border-bottom-color: rgba(255, 255, 255, 0.96);
      }

      .ccf-render-root .ccf-tooltip-frag:hover,
      .ccf-render-root .ccf-tooltip-frag:hover * {
        color: #000000 !important;
      }

      .ccf-render-root .ccf-code-frag {
        font-family: Consolas, "Courier New", monospace;
        font-size: 0.92em;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.92);
        background: #000000;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        box-sizing: border-box;
      }

      .ccf-render-root .ccf-code-frag.is-inline {
        display: inline-block;
        padding: 0.08em 0.45em 0.12em;
        border-radius: 0;
        vertical-align: baseline;
      }

      .ccf-render-root .ccf-code-frag.is-block {
        display: block;
        width: 100%;
        margin: 6px 0;
        padding: 10px 12px;
        border-radius: 0;
      }

      .ccf-render-root .ccf-image-frag {
        position: relative;
        display: inline-block;
        width: 100%;
        margin: 4px 0;
        vertical-align: top;
      }

      .ccf-render-root .ccf-image-frag.has-image {
        display: block;
        line-height: 0;
      }

      .ccf-render-root .ccf-image {
        display: block;
        width: auto;
        max-width: min(100%, 300px);
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

      /* ===== 나레이션 레이아웃 (v0.0.41) =====
       * 핵심 원칙: 모든 셀렉터의 '식별 앵커'는 .ccf-render-root[data-ccf-narration="1"]이다.
       * render-root는 우리가 innerHTML을 관리하므로 React 재렌더에 영향받지 않는다.
       * :has()로 LI 조상을 역참조해서 아바타/이름을 숨기므로
       * 부모 LI에 별도 속성을 붙일 필요가 없다.
       */

      /* 아바타/이름 숨김 — LI(또는 listitem) 조상 안에 narration render-root가 있으면 발동 */
      .MuiListItem-root:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemAvatar-root,
      li:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemAvatar-root,
      [role="listitem"]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemAvatar-root,
      [data-index]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemAvatar-root,

      .MuiListItem-root:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiAvatar-root,
      li:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiAvatar-root,
      [role="listitem"]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiAvatar-root,
      [data-index]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiAvatar-root,

      .MuiListItem-root:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-primary,
      li:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-primary,
      [role="listitem"]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-primary,
      [data-index]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-primary,

      .MuiListItem-root:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) > img:not(.ccf-image),
      li:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) > img:not(.ccf-image),
      [role="listitem"]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) > img:not(.ccf-image),
      [data-index]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) > img:not(.ccf-image) {
        display: none !important;
      }

      /* 본문 영역 가운데 정렬/폭 확장 */
      .MuiListItem-root:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root,
      li:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root,
      [role="listitem"]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root,
      [data-index]:has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root {
        width: 100% !important;
        text-align: center !important;
      }

      /* 나레이션 상하여백 — 시작(비연속) 메시지에만 위 8px.
         연속(data-ccf-prose-cont) 나레이션은 prose-cont의 margin:0 규칙이 적용되어
         일반 같은 화자 연속발화와 동일한 간격(6px)을 유지한다. */
      .MuiListItem-root:not([data-ccf-prose-cont="1"]):has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root,
      li:not([data-ccf-prose-cont="1"]):has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root,
      [role="listitem"]:not([data-ccf-prose-cont="1"]):has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root,
      [data-index]:not([data-ccf-prose-cont="1"]):not(:has([data-ccf-prose-cont="1"])):has(.ccf-render-root[${CCF_NARRATION_ATTR}="1"]) .MuiListItemText-root {
        margin: 8px auto 0 !important;
      }

      /* 본문 텍스트 자체 — 가운데 + 이탤릭 */
      .ccf-render-root[${CCF_NARRATION_ATTR}="1"],
      .ccf-render-root[${CCF_NARRATION_ATTR}="1"] .ccf-line {
        text-align: center !important;
        font-style: italic !important;
      }

      /* === 호환성: 구버전에서 LI에 직접 data-ccf-narration이 붙은 경우(있다면)도 처리 === */
      [${CCF_NARRATION_ATTR}="1"]:not(.ccf-render-root) .MuiListItemAvatar-root,
      [${CCF_NARRATION_ATTR}="1"]:not(.ccf-render-root) .MuiAvatar-root,
      [${CCF_NARRATION_ATTR}="1"]:not(.ccf-render-root) .MuiListItemText-primary,
      [${CCF_NARRATION_ATTR}="1"]:not(.ccf-render-root) > img:not(.ccf-image) {
        display: none !important;
      }
      [${CCF_NARRATION_ATTR}="1"]:not(.ccf-render-root) .MuiListItemText-root {
        width: 100% !important;
        text-align: center !important;
      }
      [${CCF_NARRATION_ATTR}="1"]:not(.ccf-render-root):not([data-ccf-prose-cont="1"]) .MuiListItemText-root {
        margin: 8px auto 0 !important;
      }

      /* 미리보기 패널 등 */
      .MuiPaper-root[${CCF_NARRATION_PANEL_ATTR}="1"] > img {
        display: none !important;
      }

      /* hideNarrationElements가 마킹한 헤더/타임스탬프류 */
      [data-ccf-narration-hidden="1"] {
        display: none !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function observeRenderDom() {
    const mo = new MutationObserver((mutations) => {
      if (shouldPauseChatRenderForHistoryLoad(mutations)) {
        chatRenderPausedUntil = Math.max(chatRenderPausedUntil, Date.now() + CHAT_HISTORY_LOAD_PAUSE_MS);
        // return하지 않는다 — 배치를 통째로 버리면 최신(바닥) 메시지 렌더도 다음 mutation까지
        // 밀려서 일반 레이아웃 → 나레이션 전환 과정이 그대로 보인다(FOUC). 과거 이력 항목은
        // shouldRenderEncodedMessageNow의 per-element 게이트가 계속 막아준다.
      }
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              if (node.closest?.(`[${CCF_SAFE_UI_ATTR}="1"]`)) continue;
              scanWithin(node);
            } else if (node.nodeType === Node.TEXT_NODE) {
              // removeChild/insertBefore 가드 위임 후 React가 새 text node를
              // render-root에 직접 꽂을 수 있음 — 원문이 노출되지 않게 래퍼로 회수 후 재스캔.
              const parent = mutation.target instanceof Element ? mutation.target : node.parentElement;
              if (!parent || parent.closest?.(`[${CCF_SAFE_UI_ATTR}="1"]`)) continue;
              const root = parent.closest?.(".ccf-render-root");
              if (!root) continue;
              const hidden = root.querySelector(":scope > .ccf-original-hidden");
              const overlay = root.querySelector(":scope > .ccf-render-overlay");
              if (hidden && overlay && node.parentNode === root) {
                hidden.appendChild(node);
              }
              scanWithin(root);
            }
          }
          continue;
        }

        if (mutation.type === "characterData") {
          const parent = mutation.target?.parentElement;
          if (parent) {
            if (parent.closest?.(`[${CCF_SAFE_UI_ATTR}="1"]`)) continue;
            // 오버레이 렌더 이후엔 원본 text node가 .ccf-original-hidden 래퍼 안에 있으므로,
            // characterData가 갱신되면 래퍼가 아니라 그 바깥의 .ccf-render-root(el)부터 다시 스캔한다.
            scanWithin(parent.closest?.(".ccf-render-root") || parent);
          }
        }
      }
    });

    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    ccfFsRegisterTeardown(() => mo.disconnect());
  }

  function shouldPauseChatRenderForHistoryLoad(mutations) {
    if (Date.now() - lastChatScrollUpAt > CHAT_RENDER_PAUSE_AFTER_SCROLL_UP_MS) return false;
    let addedItems = 0;
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(MESSAGE_ITEM_SELECTOR) || node.querySelector?.(MESSAGE_ITEM_SELECTOR)) {
          addedItems += 1;
          if (addedItems >= 2) return true;
        }
      }
    }
    return false;
  }

  function scanAndRenderAll() {
    // 초기 전체 이력 렌더는 virtualized list scrollHeight를 크게 흔든다.
    // 현재 보이는 하단 메시지만 렌더하고, 과거 이력은 새로 추가될 때도 하단 근처일 때만 렌더한다.
    scanWithin(document.body || document.documentElement);
  }

  function collectChatScrollables() {
    const out = new Set();
    document.querySelectorAll(MESSAGE_SCOPE_SELECTOR).forEach((el) => {
      let node = el;
      while (node && node !== document.body) {
        if (node instanceof HTMLElement) {
          const overflowY = getComputedStyle(node).overflowY;
          if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
            out.add(node);
            break;
          }
        }
        node = node.parentElement;
      }
    });
    return [...out];
  }

  function isScrolledToBottom(el) {
    if (!(el instanceof HTMLElement)) return false;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }

  function scanWithin(root) {
    if (!(root instanceof Element)) return;

    const targets = new Set();

    collectRenderTargets(root, targets);

    if (root.matches?.(MESSAGE_TEXT_SELECTOR)) {
      targets.add(root);
    }
    root.querySelectorAll?.(MESSAGE_TEXT_SELECTOR).forEach((el) => {
      targets.add(el);
    });

    if (root.matches?.(MESSAGE_SCOPE_SELECTOR)) {
      collectRenderTargets(root, targets);
    }
    root.querySelectorAll?.(MESSAGE_SCOPE_SELECTOR).forEach((scope) => {
      collectRenderTargets(scope, targets);
    });

    for (const el of targets) {
      if (isLikelyMessageTextElement(el)) {
        tryRenderEncodedMessage(el);
      }
    }

    syncNarrationPanelsWithin(root);
  }

  function syncNarrationPanelsWithin(root) {
    if (!(root instanceof Element)) return;

    const papers = new Set();
    const closestPaper = root.closest?.(".MuiPaper-root");
    if (closestPaper instanceof HTMLElement) papers.add(closestPaper);
    root.querySelectorAll?.(".MuiPaper-root").forEach((paper) => {
      if (paper instanceof HTMLElement) papers.add(paper);
    });

    papers.forEach((paper) => {
      const messageElements = [...paper.querySelectorAll(MESSAGE_TEXT_SELECTOR)]
        .filter((element) => (
          element instanceof HTMLElement &&
          !element.closest(`[${CCF_SAFE_UI_ATTR}="1"]`) &&
          !element.closest('textarea, input, [contenteditable="true"], [role="textbox"]')
        ));
      const latest = messageElements[messageElements.length - 1];
      const latestItem = latest?.closest?.(MESSAGE_ITEM_SELECTOR);
      const narration = !!latest && (
        latest.getAttribute(CCF_NARRATION_ATTR) === "1" ||
        latestItem?.getAttribute?.(CCF_NARRATION_ATTR) === "1"
      );
      if (narration) {
        paper.setAttribute(CCF_NARRATION_PANEL_ATTR, "1");
      } else {
        paper.removeAttribute(CCF_NARRATION_PANEL_ATTR);
      }
    });
  }

  function collectRenderTargets(root, targets) {
    if (!(root instanceof Element)) return;

    if (isLikelyMessageTextElement(root)) {
      targets.add(root);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!(node instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
        return isLikelyMessageTextElement(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    while (walker.nextNode()) {
      targets.add(walker.currentNode);
    }
  }

  function isLikelyMessageTextElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    // format-sync가 렌더용으로 만든 내부 요소(감춘 원본 래퍼/오버레이) 자체는
    // 별도 메시지 요소가 아니다 — el의 raw text를 그대로 들고 있어 오탐하기 쉽다.
    if (el.classList.contains("ccf-original-hidden") || el.classList.contains("ccf-render-overlay")) return false;
    if (el.matches?.(MESSAGE_SCOPE_SELECTOR)) return false;
    if (el.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;
    if (el.closest("button, form")) return false;
    if (el.querySelector('button, form, textarea, input, [contenteditable="true"], [role="textbox"], [role="dialog"]')) return false;
    const text = el.textContent || "";
    if (!text.includes(INVIS_START) || !text.includes(INVIS_END)) return false;

    // 오버레이 방식에서는 원본 raw text(envelope 포함)가 지워지지 않고 계속 남아있으므로
    // 여기서 CCF_RENDERED_ATTR을 무조건 지우면 안 된다 — tryRenderEncodedMessage의
    // "raw text 불변 시 재작업 스킵" 게이트가 무력화되어 매 스캔마다 재렌더가 발생함.
    if (el.children.length > 8) return false;

    const knownTextElement = el.matches?.(MESSAGE_TEXT_SELECTOR);
    const insideMessageSurface = !!el.closest?.(MESSAGE_SCOPE_SELECTOR);
    if (!knownTextElement && !insideMessageSurface) return false;
    if (!shouldRenderEncodedMessageNow(el)) {
      scheduleEncodedMessageRenderRetry(el);
      return false;
    }

    // .ccf-original-hidden은 우리가 감춰둔 el 자신의 원본(=el의 raw text), 진짜 "중첩된"
    // 인코딩 요소가 아니므로 제외 — 안 그러면 렌더 후 el이 영원히 이 함수에서 걸러져
    // 재스캔/재렌더(탭 전환 포함)가 다시는 못 일어난다.
    const nestedEncodedElement = [...el.children].some((child) => {
      if (child.classList.contains("ccf-original-hidden") || child.classList.contains("ccf-render-overlay")) return false;
      const childText = child.textContent || "";
      return childText.includes(INVIS_START) && childText.includes(INVIS_END);
    });
    if (nestedEncodedElement) return false;

    return true;
  }

  function shouldRenderEncodedMessageNow(el) {
    // 리스트의 마지막(최신) 메시지는 스크롤 위치/일시정지 게이트와 무관하게 즉시 렌더 —
    // 지연되면 새 메시지가 일반 레이아웃으로 한 번 그려졌다가 나레이션으로 바뀌는
    // 전환 과정이 사용자에게 보인다(FOUC).
    const newestItem = el.closest?.(MESSAGE_ITEM_SELECTOR);
    const newestWrap = newestItem?.closest?.("[data-index]") || newestItem;
    if (newestWrap?.parentElement && !newestWrap.nextElementSibling) return true;

    const scroller = findChatScrollContainer(el);
    if (!scroller) return true;
    const visible = isElementVisibleInScroller(el, scroller, 96);
    if (Date.now() < chatRenderPausedUntil) {
      return visible && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= HISTORY_RENDER_BOTTOM_THRESHOLD_PX;
    }
    if (visible) return true;
    if (Date.now() - lastChatScrollUpAt < CHAT_RENDER_PAUSE_AFTER_SCROLL_UP_MS) return false;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= HISTORY_RENDER_BOTTOM_THRESHOLD_PX;
  }

  function isElementVisibleInScroller(el, scroller, margin = 0) {
    if (!(el instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return false;
    try {
      const rect = el.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      return rect.bottom >= scrollerRect.top - margin && rect.top <= scrollerRect.bottom + margin;
    } catch (_) {
      return false;
    }
  }

  function scheduleEncodedMessageRenderRetry(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return;
    const current = pendingEncodedRenderRetries.get(el) || { attempt: 0, timer: 0 };
    if (current.timer || current.attempt >= ENCODED_RENDER_RETRY_DELAYS.length) return;

    const attempt = current.attempt;
    const timer = window.setTimeout(() => {
      pendingEncodedRenderRetries.set(el, { attempt: attempt + 1, timer: 0 });
      if (el.isConnected && (el.textContent || "").includes(INVIS_START) && (el.textContent || "").includes(INVIS_END)) {
        scanWithin(el);
      }
      const next = pendingEncodedRenderRetries.get(el);
      if (next && !next.timer) {
        pendingEncodedRenderRetries.delete(el);
      }
    }, ENCODED_RENDER_RETRY_DELAYS[attempt]);

    pendingEncodedRenderRetries.set(el, { attempt, timer });
  }

  function findChatScrollContainer(el) {
    let current = el instanceof HTMLElement ? el.parentElement : null;
    while (current && current !== document.documentElement) {
      const overflowY = getComputedStyle(current).overflowY || "";
      if (/(?:auto|scroll|overlay)/i.test(overflowY) && current.scrollHeight > current.clientHeight + 8) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function tryRenderEncodedMessage(el) {
    const text = el.textContent || "";
    const decoded = extractEnvelope(text);
    if (!decoded) return;

    const { visibleText, envelope } = decoded;
    if (!envelope || typeof envelope !== "object") return;
    if (typeof envelope.text !== "string") return;

    // 원본 raw text(envelope 포함)가 지난 렌더와 동일하면 재작업 불필요.
    // 오버레이 방식에서는 원본 text node를 지우지 않으므로 매 스캔마다 INVIS 마커가
    // 계속 감지되는데, 이 게이트가 없으면 mutation → scanWithin → 재렌더 → mutation... 무한 루프.
    if (el.getAttribute(CCF_RENDERED_ATTR) === "1" && el.getAttribute(CCF_RAW_ATTR) === text) {
      return;
    }

    // 가상화 리스트가 이 노드를 다른 메시지로 재사용해 raw text가 바뀐 재렌더인지,
    // 아니면 진짜 처음 렌더인지 구분. 재렌더에서까지 스크롤을 바닥으로 강제하면
    // 탭 전환/스크롤 중 recycle이 몰아칠 때 리스트 자체의 recycle 판단(scrollTop 기준)과
    // 충돌해 일부 행이 갱신되다 만 상태로 멈추는 원인이 된다 — 새 메시지가 처음
    // 나타날 때만 바닥 고정하고, 재렌더는 스크롤에 손대지 않는다.
    const isFirstRender = el.getAttribute(CCF_RENDERED_ATTR) !== "1";

    const renderText = envelope.text || visibleText || "";
    const runs = normalizeRuns(envelope.formatRuns, renderText.length);
    const alignRuns = getEffectiveAlignRuns(renderText, envelope.alignRuns, envelope.blockStyle);
    const narration = cleanupBlockStyle(envelope.blockStyle).narration === true;

    // [CCF NAR] 메시지 디코딩 결과 — 무조건 출력 (envelope 통째 + narration 판정)
    console.info("[CCF NAR] tryRenderEncodedMessage: narration=%o, envelope.blockStyle=%o, envelope.alignRuns=%o, hasPresence=%o, renderText=%o",
      narration,
      envelope.blockStyle,
      envelope.alignRuns,
      !!(envelope.presence || envelope["@p"] || envelope["@presence"]),
      renderText);

    const bottomScrollState = isFirstRender ? captureBottomAnchoredMessageScroller(el) : null;

    el.setAttribute(CCF_RAW_ATTR, text);

    const overlay = ensureRenderOverlay(el);
    applyNarrationMessageLayout(el, narration);

    if (!runs.length && !alignRuns.length && !narration) {
      overlay.textContent = renderText;
      if (isFirstRender) preserveBottomScrollAfterRender(bottomScrollState);
      el.setAttribute(CCF_RENDERED_ATTR, "1");
      return;
    }

    renderStyledText(overlay, renderText, runs, alignRuns);
    if (isFirstRender) preserveBottomScrollAfterRender(bottomScrollState);

    el.setAttribute(CCF_RENDERED_ATTR, "1");
  }

  // React가 소유한 원본 <p>의 text node(invisible envelope 포함)는 그대로 두고
  // 시각적으로만 접어 감춘 뒤, format-sync가 온전히 소유하는 형제 오버레이에 렌더한다.
  // 탭 전환 시 React가 원본 text node를 위치 기반으로 재사용해 값을 갱신해도
  // (detached node가 아니라 여전히 라이브 DOM에 붙어있는 노드이므로) 정상적으로
  // characterData mutation이 발생하고, 기존 전역 MutationObserver가 이를 감지해
  // 재스캔(scanWithin) → 재렌더로 이어진다.
  function ensureRenderOverlay(el) {
    el.classList.add("ccf-render-root");

    const existing = el.querySelector(":scope > .ccf-render-overlay");
    if (existing) {
      // 가드 위임 경로로 React가 새 자식을 el에 직접 넣었을 수 있음 — 래퍼로 회수해
      // 원문(invisible envelope 포함)이 오버레이와 이중 표시되는 것을 막는다.
      const hidden = el.querySelector(":scope > .ccf-original-hidden");
      if (hidden) {
        for (const child of [...el.childNodes]) {
          if (child !== hidden && child !== existing) hidden.appendChild(child);
        }
      }
      return existing;
    }

    // el의 기존 자식(React 소유 원본 text node, invisible envelope 포함)을 지우지 않고
    // display:none 래퍼로 옮겨 완전히 레이아웃에서 빼낸다. 같은 Text node 객체를 그대로
    // 재부모화(reparent)할 뿐이라 React가 들고 있는 참조는 여전히 유효 — 이후 값이
    // 갱신돼도(예: 탭 전환 시 가상화 리스트 재사용) 정상적으로 characterData mutation이
    // 발생해 기존 전역 MutationObserver가 감지한다.
    const hidden = document.createElement("span");
    hidden.className = "ccf-original-hidden";
    while (el.firstChild) {
      hidden.appendChild(el.firstChild);
    }
    el.appendChild(hidden);

    const overlay = document.createElement("span");
    overlay.className = "ccf-render-overlay";
    el.appendChild(overlay);
    return overlay;
  }

  function captureBottomAnchoredMessageScroller(el) {
    let current = el?.parentElement || null;
    while (current && current !== document.documentElement) {
      const overflowY = getComputedStyle(current).overflowY || "";
      if (/(?:auto|scroll|overlay)/i.test(overflowY)) {
        const gap = current.scrollHeight - current.scrollTop - current.clientHeight;
        return gap <= 48 ? { scroller: current, gap: Math.max(0, gap) } : null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function preserveBottomScrollAfterRender(state) {
    const scroller = state?.scroller;
    if (!(scroller instanceof HTMLElement) || !scroller.isConnected) return;
    // 바닥 근처였으면 잔여 gap을 유지하지 않고 정확히 바닥으로 (잔여 gap 영구 보존 방지).
    // scroll-behavior:smooth가 걸려 있으면 이동이 보이므로 일시적으로 auto 강제.
    const prevBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.style.scrollBehavior = prevBehavior;
  }

  function hideNarrationElements(item, messageEl) {
    if (!(item instanceof HTMLElement) || !(messageEl instanceof HTMLElement)) return;

    // React 재렌더/재스캔 시 이전 숨김 마크가 남지 않도록 먼저 정리
    item.querySelectorAll('[data-ccf-narration-hidden="1"]').forEach((el) => {
      el.removeAttribute("data-ccf-narration-hidden");
    });

    // 1. 프로필/아바타 영역 숨김
    const profiles = item.querySelectorAll(
      ".MuiAvatar-root, .MuiListItemAvatar-root, img:not(.ccf-image)"
    );

    profiles.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (messageEl.contains(node)) return;

      let target = node;
      let depth = 0;

      // 단독 래퍼 상승 제한:
      // - 최대 3단계까지만 상승
      // - 상위 래퍼가 본문(messageEl)을 포함하면 중단
      // - item 자체까지는 올라가지 않음
      while (
        target.parentElement &&
        target.parentElement !== item &&
        target.parentElement.children.length === 1 &&
        !target.parentElement.contains(messageEl) &&
        depth < 3
      ) {
        target = target.parentElement;
        depth += 1;
      }

      target.setAttribute("data-ccf-narration-hidden", "1");
    });

    // 2. 캐릭터 이름/시간 헤더 영역 숨김
    let current = messageEl;

    while (current && current !== item && current.parentElement) {
      let sibling = current.parentElement.firstElementChild;

      while (sibling && sibling !== current) {
        const hasText =
          sibling.matches?.(MESSAGE_TEXT_SELECTOR) ||
          sibling.querySelector?.(MESSAGE_TEXT_SELECTOR);

        const hasRenderRoot =
          sibling.matches?.(".ccf-render-root") ||
          sibling.querySelector?.(".ccf-render-root");

        const text = (sibling.textContent || "").trim();

        // 메시지 본문이 아니면서 실제 텍스트가 있는 헤더만 숨김
        // 빈 레이아웃 래퍼/여백용 Box/아이콘 전용 요소 오탐 방지
        if (!hasText && !hasRenderRoot && text) {
          sibling.setAttribute("data-ccf-narration-hidden", "1");
        }

        sibling = sibling.nextElementSibling;
      }

      current = current.parentElement;
    }
  }

  function showNarrationElements(item) {
    if (!(item instanceof HTMLElement)) return;

    item.querySelectorAll('[data-ccf-narration-hidden="1"]').forEach((el) => {
      el.removeAttribute("data-ccf-narration-hidden");
    });
  }

  // [v0.0.42] 나레이션 디버그 모드 (window.__CCF_NARRATION_DEBUG = true로 시각 외곽선 표시)
  // NARRATION_GUARDIANS WeakMap은 IIFE 상단(initRenderer 이전)에 선언됨 — TDZ 방지

  function applyNarrationMessageLayout(el, narration) {
    if (!(el instanceof HTMLElement)) return;

    // [CCF NAR] 진입 즉시 무조건 로그
    console.info("[CCF NAR] applyNarrationMessageLayout ENTRY: narration=%o, el=%o", narration, el);

    if (narration) {
      el.setAttribute(CCF_NARRATION_ATTR, "1");
      // [CCF NAR] render-root에 narration 어트리뷰트 부착
      console.info("[CCF NAR] render-root attr SET, el=%o", el);
    } else {
      el.removeAttribute(CCF_NARRATION_ATTR);
    }

    const item = findNarrationMessageItem(el);
    if (!(item instanceof HTMLElement) || item === el) {
      if (narration) {
        console.warn("[CCF NAR] findNarrationMessageItem returned %o (no LI ancestor)", item);
        // 새 메시지는 render-root가 LI에 부착되기 전에 처리될 수 있음 — 재시도
        const attempt = Number(el.dataset.ccfNarrationLayoutRetry || "0");
        if (attempt < 5) {
          el.dataset.ccfNarrationLayoutRetry = String(attempt + 1);
          setTimeout(() => {
            if (el.isConnected && el.getAttribute(CCF_NARRATION_ATTR) === "1") {
              applyNarrationMessageLayout(el, true);
            }
          }, 150 * (attempt + 1));
        }
      }
      return;
    }
    delete el.dataset.ccfNarrationLayoutRetry;

    if (narration) {
      item.setAttribute(CCF_NARRATION_ATTR, "1");
      console.info("[CCF NAR] LI item attr SET, item=%o", item);

      // [v0.0.42] 인라인 스타일 강제 주입 - CSS 미적용 케이스에도 동작
      forceInlineNarrationStyles(item, el);

      // [v0.0.42] React 재렌더 대비 가디언 설치
      installNarrationGuardian(item, el);

      // [v0.0.42] 시각 디버그: 1초간 빨간 외곽선 (window.__CCF_NARRATION_DEBUG === true일 때)
      if (window.__CCF_NARRATION_DEBUG === true) {
        const prevOutline = item.style.outline;
        item.style.outline = "2px solid red";
        setTimeout(() => { item.style.outline = prevOutline || ""; }, 1500);
      }

      hideNarrationElements(item, el);
      return;
    }

    if (!item.querySelector(`.ccf-render-root[${CCF_NARRATION_ATTR}="1"]`)) {
      item.removeAttribute(CCF_NARRATION_ATTR);
      showNarrationElements(item);
      uninstallNarrationGuardian(item);
      clearForcedInlineNarrationStyles(item);
    }
  }

  // [v0.0.42] CSS가 무력화되는 케이스를 위한 fallback - JS로 직접 display:none 주입
  function forceInlineNarrationStyles(item, messageEl) {
    if (!(item instanceof HTMLElement)) return;

    const hideSelectors = [
      ".MuiListItemAvatar-root",
      ".MuiAvatar-root",
      ".MuiListItemText-primary",
    ];

    let hiddenCount = 0;
    for (const sel of hideSelectors) {
      item.querySelectorAll(sel).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (messageEl && messageEl.contains(node)) return; // 본문 내부의 동명 요소는 건드리지 않음
        node.dataset.ccfNarrationForceHidden = "1";
        node.style.setProperty("display", "none", "important");
        hiddenCount += 1;
      });
    }

    // 본문 영역 가운데 정렬 — roll20-css-bridge의 연속발화(CONT) padding-left 56px가
    // center 중심을 우측으로 밀어내므로 좌우 패딩도 0으로 강제.
    item.querySelectorAll(".MuiListItemText-root").forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.dataset.ccfNarrationForceCenter = "1";
      node.style.setProperty("width", "100%", "important");
      // 상하여백은 CSS 규칙이 CONT(연속발화) 여부에 따라 결정 — 인라인 margin은
      // prose-cont의 margin:0을 덮어써 연속 나레이션 간격을 벌리므로 걸지 않는다.
      node.style.removeProperty("margin");
      node.style.setProperty("text-align", "center", "important");
      node.style.setProperty("padding-left", "0", "important");
      node.style.setProperty("padding-right", "0", "important");
    });

    console.info("[CCF NAR] forceInlineNarrationStyles: hidden=%o, item=%o", hiddenCount, item);
  }

  function clearForcedInlineNarrationStyles(item) {
    if (!(item instanceof HTMLElement)) return;
    item.querySelectorAll('[data-ccf-narration-force-hidden="1"]').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.removeProperty("display");
      delete node.dataset.ccfNarrationForceHidden;
    });
    item.querySelectorAll('[data-ccf-narration-force-center="1"]').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.removeProperty("width");
      node.style.removeProperty("margin");
      node.style.removeProperty("text-align");
      node.style.removeProperty("padding-left");
      node.style.removeProperty("padding-right");
      delete node.dataset.ccfNarrationForceCenter;
    });
  }

  function installNarrationGuardian(item, messageEl) {
    if (!(item instanceof HTMLElement)) return;
    // 기존 가디언이 있으면 재사용
    if (NARRATION_GUARDIANS.has(item)) return;

    const observer = new MutationObserver(() => {
      // render-root가 여전히 narration이면 어트리뷰트/스타일 재적용
      const hasNarrationChild = !!item.querySelector(`.ccf-render-root[${CCF_NARRATION_ATTR}="1"]`);
      if (!hasNarrationChild) {
        // 더 이상 narration 메시지가 없으면 가디언 해제
        uninstallNarrationGuardian(item);
        clearForcedInlineNarrationStyles(item);
        item.removeAttribute(CCF_NARRATION_ATTR);
        return;
      }
      if (item.getAttribute(CCF_NARRATION_ATTR) !== "1") {
        item.setAttribute(CCF_NARRATION_ATTR, "1");
      }
      // 인라인 스타일이 사라졌으면 재주입
      const sampleHidden = item.querySelector('[data-ccf-narration-force-hidden="1"]');
      if (!sampleHidden) {
        forceInlineNarrationStyles(item, messageEl);
      }
    });

    observer.observe(item, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-ccf-narration"],
    });

    NARRATION_GUARDIANS.set(item, observer);
    console.info("[CCF NAR] guardian installed on item=%o", item);
  }

  function uninstallNarrationGuardian(item) {
    if (!(item instanceof HTMLElement)) return;
    const observer = NARRATION_GUARDIANS.get(item);
    if (observer) {
      observer.disconnect();
      NARRATION_GUARDIANS.delete(item);
    }
  }

  function findNarrationMessageItem(el) {
    const matched = el.closest?.(MESSAGE_ITEM_SELECTOR);

    let current = el.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      if (current.matches?.(".MuiPaper-root, .MuiDrawer-paper")) break;
      const hasProfile = !!current.querySelector?.("img:not(.ccf-image), .MuiAvatar-root, .MuiListItemAvatar-root");
      const includesText = current.contains(el);
      if (hasProfile && includesText) return current;
    }
    return matched instanceof HTMLElement && matched !== el ? matched : null;
  }

  function extractEnvelope(fullText) {
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
      console.warn("[CCF] decode failed", error);
      return null;
    }
  }

  function decodeInvisibleToJson(encodedPart) {
    let bits = "";
    for (const ch of encodedPart) {
      const idx = INVIS_REVERSE.get(ch);
      if (idx == null) continue;
      bits += idx.toString(2).padStart(2, "0");
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
      if (
        prev &&
        prev.end === cur.start &&
        JSON.stringify(prev.style) === JSON.stringify(cur.style)
      ) {
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
    if (style.color) out.color = style.color;
    if (style.backgroundColor) out.backgroundColor = style.backgroundColor;
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
    const borderRadius = String(style.borderRadius || "").trim();
    if (borderRadius) out.borderRadius = borderRadius;
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

    if (trimmed.startsWith(LOCAL_IMAGE_TOKEN_PREFIX) || trimmed.startsWith(FIRESTORE_IMAGE_TOKEN_PREFIX)) {
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
      const parsed = new URL(trimmed);
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

  function isFirestoreImageToken(value) {
    return typeof value === "string" && value.startsWith(FIRESTORE_IMAGE_TOKEN_PREFIX);
  }

  function parseFirestoreImageToken(value) {
    if (!isFirestoreImageToken(value)) return null;
    const body = value.slice(FIRESTORE_IMAGE_TOKEN_PREFIX.length);
    const slash = body.indexOf("/");
    if (slash <= 0) return null;
    const roomId = decodeURIComponent(body.slice(0, slash));
    const imageId = decodeURIComponent(body.slice(slash + 1));
    return roomId && imageId ? { roomId, imageId } : null;
  }

  function getCachedFirestoreImageUrl(token) {
    const api = window.__CCF_FORMAT_SYNC_IMAGE_STORE__;
    return api && typeof api.peek === "function" ? api.peek(token) : "";
  }

  function resolveFirestoreImageToken(token) {
    const api = window.__CCF_FORMAT_SYNC_IMAGE_STORE__;
    if (api && typeof api.resolve === "function") return api.resolve(token);
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const waitForStore = () => {
        const nextApi = window.__CCF_FORMAT_SYNC_IMAGE_STORE__;
        if (nextApi && typeof nextApi.resolve === "function") {
          nextApi.resolve(token).then(resolve, reject);
          return;
        }
        attempts += 1;
        if (attempts >= 40) {
          reject(new Error("firestore-image-store-not-ready"));
          return;
        }
        setTimeout(waitForStore, 250);
      };
      waitForStore();
    });
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
    if (isFirestoreImageToken(normalized)) {
      return getCachedFirestoreImageUrl(normalized);
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
      return [{
        index: 0,
        start: 0,
        end: 0,
        text: "",
        hasBreak: false
      }];
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
    if (style?.narration === true) {
      out.narration = true;
    }
    return out;
  }

  function getLegacyAlignRuns(text, blockStyle) {
    const legacy = cleanupBlockStyle(blockStyle);
    const align = cleanupAlign(legacy.align);
    if (!align) return [];

    return [{
      start: 0,
      end: getTextLineCount(text),
      align
    }];
  }

  function getEffectiveAlignRuns(text, alignRuns, blockStyle = null) {
    if (cleanupBlockStyle(blockStyle).narration) {
      return [{
        start: 0,
        end: getTextLineCount(text),
        align: "center"
      }];
    }
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

      const styles = runs
        .filter((run) => run.start <= start && run.end >= end)
        .map((run) => run.style);

      out.push({
        text: text.slice(start, end),
        style: mergeStyles(styles)
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

  // -webkit-text-fill-color:transparent + text-shadow blur 방식.
  // filter:blur 는 stacking context를 생성해 overflow:hidden 부모 안에서 sibling까지
  // invisible 처리되는 Chrome 버그를 유발함. text-shadow 방식은 stacking context 없음.
  // _blurRevealHandlerBound: var 로 선언해 함수 스코프 hoist. let 사용 시 IIFE 상단
  // initRenderer() 호출(line ~178) 이 이 선언(line ~1783) 도달 전에 일어나면서
  // scanAndRenderAll → ... → applySoftBlur → ensureBlurRevealHandler 흐름에서 TDZ.

  function applySoftBlur(el, blurValue) {
    if (!(el instanceof HTMLElement)) return;
    const radius = Math.max(2, parseFloat(blurValue) || 4);
    el.style.setProperty("--ccf-blur-r", `${radius * 2}px`);
    el.style.userSelect = "none";
    el.style.webkitUserSelect = "none";
    el.setAttribute("data-ccf-blurred", "1");
    // cursor 모양 변경 / title 툴팁 부여 안 함 — 일반 사용자가 reveal 기능 존재를 알아채면 안 됨.
    ensureBlurRevealHandler();
  }

  function ensureBlurRevealHandler() {
    if (_blurRevealHandlerBound) return;
    _blurRevealHandlerBound = true;
    // capture 단계에서 가로채 다른 핸들러보다 먼저 처리.
    document.addEventListener("click", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target instanceof Element
        ? event.target.closest('[data-ccf-blurred="1"]')
        : null;
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.getAttribute("data-ccf-blur-revealed") === "1") {
        target.removeAttribute("data-ccf-blur-revealed");
      } else {
        target.setAttribute("data-ccf-blur-revealed", "1");
      }
    }, true);
    // reveal/hide를 CSS로 처리하기 위한 전용 스타일 한 번 주입.
    if (!document.getElementById("ccf-blur-reveal-style")) {
      const style = document.createElement("style");
      style.id = "ccf-blur-reveal-style";
      style.textContent = `
        [data-ccf-blurred="1"] {
          -webkit-text-fill-color: transparent !important;
          text-shadow: 0 0 var(--ccf-blur-r, 8px) currentColor !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          /* cursor: help 제거 — reveal 기능 존재 단서 차단 */
        }
        [data-ccf-blurred="1"][data-ccf-blur-revealed="1"] {
          -webkit-text-fill-color: inherit !important;
          text-shadow: none !important;
          user-select: text !important;
          -webkit-user-select: text !important;
          /* cursor: text 제거 — reveal 상태에서도 hover 단서 안 남김 */
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // 두 번째 IIFE(syncEditorVisualPreview / appendStyledFragment 흐름)도
  // applySoftBlur 를 호출하므로 cross-IIFE bridge 로 노출.
  // 첫 IIFE 의 _blurRevealHandlerBound 클로저를 공유하므로 click handler 도 1회만 bind.
  window.__CCF_FS_APPLY_SOFT_BLUR__ = applySoftBlur;

  function mergeStyles(styleList) {
    const out = {};
    for (const style of styleList) {
      if (style) {
        Object.assign(out, style);
      }
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
    if (style.borderRadius) el.style.borderRadius = style.borderRadius;
    if (style.border) el.style.border = style.border;
    if (style.letterSpacing) el.style.letterSpacing = style.letterSpacing;
    if (style.lineHeight) el.style.lineHeight = style.lineHeight;
    if (style.textAlign) el.style.textAlign = style.textAlign;
    if (style.textShadow) el.style.textShadow = style.textShadow;
    if (style.blur) applySoftBlur(el, style.blur);
    if (style.opacity != null) el.style.opacity = String(style.opacity);
  }

  function appendStyledFragment(container, frag) {
    if (!container || !frag) return;

    container.appendChild(createStyledFragmentNode(frag));
  }

  function createStyledFragmentNode(frag) {
    if (frag.style?.imageUrl) {
      return createImageFragmentNode(frag);
    }

    if (frag.style?.tooltipText) {
      return createTooltipFragmentNode(frag);
    }

    if (frag.style?.codeMode) {
      return createCodeFragmentNode(frag);
    }

    if (frag.style?.rubyText) {
      return createRubyFragmentNode(frag);
    }

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
    if (frag.style?.blur) applySoftBlur(wrapper, frag.style.blur);

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
    wrapper.className = "ccf-frag ccf-image-frag";

    const token = document.createElement("span");
    token.className = "ccf-image-token";
    token.textContent = frag.text || "";
    wrapper.appendChild(token);

    const rawImageUrl = normalizeImageUrl(frag.style.imageUrl);
    const imageUrl = resolveRenderableImageUrl(rawImageUrl);
    if (!imageUrl) {
      const fallback = document.createElement("span");
      fallback.textContent = isFirestoreImageToken(rawImageUrl) ? "이미지 불러오는 중…" : (frag.style.imageAlt || frag.text || "image");
      applyInlineStyle(fallback, frag.style);
      wrapper.appendChild(fallback);
      if (isFirestoreImageToken(rawImageUrl)) {
        void resolveFirestoreImageToken(rawImageUrl).then(() => {
          const next = createImageFragmentNode(frag);
          wrapper.replaceWith(next);
        }).catch((error) => {
          console.warn("[CCF] failed to resolve Firestore image", error);
          fallback.textContent = "이미지를 불러오지 못했습니다";
        });
      }
      return wrapper;
    }

    const img = document.createElement("img");
    img.className = "ccf-image";
    img.src = imageUrl;
    img.alt = frag.style.imageAlt || frag.text || "image";
    img.loading = "lazy";
    img.decoding = "async";
    applyInlineStyle(img, frag.style);

    wrapper.classList.add("has-image");
    wrapper.appendChild(img);
    return wrapper;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
})();

(() => {
  "use strict";

  const CCF_FS_RUNTIME = window.__CCF_FORMAT_SYNC_RUNTIME__ || null;
  const ccfFsWithSignal = CCF_FS_RUNTIME?.withSignal || ((options) => {
    if (options == null) return {};
    if (typeof options === "boolean") return { capture: options };
    return typeof options === "object" ? options : {};
  });
  const ccfFsRegisterTeardown = CCF_FS_RUNTIME?.registerTeardown || (() => {});
  const ccfFsIsActive = () => CCF_FS_RUNTIME?.isActive?.() !== false;

  // 첫 IIFE 의 extractEnvelope 를 cross-IIFE bridge 로 가져온다. 누락 시
  // preparePayloadForSend 가 봉투 디코딩에서 ReferenceError → 서식/이미지 미인코딩.
  const extractEnvelope = CCF_FS_RUNTIME?.extractEnvelope || (() => null);

  // 첫 IIFE 의 applySoftBlur 를 cross-IIFE bridge 로 가져온다.
  // 두 번째 IIFE 의 applyInlineStyle/appendStyledFragment 가 직접 호출하므로
  // 정의 안 되면 ReferenceError → syncEditorVisualPreview 등 미리보기 렌더 흐름 throw.
  const applySoftBlur = window.__CCF_FS_APPLY_SOFT_BLUR__ || (() => {
    console.warn("[CCF NAR] applySoftBlur bridge missing; blur preview skipped");
  });

  const OPEN_BTN_ATTR = "data-ccf-open-btn";
  const OPEN_BTN_SELECTOR = `.ccf-open-btn[${OPEN_BTN_ATTR}="1"]`;
  const INLINE_TOOLBAR_ATTR = "data-ccf-inline-toolbar";
  const INLINE_TOOLBAR_SELECTOR = `.ccf-inline-toolbar[${INLINE_TOOLBAR_ATTR}="1"]`;
  const MODAL_ID = "ccf-format-modal";
  const BACKDROP_ID = "ccf-format-backdrop";
  const STYLE_ID = "ccf-format-style";
  const FIX_STYLE_ID = "ccf-format-style-fix";
  const MODAL_SIZE_KEY = "ccf-format-modal-size-v1";
  const MODAL_MODE_KEY = "ccf-format-modal-mode-v1";
  const SAFE_UI_ATTR = "data-ccf-safe-markup";
  const BTN_BADGE_ATTR = "data-ccf-run-count";
  const MODAL_MODE_CCFOLIA = "ccfolia";
  const MODAL_MODE_ROLL20 = "roll20";
  const EDITOR_SELECTOR = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]';
  const CHARACTER_NAME_INPUT_SELECTOR = 'input[name="name"], input[placeholder="noname"]';
  const CHAT_MACRO_MENU_SELECTOR = '[role="listbox"], [id^="downshift-"][id$="-menu"]';
  const MESSAGE_HINT_RE = /message|chat|comment|send|메시지|채팅|입력|발언|メッセージ|チャット/i;
  const NAME_HINT_RE = /name|character|display.?name|chara|nickname|이름|캐릭터|닉네임|名前|キャラ/i;

  const INVIS_START = "\u2063\u2063\u2063";
  const INVIS_END = "\u2062\u2062\u2062";
  const INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
  const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24];
  const FONT_SIZE_MIN = 1;
  const FONT_SIZE_MAX = 200;
  const DEFAULT_BLUR_VALUE = "4px";
  const PARENTHETICAL_GRAY_COLOR = "#878787";
  const LOCAL_IMAGE_TOKEN_PREFIX = "ccf-local://image/";
  const FIRESTORE_IMAGE_TOKEN_PREFIX = "ccf-fs-image://";
  const LOCAL_IMAGE_STORAGE_PREFIX = "ccf-inline-image:";
  const LOCAL_IMAGE_INDEX_KEY = "ccf-inline-image:index";
  const LOCAL_IMAGE_MAX_ENTRIES = 24;
  const STYLE_CLIPBOARD_STORAGE_KEY = "ccf-format-style-clipboard-v1";
  const NARRATOR_STORAGE_KEY_PREFIX = "ccf-format-narrators-v1:";
  const MY_CHARACTER_ORDER_STORAGE_KEY = "ccf-log-package:my-character-order:v1";
  const MY_CHARACTER_NAMES_STORAGE_KEY = "ccf-log-package:my-character-names:v1";
  const MY_CHARACTER_PANEL_TITLES = [
    "\uB0B4 \uCE90\uB9AD\uD130 \uBAA9\uB85D",
    "\uB0B4 \uCE90\uB9AD\uD130 \uB9AC\uC2A4\uD2B8",
    "My character list",
    "My characters",
    "Character list"
  ];
  const CHARACTER_STATUS_TEXT_RE = /(?:\uD65C\uC131\uD654|\uBE44\uD65C\uC131\uD654)\s*\uC0C1\uD0DC|(?:active|inactive|enabled|disabled)\s*status/i;
  const ROLL20_STYLE_LINK_RE = /\[([^\]]*)\]\(#"\s*style="([^"]*?)"?\s*\)/gi;
  const ROLL20_IMAGE_LINK_RE = /^\s*\[([^\]]*)\]\(([^)\s]+)\)\s*$/i;
  const ROLL20_DESC_RE = /^\s*\/desc\b\s*/i;
  const ROLL20_NEWLINE_TOKEN_RE = /^\s*%NEWLINE%\s*$/i;
  const MODAL_DEFAULT_WIDTH = 380;
  const MODAL_DEFAULT_HEIGHT = 480;
  const MODAL_MIN_WIDTH = 320;
  const MODAL_MIN_HEIGHT = 320;
  const ROLL20_RECOMMENDED_MODAL_HEIGHT = MODAL_DEFAULT_HEIGHT;
  const MODAL_VIEWPORT_MARGIN = 24;
  const MODAL_POSITION_PADDING = 12;
  const MODAL_RESIZE_EDGE_THRESHOLD = 12;
  const IMAGE_POPOVER_GAP = 8;
  const IMAGE_POPOVER_VIEWPORT_MARGIN = 12;
  const IMAGE_POPOVER_DEFAULT_WIDTH = 320;
  const INLINE_NARRATOR_POPOVER_GAP = 6;
  const INLINE_NARRATOR_POPOVER_MARGIN = 12;

  const EDITOR_STATE = new WeakMap();
  const PENDING_SEND_RESTORE = new WeakMap();
  const EDITOR_VISUAL_PREVIEW = new WeakMap();
  const INLINE_SELECTION_HIGHLIGHT = new WeakMap();
  const INLINE_TOOLBARS = new WeakMap();
  const INLINE_TOOLBAR_EDITORS = new WeakMap();

  let activeComposer = null;
  let activeEditor = null;
  let lastFocusedEditor = null;
  let modalMode = readStoredModalMode();
  let modalDraftText = null;
  let modalDraftRuns = null;
  let modalDraftAlignRuns = null;
  let modalDraftBlockStyle = null;
  let modalDraftParentheticalGray = false;
  let modalDraftRoll20Text = null;
  let modalDraftRoll20ConvertedSource = null;
  let modalDraftLastStyle = null;
  let modalSelection = null;
  let inlinePopoverState = null;
  let modalSelectionRestoreToken = 0;
  let modalImageDragDepth = 0;
  let imagePopoverLayoutFrame = 0;
  let suppressRoomSync = false;
  let ifhHelperReady = false;
  let ifhHelperReadyPromise = null;
  let ifhHelperReadyResolver = null;
  let ifhBridgeListenerBound = false;
  let ifhBridgeRequestCounter = 0;
  const IFH_PENDING_REQUESTS = new Map();
  // IFH 상수/헬퍼 — 첫 번째 IIFE(bridge 페이지용)와 별개 스코프라 여기 다시 정의.
  // 이게 없어서 둘째 IIFE의 iFH 업로드 전체가 ReferenceError로 죽어 있었음.
  const IFH_ORIGIN = "https://ifh.cc";
  const IFH_HELPER_FRAME_ID = "ccf-ifh-helper-frame";
  const IFH_HELPER_URL = `${IFH_ORIGIN}/ko?ccf_ifh_bridge=1`;
  const IFH_BRIDGE_READY_TYPE = "ccf-ifh-ready";
  const IFH_BRIDGE_REQUEST_TYPE = "ccf-ifh-upload";
  const IFH_BRIDGE_RESULT_TYPE = "ccf-ifh-upload-result";
  const IFH_BRIDGE_ERROR_TYPE = "ccf-ifh-upload-error";
  const IFH_HELPER_TIMEOUT_MS = 60000;
  const IFH_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const IFH_SUPPORTED_IMAGE_EXT_RE = /\.(gif|png|bmp|jpe?g|webp|heic)$/i;

  function createIfhUploadError(message, code = "") {
    const error = new Error(message || "iFH upload failed");
    error.code = code;
    return error;
  }

  function getIfhUploadErrorMessage(error) {
    if (typeof error?.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
    return "iFH 이미지 업로드에 실패했습니다.";
  }

  function isIfhCompatibleImageFile(file) {
    if (!(file instanceof File)) return false;
    const lowerName = typeof file.name === "string" ? file.name.toLowerCase() : "";
    const lowerType = typeof file.type === "string" ? file.type.toLowerCase() : "";
    return IFH_SUPPORTED_IMAGE_EXT_RE.test(lowerName) || [
      "image/gif",
      "image/png",
      "image/bmp",
      "image/jpeg",
      "image/jpg",
      "image/webp",
      "image/heic",
      "image/heif"
    ].includes(lowerType);
  }

  const CHARACTER_SELECT_BUTTON_SELECTORS = [
    'button[aria-label="캐릭터 선택"]',
    'button[aria-label="Character selection"]',
    'button[aria-label="Select character"]',
    'button[aria-label="キャラクター選択"]',
    'button[aria-label="キャラクター 選択"]'
  ];
  let narratorScrapeHideStyle = null;
  let lastObservedSpeakerName = "";
  let characterSpeakerObserverStarted = false;
  let pendingSpeakerCheckTimer = 0;

  start();

  function start() {
    const tryInit = () => {
      if (!document.documentElement || !document.body) return false;
      if (document.body.dataset.ccfUserscriptReady === "1") {
        if (isUserscriptReadyMarkerCurrent()) return true;
        delete document.body.dataset.ccfUserscriptReady;
      }

      document.body.dataset.ccfUserscriptReady = "1";
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

    document.addEventListener("DOMContentLoaded", onReady, ccfFsWithSignal(true));
    window.addEventListener("load", onReady, ccfFsWithSignal(true));

    const timer = window.setInterval(() => {
      if (!ccfFsIsActive()) { window.clearInterval(timer); return; }
      if (tryInit()) {
        window.clearInterval(timer);
      }
    }, 500);
    ccfFsRegisterTeardown(() => window.clearInterval(timer));

    window.setTimeout(() => {
      window.clearInterval(timer);
    }, 15000);
  }

  function isUserscriptReadyMarkerCurrent() {
    return !!(
      document.getElementById(STYLE_ID) ||
      document.getElementById(MODAL_ID) ||
      document.querySelector(OPEN_BTN_SELECTOR) ||
      document.querySelector(INLINE_TOOLBAR_SELECTOR)
    );
  }

  function init() {
    console.info("[CCF NAR] init() called");
    injectStyles();
    cleanupKnownArtifacts();
    ensureUi();
    observeDom();
    bindGlobalEvents();
    // CCFOLIA React 초기 마운트 직후엔 textarea getBoundingClientRect()가 0 이어서
    // isVisible() 실패 → findComposerBars() 빈 결과 → 툴바 미생성 가능.
    // 일정 간격으로 재시도해 레이아웃이 완료된 후 툴바를 보장.
    [200, 800, 2000, 4000].forEach((delay) => {
      window.setTimeout(() => {
        if (!ccfFsIsActive()) return;
        const toolbars = document.querySelectorAll(INLINE_TOOLBAR_SELECTOR);
        if (toolbars.length === 0) {
          console.info("[CCF NAR] init retry at %oms: no toolbar found, calling ensureUi()", delay);
          ensureUi();
        }
      }, delay);
    });
    console.info("[CCF NAR] init() complete - toolbar should now exist");
    console.info("[CCF] formatter userscript loaded (v0.0.5: %NEWLINE% + direct image URL)");
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BACKDROP_ID} {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        z-index: 2147483000;
        display: none;
      }

      #${BACKDROP_ID}.show {
        display: block;
      }

      #${MODAL_ID} {
        position: fixed;
        width: min(${MODAL_DEFAULT_WIDTH}px, calc(100vw - ${MODAL_VIEWPORT_MARGIN}px));
        height: min(${MODAL_DEFAULT_HEIGHT}px, calc(100vh - ${MODAL_VIEWPORT_MARGIN}px));
        min-width: ${MODAL_MIN_WIDTH}px;
        min-height: ${MODAL_MIN_HEIGHT}px;
        max-width: calc(100vw - ${MODAL_VIEWPORT_MARGIN}px);
        max-height: calc(100vh - ${MODAL_VIEWPORT_MARGIN}px);
        overflow: hidden;
        left: ${MODAL_VIEWPORT_MARGIN}px;
        top: ${MODAL_VIEWPORT_MARGIN}px;
        background: #2b2b2b;
        color: #ffffff;
        border: 0;
        border-radius: 0;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
        z-index: 2147483001;
        display: none;
        flex-direction: column;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${MODAL_ID}.show {
        display: flex;
      }

      .ccf-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        font-weight: 700;
        cursor: move;
        user-select: none;
      }

      .ccf-modal-header-title {
        min-width: 0;
        flex: 1 1 auto;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .ccf-modal-header-title > span {
        font-size: 0.875rem;
        line-height: 1.4;
        font-weight: 700;
      }

      .ccf-modal-header-actions {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
      }

      .ccf-modal-header-action {
        border: 0;
        background: transparent;
        color: #ddd;
        cursor: pointer;
        font: inherit;
        line-height: 1;
        border-radius: 0;
        padding: 6px 8px;
      }

      .ccf-modal-header-action:hover,
      .ccf-modal-header-action:active {
        background: #383838;
      }

      .ccf-modal-header-action:focus-visible {
        outline: 2px solid rgba(110, 134, 214, 0.9);
        outline-offset: 1px;
      }

      .ccf-modal-reset-geometry,
      .ccf-modal-close {
        font-size: 18px;
        min-width: 32px;
        min-height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      .ccf-modal-reset-geometry svg {
        width: 20px;
        height: 20px;
        display: block;
        pointer-events: none;
        shape-rendering: geometricPrecision;
        transform: translateY(2px);
      }

      .ccf-modal-close svg {
        width: 20px;
        height: 20px;
        display: block;
        pointer-events: none;
      }

      .ccf-modal-close {
        font-weight: 500;
      }

      .ccf-modal-body {
        padding: 14px 16px 16px;
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
        overflow: hidden;
        background: #3c3c3c;
      }

      .ccf-modal-mode-toggle {
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        padding: 0;
      }

      .ccf-modal-mode-toggle svg {
        width: 18px;
        height: 18px;
        display: block;
        pointer-events: none;
      }

      .ccf-mode-panel {
        display: none;
        flex: 1 1 0;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        overflow: hidden;
      }

      .ccf-mode-panel.active {
        display: flex;
      }

      .ccf-mode-note {
        margin: 0;
        color: rgba(255, 255, 255, 0.72);
        font-size: 12px;
        line-height: 1.5;
      }

      .ccf-toggle-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 0;
      }

      .ccf-toolbar-row {
        align-items: center;
        row-gap: 4px;
        column-gap: 6px;
        align-content: flex-start;
        position: relative;
      }

      .ccf-image-tool {
        position: relative;
        flex: 0 0 auto;
      }

      .ccf-code-tool {
        position: relative;
        flex: 0 0 auto;
      }

      .ccf-toggle.ccf-image-toggle {
        min-width: 34px;
        width: 34px;
        height: 34px;
        padding: 7px;
        box-sizing: border-box;
        line-height: 0;
      }

      .ccf-toggle.ccf-image-toggle svg {
        width: 100%;
        height: 100%;
        display: block;
        flex: 0 0 auto;
        pointer-events: none;
      }

      .ccf-image-tool.open .ccf-image-toggle {
        background: #383838;
        border-color: #fafafa;
      }

      .ccf-code-tool.open .ccf-code-toggle {
        background: #383838;
        border-color: #fafafa;
      }

      .ccf-code-backdrop {
        position: fixed;
        inset: 0;
        display: none;
        background: rgba(0, 0, 0, 0.42);
        backdrop-filter: saturate(0.88) blur(1.5px);
        z-index: 2147483002;
      }

      .ccf-code-tool.open .ccf-code-backdrop {
        display: block;
      }

      .ccf-image-toolbox {
        position: fixed;
        top: 0;
        left: 0;
        right: auto;
        width: min(320px, calc(100vw - 80px));
        max-width: calc(100vw - 24px);
        box-sizing: border-box;
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border: 0;
        border-radius: 0;
        background: #2b2b2b;
        color: #fff;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.34);
        z-index: 2147483002;
      }

      .ccf-image-tool.open .ccf-image-toolbox {
        display: flex;
      }

      .ccf-image-toolbox.dragover {
        background: #383838;
      }

      .ccf-code-toolbox {
        position: fixed;
        top: 50%;
        left: 50%;
        right: auto;
        width: min(420px, calc(100vw - 32px));
        max-width: calc(100vw - 32px);
        display: none;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0;
        background: linear-gradient(180deg, rgba(52, 52, 52, 0.98), rgba(40, 40, 40, 0.98));
        color: #fff;
        box-shadow: 0 20px 48px rgba(0, 0, 0, 0.42);
        transform: translate(-50%, -50%);
        z-index: 2147483003;
      }

      .ccf-code-tool.open .ccf-code-toolbox {
        display: flex;
      }

      .ccf-code-input {
        width: 100%;
        min-height: 128px;
        max-height: 280px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0;
        background: #1e1e1e;
        color: #f3f3f3;
        padding: 10px 12px;
        box-sizing: border-box;
        resize: vertical;
        outline: none;
        font: 12.5px/1.5 Consolas, "Courier New", monospace;
        white-space: pre;
        overflow: auto;
        tab-size: 2;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      }

      .ccf-code-input::placeholder {
        color: rgba(255, 255, 255, 0.38);
      }

      .ccf-ruby-input {
        height: 40px;
        min-height: 40px;
        max-height: 40px;
        resize: none;
        overflow: hidden;
      }

      .ccf-tooltip-input {
        min-height: 108px;
      }

      .ccf-code-meta {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .ccf-code-note {
        min-width: 0;
        flex: 1 1 auto;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.68);
        line-height: 1.4;
      }

      .ccf-code-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        margin-left: auto;
        justify-content: flex-end;
      }

      .ccf-code-toolbox .ccf-btn {
        border-radius: 0;
      }

      .ccf-image-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }

      .ccf-image-url {
        width: 100%;
        height: 36px;
        border: 0;
        border-radius: 0;
        background: #202020;
        color: #fff;
        padding: 0 10px 1px;
        box-sizing: border-box;
        outline: none;
        font: inherit;
        line-height: 1.2;
      }

      .ccf-image-url::placeholder {
        color: rgba(255, 255, 255, 0.4);
        font-size: 12px;
      }

      .ccf-image-url[readonly] {
        color: rgba(255, 255, 255, 0.78);
        cursor: default;
      }

      .ccf-image-url:focus {
        border-color: transparent;
        box-shadow: none;
      }

      .ccf-image-row .ccf-btn {
        height: 36px;
        padding: 0 12px;
        white-space: nowrap;
      }

      .ccf-image-toolbox .ccf-btn {
        background: #3c3c3c;
      }

      .ccf-image-toolbox .ccf-btn:hover,
      .ccf-image-toolbox .ccf-btn:active {
        background: #383838;
      }

      .ccf-image-status {
        min-height: 18px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.68);
        line-height: 1.5;
      }

      .ccf-image-status[data-state="success"] {
        color: #a8f0c6;
      }

      .ccf-image-status[data-state="error"] {
        color: #ff9b9b;
      }

      .ccf-toggle {
        min-width: 36px;
        height: 36px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #282828;
        color: #fff;
        border-radius: 0;
        cursor: pointer;
        user-select: none;
        font-size: 13px;
      }

      .ccf-toggle.active {
        background: #383838;
        border-color: #fafafa;
      }

      .ccf-align-toggle svg {
        width: 16px;
        height: 16px;
        display: block;
        pointer-events: none;
      }

      .ccf-align-toggle {
        width: 36px;
        min-width: 36px;
        padding: 0;
        flex: 0 0 36px;
      }

      .ccf-line {
        display: block;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .ccf-ruby-frag {
        position: relative;
        display: inline-block;
        vertical-align: baseline;
        white-space: pre-wrap;
        overflow: visible;
        box-sizing: border-box;
        padding-top: 0.82em;
      }

      .ccf-ruby-frag::before {
        content: attr(data-ruby);
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        font-size: 0.62em;
        line-height: 1;
        white-space: nowrap;
        color: currentColor;
        pointer-events: none;
      }

      .ccf-ruby-base {
        display: inline;
      }

      .ccf-tooltip-frag {
        position: relative;
        display: inline-block;
        vertical-align: baseline;
        white-space: pre-wrap;
        overflow: visible;
        cursor: help;
        border-bottom: 1px dashed rgba(255, 255, 255, 0.96);
        padding-bottom: 0.02em;
        transition: background-color 120ms ease, color 120ms ease;
      }

      .ccf-tooltip-frag::before,
      .ccf-tooltip-frag::after {
        position: absolute;
        left: calc(100% + 6px);
        opacity: 0;
        visibility: hidden;
        transform: none;
        transition: opacity 120ms ease;
        pointer-events: none;
        z-index: 2;
      }

      .ccf-tooltip-frag::before {
        content: "";
        left: calc(100% + 12px);
        bottom: calc(100% + 2px);
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 6px solid rgba(18, 18, 18, 0.96);
      }

      .ccf-tooltip-frag::after {
        content: attr(data-tooltip);
        bottom: calc(100% + 8px);
        min-width: 40px;
        max-width: min(260px, calc(100vw - 32px));
        padding: 7px 10px;
        border-radius: 0;
        background: rgba(18, 18, 18, 0.96);
        color: #ffffff;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
        font-size: 12px;
        line-height: 1.35;
        text-align: left;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .ccf-tooltip-frag[data-tooltip-multiline="0"]::after {
        width: max-content;
        max-width: min(360px, calc(100vw - 32px));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ccf-tooltip-frag:hover::before,
      .ccf-tooltip-frag:hover::after {
        opacity: 1;
        visibility: visible;
      }

      .ccf-tooltip-frag:hover {
        background: rgba(255, 255, 255, 0.96);
        color: #000000;
        border-bottom-color: rgba(255, 255, 255, 0.96);
      }

      .ccf-tooltip-frag:hover,
      .ccf-tooltip-frag:hover * {
        color: #000000 !important;
      }

      .ccf-code-frag {
        font-family: Consolas, "Courier New", monospace;
        font-size: 0.92em;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.92);
        background: #000000;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        box-sizing: border-box;
      }

      .ccf-code-frag.is-inline {
        display: inline-block;
        padding: 0.08em 0.45em 0.12em;
        border-radius: 0;
        vertical-align: baseline;
      }

      .ccf-code-frag.is-block {
        display: block;
        width: 100%;
        margin: 6px 0;
        padding: 10px 12px;
        border-radius: 0;
      }

      .ccf-inline-tool {
        position: relative;
        width: 36px;
        height: 36px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #282828;
        border-radius: 0;
        box-sizing: border-box;
        overflow: hidden;
        flex: 0 0 auto;
      }

      .ccf-inline-tool:hover,
      .ccf-inline-tool:active,
      .ccf-toggle:hover,
      .ccf-toggle:active {
        background: #383838;
      }

      .ccf-color-tool::before {
        content: "";
        position: absolute;
        inset: 6px;
        border-radius: 0;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: var(--ccf-chip-color, #ffffff);
        pointer-events: none;
      }

      .ccf-color-tool input[type="color"] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
        border: 0;
        padding: 0;
        margin: 0;
      }

      .ccf-size-tool {
        width: 110px;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 30px;
        align-items: stretch;
        padding: 0;
        overflow: visible;
      }

      .ccf-size-step,
      .ccf-size-display,
      .ccf-size-tool input[type="text"] {
        width: 100%;
        height: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        text-align: center;
        font-family: inherit;
        outline: none;
      }

      .ccf-size-step {
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 18px;
        font-weight: 500;
        line-height: 1;
        padding-bottom: 2px;
      }

      .ccf-size-step:hover,
      .ccf-size-step:active,
      .ccf-size-display:hover,
      .ccf-size-display:active {
        background: #383838;
      }

      .ccf-size-value {
        position: relative;
        min-width: 0;
        border-left: 1px solid rgba(255, 255, 255, 0.12);
        border-right: 1px solid rgba(255, 255, 255, 0.12);
      }

      .ccf-size-display {
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: text;
      }

      .ccf-size-display[data-empty="1"] {
        color: rgba(255, 255, 255, 0.72);
        font-weight: 500;
      }

      .ccf-size-tool input[type="text"] {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
      }

      .ccf-size-tool input[type="text"]::placeholder {
        color: rgba(255, 255, 255, 0.4);
        font-weight: 500;
      }

      .ccf-size-tool.editing .ccf-size-display {
        opacity: 0;
        pointer-events: none;
      }

      .ccf-size-tool.editing input[type="text"] {
        opacity: 1;
        pointer-events: auto;
        background: #1f1f24;
      }

      .ccf-size-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        min-width: 72px;
        display: none;
        flex-direction: column;
        gap: 2px;
        padding: 6px;
        background: #1f1f24;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
        z-index: 2147483002;
      }

      .ccf-size-tool.editing .ccf-size-menu {
        display: flex;
      }

      .ccf-size-option {
        border: 0;
        border-radius: 0;
        padding: 6px 10px;
        background: #282828;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-family: inherit;
        text-align: center;
      }

      .ccf-size-option:hover,
      .ccf-size-option:active,
      .ccf-size-option.active {
        background: #383838;
      }

      .ccf-actions {
        display: flex;
        flex: 0 0 auto;
        gap: 8px;
        justify-content: flex-end;
        margin-top: 0;
        position: relative;
        z-index: 1;
      }

      .ccf-btn {
        border: 0;
        border-radius: 0;
        padding: 9px 12px;
        background: #282828;
        color: #fff;
        cursor: pointer;
        font-weight: 600;
      }

      .ccf-btn:hover,
      .ccf-btn:active {
        background: #383838;
      }

      .ccf-btn.secondary {
        background: #282828;
        color: #fff;
      }

      .ccf-btn.primary {
        background: #2b2b2b;
        color: #fff;
      }

      .ccf-btn.primary:hover,
      .ccf-btn.primary:active {
        background: #383838;
      }

      #ccf-roll20-convert {
        background: #2b2b2b;
      }

      #ccf-roll20-convert:hover,
      #ccf-roll20-convert:active {
        background: #383838;
      }

      .ccf-btn.danger {
        background: #282828;
        color: #fff;
      }

      .ccf-preview {
        margin-top: 0;
        margin-left: -16px;
        margin-right: -16px;
        width: calc(100% + 32px);
        background: #202020;
        border: 0;
        border-radius: 0;
        min-height: 96px;
        max-height: none;
        flex: 1 1 0;
        overflow: auto;
        padding: 10px 26px;
        box-sizing: border-box;
        background-clip: padding-box;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.5;
        font-size: 0.9375rem;
      }

      .ccf-image-frag {
        position: relative;
        display: inline-block;
        width: 100%;
        margin: 4px 0;
        vertical-align: top;
      }

      .ccf-image-frag.has-image {
        display: block;
        line-height: 0;
      }

      .ccf-image {
        display: block;
        width: auto;
        max-width: min(100%, 300px);
        height: auto;
        border: 0;
        border-radius: 0;
        box-sizing: border-box;
        margin: 0 auto;
      }

      .ccf-image-token {
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

      .ccf-preview-editor {
        outline: none;
        cursor: text;
        color: #ffffff;
        caret-color: #ffffff;
      }

      .ccf-preview-editor:focus {
        border-color: transparent;
        box-shadow: none;
      }

      .ccf-preview-editor[contenteditable="true"]:empty::before {
        content: "메시지를 입력";
        color: #878787;
        font-size: 0.8125rem;
        opacity: 1;
        pointer-events: none;
      }

      .ccf-roll20-editor {
        flex: 0 0 132px;
        min-height: 132px;
        max-height: 200px;
        width: calc(100% + 32px);
        box-sizing: border-box;
        margin-left: -16px;
        margin-right: -16px;
        padding: 12px 28px;
        border: 0;
        border-radius: 0;
        background: #202020;
        color: #ffffff;
        resize: none;
        outline: none;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow: auto;
        font: 13px/1.5 Consolas, "Courier New", monospace;
      }

      .ccf-roll20-editor:focus {
        border-color: transparent;
        box-shadow: none;
      }

      .ccf-mode-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }

      .ccf-roll20-status {
        flex: 1 1 180px;
        min-width: 0;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
      }

      .ccf-roll20-status[data-state="success"] {
        color: #a8f0c6;
      }

      .ccf-roll20-status[data-state="error"] {
        color: #ff9b9b;
      }

      .ccf-roll20-preview {
        flex: 1 1 0;
        min-height: 0;
        height: 0;
        overflow: auto;
      }

      .ccf-roll20-preview.is-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        color: #878787;
        font-size: 0.8125rem;
        text-align: center;
      }

      .ccf-open-btn {
        position: relative;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 0;
        border: none;
        cursor: pointer;
        background: transparent;
        color: inherit;
        margin-left: 4px;
      }

      .ccf-open-btn:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      .ccf-open-btn svg {
        width: 20px;
        height: 20px;
        display: block;
      }

      .ccf-open-btn::after {
        content: attr(${BTN_BADGE_ATTR});
        position: absolute;
        top: -3px;
        right: -3px;
        min-width: 16px;
        height: 16px;
        border-radius: 0;
        background: #5f7cff;
        color: white;
        font-size: 10px;
        line-height: 16px;
        text-align: center;
        padding: 0 4px;
        display: none;
        box-sizing: border-box;
      }

      .ccf-open-btn.has-runs::after {
        display: block;
      }

      .ccf-inline-toolbar {
        position: relative;
        z-index: 2147482500;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        row-gap: 4px;
        column-gap: 6px;
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 6px;
        padding: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0;
        background: rgba(32, 32, 32, 0.94);
        color: #fff;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
        font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .ccf-inline-toolbar .ccf-toggle {
        min-width: 30px;
        width: 30px;
        height: 30px;
        padding: 0;
        border-radius: 0;
        font-size: 12px;
      }

      .ccf-inline-toolbar .ccf-inline-tool {
        width: 30px;
        height: 30px;
        border-radius: 0;
      }

      .ccf-inline-toolbar .ccf-align-toggle {
        width: 30px;
        min-width: 30px;
        flex-basis: 30px;
      }

      .ccf-inline-toolbar .ccf-keep-toggle {
        width: auto;
        min-width: 42px;
        padding: 0 8px;
        font-weight: 700;
      }

      .ccf-inline-toolbar .ccf-align-toggle svg {
        width: 15px;
        height: 15px;
      }

      .ccf-inline-divider {
        width: 1px;
        height: 22px;
        flex: 0 0 1px;
        background: rgba(255, 255, 255, 0.16);
      }

      .ccf-inline-row-break {
        flex: 0 0 100%;
        width: 100%;
        height: 0;
      }

      /* 서식 프리셋 미니모달 (#70) */
      .ccf-style-preset-row {
        display: flex; align-items: center; gap: 4px; margin: 2px 0;
      }
      .ccf-style-preset-apply {
        all: unset; box-sizing: border-box; cursor: pointer;
        flex: 1; min-width: 0; padding: 5px 8px; border-radius: 0;
        background: rgba(255, 255, 255, 0.06); color: #fff;
        font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ccf-style-preset-apply:hover { background: rgba(255, 255, 255, 0.14); }
      .ccf-style-preset-remove {
        all: unset; box-sizing: border-box; cursor: pointer;
        width: 22px; height: 22px; border-radius: 0; flex: 0 0 22px;
        display: inline-grid; place-items: center;
        color: rgba(255, 255, 255, 0.6); font-size: 14px;
      }
      .ccf-style-preset-remove:hover { background: rgba(244, 67, 54, 0.25); color: #fff; }
      .ccf-style-preset-add-row {
        display: flex; align-items: center; gap: 4px; margin-top: 6px;
      }
      .ccf-style-preset-add-row .ccf-inline-popover-field { flex: 1; min-width: 0; }
      .ccf-style-preset-auto-dot {
        all: unset; box-sizing: border-box; cursor: pointer;
        width: 10px; height: 10px; flex: 0 0 10px; border-radius: 0;
        border: 1px solid rgba(255, 255, 255, 0.4);
        margin-right: 2px;
      }
      .ccf-style-preset-auto-dot[data-on="1"] { background: #ff0000; border-color: #ff0000; }
      .ccf-inline-popover.ccf-inline-float-popover { border-radius: 0; width: min(380px, calc(100vw - 24px)); }
      .ccf-style-preset-title-row {
        display: flex; align-items: center; justify-content: space-between; gap: 4px;
      }
      .ccf-style-preset-title-row .ccf-style-preset-remove { font-size: 16px; }
      .ccf-style-builder { display: flex; flex-direction: column; gap: 4px; }
      .ccf-style-builder-row { display: flex; align-items: center; gap: 4px; flex-wrap: nowrap; }
      .ccf-style-builder-row .ccf-toggle {
        min-width: 28px; width: 28px; height: 28px; padding: 0;
        border-radius: 0; font-size: 12px;
      }
      .ccf-style-builder-row .ccf-toggle[data-active="1"] {
        background: rgba(33, 150, 243, 0.35); color: #fff;
      }
      .ccf-style-builder-color {
        position: relative;
        width: 28px; height: 28px; flex: 0 0 28px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #282828;
        box-sizing: border-box; overflow: hidden; cursor: pointer;
      }
      .ccf-style-builder-color::before {
        content: "";
        position: absolute; inset: 6px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: var(--ccf-chip-color, #ffffff);
        pointer-events: none;
      }
      .ccf-style-builder-color input[type="color"] {
        position: absolute; inset: 0; width: 100%; height: 100%;
        opacity: 0; cursor: pointer; border: 0; padding: 0; margin: 0;
      }
      .ccf-style-builder-size { width: auto; flex: 1 1 36px; min-width: 36px; max-width: 52px; min-height: 28px; padding: 0 4px; text-align: center; }

      .ccf-inline-size-input {
        width: 44px;
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0;
        background: #282828;
        color: #fff;
        padding: 0 4px;
        box-sizing: border-box;
        outline: none;
        font: inherit;
        text-align: center;
      }

      .ccf-inline-size-input::placeholder {
        color: rgba(255, 255, 255, 0.55);
      }

      .ccf-inline-size-input[data-current-size="1"]::placeholder {
        color: rgba(255, 255, 255, 0.92);
        opacity: 1;
      }

      .ccf-inline-size-input:focus-visible,
      .ccf-inline-toolbar .ccf-toggle:focus-visible,
      .ccf-inline-toolbar .ccf-inline-tool:focus-within {
        outline: 2px solid rgba(110, 134, 214, 0.95);
        outline-offset: 1px;
      }

      .ccf-inline-popover {
        position: absolute;
        top: calc(100% + 6px);
        left: 6px;
        right: 6px;
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0;
        background: #2b2b2b;
        color: #fff;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.36);
      }

      .ccf-inline-popover.open {
        display: flex;
      }

      .ccf-inline-popover.ccf-inline-narrator-popover,
      .ccf-inline-popover.ccf-inline-float-popover {
        position: fixed;
        inset: auto;
        width: min(320px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        overflow: hidden;
        z-index: 2147483002;
      }

      .ccf-inline-popover.ccf-inline-narrator-popover .ccf-narrator-list {
        max-height: min(220px, calc(100vh - 166px));
      }

      .ccf-inline-popover-title {
        font-size: 12px;
        font-weight: 700;
      }

      .ccf-inline-popover-field {
        width: 100%;
        min-height: 34px;
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0;
        background: #1f1f1f;
        color: #fff;
        padding: 8px 9px;
        outline: none;
        resize: vertical;
        font: inherit;
      }

      textarea.ccf-inline-popover-field {
        min-height: 92px;
        line-height: 1.45;
      }

      .ccf-inline-popover-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .ccf-inline-popover-actions .ccf-btn {
        border-radius: 0;
        padding: 7px 10px;
      }

      .ccf-narrator-note {
        color: rgba(255, 255, 255, 0.78);
        font-size: 12px;
        padding: 4px 0;
      }

      .ccf-narrator-empty {
        color: rgba(255, 255, 255, 0.6);
        font-size: 12px;
        padding: 8px 4px;
      }

      .ccf-narrator-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 220px;
        overflow-y: auto;
        padding: 4px 0;
      }

      .ccf-narrator-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 0;
        background: #1f1f1f;
        color: rgba(255, 255, 255, 0.92);
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .ccf-narrator-item:hover {
        background: #2a2a2a;
      }

      .ccf-narrator-item.active {
        background: rgba(100, 149, 255, 0.18);
        border-color: rgba(100, 149, 255, 0.55);
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar {
        border-color: var(--ccf-theme-panel-border, var(--ccf-theme-border, rgba(255, 255, 255, 0.12)));
        background: var(--ccf-theme-paper, rgba(32, 32, 32, 0.94));
        color: var(--ccf-theme-text, #fff);
        box-shadow: 0 8px 24px var(--ccf-theme-shadow, rgba(0, 0, 0, 0.24));
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-toggle,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-tool,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-size-input,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-btn,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-style-builder-color,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-popover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-popover-field,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-item,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-menu,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-option {
        border-color: var(--ccf-theme-border, rgba(255, 255, 255, 0.12));
        background: var(--ccf-theme-input-bg, #282828);
        color: var(--ccf-theme-text, #fff);
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-toggle:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-toggle:active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-tool:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-tool:active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-step:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-step:active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-display:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-display:active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-option:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-option:active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-btn:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-btn:active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-style-preset-apply:hover,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-item:hover {
        background: var(--ccf-theme-hover, #383838);
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-toggle.active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-option.active,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-btn.primary,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-style-builder-row .ccf-toggle[data-active="1"],
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-item.active {
        border-color: var(--ccf-theme-focus-ring, var(--ccf-theme-border, rgba(100, 149, 255, 0.55)));
        background: var(--ccf-theme-control-active, #383838);
        color: var(--ccf-theme-text, #fff);
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-divider {
        background: var(--ccf-theme-border, rgba(255, 255, 255, 0.16));
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-value {
        border-color: var(--ccf-theme-border, rgba(255, 255, 255, 0.12));
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-tool.editing input[type="text"] {
        background: var(--ccf-theme-input-bg, #1f1f24);
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-size-input::placeholder,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-tool input[type="text"]::placeholder {
        color: var(--ccf-theme-placeholder, rgba(255, 255, 255, 0.55));
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-size-display[data-empty="1"],
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-note,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-empty,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-item .ccf-narrator-tag {
        color: var(--ccf-theme-muted-text, rgba(255, 255, 255, 0.6));
      }

      html[data-ccf-theme-active="1"] .ccf-inline-size-input:focus-visible,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-toggle:focus-visible,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-inline-tool:focus-within {
        outline-color: var(--ccf-theme-focus-ring, rgba(110, 134, 214, 0.95));
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-style-preset-apply {
        background: var(--ccf-theme-surface-strong, rgba(255, 255, 255, 0.06));
        color: var(--ccf-theme-text, #fff);
      }

      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-style-preset-remove,
      html[data-ccf-theme-active="1"] .ccf-inline-toolbar .ccf-narrator-item .ccf-narrator-check {
        color: var(--ccf-theme-muted-text, rgba(255, 255, 255, 0.6));
      }

      .ccf-narrator-item .ccf-narrator-check {
        width: 14px;
        text-align: center;
        color: rgba(120, 200, 120, 0.92);
        font-weight: 700;
      }

      .ccf-narrator-item .ccf-narrator-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ccf-narrator-item .ccf-narrator-tag {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
      }

      .ccf-narrator-item.is-current .ccf-narrator-name {
        font-weight: 600;
      }

      .ccf-narrator-item.is-orphan {
        opacity: 0.7;
      }

      .ccf-preview-empty {
        opacity: 0.5;
      }

      .ccf-editor-preview-layer {
        position: absolute;
        pointer-events: none;
        overflow: hidden;
        box-sizing: border-box;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
        z-index: 1;
      }

      .ccf-inline-selection-layer {
        position: fixed;
        pointer-events: none;
        overflow: hidden;
        box-sizing: border-box;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
        color: transparent !important;
        -webkit-text-fill-color: transparent;
        z-index: 2147483001;
      }

      .ccf-inline-selection-layer .ccf-inline-selection-mark {
        background: rgba(100, 149, 255, 0.34);
        border-radius: 0;
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
      }

      .ccf-editor-preview-content {
        min-height: 100%;
        will-change: transform;
      }

      .ccf-editor-preview-source {
        color: transparent !important;
        -webkit-text-fill-color: transparent;
        caret-color: var(--ccf-editor-caret-color, currentColor) !important;
      }

    `;
    document.documentElement.appendChild(style);

    if (!document.getElementById(FIX_STYLE_ID)) {
      const fixStyle = document.createElement("style");
      fixStyle.id = FIX_STYLE_ID;
      fixStyle.textContent = `
        #${BACKDROP_ID} {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.35);
          z-index: 2147483000;
          display: none;
        }

        #${BACKDROP_ID}.show {
          display: block;
        }

        #${MODAL_ID} {
          position: fixed;
          width: min(${MODAL_DEFAULT_WIDTH}px, calc(100vw - ${MODAL_VIEWPORT_MARGIN}px));
          height: min(${MODAL_DEFAULT_HEIGHT}px, calc(100vh - ${MODAL_VIEWPORT_MARGIN}px));
          min-width: ${MODAL_MIN_WIDTH}px;
          min-height: ${MODAL_MIN_HEIGHT}px;
          max-width: calc(100vw - ${MODAL_VIEWPORT_MARGIN}px);
          max-height: calc(100vh - ${MODAL_VIEWPORT_MARGIN}px);
          overflow: hidden;
          left: ${MODAL_VIEWPORT_MARGIN}px;
          top: ${MODAL_VIEWPORT_MARGIN}px;
          background: #2b2b2b;
          color: #ffffff;
          border: 0;
          border-radius: 0;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
          z-index: 2147483001;
          display: none;
          flex-direction: column;
        }

        #${MODAL_ID}.show {
          display: flex;
        }

        .ccf-preview-editor {
          color: #ffffff;
          caret-color: #ffffff;
        }

        .ccf-preview-editor[contenteditable="true"]:empty::before {
          content: "\\BA54\\C2DC\\C9C0\\B97C\\0020\\C785\\B825";
          color: #878787;
          font-size: 0.8125rem;
          opacity: 1;
          pointer-events: none;
        }
      `;
      document.documentElement.appendChild(fixStyle);
    }
  }

  function cleanupKnownArtifacts() {
    document.getElementById("ccf-smoketest-badge")?.remove();
  }

  function observeDom() {
    // mutation 폭주 방지: rAF 1회로 합쳐 ensureUi() 호출.
    let scheduled = 0;
    const scheduleEnsure = () => {
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(() => {
        scheduled = 0;
        ensureUi();
      });
    };

    const mo = new MutationObserver((mutations) => {
      const shouldRefresh = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (target?.closest?.(`[${SAFE_UI_ATTR}="1"]`)) {
          return false;
        }

        // attribute 변경(style/class/hidden 등): React 마운트 직후 textarea getBoundingClientRect
        // 가 0 → layout 완료 시 style/class 변경으로 가시화되는 시점을 캐치.
        // childList 변동 없이 display:none→block 만 토글되는 경우 기존 옵저버가 놓침.
        if (mutation.type === "attributes") {
          return true;
        }

        const nodes = [
          ...Array.from(mutation.addedNodes || []),
          ...Array.from(mutation.removedNodes || [])
        ];

        return nodes.some((node) => {
          if (!(node instanceof Element)) return true;
          return !node.closest?.(`[${SAFE_UI_ATTR}="1"]`);
        });
      });

      if (shouldRefresh) {
        scheduleEnsure();
      }
    });

    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });
    ccfFsRegisterTeardown(() => {
      if (scheduled) {
        window.cancelAnimationFrame(scheduled);
        scheduled = 0;
      }
      mo.disconnect();
    });
  }

  function bindGlobalEvents() {
    document.addEventListener("keydown", (event) => {
      if (handleFormatShortcut(event)) {
        return;
      }

      if (event.key === "Escape") {
        if (isModalOpen() && isRubyPopoverOpen()) {
          event.preventDefault();
          event.stopPropagation();
          setRubyPopoverOpen(false, { focusToggle: true });
          return;
        }
        if (isModalOpen() && isTooltipPopoverOpen()) {
          event.preventDefault();
          event.stopPropagation();
          setTooltipPopoverOpen(false, { focusToggle: true });
          return;
        }
        if (isModalOpen() && isCodePopoverOpen()) {
          event.preventDefault();
          event.stopPropagation();
          setCodePopoverOpen(false, { focusToggle: true });
          return;
        }
        if (isModalOpen() && isStyleClipboardPopoverOpen()) {
          event.preventDefault();
          event.stopPropagation();
          setStyleClipboardPopoverOpen(false, { focusToggle: true });
          return;
        }
        if (isModalOpen() && isImagePopoverOpen()) {
          event.preventDefault();
          event.stopPropagation();
          setImagePopoverOpen(false, { focusToggle: true });
          return;
        }
        closeModal();
      }
    }, ccfFsWithSignal(true));

    document.addEventListener("mousedown", (event) => {
      handleInlineToolbarDocumentMouseDown(event);

      if (!isModalOpen()) return;

      if (isCodePopoverOpen()) {
        const codeTool = getCodeTool();
        if (codeTool && event.target instanceof Node && !codeTool.contains(event.target)) {
          setCodePopoverOpen(false);
        }
      }

      if (isStyleClipboardPopoverOpen()) {
        const tool = getStyleClipboardTool();
        if (tool && event.target instanceof Node && !tool.contains(event.target)) {
          setStyleClipboardPopoverOpen(false);
        }
      }

      if (!isImagePopoverOpen()) return;
      const imageTool = getImageTool();
      if (!imageTool || !(event.target instanceof Node) || imageTool.contains(event.target)) return;
      setImagePopoverOpen(false);
    }, ccfFsWithSignal(true));

    document.addEventListener("selectionchange", () => {
      syncInlineToolbarSelectionFromDocument();

      if (!isModalOpen()) return;
      const modalEditor = getModalEditor();
      if (!modalEditor) return;

      const selection = getEditorSelection(modalEditor);
      if (selection) {
        setModalSelection(selection, getEditorText(modalEditor).length);
        syncFontSizeControlsFromModalSelection();
      }
    }, ccfFsWithSignal());

    document.addEventListener("focusin", (event) => {
      const editor = normalizeEditorCandidate(event.target);
      if (!editor) return;

      const composer = findComposerForEditor(editor);
      if (!composer) return;

      lastFocusedEditor = editor;
      activeComposer = composer;
      if (!isModalOpen()) {
        activeEditor = editor;
      }
      syncEditorVisualPreview(editor);
      try {
        refreshAllInlineNarrationButtons();
      } catch (error) {
        console.error("[ccf-format-sync] refreshAllInlineNarrationButtons failed", error);
      }
    }, ccfFsWithSignal(true));

    try {
      startCharacterSpeakerObserver();
    } catch (error) {
      console.error("[ccf-format-sync] startCharacterSpeakerObserver failed", error);
    }

    window.addEventListener("resize", () => {
      if (isModalOpen()) {
        constrainModalSize();
        ensureRoll20ModalHeight();
        constrainModalPosition();
        persistModalGeometry();
        scheduleImagePopoverPosition();
      }
      if (inlinePopoverState?.kind === "narrator") {
        positionInlineNarratorPopover(inlinePopoverState.toolbar);
      }
      syncAllEditorVisualPreviews();
    }, ccfFsWithSignal());

    document.addEventListener("scroll", (event) => {
      // isScrolledToBottom / scanWithin / lastChatScrollUpAt 은 첫 IIFE 스코프라
      // 이 IIFE 에서는 접근 불가 (cross-IIFE, 미브리지). 브리지 전까지 스캔 블록은
      // 비활성 — typeof 가드로 감싸 ReferenceError 콘솔 오염 방지.
      if (event.target instanceof HTMLElement && typeof isScrolledToBottom === "function") {
        if (isScrolledToBottom(event.target)) {
          scanWithin(event.target);
        } else {
          lastChatScrollUpAt = Date.now();
        }
      }
      if (inlinePopoverState?.kind === "narrator") {
        positionInlineNarratorPopover(inlinePopoverState.toolbar);
      }
    }, ccfFsWithSignal(true));
  }

  function ensureUi() {
    cleanupKnownArtifacts();
    if (isHomeRoute()) {
      removeFormatButtons();
      closeModal();
      return;
    }
    ensureFormatButtons();
    bindSendButtons();
    bindEnterSendForEditors();
    bindEditorVisualPreview();
    bindEditorInputSync();
    // [CCF NAR] ensureUi가 호출됐는지 확인. 호출되면 bindEnterSendForEditors도 매번 실행됨
    if (!window.__CCF_NAR_ENSUREUI_LOGGED) {
      console.info("[CCF NAR] ensureUi() FIRST PASS — bindEnterSendForEditors invoked");
      window.__CCF_NAR_ENSUREUI_LOGGED = true;
    }
  }

  function isHomeRoute() {
    const normalizedPath = (window.location.pathname || "").replace(/\/+$/, "") || "/";
    return normalizedPath === "/home";
  }

  function removeFormatButtons() {
    document.querySelectorAll(OPEN_BTN_SELECTOR).forEach((btn) => btn.remove());
    document.querySelectorAll(INLINE_TOOLBAR_SELECTOR).forEach((toolbar) => toolbar.remove());
  }

  function ensureFormatButtons() {
    document.querySelectorAll(OPEN_BTN_SELECTOR).forEach((btn) => btn.remove());
    cleanupOrphanInlineToolbars();

    const composers = findComposerBars();
    if (composers.length === 0) {
      console.info("[CCF NAR] ensureFormatButtons: no visible composer bars found (submit buttons=%o)",
        document.querySelectorAll('button[type="submit"]').length);
    }
    for (const composer of composers) {
      ensureInlineToolbarForComposer(composer);
    }
    for (const dialog of findEditMessageDialogBars()) {
      ensureInlineToolbarForEditDialog(dialog);
    }
  }

  function ensureInlineToolbarForEditDialog(dialog) {
    const editor = dialog.querySelector('textarea[name="text"]');
    if (!(editor instanceof HTMLTextAreaElement) || !isVisible(editor)) return null;

    hydrateEditDialogStateFromEnvelope(editor);
    ensureEditDialogSaveHook(dialog, editor);
    markEditDialogForThemeOverride(dialog);

    const dialogContent = dialog.querySelector('.MuiDialogContent-root') || dialog;
    if (!(dialogContent instanceof HTMLElement)) return null;

    let toolbar = INLINE_TOOLBARS.get(editor);
    if (toolbar && document.contains(toolbar)) {
      bindInlineToolbarToEditor(toolbar, editor, dialog);
      if (toolbar.parentElement !== dialogContent || dialogContent.firstElementChild !== toolbar) {
        dialogContent.insertBefore(toolbar, dialogContent.firstChild);
      }
      return toolbar;
    }

    toolbar = createInlineToolbar();
    toolbar.setAttribute("data-ccf-dialog-toolbar", "1");
    toolbar.querySelectorAll('input, button').forEach((el) => {
      el.setAttribute("form", "ccf-detached-toolbar");
    });
    dialogContent.insertBefore(toolbar, dialogContent.firstChild);
    bindInlineToolbarToEditor(toolbar, editor, dialog);
    updateInlineToolbarVisuals(toolbar);
    return toolbar;
  }

  const EDIT_DIALOG_FONT = 'Roboto, "Helvetica Neue", Arial, sans-serif';
  const EDIT_DIALOG_TEXT_COLOR = "rgba(255, 255, 255, 0.87)";

  function markEditDialogForThemeOverride(dialog) {
    ensureEditDialogPseudoResetStyles();
    if (!(dialog instanceof HTMLElement)) return;
    dialog.setAttribute("data-ccf-edit-dialog", "1");
    const paper = dialog.matches('.MuiDialog-paper')
      ? dialog
      : (dialog.closest('.MuiDialog-paper') || dialog.querySelector('.MuiDialog-paper'));
    if (paper instanceof HTMLElement) {
      paper.setAttribute("data-ccf-edit-dialog", "1");
    }
    applyEditDialogResetInlineStyles(dialog);
  }

  function ensureEditDialogPseudoResetStyles() {
    if (document.getElementById("ccf-edit-dialog-pseudo-reset")) return;
    const style = document.createElement("style");
    style.id = "ccf-edit-dialog-pseudo-reset";
    style.setAttribute(SAFE_UI_ATTR, "1");
    style.textContent = `
      html [data-ccf-edit-dialog="1"] .MuiDialogActions-root,
      html [data-ccf-edit-dialog="1"] .MuiDialogContent-root,
      html [data-ccf-edit-dialog="1"] .MuiFilledInput-root,
      html [data-ccf-edit-dialog="1"] .MuiInputBase-root,
      html [data-ccf-edit-dialog="1"] .MuiFormControl-root,
      html [data-ccf-edit-dialog="1"] form,
      html [data-ccf-edit-dialog="1"][class*="MuiDialog-paper"] {
        box-shadow: none !important;
        outline: none !important;
      }
      html [data-ccf-edit-dialog="1"] .MuiDialogActions-root::before,
      html [data-ccf-edit-dialog="1"] .MuiDialogActions-root::after,
      html [data-ccf-edit-dialog="1"] .MuiDialogContent-root::before,
      html [data-ccf-edit-dialog="1"] .MuiDialogContent-root::after,
      html [data-ccf-edit-dialog="1"] form::before,
      html [data-ccf-edit-dialog="1"] form::after,
      html [data-ccf-edit-dialog="1"] .MuiFormControl-root::before,
      html [data-ccf-edit-dialog="1"] .MuiFormControl-root::after,
      html [data-ccf-edit-dialog="1"] .MuiFilledInput-root::before,
      html [data-ccf-edit-dialog="1"] .MuiFilledInput-root::after,
      html [data-ccf-edit-dialog="1"] .MuiInputBase-root::before,
      html [data-ccf-edit-dialog="1"] .MuiInputBase-root::after,
      html [data-ccf-edit-dialog="1"] .MuiPaper-root::before,
      html [data-ccf-edit-dialog="1"] .MuiPaper-root::after,
      html [data-ccf-edit-dialog="1"][class*="MuiDialog-paper"]::before,
      html [data-ccf-edit-dialog="1"][class*="MuiDialog-paper"]::after {
        display: none !important;
        content: none !important;
        border: 0 !important;
        background: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] input,
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] button,
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] label,
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] span {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        text-shadow: none !important;
        letter-spacing: normal !important;
      }
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] .ccf-inline-size-input {
        background-color: #282828 !important;
        background-image: none !important;
        color: #fff !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 6px !important;
        box-shadow: none !important;
      }
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] .ccf-toggle {
        background-color: transparent !important;
        background-image: none !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        color: #fff !important;
        box-shadow: none !important;
      }
      html [data-ccf-edit-dialog="1"] [${INLINE_TOOLBAR_ATTR}="1"] .ccf-toggle.active {
        background-color: rgba(255, 255, 255, 0.12) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyEditDialogResetInlineStyles(dialog) {
    const paper = dialog.matches('.MuiDialog-paper')
      ? dialog
      : (dialog.closest('.MuiDialog-paper') || dialog.querySelector('.MuiDialog-paper'));

    const paperTarget = paper instanceof HTMLElement ? paper : (dialog instanceof HTMLElement ? dialog : null);
    if (paperTarget) {
      forceStyle(paperTarget, {
        "background-color": "rgba(33, 33, 33, 0.85)",
        "background-image": "none",
        "background-attachment": "scroll",
        color: EDIT_DIALOG_TEXT_COLOR,
        border: "none",
        "border-radius": "0",
        "box-shadow": "0px 11px 15px -7px rgba(0,0,0,0.2),0px 24px 38px 3px rgba(0,0,0,0.14),0px 9px 46px 8px rgba(0,0,0,0.12)",
        "font-family": EDIT_DIALOG_FONT,
        "text-shadow": "none",
        "letter-spacing": "normal",
        "backdrop-filter": "none",
        filter: "none",
        "max-width": "444px",
        "min-width": "0",
        width: "444px"
      });
    }

    dialog.querySelectorAll('form, [class^="sc-"], [class*=" sc-"]').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      forceStyle(el, {
        "background-color": "transparent",
        "background-image": "none",
        border: "none",
        "box-shadow": "none",
        color: EDIT_DIALOG_TEXT_COLOR,
        "font-family": EDIT_DIALOG_FONT,
        "text-shadow": "none",
        "letter-spacing": "normal"
      });
    });

    dialog.querySelectorAll('.MuiDialogContent-root').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      forceStyle(el, {
        "background-color": "transparent",
        "background-image": "none",
        padding: "0",
        color: EDIT_DIALOG_TEXT_COLOR,
        "font-family": EDIT_DIALOG_FONT
      });
    });

    dialog.querySelectorAll('.MuiDialogActions-root').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      forceStyle(el, {
        "background-color": "transparent",
        "background-image": "none",
        padding: "8px",
        color: EDIT_DIALOG_TEXT_COLOR,
        "border-left": "none",
        "border-right": "none",
        "border-bottom": "none",
        "border-top": "1px solid #2196f3",
        "box-shadow": "none"
      });
    });

    dialog.querySelectorAll('.MuiInputLabel-root, .MuiFormLabel-root').forEach((label) => {
      if (!(label instanceof HTMLElement)) return;
      if (label.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      forceStyle(label, {
        color: "rgba(255, 255, 255, 0.7)",
        "background-color": "transparent",
        "background-image": "none",
        "font-family": EDIT_DIALOG_FONT,
        "font-size": "12px",
        "font-weight": "400",
        "text-shadow": "none",
        "letter-spacing": "normal"
      });
    });

    dialog.querySelectorAll('textarea').forEach((textarea) => {
      if (!(textarea instanceof HTMLElement)) return;
      forceStyle(textarea, {
        color: EDIT_DIALOG_TEXT_COLOR,
        "background-color": "transparent",
        "background-image": "none",
        "font-family": EDIT_DIALOG_FONT,
        "font-size": "16px",
        "font-weight": "400",
        "letter-spacing": "normal",
        "text-shadow": "none",
        "caret-color": EDIT_DIALOG_TEXT_COLOR
      });
    });

    dialog.querySelectorAll('.MuiFilledInput-root, .MuiInputBase-root').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      forceStyle(el, {
        "background-color": "rgba(255, 255, 255, 0.13)",
        "background-image": "none",
        border: "none",
        "border-radius": "0",
        "box-shadow": "none",
        color: EDIT_DIALOG_TEXT_COLOR,
        "font-family": EDIT_DIALOG_FONT
      });
    });

    dialog.querySelectorAll('.MuiButton-root').forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      if (btn.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      forceStyle(btn, {
        color: "#2196f3",
        "background-color": "transparent",
        "background-image": "none",
        "font-family": EDIT_DIALOG_FONT,
        "font-size": "14px",
        "font-weight": "500",
        "letter-spacing": "0.02857em",
        "text-transform": "uppercase",
        "text-shadow": "none",
        border: "none",
        "border-radius": "0"
      });
    });

    const toolbar = dialog.querySelector(`[${INLINE_TOOLBAR_ATTR}="1"]`);
    if (toolbar instanceof HTMLElement) {
      forceStyle(toolbar, {
        position: "absolute",
        bottom: "100%",
        left: "0",
        right: "0",
        width: "100%",
        "box-sizing": "border-box",
        "border-radius": "0",
        margin: "0",
        "border-left": "none",
        "border-right": "none",
        "border-top": "none",
        "border-bottom": "1px solid rgba(255,255,255,0.12)",
        "background-color": "rgba(32, 32, 32, 0.94)",
        "background-image": "none"
      });
      toolbar.querySelectorAll('.ccf-inline-size-input').forEach((sz) => {
        if (!(sz instanceof HTMLElement)) return;
        forceStyle(sz, {
          "background-color": "#282828",
          "background-image": "none",
          color: "#fff",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          "border-radius": "6px",
          "box-shadow": "none",
          "font-family": 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          "text-shadow": "none",
          padding: "0 4px"
        });
      });
      toolbar.querySelectorAll('.ccf-toggle').forEach((btn) => {
        if (!(btn instanceof HTMLElement)) return;
        forceStyle(btn, {
          "background-color": "transparent",
          "background-image": "none",
          color: "#fff",
          "box-shadow": "none",
          "text-shadow": "none"
        });
      });
    }

    if (paperTarget) {
      forceStyle(paperTarget, {
        position: "relative",
        overflow: "visible"
      });
    }
  }

  function forceStyle(el, styleMap) {
    if (!(el instanceof HTMLElement)) return;
    Object.keys(styleMap).forEach((prop) => {
      el.style.setProperty(prop, styleMap[prop], "important");
    });
  }

  function hydrateEditDialogStateFromEnvelope(editor) {
    if (editor.dataset.ccfEditDialogHydrated === "1") return;
    editor.dataset.ccfEditDialogHydrated = "1";

    const fullText = editor.value || "";
    const state = ensureEditorState(editor);
    const decoded = extractEnvelope(fullText);
    if (decoded) {
      const { visibleText, envelope } = decoded;
      state.text = visibleText;
      state.runs = normalizeRuns(envelope.formatRuns || [], visibleText.length);
      state.alignRuns = Array.isArray(envelope.alignRuns) ? envelope.alignRuns : [];
      state.blockStyle = envelope.blockStyle || {};
      setEditorText(editor, visibleText);
    } else {
      state.text = fullText;
      state.runs = [];
      state.alignRuns = [];
      state.blockStyle = {};
    }
  }

  function ensureEditDialogSaveHook(dialog, editor) {
    if (dialog.dataset.ccfEditSaveBound === "1") return;
    dialog.dataset.ccfEditSaveBound = "1";

    dialog.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      if (!dialog.contains(button)) return;
      if (button.closest(`[${INLINE_TOOLBAR_ATTR}="1"]`)) return;
      const label = (button.textContent || "").trim();
      if (!/^(저장|Save|保存)/i.test(label)) return;
      try {
        preparePayloadForSend(editor);
      } catch (error) {
        console.warn("[CCF NAR] edit-dialog save hook failed", error);
      }
    }, true);
  }

  function findEditMessageDialogBars() {
    const result = [];
    document.querySelectorAll('[role="dialog"], .MuiDialog-root').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement)) return;
      if (dialog.id === MODAL_ID || dialog.querySelector(`#${MODAL_ID}`)) return;
      if (!isVisible(dialog)) return;
      const textarea = dialog.querySelector('textarea[name="text"]');
      if (textarea instanceof HTMLElement && isVisible(textarea)) {
        result.push(dialog);
      }
    });
    return result;
  }

  function cleanupOrphanInlineToolbars() {
    document.querySelectorAll(INLINE_TOOLBAR_SELECTOR).forEach((toolbar) => {
      const editor = INLINE_TOOLBAR_EDITORS.get(toolbar) || toolbar.__ccfEditor || null;
      if (editor && document.contains(editor) && isVisible(editor)) return;
      toolbar.remove();
    });
  }

  function ensureInlineToolbarForComposer(composer) {
    const editor = findEditorFromComposer(composer);
    if (!editor) return null;

    const anchor = getInlineToolbarAnchor(editor);
    const parent = anchor?.parentElement;
    if (!parent) return null;

    let toolbar = INLINE_TOOLBARS.get(editor);
    if (toolbar && document.contains(toolbar)) {
      bindInlineToolbarToEditor(toolbar, editor, composer);
      if (toolbar.nextElementSibling !== anchor) {
        parent.insertBefore(toolbar, anchor);
      }
      return toolbar;
    }

    toolbar = findInlineToolbarNearAnchor(anchor);
    if (!toolbar) {
      toolbar = createInlineToolbar();
      parent.insertBefore(toolbar, anchor);
    }

    bindInlineToolbarToEditor(toolbar, editor, composer);
    updateInlineToolbarVisuals(toolbar);
    return toolbar;
  }

  function getInlineToolbarAnchor(editor) {
    if (!(editor instanceof HTMLElement)) return null;
    return editor.closest(".MuiInputBase-root, .MuiFormControl-root") || editor;
  }

  function findInlineToolbarNearAnchor(anchor) {
    const previous = anchor?.previousElementSibling;
    return previous?.matches?.(INLINE_TOOLBAR_SELECTOR) ? previous : null;
  }

  function bindInlineToolbarToEditor(toolbar, editor, composer = null) {
    if (!toolbar || !editor) return;
    toolbar.__ccfEditor = editor;
    toolbar.__ccfComposer = composer || findComposerForEditor(editor);
    INLINE_TOOLBARS.set(editor, toolbar);
    INLINE_TOOLBAR_EDITORS.set(toolbar, editor);
  }

  function createInlineToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "ccf-inline-toolbar";
    toolbar.setAttribute(INLINE_TOOLBAR_ATTR, "1");
    toolbar.setAttribute(SAFE_UI_ATTR, "1");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Format tools");
    toolbar.innerHTML = `
      <button type="button" class="ccf-toggle" data-inline-command="bold" title="Bold" aria-label="Bold"><b>B</b></button>
      <button type="button" class="ccf-toggle" data-inline-command="italic" title="Italic" aria-label="Italic"><i>I</i></button>
      <button type="button" class="ccf-toggle" data-inline-command="underline" title="Underline" aria-label="Underline"><u>U</u></button>
      <button type="button" class="ccf-toggle" data-inline-command="strike" title="Strike" aria-label="Strike"><s>S</s></button>
      <span class="ccf-inline-divider" aria-hidden="true"></span>
      <button type="button" class="ccf-toggle" data-inline-command="ruby" title="Ruby" aria-label="Ruby">Rb</button>
      <button type="button" class="ccf-toggle" data-inline-command="tooltip" title="Tooltip" aria-label="Tooltip">Tip</button>
      <button type="button" class="ccf-toggle" data-inline-command="blur" title="Blur" aria-label="Blur">Bl</button>
      <button type="button" class="ccf-toggle" data-inline-command="code" title="Code block" aria-label="Code block">&lt;/&gt;</button>
      <button type="button" class="ccf-toggle" data-inline-command="narration" title="Narration" aria-label="Narration" aria-pressed="false">Nr</button>
      <span class="ccf-inline-row-break" aria-hidden="true"></span>
      <button type="button" class="ccf-toggle ccf-align-toggle active" data-inline-command="align" data-align="left" title="Align left" aria-label="Align left">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3h12v1H2zm0 6h8v1H2zm0 6h12v1H2z"/></svg>
      </button>
      <button type="button" class="ccf-toggle ccf-align-toggle" data-inline-command="align" data-align="center" title="Align center" aria-label="Align center">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3h12v1H2zm4 6h4v1H6zM3 15h10v-1H3z"/></svg>
      </button>
      <button type="button" class="ccf-toggle ccf-align-toggle" data-inline-command="align" data-align="right" title="Align right" aria-label="Align right">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 3h12v1H2zm6 6h6v1H8zM2 15h12v-1H2z"/></svg>
      </button>
      <span class="ccf-inline-divider" aria-hidden="true"></span>
      <label class="ccf-inline-tool ccf-color-tool" title="Text color" aria-label="Text color">
        <input type="color" value="#ffffff" data-inline-color="color" aria-label="Text color">
      </label>
      <label class="ccf-inline-tool ccf-color-tool" title="Background color" aria-label="Background color">
        <input type="color" value="#000000" data-inline-color="backgroundColor" aria-label="Background color">
      </label>
      <input class="ccf-inline-size-input" data-inline-size type="text" inputmode="numeric" pattern="[0-9]*" placeholder="크기" aria-label="Font size" title="Font size">
      <button type="button" class="ccf-toggle ccf-keep-toggle" data-inline-command="keep" title="\uC774\uC804 \uC11C\uC2DD \uC720\uC9C0" aria-label="\uC774\uC804 \uC11C\uC2DD \uC720\uC9C0" aria-pressed="false">\uC720\uC9C0</button>
      <button type="button" class="ccf-toggle" data-inline-command="style-clipboard" title="\uC11C\uC2DD \uC800\uC7A5" aria-label="\uC11C\uC2DD \uC800\uC7A5">Sv</button>
      <button type="button" class="ccf-toggle" data-inline-command="paren-gray" title="Parentheses gray" aria-label="Parentheses gray" aria-pressed="false">()</button>
      <div class="ccf-inline-popover" data-inline-popover aria-hidden="true"></div>
    `;

    bindInlineToolbarEvents(toolbar);
    try {
      refreshInlineNarrationButton(toolbar);
    } catch (error) {
      console.error("[ccf-format-sync] refreshInlineNarrationButton (init) failed", error);
    }
    return toolbar;
  }

  function bindInlineToolbarEvents(toolbar) {
    if (!toolbar || toolbar.dataset.ccfInlineToolbarBound === "1") return;
    toolbar.dataset.ccfInlineToolbarBound = "1";

    toolbar.addEventListener("mousedown", (event) => {
      captureInlineToolbarSelection(toolbar);
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("[data-inline-popover]")) return;
      if (target.closest("input, select, textarea, .ccf-color-tool")) return;
      event.preventDefault();
    }, true);

    toolbar.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      if (target.matches?.("[data-inline-size]")) {
        moveInlineSizeCursorToEnd(target);
        showInlineToolbarSelectionHighlight(toolbar);
        return;
      }

      // 서식 빌더 토글 (#70) — B/I/U/S는 개별 토글, 정렬은 셋 중 하나
      const builderToggle = target.closest("[data-style-builder], [data-style-builder-align]");
      if (builderToggle && toolbar.contains(builderToggle)) {
        event.preventDefault();
        event.stopPropagation();
        if (builderToggle.hasAttribute("data-style-builder-align")) {
          const host = builderToggle.closest("[data-style-builder-host]");
          host?.querySelectorAll("[data-style-builder-align]").forEach((b) => b.removeAttribute("data-active"));
          builderToggle.setAttribute("data-active", "1");
        } else {
          const on = builderToggle.getAttribute("data-active") === "1";
          if (on) builderToggle.removeAttribute("data-active");
          else builderToggle.setAttribute("data-active", "1");
        }
        updateStyleBuilderPreview(builderToggle.closest(".ccf-inline-popover"));
        return;
      }

      const styleAction = target.closest("[data-inline-style-action]");
      if (styleAction && toolbar.contains(styleAction)) {
        event.preventDefault();
        event.stopPropagation();
        const state = inlinePopoverState;
        if (!state || state.toolbar !== toolbar || state.kind !== "style-clipboard") return;
        const action = styleAction.getAttribute("data-inline-style-action");
        // 서식 프리셋 액션 (#70): add / apply / remove
        if (action === "add") {
          const popoverEl = state.popover;
          const nameInput = popoverEl?.querySelector("[data-style-preset-name]");
          const draft = collectStyleBuilderDraft(popoverEl);
          if (addStylePresetFromBuilder(nameInput?.value || "", draft)) {
            openInlineStyleClipboardPopover(toolbar, { reuseContext: true }); // 목록 갱신
          }
          return;
        }
        if (action === "remove") {
          const idx = Number(styleAction.getAttribute("data-preset-index"));
          const preset = readStylePresets()[idx];
          if (preset && removeStylePreset(preset.name)) {
            openInlineStyleClipboardPopover(toolbar, { reuseContext: true }); // 목록 갱신
          }
          return;
        }
        if (action === "edit") {
          const idx = Number(styleAction.getAttribute("data-preset-index"));
          const preset = readStylePresets()[idx];
          if (preset) loadStylePresetIntoBuilder(state.popover, preset);
          return;
        }
        if (action === "auto") {
          // 프리셋별 자동 적용 토글 (#70) — ON=빨간 점, OFF=빈 점
          const idx = Number(styleAction.getAttribute("data-preset-index"));
          const list = readStylePresets();
          const preset = list[idx];
          if (!preset) return;
          preset.auto = preset.auto === false;
          if (writeStylePresets(list)) {
            const on = preset.auto !== false;
            styleAction.setAttribute("data-on", on ? "1" : "0");
            styleAction.setAttribute("title", `자동 적용 ${on ? "ON" : "OFF"} — 클릭으로 전환`);
          }
          return;
        }
        if (action === "apply") {
          const idx = Number(styleAction.getAttribute("data-preset-index"));
          const preset = readStylePresets()[idx];
          if (preset && applyStylePresetToContext(state.context, preset)) {
            closeInlinePopover(toolbar, { restoreFocus: false });
            restoreRoomSelectionSoon(state.editor, state.selection);
            showInlineToolbarSelectionHighlight(toolbar);
            updateInlineToolbarVisuals(toolbar);
          }
          return;
        }
        return;
      }

      const narratorAction = target.closest("[data-inline-narrator-action]");
      if (narratorAction && toolbar.contains(narratorAction)) {
        event.preventDefault();
        event.stopPropagation();
        const action = narratorAction.getAttribute("data-inline-narrator-action");
        if (action === "toggle") {
          const name = narratorAction.getAttribute("data-inline-narrator-name") || "";
          toggleNarratorName(name);
          updateInlineNarratorPopoverList(toolbar);
          refreshAllInlineNarrationButtons();
          syncAllEditorVisualPreviews();
          if (isModalOpen() && activeEditor) {
            renderPreview(activeEditor, { force: true });
          }
        } else if (action === "refresh") {
          refreshInlineNarratorPopover(toolbar, { forcePanelScan: true });
        }
        return;
      }

      const popoverAction = target.closest("[data-inline-popover-action]");
      if (popoverAction && toolbar.contains(popoverAction)) {
        event.preventDefault();
        event.stopPropagation();
        const action = popoverAction.getAttribute("data-inline-popover-action");
        if (action === "apply") {
          applyInlinePopover(toolbar);
        } else {
          closeInlinePopover(toolbar);
        }
        return;
      }

      const commandButton = target.closest("[data-inline-command]");
      if (!commandButton || !toolbar.contains(commandButton)) return;

      event.preventDefault();
      event.stopPropagation();
      handleInlineToolbarCommand(toolbar, commandButton);
    }, true);

    toolbar.addEventListener("input", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches?.('input[type="color"][data-inline-color]')) {
        updateInlineToolbarVisuals(toolbar);
        applyInlineToolbarStyle(toolbar, {
          selectionOverride: getInlineToolbarSelection(toolbar)
        });
        return;
      }

      if (target?.matches?.("[data-inline-size]")) {
        sanitizeInlineSizeInput(target);
        moveInlineSizeCursorToEnd(target);
        target.dataset.sizePreviewApplied = "1";
        applyInlineToolbarStyle(toolbar, {
          selectionOverride: getInlineToolbarSelection(toolbar),
          restoreSelection: false
        });
        showInlineToolbarSelectionHighlight(toolbar);
      }
    }, true);

    toolbar.addEventListener("change", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches?.('input[type="color"][data-inline-color]')) {
        updateInlineToolbarVisuals(toolbar);
        applyInlineToolbarStyle(toolbar, {
          selectionOverride: getInlineToolbarSelection(toolbar)
        });
        return;
      }

      if (target?.matches?.("[data-inline-size]")) {
        sanitizeInlineSizeInput(target);
        target.dataset.sizePreviewApplied = "1";
        applyInlineToolbarStyle(toolbar, {
          selectionOverride: getInlineToolbarSelection(toolbar),
          restoreSelection: false
        });
        showInlineToolbarSelectionHighlight(toolbar);
      }
    }, true);

    toolbar.addEventListener("focusin", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches?.("[data-inline-size]")) return;
      captureInlineToolbarSelection(toolbar);
      target.dataset.editingSize = "1";
      delete target.dataset.sizePreviewApplied;
      // 포커스 시 기존 숫자를 잠시 비워 새 값 입력이 바로 되게 (#99)
      if (target instanceof HTMLInputElement && target.value) {
        target.dataset.priorSize = target.value;
        target.value = "";
      }
      moveInlineSizeCursorToEnd(target);
      showInlineToolbarSelectionHighlight(toolbar);
    }, true);

    toolbar.addEventListener("focusout", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches?.("[data-inline-size]")) return;
      delete target.dataset.editingSize;
      // 비운 채 그냥 나가면 이전 값 복원 (#99)
      if (target instanceof HTMLInputElement && !target.value && target.dataset.priorSize) {
        target.value = target.dataset.priorSize;
      }
      delete target.dataset.priorSize;
      sanitizeInlineSizeInput(target);
      if (target.dataset.sizePreviewApplied === "1") {
        applyInlineToolbarStyle(toolbar, {
          selectionOverride: getInlineToolbarSelection(toolbar),
          restoreSelection: false
        });
      }
      delete target.dataset.sizePreviewApplied;
      setTimeout(() => {
        const nextActive = document.activeElement;
        if (nextActive instanceof Element && toolbar.contains(nextActive)) return;
        restoreInlineToolbarEditorSelection(toolbar);
        hideInlineToolbarSelectionHighlight(toolbar);
      }, 0);
    }, true);

    toolbar.addEventListener("keydown", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.matches?.("[data-inline-size]")) {
        handleInlineSizeKeydown(toolbar, target, event);
        return;
      }

      if (!target?.matches?.(".ccf-inline-popover-field")) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeInlinePopover(toolbar);
        return;
      }

      const state = inlinePopoverState;
      const isSingleLine = state?.toolbar === toolbar && !state.multiline;
      const shouldApply =
        (event.key === "Enter" && isSingleLine) ||
        (event.key === "Enter" && (event.ctrlKey || event.metaKey));

      if (!shouldApply) return;
      event.preventDefault();
      event.stopPropagation();
      applyInlinePopover(toolbar);
    }, true);
  }

  function handleInlineToolbarCommand(toolbar, commandButton) {
    const command = commandButton.getAttribute("data-inline-command") || "";
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return;

    if (command === "keep") {
      const nextActive = !commandButton.classList.contains("active");
      commandButton.classList.toggle("active", nextActive);
      commandButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
      // 유지를 끄는 순간 — 유지 중이던 토글 표시/기억 서식 즉시 초기화 (#98)
      if (!nextActive) {
        resetInlineToolbarStyleControls(toolbar);
        const editor = getInlineToolbarEditor(toolbar);
        if (editor) ensureEditorState(editor).lastStyle = null;
      }
      return;
    }

    if (["bold", "italic", "underline", "strike"].includes(command)) {
      const nextActive = !commandButton.classList.contains("active");
      commandButton.classList.toggle("active", nextActive);
      commandButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
      applyInlineToolbarStyle(toolbar, {
        selectionOverride: getInlineToolbarSelection(toolbar)
      });
      return;
    }

    if (command === "align") {
      const align = commandButton.getAttribute("data-align") || "left";
      setInlineToolbarAlignment(toolbar, align);
      applyInlineAlignment(editor, align, getInlineToolbarSelection(toolbar));
      return;
    }

    if (command === "blur") {
      const selection = getInlineToolbarSelection(toolbar);
      const applied = applyBlurToCurrentSelection(selection);
      if (applied) {
        restoreRoomSelectionSoon(editor, selection);
        const editorState = ensureEditorState(editor);
        const editorText = getEditorText(editor);
        const nowBlur = selection
          ? getSharedStyleValueForSelection(editorState.runs, selection, "blur", editorText.length)
          : null;
        commandButton.classList.toggle("active", !!nowBlur);
        commandButton.setAttribute("aria-pressed", nowBlur ? "true" : "false");
      }
      return;
    }

    if (command === "ruby" || command === "tooltip") {
      openInlineTextPopover(toolbar, command);
      return;
    }

    if (command === "code") {
      openInlineCodePopover(toolbar);
      return;
    }

    if (command === "style-clipboard") {
      // 토글 — 이미 열려 있으면 닫기 (#70)
      if (inlinePopoverState?.kind === "style-clipboard"
        && inlinePopoverState.toolbar === toolbar
        && inlinePopoverState.popover?.classList.contains("open")) {
        closeInlinePopover(toolbar, { restoreFocus: false });
        return;
      }
      openInlineStyleClipboardPopover(toolbar);
      return;
    }

    if (command === "paren-gray") {
      const selection = getInlineToolbarSelection(toolbar);
      const state = ensureEditorState(editor);
      const nextActive = state.parentheticalGray !== true;
      state.parentheticalGray = nextActive;
      commandButton.classList.toggle("active", nextActive);
      commandButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
      if (nextActive) {
        applyParentheticalGrayToEditor(editor, selection);
      }
      if (selection?.start !== selection?.end) {
        restoreRoomSelectionSoon(editor, selection);
        showInlineToolbarSelectionHighlight(toolbar);
      }
      return;
    }

    if (command === "narration") {
      openInlineNarratorPopover(toolbar);
      return;
    }
  }

  function handleInlineSizeKeydown(toolbar, input, event) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      sanitizeInlineSizeInput(input);
      applyInlineToolbarStyle(toolbar, {
        selectionOverride: getInlineToolbarSelection(toolbar),
        restoreSelection: false
      });
      input.dataset.sizePreviewApplied = "1";
      delete input.dataset.editingSize;
      input.blur?.();
      restoreInlineToolbarEditorSelection(toolbar);
      hideInlineToolbarSelectionHighlight(toolbar);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      input.blur?.();
      restoreInlineToolbarEditorSelection(toolbar);
      return;
    }

    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();

    const direction = event.key === "ArrowUp" ? 1 : -1;
    const step = event.shiftKey ? 10 : 1;
    const baseSize =
      normalizeFontSizeValue(input.value) ??
      normalizeFontSizeValue(input.placeholder) ??
      16;
    input.value = String(clamp(baseSize + (direction * step), FONT_SIZE_MIN, FONT_SIZE_MAX));
    input.dataset.sizePreviewApplied = "1";
    applyInlineToolbarStyle(toolbar, {
      selectionOverride: getInlineToolbarSelection(toolbar),
      restoreSelection: false
    });
    showInlineToolbarSelectionHighlight(toolbar);
  }

  function moveInlineSizeCursorToEnd(input) {
    if (!(input instanceof HTMLInputElement)) return;
    setTimeout(() => {
      if (!document.contains(input)) return;
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch {}
    }, 0);
  }

  function sanitizeInlineSizeInput(input) {
    if (!(input instanceof HTMLInputElement)) return "";
    const sanitized = input.value.replace(/[^d]/g, "").slice(0, 3);
    if (input.value !== sanitized) {
      input.value = sanitized;
    }
    return sanitized;
  }

  function getInlineToolbarEditor(toolbar) {
    const mapped = INLINE_TOOLBAR_EDITORS.get(toolbar) || toolbar?.__ccfEditor || null;
    if (mapped && document.contains(mapped) && isVisible(mapped)) return mapped;
    return getCurrentTargetEditor();
  }

  function activateInlineToolbarEditor(toolbar) {
    const editor = getInlineToolbarEditor(toolbar);
    if (!editor) return null;

    activeEditor = editor;
    activeComposer = toolbar?.__ccfComposer || findComposerForEditor(editor);
    lastFocusedEditor = editor;
    ensureEditorState(editor);
    return editor;
  }

  function captureInlineToolbarSelection(toolbar) {
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return null;

    const selection = getEditorSelection(editor);
    const normalized = normalizeSelectionRange(selection, getEditorText(editor).length);
    if (normalized && normalized.start !== normalized.end) {
      toolbar.__ccfSelection = normalized;
    }
    return toolbar.__ccfSelection || null;
  }

  function getInlineToolbarSelection(toolbar) {
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return null;

    const textLength = getEditorText(editor).length;
    const current = getEditorSelection(editor);
    const normalizedCurrent = normalizeSelectionRange(current, textLength);
    if (normalizedCurrent && normalizedCurrent.start !== normalizedCurrent.end) {
      toolbar.__ccfSelection = normalizedCurrent;
    }

    return normalizeSelectionRange(toolbar.__ccfSelection, textLength);
  }

  function getInlineToolbarForEditor(editor) {
    if (!editor) return null;

    const mapped = INLINE_TOOLBARS.get(editor);
    if (mapped && document.contains(mapped)) return mapped;

    const composer = findComposerForEditor(editor);
    return composer ? ensureInlineToolbarForComposer(composer) : null;
  }

  function rememberInlineToolbarSelection(editor, selection = null) {
    const toolbar = getInlineToolbarForEditor(editor);
    if (!toolbar || !editor) return null;

    const normalized = normalizeSelectionRange(selection || getEditorSelection(editor), getEditorText(editor).length);
    if (normalized && normalized.start !== normalized.end) {
      toolbar.__ccfSelection = normalized;
      return normalized;
    }

    return null;
  }

  function clearInlineToolbarSelection(toolbar = null) {
    const toolbars = toolbar ? [toolbar] : [...document.querySelectorAll(INLINE_TOOLBAR_SELECTOR)];
    toolbars.forEach((item) => {
      if (item) {
        item.__ccfSelection = null;
        hideInlineToolbarSelectionHighlight(item);
      }
    });
  }

  function restoreInlineToolbarEditorSelection(toolbar) {
    const editor = getInlineToolbarEditor(toolbar);
    const selection = editor ? getInlineToolbarSelection(toolbar) : null;
    restoreRoomSelectionSoon(editor, selection);
  }

  function ensureInlineSelectionHighlight(editor) {
    if (!(editor instanceof HTMLElement)) return null;

    const existing = INLINE_SELECTION_HIGHLIGHT.get(editor);
    if (existing?.overlay?.isConnected && existing.content?.isConnected) {
      return existing;
    }

    const overlay = document.createElement("div");
    overlay.className = "ccf-inline-selection-layer";
    overlay.setAttribute(SAFE_UI_ATTR, "1");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";

    const content = document.createElement("div");
    content.className = "ccf-editor-preview-content";
    overlay.appendChild(content);
    document.documentElement.appendChild(overlay);

    const entry = { host: document.documentElement, overlay, content, baseColor: "" };
    INLINE_SELECTION_HIGHLIGHT.set(editor, entry);
    return entry;
  }

  function renderInlineSelectionHighlightContent(content, text, selection) {
    content.textContent = "";
    if (!selection || selection.start === selection.end) return;

    const before = text.slice(0, selection.start);
    const selected = text.slice(selection.start, selection.end);
    const after = text.slice(selection.end);

    if (before) {
      content.appendChild(document.createTextNode(before));
    }

    const mark = document.createElement("span");
    mark.className = "ccf-inline-selection-mark";
    mark.textContent = selected || " ";
    content.appendChild(mark);

    if (after) {
      content.appendChild(document.createTextNode(after));
    }
  }

  function showInlineToolbarSelectionHighlight(toolbar) {
    const editor = getInlineToolbarEditor(toolbar);
    if (!(editor instanceof HTMLElement)) return false;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const selection = normalizeSelectionRange(getInlineToolbarSelection(toolbar), text.length);
    if (!selection || selection.start === selection.end) {
      hideInlineSelectionHighlight(editor);
      return false;
    }

    const entry = ensureInlineSelectionHighlight(editor);
    if (!entry) return false;

    const computed = getComputedStyle(editor);
    layoutInlineSelectionHighlight(editor, entry, computed);
    renderInlineSelectionHighlightContent(entry.content, text, selection);
    syncEditorVisualPreviewScroll(editor, entry);
    entry.overlay.style.display = "block";
    return true;
  }

  function layoutInlineSelectionHighlight(editor, entry, computed = getComputedStyle(editor)) {
    const { overlay, content } = entry;
    const rect = editor.getBoundingClientRect();

    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.paddingTop = computed.paddingTop;
    overlay.style.paddingRight = computed.paddingRight;
    overlay.style.paddingBottom = computed.paddingBottom;
    overlay.style.paddingLeft = computed.paddingLeft;
    overlay.style.borderRadius = computed.borderRadius;
    overlay.style.font = computed.font;
    overlay.style.lineHeight = computed.lineHeight;
    overlay.style.letterSpacing = computed.letterSpacing;
    overlay.style.textAlign = computed.textAlign;
    overlay.style.textIndent = computed.textIndent;
    overlay.style.textTransform = computed.textTransform;
    overlay.style.whiteSpace = editor instanceof HTMLInputElement ? "pre" : "pre-wrap";
    overlay.style.wordBreak = editor instanceof HTMLInputElement ? "normal" : "break-word";
    overlay.style.overflowWrap = editor instanceof HTMLInputElement ? "normal" : "anywhere";
    content.style.minHeight = `calc(100% + ${editor.scrollTop}px)`;
  }

  function hideInlineSelectionHighlight(editor) {
    const entry = INLINE_SELECTION_HIGHLIGHT.get(editor);
    if (!entry) return;
    entry.overlay.style.display = "none";
    entry.content.textContent = "";
  }

  function hideInlineToolbarSelectionHighlight(toolbar) {
    const editor = getInlineToolbarEditor(toolbar);
    if (editor instanceof HTMLElement) {
      hideInlineSelectionHighlight(editor);
    }
  }

  function handleInlineToolbarDocumentMouseDown(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const toolbar = target.closest(INLINE_TOOLBAR_SELECTOR);
    if (toolbar) {
      captureInlineToolbarSelection(toolbar);
      return;
    }

    const editor = normalizeEditorCandidate(target);
    const editorToolbar = editor ? getInlineToolbarForEditor(editor) : null;

    document.querySelectorAll(INLINE_TOOLBAR_SELECTOR).forEach((item) => {
      if (item === editorToolbar) return;
      if (inlinePopoverState?.toolbar === item) {
        closeInlinePopover(item, { restoreFocus: false });
      }
      clearInlineToolbarSelection(item);
    });
  }

  function syncInlineToolbarSelectionFromDocument() {
    const editor = normalizeEditorCandidate(document.activeElement);
    if (!editor) return;

    const toolbar = getInlineToolbarForEditor(editor);
    if (!toolbar) return;

    const selection = normalizeSelectionRange(getEditorSelection(editor), getEditorText(editor).length);
    if (selection && selection.start !== selection.end) {
      toolbar.__ccfSelection = selection;
      updateInlineToolbarVisuals(toolbar);
      return;
    }

    clearInlineToolbarSelection(toolbar);
    updateInlineToolbarVisuals(toolbar);
  }

  function getFormatShortcutCommand(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return "";

    const key = String(event.key || "").toLowerCase();
    if (key === "b") return "bold";
    if (key === "i") return "italic";
    if (key === "u") return "underline";
    if (
      event.code === "Backquote" ||
      event.key === "`" ||
      event.key === "\u20A9" ||
      event.key === "\uFF40" ||
      event.keyCode === 192 ||
      event.which === 192
    ) {
      return "strike";
    }
    return "";
  }

  function handleFormatShortcut(event) {
    const command = getFormatShortcutCommand(event);
    if (!command) return false;

    const target = event.target instanceof Element ? event.target : null;
    const modalEditor = getModalEditor();
    const isModalEditorTarget =
      !!modalEditor &&
      (document.activeElement === modalEditor || !!(target && modalEditor.contains(target)));

    if (isModalEditorTarget) {
      const modal = document.getElementById(MODAL_ID);
      const commandButton = modal?.querySelector?.(`.ccf-toggle[data-toggle="${command}"]`);
      if (!commandButton) return false;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const nextActive = !commandButton.classList.contains("active");
      commandButton.classList.toggle("active", nextActive);
      commandButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
      applyCurrentModalStyle({ silent: true, previewOnly: true });
      restoreModalSelectionSoon();
      return true;
    }

    if (target?.closest?.(`[${SAFE_UI_ATTR}="1"]`)) return false;

    const editor = normalizeEditorCandidate(document.activeElement) || normalizeEditorCandidate(target);
    if (!editor) return false;

    const toolbar = getInlineToolbarForEditor(editor);
    const commandButton = toolbar?.querySelector?.(`[data-inline-command="${command}"]`);
    if (!toolbar || !commandButton) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    rememberInlineToolbarSelection(editor);
    const nextActive = !commandButton.classList.contains("active");
    commandButton.classList.toggle("active", nextActive);
    commandButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
    applyInlineToolbarStyle(toolbar, {
      selectionOverride: getInlineToolbarSelection(toolbar)
    });
    return true;
  }

  function getStyleFromInlineToolbar(toolbar) {
    const color = toolbar.querySelector('input[data-inline-color="color"]')?.value || "#ffffff";
    const backgroundColor =
      toolbar.querySelector('input[data-inline-color="backgroundColor"]')?.value || "#000000";
    const fontSize = normalizeFontSizeValue(toolbar.querySelector("[data-inline-size]")?.value || "");

    return {
      bold: toolbar.querySelector('[data-inline-command="bold"]')?.classList.contains("active") || false,
      italic: toolbar.querySelector('[data-inline-command="italic"]')?.classList.contains("active") || false,
      underline: toolbar.querySelector('[data-inline-command="underline"]')?.classList.contains("active") || false,
      strike: toolbar.querySelector('[data-inline-command="strike"]')?.classList.contains("active") || false,
      color,
      backgroundColor,
      fontSize: fontSize ?? undefined
    };
  }

  function applyInlineToolbarStyle(toolbar, options = {}) {
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return false;

    const selection = options.selectionOverride || getInlineToolbarSelection(toolbar);
    const applied = applyStyleToCurrentSelection(editor, {
      silent: true,
      styleOverride: getStyleFromInlineToolbar(toolbar),
      selectionOverride: selection
    });
    if (applied && ensureEditorState(editor).parentheticalGray) {
      applyParentheticalGrayToEditor(editor);
    }

    if (applied && options.restoreSelection !== false) {
      restoreRoomSelectionSoon(editor, selection);
    }
    return applied;
  }

  function isInlineFormatKeepEnabled(toolbar) {
    return !!toolbar?.querySelector?.('[data-inline-command="keep"]')?.classList.contains("active");
  }

  function resetInlineToolbarStyleControls(toolbar) {
    if (!toolbar) return;

    toolbar.querySelectorAll(
      '[data-inline-command="bold"], [data-inline-command="italic"], [data-inline-command="underline"], [data-inline-command="strike"], [data-inline-command="blur"]'
    ).forEach((btn) => {
      btn.classList.remove("active");
      btn.setAttribute("aria-pressed", "false");
    });

    setInlineToolbarAlignment(toolbar, "left");

    const color = toolbar.querySelector('input[data-inline-color="color"]');
    if (color instanceof HTMLInputElement) {
      color.value = "#ffffff";
    }

    const backgroundColor = toolbar.querySelector('input[data-inline-color="backgroundColor"]');
    if (backgroundColor instanceof HTMLInputElement) {
      backgroundColor.value = "#000000";
    }

    const sizeInput = toolbar.querySelector("[data-inline-size]");
    if (sizeInput instanceof HTMLInputElement) {
      sizeInput.value = "";
      sizeInput.placeholder = String(getDefaultEditorFontSize(getInlineToolbarEditor(toolbar)));
      sizeInput.dataset.currentSize = "1";
      sizeInput.title = `\uD604\uC7AC \uAE00\uC790 \uD06C\uAE30: ${sizeInput.placeholder}px (\uAE30\uBCF8)`;
    }

    closeInlinePopover(toolbar, { restoreFocus: false });
    clearInlineToolbarSelection(toolbar);
    updateInlineToolbarVisuals(toolbar);
  }

  function resetEditorStateAfterSendIfEmpty(editor) {
    if (!editor || !document.contains(editor)) return;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    if (text) return;

    const state = ensureEditorState(editor);
    const preservedNarration = state.blockStyle?.narration === true;
    const preservedParentheticalGray = state.parentheticalGray === true;
    // 서식 유지(keep) ON이면 lastStyle을 남겨 다음 입력에 이어 적용 (#98)
    const keepOn = isInlineFormatKeepEnabled(getInlineToolbarForEditor(editor));
    state.text = "";
    state.runs = [];
    state.alignRuns = [];
    if (!keepOn) state.lastStyle = null;
    state.blockStyle = preservedNarration ? { narration: true } : {};
    state.parentheticalGray = preservedParentheticalGray;
    state.roll20Source = null;

    const composer = findComposerForEditor(editor);
    refreshComposerBadge(composer, editor);
    setInlineParentheticalGrayToggle(editor, preservedParentheticalGray);
    syncEditorVisualPreview(editor);
  }

  function scheduleInlineFormatResetAfterSend(editor) {
    const toolbar = getInlineToolbarForEditor(editor);
    const keepStyle = isInlineFormatKeepEnabled(toolbar);
    const checkpoints = [120, 450, 1000, 2000];

    checkpoints.forEach((delay) => {
      setTimeout(() => {
        if (toolbar && document.contains(toolbar)) {
          clearInlineToolbarSelection(toolbar);
          if (!keepStyle) {
            resetInlineToolbarStyleControls(toolbar);
          }
        }

        resetEditorStateAfterSendIfEmpty(editor);
      }, delay);
    });
  }

  function updateInlineToolbarVisuals(toolbar) {
    toolbar.querySelectorAll('input[type="color"][data-inline-color]').forEach((input) => {
      const tool = input.closest(".ccf-color-tool");
      if (tool) {
        tool.style.setProperty("--ccf-chip-color", input.value || "#ffffff");
      }
    });

    syncInlineToolbarFontSizeVisual(toolbar);
  }

  function getDefaultEditorFontSize(editor = null) {
    const target = editor || activeEditor || lastFocusedEditor || getCurrentTargetEditor();
    if (target) {
      const computed = normalizeCssPixelFontSize(window.getComputedStyle(target).fontSize);
      if (computed != null) return computed;
    }
    return FONT_SIZE_PRESETS[2];
  }

  function syncInlineToolbarFontSizeVisual(toolbar) {
    if (!toolbar) return;

    const input = toolbar.querySelector("[data-inline-size]");
    if (!(input instanceof HTMLInputElement)) return;
    if (document.activeElement === input || input.dataset.editingSize === "1") return;

    const editor = getInlineToolbarEditor(toolbar);
    if (!editor) {
      const fallbackSize = getDefaultEditorFontSize();
      input.value = "";
      input.placeholder = String(fallbackSize);
      input.dataset.currentSize = "1";
      input.title = `\uD604\uC7AC \uAE00\uC790 \uD06C\uAE30: ${fallbackSize}px (\uAE30\uBCF8)`;
      return;
    }

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const state = ensureEditorState(editor);
    const selection = normalizeSelectionRange(
      getInlineToolbarSelection(toolbar) || getEditorSelection(editor) || { start: text.length, end: text.length },
      text.length
    );
    const sizeState = getFontSizeStateForSelection(state.runs, selection, text.length);

    if (sizeState.mixed) {
      input.value = "";
      input.placeholder = "\uD63C\uD569";
      input.dataset.currentSize = "1";
      input.title = "\uC120\uD0DD \uC601\uC5ED\uC5D0 \uC5EC\uB7EC \uAE00\uC790 \uD06C\uAE30\uAC00 \uC11E\uC5EC \uC788\uC2B5\uB2C8\uB2E4.";
      return;
    }

    if (sizeState.value != null) {
      input.value = String(sizeState.value);
      input.placeholder = String(sizeState.value);
      delete input.dataset.currentSize;
      input.title = `\uD604\uC7AC \uAE00\uC790 \uD06C\uAE30: ${sizeState.value}px`;
      return;
    }

    const defaultSize = getDefaultEditorFontSize(editor);
    input.value = "";
    input.placeholder = String(defaultSize);
    input.dataset.currentSize = "1";
    input.title = `\uD604\uC7AC \uAE00\uC790 \uD06C\uAE30: ${defaultSize}px (\uAE30\uBCF8)`;
  }

  function setInlineToolbarAlignment(toolbar, align) {
    const value = cleanupAlign(align) || "left";
    toolbar.querySelectorAll(".ccf-align-toggle").forEach((btn) => {
      const btnValue = cleanupAlign(btn.getAttribute("data-align")) || "left";
      btn.classList.toggle("active", btnValue === value);
    });
  }

  function applyInlineAlignment(editor, align, selectionOverride = null) {
    if (!editor) return false;

    const state = ensureEditorState(editor);
    const text = stripInvisibleEnvelope(getEditorText(editor));
    const selection = normalizeSelectionRange(
      selectionOverride || getEditorSelection(editor) || { start: text.length, end: text.length },
      text.length
    );
    const lineRange = getSelectedLineRange(text, selection);
    const nextAlignRuns = addOrReplaceAlignRun(
      state.alignRuns,
      {
        start: lineRange.start,
        end: lineRange.end,
        align: cleanupAlign(align)
      },
      getTextLineCount(text)
    );

    state.alignRuns = nextAlignRuns;
    state.blockStyle = cleanupBlockStyle(state.blockStyle);
    state.text = text;
    state.roll20Source = null;
    renderPreview(editor);
    refreshComposerBadge(activeComposer, editor);
    syncEditorVisualPreview(editor);
    restoreRoomSelectionSoon(editor, selection);
    return true;
  }

  function openInlineTextPopover(toolbar, kind) {
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return false;

    const styleKey = kind === "ruby" ? "rubyText" : "tooltipText";
    const context = getActiveSelectionStyleContext(styleKey);
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert(kind === "ruby"
        ? "\uB8E8\uBE44\uB97C \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694."
        : "\uD234\uD301\uC744 \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert(kind === "ruby"
        ? "\uB8E8\uBE44\uB294 \uC904\uBC14\uAFC8\uC774 \uC5C6\uB294 \uD14D\uC2A4\uD2B8\uC5D0\uB9CC \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694."
        : "\uD234\uD301\uC740 \uC904\uBC14\uAFC8\uC774 \uC5C6\uB294 \uD14D\uC2A4\uD2B8\uC5D0\uB9CC \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.");
      return false;
    }

    openInlinePopover(toolbar, {
      kind,
      title: kind === "ruby" ? "\uB8E8\uBE44" : "\uD234\uD301",
      placeholder: kind === "ruby"
        ? "\uB8E8\uBE44 \uBB38\uC790"
        : "\uD234\uD301 \uB0B4\uC6A9",
      value: context.currentValue || "",
      multiline: kind !== "ruby",
      context
    });
    return true;
  }

  function openInlineCodePopover(toolbar) {
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return false;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const selection = normalizeSelectionRange(
      getInlineToolbarSelection(toolbar) || { start: text.length, end: text.length },
      text.length
    ) || { start: text.length, end: text.length };

    openInlinePopover(toolbar, {
      kind: "code",
      title: "\uCF54\uB4DC",
      placeholder: "\uCF54\uB4DC\uB97C \uC785\uB825",
      value: selection.start !== selection.end ? text.slice(selection.start, selection.end) : "",
      multiline: true,
      editor,
      selection
    });
    return true;
  }

  function getInlineStyleClipboardContext(toolbar) {
    const editor = activateInlineToolbarEditor(toolbar);
    if (!editor) return null;
    const text = stripInvisibleEnvelope(getEditorText(editor));
    const selection = normalizeSelectionRange(getInlineToolbarSelection(toolbar), text.length);
    const state = ensureEditorState(editor);
    return {
      editor,
      state,
      modalEditor: null,
      targetEditor: editor,
      text,
      selection,
      selectedText: selection ? text.slice(selection.start, selection.end) : "",
      baseRuns: cloneRuns(state.runs, text.length)
    };
  }

  function toggleNarratorName(name) {
    const trimmed = normalizeMyCharacterName(name);
    if (!trimmed) return false;
    const set = readNarratorNameSet();
    if (set.has(trimmed)) {
      set.delete(trimmed);
    } else {
      set.add(trimmed);
    }
    return writeNarratorNameSet(set);
  }

  function getNarratorButton(toolbar) {
    return toolbar?.querySelector?.('[data-inline-command="narration"]') || null;
  }

  function refreshInlineNarrationButton(toolbar) {
    const btn = getNarratorButton(toolbar);
    if (!(btn instanceof HTMLElement)) return;
    const speaker = getCurrentSpeakerName();
    const set = readNarratorNameSet();
    const speakerActive = !!speaker && set.has(speaker);
    const configured = set.size > 0;
    const editor = getInlineToolbarEditor(toolbar);
    const blockActive = editor ? ensureEditorState(editor).blockStyle?.narration === true : false;
    const active = speakerActive || blockActive;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    btn.dataset.ccfNarratorConfigured = configured ? "1" : "0";
    btn.title = speakerActive
      ? `현재 나레이션 대상: ${speaker}`
      : configured
        ? `나레이션 캐릭터 ${set.size}명 설정됨 (현재 화자에는 미적용)`
        : "나레이션 캐릭터 설정";
  }

  function applyAutomaticNarration(blockStyle) {
    const next = cleanupBlockStyle(blockStyle);
    const speaker = getCurrentSpeakerName();
    if (speaker && readNarratorNameSet().has(speaker)) {
      next.narration = true;
    }
    return next;
  }

  function refreshAllInlineNarrationButtons() {
    document.querySelectorAll(INLINE_TOOLBAR_SELECTOR).forEach((toolbar) => {
      refreshInlineNarrationButton(toolbar);
    });
  }

  function buildInlineNarratorListMarkup(names, narratorSet, currentSpeaker) {
    const trimmedSpeaker = normalizeMyCharacterName(currentSpeaker);
    const normalizedNames = uniqueCharacterNames(names);
    const knownSet = new Set(normalizedNames);
    const orphanNarrators = [...narratorSet].filter((name) => !knownSet.has(name));
    const ordered = [...normalizedNames, ...orphanNarrators];

    if (!ordered.length) {
      return `<div class="ccf-narrator-empty">캐릭터 목록을 불러오지 못했습니다. 새로고침을 눌러주세요.</div>`;
    }

    return `<div class="ccf-narrator-list" role="listbox">
      ${ordered.map((name) => {
        const isActive = narratorSet.has(name);
        const isCurrent = !!trimmedSpeaker && trimmedSpeaker === name;
        const isOrphan = !knownSet.has(name);
        const classes = ["ccf-narrator-item"];
        if (isActive) classes.push("active");
        if (isCurrent) classes.push("is-current");
        if (isOrphan) classes.push("is-orphan");
        const escapedName = escapeHtml(name);
        const suffixParts = [];
        if (isCurrent) suffixParts.push("현재 화자");
        if (isOrphan) suffixParts.push("목록 없음");
        const suffix = suffixParts.length
          ? ` <span class="ccf-narrator-tag">${suffixParts.join(" · ")}</span>`
          : "";
        return `<button type="button" class="${classes.join(" ")}" role="option" aria-selected="${isActive ? "true" : "false"}" data-inline-narrator-action="toggle" data-inline-narrator-name="${escapedName}"><span class="ccf-narrator-check" aria-hidden="true">${isActive ? "✓" : ""}</span><span class="ccf-narrator-name">${escapedName}</span>${suffix}</button>`;
      }).join("")}
    </div>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getInlineNarratorPopoverState(toolbar) {
    const state = inlinePopoverState;
    if (!state || state.toolbar !== toolbar || state.kind !== "narrator") return null;
    return state;
  }

  function updateInlineNarratorPopoverList(toolbar) {
    const state = getInlineNarratorPopoverState(toolbar);
    if (!state) return;
    const listHost = state.popover?.querySelector?.("[data-inline-narrator-list-host]");
    if (!listHost) return;
    const set = readNarratorNameSet();
    listHost.innerHTML = buildInlineNarratorListMarkup(state.characterNames || [], set, getCurrentSpeakerName());
  }

  function setInlineNarratorPopoverBusy(toolbar, busy, message = "") {
    const state = getInlineNarratorPopoverState(toolbar);
    if (!state) return;
    const note = state.popover?.querySelector?.("[data-inline-narrator-note]");
    if (note instanceof HTMLElement) {
      note.textContent = message || "";
      note.style.display = message ? "block" : "none";
    }
    state.popover?.querySelectorAll?.('[data-inline-narrator-action="refresh"]').forEach((btn) => {
      if (btn instanceof HTMLButtonElement) btn.disabled = !!busy;
    });
  }

  async function refreshInlineNarratorPopover(toolbar, options = {}) {
    const state = getInlineNarratorPopoverState(toolbar);
    if (!state) return;
    setInlineNarratorPopoverBusy(toolbar, true, "캐릭터 목록을 불러오는 중…");
    try {
      const names = await scrapeCharacterNames(options.forcePanelScan === true);
      const currentState = getInlineNarratorPopoverState(toolbar);
      if (!currentState) return;
      currentState.characterNames = names;
    } catch (error) {
      console.error("[ccf-format-sync] refreshInlineNarratorPopover failed", error);
    } finally {
      setInlineNarratorPopoverBusy(toolbar, false, "");
      updateInlineNarratorPopoverList(toolbar);
      refreshInlineNarrationButton(toolbar);
    }
  }

  function positionInlineNarratorPopover(toolbar) {
    const state = getInlineNarratorPopoverState(toolbar);
    const popover = state?.popover;
    const anchor = toolbar?.querySelector?.('[data-inline-command="narration"]');
    if (!(popover instanceof HTMLElement) || !(anchor instanceof HTMLElement) || !popover.classList.contains("open")) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const width = popoverRect.width || Math.min(320, window.innerWidth - (INLINE_NARRATOR_POPOVER_MARGIN * 2));
    const height = popoverRect.height || 240;
    const maxLeft = Math.max(INLINE_NARRATOR_POPOVER_MARGIN, window.innerWidth - width - INLINE_NARRATOR_POPOVER_MARGIN);
    const left = Math.min(
      maxLeft,
      Math.max(INLINE_NARRATOR_POPOVER_MARGIN, anchorRect.right - width)
    );
    const belowTop = anchorRect.bottom + INLINE_NARRATOR_POPOVER_GAP;
    const aboveTop = anchorRect.top - INLINE_NARRATOR_POPOVER_GAP - height;
    const fitsBelow = belowTop + height <= window.innerHeight - INLINE_NARRATOR_POPOVER_MARGIN;
    const top = fitsBelow
      ? belowTop
      : Math.max(INLINE_NARRATOR_POPOVER_MARGIN, aboveTop);

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function openInlineNarratorPopover(toolbar) {
    if (!getCurrentRoomId()) {
      alert("나레이션 캐릭터 설정은 룸 안에서만 사용할 수 있어요.");
      return false;
    }

    document.querySelectorAll(".ccf-inline-popover.open").forEach((popover) => {
      if (!toolbar.contains(popover)) {
        popover.classList.remove("open");
        popover.setAttribute("aria-hidden", "true");
        popover.textContent = "";
      }
    });

    const popover = toolbar.querySelector("[data-inline-popover]");
    if (!popover) return false;

    const initialSet = readNarratorNameSet();
    const currentSpeaker = getCurrentSpeakerName();

    popover.innerHTML = `
      <div class="ccf-inline-popover-title">나레이션 캐릭터</div>
      <div class="ccf-code-note">선택한 캐릭터가 이 룸에서 보낸 메시지는 나레이션으로 표시됩니다.</div>
      <div class="ccf-narrator-note" data-inline-narrator-note style="display:none;"></div>
      <div data-inline-narrator-list-host>${buildInlineNarratorListMarkup([], initialSet, currentSpeaker)}</div>
      <div class="ccf-inline-popover-actions">
        <button type="button" class="ccf-btn" data-inline-popover-action="cancel">닫기</button>
        <button type="button" class="ccf-btn primary" data-inline-narrator-action="refresh">새로고침</button>
      </div>
    `;
    popover.classList.add("ccf-inline-narrator-popover", "open");
    popover.setAttribute("aria-hidden", "false");

    inlinePopoverState = {
      kind: "narrator",
      toolbar,
      popover,
      characterNames: []
    };

    positionInlineNarratorPopover(toolbar);
    requestAnimationFrame(() => positionInlineNarratorPopover(toolbar));
    refreshInlineNarratorPopover(toolbar);
    return true;
  }

  function openInlineStyleClipboardPopover(toolbar, options = {}) {
    // \uBAA9\uB85D \uAC31\uC2E0 \uC7AC\uD638\uCD9C \uC2DC selection\uC774 \uD480\uB824 \uC788\uC744 \uC218 \uC788\uC74C \u2014 \uAE30\uC874 context \uC7AC\uC0AC\uC6A9
    const context = options.reuseContext === true && inlinePopoverState?.kind === "style-clipboard"
      ? inlinePopoverState.context
      : getInlineStyleClipboardContext(toolbar);
    // \uC120\uD0DD \uC5C6\uC774\uB3C4 \uBAA8\uB2EC\uC740 \uC5F0\uB2E4 (#70) \u2014 \uBAA9\uB85D \uD655\uC778/\uC0AD\uC81C\uB294 \uC120\uD0DD \uBD88\uD544\uC694.
    // \uCD94\uAC00/\uC801\uC6A9 \uC561\uC158\uC774 \uAC01\uC790 selection\uC744 \uAC80\uC0AC\uD55C\uB2E4.
    if (!context) return false;

    document.querySelectorAll(".ccf-inline-popover.open").forEach((popover) => {
      if (!toolbar.contains(popover)) {
        popover.classList.remove("open");
        popover.setAttribute("aria-hidden", "true");
        popover.textContent = "";
      }
    });

    const popover = toolbar.querySelector("[data-inline-popover]");
    if (!popover) return false;
    popover.classList.remove("ccf-inline-narrator-popover", "ccf-inline-float-popover");
    popover.style.left = "";
    popover.style.top = "";
    // \uC11C\uC2DD \uD504\uB9AC\uC14B \uBBF8\uB2C8\uBAA8\uB2EC (#70) \u2014 \uBAA9\uB85D(\uD074\uB9AD=\uC801\uC6A9, \u00D7=\uC0AD\uC81C) + \uD604\uC7AC \uC11C\uC2DD \uCD94\uAC00
    const presets = readStylePresets();
    const rows = presets.map((p, i) => `
      <div class="ccf-style-preset-row">
        <button type="button" class="ccf-style-preset-auto-dot" data-inline-style-action="auto" data-preset-index="${i}" data-on="${p.auto === false ? "0" : "1"}" title="자동 적용 ${p.auto === false ? "OFF" : "ON"} — 클릭으로 전환" aria-label="자동 적용 전환"></button>
        <button type="button" class="ccf-style-preset-apply" data-inline-style-action="apply" data-preset-index="${i}" title="\uC120\uD0DD \uC601\uC5ED\uC5D0 \uC801\uC6A9" style="${escapeHtml(stylePresetPreviewCss(p.style, p.align))}">${escapeHtml(p.name)}</button>
        <button type="button" class="ccf-style-preset-remove" data-inline-style-action="edit" data-preset-index="${i}" title="\uD3B8\uC9D1 \u2014 \uC11C\uC2DD\uC744 \uC544\uB798 \uBE4C\uB354\uC5D0 \uBD88\uB7EC\uC634" aria-label="\uD3B8\uC9D1">\u270E</button>
        <button type="button" class="ccf-style-preset-remove" data-inline-style-action="remove" data-preset-index="${i}" title="\uC0AD\uC81C" aria-label="\uC0AD\uC81C">\u00D7</button>
      </div>
    `).join("");
    popover.innerHTML = `
      <div class="ccf-style-preset-title-row">
        <div class="ccf-inline-popover-title">\uC11C\uC2DD \uD504\uB9AC\uC14B</div>
        <button type="button" class="ccf-style-preset-remove" data-inline-style-action="add" title="\uAD6C\uC131\uD55C \uC11C\uC2DD\uC744 \uD504\uB9AC\uC14B\uC73C\uB85C \uCD94\uAC00" aria-label="\uD504\uB9AC\uC14B \uCD94\uAC00">+</button>
      </div>
      ${rows || '<div class="ccf-code-note">\uC800\uC7A5\uB41C \uC11C\uC2DD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC544\uB798\uC5D0\uC11C \uC11C\uC2DD\uC744 \uAD6C\uC131\uD574 + \uB85C \uCD94\uAC00\uD558\uC138\uC694.</div>'}
      <div class="ccf-style-builder" data-style-builder-host>
        <div class="ccf-style-builder-row">
          <button type="button" class="ccf-toggle" data-style-builder="bold" title="\uAD75\uAC8C"><b>B</b></button>
          <button type="button" class="ccf-toggle" data-style-builder="italic" title="\uAE30\uC6B8\uC784"><i>I</i></button>
          <button type="button" class="ccf-toggle" data-style-builder="underline" title="\uBC11\uC904"><u>U</u></button>
          <button type="button" class="ccf-toggle" data-style-builder="strike" title="\uCDE8\uC18C\uC120"><s>S</s></button>
          <button type="button" class="ccf-toggle" data-style-builder-align="left" data-active="1" title="\uC67C\uCABD \uC815\uB82C">\u2BC7</button>
          <button type="button" class="ccf-toggle" data-style-builder-align="center" title="\uAC00\uC6B4\uB370 \uC815\uB82C">\u2BC8\u2BC7</button>
          <button type="button" class="ccf-toggle" data-style-builder-align="right" title="\uC624\uB978\uCABD \uC815\uB82C">\u2BC8</button>
          <label class="ccf-style-builder-color" title="\uAE00\uC790\uC0C9"><input type="color" data-style-builder-color value="#ffffff"></label>
          <label class="ccf-style-builder-color" title="\uBC30\uACBD\uC0C9"><input type="color" data-style-builder-bg value="#000000"></label>
          <input type="text" class="ccf-inline-popover-field ccf-style-builder-size" data-style-builder-size inputmode="numeric" pattern="[0-9]*" placeholder="${(() => { try { return Math.round(parseFloat(getComputedStyle(context.editor).fontSize)) || 14; } catch (_) { return 14; } })()}" title="\uAE00\uC790 \uD06C\uAE30(px)">
        </div>
      </div>
      <div class="ccf-style-preset-add-row">
        <input type="text" class="ccf-inline-popover-field" data-style-preset-name placeholder="\uC0C8 \uD504\uB9AC\uC14B \uC774\uB984 (\uBBF8\uB9AC\uBCF4\uAE30)" spellcheck="false">
      </div>
      <div class="ccf-inline-popover-actions">
        <button type="button" class="ccf-btn primary" data-inline-style-action="add">저장</button>
        <button type="button" class="ccf-btn" data-inline-popover-action="cancel">\uB2EB\uAE30</button>
      </div>
    `;
    // \uC0C9/\uD06C\uAE30 \uC785\uB825 \u2014 \uB9CC\uC9C0\uBA74 \uC801\uC6A9 \uB300\uC0C1\uC73C\uB85C \uD45C\uC2DC(data-touched) + \uC774\uB984 \uC785\uB825\uCE78 \uBBF8\uB9AC\uBCF4\uAE30 \uAC31\uC2E0 (#70)
    bindStylePresetDragSort(popover, toolbar); // 프리셋 행 드래그 정렬 (#70)
    popover.querySelectorAll("[data-style-builder-color], [data-style-builder-bg], [data-style-builder-size]").forEach((inp) => {
      // 색 칩 초기 표시
      if (inp.type === "color") {
        inp.closest(".ccf-style-builder-color")?.style.setProperty("--ccf-chip-color", inp.value);
      }
      inp.addEventListener("input", () => {
        inp.setAttribute("data-touched", "1");
        if (inp.type === "color") {
          inp.closest(".ccf-style-builder-color")?.style.setProperty("--ccf-chip-color", inp.value);
        }
        updateStyleBuilderPreview(popover);
      });
    });
    // 레이아웃에 끼지 않는 부유 팝업(fixed) — 스크롤바 생성 방지 (#70)
    popover.classList.add("ccf-inline-float-popover", "open");
    popover.setAttribute("aria-hidden", "false");
    inlinePopoverState = {
      kind: "style-clipboard",
      toolbar,
      popover,
      context,
      editor: context.editor,
      selection: context.selection
    };
    positionStylePresetPopover(toolbar, popover);
    requestAnimationFrame(() => positionStylePresetPopover(toolbar, popover));
    showInlineToolbarSelectionHighlight(toolbar);
    return true;
  }

  // Sv 버튼 기준으로 fixed 팝업 위치 계산 — 아래 공간 부족하면 위로.
  function positionStylePresetPopover(toolbar, popover) {
    const anchor = toolbar?.querySelector?.('[data-inline-command="style-clipboard"]');
    if (!(popover instanceof HTMLElement) || !(anchor instanceof HTMLElement) || !popover.classList.contains("open")) {
      return;
    }
    const MARGIN = 12;
    const GAP = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const width = popoverRect.width || Math.min(320, window.innerWidth - MARGIN * 2);
    const height = popoverRect.height || 200;
    const left = Math.min(
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
      Math.max(MARGIN, anchorRect.right - width)
    );
    const belowTop = anchorRect.bottom + GAP;
    const fitsBelow = belowTop + height <= window.innerHeight - MARGIN;
    const top = fitsBelow
      ? belowTop
      : Math.max(MARGIN, anchorRect.top - GAP - height);
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function openInlinePopover(toolbar, config) {
    document.querySelectorAll(".ccf-inline-popover.open").forEach((popover) => {
      if (!toolbar.contains(popover)) {
        popover.classList.remove("open");
        popover.setAttribute("aria-hidden", "true");
        popover.textContent = "";
      }
    });

    const popover = toolbar.querySelector("[data-inline-popover]");
    if (!popover) return false;

    popover.classList.remove("ccf-inline-narrator-popover", "ccf-inline-float-popover");
    popover.style.left = "";
    popover.style.top = "";
    popover.textContent = "";
    const title = document.createElement("div");
    title.className = "ccf-inline-popover-title";
    title.textContent = config.title || "";

    const field = config.multiline ? document.createElement("textarea") : document.createElement("input");
    field.className = "ccf-inline-popover-field";
    field.value = config.value || "";
    field.placeholder = config.placeholder || "";
    field.spellcheck = false;
    if (!config.multiline) {
      field.type = "text";
    }

    const actions = document.createElement("div");
    actions.className = "ccf-inline-popover-actions";
    actions.innerHTML = `
      <button type="button" class="ccf-btn" data-inline-popover-action="cancel">\uCDE8\uC18C</button>
      <button type="button" class="ccf-btn primary" data-inline-popover-action="apply">\uC801\uC6A9</button>
    `;

    popover.append(title, field, actions);
    popover.classList.add("open");
    popover.setAttribute("aria-hidden", "false");

    inlinePopoverState = {
      ...config,
      toolbar,
      field,
      popover
    };

    setTimeout(() => {
      field.focus({ preventScroll: true });
      if (typeof field.select === "function") {
        field.select();
      }
    }, 0);
    return true;
  }

  function closeInlinePopover(toolbar, options = {}) {
    const state = inlinePopoverState?.toolbar === toolbar ? inlinePopoverState : null;
    const popover = toolbar?.querySelector?.("[data-inline-popover]");
    if (popover) {
      popover.classList.remove("open", "ccf-inline-narrator-popover", "ccf-inline-float-popover");
      popover.setAttribute("aria-hidden", "true");
      popover.textContent = "";
      popover.style.left = "";
      popover.style.top = "";
    }
    if (state) {
      inlinePopoverState = null;
      if (state.kind === "narrator") {
        refreshInlineNarrationButton(toolbar);
        syncAllEditorVisualPreviews();
      }
      if (options.restoreFocus !== false) {
        restoreRoomSelectionSoon(state.editor || state.context?.editor, state.selection || state.context?.selection);
      }
    }
    if (toolbar && options.keepHighlight !== true) {
      hideInlineToolbarSelectionHighlight(toolbar);
    }
  }

  function applyInlinePopover(toolbar) {
    const state = inlinePopoverState;
    if (!state || state.toolbar !== toolbar) return false;

    const value = state.field?.value || "";
    let applied = false;

    if (state.kind === "ruby" || state.kind === "tooltip") {
      const stylePatch = state.kind === "ruby"
        ? { rubyText: normalizeRubyText(value) }
        : { tooltipText: normalizeTooltipText(value) };
      applied = commitSelectionStyleContext(state.context, stylePatch);
      if (applied) {
        restoreRoomSelectionSoon(state.context?.editor, state.context?.selection);
      }
    } else if (state.kind === "code") {
      applied = insertInlineCodeBlock(state.editor, value, state.selection);
    }

    if (applied) {
      closeInlinePopover(toolbar, { restoreFocus: false });
    }
    return applied;
  }

  function insertInlineCodeBlock(editor, value, selectionOverride = null) {
    const codeText = normalizeEditorText(value || "");
    if (!codeText.trim()) {
      alert("\uCF54\uB4DC \uBE14\uB85D\uC5D0 \uB123\uC744 \uB0B4\uC6A9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
      return false;
    }

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const selection = normalizeSelectionRange(
      selectionOverride || { start: text.length, end: text.length },
      text.length
    ) || { start: text.length, end: text.length };
    const needsPrefixBreak =
      selection.start > 0 &&
      text[selection.start - 1] !== "\n" &&
      !codeText.startsWith("\n");
    const needsSuffixBreak =
      selection.end < text.length &&
      text[selection.end] !== "\n" &&
      !codeText.endsWith("\n");
    const prefix = needsPrefixBreak ? "\n" : "";
    const suffix = needsSuffixBreak ? "\n" : "";
    const insertText = `${prefix}${codeText}${suffix}`;
    const runStart = selection.start + prefix.length;

    return insertTextIntoRoomEditor(editor, insertText, [{
      start: runStart,
      end: runStart + codeText.length,
      style: { codeMode: "block" }
    }], selection);
  }

  function insertTextIntoRoomEditor(editor, insertText, insertedRuns = [], selectionOverride = null) {
    const targetEditor = editor || getResolvedActiveEditor() || activeEditor;
    if (!targetEditor) return false;

    const baseText = stripInvisibleEnvelope(getEditorText(targetEditor));
    const state = ensureEditorState(targetEditor);
    const selection = normalizeSelectionRange(
      selectionOverride || getEditorSelection(targetEditor) || { start: baseText.length, end: baseText.length },
      baseText.length
    ) || { start: baseText.length, end: baseText.length };
    const nextText = `${baseText.slice(0, selection.start)}${insertText}${baseText.slice(selection.end)}`;
    const nextRuns = rebaseRunsForTextReplacement(
      cloneRuns(state.runs, baseText.length),
      selection,
      insertText,
      baseText.length,
      nextText.length,
      insertedRuns
    );
    const nextAlignRuns = rebaseAlignRunsForTextReplacement(
      cloneAlignRuns(state.alignRuns, getTextLineCount(baseText)),
      baseText,
      selection,
      insertText,
      nextText
    );
    const nextSelection = {
      start: selection.start + insertText.length,
      end: selection.start + insertText.length
    };

    suppressRoomSync = true;
    try {
      setEditorText(targetEditor, nextText);
    } finally {
      suppressRoomSync = false;
    }

    state.text = nextText;
    state.runs = nextRuns;
    state.alignRuns = nextAlignRuns;
    state.blockStyle = cleanupBlockStyle(state.blockStyle);
    state.roll20Source = null;
    activeEditor = targetEditor;
    activeComposer = findComposerForEditor(targetEditor);
    lastFocusedEditor = targetEditor;

    refreshComposerBadge(activeComposer, targetEditor);
    syncEditorVisualPreview(targetEditor);
    restoreRoomSelectionSoon(targetEditor, nextSelection);
    return true;
  }

  function restoreRoomSelectionSoon(editor, selection) {
    if (!editor || !selection) return;
    const safeSelection = normalizeSelectionRange(selection, getEditorText(editor).length);
    if (!safeSelection) return;

    setTimeout(() => {
      if (!document.contains(editor)) return;
      restoreEditorSelection(editor, safeSelection);
    }, 0);
  }

  function syncAnchorButtonBadge(btn, anchorNode) {
    const editor = findEditorFromNode(anchorNode);
    if (editor) {
      updateButtonBadge(btn, editor);
    }
  }

  function createOpenButton(onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeSmall ccf-open-btn";
    btn.setAttribute(OPEN_BTN_ATTR, "1");
    btn.setAttribute("aria-label", "서식 편집");
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d="M5 4h14a1 1 0 0 1 0 2h-5v12h2a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2h2V6H5a1 1 0 1 1 0-2zm13.71 13.29a1 1 0 0 1 0 1.42l-2.59 2.59a1 1 0 0 1-.46.26l-2.83.71a.5.5 0 0 1-.61-.61l.71-2.83a1 1 0 0 1 .26-.46l2.59-2.59a1 1 0 0 1 1.42 0l1.51 1.51z"/>
      </svg>
    `;
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  function openEditorForNode(node, btn = null) {
    const origin = node instanceof Element ? node : null;
    const composer = findClosestComposerBar(origin);
    const editor = findEditorFromComposer(composer) || findEditorFromNode(node) || getCurrentTargetEditor();
    if (!editor) return false;

    activeEditor = editor;
    activeComposer = composer || findComposerForEditor(editor);
    lastFocusedEditor = editor;

    ensureEditorState(activeEditor);
    if (btn) {
      updateButtonBadge(btn, activeEditor);
    }
    openModal();
    syncModalFromEditor(activeEditor);
    return true;
  }

  function getSafeModalMarkup() {
    return `
      <div class="ccf-modal-header">
        <div class="ccf-modal-header-title">
          <span>\uC11C\uC2DD \uD3B8\uC9D1</span>
          <button
            type="button"
            class="ccf-modal-header-action ccf-modal-mode-toggle"
            id="ccf-modal-mode-toggle"
            aria-label="Roll20 CSS \uB9E4\uD06C\uB85C \uBAA8\uB4DC\uB85C \uC804\uD658"
            title="Roll20 CSS \uB9E4\uD06C\uB85C \uBAA8\uB4DC\uB85C \uC804\uD658"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M10 17v-3H3v-2h7V9l4 4-4 4zm4-2v-3h7v2h-7v3l-4-4 4-4v3h7v2h-7z"
              />
            </svg>
          </button>
        </div>
        <div class="ccf-modal-header-actions">
          <button
            type="button"
            class="ccf-modal-header-action ccf-modal-reset-geometry"
            title="\uBAA8\uB2EC \uD06C\uAE30\uC640 \uC704\uCE58 \uAE30\uBCF8\uAC12 \uBCF5\uC6D0"
            aria-label="\uBAA8\uB2EC \uD06C\uAE30\uC640 \uC704\uCE58\uB97C \uAE30\uBCF8\uAC12\uC73C\uB85C \uCD08\uAE30\uD654"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" fill="none">
              <path
                d="M12.5 3.5V6.25H9.75"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M12.1 4A5.25 5.25 0 1 0 13.25 8"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button type="button" class="ccf-modal-header-action ccf-modal-close" aria-label="\uB2EB\uAE30">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="ccf-modal-body">
        <div class="ccf-mode-panel active" data-mode-panel="ccfolia">
          <p class="ccf-mode-note">\uCF54\uCF54\uD3EC\uB9AC\uC544\uC6A9 \uC11C\uC2DD\uC744 \uC120\uD0DD\uD558\uACE0 \uBBF8\uB9AC\uBCF4\uAE30 \uC601\uC5ED\uC5D0\uC11C \uBC14\uB85C \uD3B8\uC9D1\uD569\uB2C8\uB2E4.</p>

          <div class="ccf-toggle-row ccf-toolbar-row">
            <button type="button" class="ccf-toggle" data-toggle="bold" title="\uAD75\uAC8C" aria-label="\uAD75\uAC8C"><b>B</b></button>
            <button type="button" class="ccf-toggle" data-toggle="italic" title="\uAE30\uC6B8\uC784" aria-label="\uAE30\uC6B8\uC784"><i>I</i></button>
            <button type="button" class="ccf-toggle" data-toggle="underline" title="\uBC11\uC904" aria-label="\uBC11\uC904"><u>U</u></button>
            <button type="button" class="ccf-toggle" data-toggle="strike" title="\uCDE8\uC18C\uC120" aria-label="\uCDE8\uC18C\uC120"><s>S</s></button>
            <div class="ccf-code-tool ccf-ruby-tool" id="ccf-ruby-tool">
              <button
                type="button"
                class="ccf-toggle ccf-code-toggle"
                id="ccf-ruby-toggle"
                title="\uB8E8\uBE44\uBB38\uC790"
                aria-label="\uB8E8\uBE44\uBB38\uC790"
                aria-haspopup="dialog"
                aria-expanded="false"
              >Rb</button>
              <div class="ccf-code-backdrop" id="ccf-ruby-backdrop" aria-hidden="true"></div>
              <div class="ccf-code-toolbox ccf-ruby-toolbox" id="ccf-ruby-toolbox" role="dialog" aria-label="\uB8E8\uBE44 \uBB38\uC790 \uC785\uB825" aria-hidden="true">
                <input
                  id="ccf-ruby-input"
                  class="ccf-code-input ccf-ruby-input"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="\uB8E8\uBE44 \uBB38\uC790\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694. \uBE44\uC6CC \uB450\uBA74 \uC81C\uAC70\uB429\uB2C8\uB2E4."
                  aria-label="\uB8E8\uBE44 \uBB38\uC790 \uC785\uB825"
                >
                <div class="ccf-code-meta">
                  <span class="ccf-code-note" id="ccf-ruby-note">Enter\uB85C \uBC14\uB85C \uC801\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</span>
                  <div class="ccf-code-actions">
                    <button type="button" class="ccf-btn" id="ccf-ruby-cancel">\uCDE8\uC18C</button>
                    <button type="button" class="ccf-btn primary" id="ccf-ruby-apply">\uC801\uC6A9</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="ccf-code-tool ccf-tooltip-tool" id="ccf-tooltip-tool">
              <button
                type="button"
                class="ccf-toggle ccf-code-toggle"
                id="ccf-tooltip-toggle"
                title="\uD234\uD301"
                aria-label="\uD234\uD301"
                aria-haspopup="dialog"
                aria-expanded="false"
              >Tip</button>
              <div class="ccf-code-backdrop" id="ccf-tooltip-backdrop" aria-hidden="true"></div>
              <div class="ccf-code-toolbox ccf-tooltip-toolbox" id="ccf-tooltip-toolbox" role="dialog" aria-label="\uD234\uD301 \uC785\uB825" aria-hidden="true">
                <textarea
                  id="ccf-tooltip-input"
                  class="ccf-code-input ccf-tooltip-input"
                  spellcheck="false"
                  placeholder="\uD234\uD301 \uB0B4\uC6A9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694. \uBE44\uC6CC \uB450\uBA74 \uC81C\uAC70\uB429\uB2C8\uB2E4."
                  aria-label="\uD234\uD301 \uC785\uB825"
                ></textarea>
                <div class="ccf-code-meta">
                  <span class="ccf-code-note" id="ccf-tooltip-note">Ctrl+Enter\uB85C \uBC14\uB85C \uC801\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</span>
                  <div class="ccf-code-actions">
                    <button type="button" class="ccf-btn" id="ccf-tooltip-cancel">\uCDE8\uC18C</button>
                    <button type="button" class="ccf-btn primary" id="ccf-tooltip-apply">\uC801\uC6A9</button>
                  </div>
                </div>
              </div>
            </div>
            <button type="button" class="ccf-toggle" id="ccf-blur-toggle" title="\uBE14\uB7EC" aria-label="\uBE14\uB7EC">Bl</button>
            <div class="ccf-code-tool" id="ccf-code-tool">
              <button
                type="button"
                class="ccf-toggle ccf-code-toggle"
                id="ccf-code-toggle"
                title="\uCF54\uB4DC \uBE14\uB85D"
                aria-label="\uCF54\uB4DC \uBE14\uB85D"
                aria-haspopup="dialog"
                aria-expanded="false"
              >&lt;/&gt;</button>
              <div class="ccf-code-backdrop" id="ccf-code-backdrop" aria-hidden="true"></div>
              <div class="ccf-code-toolbox" id="ccf-code-toolbox" role="dialog" aria-label="\uCF54\uB4DC \uBE14\uB85D \uC785\uB825" aria-hidden="true">
                <textarea
                  id="ccf-code-input"
                  class="ccf-code-input"
                  spellcheck="false"
                  placeholder="\uCF54\uB4DC\uB97C \uC785\uB825\uD574 \uC8FC\uC138\uC694."
                ></textarea>
                <div class="ccf-code-meta">
                  <span class="ccf-code-note" id="ccf-code-note">Ctrl+Enter\uB85C \uBC14\uB85C \uB123\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</span>
                  <div class="ccf-code-actions">
                    <button type="button" class="ccf-btn" id="ccf-code-cancel">\uCDE8\uC18C</button>
                    <button type="button" class="ccf-btn primary" id="ccf-code-apply">\uC0BD\uC785</button>
                  </div>
                </div>
              </div>
            </div>
            <button type="button" class="ccf-toggle" id="ccf-narration-toggle" title="\uB098\uB808\uC774\uC158" aria-label="\uB098\uB808\uC774\uC158" aria-pressed="false">Nr</button>
            <span class="ccf-inline-divider" aria-hidden="true"></span>
            <div class="ccf-code-tool" id="ccf-style-clipboard-tool">
              <button
                type="button"
                class="ccf-toggle ccf-code-toggle"
                id="ccf-style-clipboard-toggle"
                title="\uC11C\uC2DD \uC800\uC7A5"
                aria-label="\uC11C\uC2DD \uC800\uC7A5"
                aria-haspopup="dialog"
                aria-expanded="false"
              >Sv</button>
              <div class="ccf-code-backdrop" id="ccf-style-clipboard-backdrop" aria-hidden="true"></div>
              <div class="ccf-code-toolbox" id="ccf-style-clipboard-toolbox" role="dialog" aria-label="\uC11C\uC2DD \uC800\uC7A5" aria-hidden="true">
                <span class="ccf-code-note" id="ccf-style-clipboard-note">\uC120\uD0DD \uD14D\uC2A4\uD2B8\uC758 \uC11C\uC2DD\uC744 \uC800\uC7A5\uD558\uAC70\uB098 \uBD88\uB7EC\uC635\uB2C8\uB2E4.</span>
                <div class="ccf-code-actions">
                  <button type="button" class="ccf-btn" id="ccf-style-clipboard-cancel">\uCDE8\uC18C</button>
                  <button type="button" class="ccf-btn" id="ccf-style-clipboard-save">\uC800\uC7A5</button>
                  <button type="button" class="ccf-btn primary" id="ccf-style-clipboard-load">\uBD88\uB7EC\uC624\uAE30</button>
                </div>
              </div>
            </div>
            <button type="button" class="ccf-toggle" id="ccf-parenthetical-gray" title="\uAD04\uD638 \uD68C\uC0C9" aria-label="\uAD04\uD638 \uD68C\uC0C9" aria-pressed="false">()</button>
            <button type="button" class="ccf-toggle ccf-align-toggle active" data-align="left" title="\uC67C\uCABD \uC815\uB82C" aria-label="\uC67C\uCABD \uC815\uB82C">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M2 3h12v1H2zm0 6h8v1H2zm0 6h12v1H2z"/>
              </svg>
            </button>
            <button type="button" class="ccf-toggle ccf-align-toggle" data-align="center" title="\uAC00\uC6B4\uB370 \uC815\uB82C" aria-label="\uAC00\uC6B4\uB370 \uC815\uB82C">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M2 3h12v1H2zm4 6h4v1H6zM3 15h10v-1H3z"/>
              </svg>
            </button>
            <button type="button" class="ccf-toggle ccf-align-toggle" data-align="right" title="\uC624\uB978\uCABD \uC815\uB82C" aria-label="\uC624\uB978\uCABD \uC815\uB82C">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M2 3h12v1H2zm6 6h6v1H8zM2 15h12v-1H2z"/>
              </svg>
            </button>
            <div class="ccf-inline-tool ccf-color-tool" title="\uAE00\uC790\uC0C9">
              <input id="ccf-color" type="color" value="#ffffff" aria-label="\uAE00\uC790\uC0C9">
            </div>

            <div class="ccf-inline-tool ccf-color-tool" title="\uBC30\uACBD\uC0C9">
              <input id="ccf-bgcolor" type="color" value="#000000" aria-label="\uBC30\uACBD\uC0C9">
            </div>

            <div class="ccf-inline-tool ccf-size-tool" title="\uAE00\uC790 \uD06C\uAE30">
              <button type="button" class="ccf-size-step" id="ccf-fontsize-decrease" data-step="-1" aria-label="\uAE00\uC790 \uD06C\uAE30 \uC904\uC774\uAE30">-</button>
              <div class="ccf-size-value">
                <button
                  type="button"
                  class="ccf-size-display"
                  id="ccf-fontsize-display"
                  data-empty="1"
                  aria-label="\uAE00\uC790 \uD06C\uAE30 \uC785\uB825 \uC5F4\uAE30"
                  aria-haspopup="listbox"
                  aria-expanded="false"
                >\uAE30\uBCF8</button>
                <input
                  id="ccf-fontsize-input"
                  type="text"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  placeholder="\uAE30\uBCF8"
                  autocomplete="off"
                  aria-label="\uAE00\uC790 \uD06C\uAE30 \uC9C1\uC811 \uC785\uB825"
                >
                <div class="ccf-size-menu" id="ccf-fontsize-menu" role="listbox" aria-label="\uAE00\uC790 \uD06C\uAE30 \uC635\uC158">
                  <button type="button" class="ccf-size-option active" data-size="" role="option" aria-selected="true">\uAE30\uBCF8</button>
                  <button type="button" class="ccf-size-option" data-size="12" role="option" aria-selected="false">12</button>
                  <button type="button" class="ccf-size-option" data-size="14" role="option" aria-selected="false">14</button>
                  <button type="button" class="ccf-size-option" data-size="16" role="option" aria-selected="false">16</button>
                  <button type="button" class="ccf-size-option" data-size="18" role="option" aria-selected="false">18</button>
                  <button type="button" class="ccf-size-option" data-size="20" role="option" aria-selected="false">20</button>
                  <button type="button" class="ccf-size-option" data-size="24" role="option" aria-selected="false">24</button>
                </div>
              </div>
              <button type="button" class="ccf-size-step" id="ccf-fontsize-increase" data-step="1" aria-label="\uAE00\uC790 \uD06C\uAE30 \uB298\uB9AC\uAE30">+</button>
            </div>

            <div class="ccf-image-tool" id="ccf-image-tool">
              <button
                type="button"
                class="ccf-toggle ccf-image-toggle"
                id="ccf-image-popover-toggle"
                aria-label="\uC774\uBBF8\uC9C0 \uC0BD\uC785"
                aria-haspopup="dialog"
                aria-expanded="false"
                title="\uC774\uBBF8\uC9C0 \uC0BD\uC785"
              >
                <svg viewBox="0.4 1.2 15.2 13.2" aria-hidden="true">
                  <rect x="0.95" y="1.85" width="14.1" height="11.6" rx="0.85" fill="none" stroke="currentColor" stroke-width="1.45"/>
                  <circle cx="4.9" cy="5.45" r="1.24" fill="currentColor"/>
                  <path d="M2.15 11.85l3.35-3.3 2.25 2.05 2.7-3.05 2.4 2.45" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div class="ccf-image-toolbox" id="ccf-image-toolbox" role="dialog" aria-label="\uC774\uBBF8\uC9C0 \uC0BD\uC785 \uD31D\uC5C5" aria-hidden="true">
                <div class="ccf-image-row">
                  <input
                    id="ccf-image-url"
                    class="ccf-image-url"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="\uC774\uBBF8\uC9C0 \uB9C1\uD06C \uC785\uB825"
                    aria-label="\uC774\uBBF8\uC9C0 \uB9C1\uD06C"
                  >
                  <button type="button" class="ccf-btn" id="ccf-image-url-add">\uB9C1\uD06C \uCD94\uAC00</button>
                </div>
                <div class="ccf-image-status" id="ccf-image-status" data-state="idle">\uC774\uBBF8\uC9C0 \uB9C1\uD06C\uB97C \uC785\uB825\uD558\uBA74 \uBC14\uB85C \uCD94\uAC00\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.</div>
              </div>
            </div>
          </div>

          <div
            class="ccf-preview ccf-preview-editor"
            id="ccf-preview"
            contenteditable="true"
            role="textbox"
            aria-multiline="true"
            spellcheck="false"
          ></div>
        </div>

        <div class="ccf-mode-panel" data-mode-panel="roll20" hidden>
          <p class="ccf-mode-note">Roll20\uC5D0\uC11C \uC4F0\uB294 CSS \uB9E4\uD06C\uB85C \uC6D0\uBB38\uC744 \uB113\uC740 \uC785\uB825\uCC3D\uC5D0\uC11C \uD3B8\uC9D1\uD569\uB2C8\uB2E4.<br>/desc \uBA85\uB839\uC744 \uBCC0\uD658\uD558\uBA74 \uCF54\uCF54\uD3EC\uB9AC\uC544 \uC785\uB825\uCC3D\uC5D0 \uBCF4\uC774\uB294 \uD615\uD0DC\uB85C \uC801\uC6A9\uD569\uB2C8\uB2E4.</p>
          <div class="ccf-mode-actions">
            <span class="ccf-roll20-status" id="ccf-roll20-status" data-state="idle">/desc \uBA85\uB839\uC744 \uBD99\uC5EC\uB123\uACE0 \uBCC0\uD658\uC744 \uB204\uB974\uBA74 \uBBF8\uB9AC\uBCF4\uAE30\uAC00 \uC0DD\uC131\uB429\uB2C8\uB2E4.</span>
          </div>
          <textarea
            id="ccf-roll20-editor"
            class="ccf-roll20-editor"
            spellcheck="false"
            placeholder="/desc [\u2500\u2500\u2500\u2500\u2500\u2500\u2500](#&quot; style=&quot;color:#333333; font-style: normal;&quot;)"
          ></textarea>
          <div class="ccf-preview ccf-roll20-preview is-empty" id="ccf-roll20-preview" aria-live="polite">/desc \uBCC0\uD658 \uACB0\uACFC\uAC00 \uC5EC\uAE30\uC5D0 \uBCF4\uC785\uB2C8\uB2E4.</div>
        </div>

        <div class="ccf-actions">
          <button type="button" class="ccf-btn" id="ccf-roll20-convert" hidden>\uBCC0\uD658</button>
          <button type="button" class="ccf-btn primary" id="ccf-apply-style">\uC801\uC6A9</button>
        </div>
      </div>
    `;
  }

  function ensureModal() {
    const existingModal = document.getElementById(MODAL_ID);
    if (existingModal && existingModal.dataset.ccfSafeMarkup !== "1") {
      existingModal.remove();
    }

    const existingBackdrop = document.getElementById(BACKDROP_ID);
    if (existingBackdrop && existingBackdrop.dataset.ccfSafeMarkup !== "1") {
      existingBackdrop.remove();
    }

    if (!document.getElementById(BACKDROP_ID)) {
      const backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.dataset.ccfSafeMarkup = "1";
      backdrop.addEventListener("click", closeModal);
      document.body.appendChild(backdrop);
    }

    if (document.getElementById(MODAL_ID)) return;

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.dataset.ccfSafeMarkup = "1";
    modal.innerHTML = `
      <div class="ccf-modal-header">
        <span>서식 편집</span>
        <button type="button" class="ccf-modal-close" aria-label="닫기">X</button>
      </div>

      <div class="ccf-modal-body">
        <div class="ccf-toggle-row ccf-toolbar-row">
          <button type="button" class="ccf-toggle" data-toggle="bold" title="굵게" aria-label="굵게"><b>B</b></button>
          <button type="button" class="ccf-toggle" data-toggle="italic" title="기울임" aria-label="기울임"><i>I</i></button>
          <button type="button" class="ccf-toggle" data-toggle="underline" title="밑줄" aria-label="밑줄"><u>U</u></button>
          <button type="button" class="ccf-toggle" data-toggle="strike" title="취소선" aria-label="취소선"><s>S</s></button>

          <div class="ccf-inline-tool ccf-color-tool" title="글자색">
            <input id="ccf-color" type="color" value="#ffffff" aria-label="글자색">
          </div>

          <div class="ccf-inline-tool ccf-color-tool" title="배경색">
            <input id="ccf-bgcolor" type="color" value="#000000" aria-label="배경색">
          </div>

          <div class="ccf-inline-tool ccf-size-tool" title="글자 크기">
            <select id="ccf-fontsize" aria-label="글자 크기">
              <option value="">A</option>
              <option value="12">12</option>
              <option value="14">14</option>
              <option value="16">16</option>
              <option value="18">18</option>
              <option value="20">20</option>
              <option value="24">24</option>
            </select>
          </div>
        </div>

        <div
          class="ccf-preview ccf-preview-editor"
          id="ccf-preview"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          spellcheck="false"
        ></div>

        <div class="ccf-actions">
          <button type="button" class="ccf-btn primary" id="ccf-apply-style">적용</button>
        </div>
      </div>
    `;
    modal.innerHTML = getSafeModalMarkup();
    document.body.appendChild(modal);
    restoreStoredModalSize(modal);
    bindModalResizePersistence(modal);
    bindModalDrag(modal);
    bindModalEdgeResize(modal);

    modal.querySelector(".ccf-modal-reset-geometry")?.addEventListener("click", () => resetModalGeometry(modal));
    modal.querySelector(".ccf-modal-close")?.addEventListener("click", () => closeModal());

    modal.querySelector("#ccf-apply-style")?.addEventListener("click", () => {
      if (commitModalDraftToRoomEditor()) {
        closeModal();
      }
    });

    modal.querySelector("#ccf-modal-mode-toggle")?.addEventListener("click", () => {
      const nextMode = modalMode === MODAL_MODE_CCFOLIA ? MODAL_MODE_ROLL20 : MODAL_MODE_CCFOLIA;
      setModalMode(nextMode, { focusEditor: true });
    });

    modal.querySelectorAll(".ccf-toggle[data-toggle]").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      btn.addEventListener("click", () => {
        btn.classList.toggle("active");
        applyCurrentModalStyle({ silent: true, previewOnly: true });
      });
    });

    modal.querySelector("#ccf-parenthetical-gray")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-parenthetical-gray")?.addEventListener("click", (event) => {
      const nextActive = !modalDraftParentheticalGray;
      modalDraftParentheticalGray = nextActive;
      setParentheticalGrayToggle(nextActive);
      if (nextActive) {
        applyParentheticalGrayToModalDraft();
      }
    });
    modal.querySelector("#ccf-narration-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-narration-toggle")?.addEventListener("click", () => {
      toggleModalNarration();
    });

    modal.querySelector("#ccf-ruby-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-ruby-toggle")?.addEventListener("click", () => {
      applyRubyToCurrentSelection();
    });
    modal.querySelector("#ccf-ruby-backdrop")?.addEventListener("click", () => {
      setRubyPopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-ruby-cancel")?.addEventListener("click", () => {
      setRubyPopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-ruby-apply")?.addEventListener("click", () => {
      applyRubyFromPopover();
    });
    modal.querySelector("#ccf-ruby-input")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      applyRubyFromPopover();
    });
    modal.querySelector("#ccf-code-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-code-toggle")?.addEventListener("click", () => {
      setCodePopoverOpen(!isCodePopoverOpen(), {
        focusInput: !isCodePopoverOpen(),
        prefillSelection: true
      });
    });
    modal.querySelector("#ccf-code-backdrop")?.addEventListener("click", () => {
      setCodePopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-code-cancel")?.addEventListener("click", () => {
      setCodePopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-code-apply")?.addEventListener("click", () => {
      insertCodeBlockFromPopover();
    });
    modal.querySelector("#ccf-code-input")?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        insertCodeBlockFromPopover();
        return;
      }

      if (event.key === "Tab" && event.currentTarget instanceof HTMLTextAreaElement) {
        const input = event.currentTarget;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        event.preventDefault();
        input.setRangeText("  ", start, end, "end");
      }
    });
    modal.querySelector("#ccf-style-clipboard-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-style-clipboard-toggle")?.addEventListener("click", () => {
      setStyleClipboardPopoverOpen(!isStyleClipboardPopoverOpen());
    });
    modal.querySelector("#ccf-style-clipboard-backdrop")?.addEventListener("click", () => {
      setStyleClipboardPopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-style-clipboard-cancel")?.addEventListener("click", () => {
      setStyleClipboardPopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-style-clipboard-save")?.addEventListener("click", () => {
      if (saveStyleClipboardFromContext(getActiveSelectionStyleContext())) {
        setStyleClipboardPopoverOpen(false, { focusToggle: true });
      }
    });
    modal.querySelector("#ccf-style-clipboard-load")?.addEventListener("click", () => {
      if (applyStyleClipboardToContext(getActiveSelectionStyleContext())) {
        setStyleClipboardPopoverOpen(false, { focusToggle: true });
      }
    });
    modal.querySelector("#ccf-tooltip-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-tooltip-toggle")?.addEventListener("click", () => {
      applyTooltipToCurrentSelection();
    });
    modal.querySelector("#ccf-tooltip-backdrop")?.addEventListener("click", () => {
      setTooltipPopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-tooltip-cancel")?.addEventListener("click", () => {
      setTooltipPopoverOpen(false, { focusToggle: true });
    });
    modal.querySelector("#ccf-tooltip-apply")?.addEventListener("click", () => {
      applyTooltipFromPopover();
    });
    modal.querySelector("#ccf-tooltip-input")?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        applyTooltipFromPopover();
      }
    });
    modal.querySelector("#ccf-blur-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-blur-toggle")?.addEventListener("click", () => {
      applyBlurToCurrentSelection();
    });

    modal.querySelectorAll(".ccf-align-toggle").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      btn.addEventListener("click", () => {
        setAlignmentToggle(btn.dataset.align || "left");
        applyCurrentModalBlockStyle({ previewOnly: true });
        restoreModalSelectionSoon();
      });
    });

    modal.querySelector("#ccf-color")?.addEventListener("input", () => {
      syncInlineToolVisuals();
      applyCurrentModalStyle({ silent: true, previewOnly: true });
      restoreModalSelectionSoon();
    });
    modal.querySelector("#ccf-color")?.addEventListener("change", () => {
      restoreModalSelectionSoon();
    });

    modal.querySelector("#ccf-bgcolor")?.addEventListener("input", () => {
      syncInlineToolVisuals();
      applyCurrentModalStyle({ silent: true, previewOnly: true });
      restoreModalSelectionSoon();
    });
    modal.querySelector("#ccf-bgcolor")?.addEventListener("change", () => {
      restoreModalSelectionSoon();
    });

    modal.querySelector("#ccf-fontsize-display")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-fontsize-display")?.addEventListener("click", () => {
      openFontSizeEditor();
    });

    modal.querySelectorAll(".ccf-size-step").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      btn.addEventListener("click", (event) => {
        const delta = Number(btn.dataset.step) || 0;
        if (!delta) return;
        stepFontSize(delta * (event.shiftKey ? 10 : 1));
      });
    });

    modal.querySelector("#ccf-fontsize-input")?.addEventListener("input", (event) => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return;
      const sanitized = event.currentTarget.value.replace(/[^\d]/g, "");
      if (event.currentTarget.value !== sanitized) {
        event.currentTarget.value = sanitized;
      }
      syncFontSizeOptionState(sanitized);
    });

    modal.querySelector("#ccf-fontsize-input")?.addEventListener("keydown", (event) => {
      if (!(event.currentTarget instanceof HTMLInputElement)) return;

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? 1 : -1;
        const step = event.shiftKey ? 10 : 1;
        const baseSize =
          normalizeFontSizeValue(event.currentTarget.value) ??
          getFontSizeFromToolState() ??
          FONT_SIZE_PRESETS[2];
        setFontSizeControls(baseSize + (direction * step));
        applyCurrentModalStyle({ silent: true, previewOnly: true });
        restoreModalSelectionSoon();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        commitFontSizeInput();
        closeFontSizeEditor();
        return;
      }

      if (event.key !== "Enter") return;

      event.preventDefault();
      commitFontSizeInput();
      applyCurrentModalStyle({ silent: true, previewOnly: true });
      closeFontSizeEditor({ focusEditor: true });
    });

    modal.querySelector(".ccf-size-tool")?.addEventListener("focusout", () => {
      setTimeout(() => {
        const tool = getFontSizeTool();
        if (!tool || tool.contains(document.activeElement)) return;
        if (isFontSizeEditorOpen()) {
          commitFontSizeInput();
          applyCurrentModalStyle({ silent: true, previewOnly: true });
        }
        closeFontSizeEditor();
      }, 0);
    });

    modal.querySelectorAll(".ccf-size-option").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      btn.addEventListener("click", () => {
        setFontSizeControls(btn.dataset.size || "");
        applyCurrentModalStyle({ silent: true, previewOnly: true });
        closeFontSizeEditor();
      });
    });

    syncInlineToolVisuals();

    modal.querySelector("#ccf-image-popover-toggle")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-image-popover-toggle")?.addEventListener("click", () => {
      toggleImagePopover();
    });

    modal.querySelector("#ccf-image-url-add")?.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    modal.querySelector("#ccf-image-url-add")?.addEventListener("click", () => {
      insertImageUrlFromInput();
    });

    modal.querySelector("#ccf-image-url")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      insertImageUrlFromInput();
    });

    const handleModalImageDragEnter = () => {};

    const handleModalImageDragOver = () => {};

    const handleModalImageDragLeave = () => {};

    const handleModalImageDrop = async () => {
      return;
      event.preventDefault();
      event.stopPropagation();
      const imageFiles = getDroppedImageFiles(event);
      modalImageDragDepth = 0;
      setImageDragHighlight(false);
      if (!imageFiles.length) {
        setImageStatus("이미지 파일만 드롭할 수 있습니다.", "error");
        return;
      }
      setImageFilePathDisplay(imageFiles);
      await insertImageFilesViaIfh(imageFiles, {
        displayValue: getImageFileDisplayValue(imageFiles)
      });
    };

    modal.addEventListener("dragenter", handleModalImageDragEnter, true);
    modal.addEventListener("dragover", handleModalImageDragOver, true);
    modal.addEventListener("dragleave", handleModalImageDragLeave, true);
    modal.addEventListener("drop", handleModalImageDrop, true);

    modal.addEventListener("paste", async () => {
      return;
      const imageFiles = getClipboardImageFiles(event);
      if (!imageFiles.length) return;
      event.preventDefault();
      event.stopPropagation();
      setImageFilePathDisplay(imageFiles);
      await insertImageFilesViaIfh(imageFiles, {
        displayValue: getImageFileDisplayValue(imageFiles)
      });
    }, true);

    const previewEl = modal.querySelector("#ccf-preview");
    previewEl?.addEventListener("keydown", (event) => {
      event.stopPropagation();

      if (event.key === "Enter" && !event.shiftKey) {
        event.stopImmediatePropagation?.();
      }
    }, true);

    previewEl?.addEventListener("beforeinput", (event) => {
      event.stopPropagation();
    }, true);

    previewEl?.addEventListener("input", (event) => {
      event.stopPropagation();
      const selection = getEditorSelection(previewEl);
      syncDraftAfterTextMutation(getEditorText(previewEl), selection);
    }, true);

    previewEl?.addEventListener("paste", (event) => {
      const clipboardImage = extractClipboardImagePayload(event);
      if (clipboardImage?.imageUrl) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        insertImageIntoDraft(clipboardImage.imageUrl, clipboardImage.imageAlt, {
          restoreFocus: false
        });
        return;
      }

      const hasPotentialClipboardImagePayload = hasAsyncClipboardImagePayload(event);
      if (hasPotentialClipboardImagePayload) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        void extractClipboardImagePayloadAsync(event).then((asyncClipboardImage) => {
          if (!asyncClipboardImage?.imageUrl) {
            setImageStatus("클립보드에서 이미지 주소를 찾지 못했습니다. 이미지 링크를 직접 입력해주세요.", "error");
            return;
          }

          insertImageIntoDraft(asyncClipboardImage.imageUrl, asyncClipboardImage.imageAlt, {
            restoreFocus: false
          });
        });
        return;
      }

      event.stopPropagation();
    }, true);

    previewEl?.addEventListener("click", (event) => {
      event.stopPropagation();
    }, true);

    previewEl?.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    }, true);

    const roll20El = modal.querySelector("#ccf-roll20-editor");
    modal.querySelector("#ccf-roll20-convert")?.addEventListener("click", () => {
      convertRoll20Draft({ silent: false, forceRender: true });
    });

    roll20El?.addEventListener("keydown", (event) => {
      event.stopPropagation();
    }, true);

    roll20El?.addEventListener("beforeinput", (event) => {
      event.stopPropagation();
    }, true);

    roll20El?.addEventListener("input", (event) => {
      event.stopPropagation();
      modalDraftRoll20Text = getEditorText(roll20El);
      if (modalDraftRoll20ConvertedSource !== modalDraftRoll20Text) {
        invalidateRoll20ConversionPreview();
      }
    }, true);

    roll20El?.addEventListener("paste", (event) => {
      event.stopPropagation();
      setTimeout(() => {
        modalDraftRoll20Text = getEditorText(roll20El);
        if (modalDraftRoll20ConvertedSource !== modalDraftRoll20Text) {
          invalidateRoll20ConversionPreview();
        }
      }, 0);
    }, true);

    roll20El?.addEventListener("click", (event) => {
      event.stopPropagation();
    }, true);

    roll20El?.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    }, true);

    syncModalModeUi();
  }

  function openModal() {
    const backdrop = document.getElementById(BACKDROP_ID);
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    backdrop?.classList.add("show");
    modal.classList.add("show");
    constrainModalSize(modal);
    const resizedForRoll20 = ensureRoll20ModalHeight(modal);
    if (restoreStoredModalPosition(modal)) {
      constrainModalPosition(modal);
    } else {
      positionModalNearComposer();
    }
    if (resizedForRoll20) {
      persistModalGeometry(modal);
    }
  }

  function closeModal() {
    const roomEditor = getResolvedActiveEditor();
    setModalSelection(null);
    document.getElementById(BACKDROP_ID)?.classList.remove("show");
    document.getElementById(MODAL_ID)?.classList.remove("show");
    modalDraftText = null;
    modalDraftRuns = null;
    modalDraftAlignRuns = null;
    modalDraftBlockStyle = null;
    modalDraftParentheticalGray = false;
    modalDraftRoll20Text = null;
    modalDraftRoll20ConvertedSource = null;
    modalDraftLastStyle = null;
    resetRubyToolboxState();
    resetTooltipToolboxState();
    resetCodeToolboxState();
    setStyleClipboardPopoverOpen(false);
    resetImageToolboxState();
    roomEditor?.focus?.({ preventScroll: true });
  }

  function restoreStoredModalSize(modal) {
    if (!modal) return;

    try {
      const parsed = readStoredModalGeometry();
      if (!parsed) return;

      if (Number.isFinite(parsed?.width)) {
        modal.style.width = `${Math.round(parsed.width)}px`;
      }
      if (Number.isFinite(parsed?.height)) {
        modal.style.height = `${Math.round(parsed.height)}px`;
      }
    } catch (error) {
      console.warn("[CCF] failed to restore modal size", error);
    }
  }

  function getDefaultModalSize() {
    return {
      width: clamp(
        MODAL_DEFAULT_WIDTH,
        MODAL_MIN_WIDTH,
        Math.max(MODAL_MIN_WIDTH, window.innerWidth - MODAL_VIEWPORT_MARGIN)
      ),
      height: clamp(
        MODAL_DEFAULT_HEIGHT,
        MODAL_MIN_HEIGHT,
        Math.max(MODAL_MIN_HEIGHT, window.innerHeight - MODAL_VIEWPORT_MARGIN)
      )
    };
  }

  function ensureRoll20ModalHeight(modal = document.getElementById(MODAL_ID)) {
    if (!modal || cleanupModalMode(modalMode) !== MODAL_MODE_ROLL20) return false;

    const maxHeight = Math.max(MODAL_MIN_HEIGHT, window.innerHeight - MODAL_VIEWPORT_MARGIN);
    const recommendedHeight = clamp(ROLL20_RECOMMENDED_MODAL_HEIGHT, MODAL_MIN_HEIGHT, maxHeight);
    const currentHeight = modal.offsetHeight || MODAL_DEFAULT_HEIGHT;

    if (currentHeight >= recommendedHeight) return false;

    modal.style.height = `${Math.round(recommendedHeight)}px`;
    constrainModalSize(modal);
    constrainModalPosition(modal);
    return true;
  }

  function resetModalGeometry(modal = document.getElementById(MODAL_ID)) {
    if (!modal) return;

    const { width, height } = getDefaultModalSize();
    modal.style.width = `${Math.round(width)}px`;
    modal.style.height = `${Math.round(height)}px`;
    delete modal.dataset.ccfCustomPosition;
    modal.style.left = "";
    modal.style.top = "";
    modal.style.right = "";
    modal.style.bottom = "";
    constrainModalSize(modal);
    positionModalNearComposer();
    persistModalGeometry(modal);
  }

  function restoreStoredModalPosition(modal) {
    if (!modal) return false;

    try {
      const parsed = readStoredModalGeometry();
      if (!parsed) return false;
      if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) return false;

      modal.dataset.ccfCustomPosition = "1";
      modal.style.left = `${Math.round(parsed.left)}px`;
      modal.style.top = `${Math.round(parsed.top)}px`;
      modal.style.right = "auto";
      modal.style.bottom = "auto";
      return true;
    } catch (error) {
      console.warn("[CCF] failed to restore modal position", error);
      return false;
    }
  }

  function readStoredModalGeometry() {
    const raw = window.localStorage.getItem(MODAL_SIZE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  }

  function persistModalGeometry(modal = document.getElementById(MODAL_ID)) {
    if (!modal) return;

    try {
      const next = {
        width: Math.round(modal.offsetWidth),
        height: Math.round(modal.offsetHeight)
      };

      if (modal.dataset.ccfCustomPosition === "1") {
        const { left, top } = getCurrentModalPosition(modal);
        next.left = Math.round(left);
        next.top = Math.round(top);
      }

      window.localStorage.setItem(MODAL_SIZE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn("[CCF] failed to persist modal geometry", error);
    }
  }

  function constrainModalSize(modal = document.getElementById(MODAL_ID)) {
    if (!modal) return;

    const maxWidth = Math.max(MODAL_MIN_WIDTH, window.innerWidth - MODAL_VIEWPORT_MARGIN);
    const maxHeight = Math.max(MODAL_MIN_HEIGHT, window.innerHeight - MODAL_VIEWPORT_MARGIN);

    const currentWidth = modal.offsetWidth || MODAL_DEFAULT_WIDTH;
    const currentHeight = modal.offsetHeight || MODAL_DEFAULT_HEIGHT;
    const nextWidth = clamp(currentWidth, MODAL_MIN_WIDTH, maxWidth);
    const nextHeight = clamp(currentHeight, MODAL_MIN_HEIGHT, maxHeight);

    if (Math.abs(currentWidth - nextWidth) > 1) {
      modal.style.width = `${Math.round(nextWidth)}px`;
    }
    if (Math.abs(currentHeight - nextHeight) > 1) {
      modal.style.height = `${Math.round(nextHeight)}px`;
    }
  }

  function getCurrentModalPosition(modal = document.getElementById(MODAL_ID)) {
    if (!modal) {
      return { left: MODAL_POSITION_PADDING, top: MODAL_POSITION_PADDING };
    }

    const rect = modal.getBoundingClientRect();
    const left = Number.parseFloat(modal.style.left);
    const top = Number.parseFloat(modal.style.top);

    return {
      left: Number.isFinite(left) ? left : rect.left,
      top: Number.isFinite(top) ? top : rect.top
    };
  }

  function constrainModalPosition(modal = document.getElementById(MODAL_ID)) {
    if (!modal) return { left: MODAL_POSITION_PADDING, top: MODAL_POSITION_PADDING };

    const viewportPad = MODAL_POSITION_PADDING;
    const width = modal.offsetWidth || MODAL_DEFAULT_WIDTH;
    const height = modal.offsetHeight || MODAL_DEFAULT_HEIGHT;
    const current = getCurrentModalPosition(modal);
    const maxLeft = Math.max(viewportPad, window.innerWidth - width - viewportPad);
    const maxTop = Math.max(viewportPad, window.innerHeight - height - viewportPad);
    const left = clamp(current.left, viewportPad, maxLeft);
    const top = clamp(current.top, viewportPad, maxTop);

    modal.style.left = `${Math.round(left)}px`;
    modal.style.top = `${Math.round(top)}px`;
    modal.style.right = "auto";
    modal.style.bottom = "auto";

    return { left, top };
  }

  function bindModalResizePersistence(modal) {
    if (!modal || modal.dataset.ccfResizeBound === "1") return;

    modal.dataset.ccfResizeBound = "1";

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (!ccfFsIsActive()) return;
      if (!modal.classList.contains("show")) return;
      constrainModalSize(modal);
      constrainModalPosition(modal);
      persistModalGeometry(modal);
      scheduleImagePopoverPosition();
    });

    observer.observe(modal);
    ccfFsRegisterTeardown(() => observer.disconnect());
  }

  function getModalResizeDirection(modal, clientX, clientY) {
    if (!modal || !modal.classList.contains("show")) return "";

    const rect = modal.getBoundingClientRect();
    const threshold = MODAL_RESIZE_EDGE_THRESHOLD;
    const nearLeft = clientX >= rect.left && clientX <= rect.left + threshold;
    const nearRight = clientX <= rect.right && clientX >= rect.right - threshold;
    const nearTop = clientY >= rect.top && clientY <= rect.top + threshold;
    const nearBottom = clientY <= rect.bottom && clientY >= rect.bottom - threshold;

    if (nearTop && nearLeft) return "nw";
    if (nearTop && nearRight) return "ne";
    if (nearBottom && nearLeft) return "sw";
    if (nearBottom && nearRight) return "se";
    if (nearTop) return "n";
    if (nearBottom) return "s";
    if (nearLeft) return "w";
    if (nearRight) return "e";
    return "";
  }

  function getModalResizeCursor(direction) {
    switch (direction) {
      case "n":
      case "s":
        return "ns-resize";
      case "e":
      case "w":
        return "ew-resize";
      case "ne":
      case "sw":
        return "nesw-resize";
      case "nw":
      case "se":
        return "nwse-resize";
      default:
        return "";
    }
  }

  function bindModalEdgeResize(modal) {
    if (!modal || modal.dataset.ccfEdgeResizeBound === "1") return;

    modal.dataset.ccfEdgeResizeBound = "1";
    const header = modal.querySelector(".ccf-modal-header");
    let activeResize = null;

    const clearResizeCursor = () => {
      if (activeResize) return;
      modal.style.cursor = "";
      document.documentElement.style.cursor = "";
      document.body.style.userSelect = "";
      if (header) {
        header.style.cursor = "move";
      }
    };

    const updateHoverCursor = (cursor = "") => {
      modal.style.cursor = cursor;
      if (header) {
        header.style.cursor = cursor || "move";
      }
    };

    modal.addEventListener("pointermove", (event) => {
      if (activeResize || event.buttons !== 0) return;
      updateHoverCursor(getModalResizeCursor(getModalResizeDirection(modal, event.clientX, event.clientY)));
    });

    modal.addEventListener("pointerleave", () => {
      clearResizeCursor();
    });

    modal.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;

      const direction = getModalResizeDirection(modal, event.clientX, event.clientY);
      if (!direction) return;

      const startRect = modal.getBoundingClientRect();
      const startPosition = getCurrentModalPosition(modal);
      const startRight = startPosition.left + startRect.width;
      const startBottom = startPosition.top + startRect.height;
      const viewportPad = MODAL_POSITION_PADDING;
      const startCursor = getModalResizeCursor(direction);

      activeResize = {
        direction,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: startPosition.left,
        startTop: startPosition.top,
        startWidth: startRect.width,
        startHeight: startRect.height,
        startRight,
        startBottom
      };

      modal.dataset.ccfCustomPosition = "1";
      modal.setPointerCapture?.(event.pointerId);
      updateHoverCursor(startCursor);
      document.documentElement.style.cursor = startCursor;
      document.body.style.userSelect = "none";
      event.preventDefault();
      event.stopPropagation();
    }, true);

    const finishResize = (pointerId = null) => {
      if (!activeResize) return;
      if (pointerId != null && activeResize.pointerId !== pointerId) return;

      modal.releasePointerCapture?.(activeResize.pointerId);
      activeResize = null;
      clearResizeCursor();
      constrainModalSize(modal);
      constrainModalPosition(modal);
      persistModalGeometry(modal);
      scheduleImagePopoverPosition();
    };

    modal.addEventListener("pointerup", (event) => {
      finishResize(event.pointerId);
    });

    modal.addEventListener("pointercancel", (event) => {
      finishResize(event.pointerId);
    });

    modal.addEventListener("pointermove", (event) => {
      if (!activeResize || activeResize.pointerId !== event.pointerId) return;

      const dx = event.clientX - activeResize.startX;
      const dy = event.clientY - activeResize.startY;
      const direction = activeResize.direction;
      const viewportPad = MODAL_POSITION_PADDING;
      const resizeWest = direction.includes("w");
      const resizeEast = direction.includes("e");
      const resizeNorth = direction.includes("n");
      const resizeSouth = direction.includes("s");

      let width = activeResize.startWidth;
      let height = activeResize.startHeight;
      let left = activeResize.startLeft;
      let top = activeResize.startTop;

      if (resizeEast) {
        const maxWidth = Math.max(MODAL_MIN_WIDTH, window.innerWidth - viewportPad - activeResize.startLeft);
        width = clamp(activeResize.startWidth + dx, MODAL_MIN_WIDTH, maxWidth);
      }

      if (resizeWest) {
        const maxWidth = Math.max(MODAL_MIN_WIDTH, activeResize.startRight - viewportPad);
        width = clamp(activeResize.startWidth - dx, MODAL_MIN_WIDTH, maxWidth);
        left = activeResize.startRight - width;
      }

      if (resizeSouth) {
        const maxHeight = Math.max(MODAL_MIN_HEIGHT, window.innerHeight - viewportPad - activeResize.startTop);
        height = clamp(activeResize.startHeight + dy, MODAL_MIN_HEIGHT, maxHeight);
      }

      if (resizeNorth) {
        const maxHeight = Math.max(MODAL_MIN_HEIGHT, activeResize.startBottom - viewportPad);
        height = clamp(activeResize.startHeight - dy, MODAL_MIN_HEIGHT, maxHeight);
        top = activeResize.startBottom - height;
      }

      modal.style.width = `${Math.round(width)}px`;
      modal.style.height = `${Math.round(height)}px`;
      modal.style.left = `${Math.round(left)}px`;
      modal.style.top = `${Math.round(top)}px`;
      modal.style.right = "auto";
      modal.style.bottom = "auto";
      updateHoverCursor(getModalResizeCursor(direction));
      constrainModalPosition(modal);
      scheduleImagePopoverPosition();
      event.preventDefault();
    });
  }

  function bindModalDrag(modal) {
    if (!modal || modal.dataset.ccfDragBound === "1") return;

    modal.dataset.ccfDragBound = "1";
    const header = modal.querySelector(".ccf-modal-header");
    if (!header) return;

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest(".ccf-modal-header-action")) return;

      const startRect = modal.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;

      modal.dataset.ccfCustomPosition = "1";
      header.setPointerCapture?.(event.pointerId);
      event.preventDefault();

      const onMove = (moveEvent) => {
        const left = startRect.left + (moveEvent.clientX - startX);
        const top = startRect.top + (moveEvent.clientY - startY);

        modal.style.left = `${Math.round(left)}px`;
        modal.style.top = `${Math.round(top)}px`;
        modal.style.right = "auto";
        modal.style.bottom = "auto";
        constrainModalPosition(modal);
        scheduleImagePopoverPosition();
      };

      const onUp = () => {
        header.releasePointerCapture?.(event.pointerId);
        header.removeEventListener("pointermove", onMove);
        header.removeEventListener("pointerup", onUp);
        header.removeEventListener("pointercancel", onUp);
        persistModalGeometry(modal);
        scheduleImagePopoverPosition();
      };

      header.addEventListener("pointermove", onMove);
      header.addEventListener("pointerup", onUp);
      header.addEventListener("pointercancel", onUp);
    });
  }

  function isModalOpen() {
    return document.getElementById(MODAL_ID)?.classList.contains("show") || false;
  }

  function cleanupModalMode(mode) {
    return mode === MODAL_MODE_ROLL20 ? MODAL_MODE_ROLL20 : MODAL_MODE_CCFOLIA;
  }

  function readStoredModalMode() {
    try {
      return cleanupModalMode(window.localStorage.getItem(MODAL_MODE_KEY));
    } catch (error) {
      console.warn("[CCF] failed to restore modal mode", error);
      return MODAL_MODE_CCFOLIA;
    }
  }

  function persistModalMode(mode) {
    try {
      window.localStorage.setItem(MODAL_MODE_KEY, cleanupModalMode(mode));
    } catch (error) {
      console.warn("[CCF] failed to persist modal mode", error);
    }
  }

  function getRoll20Editor() {
    return document.getElementById("ccf-roll20-editor");
  }

  function getRoll20Preview() {
    return document.getElementById("ccf-roll20-preview");
  }

  function getRoll20Status() {
    return document.getElementById("ccf-roll20-status");
  }

  function getImageTool() {
    return document.getElementById("ccf-image-tool");
  }

  function getCodeTool() {
    return document.getElementById("ccf-code-tool");
  }

  function getStyleClipboardTool() {
    return document.getElementById("ccf-style-clipboard-tool");
  }

  function getRubyTool() {
    return document.getElementById("ccf-ruby-tool");
  }

  function getTooltipTool() {
    return document.getElementById("ccf-tooltip-tool");
  }

  function getCodeBackdrop() {
    return document.getElementById("ccf-code-backdrop");
  }

  function getStyleClipboardBackdrop() {
    return document.getElementById("ccf-style-clipboard-backdrop");
  }

  function getRubyBackdrop() {
    return document.getElementById("ccf-ruby-backdrop");
  }

  function getTooltipBackdrop() {
    return document.getElementById("ccf-tooltip-backdrop");
  }

  function getCodeToolbox() {
    return document.getElementById("ccf-code-toolbox");
  }

  function getStyleClipboardToolbox() {
    return document.getElementById("ccf-style-clipboard-toolbox");
  }

  function getRubyToolbox() {
    return document.getElementById("ccf-ruby-toolbox");
  }

  function getTooltipToolbox() {
    return document.getElementById("ccf-tooltip-toolbox");
  }

  function getCodeToggle() {
    return document.getElementById("ccf-code-toggle");
  }

  function getStyleClipboardToggle() {
    return document.getElementById("ccf-style-clipboard-toggle");
  }

  function getRubyToggle() {
    return document.getElementById("ccf-ruby-toggle");
  }

  function getTooltipToggle() {
    return document.getElementById("ccf-tooltip-toggle");
  }

  function getCodeInput() {
    return document.getElementById("ccf-code-input");
  }

  function getRubyInput() {
    return document.getElementById("ccf-ruby-input");
  }

  function getTooltipInput() {
    return document.getElementById("ccf-tooltip-input");
  }

  function getCodeNote() {
    return document.getElementById("ccf-code-note");
  }

  function getImageToolbox() {
    return document.getElementById("ccf-image-toolbox");
  }

  function getImagePopoverToggle() {
    return document.getElementById("ccf-image-popover-toggle");
  }

  function getImageFileInput() {
    return document.getElementById("ccf-image-file");
  }

  function getImageFilePathInput() {
    return document.getElementById("ccf-image-file-path");
  }

  function getImageUrlInput() {
    return document.getElementById("ccf-image-url");
  }

  function getImageStatus() {
    return document.getElementById("ccf-image-status");
  }

  function isCcfModalMode() {
    return cleanupModalMode(modalMode) === MODAL_MODE_CCFOLIA;
  }

  function isImagePopoverOpen() {
    return getImageTool()?.classList.contains("open") || false;
  }

  function isCodePopoverOpen() {
    return getCodeTool()?.classList.contains("open") || false;
  }

  function isStyleClipboardPopoverOpen() {
    return getStyleClipboardTool()?.classList.contains("open") || false;
  }

  function isRubyPopoverOpen() {
    return getRubyTool()?.classList.contains("open") || false;
  }

  function isTooltipPopoverOpen() {
    return getTooltipTool()?.classList.contains("open") || false;
  }

  function cancelImagePopoverLayoutFrame() {
    if (!imagePopoverLayoutFrame) return;
    cancelAnimationFrame(imagePopoverLayoutFrame);
    imagePopoverLayoutFrame = 0;
  }

  function positionImagePopover() {
    const toggle = getImagePopoverToggle();
    const toolbox = getImageToolbox();
    if (!toggle || !toolbox || !isImagePopoverOpen()) return;

    const viewportMargin = IMAGE_POPOVER_VIEWPORT_MARGIN;
    const gap = IMAGE_POPOVER_GAP;
    const toggleRect = toggle.getBoundingClientRect();
    const width = Math.min(
      IMAGE_POPOVER_DEFAULT_WIDTH,
      Math.max(160, window.innerWidth - (viewportMargin * 2))
    );

    toolbox.style.width = `${Math.round(width)}px`;

    const measuredRect = toolbox.getBoundingClientRect();
    const maxLeft = Math.max(viewportMargin, window.innerWidth - measuredRect.width - viewportMargin);
    const left = clamp(toggleRect.right - measuredRect.width, viewportMargin, maxLeft);

    let top = toggleRect.bottom + gap;
    const maxTop = Math.max(viewportMargin, window.innerHeight - measuredRect.height - viewportMargin);
    if (top > maxTop) {
      top = Math.max(viewportMargin, toggleRect.top - measuredRect.height - gap);
    }

    toolbox.style.left = `${Math.round(left)}px`;
    toolbox.style.top = `${Math.round(clamp(top, viewportMargin, maxTop))}px`;
  }

  function scheduleImagePopoverPosition() {
    if (!isImagePopoverOpen()) return;
    cancelImagePopoverLayoutFrame();
    imagePopoverLayoutFrame = requestAnimationFrame(() => {
      imagePopoverLayoutFrame = 0;
      positionImagePopover();
    });
  }

  function setImagePopoverOpen(open, options = {}) {
    const imageTool = getImageTool();
    const toolbox = getImageToolbox();
    const toggle = getImagePopoverToggle();
    if (!imageTool || !toolbox || !toggle) return;

    const wasOpen = imageTool.classList.contains("open");
    const nextOpen = !!open && isCcfModalMode();
    imageTool.classList.toggle("open", nextOpen);
    toolbox.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");

    if (!nextOpen) {
      cancelImagePopoverLayoutFrame();
      modalImageDragDepth = 0;
      toolbox.classList.remove("dragover");
      toolbox.style.left = "";
      toolbox.style.top = "";
      toolbox.style.width = "";
      if (options.focusToggle) {
        toggle.focus({ preventScroll: true });
      }
      return;
    }

    if (!wasOpen) {
      clearImagePopoverInputs();
    }

    scheduleImagePopoverPosition();

    if (options.focusUrl) {
      requestAnimationFrame(() => {
        getImageUrlInput()?.focus({ preventScroll: true });
      });
    }
  }

  function toggleImagePopover(options = {}) {
    setImagePopoverOpen(!isImagePopoverOpen(), options);
  }

  function setCodePopoverOpen(open, options = {}) {
    const codeTool = getCodeTool();
    const backdrop = getCodeBackdrop();
    const toolbox = getCodeToolbox();
    const toggle = getCodeToggle();
    if (!codeTool || !backdrop || !toolbox || !toggle) return;

    const nextOpen = !!open && isCcfModalMode();
    codeTool.classList.toggle("open", nextOpen);
    backdrop.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toolbox.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");

    if (!nextOpen) {
      updateCodePopoverMessage();
      if (options.focusToggle) {
        toggle.focus({ preventScroll: true });
      }
      return;
    }

    setRubyPopoverOpen(false);
    setTooltipPopoverOpen(false);
    setStyleClipboardPopoverOpen(false);
    setImagePopoverOpen(false);

    const selectedText = options.prefillSelection ? populateCodeInputFromSelection() : getSelectedCodeDraftText();
    if (!options.prefillSelection) {
      updateCodePopoverMessage(selectedText);
    }

    if (options.focusInput) {
      requestAnimationFrame(() => {
        const input = getCodeInput();
        if (!input) return;
        input.focus({ preventScroll: true });
        if (selectedText) {
          input.setSelectionRange(0, input.value.length);
        } else {
          const offset = input.value.length;
          input.setSelectionRange(offset, offset);
        }
      });
    }
  }

  function setStyleClipboardPopoverOpen(open, options = {}) {
    const tool = getStyleClipboardTool();
    const backdrop = getStyleClipboardBackdrop();
    const toolbox = getStyleClipboardToolbox();
    const toggle = getStyleClipboardToggle();
    if (!tool || !backdrop || !toolbox || !toggle) return;

    const nextOpen = !!open && isCcfModalMode();
    tool.classList.toggle("open", nextOpen);
    backdrop.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toolbox.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");

    if (!nextOpen) {
      if (options.focusToggle) {
        toggle.focus({ preventScroll: true });
      }
      return;
    }

    setRubyPopoverOpen(false);
    setTooltipPopoverOpen(false);
    setCodePopoverOpen(false);
    setImagePopoverOpen(false);
    const note = document.getElementById("ccf-style-clipboard-note");
    if (note) {
      note.textContent = readStyleClipboard()
        ? "\uC800\uC7A5\uB41C \uC11C\uC2DD\uC744 \uD604\uC7AC \uC120\uD0DD \uC601\uC5ED\uC5D0 \uBD88\uB7EC\uC62C \uC218 \uC788\uC2B5\uB2C8\uB2E4."
        : "\uC120\uD0DD \uD14D\uC2A4\uD2B8\uC758 \uC11C\uC2DD\uC744 \uBA3C\uC800 \uC800\uC7A5\uD574 \uC8FC\uC138\uC694.";
    }
    const load = document.getElementById("ccf-style-clipboard-load");
    if (load instanceof HTMLButtonElement) {
      load.disabled = !readStyleClipboard();
    }
  }

  function setRubyPopoverOpen(open, options = {}) {
    const rubyTool = getRubyTool();
    const backdrop = getRubyBackdrop();
    const toolbox = getRubyToolbox();
    const toggle = getRubyToggle();
    if (!rubyTool || !backdrop || !toolbox || !toggle) return;

    const nextOpen = !!open && isCcfModalMode();
    rubyTool.classList.toggle("open", nextOpen);
    backdrop.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toolbox.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");

    if (!nextOpen) {
      if (options.focusToggle) {
        toggle.focus({ preventScroll: true });
      }
      return;
    }

    setTooltipPopoverOpen(false);
    setCodePopoverOpen(false);
    setStyleClipboardPopoverOpen(false);
    setImagePopoverOpen(false);

    if (options.focusInput) {
      requestAnimationFrame(() => {
        const input = getRubyInput();
        if (!input) return;
        input.focus({ preventScroll: true });
        input.select?.();
      });
    }
  }

  function setTooltipPopoverOpen(open, options = {}) {
    const tooltipTool = getTooltipTool();
    const backdrop = getTooltipBackdrop();
    const toolbox = getTooltipToolbox();
    const toggle = getTooltipToggle();
    if (!tooltipTool || !backdrop || !toolbox || !toggle) return;

    const nextOpen = !!open && isCcfModalMode();
    tooltipTool.classList.toggle("open", nextOpen);
    backdrop.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toolbox.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    toggle.setAttribute("aria-expanded", nextOpen ? "true" : "false");

    if (!nextOpen) {
      if (options.focusToggle) {
        toggle.focus({ preventScroll: true });
      }
      return;
    }

    setRubyPopoverOpen(false);
    setCodePopoverOpen(false);
    setStyleClipboardPopoverOpen(false);
    setImagePopoverOpen(false);

    if (options.focusInput) {
      requestAnimationFrame(() => {
        const input = getTooltipInput();
        if (!input) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange?.(0, input.value.length);
      });
    }
  }

  function setImageStatus(message, state = "idle") {
    const status = getImageStatus();
    if (!status) return;
    status.textContent = message || "";
    status.dataset.state = state;
  }

  function clearImagePopoverInputs() {
    const fileInput = getImageFileInput();
    const filePathInput = getImageFilePathInput();
    const urlInput = getImageUrlInput();

    if (fileInput) {
      fileInput.value = "";
    }
    if (filePathInput) {
      filePathInput.value = "";
      filePathInput.title = "";
    }
    if (urlInput) {
      urlInput.value = "";
    }
  }

  function getImageFileDisplayValue(files, rawValue = "") {
    const imageFiles = getImageFilesFromFileList(files);
    if (!imageFiles.length) return "";

    const trimmedRaw = typeof rawValue === "string" ? rawValue.trim() : "";
    if (imageFiles.length === 1 && trimmedRaw) {
      return trimmedRaw;
    }

    if (imageFiles.length === 1) {
      return imageFiles[0].name || "image";
    }

    const firstName = imageFiles[0].name || "image";
    return `${firstName} 외 ${imageFiles.length - 1}개`;
  }

  function setImageFilePathDisplay(files = null, rawValue = "") {
    const input = getImageFilePathInput();
    if (!input) return;

    const displayValue = Array.isArray(files) || files instanceof FileList
      ? getImageFileDisplayValue(files, rawValue)
      : String(rawValue || "").trim();

    input.value = displayValue;
    input.title = displayValue;
  }

  function resetImageToolboxState() {
    setImagePopoverOpen(false);
    clearImagePopoverInputs();
    modalImageDragDepth = 0;
    getImageToolbox()?.classList.remove("dragover");
    setImageStatus("이미지 링크를 입력하면 바로 추가할 수 있습니다.", "idle");
  }

  function resetCodeToolboxState() {
    const input = getCodeInput();
    if (input) {
      input.value = "";
    }
    setCodePopoverOpen(false);
    updateCodePopoverMessage("");
  }

  function resetRubyToolboxState() {
    const input = getRubyInput();
    if (input) {
      input.value = "";
    }
    setRubyPopoverOpen(false);
  }

  function resetTooltipToolboxState() {
    const input = getTooltipInput();
    if (input) {
      input.value = "";
    }
    setTooltipPopoverOpen(false);
  }

  function setImageDragHighlight(active) {
    getImageToolbox()?.classList.toggle("dragover", !!active);
  }

  function isImageFile(file) {
    if (!(file instanceof File)) return false;
    return /^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name || "");
  }

  function getImageFilesFromFileList(files) {
    return [...(files || [])].filter((file) => isImageFile(file));
  }

  function getClipboardImageFiles(event) {
    const items = [...(event?.clipboardData?.items || [])];
    const files = items
      .filter((item) => item?.kind === "file" && /^image\//i.test(item.type || ""))
      .map((item) => item.getAsFile())
      .filter((file) => isImageFile(file));

    if (files.length) return files;
    return getImageFilesFromFileList(event?.clipboardData?.files);
  }

  function normalizeClipboardImageUrlText(value) {
    if (typeof value !== "string" || !value.trim()) return "";

    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    for (const line of lines) {
      const normalized = normalizeImageUrl(line);
      if (/^https?:\/\//i.test(normalized)) {
        return normalized;
      }
    }

    return "";
  }

  function looksLikeClipboardImageUrl(value) {
    const normalized = normalizeImageUrl(value);
    if (!/^https?:\/\//i.test(normalized)) return false;

    try {
      const parsed = new URL(normalized);
      const pathname = decodeURIComponent(parsed.pathname || "").toLowerCase();
      if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)(?:$|[/.])/i.test(pathname)) {
        return true;
      }

      const extra = `${parsed.search} ${parsed.hash}`.toLowerCase();
      return /(?:format|fm|ext|mime|type)=(png|jpe?g|gif|webp|bmp|svg|avif)\b/.test(extra);
    } catch (error) {
      return false;
    }
  }

  function getFirstSrcFromSrcset(value) {
    if (typeof value !== "string" || !value.trim()) return "";

    const firstCandidate = value
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0] || "")
      .find(Boolean);

    return normalizeClipboardImageUrlText(firstCandidate || "");
  }

  function extractClipboardImagePayloadFromHtml(html) {
    if (typeof html !== "string" || !html.trim()) return null;

    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const imageNode = doc.querySelector("img[src], img[srcset], source[src], source[srcset]");
      if (imageNode instanceof Element) {
        const imageUrl =
          normalizeClipboardImageUrlText(imageNode.getAttribute("src") || "") ||
          getFirstSrcFromSrcset(imageNode.getAttribute("srcset") || "");

        if (imageUrl) {
          const rawAlt =
            imageNode.getAttribute("alt") ||
            imageNode.getAttribute("title") ||
            "";
          const imageAlt = normalizeImageAlt(rawAlt) || getImageAltFromUrl(imageUrl);
          return { imageUrl, imageAlt };
        }
      }

      const linkedImage = doc.querySelector('a[href]');
      if (linkedImage instanceof Element) {
        const imageUrl = normalizeClipboardImageUrlText(linkedImage.getAttribute("href") || "");
        if (imageUrl && looksLikeClipboardImageUrl(imageUrl)) {
          return {
            imageUrl,
            imageAlt: getImageAltFromUrl(imageUrl)
          };
        }
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function extractClipboardImagePayload(event) {
    const clipboard = event?.clipboardData;
    if (!clipboard) return null;

    const uriListUrl = normalizeClipboardImageUrlText(clipboard.getData("text/uri-list"));
    if (uriListUrl && looksLikeClipboardImageUrl(uriListUrl)) {
      return {
        imageUrl: uriListUrl,
        imageAlt: getImageAltFromUrl(uriListUrl)
      };
    }

    const htmlPayload = extractClipboardImagePayloadFromHtml(clipboard.getData("text/html"));
    if (htmlPayload?.imageUrl) {
      return htmlPayload;
    }

    const plainTextUrl = normalizeClipboardImageUrlText(clipboard.getData("text/plain"));
    if (plainTextUrl && looksLikeClipboardImageUrl(plainTextUrl)) {
      return {
        imageUrl: plainTextUrl,
        imageAlt: getImageAltFromUrl(plainTextUrl)
      };
    }

    return null;
  }

  function readClipboardItemString(item) {
    return new Promise((resolve) => {
      if (!item || typeof item.getAsString !== "function") {
        resolve("");
        return;
      }

      try {
        item.getAsString((value) => {
          resolve(typeof value === "string" ? value : "");
        });
      } catch (error) {
        resolve("");
      }
    });
  }

  function hasAsyncClipboardImagePayload(event) {
    const items = [...(event?.clipboardData?.items || [])];
    return items.some((item) =>
      item?.kind === "string" && ["text/html", "text/uri-list"].includes(item.type || "")
    );
  }

  async function extractClipboardImagePayloadAsync(event) {
    const immediate = extractClipboardImagePayload(event);
    if (immediate?.imageUrl) {
      return immediate;
    }

    const items = [...(event?.clipboardData?.items || [])];
    for (const item of items) {
      if (item?.kind !== "string") continue;

      if ((item.type || "") === "text/html") {
        const html = await readClipboardItemString(item);
        const payload = extractClipboardImagePayloadFromHtml(html);
        if (payload?.imageUrl) {
          return payload;
        }
      }

      if ((item.type || "") === "text/uri-list") {
        const uriList = normalizeClipboardImageUrlText(await readClipboardItemString(item));
        if (uriList && looksLikeClipboardImageUrl(uriList)) {
          return {
            imageUrl: uriList,
            imageAlt: getImageAltFromUrl(uriList)
          };
        }
      }
    }

    return null;
  }

  function getDroppedImageFiles(event) {
    return getImageFilesFromFileList(event?.dataTransfer?.files);
  }

  function ensureIfhBridgeListener() {
    if (ifhBridgeListenerBound) return;
    window.addEventListener("message", handleIfhBridgeMessage, ccfFsWithSignal());
    ifhBridgeListenerBound = true;
  }

  function handleIfhBridgeMessage(event) {
    if (event?.origin !== IFH_ORIGIN) return;

    const payload = event?.data;
    if (!payload || typeof payload !== "object") return;

    if (payload.type === IFH_BRIDGE_READY_TYPE) {
      ifhHelperReady = true;
      const resolve = ifhHelperReadyResolver;
      ifhHelperReadyResolver = null;
      ifhHelperReadyPromise = null;
      resolve?.(getIfhHelperFrame());
      return;
    }

    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    if (!requestId || !IFH_PENDING_REQUESTS.has(requestId)) return;

    const pending = IFH_PENDING_REQUESTS.get(requestId);
    IFH_PENDING_REQUESTS.delete(requestId);
    window.clearTimeout(pending.timeoutId);

    if (payload.type === IFH_BRIDGE_RESULT_TYPE) {
      pending.resolve(Array.isArray(payload.uploads) ? payload.uploads : []);
      return;
    }

    if (payload.type === IFH_BRIDGE_ERROR_TYPE) {
      pending.reject(createIfhUploadError(
        typeof payload.message === "string" && payload.message.trim()
          ? payload.message.trim()
          : "iFH 이미지 업로드에 실패했습니다.",
        typeof payload.code === "string" ? payload.code : ""
      ));
    }
  }

  function getIfhHelperFrame() {
    return document.getElementById(IFH_HELPER_FRAME_ID);
  }

  function ensureIfhHelperFrame() {
    ensureIfhBridgeListener();

    const existing = getIfhHelperFrame();
    if (ifhHelperReady && existing) {
      return Promise.resolve(existing);
    }
    if (ifhHelperReadyPromise) {
      return ifhHelperReadyPromise;
    }

    let frame = existing;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = IFH_HELPER_FRAME_ID;
      frame.tabIndex = -1;
      frame.setAttribute("aria-hidden", "true");
      frame.style.position = "fixed";
      frame.style.left = "-9999px";
      frame.style.top = "-9999px";
      frame.style.width = "1px";
      frame.style.height = "1px";
      frame.style.opacity = "0";
      frame.style.pointerEvents = "none";
      frame.style.border = "0";
      (document.body || document.documentElement).appendChild(frame);
    }

    ifhHelperReadyPromise = new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        if (ifhHelperReadyResolver) {
          ifhHelperReadyResolver = null;
          ifhHelperReadyPromise = null;
        }
        reject(createIfhUploadError("iFH 업로드 도우미를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.", "bridge-timeout"));
      }, IFH_HELPER_TIMEOUT_MS);

      ifhHelperReadyResolver = (readyFrame) => {
        window.clearTimeout(timeoutId);
        resolve(readyFrame || frame);
      };
    });

    ifhHelperReady = false;
    frame.src = IFH_HELPER_URL;

    return ifhHelperReadyPromise;
  }

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCHCnY5n9gG2bMluU_QZa4m3ua1dpBDnUM",
    authDomain: "ccfolia-handout-25c6b.firebaseapp.com",
    projectId: "ccfolia-handout-25c6b",
    storageBucket: "ccfolia-handout-25c6b.firebasestorage.app",
    messagingSenderId: "821478721514",
    appId: "1:821478721514:web:b909f3a85ea4d5a5795493"
  };
  const FIREBASE_SDK_VERSION = "10.13.2";
  const FIREBASE_APP_NAME = "ccf-handout";
  const FIRESTORE_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
  const FIRESTORE_IMAGE_CHUNK_SIZE = 120 * 1024;
  const FIRESTORE_IMAGE_MAX_DATA_URL_CHARS = 6 * 1024 * 1024;
  const FIRESTORE_IMAGE_COMPACT_TARGET_CHARS = 900 * 1024;
  const FIRESTORE_IMAGE_CACHE_LIMIT = 32;
  const FIRESTORE_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const DATA_URL_TRANSPORT_MAX_CHARS = 128 * 1024;
  const DATA_URL_IMAGE_MAX_DIMENSION = 1600;
  const DATA_URL_IMAGE_MIN_DIMENSION = 640;
  const DATA_URL_IMAGE_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62, 0.54, 0.46];
  let ccfFirebaseState = null;
  let ccfFirebaseInitPromise = null;
  const firestoreImageCache = new Map();

  function initFirebase() {
    if (ccfFirebaseState) return Promise.resolve(ccfFirebaseState);
    if (ccfFirebaseInitPromise) return ccfFirebaseInitPromise;
    ccfFirebaseInitPromise = (async () => {
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
      ]);
      const existing = appMod.getApps?.().find((app) => app.name === FIREBASE_APP_NAME);
      const app = existing || appMod.initializeApp(FIREBASE_CONFIG, FIREBASE_APP_NAME);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      const cred = auth.currentUser ? { user: auth.currentUser } : await authMod.signInAnonymously(auth);
      ccfFirebaseState = { app, auth, db, user: cred.user, uid: cred.user.uid, modules: { app: appMod, auth: authMod, fs: fsMod } };
      return ccfFirebaseState;
    })();
    ccfFirebaseInitPromise.catch(() => { ccfFirebaseInitPromise = null; });
    return ccfFirebaseInitPromise;
  }

  function createFirestoreImageId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createFirestoreImageToken(roomId, imageId) {
    return `${FIRESTORE_IMAGE_TOKEN_PREFIX}${encodeURIComponent(roomId)}/${encodeURIComponent(imageId)}`;
  }

  function splitStringIntoChunks(value, chunkSize) {
    const chunks = [];
    const text = String(value || "");
    for (let index = 0; index < text.length; index += chunkSize) {
      chunks.push(text.slice(index, index + chunkSize));
    }
    return chunks;
  }

  async function uploadImageDataUrlToFirestore(dataUrl, file) {
    const roomId = getCurrentRoomId();
    if (!roomId) {
      throw createIfhUploadError("CCFOLIA 룸 안에서만 이미지 붙여넣기를 사용할 수 있습니다.", "not-in-room");
    }
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
      throw createIfhUploadError("이미지 Data URL을 만들지 못했습니다.", "invalid-data-url");
    }
    if (dataUrl.length > FIRESTORE_IMAGE_MAX_DATA_URL_CHARS) {
      throw createIfhUploadError(
        `Firestore 저장 한계 때문에 ${Math.floor(FIRESTORE_IMAGE_MAX_DATA_URL_CHARS / 1024 / 1024)}MB 이하 이미지만 전송할 수 있습니다: ${file?.name || "image"}`,
        "file-too-large"
      );
    }

    const fb = await initFirebase();
    const { doc, setDoc, serverTimestamp } = fb.modules.fs;
    const imageId = createFirestoreImageId();
    const chunks = splitStringIntoChunks(dataUrl, FIRESTORE_IMAGE_CHUNK_SIZE);
    const metaRef = doc(fb.db, "rooms", roomId, "images", imageId);
    const mimeType = (String(dataUrl).match(/^data:([^;,]+);base64,/i) || [])[1] || file?.type || "image/png";
    const metaPayload = {
      id: imageId,
      roomId,
      ownerUid: fb.uid,
      name: String(file?.name || "image").slice(0, 160),
      mimeType,
      size: Number(file?.size || 0),
      dataUrlLength: dataUrl.length,
      chunkCount: chunks.length,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAtMs: Date.now() + FIRESTORE_IMAGE_MAX_AGE_MS
    };

    await setDoc(metaRef, { ...metaPayload, status: "uploading" });
    for (let index = 0; index < chunks.length; index += 1) {
      await setDoc(doc(fb.db, "rooms", roomId, "images", imageId, "chunks", String(index).padStart(4, "0")), {
        index,
        data: chunks[index]
      });
    }
    await setDoc(metaRef, { ...metaPayload, status: "ready", updatedAt: serverTimestamp() }, { merge: true });

    const token = createFirestoreImageToken(roomId, imageId);
    rememberFirestoreImageUrl(token, dataUrlToBlobUrl(dataUrl) || dataUrl);
    console.info("[CCF] Firestore image upload OK:", imageId, `${chunks.length} chunks`, `${dataUrl.length} chars`);
    return token;
  }

  async function resolveFirestoreImageTokenFromFirestore(token) {
    const cached = getCachedFirestoreImageUrl(token);
    if (cached) return cached;
    const parsed = parseFirestoreImageToken(token);
    if (!parsed) return "";

    const fb = await initFirebase();
    const { doc, getDoc } = fb.modules.fs;
    const metaSnap = await getDoc(doc(fb.db, "rooms", parsed.roomId, "images", parsed.imageId));
    if (!metaSnap.exists()) throw new Error("firestore-image-missing");
    const meta = metaSnap.data() || {};
    const chunkCount = Math.max(0, Math.min(200, Number(meta.chunkCount) || 0));
    if (meta.status !== "ready" || !chunkCount) throw new Error("firestore-image-not-ready");

    let dataUrl = "";
    for (let index = 0; index < chunkCount; index += 1) {
      const chunkSnap = await getDoc(doc(fb.db, "rooms", parsed.roomId, "images", parsed.imageId, "chunks", String(index).padStart(4, "0")));
      if (!chunkSnap.exists()) throw new Error("firestore-image-chunk-missing");
      dataUrl += String(chunkSnap.data()?.data || "");
    }
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) throw new Error("firestore-image-invalid");
    const blobUrl = dataUrlToBlobUrl(dataUrl) || dataUrl;
    rememberFirestoreImageUrl(token, blobUrl);
    return blobUrl;
  }

  function serializeFirestoreValue(value) {
    if (value == null || typeof value !== "object") return value;
    if (typeof value.toMillis === "function") {
      return { __type: "timestamp", millis: value.toMillis() };
    }
    if (value instanceof Date) {
      return { __type: "timestamp", millis: value.getTime() };
    }
    if (Array.isArray(value)) return value.map(serializeFirestoreValue);
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = serializeFirestoreValue(value[key]);
    });
    return out;
  }

  function deserializeBackupValue(value) {
    if (value == null || typeof value !== "object") return value;
    if (value.__type === "timestamp" && Number.isFinite(Number(value.millis))) {
      return new Date(Number(value.millis));
    }
    if (Array.isArray(value)) return value.map(deserializeBackupValue);
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = deserializeBackupValue(value[key]);
    });
    return out;
  }

  function downloadJsonFile(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }

  function getBackupTimestampLabel() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  async function readFirestoreImageRecord(fb, roomId, imageId, metaData = null) {
    const { doc, getDoc } = fb.modules.fs;
    const meta = metaData || (await getDoc(doc(fb.db, "rooms", roomId, "images", imageId))).data() || {};
    const chunkCount = Math.max(0, Math.min(200, Number(meta.chunkCount) || 0));
    const chunks = [];
    for (let index = 0; index < chunkCount; index += 1) {
      const chunkSnap = await getDoc(doc(fb.db, "rooms", roomId, "images", imageId, "chunks", String(index).padStart(4, "0")));
      chunks.push(String(chunkSnap.data()?.data || ""));
    }
    return {
      id: imageId,
      token: createFirestoreImageToken(roomId, imageId),
      meta: serializeFirestoreValue(meta),
      chunks
    };
  }

  async function backupFirestoreImages(options = {}) {
    const roomId = options.roomId || getCurrentRoomId();
    if (!roomId) throw createIfhUploadError("CCFOLIA 룸 안에서만 이미지 백업을 만들 수 있습니다.", "not-in-room");
    const fb = await initFirebase();
    const { collection, getDocs } = fb.modules.fs;
    const snap = await getDocs(collection(fb.db, "rooms", roomId, "images"));
    const now = Date.now();
    const idFilter = Array.isArray(options.imageIds) ? new Set(options.imageIds.map(String)) : null;
    const expiredOnly = options.expiredOnly === true;
    const records = [];

    for (const imageDoc of snap.docs) {
      const meta = imageDoc.data() || {};
      if (idFilter && !idFilter.has(imageDoc.id)) continue;
      if (expiredOnly && !(Number(meta.expiresAtMs || 0) > 0 && Number(meta.expiresAtMs) <= now)) continue;
      records.push(await readFirestoreImageRecord(fb, roomId, imageDoc.id, meta));
    }

    const backup = {
      type: "ccf-firestore-image-backup",
      version: 1,
      roomId,
      exportedAt: new Date().toISOString(),
      exportedByUid: fb.uid,
      expiredOnly,
      count: records.length,
      images: records
    };

    if (options.download !== false) {
      downloadJsonFile(backup, `ccf-firestore-images-${roomId}-${getBackupTimestampLabel()}.json`);
    }
    return backup;
  }

  async function deleteFirestoreImageRecord(fb, roomId, imageId) {
    const { collection, getDocs, doc, deleteDoc } = fb.modules.fs;
    const chunksSnap = await getDocs(collection(fb.db, "rooms", roomId, "images", imageId, "chunks"));
    for (const chunkDoc of chunksSnap.docs) {
      await deleteDoc(chunkDoc.ref);
    }
    await deleteDoc(doc(fb.db, "rooms", roomId, "images", imageId));
  }

  async function backupAndCleanupFirestoreImages(options = {}) {
    const backup = await backupFirestoreImages({ ...options, expiredOnly: options.expiredOnly !== false, download: options.download !== false });
    if (!backup.images.length) return { backup, deleted: 0 };
    if (options.deleteAfterBackup === false) return { backup, deleted: 0 };

    if (options.skipConfirm !== true) {
      const ok = window.confirm(`백업 JSON 다운로드를 시작했습니다. Firestore 이미지 ${backup.images.length}개를 삭제할까요? 삭제 후에는 백업 파일로만 복원할 수 있습니다.`);
      if (!ok) return { backup, deleted: 0, cancelled: true };
    }

    const fb = await initFirebase();
    let deleted = 0;
    for (const image of backup.images) {
      await deleteFirestoreImageRecord(fb, backup.roomId, image.id);
      deleted += 1;
    }
    console.info("[CCF] Firestore image backup+cleanup OK:", `${deleted} images deleted`);
    return { backup, deleted };
  }

  async function restoreFirestoreImageBackup(backup, options = {}) {
    if (!backup || backup.type !== "ccf-firestore-image-backup" || !Array.isArray(backup.images)) {
      throw new Error("invalid-firestore-image-backup");
    }
    const roomId = options.roomId || backup.roomId || getCurrentRoomId();
    if (!roomId) throw createIfhUploadError("복원할 CCFOLIA 룸을 찾지 못했습니다.", "not-in-room");
    const fb = await initFirebase();
    const { doc, setDoc, serverTimestamp } = fb.modules.fs;
    let restored = 0;

    for (const image of backup.images) {
      const imageId = String(image.id || "");
      const chunks = Array.isArray(image.chunks) ? image.chunks.map(String) : [];
      if (!imageId || !chunks.length) continue;
      const meta = deserializeBackupValue(image.meta || {});
      const metaRef = doc(fb.db, "rooms", roomId, "images", imageId);
      await setDoc(metaRef, {
        ...meta,
        id: imageId,
        roomId,
        chunkCount: chunks.length,
        status: "uploading",
        restoredAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      for (let index = 0; index < chunks.length; index += 1) {
        await setDoc(doc(fb.db, "rooms", roomId, "images", imageId, "chunks", String(index).padStart(4, "0")), {
          index,
          data: chunks[index]
        });
      }
      await setDoc(metaRef, { status: "ready", updatedAt: serverTimestamp() }, { merge: true });
      restored += 1;
    }
    console.info("[CCF] Firestore image restore OK:", `${restored} images restored`);
    return { restored, roomId };
  }

  function readJsonFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result || "")));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error || new Error("file-read-failed"));
      reader.readAsText(file);
    });
  }

  function pickJsonFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.style.display = "none";
      input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 1000);
    });
  }

  async function restoreFirestoreImageBackupFromFile(options = {}) {
    const file = await pickJsonFile();
    if (!file) return { restored: 0, roomId: options.roomId || getCurrentRoomId() };
    return restoreFirestoreImageBackup(await readJsonFile(file), options);
  }

  window.__CCF_FORMAT_SYNC_IMAGE_STORE__ = {
    peek: getCachedFirestoreImageUrl,
    resolve: resolveFirestoreImageTokenFromFirestore,
    backup: backupFirestoreImages,
    backupAndCleanup: backupAndCleanupFirestoreImages,
    backupExpiredAndCleanup: () => backupAndCleanupFirestoreImages({ expiredOnly: true, deleteAfterBackup: true }),
    restore: restoreFirestoreImageBackup,
    restoreFromFile: restoreFirestoreImageBackupFromFile
  };
  window.__CCF_FORMAT_SYNC_IMAGES__ = {
    backup: backupFirestoreImages,
    cleanupExpiredWithBackup: () => backupAndCleanupFirestoreImages({ expiredOnly: true, deleteAfterBackup: true }),
    restoreFromFile: restoreFirestoreImageBackupFromFile
  };

  async function uploadImageFilesToIfh(files) {
    const imageFiles = getImageFilesFromFileList(files);
    if (!imageFiles.length) return [];

    const oversizedFile = imageFiles.find((file) => Number(file.size) > FIRESTORE_IMAGE_MAX_SOURCE_BYTES);
    if (oversizedFile) {
      throw createIfhUploadError(
        `Firestore 이미지 저장은 8MB 이하 이미지만 처리할 수 있습니다: ${oversizedFile.name || "image"}`,
        "file-too-large"
      );
    }

    const uploads = [];
    for (const file of imageFiles) {
      try {
        const imageUrl = await uploadImageDataUrlToFirestore(await readCompactImageAsDataUrl(file), file);
        uploads.push({ imageUrl });
      } catch (error) {
        if (error?.code) throw error;
        console.warn("[CCF] Firestore image upload failed:", error);
        throw createIfhUploadError(
          "이미지를 Firestore에 저장하지 못했습니다. Firestore 규칙과 네트워크 상태를 확인해주세요.",
          "firestore-upload-failed"
        );
      }
    }
    return uploads;
  }

  function maybeOpenIfhHelpPage(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    if (!["auth-required", "captcha-required"].includes(code)) return;

    const prompt = code === "auth-required"
      ? "iFH 로그인이 필요합니다. 새 탭에서 iFH를 열어 로그인할까요?"
      : "iFH에서 CAPTCHA 확인이 필요합니다. 새 탭에서 iFH 업로드 페이지를 열까요?";

    if (window.confirm(prompt)) {
      window.open(`${IFH_ORIGIN}/ko`, "_blank", "noopener,noreferrer");
    }
  }

  function hasFileTransfer(dataTransfer) {
    return !!dataTransfer && [...(dataTransfer.types || [])].includes("Files");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!isImageFile(file)) {
        reject(new Error("not-image"));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const result = normalizeImageUrl(typeof reader.result === "string" ? reader.result : "");
        if (!result) {
          reject(new Error("invalid-image"));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => {
        reject(reader.error || new Error("read-failed"));
      };
      reader.readAsDataURL(file);
    });
  }

  function createImageBitmapFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("image-decode-failed"));
      };
      img.src = objectUrl;
    });
  }

  function getScaledImageSize(width, height, maxDimension) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const safeMax = Math.max(1, Number(maxDimension) || DATA_URL_IMAGE_MAX_DIMENSION);
    const scale = Math.min(1, safeMax / Math.max(safeWidth, safeHeight));
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale))
    };
  }

  function canvasToDataUrl(canvas, mimeType, quality) {
    try {
      return normalizeImageUrl(canvas.toDataURL(mimeType, quality));
    } catch (error) {
      console.warn("[CCF] canvas image export failed", error);
      return "";
    }
  }

  async function compressRasterImageToDataUrl(file, options = {}) {
    const image = await createImageBitmapFromFile(file);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("canvas-context-failed");
    }

    const targetChars = Math.max(1, Number(options.targetChars) || DATA_URL_TRANSPORT_MAX_CHARS);
    const maxDimensionStart = Math.max(DATA_URL_IMAGE_MIN_DIMENSION, Number(options.maxDimension) || DATA_URL_IMAGE_MAX_DIMENSION);
    const sourceType = String(file?.type || "").toLowerCase();
    const preferPng = sourceType === "image/png" && Number(file?.size || 0) <= targetChars;
    const mimeType = preferPng ? "image/png" : "image/webp";

    for (let maxDimension = maxDimensionStart; maxDimension >= DATA_URL_IMAGE_MIN_DIMENSION; maxDimension = Math.floor(maxDimension * 0.75)) {
      const size = getScaledImageSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxDimension);
      canvas.width = size.width;
      canvas.height = size.height;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      if (preferPng) {
        const pngUrl = canvasToDataUrl(canvas, "image/png");
        if (pngUrl && pngUrl.length <= targetChars) {
          return pngUrl;
        }
      }

      for (const quality of DATA_URL_IMAGE_QUALITY_STEPS) {
        const dataUrl = canvasToDataUrl(canvas, mimeType, quality);
        if (dataUrl && dataUrl.length <= targetChars) {
          return dataUrl;
        }
      }
    }

    throw createIfhUploadError(
      `자동 압축 후에도 ${Math.floor(targetChars / 1024)}KB 이하로 줄이지 못했습니다. 이미지를 더 작게 잘라주세요: ${file.name || "image"}`,
      "data-url-too-large"
    );
  }

  function canCompressImageFile(file) {
    const type = String(file?.type || "").toLowerCase();
    const name = String(file?.name || "").toLowerCase();
    return /^(image\/png|image\/jpe?g|image\/webp|image\/bmp|image\/avif)$/i.test(type)
      || /\.(png|jpe?g|webp|bmp|avif)$/i.test(name);
  }

  async function readCompactImageAsDataUrl(file) {
    const rawUrl = await readFileAsDataUrl(file);
    if (!canCompressImageFile(file) || rawUrl.length <= FIRESTORE_IMAGE_COMPACT_TARGET_CHARS) {
      return rawUrl;
    }

    try {
      const compactUrl = await compressRasterImageToDataUrl(file, {
        targetChars: FIRESTORE_IMAGE_COMPACT_TARGET_CHARS,
        maxDimension: DATA_URL_IMAGE_MAX_DIMENSION
      });
      return compactUrl.length < rawUrl.length ? compactUrl : rawUrl;
    } catch (error) {
      if (rawUrl.length <= FIRESTORE_IMAGE_MAX_DATA_URL_CHARS) {
        console.warn("[CCF] image compact failed; storing raw image", error);
        return rawUrl;
      }
      throw error;
    }
  }

  async function readCompressedImageAsDataUrl(file) {
    if (canCompressImageFile(file)) {
      try {
        return await compressRasterImageToDataUrl(file, { targetChars: DATA_URL_TRANSPORT_MAX_CHARS });
      } catch (error) {
        if (error?.code === "data-url-too-large") throw error;
        console.warn("[CCF] image compression failed; fallback to raw Data URL", error);
      }
    }

    const rawUrl = await readFileAsDataUrl(file);
    if (rawUrl.length > DATA_URL_TRANSPORT_MAX_CHARS) {
      throw createIfhUploadError(
        `채팅 동기화 한계 때문에 ${Math.floor(DATA_URL_TRANSPORT_MAX_CHARS / 1024)}KB 이하 Data URL만 전송할 수 있습니다. 이미지를 더 작게 줄여주세요: ${file.name || "image"}`,
        "data-url-too-large"
      );
    }
    return rawUrl;
  }

  function getImageAltFromFile(file) {
    const name = typeof file?.name === "string" ? file.name.replace(/\.[^.]+$/, "") : "";
    return normalizeImageAlt(name) || "이미지";
  }

  function getImageAltFromUrl(url) {
    const normalized = normalizeImageUrl(url);
    if (!normalized || /^data:/i.test(normalized)) return "이미지";

    try {
      const parsed = new URL(normalized);
      const lastPath = decodeURIComponent(parsed.pathname.split("/").pop() || "");
      const label = lastPath.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      return normalizeImageAlt(label) || "이미지";
    } catch (error) {
      return "이미지";
    }
  }

  function getImagePlaceholderText(label) {
    const normalized = normalizeImageAlt(label) || "이미지";
    return normalized.slice(0, 80) || "이미지";
  }

  function insertTextIntoDraft(insertText, insertedRuns = [], selectionOverride = null, options = {}) {
    const editor = getResolvedActiveEditor() || activeEditor;
    if (!editor) return false;

    const baseText = typeof modalDraftText === "string" ? modalDraftText : stripInvisibleEnvelope(getEditorText(editor));
    const baseRuns = cloneRuns(modalDraftRuns ?? ensureEditorState(editor).runs, baseText.length);
    const baseAlignRuns = cloneAlignRuns(
      modalDraftAlignRuns ?? ensureEditorState(editor).alignRuns,
      getTextLineCount(baseText)
    );
    const fallbackSelection = { start: baseText.length, end: baseText.length };
    const selection = normalizeSelectionRange(
      selectionOverride || getModalSelection() || getEditorSelection(getModalEditor()) || fallbackSelection,
      baseText.length
    ) || fallbackSelection;

    const nextText = `${baseText.slice(0, selection.start)}${insertText}${baseText.slice(selection.end)}`;
    const nextRuns = rebaseRunsForTextReplacement(
      baseRuns,
      selection,
      insertText,
      baseText.length,
      nextText.length,
      insertedRuns
    );
    const nextAlignRuns = rebaseAlignRunsForTextReplacement(
      baseAlignRuns,
      baseText,
      selection,
      insertText,
      nextText
    );
    const nextSelection = {
      start: selection.start + insertText.length,
      end: selection.start + insertText.length
    };

    modalDraftText = nextText;
    modalDraftRuns = nextRuns;
    modalDraftAlignRuns = nextAlignRuns;
    setModalSelection(nextSelection, nextText.length);
    syncRoomEditorToModalEditor(editor);
    renderPreview(editor, {
      force: true,
      selection: nextSelection,
      restoreSelection: true,
      textOverride: nextText,
      runsOverride: nextRuns,
      alignRunsOverride: nextAlignRuns
    });

    requestAnimationFrame(() => {
      const modalEditor = getModalEditor();
      if (!modalEditor) return;

      if (options.revealBottom === true) {
        modalEditor.scrollTop = modalEditor.scrollHeight;
        if (editor instanceof HTMLElement) {
          editor.scrollTop = editor.scrollHeight;
        }
      }

      if (options.restoreFocus === false) {
        if (document.activeElement === modalEditor) {
          restoreModalSelectionSoon();
        }
        return;
      }

      modalEditor.focus({ preventScroll: true });
      restoreModalSelectionSoon();
    });

    return true;
  }

  function insertImageIntoDraft(imageUrl, imageAlt = "", options = {}) {
    const normalizedUrl = prepareImageUrlForTransport(imageUrl);
    if (!normalizedUrl) {
      setImageStatus("이미지가 너무 크거나 브라우저 저장 공간이 부족해서 추가할 수 없습니다. 이미지 링크를 사용하거나 이미지를 줄여주세요.", "error");
      return false;
    }

    const editor = getResolvedActiveEditor() || activeEditor;
    if (!editor) return false;

    const baseText = typeof modalDraftText === "string" ? modalDraftText : stripInvisibleEnvelope(getEditorText(editor));
    const selection = normalizeSelectionRange(
      getModalSelection() || getEditorSelection(getModalEditor()) || { start: baseText.length, end: baseText.length },
      baseText.length
    ) || { start: baseText.length, end: baseText.length };
    const placeholderText = getImagePlaceholderText(imageAlt);

    const success = insertTextIntoDraft(placeholderText, [{
      start: selection.start,
      end: selection.start + placeholderText.length,
      style: {
        imageUrl: normalizedUrl,
        imageAlt: normalizeImageAlt(imageAlt) || placeholderText
      }
    }], selection, {
      ...options,
      revealBottom: selection.end >= baseText.length
    });

    if (success) {
      setImageStatus("이미지를 추가했습니다.", "success");
    }
    return success;
  }

  async function insertImageFiles(files, options = {}) {
    const imageFiles = getImageFilesFromFileList(files);
    const fileInput = getImageFileInput();
    if (fileInput) {
      fileInput.value = "";
    }

    if (!imageFiles.length) {
      setImageStatus("이미지 파일만 추가할 수 있습니다.", "error");
      return false;
    }

    const displayValue = String(options.displayValue || "").trim();
    if (displayValue) {
      setImageFilePathDisplay(null, displayValue);
    }

    let inserted = 0;
    for (const file of imageFiles) {
      try {
        const imageUrl = await readFileAsDataUrl(file);
        if (insertImageIntoDraft(imageUrl, getImageAltFromFile(file))) {
          inserted += 1;
        }
      } catch (error) {
        console.warn("[CCF] failed to read image file", error);
      }
    }

    if (!inserted) {
      setImageStatus("이미지 파일을 읽지 못했습니다.", "error");
      return false;
    }

    setImageStatus(
      inserted === 1
        ? "이미지를 추가했습니다. 로컬 이미지는 작은 파일일수록 전송이 안정적입니다."
        : `${inserted}개의 이미지를 추가했습니다. 로컬 이미지는 작은 파일일수록 전송이 안정적입니다.`,
      "success"
    );
    return true;
  }

  async function insertImageFilesViaIfh(files, options = {}) {
    const imageFiles = getImageFilesFromFileList(files);
    const modalEditor = getModalEditor();
    const preserveKeyboardMode = document.activeElement === modalEditor;
    const fileInput = getImageFileInput();
    if (fileInput) {
      fileInput.value = "";
    }

    if (!imageFiles.length) {
      setImageStatus("이미지 파일만 추가할 수 있습니다.", "error");
      return false;
    }

    const displayValue = String(options.displayValue || "").trim();
    if (displayValue) {
      setImageFilePathDisplay(null, displayValue);
    }

    setImageStatus(
      imageFiles.length === 1
        ? "iFH에 이미지를 업로드하는 중입니다. 잠시만 기다려주세요."
        : `iFH에 ${imageFiles.length}개의 이미지를 업로드하는 중입니다. 잠시만 기다려주세요.`,
      "idle"
    );

    let uploads;
    try {
      uploads = await uploadImageFilesToIfh(imageFiles);
    } catch (error) {
      console.warn("[CCF] failed to convert image file to Data URL", error);
      setImageStatus(getIfhUploadErrorMessage(error), "error");
      maybeOpenIfhHelpPage(error);
      return false;
    }

    let inserted = 0;
    for (let index = 0; index < imageFiles.length; index += 1) {
      const file = imageFiles[index];
      const uploaded = uploads[index];
      const imageUrl = normalizeImageUrl(uploaded?.imageUrl || "");
      if (!imageUrl) continue;
      if (insertImageIntoDraft(imageUrl, getImageAltFromFile(file), {
        restoreFocus: !preserveKeyboardMode
      })) {
        inserted += 1;
      }
    }

    if (!inserted) {
      setImageStatus("이미지를 읽었지만 삽입할 Data URL을 찾지 못했습니다.", "error");
      return false;
    }

    setImageStatus(
      inserted === 1
        ? "이미지를 Data URL로 추가했습니다. 작은 파일일수록 전송이 안정적입니다."
        : `${inserted}개의 이미지를 Data URL로 추가했습니다. 작은 파일일수록 전송이 안정적입니다.`,
      "success"
    );
    return true;
  }

  function insertImageUrlFromInput() {
    const input = getImageUrlInput();
    const imageUrl = normalizeImageUrl(input?.value || "");
    if (!imageUrl) {
      setImageStatus("이미지 링크를 정확히 입력해주세요.", "error");
      input?.focus({ preventScroll: true });
      return false;
    }

    const inserted = insertImageIntoDraft(imageUrl, getImageAltFromUrl(imageUrl));
    if (inserted && input) {
      input.value = "";
    }
    return inserted;
  }

  function syncDraftAfterTextMutation(nextText, selection = null) {
    const prevText = typeof modalDraftText === "string" ? modalDraftText : "";
    const safeNextText = normalizeEditorText(nextText);
    const diff = getTextReplacementDiff(prevText, safeNextText);
    const baseRuns = cloneRuns(modalDraftRuns, prevText.length);
    const baseAlignRuns = cloneAlignRuns(modalDraftAlignRuns, getTextLineCount(prevText));

    modalDraftText = safeNextText;
    if (diff) {
      modalDraftRuns = rebaseRunsForTextReplacement(
        baseRuns,
        { start: diff.start, end: diff.end },
        diff.insertedText,
        prevText.length,
        safeNextText.length
      );
      modalDraftAlignRuns = rebaseAlignRunsForTextReplacement(
        baseAlignRuns,
        prevText,
        { start: diff.start, end: diff.end },
        diff.insertedText,
        safeNextText
      );
    } else {
      modalDraftRuns = normalizeRuns(baseRuns, safeNextText.length);
      modalDraftAlignRuns = normalizeAlignRuns(baseAlignRuns, getTextLineCount(safeNextText));
    }

    if (modalDraftParentheticalGray) {
      modalDraftRuns = applyParentheticalGrayRuns(modalDraftRuns, safeNextText);
    }

    if (selection) {
      setModalSelection(selection, safeNextText.length);
    }
    syncFontSizeControlsFromModalSelection();

    if (modalDraftParentheticalGray && getParentheticalRanges(safeNextText).length) {
      const editor = getResolvedActiveEditor() || activeEditor;
      if (editor) {
        renderPreview(editor, {
          force: true,
          restoreSelection: true,
          selection,
          textOverride: safeNextText,
          runsOverride: modalDraftRuns,
          alignRunsOverride: modalDraftAlignRuns
        });
      }
    }
  }

  function isRoll20EditorFocused() {
    const roll20Editor = getRoll20Editor();
    return !!roll20Editor && document.activeElement === roll20Editor;
  }

  function setRoll20Status(message, state = "idle") {
    const status = getRoll20Status();
    if (!status) return;
    status.textContent = message || "";
    status.dataset.state = state;
  }

  function setRoll20PreviewEmpty(message) {
    const preview = getRoll20Preview();
    if (!preview) return;
    preview.classList.add("is-empty");
    preview.textContent = message || "";
  }

  function renderRoll20PreviewFromDraft() {
    const preview = getRoll20Preview();
    if (!preview) return;

    const text = typeof modalDraftText === "string" ? modalDraftText : "";
    const runs = normalizeRuns(modalDraftRuns, text.length);
    const alignRuns = getEffectiveAlignRuns(text, modalDraftAlignRuns);

    if (!text) {
      setRoll20PreviewEmpty("/desc 변환 결과가 여기에 보입니다.");
      return;
    }

    preview.classList.remove("is-empty");
    renderStyledText(preview, text, runs, alignRuns);
  }

  function invalidateRoll20ConversionPreview() {
    modalDraftRoll20ConvertedSource = null;
    setRoll20Status("입력 내용을 바꿨습니다. 변환을 다시 누르면 최신 결과를 미리볼 수 있습니다.", "idle");
    setRoll20PreviewEmpty("변환 버튼을 누르면 /desc 결과가 여기에 보입니다.");
  }

  function syncModalModeUi() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const currentMode = cleanupModalMode(modalMode);
    const isRoll20 = currentMode === MODAL_MODE_ROLL20;
    modal.dataset.ccfMode = currentMode;

    const toggleBtn = modal.querySelector("#ccf-modal-mode-toggle");
    if (toggleBtn) {
      const nextModeLabel = isRoll20
        ? "코코포리아 서식 편집 모드로 전환"
        : "Roll20 CSS 매크로 모드로 전환";
      const currentModeLabel = isRoll20 ? "현재 모드: Roll20 CSS 매크로" : "현재 모드: 코코포리아 서식 편집";
      toggleBtn.setAttribute("aria-label", nextModeLabel);
      toggleBtn.setAttribute("title", `${currentModeLabel}\n클릭: ${nextModeLabel}`);
    }

    modal.querySelectorAll("[data-mode-panel]").forEach((panel) => {
      const isActive = panel.getAttribute("data-mode-panel") === currentMode;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    const convertBtn = modal.querySelector("#ccf-roll20-convert");
    if (convertBtn) {
      convertBtn.hidden = !isRoll20;
      convertBtn.setAttribute("aria-hidden", isRoll20 ? "false" : "true");
    }

    if (isRoll20) {
      setRubyPopoverOpen(false);
      setTooltipPopoverOpen(false);
      setCodePopoverOpen(false);
      setStyleClipboardPopoverOpen(false);
      setImagePopoverOpen(false);
    }
  }

  function syncModalCcfDraft() {
    const modalEditor = getModalEditor();
    if (!modalEditor) return;

    modalDraftText = getEditorText(modalEditor);
    modalDraftRuns = cloneRuns(modalDraftRuns, modalDraftText.length).filter((run) => run.end <= modalDraftText.length);
    modalDraftAlignRuns = cloneAlignRuns(modalDraftAlignRuns, getTextLineCount(modalDraftText));

    const selection = getEditorSelection(modalEditor);
    if (selection) {
      setModalSelection(selection, modalDraftText.length);
    }
    syncFontSizeControlsFromModalSelection();
  }

  function syncModalRoll20Draft() {
    const roll20Editor = getRoll20Editor();
    if (!roll20Editor) return;
    modalDraftRoll20Text = getEditorText(roll20Editor);
  }

  function setModalMode(nextMode, options = {}) {
    const mode = cleanupModalMode(nextMode);
    const { force = false, focusEditor = false } = options;
    const previousMode = cleanupModalMode(modalMode);

    if (!force && previousMode === mode) {
      syncModalModeUi();
      return;
    }

    if (force) {
      modalMode = mode;
    } else if (previousMode === MODAL_MODE_CCFOLIA) {
      syncModalCcfDraft();
      modalDraftRoll20Text = modalDraftRoll20Text ?? modalDraftText ?? "";
      modalMode = mode;
    } else {
      syncModalRoll20Draft();
      const nextSource = modalDraftRoll20Text ?? "";
      if (!nextSource) {
        modalDraftText = "";
        modalDraftRuns = [];
        modalDraftAlignRuns = [];
        modalDraftBlockStyle = {};
        modalDraftRoll20ConvertedSource = "";
        modalDraftLastStyle = null;
        resetModalStyleControls();
        setModalSelection({ start: 0, end: 0 }, 0);
      } else if (!ensureRoll20DraftConverted({ silent: true, forceRender: false })) {
        const nextText = modalDraftRoll20Text ?? "";
        modalDraftText = nextText;
        modalDraftRuns = [];
        modalDraftAlignRuns = [];
        modalDraftBlockStyle = {};
        modalDraftRoll20ConvertedSource = null;
        modalDraftLastStyle = null;
        resetModalStyleControls();
        setModalSelection({ start: nextText.length, end: nextText.length }, nextText.length);
      }
      modalMode = mode;
    }

    persistModalMode(modalMode);
    syncModalModeUi();

    if (modalMode === MODAL_MODE_ROLL20) {
      const roll20Editor = getRoll20Editor();
      const nextText = modalDraftRoll20Text ?? modalDraftText ?? "";
      if (roll20Editor && getEditorText(roll20Editor) !== nextText) {
        roll20Editor.value = nextText;
      }

      if (isModalOpen() && ensureRoll20ModalHeight()) {
        persistModalGeometry();
      }

      if (modalDraftRoll20ConvertedSource && modalDraftRoll20ConvertedSource === nextText && modalDraftText != null) {
        renderRoll20PreviewFromDraft();
        setRoll20Status("변환된 결과를 미리보고 있습니다. 내용을 수정했다면 변환을 다시 눌러주세요.", "success");
      } else if (nextText) {
        setRoll20PreviewEmpty("변환 버튼을 누르면 /desc 결과가 여기에 보입니다.");
        setRoll20Status("Roll20 명령을 붙여넣고 변환을 눌러 코코포리아용 결과를 만들 수 있습니다.", "idle");
      } else {
        setRoll20PreviewEmpty("/desc 변환 결과가 여기에 보입니다.");
        setRoll20Status("/desc 명령을 붙여넣고 변환을 누르면 미리보기가 생성됩니다.", "idle");
      }

      if (focusEditor) {
        requestAnimationFrame(() => {
          roll20Editor?.focus({ preventScroll: true });
        });
      }
      return;
    }

    const editor = getResolvedActiveEditor() || activeEditor;
    syncRoomEditorToModalEditor(editor);
    syncFontSizeControlsFromModalSelection();
    if (editor) {
      renderPreview(editor, {
        force: true,
        restoreSelection: false,
        textOverride: modalDraftText ?? getEditorText(editor),
        runsOverride: modalDraftRuns ?? ensureEditorState(editor).runs,
        alignRunsOverride: modalDraftAlignRuns ?? ensureEditorState(editor).alignRuns
      });
    }

    if (focusEditor) {
      requestAnimationFrame(() => {
        getModalEditor()?.focus({ preventScroll: true });
        restoreModalSelectionSoon();
      });
    }
  }

  function syncModalFromEditor(editor) {
    const state = ensureEditorState(editor);
    const text = stripInvisibleEnvelope(getEditorText(editor));
    state.text = text;

    resetModalStyleControls();
    resetRubyToolboxState();
    resetTooltipToolboxState();
    resetCodeToolboxState();
    setStyleClipboardPopoverOpen(false);
    resetImageToolboxState();

    modalDraftText = text;
    modalDraftRuns = cloneRuns(state.runs, text.length);
    modalDraftAlignRuns = cloneAlignRuns(state.alignRuns, getTextLineCount(text));
    modalDraftBlockStyle = cleanupBlockStyle(state.blockStyle);
    modalDraftParentheticalGray = state.parentheticalGray === true;
    modalDraftRoll20Text = text;
    modalDraftRoll20ConvertedSource = null;
    modalDraftLastStyle = state.lastStyle ? { ...state.lastStyle } : null;
    if (!text) {
      modalDraftRuns = [];
      modalDraftAlignRuns = [];
      modalDraftLastStyle = null;
    }
    const selection = getEditorSelection(editor);
    setAlignmentToggle(
      text
        ? getActiveAlignForSelection(text, modalDraftAlignRuns, selection, state.blockStyle)
        : "left"
    );
    setNarrationToggle(modalDraftBlockStyle.narration === true);
    setParentheticalGrayToggle(modalDraftParentheticalGray);
    setModalSelection(selection, text.length);
    syncRoomEditorToModalEditor(editor);
    syncRoomEditorToRoll20Editor(editor);
    syncFontSizeControlsFromModalSelection();
    renderPreview(editor, {
      textOverride: text,
      runsOverride: modalDraftRuns,
      alignRunsOverride: modalDraftAlignRuns
    });
    setModalMode(modalMode, { force: true });
  }

  function setToggle(name, on) {
    const btn = document.querySelector(`.ccf-toggle[data-toggle="${name}"]`);
    if (btn) {
      btn.classList.toggle("active", !!on);
    }
  }

  function setNarrationToggle(on) {
    const btn = document.getElementById("ccf-narration-toggle");
    if (!btn) return;
    btn.classList.toggle("active", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function setParentheticalGrayToggle(on) {
    const btn = document.getElementById("ccf-parenthetical-gray");
    if (!btn) return;
    btn.classList.toggle("active", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function setInlineParentheticalGrayToggle(editor, on) {
    const toolbar = getInlineToolbarForEditor(editor);
    const btn = toolbar?.querySelector?.('[data-inline-command="paren-gray"]');
    if (!btn) return;
    btn.classList.toggle("active", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function setAlignmentToggle(value) {
    const nextValue = value || "left";
    document.querySelectorAll(".ccf-align-toggle").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-align") === nextValue);
    });
  }

  function syncInlineToolVisuals() {
    const color = document.getElementById("ccf-color");
    const bg = document.getElementById("ccf-bgcolor");

    const colorTool = color?.closest(".ccf-color-tool");
    const bgTool = bg?.closest(".ccf-color-tool");

    if (colorTool && color) {
      colorTool.style.setProperty("--ccf-chip-color", color.value || "#ffffff");
    }

    if (bgTool && bg) {
      bgTool.style.setProperty("--ccf-chip-color", bg.value || "#000000");
    }
  }

  function resetModalStyleControls() {
    setToggle("bold", false);
    setToggle("italic", false);
    setToggle("underline", false);
    setToggle("strike", false);
    setParentheticalGrayToggle(false);
    setNarrationToggle(false);
    setAlignmentToggle("left");

    const color = document.getElementById("ccf-color");
    const bg = document.getElementById("ccf-bgcolor");

    if (color) color.value = "#ffffff";
    if (bg) bg.value = "#000000";
    setFontSizeControls("");

    syncInlineToolVisuals();
  }

  function cloneRuns(runs, textLength) {
    return normalizeRuns(runs, textLength).map((run) => ({
      start: run.start,
      end: run.end,
      style: { ...run.style }
    }));
  }

  function getStyleFromModal() {
    const color = document.getElementById("ccf-color")?.value || "#ffffff";
    const bg = document.getElementById("ccf-bgcolor")?.value || "#000000";
    const size = getFontSizeFromControls();

    return {
      bold: document.querySelector('.ccf-toggle[data-toggle="bold"]')?.classList.contains("active") || false,
      italic: document.querySelector('.ccf-toggle[data-toggle="italic"]')?.classList.contains("active") || false,
      underline: document.querySelector('.ccf-toggle[data-toggle="underline"]')?.classList.contains("active") || false,
      strike: document.querySelector('.ccf-toggle[data-toggle="strike"]')?.classList.contains("active") || false,
      color,
      backgroundColor: bg,
      fontSize: size ?? undefined
    };
  }

  function getParentheticalRanges(text) {
    const source = String(text || "");
    const stacks = { "(": [], "\uFF08": [] };
    const closingToOpening = { ")": "(", "\uFF09": "\uFF08" };
    const ranges = [];

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (Object.prototype.hasOwnProperty.call(stacks, char)) {
        stacks[char].push(index);
        continue;
      }

      const opening = closingToOpening[char];
      if (!opening || !stacks[opening].length) continue;
      const start = stacks[opening].pop();
      ranges.push({ start, end: index + 1 });
    }

    return ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  }

  function getParentheticalGrayTargetRanges(text, selection = null) {
    const ranges = getParentheticalRanges(text);
    const selected = normalizeSelectionRange(selection, text.length);
    if (!selected || selected.start === selected.end) return ranges;

    const selectedRanges = ranges.filter((range) => (
      rangesOverlap(range.start, range.end, selected.start, selected.end)
    ));
    return selectedRanges.length ? selectedRanges : ranges;
  }

  function applyParentheticalGrayRuns(existingRuns, text, selection = null) {
    return getParentheticalGrayTargetRanges(text, selection).reduce(
      (runs, range) => patchStyleRuns(runs, range, { color: PARENTHETICAL_GRAY_COLOR }, text.length),
      cloneRuns(existingRuns, text.length)
    );
  }

  function applyParentheticalGrayToEditor(editor, selection = null) {
    if (!editor) return false;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const state = ensureEditorState(editor);
    if (getParentheticalGrayTargetRanges(text, selection).length) {
      state.runs = applyParentheticalGrayRuns(state.runs, text, selection);
    }
    state.text = text;
    state.parentheticalGray = true;
    state.roll20Source = null;
    renderPreview(editor);
    refreshComposerBadge(activeComposer, editor);
    syncEditorVisualPreview(editor);
    return true;
  }

  function applyParentheticalGrayToModalDraft() {
    const editor = getResolvedActiveEditor() || activeEditor;
    const modalEditor = getModalEditor();
    if (!editor || !modalEditor) return false;

    modalDraftText = getEditorText(modalEditor);
    const selection = getModalSelection() || getEditorSelection(modalEditor);
    modalDraftParentheticalGray = true;
    if (getParentheticalGrayTargetRanges(modalDraftText, selection).length) {
      modalDraftRuns = applyParentheticalGrayRuns(
        modalDraftRuns ?? ensureEditorState(editor).runs,
        modalDraftText,
        selection
      );
      renderPreview(editor, {
        force: true,
        restoreSelection: true,
        selection,
        textOverride: modalDraftText,
        runsOverride: modalDraftRuns,
        alignRunsOverride: modalDraftAlignRuns
      });
      restoreModalSelectionSoon();
    }
    return true;
  }

  function getCurrentRoomId() {
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    return match ? match[1] : "";
  }

  function getNarratorStorageKey() {
    const roomId = getCurrentRoomId();
    return roomId ? `${NARRATOR_STORAGE_KEY_PREFIX}${roomId}` : "";
  }

  function readNarratorNameSet() {
    const key = getNarratorStorageKey();
    if (!key) return new Set();
    try {
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(raw)) return new Set();
      return new Set(raw.map(normalizeMyCharacterName).filter(Boolean));
    } catch (error) {
      console.error("[ccf-format-sync] readNarratorNameSet failed", error);
      return new Set();
    }
  }

  function writeNarratorNameSet(set) {
    const key = getNarratorStorageKey();
    if (!key) return false;
    try {
      const list = uniqueCharacterNames([...set]);
      localStorage.setItem(key, JSON.stringify(list));
      return true;
    } catch (error) {
      console.error("[ccf-format-sync] writeNarratorNameSet failed", error);
      return false;
    }
  }

  function normalizeMyCharacterName(value) {
    return String(value || "")
      .replace(CHARACTER_STATUS_TEXT_RE, "")
      .replace(/\bNO\s+TEXT\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniqueCharacterNames(names) {
    const seen = new Set();
    return names
      .map(normalizeMyCharacterName)
      .filter((name) => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
  }

  function readRoomCharacterNameStore(storageKey) {
    const roomId = getCurrentRoomId();
    if (!roomId) return [];
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return stored && Array.isArray(stored[roomId]) ? stored[roomId] : [];
    } catch (error) {
      return [];
    }
  }

  function readStoredMyCharacterOrderNames() {
    return uniqueCharacterNames(readRoomCharacterNameStore(MY_CHARACTER_ORDER_STORAGE_KEY)
      .map((key) => {
        const value = String(key || "");
        if (!value.startsWith("label:")) return "";
        return value.slice("label:".length).replace(/:\d+$/, "");
      }));
  }

  function readCachedMyCharacterNames() {
    return uniqueCharacterNames(readRoomCharacterNameStore(MY_CHARACTER_NAMES_STORAGE_KEY));
  }

  function cacheMyCharacterNames(names) {
    const roomId = getCurrentRoomId();
    const normalized = uniqueCharacterNames(names);
    if (!roomId || !normalized.length) return normalized;
    try {
      const stored = JSON.parse(localStorage.getItem(MY_CHARACTER_NAMES_STORAGE_KEY) || "{}");
      const next = stored && typeof stored === "object" ? stored : {};
      next[roomId] = normalized;
      localStorage.setItem(MY_CHARACTER_NAMES_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("[ccf-format-sync] cacheMyCharacterNames failed", error);
    }
    return normalized;
  }

  function sortNamesByMyCharacterOrder(names) {
    const normalized = uniqueCharacterNames(names);
    const storedOrder = readStoredMyCharacterOrderNames();
    if (!storedOrder.length) return normalized;

    const available = new Set(normalized);
    const ordered = storedOrder.filter((name) => available.has(name));
    const included = new Set(ordered);
    normalized.forEach((name) => {
      if (!included.has(name)) ordered.push(name);
    });
    return ordered;
  }

  function getMyCharacterPanel() {
    const titles = new Set(MY_CHARACTER_PANEL_TITLES.map(normalizeMyCharacterName));
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=\"heading\"]");
    for (const heading of headings) {
      if (!(heading instanceof HTMLElement) || !titles.has(normalizeMyCharacterName(heading.textContent))) continue;
      const panel = heading.closest(".MuiPaper-root, [role=\"dialog\"]") || heading.parentElement;
      if (panel instanceof HTMLElement && isVisible(panel)) return panel;
    }
    return null;
  }

  function getMyCharacterPanelItemName(item) {
    if (!(item instanceof HTMLElement)) return "";
    for (const selector of [".MuiListItemText-primary", "[class*=\"MuiListItemText-primary\"]", ".MuiTypography-body1"]) {
      const name = normalizeMyCharacterName(item.querySelector(selector)?.textContent || "");
      if (name) return name;
    }
    return normalizeMyCharacterName(item.textContent || "");
  }

  function readMyCharacterPanelNames(panel = getMyCharacterPanel()) {
    if (!(panel instanceof HTMLElement)) return [];
    let best = [];
    panel.querySelectorAll("ul.MuiList-root, [role=\"list\"], [role=\"listbox\"]").forEach((list) => {
      if (!(list instanceof HTMLElement)) return;
      const names = uniqueCharacterNames([...list.children]
        .filter((item) => item instanceof HTMLElement && !!item.querySelector("img, .MuiAvatar-root"))
        .map(getMyCharacterPanelItemName));
      if (names.length > best.length) best = names;
    });
    return best;
  }

  function findMyCharacterPanelButton() {
    const labels = new Set(MY_CHARACTER_PANEL_TITLES.map(normalizeMyCharacterName));
    for (const button of document.querySelectorAll("button, [role=\"button\"]")) {
      if (!(button instanceof HTMLElement) || !isVisible(button)) continue;
      const label = normalizeMyCharacterName(
        button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent || ""
      );
      if (labels.has(label)) return button;
    }
    return null;
  }

  function closeMyCharacterPanel(panel) {
    if (!(panel instanceof HTMLElement)) return;
    const closeButton = panel.querySelector('button svg[data-testid="CloseIcon"]')?.closest("button")
      || panel.querySelector('button[aria-label="\uB2EB\uAE30"], button[aria-label="Close"]');
    if (closeButton instanceof HTMLElement) {
      closeButton.click();
      return;
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  }

  async function scrapeNamesFromMyCharacterPanel() {
    const existingPanel = getMyCharacterPanel();
    const visibleNames = readMyCharacterPanelNames(existingPanel);
    if (visibleNames.length) return visibleNames;

    const button = findMyCharacterPanelButton();
    if (!button) return [];

    button.click();
    const opened = await waitForCondition(() => {
      const panel = getMyCharacterPanel();
      const names = readMyCharacterPanelNames(panel);
      return names.length ? { panel, names } : null;
    }, 1000);
    if (!opened) return [];

    if (!existingPanel) closeMyCharacterPanel(opened.panel);
    return opened.names;
  }

  function findCharacterSelectButton() {
    for (const selector of CHARACTER_SELECT_BUTTON_SELECTORS) {
      const matches = document.querySelectorAll(selector);
      for (const btn of matches) {
        if (btn instanceof HTMLButtonElement && !btn.disabled && isVisible(btn)) {
          return btn;
        }
      }
    }
    const fallback = [...document.querySelectorAll("button[aria-label]")].find((btn) => {
      if (!(btn instanceof HTMLButtonElement) || btn.disabled || !isVisible(btn)) return false;
      const label = normalizeMyCharacterName(btn.getAttribute("aria-label") || "");
      return /(?:캐릭터|character|キャラクター).*(?:선택|select|selection|選択)|(?:select).*(?:character)/i.test(label);
    });
    if (fallback instanceof HTMLButtonElement) return fallback;
    return null;
  }

  function getCurrentSpeakerName() {
    const btn = findCharacterSelectButton();
    if (btn) {
      const inlineName = normalizeMyCharacterName(btn.textContent || "");
      if (inlineName && !isCharacterSelectLabel(inlineName)) return inlineName;

      const avatarName = normalizeMyCharacterName(btn.querySelector("img")?.getAttribute("alt") || "");
      if (avatarName && !isCharacterSelectLabel(avatarName)) return avatarName;
    }

    const anchor = btn || activeComposer || activeEditor || findChatDrawer();
    if (!(anchor instanceof HTMLElement)) return "";
    const fields = findSpeakerNameFields(anchor, !!btn);
    return fields.length ? fields[0].name : "";
  }

  function isCharacterSelectLabel(name) {
    return /^(?:캐릭터\s*선택|character\s*(?:selection|select)|select\s*character|キャラクター\s*選択)$/i.test(name);
  }

  function getSpeakerNameFieldValue(field) {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      return normalizeMyCharacterName(field.value);
    }
    return normalizeMyCharacterName(field.textContent || "");
  }

  function findSpeakerNameFields(anchor, allowUnhintedInput = false) {
    const scopes = [];
    const seenScopes = new Set();
    const addScope = (scope) => {
      if (!(scope instanceof HTMLElement) || seenScopes.has(scope)) return;
      scopes.push(scope);
      seenScopes.add(scope);
    };

    addScope(anchor);
    let current = anchor.parentElement;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {
      if (!seenScopes.has(current)) {
        addScope(current);
      }
      if (current.matches(".MuiDrawer-paper")) break;
    }
    addScope(anchor.closest(".MuiDrawer-paper"));
    addScope(findChatDrawer());

    const seenFields = new Set();
    const candidates = [];
    scopes.forEach((scope, depth) => {
      scope.querySelectorAll('input[type="text"], input:not([type]), textarea, [role="textbox"], [contenteditable="true"]').forEach((field) => {
        if (!(field instanceof HTMLElement) || seenFields.has(field) || !isVisible(field)) return;
        if (field.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
        const name = getSpeakerNameFieldValue(field);
        if (!name) return;

        const hint = getEditorHintText(field);
        const nameHinted = NAME_HINT_RE.test(hint);
        const messageHinted = MESSAGE_HINT_RE.test(hint);
        const multiline = field instanceof HTMLTextAreaElement || field.getAttribute("aria-multiline") === "true";
        if (messageHinted && !nameHinted) return;
        if (multiline && !nameHinted) return;
        if (!nameHinted && !allowUnhintedInput) return;
        seenFields.add(field);

        let score = -depth * 18 - Math.min(distanceBetween(anchor, field), 400) / 3;
        if (nameHinted) score += 220;
        if (messageHinted) score -= 240;
        if (field instanceof HTMLInputElement && field.type === "text") score += 45;
        if (multiline) score -= 130;
        candidates.push({ name, score });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  function dispatchCharacterButtonOpen(btn) {
    if (!(btn instanceof HTMLElement)) return;
    try { btn.focus({ preventScroll: true }); } catch (error) { /* focus failed */ }
    const types = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const type of types) {
      try {
        const Ctor = type.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
        btn.dispatchEvent(new Ctor(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0
        }));
      } catch (error) { /* dispatch failed */ }
    }
    try { btn.click(); } catch (error) { /* click failed */ }
  }

  function findCharacterDropdownList() {
    const lists = document.querySelectorAll('ul.MuiList-root, [role="listbox"], [role="menu"]');
    let best = null;
    let bestCount = 0;
    lists.forEach((list) => {
      if (!(list instanceof HTMLElement) || !isVisible(list)) return;
      if (list.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      const items = [...list.children].filter((item) => {
        if (!(item instanceof HTMLElement) || !isVisible(item)) return false;
        const text = (item.querySelector(".MuiListItemText-primary")?.textContent || item.textContent || "").trim();
        if (!text) return false;
        return !!item.querySelector("img, .MuiAvatar-root") || item.matches('[role="option"], [role="menuitem"]');
      });
      if (items.length > bestCount) {
        bestCount = items.length;
        best = { list, items };
      }
    });
    return best;
  }

  function readCharacterListNames(items) {
    const names = [];
    const seen = new Set();
    for (const item of items) {
      if (!(item instanceof HTMLElement)) continue;
      const raw = (item.querySelector(".MuiListItemText-primary")?.textContent
        || item.getAttribute("aria-label")
        || item.textContent
        || "").replace(/\s+/g, " ").trim();
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      names.push(raw);
    }
    return names;
  }

  function waitForCondition(check, timeoutMs = 800, intervalMs = 25) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        const result = check();
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  function setNarratorScrapeHidden(hidden) {
    if (hidden) {
      if (narratorScrapeHideStyle) return;
      const style = document.createElement("style");
      style.id = "ccf-narrator-scrape-hide";
      style.setAttribute(SAFE_UI_ATTR, "1");
      style.textContent = `
        body > .MuiPopover-root,
        body > [role="presentation"]:has([role="listbox"]),
        body > [role="presentation"]:has([role="menu"]) {
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;
      document.documentElement.appendChild(style);
      narratorScrapeHideStyle = style;
    } else if (narratorScrapeHideStyle) {
      narratorScrapeHideStyle.remove();
      narratorScrapeHideStyle = null;
    }
  }

  function closeCharacterDropdown() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true, cancelable: true }));
    const backdrop = document.querySelector('body > .MuiPopover-root .MuiBackdrop-root, body > [role="presentation"] .MuiBackdrop-root');
    if (backdrop instanceof HTMLElement) {
      try {
        backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        backdrop.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch (error) { /* backdrop dismiss failed */ }
    }
  }

  function scheduleSpeakerCheck() {
    if (pendingSpeakerCheckTimer) return;
    pendingSpeakerCheckTimer = setTimeout(() => {
      pendingSpeakerCheckTimer = 0;
      const current = getCurrentSpeakerName();
      if (current === lastObservedSpeakerName) return;
      lastObservedSpeakerName = current;
      refreshAllInlineNarrationButtons();
      syncAllEditorVisualPreviews();
      if (isModalOpen() && activeEditor) {
        renderPreview(activeEditor, { force: true });
      }
    }, 80);
  }

  function startCharacterSpeakerObserver() {
    if (characterSpeakerObserverStarted) return;
    characterSpeakerObserverStarted = true;
    lastObservedSpeakerName = getCurrentSpeakerName();
    const observer = new MutationObserver(() => {
      scheduleSpeakerCheck();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    document.addEventListener("input", scheduleSpeakerCheck, ccfFsWithSignal(true));
    document.addEventListener("change", scheduleSpeakerCheck, ccfFsWithSignal(true));
    ccfFsRegisterTeardown(() => {
      try { observer.disconnect(); } catch (error) { /* observer teardown failed */ }
      if (pendingSpeakerCheckTimer) {
        clearTimeout(pendingSpeakerCheckTimer);
        pendingSpeakerCheckTimer = 0;
      }
    });
  }

  async function scrapeCharacterSelectionNames() {
    const btn = findCharacterSelectButton();
    if (!btn) return [];

    const dropdownAlreadyOpen = findCharacterDropdownList();
    if (dropdownAlreadyOpen) {
      return readCharacterListNames(dropdownAlreadyOpen.items);
    }

    setNarratorScrapeHidden(true);
    try {
      dispatchCharacterButtonOpen(btn);
      const found = await waitForCondition(() => {
        const candidate = findCharacterDropdownList();
        return candidate && candidate.items.length ? candidate : null;
      }, 1000);
      const names = found ? readCharacterListNames(found.items) : [];
      closeCharacterDropdown();
      await waitForCondition(() => !findCharacterDropdownList(), 400);
      return names;
    } finally {
      setNarratorScrapeHidden(false);
    }
  }

  async function scrapeCharacterNames(forcePanelScan = false) {
    const visibleNames = readMyCharacterPanelNames();
    if (visibleNames.length) {
      return sortNamesByMyCharacterOrder(cacheMyCharacterNames(visibleNames));
    }
    const cachedNames = readCachedMyCharacterNames();
    const storedOrder = readStoredMyCharacterOrderNames();
    if (!forcePanelScan && (cachedNames.length || storedOrder.length)) {
      return sortNamesByMyCharacterOrder([...cachedNames, ...storedOrder]);
    }

    const panelNames = await scrapeNamesFromMyCharacterPanel();
    if (panelNames.length) {
      return sortNamesByMyCharacterOrder(cacheMyCharacterNames(panelNames));
    }
    if (cachedNames.length || storedOrder.length) {
      return sortNamesByMyCharacterOrder([...cachedNames, ...storedOrder]);
    }

    return sortNamesByMyCharacterOrder(await scrapeCharacterSelectionNames());
  }

  function applyInlineNarration(editor, active) {
    if (!editor) return false;

    const state = ensureEditorState(editor);
    state.blockStyle = cleanupBlockStyle({
      ...state.blockStyle,
      narration: !!active
    });
    state.text = stripInvisibleEnvelope(getEditorText(editor));
    renderPreview(editor);
    refreshComposerBadge(activeComposer, editor);
    syncEditorVisualPreview(editor);
    return true;
  }

  function toggleModalNarration() {
    const editor = getResolvedActiveEditor() || activeEditor;
    if (!editor) return false;

    const active = modalDraftBlockStyle?.narration !== true;
    modalDraftBlockStyle = cleanupBlockStyle({
      ...(modalDraftBlockStyle ?? ensureEditorState(editor).blockStyle),
      narration: active
    });
    setNarrationToggle(active);
    renderPreview(editor, {
      force: true,
      restoreSelection: true,
      textOverride: modalDraftText ?? getEditorText(editor),
      runsOverride: modalDraftRuns ?? ensureEditorState(editor).runs,
      alignRunsOverride: modalDraftAlignRuns ?? ensureEditorState(editor).alignRuns
    });
    restoreModalSelectionSoon();
    return true;
  }

  function getAlignFromModal() {
    const align = document.querySelector(".ccf-align-toggle.active")?.getAttribute("data-align") || "left";
    return cleanupAlign(align);
  }

  function findLineIndexForOffset(lines, offset, preferNextOnBreak = false) {
    if (!lines.length) return 0;
    const safeOffset = clamp(offset, 0, lines[lines.length - 1].end + (lines[lines.length - 1].hasBreak ? 1 : 0));

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (safeOffset < line.end) return i;
      if (safeOffset === line.end) {
        if (!line.hasBreak) return i;
        return preferNextOnBreak ? Math.min(i + 1, lines.length - 1) : i;
      }
      if (line.hasBreak && safeOffset === line.end + 1) {
        return Math.min(i + 1, lines.length - 1);
      }
    }

    return lines.length - 1;
  }

  function getSelectedLineRange(text, selection) {
    const lines = getTextLines(text);
    if (!lines.length) {
      return { start: 0, end: 1 };
    }

    if (!selection) {
      return { start: 0, end: 1 };
    }

    const normalized = normalizeSelectionRange(selection, text.length);
    if (!normalized) {
      return { start: 0, end: 1 };
    }

    const startLine = findLineIndexForOffset(lines, normalized.start, false);
    const endProbe = normalized.start === normalized.end
      ? normalized.end
      : Math.max(normalized.end - 1, normalized.start);
    const endLine = findLineIndexForOffset(lines, endProbe, false);

    return {
      start: startLine,
      end: endLine + 1
    };
  }

  function getActiveAlignForSelection(text, alignRuns, selection = null, blockStyle = null) {
    const lineRange = getSelectedLineRange(text, selection);
    return getLineAlign(
      getEffectiveAlignRuns(text, alignRuns, blockStyle),
      lineRange.start
    ) || "left";
  }

  function countLineBreaks(text) {
    return (String(text || "").match(/\n/g) || []).length;
  }

  function getTextReplacementDiff(prevText, nextText) {
    const before = normalizeEditorText(prevText);
    const after = normalizeEditorText(nextText);
    if (before === after) return null;

    let start = 0;
    const maxPrefix = Math.min(before.length, after.length);
    while (start < maxPrefix && before[start] === after[start]) {
      start += 1;
    }

    let beforeEnd = before.length;
    let afterEnd = after.length;
    while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
      beforeEnd -= 1;
      afterEnd -= 1;
    }

    return {
      start,
      end: beforeEnd,
      insertedText: after.slice(start, afterEnd)
    };
  }

  function rebaseRunsForTextReplacement(existingRuns, selection, insertedText, oldTextLength, nextTextLength, insertedRuns = []) {
    const safeSelection = normalizeSelectionRange(selection, oldTextLength);
    const baseRuns = normalizeRuns(existingRuns, oldTextLength);
    if (!safeSelection) {
      return normalizeRuns([
        ...baseRuns,
        ...insertedRuns
      ], nextTextLength);
    }

    const insertedLength = insertedText.length;
    const delta = insertedLength - (safeSelection.end - safeSelection.start);
    const next = [];

    for (const run of baseRuns) {
      if (run.end <= safeSelection.start) {
        next.push({
          start: run.start,
          end: run.end,
          style: { ...run.style }
        });
        continue;
      }

      if (run.start >= safeSelection.end) {
        next.push({
          start: run.start + delta,
          end: run.end + delta,
          style: { ...run.style }
        });
        continue;
      }

      if (run.start < safeSelection.start) {
        next.push({
          start: run.start,
          end: safeSelection.start,
          style: { ...run.style }
        });
      }

      if (run.end > safeSelection.end) {
        next.push({
          start: safeSelection.start + insertedLength,
          end: safeSelection.start + insertedLength + (run.end - safeSelection.end),
          style: { ...run.style }
        });
      }
    }

    insertedRuns.forEach((run) => {
      next.push({
        start: run.start,
        end: run.end,
        style: { ...run.style }
      });
    });

    return normalizeRuns(next, nextTextLength);
  }

  function rebaseAlignRunsForTextReplacement(existingRuns, oldText, selection, insertedText, nextText) {
    const before = normalizeEditorText(oldText);
    const after = normalizeEditorText(nextText);
    const oldLineCount = getTextLineCount(before);
    const safeSelection = normalizeSelectionRange(selection, before.length);
    const baseRuns = normalizeAlignRuns(existingRuns, oldLineCount);
    const nextLineCount = getTextLineCount(after);
    if (!safeSelection) {
      return normalizeAlignRuns(baseRuns, nextLineCount);
    }

    const lines = getTextLines(before);
    const startLine = findLineIndexForOffset(lines, safeSelection.start, false);
    const removedBreaks = countLineBreaks(before.slice(safeSelection.start, safeSelection.end));
    const insertedBreaks = countLineBreaks(insertedText);
    const affectedStart = startLine;
    const affectedEnd = startLine + removedBreaks + 1;
    const insertedLineCount = insertedBreaks + 1;
    const lineDelta = insertedBreaks - removedBreaks;
    const activeAlign = getLineAlign(baseRuns, startLine);
    const next = [];

    for (const run of baseRuns) {
      if (run.end <= affectedStart) {
        next.push({
          start: run.start,
          end: run.end,
          align: run.align
        });
        continue;
      }

      if (run.start >= affectedEnd) {
        next.push({
          start: run.start + lineDelta,
          end: run.end + lineDelta,
          align: run.align
        });
        continue;
      }

      if (run.start < affectedStart) {
        next.push({
          start: run.start,
          end: affectedStart,
          align: run.align
        });
      }

      if (run.end > affectedEnd) {
        next.push({
          start: affectedStart + insertedLineCount,
          end: affectedStart + insertedLineCount + (run.end - affectedEnd),
          align: run.align
        });
      }
    }

    if (activeAlign) {
      next.push({
        start: affectedStart,
        end: affectedStart + insertedLineCount,
        align: activeAlign
      });
    }

    return normalizeAlignRuns(next, nextLineCount);
  }

  function applyCurrentModalStyle(options = {}) {
    const editor = getResolvedActiveEditor();
    if (!editor) return false;
    return applyStyleToCurrentSelection(editor, options);
  }

  function getCodeInsertionContext() {
    const editor = getResolvedActiveEditor() || activeEditor;
    if (!editor) return null;

    const text = typeof modalDraftText === "string"
      ? modalDraftText
      : stripInvisibleEnvelope(getEditorText(editor));
    const fallbackSelection = { start: text.length, end: text.length };
    const selection = normalizeSelectionRange(
      getModalSelection() || getEditorSelection(getModalEditor()) || fallbackSelection,
      text.length
    ) || fallbackSelection;

    return { editor, text, selection };
  }

  function getSelectedCodeDraftText() {
    const context = getCodeInsertionContext();
    if (!context) return "";

    const { text, selection } = context;
    if (!selection || selection.start === selection.end) return "";
    return text.slice(selection.start, selection.end);
  }

  function updateCodePopoverMessage(selectedText = null) {
    const note = getCodeNote();
    if (!note) return;
    note.textContent = "Ctrl+Enter\uB85C \uBC14\uB85C \uB123\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.";
  }

  function populateCodeInputFromSelection() {
    const input = getCodeInput();
    if (!input) return "";

    const selectedText = getSelectedCodeDraftText();
    if (selectedText) {
      input.value = selectedText;
    }
    updateCodePopoverMessage(selectedText);
    return selectedText;
  }

  function insertCodeBlockFromPopover() {
    const input = getCodeInput();
    if (!input) return false;

    const codeText = normalizeEditorText(input.value || "");
    if (!codeText.trim()) {
      alert("\uCF54\uB4DC \uBE14\uB85D\uC5D0 \uB123\uC744 \uB0B4\uC6A9\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.");
      input.focus({ preventScroll: true });
      return false;
    }

    const context = getCodeInsertionContext();
    if (!context) return false;

    const { text, selection } = context;
    const needsPrefixBreak =
      selection.start > 0 &&
      text[selection.start - 1] !== "\n" &&
      !codeText.startsWith("\n");
    const needsSuffixBreak =
      selection.end < text.length &&
      text[selection.end] !== "\n" &&
      !codeText.endsWith("\n");
    const prefix = needsPrefixBreak ? "\n" : "";
    const suffix = needsSuffixBreak ? "\n" : "";
    const insertText = `${prefix}${codeText}${suffix}`;
    const runStart = selection.start + prefix.length;
    const inserted = insertTextIntoDraft(insertText, [{
      start: runStart,
      end: runStart + codeText.length,
      style: { codeMode: "block" }
    }], selection);

    if (inserted) {
      resetCodeToolboxState();
    }
    return inserted;
  }

  function applyCodeToCurrentSelection() {
    setCodePopoverOpen(true, {
      focusInput: true,
      prefillSelection: true
    });
    return true;
  }

  function getActiveSelectionStyleContext(styleKey = "") {
    const editor = getResolvedActiveEditor();
    if (!editor) return null;

    const state = ensureEditorState(editor);
    const modalEditor = getModalEditor();
    const modalEditorSelection = getModalSelection();
    const modalRoot = document.getElementById(MODAL_ID);
    const isModalContext =
      !!modalRoot &&
      document.activeElement instanceof Element &&
      modalRoot.contains(document.activeElement);
    const useModalSelection = !!modalEditor && !!modalEditorSelection && (isModalEditorFocused() || isModalContext || isModalOpen());
    const targetEditor = useModalSelection ? modalEditor : editor;

    if (targetEditor === modalEditor) {
      modalDraftText = getEditorText(modalEditor);
    }

    const text = targetEditor === modalEditor
      ? (modalDraftText ?? getEditorText(modalEditor))
      : getEditorText(targetEditor);
    const selection = normalizeSelectionRange(
      useModalSelection ? modalEditorSelection : getEditorSelection(targetEditor),
      text.length
    );
    const selectedText = selection ? text.slice(selection.start, selection.end) : "";
    const baseRuns = targetEditor === modalEditor
      ? cloneRuns(modalDraftRuns ?? state.runs, text.length)
      : cloneRuns(state.runs, text.length);
    const currentValue = styleKey && selection && selection.start !== selection.end
      ? getSharedStyleValueForSelection(baseRuns, selection, styleKey, text.length)
      : "";

    return {
      editor,
      state,
      modalEditor,
      targetEditor,
      text,
      selection,
      selectedText,
      baseRuns,
      currentValue
    };
  }

  function commitSelectionStyleContext(context, stylePatch) {
    if (!context?.selection || context.selection.start === context.selection.end) {
      return false;
    }

    const nextRuns = patchStyleRuns(context.baseRuns, context.selection, stylePatch, context.text.length);

    if (context.targetEditor === context.modalEditor && activeEditor) {
      modalDraftRuns = nextRuns;
      renderPreview(activeEditor || context.editor, {
        force: true,
        selection: context.selection,
        restoreSelection: true,
        textOverride: context.text,
        runsOverride: nextRuns,
        alignRunsOverride: modalDraftAlignRuns
      });
      restoreModalSelectionSoon();
      return true;
    }

    context.state.runs = nextRuns;
    context.state.text = context.text;
    renderPreview(activeEditor || context.editor);
    refreshComposerBadge(activeComposer, activeEditor || context.editor);
    syncEditorVisualPreview(activeEditor || context.editor);
    return true;
  }

  function readStyleClipboard() {
    try {
      const stored = JSON.parse(localStorage.getItem(STYLE_CLIPBOARD_STORAGE_KEY) || "null");
      if (!stored || typeof stored !== "object") return null;
      return {
        style: cleanupStyle(stored.style || {}),
        align: cleanupAlign(stored.align) || "left"
      };
    } catch (error) {
      return null;
    }
  }

  // ===== 서식 프리셋 (#70) — 여러 서식을 이름으로 저장/삭제/적용 =====
  const STYLE_PRESETS_STORAGE_KEY = "ccf-format-style-presets-v1";

  function readStylePresets() {
    let list = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(STYLE_PRESETS_STORAGE_KEY) || "[]");
      if (Array.isArray(parsed)) {
        list = parsed.filter((p) => p && typeof p === "object" && typeof p.name === "string" && p.name.trim());
      }
    } catch (error) { /* 손상 데이터 무시 */ }
    // 기존 단일 클립보드 → 프리셋 1개로 마이그레이션
    if (!list.length) {
      const legacy = readStyleClipboard();
      if (legacy && Object.keys(legacy.style || {}).length) {
        list = [{ name: "저장된 서식", style: legacy.style, align: legacy.align, savedAt: Date.now() }];
        writeStylePresets(list);
        try { localStorage.removeItem(STYLE_CLIPBOARD_STORAGE_KEY); } catch (_) {}
      }
    }
    return list;
  }

  function writeStylePresets(list) {
    try {
      localStorage.setItem(STYLE_PRESETS_STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (error) {
      console.error("[ccf-format-sync] writeStylePresets failed", error);
      alert("서식을 저장하지 못했습니다.");
      return false;
    }
  }

  // 팝업 내 서식 빌더 상태 수집 (#70) — 색상은 picker를 만진(data-touched) 경우만 포함
  function collectStyleBuilderDraft(popover) {
    if (!(popover instanceof HTMLElement)) return { style: {}, align: "left" };
    const style = {};
    popover.querySelectorAll('[data-style-builder][data-active="1"]').forEach((b) => {
      style[b.getAttribute("data-style-builder")] = true;
    });
    const colorInput = popover.querySelector("[data-style-builder-color]");
    if (colorInput?.getAttribute("data-touched") === "1" && colorInput.value) {
      style.color = colorInput.value;
    }
    const bgInput = popover.querySelector("[data-style-builder-bg]");
    if (bgInput?.getAttribute("data-touched") === "1" && bgInput.value) {
      style.backgroundColor = bgInput.value;
    }
    const size = parseInt(popover.querySelector("[data-style-builder-size]")?.value, 10);
    if (Number.isFinite(size) && size > 0) style.fontSize = size;
    const align = popover.querySelector('[data-style-builder-align][data-active="1"]')?.getAttribute("data-style-builder-align") || "left";
    return { style: cleanupStyle(style), align };
  }

  // 프리셋/빌더 서식 → 미리보기용 inline CSS 문자열 (#70)
  function stylePresetPreviewCss(style = {}, align = "left") {
    const parts = [];
    if (style.bold) parts.push("font-weight:700");
    if (style.italic) parts.push("font-style:italic");
    const deco = [style.underline && "underline", style.strike && "line-through"].filter(Boolean).join(" ");
    if (deco) parts.push(`text-decoration:${deco}`);
    if (style.color) parts.push(`color:${style.color}`);
    if (style.backgroundColor) parts.push(`background-color:${style.backgroundColor}`);
    const sizePx = parseInt(style.fontSize, 10);
    if (Number.isFinite(sizePx) && sizePx > 0) parts.push(`font-size:${Math.min(sizePx, 20)}px`);
    if (align && align !== "left") parts.push(`text-align:${align}`);
    return parts.join(";");
  }

  // 프리셋 자동 반영 ON/OFF (#70)
  const STYLE_PRESETS_AUTO_KEY = "ccf-format-style-presets-auto-v1";

  function isPresetAutoEnabled() {
    try { return localStorage.getItem(STYLE_PRESETS_AUTO_KEY) !== "0"; }
    catch (_) { return true; }
  }

  function setPresetAutoEnabled(on) {
    try { localStorage.setItem(STYLE_PRESETS_AUTO_KEY, on ? "1" : "0"); } catch (_) {}
  }

  // 프리셋 행 드래그로 순서 변경 (#70)
  function bindStylePresetDragSort(popover, toolbar) {
    if (!(popover instanceof HTMLElement)) return;
    let dragIndex = null;
    popover.querySelectorAll(".ccf-style-preset-row").forEach((row, i) => {
      row.setAttribute("draggable", "true");
      row.setAttribute("data-row-index", String(i));
    });
    popover.addEventListener("dragstart", (event) => {
      const row = event.target.closest?.(".ccf-style-preset-row");
      if (!row) return;
      dragIndex = Number(row.getAttribute("data-row-index"));
      try { event.dataTransfer.effectAllowed = "move"; } catch (_) {}
    });
    popover.addEventListener("dragover", (event) => {
      if (dragIndex === null) return;
      if (!event.target.closest?.(".ccf-style-preset-row")) return;
      event.preventDefault();
    });
    popover.addEventListener("drop", (event) => {
      if (dragIndex === null) return;
      const row = event.target.closest?.(".ccf-style-preset-row");
      if (!row) { dragIndex = null; return; }
      event.preventDefault();
      const dropIndex = Number(row.getAttribute("data-row-index"));
      if (Number.isFinite(dropIndex) && dropIndex !== dragIndex) {
        const list = readStylePresets();
        const [moved] = list.splice(dragIndex, 1);
        if (moved) {
          list.splice(dropIndex, 0, moved);
          writeStylePresets(list);
          openInlineStyleClipboardPopover(toolbar, { reuseContext: true });
        }
      }
      dragIndex = null;
    });
    popover.addEventListener("dragend", () => { dragIndex = null; });
  }

  // 메시지 텍스트에서 프리셋 이름과 일치하는 구간에 프리셋 서식 run 생성 (#70)
  function buildPresetNameRuns(text) {
    if (typeof text !== "string" || !text) return [];

    const runs = [];
    for (const preset of readStylePresets()) {
      if (preset.auto === false) continue; // 프리셋별 자동 적용 OFF (#70)
      const name = String(preset.name || "");
      if (!name) continue;
      const style = cleanupStyle(preset.style || {});
      if (!Object.keys(style).length) continue;
      let idx = 0;
      while ((idx = text.indexOf(name, idx)) !== -1) {
        runs.push({ start: idx, end: idx + name.length, style: { ...style } });
        idx += name.length;
      }
    }
    return runs;
  }

  // 프리셋을 빌더에 불러와 편집 — 같은 이름으로 + 누르면 덮어씀 (#70)
  function loadStylePresetIntoBuilder(popover, preset) {
    if (!(popover instanceof HTMLElement) || !preset) return;
    const style = preset.style || {};
    popover.querySelectorAll("[data-style-builder]").forEach((b) => {
      if (style[b.getAttribute("data-style-builder")]) b.setAttribute("data-active", "1");
      else b.removeAttribute("data-active");
    });
    const align = cleanupAlign(preset.align) || "left";
    popover.querySelectorAll("[data-style-builder-align]").forEach((b) => {
      if (b.getAttribute("data-style-builder-align") === align) b.setAttribute("data-active", "1");
      else b.removeAttribute("data-active");
    });
    const colorInput = popover.querySelector("[data-style-builder-color]");
    if (colorInput) {
      if (style.color) { colorInput.value = style.color; colorInput.setAttribute("data-touched", "1"); }
      else { colorInput.value = "#ffffff"; colorInput.removeAttribute("data-touched"); }
    }
    const bgInput = popover.querySelector("[data-style-builder-bg]");
    if (bgInput) {
      if (style.backgroundColor) { bgInput.value = style.backgroundColor; bgInput.setAttribute("data-touched", "1"); }
      else { bgInput.value = "#000000"; bgInput.removeAttribute("data-touched"); }
    }
    const sizeInput = popover.querySelector("[data-style-builder-size]");
    if (sizeInput) {
      const px = parseInt(style.fontSize, 10);
      sizeInput.value = Number.isFinite(px) && px > 0 ? String(px) : "";
    }
    const nameInput = popover.querySelector("[data-style-preset-name]");
    if (nameInput) nameInput.value = preset.name || "";
    updateStyleBuilderPreview(popover);
  }

  // 이름 입력칸에 현재 빌더 서식 실시간 미리보기 (#70)
  function updateStyleBuilderPreview(popover) {
    if (!(popover instanceof HTMLElement)) return;
    const input = popover.querySelector("[data-style-preset-name]");
    if (!(input instanceof HTMLElement)) return;
    const draft = collectStyleBuilderDraft(popover);
    input.style.cssText = "";
    const css = stylePresetPreviewCss(draft.style, draft.align);
    if (css) input.style.cssText = css;
  }

  function addStylePresetFromBuilder(name, draft) {
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      alert("프리셋 이름을 입력해 주세요.");
      return false;
    }
    if (!draft || (!Object.keys(draft.style || {}).length && (draft.align || "left") === "left")) {
      alert("저장할 서식을 하나 이상 선택해 주세요.");
      return false;
    }
    const list = readStylePresets().filter((p) => p.name !== cleanName);
    list.push({ name: cleanName, style: draft.style, align: draft.align, savedAt: Date.now() });
    return writeStylePresets(list);
  }

  function addStylePresetFromContext(context, name) {
    if (!context?.selection || context.selection.start === context.selection.end) {
      alert("저장할 서식의 텍스트를 먼저 선택해 주세요.");
      return false;
    }
    const cleanName = String(name || "").trim();
    if (!cleanName) {
      alert("프리셋 이름을 입력해 주세요.");
      return false;
    }
    let preset;
    try {
      preset = {
        name: cleanName,
        style: getStyleClipboardTextStyle(context),
        align: getStyleClipboardAlign(context),
        savedAt: Date.now()
      };
    } catch (error) {
      console.error("[ccf-format-sync] addStylePresetFromContext failed", error);
      alert("서식을 저장하지 못했습니다.");
      return false;
    }
    const list = readStylePresets().filter((p) => p.name !== cleanName);
    list.push(preset);
    return writeStylePresets(list);
  }

  function removeStylePreset(name) {
    const list = readStylePresets();
    const next = list.filter((p) => p.name !== name);
    if (next.length === list.length) return false;
    return writeStylePresets(next);
  }

  function applyStylePresetToContext(context, preset) {
    if (!preset) return false;
    if (!context?.selection || context.selection.start === context.selection.end) {
      alert("서식을 적용할 텍스트를 먼저 선택해 주세요.");
      return false;
    }
    const clearedStyle = {
      bold: null, italic: null, underline: null, strike: null,
      rubyText: null, tooltipText: null, codeMode: null, blur: null,
      color: null, backgroundColor: null, backgroundImage: null,
      fontSize: null, display: null, padding: null, margin: null,
      borderRadius: null, border: null, letterSpacing: null,
      lineHeight: null, textAlign: null, textShadow: null, opacity: undefined
    };
    const applied = commitSelectionStyleContext(context, {
      ...clearedStyle,
      ...cleanupStyle(preset.style || {})
    });
    if (!applied) return false;
    if (context.targetEditor === context.modalEditor) {
      setAlignmentToggle(cleanupAlign(preset.align) || "left");
      applyCurrentModalBlockStyle({ previewOnly: true });
      restoreModalSelectionSoon();
    } else {
      applyInlineAlignment(context.editor, cleanupAlign(preset.align) || "left", context.selection);
    }
    return true;
  }

  function writeStyleClipboard(value) {
    try {
      localStorage.setItem(STYLE_CLIPBOARD_STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("[ccf-format-sync] writeStyleClipboard failed", { error, value });
      alert("\uC11C\uC2DD\uC744 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return false;
    }
  }

  function getStyleClipboardAlign(context) {
    if (!context) return "left";
    const useModal = context.targetEditor === context.modalEditor;
    const alignRuns = useModal
      ? (modalDraftAlignRuns ?? context.state?.alignRuns)
      : context.state?.alignRuns;
    const blockStyle = useModal
      ? (modalDraftBlockStyle ?? context.state?.blockStyle)
      : context.state?.blockStyle;
    return getActiveAlignForSelection(context.text, alignRuns || [], context.selection, blockStyle);
  }

  function getStyleClipboardTextStyle(context) {
    if (!context?.selection || context.selection.start === context.selection.end) return {};
    const offset = Math.min(context.selection.start, Math.max(0, context.text.length - 1));
    const activeRuns = normalizeRuns(context.baseRuns, context.text.length)
      .filter((run) => run.start <= offset && offset < run.end)
      .map((run) => run.style);
    const style = cleanupStyle(mergeStyles(activeRuns));
    delete style.imageUrl;
    delete style.imageAlt;
    return style;
  }

  function saveStyleClipboardFromContext(context) {
    if (!context?.selection || context.selection.start === context.selection.end) {
      alert("\uC800\uC7A5\uD560 \uC11C\uC2DD\uC758 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }
    let saved;
    try {
      saved = {
        style: getStyleClipboardTextStyle(context),
        align: getStyleClipboardAlign(context)
      };
    } catch (error) {
      console.error("[ccf-format-sync] saveStyleClipboardFromContext build failed", { error, context });
      alert("\uC11C\uC2DD\uC744 \uC800\uC7A5\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.");
      return false;
    }
    return writeStyleClipboard(saved);
  }

  function applyStyleClipboardToContext(context) {
    const saved = readStyleClipboard();
    if (!saved) {
      alert("\uC800\uC7A5\uB41C \uC11C\uC2DD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
      restoreModalSelectionSoon();
      return false;
    }
    if (!context?.selection || context.selection.start === context.selection.end) {
      alert("\uC11C\uC2DD\uC744 \uBD88\uB7EC\uC62C \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    const clearedStyle = {
      bold: null,
      italic: null,
      underline: null,
      strike: null,
      rubyText: null,
      tooltipText: null,
      codeMode: null,
      blur: null,
      color: null,
      backgroundColor: null,
      backgroundImage: null,
      fontSize: null,
      display: null,
      padding: null,
      margin: null,
      borderRadius: null,
      border: null,
      letterSpacing: null,
      lineHeight: null,
      textAlign: null,
      textShadow: null,
      opacity: undefined
    };
    const applied = commitSelectionStyleContext(context, {
      ...clearedStyle,
      ...saved.style
    });
    if (!applied) return false;

    if (context.targetEditor === context.modalEditor) {
      setAlignmentToggle(saved.align);
      applyCurrentModalBlockStyle({ previewOnly: true });
      restoreModalSelectionSoon();
    } else {
      applyInlineAlignment(context.editor, saved.align, context.selection);
    }
    return true;
  }

  function applyTooltipFromPopover() {
    const context = getActiveSelectionStyleContext("tooltipText");
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert("\uD234\uD301\uC744 \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert("\uD234\uD301\uC740 \uC904\uBC14\uAFC8\uC774 \uC5C6\uB294 \uD14D\uC2A4\uD2B8\uC5D0\uB9CC \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    const tooltipText = normalizeTooltipText(getTooltipInput()?.value || "");
    const applied = commitSelectionStyleContext(context, { tooltipText });
    if (applied) {
      resetTooltipToolboxState();
    }
    return applied;
  }

  function applyRubyFromPopover() {
    const context = getActiveSelectionStyleContext("rubyText");
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert("猷⑤퉬瑜??곸슜???띿뒪?몃? 癒쇱? ?좏깮??二쇱꽭??");
      restoreModalSelectionSoon();
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert("猷⑤퉬??以꾨컮轅덉씠 ?녿뒗 ?띿뒪?몄뿉留??곸슜?????덉뼱??");
      restoreModalSelectionSoon();
      return false;
    }

    const rubyText = normalizeRubyText(getRubyInput()?.value || "");
    const applied = commitSelectionStyleContext(context, { rubyText });
    if (applied) {
      resetRubyToolboxState();
    }
    return applied;
  }

  function applyTooltipToCurrentSelection() {
    const context = getActiveSelectionStyleContext("tooltipText");
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert("\uD234\uD301\uC744 \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert("\uD234\uD301\uC740 \uC904\uBC14\uAFC8\uC774 \uC5C6\uB294 \uD14D\uC2A4\uD2B8\uC5D0\uB9CC \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    const input = getTooltipInput();
    if (input) {
      input.value = context.currentValue || "";
    }
    setTooltipPopoverOpen(true, { focusInput: true });
    return true;
  }

  function applyBlurToCurrentSelection(selectionOverride = null) {
    const editor = getResolvedActiveEditor();
    if (!editor) return false;

    const state = ensureEditorState(editor);
    const modalEditor = getModalEditor();
    const modalEditorSelection = getModalSelection();
    const modalRoot = document.getElementById(MODAL_ID);
    const isModalContext =
      !!modalRoot &&
      document.activeElement instanceof Element &&
      modalRoot.contains(document.activeElement);
    const useModalSelection = !!modalEditor && !!modalEditorSelection && (isModalEditorFocused() || isModalContext || isModalOpen());
    const targetEditor = useModalSelection ? modalEditor : editor;

    if (targetEditor === modalEditor) {
      modalDraftText = getEditorText(modalEditor);
    }

    const text = targetEditor === modalEditor
      ? (modalDraftText ?? getEditorText(modalEditor))
      : getEditorText(targetEditor);
    // selectionOverride: 인라인 툴바 mousedown에서 캡처한 selection 우선 사용.
    // 버튼 클릭 시 textarea focus가 유지되더라도 React 이벤트 핸들러로 인해 live selection이
    // 초기화될 수 있으므로 캡처된 값을 우선 신뢰.
    const selection = useModalSelection ? modalEditorSelection : (selectionOverride || getEditorSelection(targetEditor));

    if (!selection || selection.start === selection.end) {
      alert("\uBE14\uB7EC\uB97C \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    const baseRuns = targetEditor === modalEditor
      ? cloneRuns(modalDraftRuns ?? state.runs, text.length)
      : cloneRuns(state.runs, text.length);
    const currentBlur = getSharedStyleValueForSelection(baseRuns, selection, "blur", text.length);
    const blur = currentBlur ? "" : DEFAULT_BLUR_VALUE;
    const nextRuns = patchStyleRuns(baseRuns, selection, { blur }, text.length);

    if (targetEditor === modalEditor && activeEditor) {
      modalDraftRuns = nextRuns;
      renderPreview(activeEditor || editor, {
        force: true,
        selection,
        restoreSelection: true,
        textOverride: text,
        runsOverride: nextRuns,
        alignRunsOverride: modalDraftAlignRuns
      });
      restoreModalSelectionSoon();
      return true;
    }

    state.runs = nextRuns;
    state.text = text;
    renderPreview(activeEditor || editor);
    refreshComposerBadge(activeComposer, activeEditor || editor);
    syncEditorVisualPreview(activeEditor || editor);
    return true;
  }

  function applyRubyToCurrentSelection() {
    const editor = getResolvedActiveEditor();
    if (!editor) return false;

    const state = ensureEditorState(editor);
    const modalEditor = getModalEditor();
    const modalEditorSelection = getModalSelection();
    const modalRoot = document.getElementById(MODAL_ID);
    const isModalContext =
      !!modalRoot &&
      document.activeElement instanceof Element &&
      modalRoot.contains(document.activeElement);
    const useModalSelection = !!modalEditor && !!modalEditorSelection && (isModalEditorFocused() || isModalContext || isModalOpen());
    const targetEditor = useModalSelection ? modalEditor : editor;

    if (targetEditor === modalEditor) {
      modalDraftText = getEditorText(modalEditor);
    }

    const text = targetEditor === modalEditor
      ? (modalDraftText ?? getEditorText(modalEditor))
      : getEditorText(targetEditor);
    const selection = useModalSelection ? modalEditorSelection : getEditorSelection(targetEditor);

    if (!selection || selection.start === selection.end) {
      alert("루비를 적용할 텍스트를 먼저 선택해 주세요.");
      restoreModalSelectionSoon();
      return false;
    }

    const selectedText = text.slice(selection.start, selection.end);
    if (!selectedText || selectedText.includes("\n")) {
      alert("루비는 줄바꿈이 없는 텍스트에만 적용할 수 있어요.");
      restoreModalSelectionSoon();
      return false;
    }

    const baseRuns = targetEditor === modalEditor
      ? cloneRuns(modalDraftRuns ?? state.runs, text.length)
      : cloneRuns(state.runs, text.length);
    const currentRuby = getSharedStyleValueForSelection(baseRuns, selection, "rubyText", text.length);
    const input = window.prompt("루비 문자를 입력해 주세요. 비워 두면 루비가 제거됩니다.", currentRuby);
    if (input == null) {
      restoreModalSelectionSoon();
      return false;
    }

    const rubyText = normalizeRubyText(input);
    const nextRuns = patchStyleRuns(baseRuns, selection, { rubyText }, text.length);

    if (targetEditor === modalEditor && activeEditor) {
      modalDraftRuns = nextRuns;
      renderPreview(activeEditor || editor, {
        force: true,
        selection,
        restoreSelection: true,
        textOverride: text,
        runsOverride: nextRuns,
        alignRunsOverride: modalDraftAlignRuns
      });
      restoreModalSelectionSoon();
      return true;
    }

    state.runs = nextRuns;
    state.text = text;
    renderPreview(activeEditor || editor);
    refreshComposerBadge(activeComposer, activeEditor || editor);
    syncEditorVisualPreview(activeEditor || editor);
    return true;
  }

  function applyRubyToCurrentSelection() {
    const context = getActiveSelectionStyleContext("rubyText");
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert("猷⑤퉬瑜??곸슜???띿뒪?몃? 癒쇱? ?좏깮??二쇱꽭??");
      restoreModalSelectionSoon();
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert("猷⑤퉬??以꾨컮轅덉씠 ?녿뒗 ?띿뒪?몄뿉留??곸슜?????덉뼱??");
      restoreModalSelectionSoon();
      return false;
    }

    const input = getRubyInput();
    if (input) {
      input.value = context.currentValue || "";
    }
    setRubyPopoverOpen(true, { focusInput: true });
    return true;
  }

  function applyRubyFromPopover() {
    const context = getActiveSelectionStyleContext("rubyText");
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert("\uB8E8\uBE44\uB97C \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert("\uB8E8\uBE44\uB294 \uC904\uBC14\uAFC8\uC774 \uC5C6\uB294 \uD14D\uC2A4\uD2B8\uC5D0\uB9CC \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    const rubyText = normalizeRubyText(getRubyInput()?.value || "");
    const applied = commitSelectionStyleContext(context, { rubyText });
    if (applied) {
      resetRubyToolboxState();
    }
    return applied;
  }

  function applyRubyToCurrentSelection() {
    const context = getActiveSelectionStyleContext("rubyText");
    if (!context) return false;

    if (!context.selection || context.selection.start === context.selection.end) {
      alert("\uB8E8\uBE44\uB97C \uC801\uC6A9\uD560 \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    if (!context.selectedText || context.selectedText.includes("\n")) {
      alert("\uB8E8\uBE44\uB294 \uC904\uBC14\uAFC8\uC774 \uC5C6\uB294 \uD14D\uC2A4\uD2B8\uC5D0\uB9CC \uC801\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694.");
      restoreModalSelectionSoon();
      return false;
    }

    const input = getRubyInput();
    if (input) {
      input.value = context.currentValue || "";
    }
    setRubyPopoverOpen(true, { focusInput: true });
    return true;
  }

  function applyCurrentModalBlockStyle(options = {}) {
    const previewOnly = !!options.previewOnly;
    const editor = getResolvedActiveEditor();
    if (!editor) return false;

    const state = ensureEditorState(editor);
    const align = getAlignFromModal();
    const text = modalDraftText ?? getEditorText(editor);
    const selection = getModalSelection() || getEditorSelection(getModalEditor()) || { start: 0, end: 0 };
    const lineRange = getSelectedLineRange(text, selection);
    const nextAlignRuns = addOrReplaceAlignRun(
      modalDraftAlignRuns ?? state.alignRuns,
      {
        start: lineRange.start,
        end: lineRange.end,
        align
      },
      getTextLineCount(text)
    );
    modalDraftAlignRuns = nextAlignRuns;

    renderPreview(editor, {
      force: true,
      selection,
      restoreSelection: isModalEditorFocused(),
      textOverride: text,
      runsOverride: modalDraftRuns ?? state.runs,
      alignRunsOverride: nextAlignRuns
    });

    if (!previewOnly) {
      commitModalDraftToRoomEditor();
      refreshComposerBadge(activeComposer, editor);
      syncEditorVisualPreview(editor);
    }

    return true;
  }

  function applyStyleToCurrentSelection(editor, options = {}) {
    const silent = !!options.silent;
    const previewOnly = !!options.previewOnly;
    const state = ensureEditorState(editor);
    const modalEditor = getModalEditor();
    const modalEditorSelection = getModalSelection();
    const modalRoot = document.getElementById(MODAL_ID);
    const isModalContext =
      !!modalRoot &&
      document.activeElement instanceof Element &&
      modalRoot.contains(document.activeElement);
    const useModalSelection = !!modalEditor && !!modalEditorSelection && (isModalEditorFocused() || isModalContext);
    const targetEditor = useModalSelection ? modalEditor : editor;

    if (targetEditor === modalEditor) {
      modalDraftText = getEditorText(modalEditor);
    }

    const text = targetEditor === modalEditor
      ? (modalDraftText ?? getEditorText(modalEditor))
      : getEditorText(targetEditor);
    const selection = normalizeSelectionRange(
      options.selectionOverride || (useModalSelection ? modalEditorSelection : getEditorSelection(targetEditor)),
      text.length
    );
    const style = cleanupStyle(options.styleOverride || getStyleFromModal());

    if (!selection || selection.start === selection.end) {
      if (silent) return false;
      alert("먼저 텍스트를 선택해 주세요.");
      return;
    }

    if (false && Object.keys(style).length === 0) {
      if (silent) return false;
      alert("적용할 서식을 먼저 선택해 주세요.");
      return;
    }

    const baseRuns = targetEditor === modalEditor
      ? cloneRuns(modalDraftRuns ?? state.runs, text.length)
      : state.runs;

    const nextRuns = addOrReplaceRun(baseRuns, {
      start: selection.start,
      end: selection.end,
      style
    }, text.length);

    if (targetEditor === modalEditor && activeEditor) {
      modalDraftRuns = nextRuns;
      modalDraftLastStyle = style;
      renderPreview(activeEditor || editor, {
        force: true,
        selection,
        restoreSelection: isModalEditorFocused(),
        textOverride: text,
        runsOverride: nextRuns,
        alignRunsOverride: modalDraftAlignRuns
      });
      if (!previewOnly) {
        commitModalDraftToRoomEditor();
      }
    } else {
      state.runs = nextRuns;
      state.lastStyle = style;
      state.text = text;
      renderPreview(activeEditor || editor);
      refreshComposerBadge(activeComposer, activeEditor || editor);
      syncEditorVisualPreview(activeEditor || editor);
    }

    if (!previewOnly && targetEditor === modalEditor) {
      refreshComposerBadge(activeComposer, activeEditor || editor);
      syncEditorVisualPreview(activeEditor || editor);
    }

    return true;
  }

  function applyNarrationPreviewRuns(runs, text, blockStyle) {
    if (!text || cleanupBlockStyle(blockStyle).narration !== true) {
      return normalizeRuns(runs, text.length);
    }

    return patchStyleRuns(
      runs,
      { start: 0, end: text.length },
      { italic: true },
      text.length
    );
  }

  function renderPreview(editor, options = {}) {
    const preview = document.getElementById("ccf-preview");
    if (!preview) return;
    const force = !!options.force;

    const isEditingModalNow =
      document.activeElement === preview &&
      preview.getAttribute("contenteditable") === "true";

    if (isEditingModalNow && !force) return;

    const text = typeof options.textOverride === "string"
      ? options.textOverride
      : getEditorText(editor);
    const state = ensureEditorState(editor);
    const blockStyle = applyAutomaticNarration(
      options.blockStyleOverride ??
      (isModalOpen() && modalMode === MODAL_MODE_CCFOLIA && modalDraftBlockStyle != null
        ? modalDraftBlockStyle
        : state.blockStyle)
    );
    const selectionToRestore = force && options.restoreSelection !== false
      ? normalizeSelectionRange(options.selection || getModalSelection(), text.length)
      : null;

    if (!text) {
      const alignRuns = options.alignRunsOverride != null
        ? getEffectiveAlignRuns(text, options.alignRunsOverride, blockStyle)
        : getEffectiveAlignRuns(text, state.alignRuns, blockStyle);
      preview.style.textAlign = getLineAlign(alignRuns, 0) || "";
      preview.textContent = "";
      return;
    }

    const baseRuns = Array.isArray(options.runsOverride)
      ? normalizeRuns(options.runsOverride, text.length)
      : normalizeRuns(ensureEditorState(editor).runs, text.length);
    const runs = applyNarrationPreviewRuns(baseRuns, text, blockStyle);
    const alignRuns = options.alignRunsOverride != null
      ? getEffectiveAlignRuns(text, options.alignRunsOverride, blockStyle)
      : getEffectiveAlignRuns(text, state.alignRuns, blockStyle);
    renderStyledText(preview, text, runs, alignRuns);

    if (selectionToRestore) {
      restoreEditorSelection(preview, selectionToRestore);
    }
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

  function ensureRoll20DraftConverted(options = {}) {
    const source = normalizeEditorText(modalDraftRoll20Text ?? getEditorText(getRoll20Editor()));
    modalDraftRoll20Text = source;

    if (!source.trim()) {
      if (options.forceRender) {
        setRoll20PreviewEmpty("/desc 명령을 입력하면 변환 결과가 여기에 보입니다.");
      }
      if (!options.silent) {
        setRoll20Status("변환할 Roll20 명령이 비어 있습니다.", "error");
      }
      return null;
    }

    if (modalDraftRoll20ConvertedSource === source && typeof modalDraftText === "string") {
      if (options.forceRender) {
        renderRoll20PreviewFromDraft();
      }
      return {
        text: modalDraftText,
        runs: cloneRuns(modalDraftRuns, modalDraftText.length),
        alignRuns: cloneAlignRuns(modalDraftAlignRuns, getTextLineCount(modalDraftText))
      };
    }

    return convertRoll20Draft(options);
  }

  function convertRoll20Draft(options = {}) {
    const { silent = false, forceRender = true } = options;
    const source = normalizeEditorText(modalDraftRoll20Text ?? getEditorText(getRoll20Editor()));
    modalDraftRoll20Text = source;

    const parsed = parseRoll20MacroToDraft(source);
    if (!parsed) {
      if (forceRender) {
        setRoll20PreviewEmpty("지원되는 Roll20 /desc 스타일을 찾지 못했습니다.");
      }
      if (!silent) {
        setRoll20Status("변환 가능한 /desc 명령이나 스타일 구문을 찾지 못했습니다.", "error");
      }
      return null;
    }

    modalDraftText = parsed.text;
    modalDraftRuns = parsed.runs;
    modalDraftAlignRuns = parsed.alignRuns;
    modalDraftBlockStyle = {};
    modalDraftRoll20ConvertedSource = source;
    modalDraftLastStyle = null;

    if (forceRender) {
      renderRoll20PreviewFromDraft();
    }

    if (!silent) {
      const details = [];
      if (parsed.descCount > 0) {
        details.push(`/desc ${parsed.descCount}줄`);
      }
      if (parsed.segmentCount > 0) {
        details.push(`스타일 조각 ${parsed.segmentCount}개`);
      }
      const detailText = details.length ? ` (${details.join(", ")})` : "";
      setRoll20Status(`코코포리아용으로 변환했습니다${detailText}. 적용을 누르면 입력창에 반영됩니다.`, "success");
    }

    return parsed;
  }

  function parseRoll20MacroToDraft(source) {
    const normalizedSource = normalizeEditorText(source);
    if (!normalizedSource.trim()) return null;

    const lines = normalizedSource.split("\n");
    const runs = [];
    const alignRuns = [];
    let outputText = "";
    let descCount = 0;
    let segmentCount = 0;

    lines.forEach((line, index) => {
      if (index > 0) {
        outputText += "\n";
      }

      const descMatch = line.match(ROLL20_DESC_RE);
      const isDesc = !!descMatch;
      let content = isDesc ? line.slice(descMatch[0].length) : line;
      if (isDesc && ROLL20_NEWLINE_TOKEN_RE.test(content)) {
        content = "";
      }
      const parsedLine = parseRoll20StyledLine(content);
      const lineStart = outputText.length;

      outputText += parsedLine.text;
      parsedLine.runs.forEach((run) => {
        runs.push({
          start: lineStart + run.start,
          end: lineStart + run.end,
          style: { ...run.style }
        });
      });

      if (isDesc) {
        alignRuns.push({
          start: index,
          end: index + 1,
          align: "center"
        });
        descCount += 1;
      }

      segmentCount += parsedLine.segmentCount;
    });

    if (descCount === 0 && segmentCount === 0) {
      return null;
    }

    return {
      text: outputText,
      runs: normalizeRuns(runs, outputText.length),
      alignRuns: normalizeAlignRuns(alignRuns, getTextLineCount(outputText)),
      descCount,
      segmentCount
    };
  }

  function parseRoll20StyledLine(line) {
    const rawLine = typeof line === "string" ? line : "";
    const parsedImageLine = parseRoll20ImageLine(rawLine);
    if (parsedImageLine) {
      return parsedImageLine;
    }

    const linkRe = new RegExp(ROLL20_STYLE_LINK_RE.source, "gi");
    const runs = [];
    let text = "";
    let lastIndex = 0;
    let segmentCount = 0;
    let match;

    while ((match = linkRe.exec(rawLine))) {
      text += decodeHtmlEntities(rawLine.slice(lastIndex, match.index));

      const label = decodeHtmlEntities(match[1] || "");
      const start = text.length;
      text += label;

      const style = parseRoll20InlineStyle(match[2] || "");
      if (start !== text.length && Object.keys(style).length > 0) {
        runs.push({
          start,
          end: text.length,
          style
        });
      }

      lastIndex = linkRe.lastIndex;
      segmentCount += 1;
    }

    if (segmentCount === 0) {
      return {
        text: decodeHtmlEntities(rawLine),
        runs: [],
        segmentCount: 0
      };
    }

    text += decodeHtmlEntities(rawLine.slice(lastIndex));

    return {
      text,
      runs,
      segmentCount
    };
  }

  function parseRoll20ImageLine(line) {
    const rawLine = typeof line === "string" ? line : "";
    const match = rawLine.match(ROLL20_IMAGE_LINK_RE);
    if (!match) {
      const directImageUrl = normalizeImageUrl(decodeHtmlEntities(rawLine));
      if (!directImageUrl || !isLikelyStandaloneImageUrl(directImageUrl)) return null;

      const fallbackLabel = "이미지";
      return {
        text: fallbackLabel,
        runs: [{
          start: 0,
          end: fallbackLabel.length,
          style: {
            imageUrl: directImageUrl,
            imageAlt: fallbackLabel
          }
        }],
        segmentCount: 1
      };
    }

    const label = decodeHtmlEntities(match[1] || "").trim() || "이미지";
    const imageUrl = normalizeImageUrl(decodeHtmlEntities(match[2] || ""));
    if (!imageUrl) return null;

    return {
      text: label,
      runs: [{
        start: 0,
        end: label.length,
        style: {
          imageUrl,
          imageAlt: label
        }
      }],
      segmentCount: 1
    };
  }

  function isLikelyStandaloneImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    const trimmed = value.trim();
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) return true;

    try {
      const parsed = new URL(trimmed);
      return /\.(?:apng|avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(parsed.pathname);
    } catch (error) {
      return false;
    }
  }

  function parseRoll20InlineStyle(styleText) {
    const probe = document.createElement("span");
    probe.style.cssText = decodeHtmlEntities(styleText || "");

    const parsed = {};
    const fontWeight = `${probe.style.fontWeight || ""}`.trim().toLowerCase();
    const fontWeightNumeric = Number(fontWeight);
    if (fontWeight === "bold" || (Number.isFinite(fontWeightNumeric) && fontWeightNumeric >= 600)) {
      parsed.bold = true;
    }

    const fontStyle = `${probe.style.fontStyle || ""}`.trim().toLowerCase();
    if (fontStyle === "italic" || fontStyle === "oblique") {
      parsed.italic = true;
    }

    const decoration = `${probe.style.textDecoration || ""} ${probe.style.textDecorationLine || ""}`.toLowerCase();
    if (decoration.includes("underline")) {
      parsed.underline = true;
    }
    if (decoration.includes("line-through")) {
      parsed.strike = true;
    }

    if (probe.style.color) {
      parsed.color = probe.style.color;
    }
    if (isOpaqueColor(probe.style.backgroundColor || "")) {
      parsed.backgroundColor = probe.style.backgroundColor;
    }

    const backgroundImage = `${probe.style.backgroundImage || ""}`.trim();
    if (/gradient\(/i.test(backgroundImage)) {
      parsed.backgroundImage = backgroundImage;
    }

    const fontSize = normalizeRoll20FontSize(probe.style.fontSize);
    if (fontSize != null) {
      parsed.fontSize = fontSize;
    }

    const display = `${probe.style.display || ""}`.trim().toLowerCase();
    if (["inline", "inline-block", "block"].includes(display)) {
      parsed.display = display;
    }

    if (probe.style.padding) {
      parsed.padding = probe.style.padding;
    }
    if (probe.style.margin) {
      parsed.margin = probe.style.margin;
    }
    if (probe.style.borderRadius) {
      parsed.borderRadius = probe.style.borderRadius;
    }
    if (probe.style.border) {
      parsed.border = probe.style.border;
    }
    if (probe.style.letterSpacing) {
      parsed.letterSpacing = probe.style.letterSpacing;
    }
    if (probe.style.lineHeight) {
      parsed.lineHeight = probe.style.lineHeight;
    }

    const textAlign = cleanupAlign(probe.style.textAlign || "");
    if (textAlign) {
      parsed.textAlign = textAlign;
    }

    if (probe.style.textShadow) {
      parsed.textShadow = probe.style.textShadow;
    }

    const blur = normalizeBlurValue(probe.style.filter);
    if (blur) {
      parsed.blur = blur;
    }

    const opacity = normalizeRoll20Opacity(probe.style.opacity);
    if (opacity != null) {
      parsed.opacity = opacity;
    }

    return cleanupStyle(parsed);
  }

  function normalizeRoll20FontSize(value) {
    if (value == null) return null;
    const numeric = Math.round(parseFloat(String(value).trim()));
    if (!Number.isFinite(numeric)) return null;
    return clamp(numeric, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }

  function normalizeRoll20Opacity(value) {
    const numeric = Number.parseFloat(String(value || "").trim());
    if (!Number.isFinite(numeric)) return null;
    return clamp(numeric, 0, 1);
  }

  function decodeHtmlEntities(value) {
    if (typeof value !== "string" || !value) return "";
    if (!/[&]/.test(value)) return value;

    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  function isVisibleChatMacroMenuForEditor(editor) {
    if (!(editor instanceof HTMLTextAreaElement) || editor.getAttribute("name") !== "text") return false;

    // [v0.0.45] aria-expanded만으로는 판단 불가 — downshift는 입력 도중 항상 true로 둠.
    // 사용자가 실제 메뉴 항목을 하이라이트 중일 때만 activeDescendant가 set되므로 그것만 신뢰.
    const controls = [editor, editor.closest?.('[role="combobox"]')]
      .filter((control) => control instanceof HTMLElement);
    if (controls.some((control) => {
      const activeDescendant = control.getAttribute("aria-activedescendant");
      return !!activeDescendant && !!document.getElementById(activeDescendant);
    })) {
      return true;
    }

    // 추가로, 실제 메뉴 요소가 화면에 보이고 텍스트가 있는지 검증
    const inputId = editor.id || "";
    const relatedIds = new Set([
      editor.getAttribute("aria-controls"),
      editor.getAttribute("aria-owns"),
      inputId.endsWith("-input") ? `${inputId.slice(0, -6)}-menu` : ""
    ].filter(Boolean));
    const directMenus = [...relatedIds]
      .map((id) => document.getElementById(id))
      .filter((menu) => menu instanceof HTMLElement);
    const candidates = [...new Set([...directMenus, ...document.querySelectorAll(CHAT_MACRO_MENU_SELECTOR)])];

    return candidates.some((menu) => {
      if (!(menu instanceof HTMLElement)) return false;
      if (menu.closest?.(`[${SAFE_UI_ATTR}="1"], #${MODAL_ID}`)) return false;
      if (!isVisible(menu) || !String(menu.textContent || "").trim()) return false;

      // [v0.0.45] 빈 메뉴(자식 없음)는 visible로 안 침
      const hasItems = menu.querySelector('[role="option"], li, [data-index]');
      if (!hasItems) return false;

      if (relatedIds.has(menu.id)) {
        // 관련 메뉴라도 실제로 박스 크기가 의미 있어야 함
        const menuRect = menu.getBoundingClientRect();
        return menuRect.width > 0 && menuRect.height > 0;
      }

      const editorRect = editor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      return menuRect.width > 0 &&
        menuRect.height > 0 &&
        menuRect.left < editorRect.right &&
        menuRect.right > editorRect.left &&
        menuRect.top < editorRect.top &&
        menuRect.bottom <= editorRect.bottom;
    });
  }

  function bindSendButtons() {
    const buttons = document.querySelectorAll('button[type="submit"]');
    buttons.forEach((btn) => {
      if (btn.dataset.ccfSendBound === "1") return;
      btn.dataset.ccfSendBound = "1";

      // Run after other capture-phase transport helpers so this envelope is the final outgoing value.
      btn.addEventListener("click", (event) => {
        const composer = findClosestComposerBar(btn);
        const editor = composer ? findEditorFromComposer(composer) : findEditorFromNode(btn);
        if (!editor) return;
        activeComposer = composer || findComposerForEditor(editor);
        activeEditor = editor;
        lastFocusedEditor = editor;

        const hadMessage = !!stripInvisibleEnvelope(getEditorText(editor)).trim();
        if (preparePayloadForSend(editor, { composer: activeComposer }) === false) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }

        if (hadMessage) {
          scheduleInlineFormatResetAfterSend(editor);
        }
      });
    });
  }

  // 채팅 입력창에 이미지 삽입 (#72) — placeholder 텍스트 + image run
  function insertImageIntoComposerEditor(editor, imageUrl, imageAlt = "") {
    const normalizedUrl = prepareImageUrlForTransport(imageUrl);
    if (!normalizedUrl) {
      alert("이미지가 너무 크거나 저장 공간이 부족해 추가할 수 없습니다. 이미지 링크를 사용해주세요.");
      return false;
    }
    const st = ensureEditorState(editor);
    const baseText = stripInvisibleEnvelope(getEditorText(editor));
    const fallback = { start: baseText.length, end: baseText.length };
    const selection = normalizeSelectionRange(getEditorSelection(editor) || fallback, baseText.length) || fallback;
    const placeholderText = getImagePlaceholderText(imageAlt);
    const nextText = baseText.slice(0, selection.start) + placeholderText + baseText.slice(selection.end);
    const nextRuns = rebaseRunsForTextReplacement(
      cloneRuns(st.runs, baseText.length),
      selection,
      placeholderText,
      baseText.length,
      nextText.length,
      [{
        start: selection.start,
        end: selection.start + placeholderText.length,
        style: { imageUrl: normalizedUrl, imageAlt: normalizeImageAlt(imageAlt) || placeholderText }
      }]
    );
    const nextAlignRuns = rebaseAlignRunsForTextReplacement(
      cloneAlignRuns(st.alignRuns, getTextLineCount(baseText)),
      baseText, selection, placeholderText, nextText
    );
    // setEditorText의 input 이벤트가 runs를 diff 기반으로 재계산하므로,
    // 텍스트를 먼저 넣고 그 뒤에 최종 계산값으로 덮어쓴다.
    setEditorText(editor, nextText);
    const st2 = ensureEditorState(editor);
    st2.runs = nextRuns;
    st2.alignRuns = nextAlignRuns;
    st2.text = nextText;
    try {
      const caret = selection.start + placeholderText.length;
      editor.setSelectionRange?.(caret, caret);
    } catch (_) {}
    try { syncEditorVisualPreview(editor); } catch (_) {}
    return true;
  }

  // 채팅 입력창 paste — 이미지 파일/이미지 URL만 가로채고 일반 텍스트는 통과 (#72)
  function handleComposerImagePaste(editor, event) {
    const clipboard = event?.clipboardData;
    if (!clipboard) return false;
    // 1) 이미지 파일 (스크린샷 복사 등) — Data URL로 변환해 메시지 본문에 직접 싣는다.
    // 외부 업로드/Firebase Storage 없이 모두에게 보이게 하되, 큰 이미지는 제한한다.
    const files = getClipboardImageFiles(event);
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const file = files[0];
      console.info("[CCF] composer image paste — Firestore 저장 시작:", file.name || "(clipboard)");
      uploadImageFilesToIfh([file]).then((uploads) => {
        const imageUrl = normalizeImageUrl(uploads?.[0]?.imageUrl || "");
        if (!imageUrl) {
          alert("이미지를 저장했지만 Firestore 이미지 토큰을 만들지 못했습니다.");
          return;
        }
        if (!insertImageIntoComposerEditor(editor, imageUrl, getImageAltFromFile(file))) {
          return;
        }
        console.info("[CCF] composer image paste — Firestore 이미지 토큰 삽입 완료", imageUrl);
      }).catch((error) => {
        console.warn("[CCF] composer image upload failed:", error);
        alert(getIfhUploadErrorMessage(error));
        maybeOpenIfhHelpPage(error);
      });
      return true;
    }
    // 2) plain text 자체가 이미지 URL
    const plain = (clipboard.getData("text/plain") || "").trim();
    if (plain && looksLikeClipboardImageUrl(plain)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      insertImageIntoComposerEditor(editor, normalizeClipboardImageUrlText(plain), getImageAltFromUrl(plain));
      return true;
    }
    // 3) plain text 없이 html/uri-list 에 이미지만 있는 경우 (웹 이미지 우클릭 복사)
    if (!plain) {
      const payload = extractClipboardImagePayload(event);
      if (payload?.imageUrl) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        insertImageIntoComposerEditor(editor, payload.imageUrl, payload.imageAlt);
        return true;
      }
    }
    return false; // 일반 텍스트 paste — 기본 동작 유지
  }

  function bindEnterSendForEditors() {
    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    let newBindings = 0;
    editors.forEach((candidate) => {
      const editor = normalizeEditorCandidate(candidate);
      if (!editor) return;
      if (editor.dataset.ccfPasteBound !== "1") {
        editor.dataset.ccfPasteBound = "1";
        editor.addEventListener("paste", (event) => {
          try { handleComposerImagePaste(editor, event); } catch (error) {
            console.warn("[CCF] composer paste handler error:", error);
          }
        }, true);
      }
      if (editor.dataset.ccfEnterBound === "1") return;

      editor.dataset.ccfEnterBound = "1";
      newBindings += 1;
      // React reads the value at an ancestor during bubbling; finalize formatting at the input first.
      editor.addEventListener("keydown", (event) => {
        // [CCF NAR] keydown 진입 가장 윗단 - 가드 통과 전이라도 무조건 로그
        if (event.key === "Enter") {
          console.info("[CCF NAR] keydown ENTER on bound editor: isComposing=%o, shiftKey=%o, macroMenu=%o, editor=%o",
            event.isComposing, event.shiftKey, isVisibleChatMacroMenuForEditor(editor), editor);
        }
        if (event.isComposing) return;
        if (event.key !== "Enter") return;
        if (event.shiftKey) return;
        if (isVisibleChatMacroMenuForEditor(editor)) return;
        console.info("[CCF NAR] keydown ENTER passed guards — calling preparePayloadForSend");
        const composer = findComposerForEditor(editor);
        activeComposer = composer;
        activeEditor = editor;
        lastFocusedEditor = editor;
        const hadMessage = !!stripInvisibleEnvelope(getEditorText(editor)).trim();
        if (preparePayloadForSend(editor, { composer }) === false) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }

        if (hadMessage) {
          // CCFOLIA removed native Enter→send binding; manually trigger the composer submit
          // button so format-sync's Enter-to-send behavior is preserved.
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          scheduleInlineFormatResetAfterSend(editor);
          triggerComposerSubmit(editor);
        }
      });
    });
    if (newBindings > 0) {
      console.info("[CCF NAR] bindEnterSendForEditors: newBindings=%o (total editors=%o)", newBindings, editors.length);
    }
  }

  function bindEditorVisualPreview() {
    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    editors.forEach((candidate) => {
      const editor = normalizeEditorCandidate(candidate);
      if (!editor) {
        clearEditorVisualPreview(candidate);
        return;
      }
      if (!(editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)) return;
      if (editor.dataset.ccfVisualPreviewBound !== "1") {
        editor.dataset.ccfVisualPreviewBound = "1";
        const sync = () => syncEditorVisualPreview(editor);
        editor.addEventListener("scroll", sync, { passive: true });
        editor.addEventListener("focus", sync, true);
        editor.addEventListener("blur", sync, true);
        editor.addEventListener("click", sync, true);
        editor.addEventListener("keyup", sync, true);
      }
      syncEditorVisualPreview(editor);
    });
  }

  function syncAllEditorVisualPreviews() {
    document.querySelectorAll(EDITOR_SELECTOR).forEach((candidate) => {
      const editor = normalizeEditorCandidate(candidate);
      if (!editor) {
        clearEditorVisualPreview(candidate);
        return;
      }
      syncEditorVisualPreview(editor);
    });
  }

  function ensureEditorVisualPreview(editor) {
    if (!(editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)) return null;

    const existing = EDITOR_VISUAL_PREVIEW.get(editor);
    if (existing?.overlay?.isConnected && existing.content?.isConnected) {
      return existing;
    }

    const host = editor.parentElement;
    if (!host) return null;

    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }

    const overlay = document.createElement("div");
    overlay.className = "ccf-editor-preview-layer";
    overlay.setAttribute(SAFE_UI_ATTR, "1");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";

    const content = document.createElement("div");
    content.className = "ccf-editor-preview-content";
    overlay.appendChild(content);
    host.appendChild(overlay);

    const entry = { host, overlay, content, baseColor: "" };
    EDITOR_VISUAL_PREVIEW.set(editor, entry);
    return entry;
  }

  function syncEditorVisualPreview(editor) {
    if (!(editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement)) return;
    if (!normalizeEditorCandidate(editor)) {
      clearEditorVisualPreview(editor);
      return;
    }

    const entry = ensureEditorVisualPreview(editor);
    if (!entry) return;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const state = ensureEditorState(editor);
    // #68 — 입력칸 미리보기에는 나레이션(이탤릭+가운데) 미적용. 커서 위치 확인 가능해야 함.
    // 나레이션 스타일은 전송 후 채팅 로그 렌더에서만 적용.
    const blockStyle = { ...applyAutomaticNarration(state.blockStyle) };
    delete blockStyle.narration;
    const runs = applyNarrationPreviewRuns(state.runs, text, blockStyle);
    const alignRuns = getEffectiveAlignRuns(text, state.alignRuns, blockStyle);
    const shouldShow = !!text && (runs.length > 0 || alignRuns.length > 0) && isVisible(editor);

    if (!shouldShow) {
      hideEditorVisualPreview(editor, entry);
      return;
    }

    const computed = getComputedStyle(editor);
    layoutEditorVisualPreview(editor, entry, computed, alignRuns);
    renderStyledText(entry.content, text, runs, alignRuns);
    syncEditorVisualPreviewScroll(editor, entry);

    editor.style.setProperty(
      "--ccf-editor-caret-color",
      computed.caretColor && computed.caretColor !== "auto" ? computed.caretColor : computed.color
    );
    editor.classList.add("ccf-editor-preview-source");
    entry.overlay.style.display = "block";
  }

  function clearEditorVisualPreview(editor) {
    if (!(editor instanceof HTMLElement)) return;
    const entry = EDITOR_VISUAL_PREVIEW.get(editor);
    if (entry?.overlay instanceof HTMLElement) {
      entry.overlay.remove();
    }
    EDITOR_VISUAL_PREVIEW.delete(editor);
    editor.classList.remove("ccf-editor-preview-source");
    editor.style.removeProperty("--ccf-editor-caret-color");
  }

  function hideEditorVisualPreview(editor, entry = EDITOR_VISUAL_PREVIEW.get(editor)) {
    if (!entry) return;
    entry.overlay.style.display = "none";
    editor.classList.remove("ccf-editor-preview-source");
    editor.style.removeProperty("--ccf-editor-caret-color");
  }

  function layoutEditorVisualPreview(editor, entry, computed = getComputedStyle(editor), alignRuns = []) {
    const { overlay, content } = entry;
    overlay.style.left = `${editor.offsetLeft}px`;
    overlay.style.top = `${editor.offsetTop}px`;
    overlay.style.width = `${editor.offsetWidth}px`;
    overlay.style.height = `${editor.offsetHeight}px`;
    overlay.style.paddingTop = computed.paddingTop;
    overlay.style.paddingRight = computed.paddingRight;
    overlay.style.paddingBottom = computed.paddingBottom;
    overlay.style.paddingLeft = computed.paddingLeft;
    overlay.style.borderRadius = computed.borderRadius;
    overlay.style.font = computed.font;
    overlay.style.lineHeight = computed.lineHeight;
    overlay.style.letterSpacing = computed.letterSpacing;
    overlay.style.textAlign = alignRuns.length ? "" : computed.textAlign;
    overlay.style.textIndent = computed.textIndent;
    overlay.style.textTransform = computed.textTransform;
    overlay.style.color = resolveEditorPreviewColor(editor, computed, entry);
    overlay.style.whiteSpace = editor instanceof HTMLInputElement ? "pre" : "pre-wrap";
    overlay.style.wordBreak = editor instanceof HTMLInputElement ? "normal" : "break-word";
    overlay.style.overflowWrap = editor instanceof HTMLInputElement ? "normal" : "anywhere";
    content.style.minHeight = `calc(100% + ${editor.scrollTop}px)`;
  }

  function resolveEditorPreviewColor(editor, computed, entry) {
    const hostColor = entry?.host ? getComputedStyle(entry.host).color : "";
    const parentColor = editor.parentElement ? getComputedStyle(editor.parentElement).color : "";
    const webkitTextFill = computed.getPropertyValue("-webkit-text-fill-color");

    const candidates = [
      webkitTextFill,
      hostColor,
      parentColor,
      computed.caretColor !== "auto" ? computed.caretColor : "",
      computed.color,
      entry?.baseColor || ""
    ];

    const resolved = candidates.find((value) => isUsablePreviewColor(value)) || "#f5f5f5";
    const background = resolvePreviewBackgroundColor(editor, entry, computed);

    if (isDarkTextOnDarkBackground(resolved, background)) {
      entry.baseColor = "#f5f5f5";
      return entry.baseColor;
    }

    entry.baseColor = resolved;
    return resolved;
  }

  function resolvePreviewBackgroundColor(editor, entry, computed) {
    const candidates = [
      computed.backgroundColor,
      entry?.host ? getComputedStyle(entry.host).backgroundColor : "",
      editor.parentElement ? getComputedStyle(editor.parentElement).backgroundColor : ""
    ];

    return candidates.find((value) => isOpaqueColor(value)) || "";
  }

  function isUsablePreviewColor(value) {
    if (typeof value !== "string") return false;
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "auto" || normalized === "transparent" || normalized === "inherit") {
      return false;
    }
    if (normalized === "currentcolor") return false;
    return !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(normalized);
  }

  function isOpaqueColor(value) {
    if (!isUsablePreviewColor(value)) return false;
    const parsed = parseCssColor(value);
    return !!parsed && parsed.a > 0;
  }

  function isDarkTextOnDarkBackground(foreground, background) {
    const fg = parseCssColor(foreground);
    if (!fg) return false;

    const fgLum = getColorLuminance(fg);
    if (fgLum > 0.2) return false;

    if (!background) return true;

    const bg = parseCssColor(background);
    if (!bg) return true;

    return getColorLuminance(bg) < 0.35;
  }

  function parseCssColor(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;

    const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      const full = hex.length === 3
        ? hex.split("").map((ch) => ch + ch).join("")
        : hex;
      return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: 1
      };
    }

    const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
    if (!rgbMatch) return null;

    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    if (parts.length < 3) return null;

    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    const a = parts.length >= 4 ? Number(parts[3]) : 1;

    if ([r, g, b, a].some((num) => Number.isNaN(num))) return null;

    return { r, g, b, a };
  }

  function getColorLuminance(color) {
    const channels = [color.r, color.g, color.b].map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function syncEditorVisualPreviewScroll(editor, entry = EDITOR_VISUAL_PREVIEW.get(editor)) {
    if (!entry) return;
    entry.content.style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  }

  function bindEditorInputSync() {
    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    editors.forEach((candidate) => {
      const editor = normalizeEditorCandidate(candidate);
      if (!editor) return;
      if (editor.dataset.ccfInputSyncBound === "1") return;

      editor.dataset.ccfInputSyncBound = "1";
      editor.addEventListener("input", () => {
        if (suppressRoomSync) {
          syncEditorVisualPreview(editor);
          return;
        }

        const state = ensureEditorState(editor);
        const text = stripInvisibleEnvelope(getEditorText(editor));
        const prevText = typeof state.text === "string" ? normalizeEditorText(state.text) : text;
        const diff = getTextReplacementDiff(prevText, text);
        // 서식 유지(keep) ON이면 새로 입력된 글자에 lastStyle을 이어 적용 (#98)
        const keepOn = isInlineFormatKeepEnabled(getInlineToolbarForEditor(editor));

        if (diff) {
          const keepRuns = keepOn && state.lastStyle && diff.insertedText
            ? [{
                start: diff.start,
                end: diff.start + diff.insertedText.length,
                style: { ...state.lastStyle }
              }]
            : [];
          state.runs = rebaseRunsForTextReplacement(
            cloneRuns(state.runs, prevText.length),
            { start: diff.start, end: diff.end },
            diff.insertedText,
            prevText.length,
            text.length,
            keepRuns
          );
          state.alignRuns = rebaseAlignRunsForTextReplacement(
            cloneAlignRuns(state.alignRuns, getTextLineCount(prevText)),
            prevText,
            { start: diff.start, end: diff.end },
            diff.insertedText,
            text
          );
        } else {
          state.runs = normalizeRuns(state.runs, text.length).filter((run) => run.end <= text.length);
          state.alignRuns = normalizeAlignRuns(state.alignRuns, getTextLineCount(text));
        }

        if (!text) {
          state.runs = [];
          state.alignRuns = [];
          if (!keepOn) state.lastStyle = null;
          state.blockStyle = {};
        } else {
          if (state.parentheticalGray) {
            state.runs = applyParentheticalGrayRuns(state.runs, text);
          }
        }

        state.text = text;
        state.roll20Source = null;

        const composer = findComposerForEditor(editor);
        if (composer) {
          updateButtonBadge(composer.querySelector(OPEN_BTN_SELECTOR), editor);
        }

        syncEditorVisualPreview(editor);

        if (!activeEditor || editor !== activeEditor) return;
        if (!isModalOpen()) return;

        modalDraftText = text;
        modalDraftRuns = cloneRuns(state.runs, text.length);
        modalDraftAlignRuns = cloneAlignRuns(state.alignRuns, getTextLineCount(text));
        modalDraftRoll20Text = text;
        if (modalMode === MODAL_MODE_ROLL20) {
          if (!isRoll20EditorFocused()) {
            syncRoomEditorToRoll20Editor(editor);
          }
        } else if (!isModalEditorFocused()) {
          syncRoomEditorToModalEditor(editor);
        }
        renderPreview(editor);
      }, true);
    });
  }

  function normalizeEditorCandidate(node) {
    if (!(node instanceof HTMLElement)) return null;
    if (node.id === "ccf-preview") return null;
    if (node.closest && node.closest(`[${SAFE_UI_ATTR}="1"]`)) return null;
    if (node.closest && node.closest(`#${MODAL_ID}`)) return null;
    const candidate = node.matches?.(EDITOR_SELECTOR) ? node : node.closest?.(EDITOR_SELECTOR);
    if (!(candidate instanceof HTMLElement)) return null;
    if (isCharacterNameInput(candidate)) return null;
    // MUI 다이얼로그(캐릭터 편집 팝업 등) 내부의 textarea는 채팅 입력창이 아니므로
    // 서식 편집 대상에서 제외한다. chatPalette, 캐릭터 소개 등이 이 경로로 필터링된다.
    if (
      candidate instanceof HTMLTextAreaElement &&
      candidate.closest('.MuiDialog-paper, [role="dialog"]')
    ) return null;
    return candidate;
  }

  function isCharacterNameInput(node) {
    return node instanceof HTMLInputElement && node.matches(CHARACTER_NAME_INPUT_SELECTOR);
  }

  function getCurrentTargetEditor() {
    const focused = normalizeEditorCandidate(document.activeElement);
    if (focused && isVisible(focused) && findComposerForEditor(focused)) return focused;
    const recent = normalizeEditorCandidate(lastFocusedEditor);
    if (recent && document.contains(recent) && isVisible(recent)) {
      return recent;
    }

    return pickBestEditor([...document.querySelectorAll(EDITOR_SELECTOR)]) || null;
  }

  function findEditorFromNode(node) {
    const direct = normalizeEditorCandidate(node);
    if (direct && isVisible(direct)) {
      return direct;
    }

    const origin = node instanceof Element ? node : null;
    const composer = origin ? findClosestComposerBar(origin) : null;
    const composerEditor = findEditorFromComposer(composer);
    if (composerEditor) {
      return composerEditor;
    }

    const candidates = new Set();
    let cur = origin;

    for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
      cur.querySelectorAll?.(EDITOR_SELECTOR).forEach((editor) => {
        const normalized = normalizeEditorCandidate(editor);
        if (normalized && isVisible(normalized)) {
          candidates.add(normalized);
        }
      });
    }

    if (!candidates.size) {
      const fallback = getCurrentTargetEditor();
      return fallback || null;
    }

    return pickBestEditor([...candidates], origin || composer) || null;
  }

  // 헤딩 마크다운 (#99) — 줄 시작 "#/##/### " 마커를 제거하고 그 줄에
  // 헤딩 크기를 적용한다. #=24px+굵게, ##=20px, ###=17px.
  function applyHeadingMarkdown(text, runs) {
    if (typeof text !== "string" || !/(?:^|\n)#{1,3} /.test(text)) {
      return { text, runs };
    }
    const sizes = { 1: 24, 2: 20, 3: 17 };
    const lines = text.split("\n");
    let curText = text;
    let curRuns = runs;
    // 뒤 줄부터 마커를 제거해야 앞쪽 오프셋이 꼬이지 않는다.
    // 헤딩 run은 제거 직후 curRuns에 합쳐서 이후(앞 줄) 제거 시 함께 시프트.
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(/^(#{1,3}) /);
      if (!match) continue;
      const level = match[1].length;
      const markerLen = level + 1;
      let lineStart = 0;
      for (let j = 0; j < i; j++) lineStart += lines[j].length + 1;
      curRuns = rebaseRunsForTextReplacement(
        curRuns,
        { start: lineStart, end: lineStart + markerLen },
        "",
        curText.length,
        curText.length - markerLen
      );
      curText = curText.slice(0, lineStart) + curText.slice(lineStart + markerLen);
      curRuns = [
        {
          start: lineStart,
          end: lineStart + lines[i].length - markerLen,
          style: level === 1
            ? { fontSize: sizes[level], bold: true }
            : { fontSize: sizes[level] }
        },
        ...curRuns
      ];
    }
    return { text: curText, runs: curRuns };
  }

  function preparePayloadForSend(editor, options = {}) {
    const isEditDialogEditor = editor instanceof HTMLTextAreaElement
      && editor.closest('[role="dialog"], .MuiDialog-paper')
      && editor.getAttribute("name") === "text";
    if (!isEditDialogEditor) {
      editor = normalizeEditorCandidate(editor);
      if (!editor) return true;
    }

    if (isModalOpen() && activeEditor && editor === activeEditor) {
      syncModalEditorToRoomEditor(true, { editor, composer: options.composer || findComposerForEditor(editor) });
    }

    const currentText = getEditorText(editor);
    // 끝 공백 제거 — trailing space가 가운데 정렬 중심을 왼쪽으로 밀어 보이게 함
    const rawText = stripInvisibleEnvelope(currentText).replace(/[ \t ]+$/, "");
    if (!rawText) return true;

    const decodedCurrent = extractEnvelope(currentText);
    const state = ensureEditorState(editor);
    const blockStyle = applyAutomaticNarration(state.blockStyle);
    let payloadText = rawText;
    if (!state.runs.length && blockStyle.narration === true) {
      const decodedEnvelope = decodedCurrent?.envelope || null;
      const decodedText = typeof decodedEnvelope?.text === "string" ? decodedEnvelope.text : "";
      const decodedRuns = normalizeRuns(decodedEnvelope?.formatRuns, decodedText.length);
      const decodedAlignRuns = cloneAlignRuns(decodedEnvelope?.alignRuns, getTextLineCount(decodedText));
      if (decodedText === rawText && (decodedRuns.length || decodedAlignRuns.length)) {
        payloadText = decodedText;
        state.runs = decodedRuns;
        state.alignRuns = decodedAlignRuns;
        state.text = payloadText;
      } else {
        const parsedRoll20 = parseRoll20MacroToDraft(rawText);
        if (parsedRoll20) {
          payloadText = parsedRoll20.text || "";
          state.runs = cloneRuns(parsedRoll20.runs, payloadText.length);
          state.alignRuns = cloneAlignRuns(parsedRoll20.alignRuns, getTextLineCount(payloadText));
          state.text = payloadText;
          state.roll20Source = rawText;
        }
      }
    }
    if (state.parentheticalGray) {
      state.runs = applyParentheticalGrayRuns(state.runs, payloadText);
    }
    // 헤딩 마크다운 (#99) — 줄 시작 #/##/### + 공백 → 마커 제거 + 그 줄 헤딩 크기
    const heading = applyHeadingMarkdown(payloadText, cloneRuns(state.runs, payloadText.length));
    const sendText = heading.text;
    const baseRuns = heading.runs;
    // 서식 프리셋 자동 적용 (#70) — 메시지 안에 프리셋 이름과 같은 텍스트가 있으면
    // 그 구간에 프리셋 서식을 입혀 전송. 기존 수동 서식이 우선.
    const presetNameRuns = buildPresetNameRuns(sendText);
    const outgoingRuns = presetNameRuns.length
      ? [...presetNameRuns, ...baseRuns]
      : baseRuns;
    const preparedRuns = prepareRunsForTransport(outgoingRuns, sendText.length);
    if (preparedRuns.failed) {
      alert("클립보드나 로컬 이미지를 저장하지 못해 전송을 중단했습니다. 이미지 링크를 사용하거나 이미지를 더 작게 만들어주세요.");
      return false;
    }

    const runs = preparedRuns.runs;
    const alignRuns = getEffectiveAlignRuns(sendText, state.alignRuns, blockStyle);

    // [CCF NAR] 송신 진단 - narration 결정에 영향을 주는 모든 값
    const _narSpeaker = getCurrentSpeakerName();
    const _narSet = readNarratorNameSet();
    console.info("[CCF NAR] preparePayloadForSend: speaker=%o, narratorList=[%s], stateNarration=%o, autoNarration=%o, runs=%o",
      _narSpeaker,
      [..._narSet].join(", "),
      state.blockStyle?.narration === true,
      blockStyle.narration === true,
      runs.length
    );

    if (!runs.length && !alignRuns.length && !blockStyle.narration && sendText === rawText) return true;
    const roll20Source = state.roll20Source;
    state.text = sendText;
    state.runs = runs;

    const envelope = {
      v: 1,
      text: sendText,
      formatRuns: runs,
      alignRuns,
      blockStyle
    };

    const presenceApi = window.__CAPYBARA_TOOLKIT_PRESENCE__;
    if (presenceApi && typeof presenceApi.decorateEnvelope === "function") {
      try {
        presenceApi.decorateEnvelope(envelope, sendText);
      } catch (error) {
        console.warn("[CCF] toolkit presence decoration failed", error);
      }
    }

    const encoded = encodeEnvelopeToInvisible(envelope);
    const outgoing = sendText + encoded;
    if (currentText === outgoing) return true;

    setEditorText(editor, outgoing);
    state.roll20Source = roll20Source;
    schedulePendingSendRestore(editor, sendText, outgoing);
    return true;
  }

  function stripInvisibleEnvelope(text) {
    if (typeof text !== "string" || !text) return "";

    const startIndex = text.indexOf(INVIS_START);
    if (startIndex < 0) return text;

    const endIndex = text.indexOf(INVIS_END, startIndex + INVIS_START.length);
    if (endIndex < 0) return text;

    return text.slice(0, startIndex) + text.slice(endIndex + INVIS_END.length);
  }

  function schedulePendingSendRestore(editor, rawText, outgoing) {
    const token = {};
    const checkpoints = [180, 450, 1000, 2000];

    PENDING_SEND_RESTORE.set(editor, token);

    checkpoints.forEach((delay, index) => {
      setTimeout(() => {
        if (PENDING_SEND_RESTORE.get(editor) !== token) return;

        const current = getEditorText(editor);
        if (current !== outgoing) {
          const restored = stripInvisibleEnvelope(current);
          if (restored !== current) {
            setEditorText(editor, restored);
          }
          PENDING_SEND_RESTORE.delete(editor);
          return;
        }

        if (index < checkpoints.length - 1) return;

        setEditorText(editor, rawText);
        if (PENDING_SEND_RESTORE.get(editor) === token) {
          PENDING_SEND_RESTORE.delete(editor);
        }
      }, delay);
    });
  }

  function encodeEnvelopeToInvisible(obj) {
    const json = JSON.stringify(obj);
    const base64 = utf8ToBase64(json);

    let bits = "";
    for (const ch of base64) {
      bits += ch.charCodeAt(0).toString(2).padStart(8, "0");
    }

    let out = INVIS_START;
    for (let i = 0; i < bits.length; i += 2) {
      const pair = bits.slice(i, i + 2).padEnd(2, "0");
      out += INVIS_MAP[parseInt(pair, 2)];
    }
    out += INVIS_END;

    return out;
  }

  function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function ensureEditorState(editor) {
    let state = EDITOR_STATE.get(editor);
    if (!state) {
      state = {
        text: "",
        runs: [],
        alignRuns: [],
        lastStyle: null,
        blockStyle: {},
        parentheticalGray: false,
        roll20Source: null
      };
      EDITOR_STATE.set(editor, state);
    }
    return state;
  }

  function addOrReplaceRun(existingRuns, newRun, textLength) {
    const oldRuns = normalizeRuns(existingRuns, textLength);
    const next = [];

    for (const run of oldRuns) {
      if (!rangesOverlap(run.start, run.end, newRun.start, newRun.end)) {
        next.push(run);
        continue;
      }

      if (run.start < newRun.start) {
        next.push({
          start: run.start,
          end: newRun.start,
          style: { ...run.style }
        });
      }

      if (run.end > newRun.end) {
        next.push({
          start: newRun.end,
          end: run.end,
          style: { ...run.style }
        });
      }
    }

    if (Object.keys(newRun.style || {}).length > 0) {
      next.push({
        start: newRun.start,
        end: newRun.end,
        style: { ...newRun.style }
      });
    }

    return normalizeRuns(next, textLength);
  }

  function patchStyleObject(baseStyle, stylePatch) {
    const next = { ...(baseStyle || {}) };
    for (const [key, value] of Object.entries(stylePatch || {})) {
      if (value == null || value === false || value === "") {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    return cleanupStyle(next);
  }

  function patchStyleRuns(existingRuns, selection, stylePatch, textLength) {
    const range = normalizeSelectionRange(selection, textLength);
    if (!range || range.start === range.end) {
      return normalizeRuns(existingRuns, textLength);
    }

    const oldRuns = normalizeRuns(existingRuns, textLength);
    const points = new Set([0, textLength, range.start, range.end]);
    oldRuns.forEach((run) => {
      points.add(run.start);
      points.add(run.end);
    });

    const sorted = [...points].sort((a, b) => a - b);
    const next = [];

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (start === end) continue;

      const baseStyle = mergeStyles(
        oldRuns
          .filter((run) => run.start <= start && run.end >= end)
          .map((run) => run.style)
      );

      const style = start >= range.start && end <= range.end
        ? patchStyleObject(baseStyle, stylePatch)
        : cleanupStyle(baseStyle);

      if (Object.keys(style).length > 0) {
        next.push({ start, end, style });
      }
    }

    return normalizeRuns(next, textLength);
  }

  function getSharedStyleValueForSelection(existingRuns, selection, key, textLength) {
    const range = normalizeSelectionRange(selection, textLength);
    if (!range || range.start === range.end) return "";

    const oldRuns = normalizeRuns(existingRuns, textLength);
    const points = new Set([range.start, range.end]);
    oldRuns.forEach((run) => {
      if (rangesOverlap(run.start, run.end, range.start, range.end)) {
        points.add(clamp(run.start, range.start, range.end));
        points.add(clamp(run.end, range.start, range.end));
      }
    });

    const sorted = [...points].sort((a, b) => a - b);
    let sharedValue = null;

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (start === end) continue;

      const style = mergeStyles(
        oldRuns
          .filter((run) => run.start <= start && run.end >= end)
          .map((run) => run.style)
      );
      const value = normalizeSelectionStyleValue(key, style[key]);

      if (sharedValue == null) {
        sharedValue = value;
      } else if (sharedValue !== value) {
        return "";
      }
    }

    return sharedValue || "";
  }

  function normalizeSelectionStyleValue(key, value) {
    if (key === "rubyText") return normalizeRubyText(value);
    if (key === "codeMode") return normalizeCodeMode(value);
    if (key === "tooltipText") return normalizeTooltipText(value);
    if (key === "blur") return normalizeBlurValue(value);
    if (value == null) return "";
    return String(value);
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
      if (
        prev &&
        prev.end === cur.start &&
        JSON.stringify(prev.style) === JSON.stringify(cur.style)
      ) {
        prev.end = cur.end;
      } else {
        merged.push(cur);
      }
    }

    return merged;
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
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
    const borderRadius = String(style.borderRadius || "").trim();
    if (borderRadius) out.borderRadius = borderRadius;
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

    if (trimmed.startsWith(LOCAL_IMAGE_TOKEN_PREFIX) || trimmed.startsWith(FIRESTORE_IMAGE_TOKEN_PREFIX)) {
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
      const parsed = new URL(trimmed);
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

  function isFirestoreImageToken(value) {
    return typeof value === "string" && value.startsWith(FIRESTORE_IMAGE_TOKEN_PREFIX);
  }

  function parseFirestoreImageToken(value) {
    if (!isFirestoreImageToken(value)) return null;
    const body = value.slice(FIRESTORE_IMAGE_TOKEN_PREFIX.length);
    const slash = body.indexOf("/");
    if (slash <= 0) return null;
    const roomId = decodeURIComponent(body.slice(0, slash));
    const imageId = decodeURIComponent(body.slice(slash + 1));
    return roomId && imageId ? { roomId, imageId } : null;
  }

  function getCachedFirestoreImageUrl(token) {
    const api = window.__CCF_FORMAT_SYNC_IMAGE_STORE__;
    return api && typeof api.peek === "function" ? api.peek(token) : "";
  }

  function resolveFirestoreImageToken(token) {
    const api = window.__CCF_FORMAT_SYNC_IMAGE_STORE__;
    if (api && typeof api.resolve === "function") return api.resolve(token);
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const waitForStore = () => {
        const nextApi = window.__CCF_FORMAT_SYNC_IMAGE_STORE__;
        if (nextApi && typeof nextApi.resolve === "function") {
          nextApi.resolve(token).then(resolve, reject);
          return;
        }
        attempts += 1;
        if (attempts >= 40) {
          reject(new Error("firestore-image-store-not-ready"));
          return;
        }
        setTimeout(waitForStore, 250);
      };
      waitForStore();
    });
  }

  function getLocalImageTokenId(value) {
    return isLocalImageToken(value) ? value.slice(LOCAL_IMAGE_TOKEN_PREFIX.length) : "";
  }

  function getLocalImageStorageKey(id) {
    return `${LOCAL_IMAGE_STORAGE_PREFIX}${id}`;
  }

  function readLocalImageIndex() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(LOCAL_IMAGE_INDEX_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && id) : [];
    } catch (error) {
      return [];
    }
  }

  function writeLocalImageIndex(ids) {
    try {
      window.localStorage.setItem(
        LOCAL_IMAGE_INDEX_KEY,
        JSON.stringify([...new Set(ids.filter((id) => typeof id === "string" && id))].slice(-LOCAL_IMAGE_MAX_ENTRIES))
      );
    } catch (error) {
      console.warn("[CCF] failed to write local image index", error);
    }
  }

  function pruneLocalImageCache(removals = 1) {
    const index = readLocalImageIndex();
    if (!index.length) return false;

    const next = [...index];
    let removed = 0;
    while (next.length && removed < removals) {
      const id = next.shift();
      try {
        window.localStorage.removeItem(getLocalImageStorageKey(id));
      } catch (error) {
        console.warn("[CCF] failed to prune local image cache", error);
      }
      removed += 1;
    }

    writeLocalImageIndex(next);
    return removed > 0;
  }

  function rememberLocalImageToken(id) {
    const next = readLocalImageIndex().filter((item) => item !== id);
    next.push(id);
    while (next.length > LOCAL_IMAGE_MAX_ENTRIES) {
      const removedId = next.shift();
      try {
        window.localStorage.removeItem(getLocalImageStorageKey(removedId));
      } catch (error) {
        console.warn("[CCF] failed to trim local image cache", error);
      }
    }
    writeLocalImageIndex(next);
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
    if (isFirestoreImageToken(normalized)) {
      return getCachedFirestoreImageUrl(normalized);
    }
    return normalized;
  }

  function getCachedFirestoreImageUrl(token) {
    const cached = firestoreImageCache.get(token);
    if (!cached) return "";
    cached.lastUsed = Date.now();
    return cached.url || "";
  }

  function rememberFirestoreImageUrl(token, url) {
    if (!token || !url) return;
    const old = firestoreImageCache.get(token);
    if (old?.url && old.url !== url && old.url.startsWith("blob:")) {
      URL.revokeObjectURL(old.url);
    }
    firestoreImageCache.set(token, { url, lastUsed: Date.now() });
    if (firestoreImageCache.size <= FIRESTORE_IMAGE_CACHE_LIMIT) return;
    const entries = [...firestoreImageCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (entries.length && firestoreImageCache.size > FIRESTORE_IMAGE_CACHE_LIMIT) {
      const [oldToken, oldEntry] = entries.shift();
      firestoreImageCache.delete(oldToken);
      if (oldEntry?.url?.startsWith("blob:")) URL.revokeObjectURL(oldEntry.url);
    }
  }

  function dataUrlToBlobUrl(dataUrl) {
    try {
      const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.*)$/i);
      if (!match) return "";
      const mimeType = match[1] || "image/png";
      const binary = atob(match[2] || "");
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    } catch (error) {
      console.warn("[CCF] failed to build image blob URL", error);
      return "";
    }
  }

  function persistLocalImageDataUrl(value) {
    const normalized = normalizeImageUrl(value);
    if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
      return normalized;
    }

    const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const key = getLocalImageStorageKey(id);

    for (let attempt = 0; attempt < LOCAL_IMAGE_MAX_ENTRIES; attempt += 1) {
      try {
        window.localStorage.setItem(key, normalized);
        rememberLocalImageToken(id);
        return `${LOCAL_IMAGE_TOKEN_PREFIX}${id}`;
      } catch (error) {
        if (!pruneLocalImageCache(1)) {
          console.warn("[CCF] failed to persist local image", error);
          return "";
        }
      }
    }

    return "";
  }

  function prepareImageUrlForTransport(value) {
    const normalized = normalizeImageUrl(value);
    if (!normalized) return "";
    if (isLocalImageToken(normalized)) return resolveStoredLocalImageUrl(normalized) || normalized;
    if (isFirestoreImageToken(normalized)) return normalized;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) && normalized.length > DATA_URL_TRANSPORT_MAX_CHARS) {
      return "";
    }
    return normalized;
  }

  function prepareRunsForTransport(runs, textLength) {
    const normalizedRuns = normalizeRuns(runs, textLength);
    let failed = false;

    const next = normalizedRuns
      .map((run) => {
        const style = { ...run.style };
        if (style.imageUrl) {
          const preparedUrl = prepareImageUrlForTransport(style.imageUrl);
          if (!preparedUrl) {
            failed = true;
            delete style.imageUrl;
          } else {
            style.imageUrl = preparedUrl;
          }
        }

        return {
          start: run.start,
          end: run.end,
          style
        };
      })
      .filter((run) => Object.keys(cleanupStyle(run.style)).length > 0);

    return {
      runs: normalizeRuns(next, textLength),
      failed
    };
  }

  function normalizeFontSizeValue(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const numeric = Math.round(Number(trimmed));
    if (!Number.isFinite(numeric)) return null;
    return clamp(numeric, FONT_SIZE_MIN, FONT_SIZE_MAX);
  }

  function getFontSizeInput() {
    return document.getElementById("ccf-fontsize-input");
  }

  function getFontSizeTool() {
    return document.querySelector(`#${MODAL_ID} .ccf-size-tool`);
  }

  function getFontSizeDisplay() {
    return document.getElementById("ccf-fontsize-display");
  }

  function getFontSizeOptions() {
    return [...(getFontSizeTool()?.querySelectorAll(".ccf-size-option") || [])];
  }

  function getFontSizeLabel(value) {
    return value == null ? "기본" : String(value);
  }

  function getFontSizeLabel(value) {
    return value == null ? "\uAE30\uBCF8" : String(value);
  }

  function normalizeCssPixelFontSize(value) {
    const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    return normalizeFontSizeValue(match[0]);
  }

  function getDefaultModalFontSize() {
    const modalEditor = getModalEditor();
    if (modalEditor) {
      const computed = normalizeCssPixelFontSize(window.getComputedStyle(modalEditor).fontSize);
      if (computed != null) return computed;
    }
    return FONT_SIZE_PRESETS[2];
  }

  function getFontSizeFromToolState() {
    return normalizeFontSizeValue(getFontSizeTool()?.dataset.currentSize || "");
  }

  function isFontSizeEditorOpen() {
    return getFontSizeTool()?.classList.contains("editing") || false;
  }

  function syncFontSizeOptionState(value) {
    const normalized = normalizeFontSizeValue(value);
    getFontSizeOptions().forEach((option) => {
      const optionSize = normalizeFontSizeValue(option.dataset.size || "");
      const isActive = normalized == null ? option.dataset.size === "" : optionSize === normalized;
      option.classList.toggle("active", isActive);
      option.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function setFontSizeControls(value, options = {}) {
    const input = getFontSizeInput();
    const display = getFontSizeDisplay();
    const tool = getFontSizeTool();
    const normalized = normalizeFontSizeValue(value);
    const nextValue = normalized == null ? "" : String(normalized);
    const currentSize = normalizeFontSizeValue(options.currentSize);
    const displayText = String(options.displayText || getFontSizeLabel(normalized));
    const displayEmpty = options.displayEmpty != null ? !!options.displayEmpty : normalized == null;

    if (input) {
      input.value = nextValue;
      input.placeholder = currentSize != null && normalized == null ? String(currentSize) : "\uAE30\uBCF8";
    }
    if (display) {
      display.textContent = displayText;
      display.dataset.empty = displayEmpty ? "1" : "0";
      if (options.title) display.title = options.title;
      else display.removeAttribute("title");
    }
    if (tool) {
      if (currentSize != null) tool.dataset.currentSize = String(currentSize);
      else delete tool.dataset.currentSize;
    }
    syncFontSizeOptionState(nextValue);

    return normalized;
  }

  function getFontSizeStyleAtOffset(runs, offset, textLength) {
    const safeLength = Math.max(0, Number(textLength) || 0);
    if (safeLength <= 0) return normalizeFontSizeValue(modalDraftLastStyle?.fontSize);

    const probeOffset = clamp(offset > 0 ? offset - 1 : offset, 0, safeLength - 1);
    const style = mergeStyles(
      normalizeRuns(runs, safeLength)
        .filter((run) => run.start <= probeOffset && run.end > probeOffset)
        .map((run) => run.style)
    );
    return normalizeFontSizeValue(style.fontSize);
  }

  function getFontSizeStateForSelection(runs, selection, textLength) {
    const safeTextLength = Math.max(0, Number(textLength) || 0);
    const range = normalizeSelectionRange(selection, safeTextLength);
    if (!range) return { value: null, mixed: false };
    if (range.start === range.end) {
      return {
        value: getFontSizeStyleAtOffset(runs, range.start, safeTextLength),
        mixed: false
      };
    }

    const oldRuns = normalizeRuns(runs, safeTextLength);
    const points = new Set([range.start, range.end]);
    oldRuns.forEach((run) => {
      if (!rangesOverlap(run.start, run.end, range.start, range.end)) return;
      points.add(clamp(run.start, range.start, range.end));
      points.add(clamp(run.end, range.start, range.end));
    });

    const sorted = [...points].sort((a, b) => a - b);
    let shared = Symbol("unset");

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const start = sorted[i];
      const end = sorted[i + 1];
      if (start === end) continue;

      const style = mergeStyles(
        oldRuns
          .filter((run) => run.start <= start && run.end >= end)
          .map((run) => run.style)
      );
      const value = normalizeFontSizeValue(style.fontSize);

      if (typeof shared === "symbol") {
        shared = value;
      } else if (shared !== value) {
        return { value: null, mixed: true };
      }
    }

    return {
      value: typeof shared === "symbol" ? null : shared,
      mixed: false
    };
  }

  function syncFontSizeControlsFromModalSelection() {
    if (!isModalOpen() || isFontSizeEditorOpen() || modalMode !== MODAL_MODE_CCFOLIA) return;

    const modalEditor = getModalEditor();
    const editor = getResolvedActiveEditor() || activeEditor;
    if (!modalEditor || !editor) return;

    const text = typeof modalDraftText === "string" ? modalDraftText : getEditorText(modalEditor);
    const selection = normalizeSelectionRange(
      getModalSelection() || getEditorSelection(modalEditor) || { start: text.length, end: text.length },
      text.length
    );
    const runs = cloneRuns(modalDraftRuns ?? ensureEditorState(editor).runs, text.length);
    const state = getFontSizeStateForSelection(runs, selection, text.length);

    if (state.mixed) {
      setFontSizeControls("", {
        displayText: "\uD63C\uD569",
        displayEmpty: false,
        title: "\uC120\uD0DD \uC601\uC5ED\uC5D0 \uC5EC\uB7EC \uAE00\uC790 \uD06C\uAE30\uAC00 \uC11E\uC5EC \uC788\uC2B5\uB2C8\uB2E4."
      });
      return;
    }

    if (state.value != null) {
      setFontSizeControls(state.value, {
        currentSize: state.value,
        title: `\uD604\uC7AC \uAE00\uC790 \uD06C\uAE30: ${state.value}px`
      });
      return;
    }

    const defaultSize = getDefaultModalFontSize();
    setFontSizeControls("", {
      currentSize: defaultSize,
      displayText: String(defaultSize),
      displayEmpty: false,
      title: `\uD604\uC7AC \uAE00\uC790 \uD06C\uAE30: ${defaultSize}px (\uAE30\uBCF8)`
    });
  }

  function openFontSizeEditor() {
    const tool = getFontSizeTool();
    const display = getFontSizeDisplay();
    const input = getFontSizeInput();
    if (!tool || !display || !input) return;

    tool.classList.add("editing");
    display.setAttribute("aria-expanded", "true");
    syncFontSizeOptionState(input.value);

    setTimeout(() => {
      if (!tool.classList.contains("editing")) return;
      input.focus({ preventScroll: true });
      input.select();
    }, 0);
  }

  function closeFontSizeEditor(options = {}) {
    const { focusEditor = false } = options;
    const tool = getFontSizeTool();
    const display = getFontSizeDisplay();
    if (!tool || !display) return;

    tool.classList.remove("editing");
    display.setAttribute("aria-expanded", "false");

    if (focusEditor) {
      focusModalEditorForStyleInput();
      return;
    }

    restoreModalSelectionSoon();
  }

  function stepFontSize(delta) {
    const baseSize = getFontSizeFromControls() ?? getFontSizeFromToolState() ?? FONT_SIZE_PRESETS[2];
    setFontSizeControls(baseSize + delta);
    applyCurrentModalStyle({ silent: true, previewOnly: true });
    restoreModalSelectionSoon();
  }

  function commitFontSizeInput() {
    const input = getFontSizeInput();
    return setFontSizeControls(input?.value || "");
  }

  function getFontSizeFromControls() {
    const input = getFontSizeInput();
    return normalizeFontSizeValue(input?.value || "");
  }

  function focusModalEditorForStyleInput() {
    const modalEditor = getModalEditor();
    if (!modalEditor) return;
    modalEditor.focus({ preventScroll: true });
    restoreModalSelectionSoon();
  }

  function getTextLines(text) {
    const normalized = typeof text === "string" ? text : "";
    if (!normalized.length) {
      return [{
        index: 0,
        start: 0,
        end: 0,
        text: "",
        hasBreak: false
      }];
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

  function cloneAlignRuns(runs, lineCount) {
    return normalizeAlignRuns(runs, lineCount).map((run) => ({
      start: run.start,
      end: run.end,
      align: run.align
    }));
  }

  function addOrReplaceAlignRun(existingRuns, newRun, lineCount) {
    const oldRuns = normalizeAlignRuns(existingRuns, lineCount);
    const next = [];

    for (const run of oldRuns) {
      if (!rangesOverlap(run.start, run.end, newRun.start, newRun.end)) {
        next.push(run);
        continue;
      }

      if (run.start < newRun.start) {
        next.push({
          start: run.start,
          end: newRun.start,
          align: run.align
        });
      }

      if (run.end > newRun.end) {
        next.push({
          start: newRun.end,
          end: run.end,
          align: run.align
        });
      }
    }

    if (newRun.align) {
      next.push({
        start: newRun.start,
        end: newRun.end,
        align: newRun.align
      });
    }

    return normalizeAlignRuns(next, lineCount);
  }

  function cleanupBlockStyle(style) {
    const out = {};
    if (style && ["center", "right"].includes(style.align)) {
      out.align = style.align;
    }
    if (style?.narration === true) {
      out.narration = true;
    }
    return out;
  }

  function getLegacyAlignRuns(text, blockStyle) {
    const legacy = cleanupBlockStyle(blockStyle);
    const align = cleanupAlign(legacy.align);
    if (!align) return [];

    return [{
      start: 0,
      end: getTextLineCount(text),
      align
    }];
  }

  function getEffectiveAlignRuns(text, alignRuns, blockStyle = null) {
    if (cleanupBlockStyle(blockStyle).narration) {
      return [{
        start: 0,
        end: getTextLineCount(text),
        align: "center"
      }];
    }
    const normalized = normalizeAlignRuns(alignRuns, getTextLineCount(text));
    if (normalized.length) return normalized;
    return getLegacyAlignRuns(text, blockStyle);
  }

  function hasAlignRuns(text, alignRuns, blockStyle = null) {
    return getEffectiveAlignRuns(text, alignRuns, blockStyle).length > 0;
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
      if (style) {
        Object.assign(out, style);
      }
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
    if (style.borderRadius) el.style.borderRadius = style.borderRadius;
    if (style.border) el.style.border = style.border;
    if (style.letterSpacing) el.style.letterSpacing = style.letterSpacing;
    if (style.lineHeight) el.style.lineHeight = style.lineHeight;
    if (style.textAlign) el.style.textAlign = style.textAlign;
    if (style.textShadow) el.style.textShadow = style.textShadow;
    if (style.blur) applySoftBlur(el, style.blur);
    if (style.opacity != null) el.style.opacity = String(style.opacity);
  }

  function appendStyledFragment(container, frag) {
    if (!container || !frag) return;

    container.appendChild(createStyledFragmentNode(frag));
  }

  function createStyledFragmentNode(frag) {
    if (frag.style?.imageUrl) {
      return createImageFragmentNode(frag);
    }

    if (frag.style?.tooltipText) {
      return createTooltipFragmentNode(frag);
    }

    if (frag.style?.codeMode) {
      return createCodeFragmentNode(frag);
    }

    if (frag.style?.rubyText) {
      return createRubyFragmentNode(frag);
    }

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
    if (frag.style?.blur) applySoftBlur(wrapper, frag.style.blur);

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

    const rawImageUrl = normalizeImageUrl(frag.style.imageUrl);
    const imageUrl = resolveRenderableImageUrl(rawImageUrl);
    if (!imageUrl) {
      const fallback = document.createElement("span");
      fallback.textContent = isFirestoreImageToken(rawImageUrl) ? "이미지 불러오는 중…" : (frag.style.imageAlt || frag.text || "image");
      applyInlineStyle(fallback, frag.style);
      wrapper.appendChild(fallback);
      if (isFirestoreImageToken(rawImageUrl)) {
        void resolveFirestoreImageToken(rawImageUrl).then(() => {
          const next = createImageFragmentNode(frag);
          wrapper.replaceWith(next);
        }).catch((error) => {
          console.warn("[CCF] failed to resolve Firestore image", error);
          fallback.textContent = "이미지를 불러오지 못했습니다";
        });
      }
      return wrapper;
    }

    const img = document.createElement("img");
    img.className = "ccf-image";
    img.src = imageUrl;
    img.alt = frag.style.imageAlt || frag.text || "image";
    img.loading = "lazy";
    img.decoding = "async";
    applyInlineStyle(img, frag.style);

    wrapper.classList.add("has-image");
    wrapper.appendChild(img);
    return wrapper;
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
    let el = node;
    while (el && el !== document.body) {
      if (looksLikeComposerBar(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function triggerComposerSubmit(editor) {
    const composer = findClosestComposerBar(editor);
    const submitBtn = composer?.querySelector('button[type="submit"]');
    if (!submitBtn) {
      console.warn("[CCF NAR] triggerComposerSubmit: send button not found");
      return;
    }
    // Defer one microtask so React processes the input event from setEditorText
    // before the submit click reads the current value.
    setTimeout(() => {
      try {
        submitBtn.click();
      } catch (error) {
        console.warn("[CCF NAR] triggerComposerSubmit: click failed", error);
      }
    }, 0);
  }

  function looksLikeComposerBar(el) {
    if (!(el instanceof HTMLElement)) return false;
    // MUI 다이얼로그 컨테이너는 채팅 컴포저가 아니다.
    if (el.closest('[role="dialog"], .MuiDialog-root') || el.getAttribute('role') === 'dialog') return false;
    const submit = el.querySelector('button[type="submit"]');
    if (!submit) return false;
    if (findDiceButtons(el).length >= 1) return true;

    const editors = [...el.querySelectorAll(EDITOR_SELECTOR)]
      .map((editor) => normalizeEditorCandidate(editor))
      .filter((editor) => editor && isVisible(editor));

    return editors.length > 0;
  }

  function findD100Button(bar) {
    return findDiceButtons(bar).find((btn) => getButtonLabel(btn) === "D100") || null;
  }

  function findDiceButtons(scope) {
    if (!(scope instanceof Element)) return [];
    return [...scope.querySelectorAll("button")].filter((btn) => /^D\d+$/i.test(getButtonLabel(btn)));
  }

  function getButtonLabel(btn) {
    return (btn.getAttribute("aria-label") || btn.textContent || "").trim().toUpperCase();
  }

  function getEditorHintText(editor) {
    if (!(editor instanceof HTMLElement)) return "";

    const className =
      typeof editor.className === "string"
        ? editor.className
        : editor.getAttribute("class") || "";

    return [
      editor.getAttribute("placeholder"),
      editor.getAttribute("aria-label"),
      editor.getAttribute("name"),
      editor.id,
      className
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function scoreEditorCandidate(editor, anchor = null) {
    if (!(editor instanceof HTMLElement)) return Number.NEGATIVE_INFINITY;

    const hintText = getEditorHintText(editor);
    const rect = editor.getBoundingClientRect();
    let score = 0;

    if (editor instanceof HTMLTextAreaElement) score += 90;
    if (editor.isContentEditable) score += 55;
    if (editor.getAttribute("role") === "textbox") score += 25;
    if (editor.getAttribute("aria-multiline") === "true") score += 60;

    if (editor instanceof HTMLInputElement) score -= 55;
    if (editor instanceof HTMLInputElement && editor.type === "text") score -= 10;

    if (MESSAGE_HINT_RE.test(hintText)) score += 140;
    if (NAME_HINT_RE.test(hintText)) score -= 180;

    if (editor.hasAttribute("readonly") || editor.getAttribute("aria-readonly") === "true") score -= 140;
    if (editor.hasAttribute("disabled") || editor.getAttribute("aria-disabled") === "true") score -= 140;

    if (rect.height >= 48) score += 30;
    if (rect.height <= 32) score -= 20;
    if (rect.width >= 260) score += 15;

    if (anchor instanceof HTMLElement) {
      const anchorRect = anchor.getBoundingClientRect();
      if (rect.bottom <= anchorRect.bottom + 24) score += 14;
      if (rect.top > anchorRect.bottom + 48) score -= 20;
      score -= Math.min(distanceBetween(anchor, editor) / 6, 90);
    }

    return score;
  }

  function pickBestEditor(candidates, anchor = null) {
    const visible = [...new Set(
      candidates
        .map((editor) => normalizeEditorCandidate(editor))
        .filter((editor) => editor && isVisible(editor))
    )];

    if (!visible.length) return null;

    visible.sort((a, b) => {
      const scoreDiff = scoreEditorCandidate(b, anchor) - scoreEditorCandidate(a, anchor);
      if (scoreDiff !== 0) return scoreDiff;

      if (anchor instanceof HTMLElement) {
        return distanceBetween(anchor, a) - distanceBetween(anchor, b);
      }

      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectA.top - rectB.top || rectA.left - rectB.left;
    });

    return visible[0] || null;
  }

  function findEditorFromComposer(bar) {
    if (!bar) return null;

    if (bar instanceof HTMLElement
        && (bar.matches('[role="dialog"], .MuiDialog-root')
            || bar.getAttribute('role') === 'dialog')) {
      const textarea = bar.querySelector('textarea[name="text"]');
      if (textarea instanceof HTMLElement && isVisible(textarea)) {
        return textarea;
      }
    }

    const candidates = [];
    const drawer = bar.closest(".MuiDrawer-paper");
    if (drawer) {
      candidates.push(...drawer.querySelectorAll(EDITOR_SELECTOR));
    }

    let cur = bar.parentElement;

    for (let i = 0; i < 6 && cur; i += 1, cur = cur.parentElement) {
      candidates.push(
        ...cur.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]')
      );
    }

    return pickBestEditor(candidates, bar);
  }

  function findVisibleSubmitButtons() {
    return [...document.querySelectorAll('button[type="submit"]')]
      .filter((btn) => isVisible(btn) && !btn.closest(`#${MODAL_ID}`));
  }

  function findComposerForEditor(editor) {
    for (const bar of findComposerBars()) {
      if (findEditorFromComposer(bar) === editor) {
        return bar;
      }
    }

    if (editor instanceof HTMLElement) {
      const dialog = editor.closest('[role="dialog"], .MuiDialog-root');
      if (dialog instanceof HTMLElement && findEditorFromComposer(dialog) === editor) {
        return dialog;
      }
    }

    const closest = findClosestComposerBar(editor);
    return closest && findEditorFromComposer(closest) === editor ? closest : null;
  }

  function findChatDrawer() {
    const anchor = activeComposer || activeEditor;
    const closestDrawer = anchor?.closest?.(".MuiDrawer-paper");
    if (closestDrawer instanceof HTMLElement) {
      return closestDrawer;
    }

    for (const bar of findComposerBars()) {
      const drawer = bar.closest(".MuiDrawer-paper");
      if (drawer instanceof HTMLElement) {
        return drawer;
      }
    }

    return null;
  }

  function getModalPositionNearComposer() {
    const modal = document.getElementById(MODAL_ID);
    const drawer = findChatDrawer();

    const gap = MODAL_POSITION_PADDING;
    const viewportPad = MODAL_POSITION_PADDING;
    const modalWidth = modal?.offsetWidth || MODAL_DEFAULT_WIDTH;
    const modalHeight = modal?.offsetHeight || MODAL_DEFAULT_HEIGHT;

    let left;
    if (drawer) {
      const drawerRect = drawer.getBoundingClientRect();
      left = drawerRect.left - modalWidth - gap;
    } else {
      left = window.innerWidth - modalWidth - viewportPad;
    }

    const anchorEl =
      (activeComposer && document.contains(activeComposer) && isVisible(activeComposer) && activeComposer) ||
      (activeEditor && document.contains(activeEditor) && isVisible(activeEditor) && activeEditor) ||
      drawer;

    let top;
    if (anchorEl) {
      const anchorRect = anchorEl.getBoundingClientRect();
      top = anchorRect.bottom - modalHeight;
    } else {
      top = window.innerHeight - modalHeight - viewportPad;
    }

    if (left < viewportPad) left = viewportPad;

    const maxLeft = window.innerWidth - modalWidth - viewportPad;
    if (left > maxLeft) left = maxLeft;

    const maxTop = window.innerHeight - modalHeight - viewportPad;
    if (top > maxTop) top = maxTop;
    if (top < viewportPad) top = viewportPad;

    return { left, top };
  }

  function positionModalNearComposer() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const { left, top } = getModalPositionNearComposer();
    modal.style.left = `${Math.round(left)}px`;
    modal.style.top = `${Math.round(top)}px`;
    modal.style.right = "auto";
    modal.style.bottom = "auto";
  }

  function getModalEditor() {
    return document.getElementById("ccf-preview");
  }

  function getResolvedActiveEditor(preferred = null) {
    const preferredEditor = normalizeEditorCandidate(preferred);
    if (preferredEditor && document.contains(preferredEditor) && isVisible(preferredEditor)) {
      activeEditor = preferredEditor;
      activeComposer = findComposerForEditor(preferredEditor) || activeComposer;
      return preferredEditor;
    }
    const composerEditor =
      activeComposer && document.contains(activeComposer) ? findEditorFromComposer(activeComposer) : null;

    if (composerEditor) {
      activeEditor = composerEditor;
      return composerEditor;
    }

    if (activeEditor && document.contains(activeEditor) && isVisible(activeEditor)) {
      return activeEditor;
    }

    return null;
  }

  function isModalEditorFocused() {
    const modalEditor = getModalEditor();
    return !!modalEditor && document.activeElement === modalEditor;
  }

  function normalizeSelectionRange(selection, textLength) {
    if (!selection) return null;

    let start = clamp(Number(selection.start) || 0, 0, textLength);
    let end = clamp(Number(selection.end) || 0, 0, textLength);
    if (start > end) {
      [start, end] = [end, start];
    }

    return { start, end };
  }

  function setModalSelection(selection, textLength = null) {
    if (!selection) {
      modalSelection = null;
      return null;
    }

    const fallbackLength =
      typeof textLength === "number"
        ? textLength
        : getEditorText(getModalEditor() || activeEditor).length;

    modalSelection = normalizeSelectionRange(selection, fallbackLength);
    return modalSelection;
  }

  function getModalSelection() {
    const fallbackLength = getEditorText(getModalEditor() || activeEditor).length;
    return normalizeSelectionRange(modalSelection, fallbackLength);
  }

  function restoreModalSelectionSoon() {
    const selection = getModalSelection();
    const modalEditor = getModalEditor();
    if (!selection || !modalEditor) return;
    const token = ++modalSelectionRestoreToken;

    const attemptRestore = (attempt = 0) => {
      if (token !== modalSelectionRestoreToken) return;
      if (!isModalOpen()) return;

      const active = document.activeElement;
      const isStyleControlFocused =
        active instanceof HTMLElement &&
        (
          ["ccf-color", "ccf-bgcolor"].includes(active.id) ||
          !!active.closest(".ccf-size-tool")
        );

      if (isStyleControlFocused && attempt < 12) {
        setTimeout(() => {
          attemptRestore(attempt + 1);
        }, 60);
        return;
      }

      restoreEditorSelection(modalEditor, selection);
    };

    setTimeout(() => {
      attemptRestore(0);
    }, 0);
  }

  function resolveOffsetWithinLineNode(lineNode, offset) {
    const lineText = normalizeEditorText(lineNode.textContent || "");
    const safeOffset = clamp(offset, 0, lineText.length);
    if (!lineText.length) {
      return {
        node: lineNode,
        offset: 0
      };
    }

    const walker = document.createTreeWalker(lineNode, NodeFilter.SHOW_TEXT);
    let remaining = safeOffset;
    let lastTextNode = null;

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const length = textNode.textContent?.length || 0;
      lastTextNode = textNode;

      if (remaining <= length) {
        return { node: textNode, offset: remaining };
      }

      remaining -= length;
    }

    if (lastTextNode) {
      return {
        node: lastTextNode,
        offset: lastTextNode.textContent?.length || 0
      };
    }

    return {
      node: lineNode,
      offset: lineNode.childNodes.length
    };
  }

  function resolveRenderedLinePosition(root, offset) {
    const lineNodes = [...root.querySelectorAll('[data-ccf-line="1"]')];
    if (!lineNodes.length) return null;

    const lines = getTextLines(getEditorText(root));
    const lastLine = lines[lines.length - 1];
    const safeOffset = clamp(offset, 0, lastLine.end + (lastLine.hasBreak ? 1 : 0));

    for (let i = 0; i < lines.length && i < lineNodes.length; i += 1) {
      const line = lines[i];
      const lineNode = lineNodes[i];

      if (safeOffset <= line.end) {
        return resolveOffsetWithinLineNode(lineNode, safeOffset - line.start);
      }

      if (line.hasBreak && safeOffset === line.end + 1) {
        if (i + 1 < lineNodes.length) {
          return {
            node: lineNodes[i + 1],
            offset: 0
          };
        }

        return resolveOffsetWithinLineNode(lineNode, line.text.length);
      }
    }

    return resolveOffsetWithinLineNode(lineNodes[lineNodes.length - 1], lines[Math.min(lines.length - 1, lineNodes.length - 1)].text.length);
  }

  function resolveTextPosition(root, offset) {
    const renderedPosition = resolveRenderedLinePosition(root, offset);
    if (renderedPosition) {
      return renderedPosition;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let lastTextNode = null;

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const length = textNode.textContent?.length || 0;
      lastTextNode = textNode;

      if (remaining <= length) {
        return { node: textNode, offset: remaining };
      }

      remaining -= length;
    }

    if (lastTextNode) {
      return {
        node: lastTextNode,
        offset: lastTextNode.textContent?.length || 0
      };
    }

    return {
      node: root,
      offset: root.childNodes.length
    };
  }

  function restoreEditorSelection(editor, selection) {
    if (!editor || !selection) return;

    const safeSelection = normalizeSelectionRange(selection, getEditorText(editor).length);
    if (!safeSelection) return;

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      editor.focus?.({ preventScroll: true });
      editor.setSelectionRange?.(safeSelection.start, safeSelection.end);
      setModalSelection(safeSelection, getEditorText(editor).length);
      return;
    }

    const start = resolveTextPosition(editor, safeSelection.start);
    const end = resolveTextPosition(editor, safeSelection.end);
    const selectionApi = window.getSelection();
    if (!selectionApi) return;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    editor.focus?.({ preventScroll: true });
    selectionApi.removeAllRanges();
    selectionApi.addRange(range);
    setModalSelection(safeSelection, getEditorText(editor).length);
  }

  function isCurrentRoomEditor(editor, composer = null) {
    const resolvedComposer = composer || findComposerForEditor(editor);
    return !!(
      editor instanceof HTMLElement &&
      document.contains(editor) &&
      isVisible(editor) &&
      resolvedComposer &&
      findEditorFromComposer(resolvedComposer) === editor
    );
  }

  function syncModalEditorToRoomEditor(commit = false, options = {}) {
    if (modalMode === MODAL_MODE_ROLL20) {
      syncModalRoll20Draft();
    } else {
      syncModalCcfDraft();
    }

    if (!commit) return true;
    return commitModalDraftToRoomEditor(options);
  }

  function commitModalDraftToRoomEditor(options = {}) {
    const roomEditor = getResolvedActiveEditor(options.editor || null);
    if (!roomEditor) return false;

    if (modalMode === MODAL_MODE_ROLL20) {
      const converted = ensureRoll20DraftConverted({ silent: false, forceRender: true });
      if (!converted) return false;
      if (!isCurrentRoomEditor(roomEditor, options.composer || null)) return false;

      const nextText = converted.text ?? "";
      const nextRuns = cloneRuns(converted.runs, nextText.length);
      const nextAlignRuns = cloneAlignRuns(converted.alignRuns, getTextLineCount(nextText));
      const prevText = getEditorText(roomEditor);

      if (nextText !== prevText) {
        suppressRoomSync = true;
        try {
          setEditorText(roomEditor, nextText);
        } finally {
          suppressRoomSync = false;
        }
      }

      const state = ensureEditorState(roomEditor);
      state.runs = nextRuns;
      state.alignRuns = nextAlignRuns;
      state.blockStyle = {};
      state.parentheticalGray = false;
      state.lastStyle = null;
      state.text = nextText;
      state.roll20Source = null;

      refreshComposerBadge(activeComposer, roomEditor);
      setInlineParentheticalGrayToggle(roomEditor, false);
      syncEditorVisualPreview(roomEditor);
      return true;
    }

    if (!isCurrentRoomEditor(roomEditor)) return false;

    const nextText = modalDraftText ?? getEditorText(roomEditor);
    const nextRuns = modalDraftParentheticalGray
      ? applyParentheticalGrayRuns(modalDraftRuns, nextText)
      : cloneRuns(modalDraftRuns, nextText.length);
    const nextAlignRuns = cloneAlignRuns(modalDraftAlignRuns, getTextLineCount(nextText));
    const prevText = getEditorText(roomEditor);

    if (nextText !== prevText) {
      suppressRoomSync = true;
      try {
        setEditorText(roomEditor, nextText);
      } finally {
        suppressRoomSync = false;
      }
    }

    const state = ensureEditorState(roomEditor);
    state.runs = nextRuns;
    state.alignRuns = nextAlignRuns;
    state.blockStyle = cleanupBlockStyle(modalDraftBlockStyle);
    state.parentheticalGray = modalDraftParentheticalGray;
    state.text = nextText;
    state.roll20Source = null;
    if (modalDraftLastStyle) {
      state.lastStyle = { ...modalDraftLastStyle };
    }

    refreshComposerBadge(activeComposer, roomEditor);
    setInlineParentheticalGrayToggle(roomEditor, state.parentheticalGray);
    syncEditorVisualPreview(roomEditor);
    return true;
  }

  function syncRoomEditorToModalEditor(editor) {
    const modalEditor = getModalEditor();
    if (!modalEditor || !editor) return;

    const text = modalDraftText ?? getEditorText(editor);
    if (getEditorText(modalEditor) !== text) {
      modalEditor.textContent = text;
    }
  }

  function syncRoomEditorToRoll20Editor(editor) {
    const roll20Editor = getRoll20Editor();
    if (!roll20Editor || !editor) return;

    const text = modalDraftRoll20Text ?? stripInvisibleEnvelope(getEditorText(editor));
    if (getEditorText(roll20Editor) !== text) {
      roll20Editor.value = text;
    }
  }

  function normalizeEditorText(value) {
    return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  }

  function getEditorText(editor) {
    if (!editor) return "";
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return normalizeEditorText(editor.value || "");
    }

    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      const text = typeof editor.innerText === "string" ? editor.innerText : (editor.textContent || "");
      return normalizeEditorText(text);
    }

    return normalizeEditorText(editor.textContent || "");
  }

  // React 18 flushSync 탐색 캐시 (undefined = 미확인, null = 없음, function = 발견)
  let _cachedFlushSync = undefined;

  function getCcfFlushSync() {
    if (_cachedFlushSync !== undefined) return _cachedFlushSync;
    try {
      // 방법 1: window.ReactDOM (CDN 사용 시)
      if (typeof window.ReactDOM?.flushSync === "function") {
        _cachedFlushSync = window.ReactDOM.flushSync;
        return _cachedFlushSync;
      }
      // 방법 2: React DevTools 글로벌 훅에서 렌더러 탐색
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook?.renderers?.size) {
        for (const [, renderer] of hook.renderers) {
          if (typeof renderer?.flushSync === "function") {
            _cachedFlushSync = (fn) => renderer.flushSync(fn);
            return _cachedFlushSync;
          }
        }
      }
    } catch (_) {}
    _cachedFlushSync = null;
    return null;
  }

  function dispatchInputWithFlush(editor) {
    const flushSync = getCcfFlushSync();
    if (flushSync) {
      try {
        // React 18 자동 배칭 우회: input 이벤트를 동기적으로 플러시
        flushSync(() => {
          editor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        return;
      } catch (_) {
        // flushSync 실패 시 폴백
      }
    }
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setEditorText(editor, value) {
    if (!editor) return;
    const nextValue = normalizeEditorText(value);

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(editor.constructor.prototype, "value")?.set;
      if (setter) {
        setter.call(editor, nextValue);
      } else {
        editor.value = nextValue;
      }
      dispatchInputWithFlush(editor);
      return;
    }

    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      editor.textContent = nextValue;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function findRenderedLineNode(root, node) {
    if (!(root instanceof HTMLElement) || !(node instanceof Node)) return null;

    let cur = node instanceof Element ? node : node.parentElement;
    while (cur && cur !== root) {
      if (cur instanceof HTMLElement && cur.dataset.ccfLine === "1") {
        return cur;
      }
      cur = cur.parentElement;
    }

    return null;
  }

  function getRenderedLineBoundaryOffset(lineNode, boundaryNode, boundaryOffset) {
    const range = document.createRange();
    range.selectNodeContents(lineNode);
    range.setEnd(boundaryNode, boundaryOffset);
    return normalizeEditorText(range.toString()).length;
  }

  function getRenderedRootSelectionOffset(root, boundaryNode, boundaryOffset) {
    const lineNodes = [...root.querySelectorAll('[data-ccf-line="1"]')];
    if (!lineNodes.length) return null;

    const lineNode = findRenderedLineNode(root, boundaryNode);
    if (lineNode) {
      const lineStart = Number(lineNode.dataset.start || 0);
      return lineStart + getRenderedLineBoundaryOffset(lineNode, boundaryNode, boundaryOffset);
    }

    if (boundaryNode === root) {
      const childNode = root.childNodes[boundaryOffset] || null;
      if (childNode instanceof HTMLElement && childNode.dataset.ccfLine === "1") {
        return Number(childNode.dataset.start || 0);
      }

      for (let i = boundaryOffset - 1; i >= 0; i -= 1) {
        const prevNode = root.childNodes[i];
        if (prevNode instanceof HTMLElement && prevNode.dataset.ccfLine === "1") {
          return Number(prevNode.dataset.end || 0);
        }
      }

      return 0;
    }

    return null;
  }

  function getEditorSelection(editor) {
    if (!editor) return null;

    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return {
        start: editor.selectionStart ?? 0,
        end: editor.selectionEnd ?? 0
      };
    }

    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
        return null;
      }

      const fullText = getEditorText(editor);
      const renderedStart = getRenderedRootSelectionOffset(editor, range.startContainer, range.startOffset);
      const renderedEnd = getRenderedRootSelectionOffset(editor, range.endContainer, range.endOffset);
      if (renderedStart != null && renderedEnd != null) {
        return {
          start: clamp(renderedStart, 0, fullText.length),
          end: clamp(renderedEnd, 0, fullText.length)
        };
      }

      const preStart = document.createRange();
      preStart.selectNodeContents(editor);
      preStart.setEnd(range.startContainer, range.startOffset);

      const preEnd = document.createRange();
      preEnd.selectNodeContents(editor);
      preEnd.setEnd(range.endContainer, range.endOffset);

      return {
        start: clamp(normalizeEditorText(preStart.toString()).length, 0, fullText.length),
        end: clamp(normalizeEditorText(preEnd.toString()).length, 0, fullText.length)
      };
    }

    return null;
  }

  function refreshComposerBadge(composer, editor) {
    const targetComposer = composer || findComposerForEditor(editor);
    if (!targetComposer || !editor) return;
    updateButtonBadge(targetComposer.querySelector(OPEN_BTN_SELECTOR), editor);
  }

  function updateButtonBadge(btn, editor) {
    if (!btn || !editor) return;
    btn.removeAttribute(BTN_BADGE_ATTR);
    btn.classList.remove("has-runs");
  }

  function normalizeColor(value) {
    if (typeof value !== "string") return "#ffffff";
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function distanceBetween(a, b) {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return Math.abs(ra.top - rb.top) + Math.abs(ra.left - rb.left);
  }
})();

(() => {
  "use strict";

  if (!/(?:^|\.)ccfolia\.com$/i.test(location.hostname)) return;

  const CCF_FS_RUNTIME = window.__CCF_FORMAT_SYNC_RUNTIME__ || null;
  const ccfFsWithSignal = CCF_FS_RUNTIME?.withSignal || ((options) => (
    typeof options === "object" && options ? options : {}
  ));
  const ccfFsRegisterTeardown = CCF_FS_RUNTIME?.registerTeardown || (() => {});
  const ccfFsIsActive = () => CCF_FS_RUNTIME?.isActive?.() !== false;

  const CUTIN_MIRROR_ATTR = "data-ccf-cutin-chat-mirror";
  const CUTIN_STYLE_ID = "ccf-cutin-chat-mirror-style";
  const CUTIN_CHANNEL_NAME = "ccf-cutin-chat-mirror-v1";
  const CUTIN_MESSAGE_NAMESPACE = "ccf-cutin-chat-mirror";
  const CUTIN_RESCAN_INTERVAL_MS = 1000;
  const cutinSenderId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let cutinLocalEffect = null;
  let cutinRequestedRoomId = null;
  let cutinAnimationFrame = 0;
  let cutinInterval = 0;
  let cutinObserver = null;
  let cutinInitialized = false;
  const cutinRemoteEffects = new Map();
  const cutinChannel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(CUTIN_CHANNEL_NAME)
      : null;

  startCutinMirror();

  function startCutinMirror() {
    const initialize = () => {
      if (cutinInitialized || !document.documentElement || !document.body) return;
      cutinInitialized = true;
      injectCutinMirrorStyle();
      cutinChannel?.addEventListener("message", handleCutinChannelMessage);
      window.addEventListener("resize", scheduleCutinMirrorSync, ccfFsWithSignal());
      window.addEventListener("popstate", scheduleCutinMirrorSync, ccfFsWithSignal());
      window.addEventListener("pagehide", closeLocalCutinEffect, ccfFsWithSignal());

      cutinObserver = new MutationObserver(scheduleCutinMirrorSync);
      cutinObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "src", "style"],
        childList: true,
        subtree: true
      });
      cutinInterval = window.setInterval(scheduleCutinMirrorSync, CUTIN_RESCAN_INTERVAL_MS);
      scheduleCutinMirrorSync();
    };

    initialize();
    if (!cutinInitialized) {
      document.addEventListener("DOMContentLoaded", initialize, ccfFsWithSignal(true));
      window.addEventListener("load", initialize, ccfFsWithSignal(true));
    }
    ccfFsRegisterTeardown(teardownCutinMirror);
  }

  function teardownCutinMirror() {
    closeLocalCutinEffect();
    cutinChannel?.close();
    if (cutinAnimationFrame) window.cancelAnimationFrame(cutinAnimationFrame);
    if (cutinInterval) window.clearInterval(cutinInterval);
    cutinObserver?.disconnect();
    removeCutinMirrors();
    document.getElementById(CUTIN_STYLE_ID)?.remove();
  }

  function scheduleCutinMirrorSync() {
    if (!ccfFsIsActive() || cutinAnimationFrame) return;
    cutinAnimationFrame = window.requestAnimationFrame(() => {
      cutinAnimationFrame = 0;
      syncCutinMirror();
    });
  }

  function syncCutinMirror() {
    const route = getCutinRoomRoute();

    if (!route) {
      closeLocalCutinEffect();
      removeCutinMirrors();
      return;
    }

    if (route.standalone) {
      closeLocalCutinEffect();
      requestCurrentCutinEffect(route.roomId);
      renderCutinMirrors(getRemoteCutinEffect(route.roomId));
      return;
    }

    cutinRequestedRoomId = null;
    cutinRemoteEffects.clear();
    updateLocalCutinEffect(route.roomId);
    renderCutinMirrors(cutinLocalEffect);
  }

  function getCutinRoomRoute() {
    const match = location.pathname.match(/^\/rooms\/([^/]+)(\/chat)?\/?$/);
    if (!match) return null;
    return {
      roomId: decodeURIComponent(match[1]),
      standalone: Boolean(match[2])
    };
  }

  function updateLocalCutinEffect(roomId) {
    const sourceImage = findActiveCutinImage();
    const sourceUrl = sourceImage?.currentSrc || sourceImage?.src || "";
    if (!sourceUrl) {
      closeLocalCutinEffect();
      return;
    }

    const signature = `${roomId}|${sourceUrl}`;
    if (cutinLocalEffect?.signature === signature) return;
    if (cutinLocalEffect && cutinLocalEffect.roomId !== roomId) {
      broadcastCutinEffect({ ...cutinLocalEffect, open: false });
    }

    cutinLocalEffect = {
      open: true,
      roomId,
      signature,
      src: sourceUrl
    };
    broadcastCutinEffect(cutinLocalEffect);
  }

  function closeLocalCutinEffect() {
    if (!cutinLocalEffect) return;
    broadcastCutinEffect({ ...cutinLocalEffect, open: false });
    cutinLocalEffect = null;
  }

  function findActiveCutinImage() {
    const images = Array.from(document.images);
    for (let index = images.length - 1; index >= 0; index -= 1) {
      const image = images[index];
      if (image.closest(`[${CUTIN_MIRROR_ATTR}]`) || !isVisibleCutinImage(image)) continue;
      if (hasCutinOverlayAncestor(image)) return image;
    }
    return null;
  }

  function isVisibleCutinImage(image) {
    const rect = image.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasCutinOverlayAncestor(image) {
    // CCFOLIA Effect.tsx renders an active image within a full-frame dim backdrop.
    for (
      let element = image.parentElement;
      element && element !== document.body;
      element = element.parentElement
    ) {
      if (element.hasAttribute(CUTIN_MIRROR_ATTR)) return false;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (
        style.position === "absolute" &&
        isZeroCutinOffset(style.top) &&
        isZeroCutinOffset(style.right) &&
        isZeroCutinOffset(style.bottom) &&
        isZeroCutinOffset(style.left) &&
        style.overflow === "hidden" &&
        isCutinDimBackdrop(style.backgroundColor)
      ) {
        return true;
      }
    }
    return false;
  }

  function isZeroCutinOffset(value) {
    return value === "0px" || value === "0";
  }

  function isCutinDimBackdrop(color) {
    const match = color.match(
      /^rgba?\(\s*0\s*,\s*0\s*,\s*0(?:\s*,\s*([\d.]+))?\s*\)$/
    );
    return Boolean(match) && Number(match[1] ?? 1) >= 0.25;
  }

  function findCutinChatPanels() {
    return Array.from(document.querySelectorAll(".MuiDrawer-paper")).filter((paper) => {
      const hasHeader = paper.querySelector(".MuiAppBar-root");
      const hasEditor = paper.querySelector(
        "textarea, input[type='text'], [contenteditable='true']"
      );
      const titleMatches =
        /ルームチャット|룸\s*채팅|room\s*chat/i.test(paper.textContent || "");
      return Boolean(hasHeader && (hasEditor || titleMatches));
    });
  }

  function renderCutinMirrors(effect) {
    const panels = findCutinChatPanels();
    const activePanels = new Set(panels);

    for (const mirror of document.querySelectorAll(`[${CUTIN_MIRROR_ATTR}="overlay"]`)) {
      if (!panels.some((panel) => panel.contains(mirror))) mirror.remove();
    }

    for (const panel of panels) {
      let mirror = Array.from(panel.children).find(
        (child) => child.getAttribute?.(CUTIN_MIRROR_ATTR) === "overlay"
      );
      if (!effect?.open || !effect.src) {
        mirror?.remove();
        continue;
      }
      if (!mirror) {
        mirror = createCutinMirror();
        panel.append(mirror);
      }
      const image = mirror.querySelector("img");
      if (image.getAttribute("src") !== effect.src) image.setAttribute("src", effect.src);
    }

    for (const mirror of document.querySelectorAll(`[${CUTIN_MIRROR_ATTR}="overlay"]`)) {
      if (!activePanels.has(mirror.parentElement)) mirror.remove();
    }
  }

  function createCutinMirror() {
    const overlay = document.createElement("div");
    overlay.setAttribute(CUTIN_MIRROR_ATTR, "overlay");
    overlay.setAttribute("aria-hidden", "true");

    const floatWindow = document.createElement("div");
    floatWindow.setAttribute(CUTIN_MIRROR_ATTR, "window");
    const image = document.createElement("img");
    image.setAttribute(CUTIN_MIRROR_ATTR, "image");
    image.alt = "";
    image.draggable = false;

    floatWindow.append(image);
    overlay.append(floatWindow);
    return overlay;
  }

  function removeCutinMirrors() {
    document.querySelectorAll(`[${CUTIN_MIRROR_ATTR}="overlay"]`).forEach((mirror) => {
      mirror.remove();
    });
  }

  function requestCurrentCutinEffect(roomId) {
    if (!cutinChannel || cutinRequestedRoomId === roomId) return;
    cutinRequestedRoomId = roomId;
    cutinRemoteEffects.clear();
    cutinChannel.postMessage({
      namespace: CUTIN_MESSAGE_NAMESPACE,
      senderId: cutinSenderId,
      type: "request",
      roomId
    });
  }

  function broadcastCutinEffect(effect) {
    cutinChannel?.postMessage({
      namespace: CUTIN_MESSAGE_NAMESPACE,
      senderId: cutinSenderId,
      type: "effect",
      roomId: effect.roomId,
      open: effect.open,
      src: effect.src,
      sentAt: Date.now()
    });
  }

  function handleCutinChannelMessage(event) {
    const message = event.data;
    if (
      !message ||
      message.namespace !== CUTIN_MESSAGE_NAMESPACE ||
      message.senderId === cutinSenderId
    ) {
      return;
    }

    if (message.type === "request") {
      if (cutinLocalEffect?.roomId === message.roomId) {
        broadcastCutinEffect(cutinLocalEffect);
      }
      return;
    }

    const route = getCutinRoomRoute();
    if (
      message.type !== "effect" ||
      !route?.standalone ||
      route.roomId !== message.roomId
    ) {
      return;
    }

    if (message.open && message.src) {
      cutinRemoteEffects.set(message.senderId, message);
    } else {
      cutinRemoteEffects.delete(message.senderId);
    }
    scheduleCutinMirrorSync();
  }

  function getRemoteCutinEffect(roomId) {
    const effects = Array.from(cutinRemoteEffects.values())
      .filter((effect) => effect.roomId === roomId && effect.open)
      .sort((left, right) => left.sentAt - right.sentAt);
    return effects[effects.length - 1];
  }

  function injectCutinMirrorStyle() {
    if (document.getElementById(CUTIN_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CUTIN_STYLE_ID;
    style.dataset.ccfFsInjected = "1";
    style.textContent = `
      [${CUTIN_MIRROR_ATTR}="overlay"] {
        position: absolute;
        inset: 0;
        overflow: hidden;
        z-index: 1400;
        background: rgba(0, 0, 0, 0.4);
        pointer-events: none;
      }

      [${CUTIN_MIRROR_ATTR}="window"] {
        position: absolute;
        top: 16%;
        right: 16%;
        bottom: 16%;
        left: 16%;
        margin: auto;
        max-width: 480px;
        max-height: 480px;
      }

      [${CUTIN_MIRROR_ATTR}="image"] {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
    `;
    document.head.append(style);
  }
})();
