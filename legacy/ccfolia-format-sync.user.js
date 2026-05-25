// ==UserScript==
// @name         CCF Format Editor Tool by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-format-sync
// @version      0.0.15
// @description  Adds a rich formatting editor, renderer, ruby, tooltip, and blur support to CCFOLIA chat.
// @description:ko CCFOLIA 채팅에 서식 편집 도구/렌더러, 루비, 툴팁, 블러 기능을 추가합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const CCF_RENDERED_ATTR = "data-ccf-rendered";
  const CCF_RAW_ATTR = "data-ccf-raw";
  const CCF_SAFE_UI_ATTR = "data-ccf-safe-markup";
  const CCF_NARRATION_ATTR = "data-ccf-narration";
  const CCF_NARRATION_PANEL_ATTR = "data-ccf-narration-panel";
  const MESSAGE_SCOPE_SELECTOR = '[role="log"], [aria-live="polite"], [aria-live="assertive"], .MuiDrawer-paper, ul.MuiList-root';
  const MESSAGE_ITEM_SELECTOR = 'li, [role="listitem"], .MuiListItem-root, [data-index]';
  const MESSAGE_TEXT_SELECTOR = [
    'p.MuiTypography-root.MuiTypography-body2',
    'div.MuiTypography-root.MuiTypography-body2',
    'span.MuiTypography-root.MuiTypography-body2',
    '.MuiTypography-root.MuiListItemText-secondary',
    '.MuiListItemText-root > p',
    '.MuiListItemText-root > div',
    '.MuiListItemText-root > span.MuiTypography-root',
    '[data-index] p',
    '[data-index] div.MuiTypography-root',
    '[data-index] span.MuiTypography-root',
    'li p'
  ].join(", ");

  const INVIS_START = "\u2063\u2063\u2063";
  const INVIS_END = "\u2062\u2062\u2062";
  const INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
  const INVIS_REVERSE = new Map(INVIS_MAP.map((ch, i) => [ch, i]));
  const FONT_SIZE_MIN = 1;
  const FONT_SIZE_MAX = 200;
  const DEFAULT_BLUR_VALUE = "4px";
  const LOCAL_IMAGE_TOKEN_PREFIX = "ccf-local://image/";
  const LOCAL_IMAGE_STORAGE_PREFIX = "ccf-inline-image:";
  const STYLE_CLIPBOARD_STORAGE_KEY = "ccf-format-style-clipboard-v1";
  const CCF_SUITE_REGISTRY_KEY = "ccf-suite-registry-v1";
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_SUITE_REGISTER_EVENT = "ccf-suite:register";
  const CCF_SUITE_REQUEST_EVENT = "ccf-suite:request-register";
  const CCF_FORMAT_SYNC_SCRIPT_INFO = Object.freeze({
    id: "ccf-format-sync",
    name: "CCF Format Editor Tool",
    version: getUserscriptVersion("0.0.15"),
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

  if (IS_IFH_HOST) {
    initIfhBridgePage();
    return;
  }

  if (!IS_CCFOLIA_HOST) {
    return;
  }

  let ccfFsActive = true;
  const ccfFsDisposers = [];
  const ccfFsAbort = new AbortController();
  const ccfFsSignal = ccfFsAbort.signal;

  function ccfFsRegisterTeardown(fn) {
    if (typeof fn === "function") ccfFsDisposers.push(fn);
  }

  function ccfFsWithSignal(options) {
    if (options == null) return { signal: ccfFsSignal };
    if (typeof options === "boolean") return { capture: options, signal: ccfFsSignal };
    if (typeof options === "object") {
      if (options.signal && options.signal !== ccfFsSignal) return options;
      return { ...options, signal: ccfFsSignal };
    }
    return { signal: ccfFsSignal };
  }

  function ccfFsTeardown() {
    if (!ccfFsActive) return false;
    ccfFsActive = false;
    try { ccfFsAbort.abort(); } catch (error) { /* abort failed */ }
    while (ccfFsDisposers.length) {
      const disposer = ccfFsDisposers.pop();
      try { disposer(); } catch (error) { /* disposer failed */ }
    }
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
      if (window.__CCF_FORMAT_SYNC_DEBUG__ && window.__CCF_FORMAT_SYNC_DEBUG__.__owner === ccfFsSignal) {
        delete window.__CCF_FORMAT_SYNC_DEBUG__;
      }
    } catch (error) { /* debug api cleanup failed */ }
    try {
      if (window.__CCF_FORMAT_SYNC_RUNTIME__ && window.__CCF_FORMAT_SYNC_RUNTIME__.__owner === ccfFsSignal) {
        delete window.__CCF_FORMAT_SYNC_RUNTIME__;
      }
    } catch (error) { /* runtime cleanup failed */ }
    return true;
  }

  window.__CCF_FORMAT_SYNC_RUNTIME__ = {
    __owner: ccfFsSignal,
    withSignal: ccfFsWithSignal,
    registerTeardown: ccfFsRegisterTeardown,
    isActive() { return ccfFsActive; },
    teardown: ccfFsTeardown
  };

  window.__CCF_FORMAT_SYNC_DEBUG__ = {
    __owner: ccfFsSignal,
    isActive() { return ccfFsActive; },
    disable() { return ccfFsTeardown(); }
  };

  // Self-register with the suite manager so installation and version status can be tracked centrally.
  registerWithCcfSuite(CCF_FORMAT_SYNC_SCRIPT_INFO);
  window.addEventListener(CCF_SUITE_REQUEST_EVENT, handleCcfSuiteRegisterRequest, ccfFsWithSignal());
  if (!isCcfSuiteScriptEnabled(CCF_FORMAT_SYNC_SCRIPT_INFO.id)) {
    return;
  }
  initRenderer();

  function handleCcfSuiteRegisterRequest(event) {
    const targetId = event?.detail?.targetId;
    if (targetId && targetId !== CCF_FORMAT_SYNC_SCRIPT_INFO.id) return;
    registerWithCcfSuite(CCF_FORMAT_SYNC_SCRIPT_INFO);
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

  function initRenderer() {
    injectStyle();
    scanAndRenderAll();
    observeRenderDom();
  }

  function injectStyle() {
    if (document.getElementById("ccf-render-style")) return;

    const style = document.createElement("style");
    style.id = "ccf-render-style";
    style.setAttribute("data-ccf-fs-style", "1");
    style.textContent = `
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
        border-radius: 8px;
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
        border-radius: 10px;
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

      [${CCF_NARRATION_ATTR}="1"] .MuiListItemAvatar-root,
      [${CCF_NARRATION_ATTR}="1"] .MuiListItemText-primary,
      [${CCF_NARRATION_ATTR}="1"] > img:not(.ccf-image) {
        display: none !important;
      }

      .MuiPaper-root[${CCF_NARRATION_PANEL_ATTR}="1"] > img {
        display: none !important;
      }

      [${CCF_NARRATION_ATTR}="1"] .MuiListItemText-root {
        width: 100% !important;
        margin: 0 auto !important;
        text-align: center !important;
      }

      .ccf-render-root[${CCF_NARRATION_ATTR}="1"],
      [${CCF_NARRATION_ATTR}="1"] .ccf-render-root,
      [${CCF_NARRATION_ATTR}="1"] .ccf-render-root .ccf-line {
        text-align: center !important;
        font-style: italic !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function observeRenderDom() {
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              if (node.closest?.(`[${CCF_SAFE_UI_ATTR}="1"]`)) continue;
              scanWithin(node);
            }
          }
          continue;
        }

        if (mutation.type === "characterData") {
          const parent = mutation.target?.parentElement;
          if (parent) {
            if (parent.closest?.(`[${CCF_SAFE_UI_ATTR}="1"]`)) continue;
            scanWithin(parent);
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

  function scanAndRenderAll() {
    scanWithin(document.body || document.documentElement);
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
    if (el.getAttribute(CCF_RENDERED_ATTR) === "1") return false;
    if (el.matches?.(MESSAGE_SCOPE_SELECTOR)) return false;
    if (el.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;
    if (el.closest("button, form")) return false;
    if (el.querySelector('button, form, textarea, input, [contenteditable="true"], [role="textbox"], [role="dialog"]')) return false;
    if (!el.matches?.(MESSAGE_TEXT_SELECTOR) && el.querySelector?.(MESSAGE_TEXT_SELECTOR)) return false;

    const text = el.textContent || "";
    if (!text.includes(INVIS_START) || !text.includes(INVIS_END)) return false;
    if (el.children.length > 3) return false;

    return true;
  }

  function tryRenderEncodedMessage(el) {
    const text = el.textContent || "";
    const decoded = extractEnvelope(text);
    if (!decoded) return;

    const { visibleText, envelope } = decoded;
    if (!envelope || typeof envelope !== "object") return;
    if (typeof envelope.text !== "string") return;

    const renderText = envelope.text || visibleText || "";
    const runs = normalizeRuns(envelope.formatRuns, renderText.length);
    const alignRuns = getEffectiveAlignRuns(renderText, envelope.alignRuns, envelope.blockStyle);
    const narration = cleanupBlockStyle(envelope.blockStyle).narration === true;

    if (!el.hasAttribute(CCF_RAW_ATTR)) {
      el.setAttribute(CCF_RAW_ATTR, text);
    }

    el.innerHTML = "";
    el.classList.add("ccf-render-root");
    applyNarrationMessageLayout(el, narration);

    if (!runs.length && !alignRuns.length && !narration) {
      el.textContent = renderText;
      el.setAttribute(CCF_RENDERED_ATTR, "1");
      return;
    }

    renderStyledText(el, renderText, runs, alignRuns);

    el.setAttribute(CCF_RENDERED_ATTR, "1");
  }

  function applyNarrationMessageLayout(el, narration) {
    if (!(el instanceof HTMLElement)) return;

    if (narration) {
      el.setAttribute(CCF_NARRATION_ATTR, "1");
    } else {
      el.removeAttribute(CCF_NARRATION_ATTR);
    }

    const item = el.closest?.(MESSAGE_ITEM_SELECTOR);
    if (!(item instanceof HTMLElement) || item === el) return;

    if (narration) {
      item.setAttribute(CCF_NARRATION_ATTR, "1");
      return;
    }

    if (!item.querySelector(`.ccf-render-root[${CCF_NARRATION_ATTR}="1"]`)) {
      item.removeAttribute(CCF_NARRATION_ATTR);
    }
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
    if (style.blur) el.style.filter = `blur(${style.blur})`;
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
    wrapper.className = "ccf-frag ccf-image-frag";

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
  const LOCAL_IMAGE_STORAGE_PREFIX = "ccf-inline-image:";
  const LOCAL_IMAGE_INDEX_KEY = "ccf-inline-image:index";
  const LOCAL_IMAGE_MAX_ENTRIES = 24;
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
    injectStyles();
    cleanupKnownArtifacts();
    ensureUi();
    observeDom();
    bindGlobalEvents();
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
        border-radius: 8px;
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
        gap: 6px;
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
        border-radius: 8px;
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
        border-radius: 8px;
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
        border-radius: 8px;
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
        border-radius: 6px;
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
        border-radius: 10px;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
        z-index: 2147483002;
      }

      .ccf-size-tool.editing .ccf-size-menu {
        display: flex;
      }

      .ccf-size-option {
        border: 0;
        border-radius: 8px;
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
        border-radius: 10px;
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
        border-radius: 10px;
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
        border-radius: 50%;
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
        border-radius: 999px;
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
        gap: 6px;
        width: 100%;
        box-sizing: border-box;
        margin: 0 0 6px;
        padding: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
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
        border-radius: 6px;
        font-size: 12px;
      }

      .ccf-inline-toolbar .ccf-inline-tool {
        width: 30px;
        height: 30px;
        border-radius: 6px;
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

      .ccf-inline-size-input {
        width: 58px;
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        background: #282828;
        color: #fff;
        padding: 0 6px;
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
        border-radius: 8px;
        background: #2b2b2b;
        color: #fff;
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.36);
      }

      .ccf-inline-popover.open {
        display: flex;
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
        border-radius: 6px;
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
        border-radius: 6px;
        padding: 7px 10px;
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
        border-radius: 3px;
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
    const mo = new MutationObserver((mutations) => {
      const shouldRefresh = mutations.some((mutation) => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (target?.closest?.(`[${SAFE_UI_ATTR}="1"]`)) {
          return false;
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
        ensureUi();
      }
    });

    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    ccfFsRegisterTeardown(() => mo.disconnect());
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
    }, ccfFsWithSignal(true));

    window.addEventListener("resize", () => {
      if (isModalOpen()) {
        constrainModalSize();
        ensureRoll20ModalHeight();
        constrainModalPosition();
        persistModalGeometry();
        scheduleImagePopoverPosition();
      }
      syncAllEditorVisualPreviews();
    }, ccfFsWithSignal());
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

    for (const composer of findComposerBars()) {
      ensureInlineToolbarForComposer(composer);
    }
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
      <button type="button" class="ccf-toggle" data-inline-command="paren-gray" title="Parentheses gray" aria-label="Parentheses gray">()</button>
      <button type="button" class="ccf-toggle" data-inline-command="narration" title="Narration" aria-label="Narration">Nar</button>
      <span class="ccf-inline-divider" aria-hidden="true"></span>
      <button type="button" class="ccf-toggle" data-inline-command="ruby" title="Ruby" aria-label="Ruby">Rb</button>
      <button type="button" class="ccf-toggle" data-inline-command="tooltip" title="Tooltip" aria-label="Tooltip">Tip</button>
      <button type="button" class="ccf-toggle" data-inline-command="blur" title="Blur" aria-label="Blur">Bl</button>
      <button type="button" class="ccf-toggle" data-inline-command="code" title="Code block" aria-label="Code block">&lt;/&gt;</button>
      <span class="ccf-inline-divider" aria-hidden="true"></span>
      <button type="button" class="ccf-toggle" data-inline-command="style-clipboard" title="\uC11C\uC2DD \uC800\uC7A5" aria-label="\uC11C\uC2DD \uC800\uC7A5">Sv</button>
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
      <div class="ccf-inline-popover" data-inline-popover aria-hidden="true"></div>
    `;

    bindInlineToolbarEvents(toolbar);
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

      const styleAction = target.closest("[data-inline-style-action]");
      if (styleAction && toolbar.contains(styleAction)) {
        event.preventDefault();
        event.stopPropagation();
        const state = inlinePopoverState;
        if (!state || state.toolbar !== toolbar || state.kind !== "style-clipboard") return;
        const action = styleAction.getAttribute("data-inline-style-action");
        const applied = action === "save"
          ? saveStyleClipboardFromContext(state.context)
          : applyStyleClipboardToContext(state.context);
        if (applied) {
          closeInlinePopover(toolbar, { restoreFocus: false });
          restoreRoomSelectionSoon(state.editor, state.selection);
          showInlineToolbarSelectionHighlight(toolbar);
          updateInlineToolbarVisuals(toolbar);
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
      moveInlineSizeCursorToEnd(target);
      showInlineToolbarSelectionHighlight(toolbar);
    }, true);

    toolbar.addEventListener("focusout", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.matches?.("[data-inline-size]")) return;
      delete target.dataset.editingSize;
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
      applyBlurToCurrentSelection();
      restoreRoomSelectionSoon(editor, selection);
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
      openInlineStyleClipboardPopover(toolbar);
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
    const sanitized = input.value.replace(/[^\d]/g, "").slice(0, 3);
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
    if (editor) return;

    clearInlineToolbarSelection();
    document.querySelectorAll(INLINE_TOOLBAR_SELECTOR).forEach((toolbar) => {
      hideInlineToolbarSelectionHighlight(toolbar);
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

    if (command === "paren-gray") {
      applyParentheticalGrayToEditor(editor);
      return;
    }

    if (command === "narration") {
      const nextActive = !commandButton.classList.contains("active");
      commandButton.classList.toggle("active", nextActive);
      commandButton.setAttribute("aria-pressed", nextActive ? "true" : "false");
      applyInlineNarration(editor, nextActive);
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
      '[data-inline-command="bold"], [data-inline-command="italic"], [data-inline-command="underline"], [data-inline-command="strike"], [data-inline-command="narration"]'
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
    state.text = "";
    state.runs = [];
    state.alignRuns = [];
    state.lastStyle = null;
    state.blockStyle = {};
    state.roll20Source = null;

    const composer = findComposerForEditor(editor);
    refreshComposerBadge(composer, editor);
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

  function openInlineStyleClipboardPopover(toolbar) {
    const context = getInlineStyleClipboardContext(toolbar);
    if (!context?.selection || context.selection.start === context.selection.end) {
      alert("\uC11C\uC2DD\uC744 \uC800\uC7A5\uD558\uAC70\uB098 \uBD88\uB7EC\uC62C \uD14D\uC2A4\uD2B8\uB97C \uBA3C\uC800 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
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
    const hasSavedStyle = !!readStyleClipboard();
    popover.innerHTML = `
      <div class="ccf-inline-popover-title">\uC11C\uC2DD \uC800\uC7A5</div>
      <div class="ccf-code-note">${hasSavedStyle
        ? "\uC800\uC7A5\uB41C \uC11C\uC2DD\uC744 \uC120\uD0DD \uC601\uC5ED\uC5D0 \uBD88\uB7EC\uC62C \uC218 \uC788\uC2B5\uB2C8\uB2E4."
        : "\uC120\uD0DD \uD14D\uC2A4\uD2B8\uC758 \uC11C\uC2DD\uC744 \uBA3C\uC800 \uC800\uC7A5\uD574 \uC8FC\uC138\uC694."}</div>
      <div class="ccf-inline-popover-actions">
        <button type="button" class="ccf-btn" data-inline-popover-action="cancel">\uCDE8\uC18C</button>
        <button type="button" class="ccf-btn" data-inline-style-action="save">\uC800\uC7A5</button>
        <button type="button" class="ccf-btn primary" data-inline-style-action="load"${hasSavedStyle ? "" : " disabled"}>\uBD88\uB7EC\uC624\uAE30</button>
      </div>
    `;
    popover.classList.add("open");
    popover.setAttribute("aria-hidden", "false");
    inlinePopoverState = {
      kind: "style-clipboard",
      toolbar,
      popover,
      context,
      editor: context.editor,
      selection: context.selection
    };
    showInlineToolbarSelectionHighlight(toolbar);
    return true;
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
      popover.classList.remove("open");
      popover.setAttribute("aria-hidden", "true");
      popover.textContent = "";
    }
    if (state) {
      inlinePopoverState = null;
      if (options.restoreFocus !== false) {
        restoreRoomSelectionSoon(state.editor || state.context?.editor, state.selection || state.context?.selection);
      }
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
            <button type="button" class="ccf-toggle" id="ccf-parenthetical-gray" title="\uAD04\uD638 \uD68C\uC0C9" aria-label="\uAD04\uD638 \uD68C\uC0C9">()</button>
            <button type="button" class="ccf-toggle" id="ccf-narration-toggle" title="\uB098\uB808\uC774\uC158" aria-label="\uB098\uB808\uC774\uC158" aria-pressed="false">Nar</button>
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
    modal.querySelector("#ccf-parenthetical-gray")?.addEventListener("click", () => {
      applyParentheticalGrayToModalDraft();
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

  async function uploadImageFilesToIfh(files) {
    const imageFiles = getImageFilesFromFileList(files);
    if (!imageFiles.length) return [];

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

    const frame = await ensureIfhHelperFrame();
    if (!frame?.contentWindow) {
      throw createIfhUploadError("iFH 업로드 창과 연결하지 못했습니다.", "bridge-unavailable");
    }

    const requestId = `ccf-ifh-${Date.now().toString(36)}-${(++ifhBridgeRequestCounter).toString(36)}`;

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        IFH_PENDING_REQUESTS.delete(requestId);
        reject(createIfhUploadError("iFH 업로드 응답을 기다리다 시간이 초과되었습니다. 다시 시도해주세요.", "upload-timeout"));
      }, IFH_HELPER_TIMEOUT_MS);

      IFH_PENDING_REQUESTS.set(requestId, {
        resolve,
        reject,
        timeoutId
      });

      frame.contentWindow.postMessage({
        type: IFH_BRIDGE_REQUEST_TYPE,
        requestId,
        files: imageFiles
      }, IFH_ORIGIN);
    });
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
    }], selection, options);

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
      console.warn("[CCF] failed to upload image file to iFH", error);
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
      setImageStatus("iFH 업로드는 완료됐지만 삽입할 이미지 주소를 찾지 못했습니다.", "error");
      return false;
    }

    setImageStatus(
      inserted === 1
        ? "이미지를 iFH 링크로 추가했습니다."
        : `${inserted}개의 이미지를 iFH 링크로 추가했습니다.`,
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

    if (selection) {
      setModalSelection(selection, safeNextText.length);
    }
    syncFontSizeControlsFromModalSelection();
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

  function applyParentheticalGrayRuns(existingRuns, text) {
    return getParentheticalRanges(text).reduce(
      (runs, range) => patchStyleRuns(runs, range, { color: PARENTHETICAL_GRAY_COLOR }, text.length),
      cloneRuns(existingRuns, text.length)
    );
  }

  function applyParentheticalGrayToEditor(editor) {
    if (!editor) return false;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    if (!getParentheticalRanges(text).length) return false;

    const state = ensureEditorState(editor);
    state.runs = applyParentheticalGrayRuns(state.runs, text);
    state.text = text;
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
    if (!getParentheticalRanges(modalDraftText).length) return false;

    modalDraftRuns = applyParentheticalGrayRuns(
      modalDraftRuns ?? ensureEditorState(editor).runs,
      modalDraftText
    );
    renderPreview(editor, {
      force: true,
      restoreSelection: true,
      textOverride: modalDraftText,
      runsOverride: modalDraftRuns,
      alignRunsOverride: modalDraftAlignRuns
    });
    restoreModalSelectionSoon();
    return true;
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

  function writeStyleClipboard(value) {
    try {
      localStorage.setItem(STYLE_CLIPBOARD_STORAGE_KEY, JSON.stringify(value));
      return true;
    } catch (error) {
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
    const saved = {
      style: getStyleClipboardTextStyle(context),
      align: getStyleClipboardAlign(context)
    };
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

  function applyBlurToCurrentSelection() {
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
    const blockStyle = cleanupBlockStyle(
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

  function bindSendButtons() {
    const buttons = document.querySelectorAll('button[type="submit"]');
    buttons.forEach((btn) => {
      if (btn.dataset.ccfSendBound === "1") return;
      btn.dataset.ccfSendBound = "1";

      btn.addEventListener("click", (event) => {
        const composer = findClosestComposerBar(btn);
        const editor = composer ? findEditorFromComposer(composer) : findEditorFromNode(btn);
        if (!editor) return;

        const hadMessage = !!stripInvisibleEnvelope(getEditorText(editor)).trim();
        if (preparePayloadForSend(editor) === false) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }

        if (hadMessage) {
          scheduleInlineFormatResetAfterSend(editor);
        }
      }, true);
    });
  }

  function bindEnterSendForEditors() {
    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    editors.forEach((editor) => {
      if (editor.id === "ccf-preview") return;
      if (editor.closest && editor.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      if (editor.closest && editor.closest(`#${MODAL_ID}`)) return;
      if (editor.dataset.ccfEnterBound === "1") return;

      editor.dataset.ccfEnterBound = "1";
      editor.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key !== "Enter") return;
        if (event.shiftKey) return;
        const hadMessage = !!stripInvisibleEnvelope(getEditorText(editor)).trim();
        if (preparePayloadForSend(editor) === false) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          return;
        }

        if (hadMessage) {
          scheduleInlineFormatResetAfterSend(editor);
        }
      }, true);
    });
  }

  function bindEditorVisualPreview() {
    const editors = document.querySelectorAll(EDITOR_SELECTOR);
    editors.forEach((editor) => {
      if (editor.id === "ccf-preview") return;
      if (editor.closest && editor.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      if (editor.closest && editor.closest(`#${MODAL_ID}`)) return;
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
    document.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
      if (editor.id === "ccf-preview") return;
      if (editor.closest && editor.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      if (editor.closest && editor.closest(`#${MODAL_ID}`)) return;
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

    const entry = ensureEditorVisualPreview(editor);
    if (!entry) return;

    const text = stripInvisibleEnvelope(getEditorText(editor));
    const state = ensureEditorState(editor);
    const blockStyle = cleanupBlockStyle(state.blockStyle);
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
    editors.forEach((editor) => {
      if (editor.id === "ccf-preview") return;
      if (editor.closest && editor.closest(`[${SAFE_UI_ATTR}="1"]`)) return;
      if (editor.closest && editor.closest(`#${MODAL_ID}`)) return;
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

        if (diff) {
          state.runs = rebaseRunsForTextReplacement(
            cloneRuns(state.runs, prevText.length),
            { start: diff.start, end: diff.end },
            diff.insertedText,
            prevText.length,
            text.length
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
          state.lastStyle = null;
          state.blockStyle = {};
        } else {
          const toolbar = getInlineToolbarForEditor(editor);
          const narrationActive = toolbar?.querySelector?.('[data-inline-command="narration"]')?.classList.contains("active");
          if (narrationActive) {
            state.blockStyle = cleanupBlockStyle({
              ...state.blockStyle,
              narration: true
            });
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
    if (node.matches?.(EDITOR_SELECTOR)) return node;
    const closest = node.closest?.(EDITOR_SELECTOR);
    return closest instanceof HTMLElement ? closest : null;
  }

  function getCurrentTargetEditor() {
    const focused = normalizeEditorCandidate(document.activeElement);
    if (focused && isVisible(focused) && findComposerForEditor(focused)) return focused;
    if (lastFocusedEditor && document.contains(lastFocusedEditor) && isVisible(lastFocusedEditor)) {
      return lastFocusedEditor;
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

  function preparePayloadForSend(editor) {
    if (isModalOpen() && activeEditor && editor === activeEditor) {
      syncModalEditorToRoomEditor(true);
    }

    const currentText = getEditorText(editor);
    const rawText = stripInvisibleEnvelope(currentText);
    if (!rawText) return true;

    const state = ensureEditorState(editor);
    const preparedRuns = prepareRunsForTransport(state.runs, rawText.length);
    if (preparedRuns.failed) {
      alert("클립보드나 로컬 이미지를 저장하지 못해 전송을 중단했습니다. 이미지 링크를 사용하거나 이미지를 더 작게 만들어주세요.");
      return false;
    }

    const runs = preparedRuns.runs;
    const blockStyle = cleanupBlockStyle(state.blockStyle);
    const alignRuns = getEffectiveAlignRuns(rawText, state.alignRuns, blockStyle);
    if (!runs.length && !alignRuns.length && !blockStyle.narration) return true;
    const roll20Source = state.roll20Source;
    state.text = rawText;
    state.runs = runs;

    const envelope = {
      v: 1,
      text: rawText,
      formatRuns: runs,
      alignRuns,
      blockStyle
    };

    const presenceApi = window.__CAPYBARA_TOOLKIT_PRESENCE__;
    if (presenceApi && typeof presenceApi.decorateEnvelope === "function") {
      try {
        presenceApi.decorateEnvelope(envelope, rawText);
      } catch (error) {
        console.warn("[CCF] toolkit presence decoration failed", error);
      }
    }

    const encoded = encodeEnvelopeToInvisible(envelope);
    const outgoing = rawText + encoded;
    if (currentText === outgoing) return true;

    setEditorText(editor, outgoing);
    state.roll20Source = roll20Source;
    schedulePendingSendRestore(editor, rawText, outgoing);
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
    return normalized;
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
    if (isLocalImageToken(normalized)) return normalized;
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
      return persistLocalImageDataUrl(normalized);
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
    if (style.blur) el.style.filter = `blur(${style.blur})`;
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

  function looksLikeComposerBar(el) {
    if (!(el instanceof HTMLElement)) return false;
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

  function getResolvedActiveEditor() {
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

  function syncModalEditorToRoomEditor(commit = false) {
    if (modalMode === MODAL_MODE_ROLL20) {
      syncModalRoll20Draft();
    } else {
      syncModalCcfDraft();
    }

    if (!commit) return true;
    return commitModalDraftToRoomEditor();
  }

  function commitModalDraftToRoomEditor() {
    const roomEditor = getResolvedActiveEditor();
    if (!roomEditor) return false;

    if (modalMode === MODAL_MODE_ROLL20) {
      const converted = ensureRoll20DraftConverted({ silent: false, forceRender: true });
      if (!converted) return false;

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
      state.lastStyle = null;
      state.text = nextText;
      state.roll20Source = null;

      refreshComposerBadge(activeComposer, roomEditor);
      syncEditorVisualPreview(roomEditor);
      return true;
    }

    const nextText = modalDraftText ?? getEditorText(roomEditor);
    const nextRuns = cloneRuns(modalDraftRuns, nextText.length);
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
    state.text = nextText;
    state.roll20Source = null;
    if (modalDraftLastStyle) {
      state.lastStyle = { ...modalDraftLastStyle };
    }

    refreshComposerBadge(activeComposer, roomEditor);
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
      editor.dispatchEvent(new Event("input", { bubbles: true }));
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
