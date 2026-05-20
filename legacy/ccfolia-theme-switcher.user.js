// ==UserScript==
// @name         CCF Theme Switcher by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-theme-switcher
// @version      0.0.3
// @description  Adds a theme switcher panel, custom color themes, and theme import/export tools to CCFOLIA.
// @description:ko CCFOLIA에 테마 전환 패널, 사용자 지정 색상 테마, 테마 가져오기/내보내기 기능을 추가합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const STORAGE_KEY = "ccf-theme-switcher-settings-v1";
  const STYLE_ID = "ccf-theme-switcher-style";
  const VARS_STYLE_ID = "ccf-theme-switcher-vars";
  const TOGGLE_ID = "ccf-theme-switcher-toggle";
  const PANEL_ID = "ccf-theme-switcher-panel";
  const PANEL_POSITION_KEY = "ccf-theme-switcher-panel-position-v1";
  const CHARACTER_COLOR_STORAGE_KEY = "ccf-character-color-palette-v1";
  const STATUS_ID = "ccf-theme-switcher-status";
  const MODE_SELECT_ID = "ccf-theme-switcher-mode";
  const THEME_NAME_INPUT_ID = "ccf-theme-switcher-name";
  const SAVE_DIALOG_ID = "ccf-theme-switcher-save-dialog";
  const IMPORT_INPUT_ID = "ccf-theme-switcher-import";
  const ROOT_READY_ATTR = "data-ccf-theme-switcher-root";
  const UI_READY_ATTR = "data-ccf-theme-switcher-ui";
  const DEFAULT_MODE_ATTR = "data-ccf-theme-default";
  const ANCHOR_ATTR = "data-ccf-theme-switcher-anchor";
  const APPBAR_ATTR = "data-ccf-theme-switcher-appbar";
  const SAVED_MODE_PREFIX = "saved:";
  const CHARACTER_COLOR_WRAPPER_CLASS = "ccf-character-color-palette";
  const CHARACTER_COLOR_LIST_CLASS = "ccf-character-color-list";
  const CHARACTER_COLOR_SWATCH_CLASS = "ccf-character-color-swatch";
  const CHARACTER_COLOR_PICKER_CLASS = "ccf-character-color-picker";
  const CHARACTER_COLOR_ADD_CLASS = "ccf-character-color-add";
  const CHARACTER_COLOR_DELETE_CLASS = "ccf-character-color-delete";
  const CHARACTER_COLOR_EMPTY_CLASS = "ccf-character-color-empty";
  const CHARACTER_COLOR_TITLE_CLASS = "ccf-character-color-title";
  const CHARACTER_COLOR_INPUT_ROW_CLASS = "ccf-character-color-input-row";
  const CHARACTER_COLOR_CODE_GROUP_CLASS = "ccf-character-color-code-group";
  const CHARACTER_COLOR_ACTIONS_CLASS = "ccf-character-color-actions";
  const CHARACTER_COLOR_MODE_BUTTON_CLASS = "ccf-character-color-mode-button";
  const CHARACTER_COLOR_PROXY_INPUT_CLASS = "ccf-character-color-proxy-input";
  const CHARACTER_COLOR_INPUT_BOUND_ATTR = "data-ccf-character-color-bound";
  const CHARACTER_COLOR_CONTAINER_BOUND_ATTR = "data-ccf-character-color-container-bound";
  const CHARACTER_COLOR_RENDER_STATE_ATTR = "data-ccf-character-color-state";
  const CHARACTER_COLOR_MODE_BOUND_ATTR = "data-ccf-character-color-mode-bound";
  const CHARACTER_COLOR_PROXY_BOUND_ATTR = "data-ccf-character-color-proxy-bound";
  const CHARACTER_COLOR_NATIVE_INPUT_ATTR = "data-ccf-character-color-native-input";
  const CHARACTER_COLOR_CONTAINER_SELECTOR = 'div[style*="padding: 15px 9px 9px 15px"]';
  const CHARACTER_COLOR_INPUT_SELECTOR = 'input[id^="rc-editable-input"]';
  const CHARACTER_COLOR_POPOVER_ID = "ccf-character-color-popover";
  const CHARACTER_COLOR_POPOVER_CODE_GROUP_CLASS = "ccf-character-color-popover-code-group";
  const CHARACTER_COLOR_POPOVER_MODE_BUTTON_CLASS = "ccf-character-color-popover-mode";
  const CHARACTER_COLOR_POPOVER_EYEDROPPER_CLASS = "ccf-character-color-popover-eyedropper";

  const MODE_DEFAULT = "default";
  const MODE_LIGHT = "light";
  const MODE_CUSTOM = "custom";
  const DEFAULT_THEME_VERSION = 6;

  const FIELD_DEFS = Object.freeze([
    { key: "bg", label: "배경" },
    { key: "appbar", label: "상하단 바" },
    { key: "paper", label: "패널" },
    { key: "border", label: "테두리" },
    { key: "text", label: "텍스트" },
    { key: "inputBg", label: "입력창" }
  ]);

  const DEFAULT_CUSTOM_THEME = Object.freeze({
    bg: "#151414",
    appbar: "#22201f",
    paper: "#1d1c1e",
    border: "#413d3a",
    text: "#f4f0eb",
    inputBg: "#1a191b"
  });

  const DEFAULT_MODE_FALLBACK_THEME = Object.freeze({
    bg: "#202020",
    appbar: "#212121",
    paper: "#2a2a2a",
    border: "#444444",
    text: "#ffffff",
    inputBg: "#202020"
  });

  const PRESETS = Object.freeze({
    [MODE_LIGHT]: Object.freeze({
      bg: "#f1f1f1",
      appbar: "#dddddd",
      paper: "#fbfbfb",
      border: "#b9b9b9",
      text: "#2f2f2f",
      inputBg: "#ffffff"
    })
  });
  const CCF_SUITE_REGISTRY_KEY = "ccf-suite-registry-v1";
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_SUITE_REGISTER_EVENT = "ccf-suite:register";
  const CCF_SUITE_REQUEST_EVENT = "ccf-suite:request-register";
  const CCF_THEME_SWITCHER_SCRIPT_INFO = Object.freeze({
    id: "ccf-theme-switcher",
    name: "CCF Theme Switcher",
    version: getUserscriptVersion("0.0.2"),
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-theme-switcher"
  });

  let ccfThemeActive = true;
  const ccfThemeDisposers = [];
  const ccfThemeAbort = new AbortController();
  const ccfThemeSignal = ccfThemeAbort.signal;

  function ccfThemeRegisterTeardown(fn) {
    if (typeof fn === "function") ccfThemeDisposers.push(fn);
  }

  function ccfThemeWithSignal(options) {
    if (options == null) return { signal: ccfThemeSignal };
    if (typeof options === "boolean") return { capture: options, signal: ccfThemeSignal };
    if (typeof options === "object") {
      if (options.signal && options.signal !== ccfThemeSignal) return options;
      return { ...options, signal: ccfThemeSignal };
    }
    return { signal: ccfThemeSignal };
  }

  function ccfThemeTeardown() {
    if (!ccfThemeActive) return false;
    ccfThemeActive = false;
    try { ccfThemeAbort.abort(); } catch (error) { /* abort failed */ }
    while (ccfThemeDisposers.length) {
      const disposer = ccfThemeDisposers.pop();
      try { disposer(); } catch (error) { /* disposer failed */ }
    }
    try {
      document.querySelectorAll('[data-ccf-theme-injected="1"], style[data-ccf-theme-style]').forEach(el => el.remove());
    } catch (error) { /* dom sweep failed */ }
    try {
      if (window.__CCF_THEME_SWITCHER_DEBUG__ && window.__CCF_THEME_SWITCHER_DEBUG__.__owner === ccfThemeSignal) {
        delete window.__CCF_THEME_SWITCHER_DEBUG__;
      }
    } catch (error) { /* debug api cleanup failed */ }
    return true;
  }

  window.__CCF_THEME_SWITCHER_DEBUG__ = {
    __owner: ccfThemeSignal,
    isActive() { return ccfThemeActive; },
    disable() { return ccfThemeTeardown(); }
  };

  // Self-register with the suite manager so installation and version status can be tracked centrally.
  registerWithCcfSuite(CCF_THEME_SWITCHER_SCRIPT_INFO);
  window.addEventListener(CCF_SUITE_REQUEST_EVENT, handleCcfSuiteRegisterRequest, ccfThemeWithSignal());
  if (!isCcfSuiteScriptEnabled(CCF_THEME_SWITCHER_SCRIPT_INFO.id)) {
    return;
  }
  let settings = readStoredSettings();
  let panelPosition = readStoredPanelPosition();
  let globalEventsBound = false;
  let bodyObserver = null;
  let ensureUiFrame = 0;
  let ensureUiInProgress = false;
  let statusTimer = 0;
  let panelLayoutFrame = 0;
  let defaultModeRefreshFrame = 0;
  let themeFieldPreviewFrame = 0;
  let pendingThemeFieldPreview = null;
  let themeNameDraft = "";
  let panelDragState = null;
  let lastDicebotAnchor = null;
  let lastThemePreview = normalizeOptionalTheme(settings.defaultTheme) || null;
  const pendingCharacterColorSelections = new WeakMap();
  const pendingCharacterColorAddSelections = new WeakSet();
  const pendingCharacterColorDeleteSelections = new WeakMap();
  const pendingCharacterColorDeleteSnapshots = new WeakMap();
  const characterColorInputModes = new WeakMap();
  let activeCharacterColorPickerContainer = null;
  let activeCharacterColorPickerTrigger = null;
  let activeCharacterColorEditSource = "";
  let characterColorPopoverState = { h: 0, s: 1, v: 1 };
  let characterColorPopoverInputMode = "hex";

  start();

  function handleCcfSuiteRegisterRequest(event) {
    const targetId = event?.detail?.targetId;
    if (targetId && targetId !== CCF_THEME_SWITCHER_SCRIPT_INFO.id) return;
    registerWithCcfSuite(CCF_THEME_SWITCHER_SCRIPT_INFO);
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

  function start() {
    const tryInit = () => {
      if (!document.documentElement) return false;

      if (document.documentElement.getAttribute(ROOT_READY_ATTR) !== "1") {
        document.documentElement.setAttribute(ROOT_READY_ATTR, "1");
        injectStyles();
        applyTheme(settings, { syncUi: false });
      }

      if (!document.body) return false;

      ensureUi();
      ensureDefaultThemeSnapshot();

      if (document.body.getAttribute(UI_READY_ATTR) !== "1") {
        document.body.setAttribute(UI_READY_ATTR, "1");
        bindGlobalEvents();
        observeBody();
      }

      syncUiFromSettings();
      return true;
    };

    if (tryInit()) return;

    const onReady = () => {
      if (tryInit()) {
        document.removeEventListener("DOMContentLoaded", onReady, true);
        window.removeEventListener("load", onReady, true);
      }
    };

    document.addEventListener("DOMContentLoaded", onReady, ccfThemeWithSignal(true));
    window.addEventListener("load", onReady, ccfThemeWithSignal(true));

    const timer = window.setInterval(() => {
      if (!ccfThemeActive) { window.clearInterval(timer); return; }
      if (tryInit()) {
        window.clearInterval(timer);
      }
    }, 300);
    ccfThemeRegisterTeardown(() => window.clearInterval(timer));

    window.setTimeout(() => {
      window.clearInterval(timer);
    }, 15000);
  }

  function injectStyles() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        html[data-ccf-theme-active="1"],
        html[data-ccf-theme-active="1"] body {
          background: var(--ccf-theme-bg) !important;
        }

        html[data-ccf-theme-active="1"] body {
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] main,
        html[data-ccf-theme-active="1"] [role="main"] {
          background: var(--ccf-theme-bg) !important;
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] a {
          color: var(--ccf-theme-text) !important;
          text-decoration-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] ::selection {
          background: var(--ccf-theme-control-active) !important;
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] ::-webkit-scrollbar-track {
          background: var(--ccf-theme-bg);
        }

        html[data-ccf-theme-active="1"] ::-webkit-scrollbar-thumb {
          background: var(--ccf-theme-border);
          border: 2px solid var(--ccf-theme-bg);
          border-radius: 999px;
        }

        html[data-ccf-theme-active="1"] .MuiAppBar-root,
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] {
          background: var(--ccf-theme-appbar) !important;
          color: var(--ccf-theme-text) !important;
          box-shadow: 0 10px 24px var(--ccf-theme-shadow) !important;
        }

        html[${DEFAULT_MODE_ATTR}="1"] .MuiAppBar-root,
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] {
          background: var(--ccf-theme-default-appbar) !important;
          color: var(--ccf-theme-default-text) !important;
          box-shadow: 0 10px 24px var(--ccf-theme-default-shadow) !important;
        }

        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"],
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] *,
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] a {
          color: var(--ccf-theme-text) !important;
          text-decoration-color: var(--ccf-theme-text) !important;
        }

        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"],
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] *,
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] a {
          color: var(--ccf-theme-default-text) !important;
          text-decoration-color: var(--ccf-theme-default-text) !important;
        }

        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] .MuiButtonBase-root,
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] .MuiIconButton-root,
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] .MuiSvgIcon-root {
          color: var(--ccf-theme-text) !important;
        }

        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] .MuiButtonBase-root,
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] .MuiIconButton-root,
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] .MuiSvgIcon-root {
          color: var(--ccf-theme-default-text) !important;
        }

        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] .MuiInputBase-root,
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] .MuiInputBase-input {
          color: var(--ccf-theme-text) !important;
        }

        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] .MuiInputBase-root,
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] .MuiInputBase-input {
          color: var(--ccf-theme-default-text) !important;
        }

        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] svg path[fill="#202020"],
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] svg path[fill="#000000"],
        html[data-ccf-theme-active="1"] [${APPBAR_ATTR}="1"] svg path[fill="#000"] {
          fill: var(--ccf-theme-surface-strong) !important;
        }

        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] svg path[fill="#202020"],
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] svg path[fill="#000000"],
        html[${DEFAULT_MODE_ATTR}="1"] [${APPBAR_ATTR}="1"] svg path[fill="#000"] {
          fill: var(--ccf-theme-default-surface-strong) !important;
        }

        html[data-ccf-theme-active="1"] .MuiDrawer-paper,
        html[data-ccf-theme-active="1"] .MuiDialog-paper,
        html[data-ccf-theme-active="1"] .MuiPopover-paper,
        html[data-ccf-theme-active="1"] .MuiMenu-paper,
        html[data-ccf-theme-active="1"] .MuiPaper-root.MuiPopover-paper,
        html[data-ccf-theme-active="1"] .MuiPaper-root.MuiDialog-paper,
        html[data-ccf-theme-active="1"] div[role="presentation"] > .MuiPaper-root,
        html[data-ccf-theme-active="1"] div[role="dialog"] {
          background: var(--ccf-theme-paper) !important;
          color: var(--ccf-theme-text) !important;
          border-color: var(--ccf-theme-border) !important;
          box-shadow: 0 16px 32px var(--ccf-theme-shadow) !important;
        }

        html[data-ccf-theme-active="1"] .MuiPaper-root,
        html[data-ccf-theme-active="1"] .MuiCard-root {
          border-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .MuiPaper-root:not(.MuiAppBar-root),
        html[data-ccf-theme-active="1"] .MuiCard-root,
        html[data-ccf-theme-active="1"] .MuiAccordion-root {
          background: var(--ccf-theme-paper) !important;
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiDivider-root {
          border-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .MuiDialog-paper > [class^="sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper > [class*=" sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper > [class^="sc-"] > [class^="sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper > [class^="sc-"] > [class*=" sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper > [class*=" sc-"] > [class^="sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper > [class*=" sc-"] > [class*=" sc-"] {
          background: transparent !important;
        }

        html[data-ccf-theme-active="1"] .MuiDialog-paper [class^="sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper [class*=" sc-"],
        html[data-ccf-theme-active="1"] .MuiDialog-paper li[role="button"] {
          color: var(--ccf-theme-text) !important;
          border-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .MuiDialog-paper li[role="button"] {
          border-radius: 8px;
          transition: background-color 140ms ease, color 140ms ease;
        }

        html[data-ccf-theme-active="1"] .MuiDialog-paper li[role="button"]:hover {
          background: var(--ccf-theme-hover) !important;
        }

        html[data-ccf-theme-active="1"] .MuiDialog-paper li[role="button"][data-active="true"] {
          background: var(--ccf-theme-control-active) !important;
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiTypography-root:not([style*="color:"]),
        html[data-ccf-theme-active="1"] .MuiButton-root,
        html[data-ccf-theme-active="1"] .MuiButtonBase-root,
        html[data-ccf-theme-active="1"] .MuiIconButton-root,
        html[data-ccf-theme-active="1"] .MuiTab-root,
        html[data-ccf-theme-active="1"] .MuiMenuItem-root,
        html[data-ccf-theme-active="1"] .MuiListItemButton-root,
        html[data-ccf-theme-active="1"] .MuiListItemIcon-root,
        html[data-ccf-theme-active="1"] .MuiSvgIcon-root,
        html[data-ccf-theme-active="1"] .MuiFormLabel-root,
        html[data-ccf-theme-active="1"] .MuiFormControlLabel-label {
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiListItemText-secondary,
        html[data-ccf-theme-active="1"] .MuiFormHelperText-root {
          color: var(--ccf-theme-muted-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiDialog-paper .MuiListItemText-secondary,
        html[data-ccf-theme-active="1"] .MuiDialog-paper .MuiTypography-caption,
        html[data-ccf-theme-active="1"] .MuiDialog-paper .MuiInputLabel-root,
        html[data-ccf-theme-active="1"] .MuiDialog-paper [class^="sc-"] .MuiTypography-body2,
        html[data-ccf-theme-active="1"] .MuiDialog-paper [class*=" sc-"] .MuiTypography-body2 {
          color: var(--ccf-theme-muted-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiSvgIcon-root path[fill="#202020"],
        html[data-ccf-theme-active="1"] .MuiSvgIcon-root path[fill="#000000"],
        html[data-ccf-theme-active="1"] .MuiSvgIcon-root path[fill="#000"] {
          fill: currentColor !important;
        }

        html[data-ccf-theme-active="1"] .MuiButton-root:hover,
        html[data-ccf-theme-active="1"] .MuiButtonBase-root:hover,
        html[data-ccf-theme-active="1"] .MuiIconButton-root:hover,
        html[data-ccf-theme-active="1"] .MuiTab-root:hover,
        html[data-ccf-theme-active="1"] .MuiMenuItem-root:hover,
        html[data-ccf-theme-active="1"] .MuiListItemButton-root:hover {
          background: var(--ccf-theme-hover) !important;
        }

        html[data-ccf-theme-active="1"] .MuiTab-root.Mui-selected,
        html[data-ccf-theme-active="1"] .MuiMenuItem-root.Mui-selected,
        html[data-ccf-theme-active="1"] .MuiListItemButton-root.Mui-selected,
        html[data-ccf-theme-active="1"] .Mui-selected > .MuiListItemButton-root {
          background: var(--ccf-theme-control-active) !important;
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiTabs-indicator {
          background: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiButton-outlined {
          border-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .MuiInputBase-root,
        html[data-ccf-theme-active="1"] .MuiOutlinedInput-root,
        html[data-ccf-theme-active="1"] .MuiFilledInput-root,
        html[data-ccf-theme-active="1"] .MuiSelect-select,
        html[data-ccf-theme-active="1"] .MuiInputBase-input,
        html[data-ccf-theme-active="1"] .MuiInputBase-multiline {
          background: var(--ccf-theme-input-bg) !important;
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiInputBase-root fieldset,
        html[data-ccf-theme-active="1"] .MuiOutlinedInput-notchedOutline {
          border-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .MuiFilledInput-root::before,
        html[data-ccf-theme-active="1"] .MuiFilledInput-root::after {
          border-bottom-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .MuiFilledInput-root:hover:not(.Mui-disabled, .Mui-error)::before {
          border-bottom-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] .Mui-focused .MuiOutlinedInput-notchedOutline,
        html[data-ccf-theme-active="1"] .MuiInputBase-root.Mui-focused fieldset {
          border-color: var(--ccf-theme-border) !important;
          box-shadow: 0 0 0 2px var(--ccf-theme-focus-ring) !important;
        }

        html[data-ccf-theme-active="1"] .MuiSwitch-track {
          background: var(--ccf-theme-border) !important;
          opacity: 1 !important;
        }

        html[data-ccf-theme-active="1"] .MuiSwitch-thumb {
          background: var(--ccf-theme-paper) !important;
        }

        html[data-ccf-theme-active="1"] .MuiSwitch-switchBase {
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiSwitch-switchBase.Mui-checked {
          color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track {
          background: var(--ccf-theme-control-active) !important;
          opacity: 1 !important;
        }

        html[data-ccf-theme-active="1"] input,
        html[data-ccf-theme-active="1"] textarea,
        html[data-ccf-theme-active="1"] select {
          color: var(--ccf-theme-text) !important;
          caret-color: var(--ccf-theme-text) !important;
        }

        html[data-ccf-theme-active="1"] input::placeholder,
        html[data-ccf-theme-active="1"] textarea::placeholder,
        html[data-ccf-theme-active="1"] .MuiInputBase-input::placeholder,
        html[data-ccf-theme-active="1"] .MuiInputBase-input::-webkit-input-placeholder,
        html[data-ccf-theme-active="1"] .MuiInputBase-input::-moz-placeholder,
        html[data-ccf-theme-active="1"] .MuiInputBase-input:-ms-input-placeholder {
          color: var(--ccf-theme-placeholder) !important;
          opacity: 1 !important;
        }

        html[data-ccf-theme-active="1"] .MuiBackdrop-root {
          background: var(--ccf-theme-overlay) !important;
        }

        html[data-ccf-theme-active="1"] .MuiPaper-root canvas,
        html[data-ccf-theme-active="1"] canvas {
          border-color: var(--ccf-theme-border) !important;
          box-shadow: 0 10px 24px var(--ccf-theme-shadow) !important;
        }

        [${ANCHOR_ATTR}="1"] {
          position: relative;
          display: flex !important;
          align-items: center;
          max-width: 100%;
          min-width: 0;
          height: var(--ccf-theme-anchor-height, auto);
          min-height: var(--ccf-theme-anchor-height, 0px);
          max-height: var(--ccf-theme-anchor-height, none);
          box-sizing: border-box;
          overflow: hidden;
        }

        [${ANCHOR_ATTR}="1"] > :first-child {
          display: block;
          min-width: 0;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          padding-right: 34px;
          box-sizing: border-box;
          line-height: var(--ccf-theme-anchor-height, inherit);
        }

        [${ANCHOR_ATTR}="1"] .MuiTypography-root,
        [${ANCHOR_ATTR}="1"] .MuiTypography-caption,
        [${ANCHOR_ATTR}="1"] a {
          line-height: var(--ccf-theme-anchor-height, inherit) !important;
        }

        #${TOGGLE_ID} {
          position: absolute;
          z-index: 1;
          width: 24px;
          height: 24px;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          cursor: pointer;
          display: grid;
          place-items: center;
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          line-height: 0;
          opacity: 0.82;
          transition: background-color 140ms ease, color 140ms ease, opacity 140ms ease;
        }

        #${TOGGLE_ID}[hidden] {
          display: none !important;
        }

        #${TOGGLE_ID}:hover {
          background: rgba(127, 127, 127, 0.12);
          opacity: 1;
        }

        #${TOGGLE_ID}:focus-visible {
          outline: 2px solid rgba(127, 127, 127, 0.32);
          outline-offset: 1px;
          opacity: 1;
        }

        #${TOGGLE_ID} svg {
          width: 20px;
          height: 20px;
          display: block;
        }

        #${PANEL_ID} {
          position: fixed;
          left: 20px;
          top: 20px;
          width: min(350px, calc(100vw - 24px));
          box-sizing: border-box;
          max-height: min(78vh, 700px);
          overflow: auto;
          z-index: 2147482601;
          border: 0;
          border-radius: 0;
          background: var(--ccf-theme-panel-glass-bg, #2a2a2a);
          color: var(--ccf-theme-text, #f4f0eb);
          box-shadow: 0 28px 60px rgba(0, 0, 0, 0.38);
          transform: translateY(12px) scale(0.98);
          opacity: 0;
          pointer-events: none;
          transition: transform 160ms ease, opacity 160ms ease;
        }

        #${PANEL_ID}.open {
          transform: translateY(0) scale(1);
          opacity: 1;
          pointer-events: auto;
        }

        #${PANEL_ID} .ccf-theme-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 16px;
        }

        #${PANEL_ID} .ccf-theme-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          cursor: move;
          user-select: none;
        }

        #${PANEL_ID}.dragging {
          transition: none;
        }

        #${PANEL_ID} .ccf-theme-title {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        #${PANEL_ID} .ccf-theme-title strong {
          font-size: 15px;
          line-height: 1.2;
        }

        #${PANEL_ID} .ccf-theme-title span {
          color: var(--ccf-theme-muted-text, rgba(244, 240, 235, 0.72));
          font-size: 12px;
          line-height: 1.4;
        }

        #${PANEL_ID} .ccf-theme-close,
        #${PANEL_ID} .ccf-theme-btn {
          border: 0;
          background: var(--ccf-theme-surface-strong, rgba(21, 20, 20, 0.9));
          color: var(--ccf-theme-text, #f4f0eb);
          border-radius: 0;
          cursor: pointer;
          font: inherit;
          transition: background-color 140ms ease, transform 140ms ease;
        }

        #${PANEL_ID} .ccf-theme-close {
          width: 34px;
          height: 34px;
          flex: 0 0 auto;
        }

        #${PANEL_ID} .ccf-theme-btn {
          min-height: 38px;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          white-space: nowrap;
          font-size: 13px;
        }

        #${PANEL_ID} .ccf-theme-close:hover,
        #${PANEL_ID} .ccf-theme-btn:hover {
          background: var(--ccf-theme-control-active, rgba(255, 255, 255, 0.1));
          transform: translateY(-1px);
        }

        #${PANEL_ID} .ccf-theme-row,
        #${PANEL_ID} .ccf-theme-field {
          display: grid;
          grid-template-columns: minmax(88px, auto) minmax(0, 1fr);
          align-items: center;
          gap: 10px;
        }

        #${PANEL_ID} .ccf-theme-row span,
        #${PANEL_ID} .ccf-theme-field span {
          font-size: 12px;
          color: var(--ccf-theme-muted-text, rgba(244, 240, 235, 0.72));
        }

        #${PANEL_ID} .ccf-theme-select {
          width: 100%;
          min-width: 0;
          height: 38px;
          border: 1px solid var(--ccf-theme-border, rgba(255, 255, 255, 0.16));
          border-radius: 0;
          padding: 0 12px;
          box-sizing: border-box;
          background: var(--ccf-theme-input-bg, rgba(21, 20, 20, 0.88));
          color: var(--ccf-theme-text, #f4f0eb);
          font: inherit;
          outline: none;
        }

        #${PANEL_ID} .ccf-theme-grid {
          display: grid;
          gap: 10px;
        }

        #${PANEL_ID} .ccf-theme-color-control {
          display: grid;
          grid-template-columns: 32px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        #${PANEL_ID} .ccf-theme-color {
          width: 32px;
          min-width: 32px;
          height: 32px;
          border: 1px solid var(--ccf-theme-border, rgba(255, 255, 255, 0.16));
          border-radius: 0;
          background: transparent;
          padding: 0;
          box-sizing: border-box;
          cursor: pointer;
          appearance: none;
          -webkit-appearance: none;
        }

        #${PANEL_ID} .ccf-theme-color::-webkit-color-swatch-wrapper {
          padding: 0;
        }

        #${PANEL_ID} .ccf-theme-color::-webkit-color-swatch {
          border: 0;
          border-radius: 0;
        }

        #${PANEL_ID} .ccf-theme-color::-moz-color-swatch {
          border: 0;
          border-radius: 0;
        }

        #${PANEL_ID} .ccf-theme-color-code {
          width: 100%;
          min-width: 0;
          height: 38px;
          border: 1px solid var(--ccf-theme-border, rgba(255, 255, 255, 0.16));
          border-radius: 0;
          padding: 0 12px;
          box-sizing: border-box;
          background: var(--ccf-theme-input-bg, rgba(21, 20, 20, 0.88));
          color: var(--ccf-theme-text, #f4f0eb);
          font: inherit;
          outline: none;
        }

        #${PANEL_ID} .ccf-theme-color-code::placeholder {
          color: var(--ccf-theme-placeholder, rgba(244, 240, 235, 0.42));
        }

        #${PANEL_ID} .ccf-theme-actions {
          display: flex;
          flex-wrap: nowrap;
          gap: 8px;
          align-items: stretch;
          width: 100%;
          margin-top: 4px;
        }

        #${PANEL_ID} .ccf-theme-actions .ccf-theme-btn {
          flex: 1 1 0;
          min-width: 0;
          min-height: 40px;
          padding: 8px 16px;
        }

        #${PANEL_ID} .ccf-theme-actions + .ccf-theme-actions {
          margin-top: 8px;
        }

        #${SAVE_DIALOG_ID} {
          position: absolute;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(0, 0, 0, 0.28);
          z-index: 1;
        }

        #${SAVE_DIALOG_ID}.open {
          display: flex;
        }

        #${SAVE_DIALOG_ID} .ccf-theme-save-card {
          width: min(280px, 100%);
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          box-sizing: border-box;
          border: 0;
          background: var(--ccf-theme-save-card-bg, rgba(29, 28, 30, 0.88));
          box-shadow: 0 18px 36px rgba(0, 0, 0, 0.28);
        }

        #${SAVE_DIALOG_ID} .ccf-theme-save-title {
          margin: 0;
          font-size: 14px;
          line-height: 1.3;
        }

        #${SAVE_DIALOG_ID} .ccf-theme-save-note {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--ccf-theme-muted-text, rgba(244, 240, 235, 0.72));
        }

        #${SAVE_DIALOG_ID} .ccf-theme-save-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        #${PANEL_ID} .ccf-theme-note {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--ccf-theme-muted-text, rgba(244, 240, 235, 0.72));
        }

        .${CHARACTER_COLOR_WRAPPER_CLASS} {
          clear: both;
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.2));
          box-sizing: border-box;
        }

        .${CHARACTER_COLOR_TITLE_CLASS} {
          flex: 1 0 100%;
          font-size: 11px;
          line-height: 1.4;
          color: var(--ccf-theme-muted-text, rgba(127, 127, 127, 0.92));
        }

        .${CHARACTER_COLOR_LIST_CLASS} {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          gap: 0;
          flex: 1 1 auto;
          min-width: 0;
        }

        .${CHARACTER_COLOR_EMPTY_CLASS} {
          width: 30px;
          height: 30px;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          border: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.24));
          background: transparent;
          opacity: 0.72;
          border-radius: 4px;
          margin: 0 6px 6px 0;
          cursor: pointer;
          position: relative;
          padding: 0;
          outline: none;
          transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
        }

        .${CHARACTER_COLOR_EMPTY_CLASS}:hover {
          transform: scale(1.06);
          box-shadow: 0 10px 18px var(--ccf-theme-shadow, rgba(0, 0, 0, 0.18));
          z-index: 1;
        }

        .${CHARACTER_COLOR_EMPTY_CLASS}.is-active::after {
          content: "";
          position: absolute;
          inset: -3px;
          border: 2px solid #ffffff;
          border-radius: 7px;
          pointer-events: none;
        }

        .${CHARACTER_COLOR_SWATCH_CLASS},
        .${CHARACTER_COLOR_PICKER_CLASS},
        .${CHARACTER_COLOR_ADD_CLASS},
        .${CHARACTER_COLOR_DELETE_CLASS} {
          width: 30px;
          height: 30px;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          border: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.24));
          background: var(--ccf-theme-input-bg, rgba(255, 255, 255, 0.88));
          color: var(--ccf-theme-text, #2f2f2f);
          cursor: pointer;
          position: relative;
          padding: 0;
          border-radius: 4px;
          outline: none;
          transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
        }

        .${CHARACTER_COLOR_SWATCH_CLASS}:hover,
        .${CHARACTER_COLOR_PICKER_CLASS}:hover,
        .${CHARACTER_COLOR_ADD_CLASS}:hover,
        .${CHARACTER_COLOR_DELETE_CLASS}:hover {
          transform: scale(1.06);
          box-shadow: 0 10px 18px var(--ccf-theme-shadow, rgba(0, 0, 0, 0.18));
          z-index: 1;
        }

        .${CHARACTER_COLOR_SWATCH_CLASS} {
          background: var(--ccf-character-color-value, #ffffff);
          margin: 0 6px 6px 0;
        }

        .${CHARACTER_COLOR_SWATCH_CLASS}.is-active::after {
          content: "";
          position: absolute;
          inset: -3px;
          border: 2px solid #ffffff;
          border-radius: 7px;
          pointer-events: none;
        }

        .${CHARACTER_COLOR_SWATCH_CLASS}.is-delete-selected::before {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.22);
          border-radius: 4px;
          pointer-events: none;
        }

        .${CHARACTER_COLOR_SWATCH_CLASS}.is-delete-selected::after {
          content: "";
          position: absolute;
          inset: -3px;
          border: 2px solid #ffffff;
          border-radius: 7px;
          pointer-events: none;
        }

        .${CHARACTER_COLOR_PICKER_CLASS} {
          overflow: hidden;
        }

        .${CHARACTER_COLOR_PICKER_CLASS} svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
          pointer-events: none;
        }

        .${CHARACTER_COLOR_PICKER_CLASS} input[type="color"] {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
          border: 0;
          margin: 0;
          padding: 0;
        }

        .${CHARACTER_COLOR_ADD_CLASS} {
          font-size: 18px;
          font-weight: 700;
          line-height: 1;
        }

        .${CHARACTER_COLOR_ADD_CLASS}[data-ccf-character-color-state="cancel"] {
          font-size: 9px;
          letter-spacing: -0.04em;
        }

        .${CHARACTER_COLOR_DELETE_CLASS} {
          font-size: 15px;
          font-weight: 700;
          line-height: 1;
        }

        .${CHARACTER_COLOR_INPUT_ROW_CLASS} {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 6px;
          box-sizing: border-box;
        }

        .${CHARACTER_COLOR_CODE_GROUP_CLASS} {
          display: flex;
          align-items: center;
          gap: 0;
          flex: 0 0 auto;
          min-width: auto;
        }

        .${CHARACTER_COLOR_MODE_BUTTON_CLASS} {
          cursor: pointer;
          user-select: none;
          text-transform: uppercase;
          font-size: 10px !important;
          font-weight: 700 !important;
          letter-spacing: 0.04em;
        }

        .${CHARACTER_COLOR_MODE_BUTTON_CLASS}[data-ccf-character-color-mode="hex"] {
          font-size: 17px !important;
          letter-spacing: 0;
        }

        .${CHARACTER_COLOR_INPUT_ROW_CLASS} > div[style*="position: relative"],
        .${CHARACTER_COLOR_CODE_GROUP_CLASS} > div[style*="position: relative"] {
          flex: 0 0 auto;
          min-width: auto;
        }

        input[${CHARACTER_COLOR_NATIVE_INPUT_ATTR}="1"] {
          position: absolute !important;
          inset: 0 !important;
          width: 0 !important;
          min-width: 0 !important;
          opacity: 0 !important;
          pointer-events: none !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
          box-shadow: none !important;
        }

        .${CHARACTER_COLOR_PROXY_INPUT_CLASS} {
          width: 100px !important;
        }

        .${CHARACTER_COLOR_PROXY_INPUT_CLASS}[data-ccf-character-color-mode="rgb"],
        .${CHARACTER_COLOR_PROXY_INPUT_CLASS}[data-ccf-character-color-mode="hsl"] {
          width: 100px !important;
          font-size: 12px !important;
          letter-spacing: -0.01em;
        }

        .${CHARACTER_COLOR_ACTIONS_CLASS} {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
        }

        .${CHARACTER_COLOR_ADD_CLASS}[disabled],
        .${CHARACTER_COLOR_DELETE_CLASS}[disabled],
        .${CHARACTER_COLOR_PICKER_CLASS}[disabled] {
          opacity: 0.42;
          cursor: default;
          box-shadow: none;
          transform: none;
        }

        #${CHARACTER_COLOR_POPOVER_ID} {
          position: fixed;
          left: 0;
          top: 0;
          width: 238px;
          padding: 12px;
          box-sizing: border-box;
          border: 1px solid var(--ccf-theme-panel-border, rgba(127, 127, 127, 0.32));
          background: var(--ccf-theme-panel-glass-bg, rgba(28, 28, 30, 0.92));
          box-shadow: 0 18px 36px var(--ccf-theme-shadow, rgba(0, 0, 0, 0.24));
          z-index: 2147483600;
          display: none;
          backdrop-filter: blur(12px);
        }

        #${CHARACTER_COLOR_POPOVER_ID}.open {
          display: block;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .ccf-character-color-popover-sv {
          position: relative;
          width: 100%;
          height: 152px;
          cursor: crosshair;
          background-image:
            linear-gradient(to top, #000000, transparent),
            linear-gradient(to right, #ffffff, hsl(0, 100%, 50%));
        }

        #${CHARACTER_COLOR_POPOVER_ID} .ccf-character-color-popover-handle {
          position: absolute;
          width: 14px;
          height: 14px;
          border: 2px solid #ffffff;
          border-radius: 999px;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.32);
          transform: translate(-7px, -7px);
          pointer-events: none;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .ccf-character-color-popover-hue {
          width: 100%;
          margin: 12px 0 0;
          accent-color: hsl(210, 100%, 50%);
        }

        #${CHARACTER_COLOR_POPOVER_ID} .ccf-character-color-popover-row {
          display: grid;
          grid-template-columns: 32px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          margin-top: 10px;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .${CHARACTER_COLOR_POPOVER_CODE_GROUP_CLASS} {
          display: flex;
          align-items: center;
          min-width: 0;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .ccf-character-color-popover-preview {
          width: 32px;
          height: 32px;
          border: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.24));
          box-sizing: border-box;
          background: #ffffff;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .ccf-character-color-popover-hex {
          width: 100%;
          min-width: 0;
          height: 30px;
          box-sizing: border-box;
          border: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.24));
          background: var(--ccf-theme-input-bg, rgba(255, 255, 255, 0.88));
          color: var(--ccf-theme-text, #2f2f2f);
          padding: 0 10px;
          outline: none;
          border-left: 0;
          border-radius: 0 4px 4px 0;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .${CHARACTER_COLOR_POPOVER_EYEDROPPER_CLASS} {
          min-width: 40px;
          height: 32px;
          border: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.24));
          background: var(--ccf-theme-input-bg, rgba(255, 255, 255, 0.88));
          color: var(--ccf-theme-text, #2f2f2f);
          cursor: pointer;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .${CHARACTER_COLOR_POPOVER_MODE_BUTTON_CLASS} {
          width: 30px;
          min-width: 30px;
          height: 30px;
          flex: 0 0 30px;
          border: 1px solid var(--ccf-theme-border, rgba(127, 127, 127, 0.24));
          background: var(--ccf-theme-input-bg, rgba(255, 255, 255, 0.88));
          color: var(--ccf-theme-text, #2f2f2f);
          cursor: pointer;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          border-radius: 4px 0 0 4px;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .${CHARACTER_COLOR_POPOVER_MODE_BUTTON_CLASS}[data-ccf-character-color-mode="hex"] {
          font-size: 17px;
          letter-spacing: 0;
          text-transform: none;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .${CHARACTER_COLOR_POPOVER_EYEDROPPER_CLASS}[disabled] {
          opacity: 0.42;
          cursor: default;
        }

        #${CHARACTER_COLOR_POPOVER_ID} .${CHARACTER_COLOR_POPOVER_EYEDROPPER_CLASS} svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
          pointer-events: none;
        }

      `;
      document.documentElement.appendChild(style);
    }

    if (!document.getElementById(VARS_STYLE_ID)) {
      const varsStyle = document.createElement("style");
      varsStyle.id = VARS_STYLE_ID;
      document.documentElement.appendChild(varsStyle);
    }
  }

  function ensureUi() {
    if (!document.body) return;

    if (!document.getElementById(TOGGLE_ID)) {
      const toggle = document.createElement("button");
      toggle.id = TOGGLE_ID;
      toggle.type = "button";
      toggle.title = "테마 패널 열기";
      toggle.setAttribute("aria-label", "테마 패널 열기");
      toggle.setAttribute("aria-haspopup", "dialog");
      toggle.setAttribute("aria-expanded", "false");
      toggle.innerHTML = `
        <svg viewBox="2 3 20 18" aria-hidden="true" fill="none">
          <path
            d="M12 4.75c-4.832 0-8.75 3.19-8.75 7.125C3.25 15.809 6.531 19 10.579 19h.43c.571 0 1.034-.445 1.034-.994 0-.252-.103-.492-.286-.672a1.557 1.557 0 0 1-.472-1.108c0-.878.74-1.589 1.651-1.589h1.236c3.047 0 5.578-2.266 5.578-5.072 0-2.972-3.432-4.815-7.75-4.815Z"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="7.45" cy="11.1" r="1.05" fill="currentColor" />
          <circle cx="10.1" cy="8.1" r="1.05" fill="currentColor" />
          <circle cx="13.55" cy="8" r="1.05" fill="currentColor" />
          <circle cx="16.15" cy="10.75" r="1.05" fill="currentColor" />
        </svg>
      `;
      document.body.appendChild(toggle);
      toggle.addEventListener("click", () => togglePanel());
    }

    mountToggle();

    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement("aside");
      panel.id = PANEL_ID;
      panel.setAttribute("aria-hidden", "true");
      panel.innerHTML = `
        <div class="ccf-theme-card">
          <div class="ccf-theme-head">
            <div class="ccf-theme-title">
              <strong>CCF Theme</strong>
              <span>메인 포맷 스크립트와 분리된 독립 테마입니다.</span>
            </div>
            <button type="button" class="ccf-theme-close" data-action="close" aria-label="테마 패널 닫기">×</button>
          </div>
          <label class="ccf-theme-row">
            <span>테마 모드</span>
            <select id="${MODE_SELECT_ID}" class="ccf-theme-select" aria-label="테마 모드">
              <option value="${MODE_DEFAULT}">기본값</option>
              <option value="${MODE_LIGHT}">라이트</option>
              <option value="${MODE_CUSTOM}">커스텀</option>
            </select>
          </label>
          <div class="ccf-theme-grid">
            ${FIELD_DEFS.map((field) => `
              <label class="ccf-theme-field">
                <span>${escapeHtml(field.label)}</span>
                <div class="ccf-theme-color-control">
                <input
                  class="ccf-theme-color"
                  type="color"
                  data-key="${escapeHtml(field.key)}"
                  aria-label="${escapeHtml(field.label)} 색상"
                  value="#000000"
                >
                  <input
                    class="ccf-theme-color-code"
                    type="text"
                    data-key="${escapeHtml(field.key)}"
                    data-role="color-code"
                    spellcheck="false"
                    autocomplete="off"
                    placeholder="#FFFFFF / 255,255,255 / rgb(255,255,255)"
                    aria-label="${escapeHtml(field.label)} code"
                    value="#000000"
                  >
                </div>
              </label>
            `).join("")}
          </div>
          <div class="ccf-theme-actions">
            <button type="button" class="ccf-theme-btn" data-action="save-theme">현재 색상 저장</button>
            <button type="button" class="ccf-theme-btn" data-action="reset">기본 테마로 복원</button>
          </div>
          <div class="ccf-theme-actions">
            <button type="button" class="ccf-theme-btn" data-action="import-theme">가져오기</button>
            <button type="button" class="ccf-theme-btn" data-action="export-theme">내보내기</button>
            <button type="button" class="ccf-theme-btn" data-action="delete-theme">테마 삭제</button>
          </div>
          <input id="${IMPORT_INPUT_ID}" type="file" accept=".json,application/json" hidden>
        </div>
        <div id="${SAVE_DIALOG_ID}" aria-hidden="true">
          <div class="ccf-theme-save-card" role="dialog" aria-modal="true" aria-labelledby="${SAVE_DIALOG_ID}-title">
            <p id="${SAVE_DIALOG_ID}-title" class="ccf-theme-save-title">테마 이름 저장</p>
            <p class="ccf-theme-save-note">같은 이름으로 저장하면 기존 테마를 덮어씁니다.</p>
            <input
              id="${THEME_NAME_INPUT_ID}"
              class="ccf-theme-select"
              type="text"
              maxlength="24"
              placeholder="예: 내 라이트 테마"
              aria-label="저장할 테마 이름"
            >
            <div class="ccf-theme-save-actions">
              <button type="button" class="ccf-theme-btn" data-action="cancel-save-theme">취소</button>
              <button type="button" class="ccf-theme-btn" data-action="confirm-save-theme">저장</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      panel.querySelector(".ccf-theme-head")?.addEventListener("mousedown", startPanelDrag);

      panel.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const action = target.dataset.action || "";
        if (action === "close") {
          setPanelOpen(false);
          return;
        }

        if (action === "save-theme") {
          openSaveThemeDialog();
          return;
        }

        if (action === "import-theme") {
          triggerThemeImport();
          return;
        }

        if (action === "export-theme") {
          exportCurrentTheme();
          return;
        }

        if (action === "delete-theme") {
          deleteCurrentSavedTheme();
          return;
        }

        if (action === "cancel-save-theme") {
          closeSaveThemeDialog();
          return;
        }

        if (action === "confirm-save-theme") {
          saveCurrentTheme();
          return;
        }

        if (action === "reset") {
          const isCustomMode = settings.mode === MODE_CUSTOM;
          settings = {
            ...settings,
            mode: isCustomMode ? MODE_CUSTOM : MODE_DEFAULT,
            customTheme: { ...DEFAULT_CUSTOM_THEME }
          };
          themeNameDraft = "";
          persistSettings();
          applyTheme(settings);
          setStatus(
            isCustomMode ? "커스텀 색상을 기본값으로 복원했습니다." : "기본 테마로 복원했습니다.",
            "success"
          );
        }
      });

      panel.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const key = target.dataset.key || "";
        if (!isThemeFieldKey(key)) return;

        if (target.type === "color") {
          previewThemeFieldValue(key, target.value);
          return;
        }

        if (target.dataset.role === "color-code") {
          handleColorCodeTyping(target);
          return;
        }
        setStatus("커스텀 색상을 반영했습니다.", "success");
      });

      panel.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const key = target.dataset.key || "";
        if (!isThemeFieldKey(key)) return;
        if (target.type !== "color") return;

        commitThemeFieldValue(key, target.value);
      });

      panel.addEventListener("focusout", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.dataset.role !== "color-code") return;
        finalizeColorCodeInput(target);
      });

      panel.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.dataset.role !== "color-code") return;
        if (event.key !== "Enter") return;

        event.preventDefault();
        finalizeColorCodeInput(target);
      });

      panel.querySelector(`#${MODE_SELECT_ID}`)?.addEventListener("change", (event) => {
        const previousThemePreview = getDisplayedThemeFromPanel() || getThemePreviewForTransition();
        const nextMode = normalizeMode(event.currentTarget.value);
        if (nextMode === MODE_CUSTOM) {
          ensureCustomMode(previousThemePreview);
        } else {
          settings.mode = nextMode;
        }
        themeNameDraft = getThemeNameDraftForMode(settings.mode);

        persistSettings();
        applyTheme(settings);
        setStatus(
          nextMode === MODE_DEFAULT ? "사이트 기본 색으로 돌아갑니다." : "테마를 변경했습니다.",
          "success"
        );
      });

      panel.querySelector(`#${THEME_NAME_INPUT_ID}`)?.addEventListener("input", (event) => {
        themeNameDraft = normalizeThemeName(event.currentTarget.value, "");
      });

      panel.querySelector(`#${IMPORT_INPUT_ID}`)?.addEventListener("change", (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLInputElement)) return;
        void handleImportedThemeFile(target);
      });
    }

    ensureCharacterColorPopover();
    ensureCharacterColorPalettes();

    if (isPanelOpen()) {
      queuePanelPositionUpdate();
    }
  }

  function ensureCharacterColorPalettes() {
    if (!document.body) return;

    const storedColors = readStoredCharacterColors();
    const containers = new Set();

    document.querySelectorAll(CHARACTER_COLOR_INPUT_SELECTOR).forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (!isLikelyCharacterColorInput(input)) return;

      const container = findCharacterColorContainer(input);
      if (!(container instanceof HTMLElement)) return;

      containers.add(container);
      bindCharacterColorContainer(container);
      bindCharacterColorInput(input, container);
    });

    containers.forEach((container) => {
      ensureCharacterColorPaletteInContainer(container, storedColors);
    });
  }

  function bindCharacterColorInput(input, container) {
    if (!(input instanceof HTMLInputElement) || !(container instanceof HTMLElement)) return;
    if (input.getAttribute(CHARACTER_COLOR_INPUT_BOUND_ATTR) === "1") return;

    input.setAttribute(CHARACTER_COLOR_INPUT_BOUND_ATTR, "1");

    const refresh = () => {
      pendingCharacterColorSelections.delete(container);
      exitCharacterColorDeleteMode(container);
      syncCharacterColorModeUi(container, input);
      const palette = container.querySelector(`.${CHARACTER_COLOR_WRAPPER_CLASS}`);
      const actions = container.querySelector(`.${CHARACTER_COLOR_ACTIONS_CLASS}`);
      renderCharacterColorActionGroup(actions, container, readStoredCharacterColors());
      if (palette instanceof HTMLElement) {
        renderCharacterColorPalette(palette, readStoredCharacterColors());
      }
    };

    input.addEventListener("input", refresh);
    input.addEventListener("change", refresh);
  }

  function bindCharacterColorContainer(container) {
    if (!(container instanceof HTMLElement)) return;
    if (container.getAttribute(CHARACTER_COLOR_CONTAINER_BOUND_ATTR) === "1") return;

    container.setAttribute(CHARACTER_COLOR_CONTAINER_BOUND_ATTR, "1");

    const refreshFromContainer = (event) => {
      const clickedColor = resolveNativeCharacterColorFromTarget(event?.target, container);
      if (clickedColor) {
        pendingCharacterColorSelections.set(container, clickedColor);
      }

      const runRefresh = () => {
        const actions = container.querySelector(`.${CHARACTER_COLOR_ACTIONS_CLASS}`);
        const palette = container.querySelector(`.${CHARACTER_COLOR_WRAPPER_CLASS}`);
        const storedColors = readStoredCharacterColors();

        renderCharacterColorActionGroup(actions, container, storedColors);
        if (palette instanceof HTMLElement) {
          renderCharacterColorPalette(palette, storedColors);
        }
      };

      window.requestAnimationFrame(runRefresh);
      window.setTimeout(runRefresh, 40);
      window.setTimeout(runRefresh, 120);
    };

    container.addEventListener("click", refreshFromContainer, true);
    container.addEventListener("pointerup", refreshFromContainer, true);
  }

  function ensureCharacterColorPaletteInContainer(container, storedColors = readStoredCharacterColors()) {
    if (!(container instanceof HTMLElement)) return;

    container.style.paddingBottom = "0px";

    const inputRow = ensureCharacterColorInputRow(container);
    const actionGroup = ensureCharacterColorActionGroup(container, inputRow);

    let palette = container.querySelector(`.${CHARACTER_COLOR_WRAPPER_CLASS}`);
    if (!(palette instanceof HTMLElement)) {
      palette = createCharacterColorPalette(container);
      if (!(palette instanceof HTMLElement)) return;
    } else {
      palette.querySelector(`.${CHARACTER_COLOR_PICKER_CLASS}`)?.remove();
      palette.querySelector(`.${CHARACTER_COLOR_ADD_CLASS}`)?.remove();
      palette.querySelector(`.${CHARACTER_COLOR_DELETE_CLASS}`)?.remove();
    }

    if (inputRow instanceof HTMLElement) {
      const nextSibling = inputRow.nextSibling;
      if (nextSibling !== palette) {
        container.insertBefore(palette, nextSibling);
      }
    } else if (palette.parentElement !== container) {
      container.appendChild(palette);
    }

    renderCharacterColorActionGroup(actionGroup, container, storedColors);
    renderCharacterColorPalette(palette, storedColors);
  }

  function createCharacterColorPalette(container) {
    if (!(container instanceof HTMLElement)) return null;

    const palette = document.createElement("div");
    palette.className = CHARACTER_COLOR_WRAPPER_CLASS;
    palette.innerHTML = `
      <div class="${CHARACTER_COLOR_LIST_CLASS}"></div>
    `;

    return palette;
  }

  function ensureCharacterColorInputRow(container) {
    if (!(container instanceof HTMLElement)) return null;

    const input = findCharacterColorInputInContainer(container);
    if (!(input instanceof HTMLInputElement)) return null;

    const inputWrapper = input.closest('div[style*="position: relative"]');
    if (!(inputWrapper instanceof HTMLElement)) return null;
    const prefix = findCharacterColorPrefixElement(inputWrapper);

    const existingRow = inputWrapper.closest(`.${CHARACTER_COLOR_INPUT_ROW_CLASS}`);
    if (existingRow instanceof HTMLElement) {
      ensureCharacterColorCodeGroup(existingRow, inputWrapper, prefix);
      ensureCharacterColorModeUi(container, input, inputWrapper, prefix);
      return existingRow;
    }

    const row = document.createElement("div");
    row.className = CHARACTER_COLOR_INPUT_ROW_CLASS;
    inputWrapper.parentElement?.insertBefore(row, prefix || inputWrapper);
    const codeGroup = ensureCharacterColorCodeGroup(row, inputWrapper, prefix);
    if (!(codeGroup instanceof HTMLElement)) return row;
    ensureCharacterColorModeUi(container, input, inputWrapper, prefix);
    return row;
  }

  function ensureCharacterColorCodeGroup(row, inputWrapper, prefixOverride = null) {
    if (!(row instanceof HTMLElement) || !(inputWrapper instanceof HTMLElement)) return null;

    let codeGroup = row.querySelector(`.${CHARACTER_COLOR_CODE_GROUP_CLASS}`);
    if (!(codeGroup instanceof HTMLElement)) {
      codeGroup = document.createElement("div");
      codeGroup.className = CHARACTER_COLOR_CODE_GROUP_CLASS;
      row.insertBefore(codeGroup, row.firstChild);
    }

    const prefix = prefixOverride instanceof HTMLElement
      ? prefixOverride
      : findCharacterColorPrefixElement(inputWrapper);
    if (prefix instanceof HTMLElement && prefix.parentElement !== codeGroup) {
      codeGroup.appendChild(prefix);
    }

    if (inputWrapper.parentElement !== codeGroup) {
      codeGroup.appendChild(inputWrapper);
    }

    return codeGroup;
  }

  function findCharacterColorPrefixElement(inputWrapper) {
    if (!(inputWrapper instanceof HTMLElement)) return null;

    const candidates = [
      inputWrapper.previousElementSibling,
      inputWrapper.parentElement?.previousElementSibling,
      inputWrapper.closest(`.${CHARACTER_COLOR_INPUT_ROW_CLASS}`)?.previousElementSibling,
      inputWrapper.closest(`.${CHARACTER_COLOR_CODE_GROUP_CLASS}`)?.previousElementSibling
    ];

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (candidate.classList.contains(CHARACTER_COLOR_MODE_BUTTON_CLASS)) {
        return candidate;
      }
      if (normalizeSpace(candidate.textContent || "") !== "#") continue;
      return candidate;
    }

    return null;
  }

  function ensureCharacterColorModeUi(container, input, inputWrapper, prefixOverride = null) {
    if (!(container instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(inputWrapper instanceof HTMLElement)) {
      return;
    }

    const prefix = prefixOverride instanceof HTMLElement
      ? prefixOverride
      : findCharacterColorPrefixElement(inputWrapper);
    const proxy = ensureCharacterColorProxyInput(container, input, inputWrapper);

    if (prefix instanceof HTMLElement) {
      prefix.classList.add(CHARACTER_COLOR_MODE_BUTTON_CLASS);
      prefix.setAttribute("role", "button");
      prefix.setAttribute("tabindex", "0");

      if (prefix.getAttribute(CHARACTER_COLOR_MODE_BOUND_ATTR) !== "1") {
        prefix.setAttribute(CHARACTER_COLOR_MODE_BOUND_ATTR, "1");

        const handleToggle = (event) => {
          event.preventDefault();
          event.stopPropagation();
          cycleCharacterColorInputMode(container, input);
        };

        prefix.addEventListener("click", handleToggle);
        prefix.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          handleToggle(event);
        });
      }
    }

    syncCharacterColorModeUi(container, input, prefix, proxy);
  }

  function ensureCharacterColorProxyInput(container, input, inputWrapper) {
    if (!(container instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(inputWrapper instanceof HTMLElement)) {
      return null;
    }

    let proxy = inputWrapper.querySelector(`.${CHARACTER_COLOR_PROXY_INPUT_CLASS}`);
    if (!(proxy instanceof HTMLInputElement)) {
      proxy = document.createElement("input");
      proxy.type = "text";
      proxy.className = CHARACTER_COLOR_PROXY_INPUT_CLASS;
      proxy.spellcheck = false;
      proxy.autocomplete = "off";
      proxy.style.cssText = input.style.cssText;
      inputWrapper.appendChild(proxy);
    }

    input.setAttribute(CHARACTER_COLOR_NATIVE_INPUT_ATTR, "1");

    if (proxy.getAttribute(CHARACTER_COLOR_PROXY_BOUND_ATTR) !== "1") {
      proxy.setAttribute(CHARACTER_COLOR_PROXY_BOUND_ATTR, "1");

      const applyProxyValue = (commit = false) => {
        const normalized = parseCharacterColorInputForMode(
          proxy.value,
          getCharacterColorInputMode(container),
          ""
        );

        if (!normalized) {
          if (commit) {
            syncCharacterColorModeUi(container, input, findCharacterColorPrefixElement(inputWrapper), proxy);
          }
          return false;
        }

        applyCharacterColorToInput(input, normalized, { blur: commit });
        return true;
      };

      proxy.addEventListener("input", () => {
        applyProxyValue(false);
      });

      proxy.addEventListener("change", () => {
        applyProxyValue(true);
      });

      proxy.addEventListener("blur", () => {
        applyProxyValue(true);
        syncCharacterColorModeUi(container, input, findCharacterColorPrefixElement(inputWrapper), proxy);
      });

      proxy.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        applyProxyValue(true);
        proxy.blur();
      });
    }

    return proxy;
  }

  function syncCharacterColorModeUi(container, input, prefixOverride = null, proxyOverride = null) {
    if (!(container instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    const inputWrapper = input.closest('div[style*="position: relative"]');
    if (!(inputWrapper instanceof HTMLElement)) return;

    const mode = getCharacterColorInputMode(container);
    const prefix = prefixOverride instanceof HTMLElement
      ? prefixOverride
      : findCharacterColorPrefixElement(inputWrapper);
    const proxy = proxyOverride instanceof HTMLInputElement
      ? proxyOverride
      : inputWrapper.querySelector(`.${CHARACTER_COLOR_PROXY_INPUT_CLASS}`);

    if (prefix instanceof HTMLElement) {
      prefix.textContent = getCharacterColorInputModeLabel(mode);
      prefix.setAttribute("data-ccf-character-color-mode", mode);
      prefix.title = `Switch color input mode (${mode.toUpperCase()})`;
      prefix.setAttribute("aria-label", `Switch color input mode. Current mode ${mode.toUpperCase()}`);
    }

    if (proxy instanceof HTMLInputElement) {
      proxy.setAttribute("data-ccf-character-color-mode", mode);
      proxy.placeholder = getCharacterColorInputPlaceholder(mode);
      proxy.value = formatCharacterColorInputForMode(getCharacterColorInputValue(container), mode);
    }
  }

  function getCharacterColorInputMode(container) {
    if (!(container instanceof HTMLElement)) return "hex";
    return normalizeCharacterColorInputMode(characterColorInputModes.get(container));
  }

  function setCharacterColorInputMode(container, mode, input = null) {
    if (!(container instanceof HTMLElement)) return;

    const nextMode = normalizeCharacterColorInputMode(mode);
    characterColorInputModes.set(container, nextMode);
    const targetInput = input instanceof HTMLInputElement ? input : findCharacterColorInputInContainer(container);
    if (targetInput instanceof HTMLInputElement) {
      syncCharacterColorModeUi(container, targetInput);
    }
  }

  function cycleCharacterColorInputMode(container, input = null) {
    if (!(container instanceof HTMLElement)) return;

    const nextMode = getNextCharacterColorInputMode(getCharacterColorInputMode(container));
    setCharacterColorInputMode(container, nextMode, input);
  }

  function getNextCharacterColorInputMode(mode) {
    const modes = ["hex", "rgb", "hsl"];
    const currentMode = normalizeCharacterColorInputMode(mode);
    const currentIndex = modes.indexOf(currentMode);
    return modes[(currentIndex + 1 + modes.length) % modes.length];
  }

  function normalizeCharacterColorInputMode(mode) {
    return ["hex", "rgb", "hsl"].includes(mode) ? mode : "hex";
  }

  function getCharacterColorInputModeLabel(mode) {
    const normalized = normalizeCharacterColorInputMode(mode);
    if (normalized === "rgb") return "RGB";
    if (normalized === "hsl") return "HSL";
    return "#";
  }

  function getCharacterColorInputPlaceholder(mode) {
    const normalized = normalizeCharacterColorInputMode(mode);
    if (normalized === "rgb") return "255, 255, 255";
    if (normalized === "hsl") return "200, 100%, 50%";
    return "FFFFFF";
  }

  function formatCharacterColorInputForMode(color, mode) {
    const normalized = normalizeHexColor(color, "");
    if (!normalized) return "";

    const targetMode = normalizeCharacterColorInputMode(mode);
    if (targetMode === "rgb") {
      const rgb = hexToRgb(normalized);
      return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    }

    if (targetMode === "hsl") {
      const hsl = rgbToHsl(hexToRgb(normalized));
      return `${Math.round(hsl.h)}, ${Math.round(hsl.s * 100)}%, ${Math.round(hsl.l * 100)}%`;
    }

    return normalized.slice(1).toUpperCase();
  }

  function parseCharacterColorInputForMode(value, mode, fallback = "") {
    const raw = normalizeSpace(value);
    if (!raw) return fallback;

    const targetMode = normalizeCharacterColorInputMode(mode);
    if (targetMode === "hex") {
      return normalizeHexColor(raw, fallback);
    }

    if (targetMode === "rgb") {
      const rgb = parseRgbColorCode(raw);
      return rgb ? rgbToHex(rgb) : fallback;
    }

    if (targetMode === "hsl") {
      const hsl = parseHslColorCode(raw);
      return hsl ? rgbToHex(hslToRgb(hsl)) : fallback;
    }

    return parseColorCode(raw, fallback);
  }

  function ensureCharacterColorActionGroup(container, inputRow) {
    if (!(container instanceof HTMLElement) || !(inputRow instanceof HTMLElement)) return null;

    let actions = inputRow.querySelector(`.${CHARACTER_COLOR_ACTIONS_CLASS}`);
    if (actions instanceof HTMLElement) {
      return actions;
    }

    actions = document.createElement("div");
    actions.className = CHARACTER_COLOR_ACTIONS_CLASS;
    actions.innerHTML = `
      <button type="button" class="${CHARACTER_COLOR_PICKER_CLASS}" title="Pick a color" aria-label="Pick character color">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"></path>
        </svg>
      </button>
      <button type="button" class="${CHARACTER_COLOR_ADD_CLASS}" title="Save current color" aria-label="Save current color">+</button>
      <button type="button" class="${CHARACTER_COLOR_DELETE_CLASS}" title="Delete current color" aria-label="Delete current color">X</button>
    `;
    inputRow.appendChild(actions);

    const pickerButton = actions.querySelector(`.${CHARACTER_COLOR_PICKER_CLASS}`);
    const addButton = actions.querySelector(`.${CHARACTER_COLOR_ADD_CLASS}`);
    const deleteButton = actions.querySelector(`.${CHARACTER_COLOR_DELETE_CLASS}`);

    if (pickerButton instanceof HTMLButtonElement) {
      pickerButton.addEventListener("click", () => {
        toggleCharacterColorPopover(container, pickerButton);
      });
    }

    if (addButton instanceof HTMLButtonElement) {
      addButton.addEventListener("click", () => {
        if (isCharacterColorDeleteModeActive(container)) {
          exitCharacterColorDeleteMode(container, { restore: true });
          refreshCharacterColorPalettes();
          return;
        }

        const currentColor = getCharacterColorInputValue(container);
        if (!currentColor) return;

        const colors = readStoredCharacterColors();
        if (colors.includes(currentColor)) {
          refreshCharacterColorPalettes();
          return;
        }

        persistCharacterColors([...colors, currentColor]);
        pendingCharacterColorAddSelections.delete(container);
        refreshCharacterColorPalettes();
      });
    }

    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.addEventListener("click", () => {
        const colors = readStoredCharacterColors();
        if (!colors.length) {
          refreshCharacterColorPalettes();
          return;
        }

        if (isCharacterColorDeleteModeActive(container)) {
          const selections = getCharacterColorDeleteSelections(container);
          if (selections.size) {
            persistCharacterColors(colors.filter((entry) => !selections.has(entry)));
          }
          exitCharacterColorDeleteMode(container, { restore: false });
          refreshCharacterColorPalettes();
          return;
        }
        enterCharacterColorDeleteMode(container);
        refreshCharacterColorPalettes();
      });
    }

    return actions;
  }

  function renderCharacterColorActionGroup(actions, container, storedColors = readStoredCharacterColors()) {
    if (!(actions instanceof HTMLElement)) return;

    const currentColor = getActiveCharacterColor(container);
    const isAddSelected = isCharacterColorAddSelectionActive(container);
    const isDeleteMode = isCharacterColorDeleteModeActive(container);
    const deleteSelections = getCharacterColorDeleteSelections(container);
    const pickerButton = actions.querySelector(`.${CHARACTER_COLOR_PICKER_CLASS}`);
    const addButton = actions.querySelector(`.${CHARACTER_COLOR_ADD_CLASS}`);
    const deleteButton = actions.querySelector(`.${CHARACTER_COLOR_DELETE_CLASS}`);
    const isSaved = !!currentColor && storedColors.includes(currentColor);

    if (pickerButton instanceof HTMLButtonElement) {
      pickerButton.disabled = isDeleteMode;
      pickerButton.title = isDeleteMode
        ? "Finish delete selection first"
        : currentColor
          ? isAddSelected
            ? `Pick a color for a new saved slot (${currentColor})`
            : `Pick a color (${currentColor})`
          : "Pick a color";
    }

    if (addButton instanceof HTMLButtonElement) {
      addButton.disabled = !isDeleteMode && (!currentColor || isSaved);
      addButton.textContent = isDeleteMode ? "Cancel" : "+";
      addButton.setAttribute("data-ccf-character-color-state", isDeleteMode ? "cancel" : "default");
      addButton.title = isDeleteMode
        ? "Cancel delete selection and return"
        : isSaved
          ? "Current color is already saved"
          : "Save current color";
      addButton.setAttribute(
        "aria-label",
        isDeleteMode ? "Cancel delete selection and return" : "Save current color"
      );
    }

    if (deleteButton instanceof HTMLButtonElement) {
      deleteButton.disabled = !storedColors.length || (isDeleteMode && !deleteSelections.size);
      deleteButton.textContent = isDeleteMode ? "OK" : "X";
      deleteButton.title = !storedColors.length
        ? "No saved colors to delete"
        : isDeleteMode
          ? deleteSelections.size
            ? `Delete ${deleteSelections.size} selected color${deleteSelections.size > 1 ? "s" : ""}`
            : "Select colors to confirm deletion"
          : "Select saved colors to delete";
      deleteButton.setAttribute(
        "aria-label",
        isDeleteMode
          ? deleteSelections.size
            ? `Delete ${deleteSelections.size} selected saved colors`
            : "Select colors to confirm deletion"
          : "Select saved colors to delete"
      );
    }
  }

  function renderCharacterColorPalette(palette, storedColors = readStoredCharacterColors()) {
    if (!(palette instanceof HTMLElement)) return;

    const list = palette.querySelector(`.${CHARACTER_COLOR_LIST_CLASS}`);
    if (!(list instanceof HTMLElement)) return;

    const container = palette.parentElement;
    const currentColor = getActiveCharacterColor(container);
    const isAddSelected = isCharacterColorAddSelectionActive(container);
    const isDeleteMode = isCharacterColorDeleteModeActive(container);
    const deleteSelections = [...getCharacterColorDeleteSelections(container)].sort();
    const renderState = JSON.stringify({
      currentColor,
      colors: storedColors,
      isAddSelected,
      isDeleteMode,
      deleteSelections
    });

    if (palette.getAttribute(CHARACTER_COLOR_RENDER_STATE_ATTR) === renderState) {
      return;
    }

    palette.setAttribute(CHARACTER_COLOR_RENDER_STATE_ATTR, renderState);

    list.textContent = "";

    storedColors.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = CHARACTER_COLOR_SWATCH_CLASS;
      swatch.title = isDeleteMode
        ? `${color} - click to ${deleteSelections.includes(color) ? "unselect" : "select"} for deletion`
        : `${color} - click to apply, right-click to remove`;
      swatch.style.setProperty("--ccf-character-color-value", color);
      swatch.classList.toggle("is-active", !isAddSelected && !isDeleteMode && color === currentColor);
      swatch.classList.toggle("is-delete-selected", isDeleteMode && deleteSelections.includes(color));

      swatch.addEventListener("click", () => {
        if (isDeleteMode) {
          toggleCharacterColorDeleteSelection(container, color);
          refreshCharacterColorPalettes();
          return;
        }

        const targetInput = findCharacterColorInputInContainer(container);
        if (!(targetInput instanceof HTMLInputElement)) return;

        exitCharacterColorDeleteMode(container);
        pendingCharacterColorAddSelections.delete(container);
        if (!applyCharacterColorToInput(targetInput, color)) return;
        refreshCharacterColorPalettes();
      });

      swatch.addEventListener("contextmenu", (event) => {
        event.preventDefault();

        if (isDeleteMode) {
          toggleCharacterColorDeleteSelection(container, color);
          refreshCharacterColorPalettes();
          return;
        }

        if (!window.confirm(`Remove ${color} from the saved list?`)) {
          return;
        }

        persistCharacterColors(readStoredCharacterColors().filter((entry) => entry !== color));
        refreshCharacterColorPalettes();
      });

      list.appendChild(swatch);
    });

    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = CHARACTER_COLOR_EMPTY_CLASS;
    placeholder.title = "Click to create a new saved color";
    placeholder.setAttribute("aria-label", "Create a new saved color");
    placeholder.classList.toggle("is-active", isAddSelected && !isDeleteMode);
    placeholder.addEventListener("click", () => {
      exitCharacterColorDeleteMode(container);
      pendingCharacterColorAddSelections.add(container);
      refreshCharacterColorPalettes();
    });
    list.appendChild(placeholder);
  }

  function refreshCharacterColorPalettes() {
    const storedColors = readStoredCharacterColors();
    document.querySelectorAll(`.${CHARACTER_COLOR_WRAPPER_CLASS}`).forEach((palette) => {
      if (palette instanceof HTMLElement) {
        renderCharacterColorActionGroup(
          palette.parentElement?.querySelector(`.${CHARACTER_COLOR_ACTIONS_CLASS}`),
          palette.parentElement,
          storedColors
        );
        renderCharacterColorPalette(palette, storedColors);
      }
    });
  }

  function findCharacterColorContainer(input) {
    if (!(input instanceof HTMLInputElement)) return null;

    const styledContainer = input.closest(CHARACTER_COLOR_CONTAINER_SELECTOR);
    if (styledContainer instanceof HTMLElement) {
      return styledContainer;
    }

    const inputWrapper = input.closest('div[style*="position: relative"]');
    if (!(inputWrapper instanceof HTMLElement)) return null;

    let parent = inputWrapper.parentElement;
    if (parent instanceof HTMLElement && parent.classList.contains(CHARACTER_COLOR_CODE_GROUP_CLASS)) {
      parent = parent.parentElement;
    }
    if (parent instanceof HTMLElement && parent.classList.contains(CHARACTER_COLOR_INPUT_ROW_CLASS)) {
      parent = parent.parentElement;
    }
    if (!(parent instanceof HTMLElement)) return null;

    if (parent.querySelector(CHARACTER_COLOR_INPUT_SELECTOR) === input) {
      return parent;
    }

    return null;
  }

  function findCharacterColorInputInContainer(container) {
    if (!(container instanceof HTMLElement)) return null;

    const inputs = container.querySelectorAll(CHARACTER_COLOR_INPUT_SELECTOR);
    for (const input of inputs) {
      if (input instanceof HTMLInputElement && isLikelyCharacterColorInput(input)) {
        return input;
      }
    }

    return null;
  }

  function isLikelyCharacterColorInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;

    const rawValue = normalizeSpace(input.value || "");
    if (!rawValue) return true;
    return !!normalizeHexColor(rawValue, "");
  }

  function getCharacterColorInputValue(container) {
    const input = findCharacterColorInputInContainer(container);
    if (!(input instanceof HTMLInputElement)) return "";
    return normalizeHexColor(input.value, "");
  }

  function ensureCharacterColorPopover() {
    if (!document.body) return null;

    let popover = document.getElementById(CHARACTER_COLOR_POPOVER_ID);
    if (popover instanceof HTMLElement) {
      return popover;
    }

    popover = document.createElement("div");
    popover.id = CHARACTER_COLOR_POPOVER_ID;
    popover.setAttribute("aria-hidden", "true");
    popover.innerHTML = `
      <div class="ccf-character-color-popover-sv" tabindex="0" aria-label="Character color picker">
        <div class="ccf-character-color-popover-handle"></div>
      </div>
      <input class="ccf-character-color-popover-hue" type="range" min="0" max="360" step="1" value="0" aria-label="Hue">
      <div class="ccf-character-color-popover-row">
        <div class="ccf-character-color-popover-preview" aria-hidden="true"></div>
        <div class="${CHARACTER_COLOR_POPOVER_CODE_GROUP_CLASS}">
          <button
            type="button"
            class="${CHARACTER_COLOR_POPOVER_MODE_BUTTON_CLASS}"
            data-ccf-character-color-mode="hex"
            title="Switch color input mode (HEX)"
            aria-label="Switch color input mode. Current mode HEX"
          >#</button>
          <input class="ccf-character-color-popover-hex" type="text" spellcheck="false" autocomplete="off" aria-label="Hex color">
        </div>
        <button
          type="button"
          class="${CHARACTER_COLOR_POPOVER_EYEDROPPER_CLASS}"
          title="Pick color from screen"
          aria-label="Pick color from screen"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.146 4.854a2.5 2.5 0 0 0-3.536 0l-1.06 1.06-.707-.707a1 1 0 1 0-1.414 1.414l.707.707-7.95 7.95a1 1 0 0 0-.263.465l-.8 3.2a1 1 0 0 0 1.213 1.212l3.2-.8a1 1 0 0 0 .465-.263l7.95-7.95.707.707a1 1 0 0 0 1.414-1.414l-.707-.707 1.06-1.06a2.5 2.5 0 0 0 0-3.536Zm-4.243 3.89 1.414 1.414-7.571 7.571-1.697.424.424-1.697 7.43-7.43Z"></path>
          </svg>
        </button>
      </div>
    `;
    document.body.appendChild(popover);

    const sv = popover.querySelector(".ccf-character-color-popover-sv");
    const hue = popover.querySelector(".ccf-character-color-popover-hue");
    const hex = popover.querySelector(".ccf-character-color-popover-hex");
    const modeButton = popover.querySelector(`.${CHARACTER_COLOR_POPOVER_MODE_BUTTON_CLASS}`);
    const eyeDropperButton = popover.querySelector(`.${CHARACTER_COLOR_POPOVER_EYEDROPPER_CLASS}`);

    if (sv instanceof HTMLElement) {
      const handlePointer = (event) => {
        updateCharacterColorFromPopoverPointer(event, sv);
      };

      sv.addEventListener("pointerdown", (event) => {
        handlePointer(event);
        sv.setPointerCapture?.(event.pointerId);
      });

      sv.addEventListener("pointermove", (event) => {
        if (!(event.buttons & 1)) return;
        handlePointer(event);
      });
    }

    if (hue instanceof HTMLInputElement) {
      hue.addEventListener("input", () => {
        characterColorPopoverState.h = clamp(Number(hue.value) || 0, 0, 360);
        syncCharacterColorPopoverUi();
        applyCharacterColorFromPopover(false);
      });
    }

    if (hex instanceof HTMLInputElement) {
      hex.addEventListener("input", () => {
        const normalized = parseCharacterColorInputForMode(hex.value, characterColorPopoverInputMode, "");
        if (!normalized) return;
        syncCharacterColorPopoverStateFromHex(normalized);
        syncCharacterColorPopoverUi();
        applyCharacterColorFromPopover(false);
      });

      hex.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        closeCharacterColorPopover(true);
      });
    }

    if (modeButton instanceof HTMLButtonElement) {
      const handleToggle = (event) => {
        event.preventDefault();
        characterColorPopoverInputMode = getNextCharacterColorInputMode(characterColorPopoverInputMode);
        syncCharacterColorPopoverUi();
      };

      modeButton.addEventListener("click", handleToggle);
      modeButton.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        handleToggle(event);
      });
    }

    if (eyeDropperButton instanceof HTMLButtonElement) {
      const supported = supportsCharacterColorEyeDropper();
      eyeDropperButton.disabled = !supported;
      eyeDropperButton.title = supported ? "Pick color from screen" : "EyeDropper is not supported in this browser";

      eyeDropperButton.addEventListener("click", () => {
        void pickCharacterColorWithEyeDropper();
      });
    }

    return popover;
  }

  function toggleCharacterColorPopover(container, triggerButton = null) {
    if (!(container instanceof HTMLElement)) return;

    if (
      isCharacterColorPopoverOpen() &&
      activeCharacterColorPickerContainer === container &&
      activeCharacterColorPickerTrigger === triggerButton
    ) {
      closeCharacterColorPopover(true);
      return;
    }

    openCharacterColorPopover(container, triggerButton);
  }

  function openCharacterColorPopover(container, triggerButton = null) {
    const popover = ensureCharacterColorPopover();
    if (!(popover instanceof HTMLElement) || !(container instanceof HTMLElement)) return;

    activeCharacterColorPickerContainer = container;
    activeCharacterColorPickerTrigger = triggerButton instanceof HTMLElement ? triggerButton : null;
    const currentColor = getActiveCharacterColor(container) || "#000000";
    activeCharacterColorEditSource = !isCharacterColorAddSelectionActive(container) && readStoredCharacterColors().includes(currentColor)
      ? currentColor
      : "";
    syncCharacterColorPopoverStateFromHex(currentColor);
    popover.classList.add("open");
    popover.setAttribute("aria-hidden", "false");
    positionCharacterColorPopover();
    syncCharacterColorPopoverUi();
  }

  function supportsCharacterColorEyeDropper() {
    return typeof window.EyeDropper === "function";
  }

  async function pickCharacterColorWithEyeDropper() {
    if (!supportsCharacterColorEyeDropper()) return;

    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      const color = normalizeHexColor(result?.sRGBHex || "", "");
      if (!color) return;

      syncCharacterColorPopoverStateFromHex(color);
      syncCharacterColorPopoverUi();
      applyCharacterColorFromPopover(true);
    } catch (error) {
      if (error && typeof error === "object" && error.name === "AbortError") {
        return;
      }

      console.warn("[CCF Theme] eyedropper failed", error);
    }
  }

  function closeCharacterColorPopover(commit = false) {
    const popover = document.getElementById(CHARACTER_COLOR_POPOVER_ID);
    const container = activeCharacterColorPickerContainer;
    let storedColors = readStoredCharacterColors();
    const shouldAddColor = isCharacterColorAddSelectionActive(container);

    if (commit) {
      const nextColor = applyCharacterColorFromPopover(true);
      storedColors = shouldAddColor
        ? appendEditedCharacterColor(nextColor, storedColors)
        : replaceEditedCharacterColor(nextColor, storedColors);
    }

    if (popover instanceof HTMLElement) {
      popover.classList.remove("open");
      popover.setAttribute("aria-hidden", "true");
    }

    if (container instanceof HTMLElement) {
      if (commit && shouldAddColor) {
        pendingCharacterColorAddSelections.delete(container);
      }
      renderCharacterColorActionGroup(container.querySelector(`.${CHARACTER_COLOR_ACTIONS_CLASS}`), container, storedColors);
      renderCharacterColorPalette(container.querySelector(`.${CHARACTER_COLOR_WRAPPER_CLASS}`), storedColors);
    }

    activeCharacterColorPickerContainer = null;
    activeCharacterColorPickerTrigger = null;
    activeCharacterColorEditSource = "";
  }

  function isCharacterColorPopoverOpen() {
    return document.getElementById(CHARACTER_COLOR_POPOVER_ID)?.classList.contains("open") || false;
  }

  function positionCharacterColorPopover() {
    const popover = document.getElementById(CHARACTER_COLOR_POPOVER_ID);
    const container = activeCharacterColorPickerContainer;
    if (!(popover instanceof HTMLElement) || !(container instanceof HTMLElement)) return;

    const containerRect = container.getBoundingClientRect();
    const modal = container.closest(
      [
        ".MuiDialog-paper",
        ".MuiPopover-paper",
        ".MuiMenu-paper",
        ".MuiPaper-root.MuiDialog-paper",
        '[role="dialog"]'
      ].join(", ")
    );
    const modalRect = modal instanceof HTMLElement ? modal.getBoundingClientRect() : null;
    const anchorRect = isCharacterColorPopoverAnchorRectUsable(modalRect, containerRect)
      ? modalRect
      : containerRect;
    const viewportPadding = 12;
    const gap = 8;
    const popoverWidth = popover.offsetWidth || 238;
    const popoverHeight = popover.offsetHeight || 232;
    const fitsRight = anchorRect.right + gap + popoverWidth <= window.innerWidth - viewportPadding;
    const fitsLeft = anchorRect.left - gap - popoverWidth >= viewportPadding;

    let left = fitsRight
      ? anchorRect.right + gap
      : fitsLeft
        ? anchorRect.left - gap - popoverWidth
        : clamp(anchorRect.right + gap, viewportPadding, window.innerWidth - popoverWidth - viewportPadding);

    let top = clamp(
      anchorRect.top,
      viewportPadding,
      window.innerHeight - popoverHeight - viewportPadding
    );

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function isCharacterColorPopoverAnchorRectUsable(rect, containerRect) {
    if (!rect || !containerRect) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    if (rect.width >= Math.max(viewportWidth - 24, viewportWidth * 0.82)) return false;
    if (rect.height >= Math.max(viewportHeight - 24, viewportHeight * 0.82)) return false;
    if (rect.width - containerRect.width >= 240 && rect.width >= containerRect.width * 1.7) return false;
    if (rect.height - containerRect.height >= 240 && rect.height >= containerRect.height * 1.7) return false;

    return true;
  }

  function syncCharacterColorPopoverStateFromHex(color) {
    const rgb = hexToRgb(normalizeHexColor(color, "#000000"));
    const hsv = rgbToHsv(rgb);
    characterColorPopoverState = hsv;
  }

  function syncCharacterColorPopoverUi() {
    const popover = document.getElementById(CHARACTER_COLOR_POPOVER_ID);
    if (!(popover instanceof HTMLElement)) return;

    const sv = popover.querySelector(".ccf-character-color-popover-sv");
    const handle = popover.querySelector(".ccf-character-color-popover-handle");
    const hue = popover.querySelector(".ccf-character-color-popover-hue");
    const preview = popover.querySelector(".ccf-character-color-popover-preview");
    const hex = popover.querySelector(".ccf-character-color-popover-hex");
    const modeButton = popover.querySelector(`.${CHARACTER_COLOR_POPOVER_MODE_BUTTON_CLASS}`);
    const pureHue = hsvToRgb({ h: characterColorPopoverState.h, s: 1, v: 1 });
    const currentHex = rgbToHex(hsvToRgb(characterColorPopoverState));

    if (sv instanceof HTMLElement) {
      sv.style.backgroundImage = `
        linear-gradient(to top, #000000, transparent),
        linear-gradient(to right, #ffffff, ${rgbString(pureHue)})
      `;
    }

    if (handle instanceof HTMLElement && sv instanceof HTMLElement) {
      const width = sv.clientWidth || 1;
      const height = sv.clientHeight || 1;
      handle.style.left = `${Math.round(characterColorPopoverState.s * width)}px`;
      handle.style.top = `${Math.round((1 - characterColorPopoverState.v) * height)}px`;
    }

    if (hue instanceof HTMLInputElement) {
      hue.value = String(Math.round(characterColorPopoverState.h));
      hue.style.background = "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)";
    }

    if (preview instanceof HTMLElement) {
      preview.style.background = currentHex;
    }

    if (modeButton instanceof HTMLButtonElement) {
      modeButton.textContent = getCharacterColorInputModeLabel(characterColorPopoverInputMode);
      modeButton.setAttribute("data-ccf-character-color-mode", characterColorPopoverInputMode);
      modeButton.title = `Switch color input mode (${characterColorPopoverInputMode.toUpperCase()})`;
      modeButton.setAttribute("aria-label", `Switch color input mode. Current mode ${characterColorPopoverInputMode.toUpperCase()}`);
    }

    if (hex instanceof HTMLInputElement) {
      hex.value = formatCharacterColorInputForMode(currentHex, characterColorPopoverInputMode);
      hex.placeholder = getCharacterColorInputPlaceholder(characterColorPopoverInputMode);
      hex.setAttribute("aria-label", `${characterColorPopoverInputMode.toUpperCase()} color`);
    }
  }

  function updateCharacterColorFromPopoverPointer(event, sv) {
    if (!(sv instanceof HTMLElement)) return;

    const rect = sv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    characterColorPopoverState.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    characterColorPopoverState.v = clamp(1 - ((event.clientY - rect.top) / rect.height), 0, 1);
    syncCharacterColorPopoverUi();
    applyCharacterColorFromPopover(false);
  }

  function applyCharacterColorFromPopover(commit = false) {
    const container = activeCharacterColorPickerContainer;
    if (!(container instanceof HTMLElement)) return "";

    const targetInput = findCharacterColorInputInContainer(container);
    if (!(targetInput instanceof HTMLInputElement)) return "";

    const color = rgbToHex(hsvToRgb(characterColorPopoverState));
    if (!applyCharacterColorToInput(targetInput, color, { blur: commit })) return "";
    refreshCharacterColorPalettes();
    return color;
  }

  function appendEditedCharacterColor(nextColor, storedColors = readStoredCharacterColors()) {
    const appendedColor = normalizeHexColor(nextColor, "");
    if (!appendedColor) {
      return storedColors;
    }

    const updatedColors = normalizeStoredCharacterColors([...storedColors, appendedColor]);
    if (updatedColors.length === storedColors.length && storedColors.includes(appendedColor)) {
      return storedColors;
    }

    persistCharacterColors(updatedColors);
    refreshCharacterColorPalettes();
    return updatedColors;
  }

  function replaceEditedCharacterColor(nextColor, storedColors = readStoredCharacterColors()) {
    const sourceColor = normalizeHexColor(activeCharacterColorEditSource, "");
    const replacementColor = normalizeHexColor(nextColor, "");

    if (!sourceColor || !replacementColor || sourceColor === replacementColor) {
      return storedColors;
    }

    if (!storedColors.includes(sourceColor)) {
      return storedColors;
    }

    const updatedColors = normalizeStoredCharacterColors(
      storedColors.map((color) => (color === sourceColor ? replacementColor : color))
    );

    persistCharacterColors(updatedColors);
    activeCharacterColorEditSource = replacementColor;
    refreshCharacterColorPalettes();
    return updatedColors;
  }

  function enterCharacterColorDeleteMode(container) {
    if (!(container instanceof HTMLElement)) return;
    pendingCharacterColorDeleteSnapshots.set(container, {
      hadAddSelection: isCharacterColorAddSelectionActive(container)
    });
    pendingCharacterColorAddSelections.delete(container);
    pendingCharacterColorDeleteSelections.set(container, new Set());
  }

  function exitCharacterColorDeleteMode(container, options = {}) {
    if (!(container instanceof HTMLElement)) return;
    const { restore = false } = options;
    const snapshot = pendingCharacterColorDeleteSnapshots.get(container);
    pendingCharacterColorDeleteSelections.delete(container);
    pendingCharacterColorDeleteSnapshots.delete(container);

    if (!restore) {
      return;
    }

    if (snapshot?.hadAddSelection) {
      pendingCharacterColorAddSelections.add(container);
      return;
    }

    pendingCharacterColorAddSelections.delete(container);
  }

  function isCharacterColorDeleteModeActive(container) {
    return container instanceof HTMLElement && pendingCharacterColorDeleteSelections.has(container);
  }

  function getCharacterColorDeleteSelections(container) {
    if (!(container instanceof HTMLElement)) return new Set();
    const selections = pendingCharacterColorDeleteSelections.get(container);
    return selections instanceof Set ? selections : new Set();
  }

  function toggleCharacterColorDeleteSelection(container, color) {
    if (!(container instanceof HTMLElement)) return;

    const normalized = normalizeHexColor(color, "");
    if (!normalized) return;

    let selections = pendingCharacterColorDeleteSelections.get(container);
    if (!(selections instanceof Set)) {
      selections = new Set();
      pendingCharacterColorDeleteSelections.set(container, selections);
    }

    if (selections.has(normalized)) {
      selections.delete(normalized);
      return;
    }

    selections.add(normalized);
  }

  function isCharacterColorAddSelectionActive(container) {
    return container instanceof HTMLElement && pendingCharacterColorAddSelections.has(container);
  }

  function getActiveCharacterColor(container) {
    const inputColor = getCharacterColorInputValue(container);
    const pendingColor = container instanceof HTMLElement
      ? pendingCharacterColorSelections.get(container) || ""
      : "";

    if (inputColor && pendingColor && inputColor === pendingColor) {
      pendingCharacterColorSelections.delete(container);
      return inputColor;
    }

    return pendingColor || inputColor;
  }

  function resolveNativeCharacterColorFromTarget(target, container) {
    if (!(container instanceof HTMLElement) || !(target instanceof Element)) return "";

    if (target.closest(`.${CHARACTER_COLOR_WRAPPER_CLASS}, .${CHARACTER_COLOR_ACTIONS_CLASS}`)) {
      return "";
    }

    const candidate = target.closest('[title^="#"]');
    if (!(candidate instanceof HTMLElement) || !container.contains(candidate)) {
      return "";
    }

    const titleColor = normalizeHexColor(candidate.getAttribute("title") || "", "");
    if (titleColor) {
      return titleColor;
    }

    return "";
  }

  function applyCharacterColorToInput(input, color, options = {}) {
    if (!(input instanceof HTMLInputElement)) return false;

    const normalized = normalizeHexColor(color, "");
    if (!normalized) return false;
    const blur = options.blur !== false;

    const nextValue = normalizeSpace(input.value || "").startsWith("#")
      ? normalized
      : normalized.slice(1);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(input, nextValue);
    } else {
      input.value = nextValue;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (blur) {
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }
    return true;
  }

  function readStoredCharacterColors() {
    try {
      const raw = window.localStorage.getItem(CHARACTER_COLOR_STORAGE_KEY);
      if (!raw) return [];
      return normalizeStoredCharacterColors(JSON.parse(raw));
    } catch (error) {
      console.warn("[CCF Theme] failed to read character colors", error);
      return [];
    }
  }

  function persistCharacterColors(colors) {
    try {
      const normalized = normalizeStoredCharacterColors(colors);
      window.localStorage.setItem(CHARACTER_COLOR_STORAGE_KEY, JSON.stringify(normalized));
      return true;
    } catch (error) {
      console.warn("[CCF Theme] failed to save character colors", error);
      return false;
    }
  }

  function normalizeStoredCharacterColors(value) {
    if (!Array.isArray(value)) return [];

    return value.reduce((out, item) => {
      const normalized = normalizeHexColor(item, "");
      if (normalized && !out.includes(normalized)) {
        out.push(normalized);
      }
      return out;
    }, []);
  }

  function bindGlobalEvents() {
    if (globalEventsBound) return;
    globalEventsBound = true;

    document.addEventListener("keydown", (event) => {
      if (isCharacterColorPopoverOpen() && event.key === "Escape") {
        event.preventDefault();
        closeCharacterColorPopover(false);
        return;
      }

      if (isSaveThemeDialogOpen()) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSaveThemeDialog();
          return;
        }

        if (event.key === "Enter" && document.activeElement === getThemeNameInput()) {
          event.preventDefault();
          saveCurrentTheme();
          return;
        }
      }

      if (event.altKey && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        togglePanel();
        return;
      }

      if (event.key === "Escape" && isPanelOpen()) {
        setPanelOpen(false);
      }
    }, ccfThemeWithSignal(true));

    const handleResize = () => {
      mountToggle();
      if (isPanelOpen()) {
        queuePanelPositionUpdate();
      }
      if (isCharacterColorPopoverOpen()) {
        positionCharacterColorPopover();
      }
    };

    const handleScroll = () => {
      if (isPanelOpen()) {
        queuePanelPositionUpdate();
      }
      if (isCharacterColorPopoverOpen()) {
        positionCharacterColorPopover();
      }
    };

    window.addEventListener("resize", handleResize, ccfThemeWithSignal({ passive: true }));
    document.addEventListener("scroll", handleScroll, ccfThemeWithSignal(true));

    document.addEventListener("mousedown", (event) => {
      if (isCharacterColorPopoverOpen()) {
        const popover = document.getElementById(CHARACTER_COLOR_POPOVER_ID);
        const trigger = activeCharacterColorPickerTrigger;
        const target = event.target;

        if (
          popover instanceof HTMLElement &&
          !popover.contains(target) &&
          !(trigger instanceof HTMLElement && trigger.contains(target))
        ) {
          closeCharacterColorPopover(true);
        }
      }

      if (!isPanelOpen()) return;

      const panel = getPanel();
      const toggle = getToggle();
      const target = event.target;
      if (!(panel instanceof HTMLElement) || !(toggle instanceof HTMLElement)) return;
      if (target instanceof HTMLElement && target.id === SAVE_DIALOG_ID) {
        closeSaveThemeDialog();
        return;
      }
      if (panel.contains(target) || toggle.contains(target)) return;
      setPanelOpen(false);
    }, ccfThemeWithSignal(true));

    document.addEventListener("mousemove", (event) => {
      if (!panelDragState) return;
      continuePanelDrag(event);
    }, ccfThemeWithSignal(true));

    document.addEventListener("mouseup", () => {
      if (!panelDragState) return;
      endPanelDrag();
    }, ccfThemeWithSignal(true));
  }

  function observeBody() {
    if (!(document.body instanceof HTMLBodyElement) || bodyObserver) return;

    bodyObserver = new MutationObserver(() => {
      if (!ccfThemeActive) return;
      scheduleEnsureUi();
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    ccfThemeRegisterTeardown(() => { bodyObserver?.disconnect(); bodyObserver = null; });
  }

  function scheduleEnsureUi() {
    if (ensureUiFrame) return;

    ensureUiFrame = window.requestAnimationFrame(() => {
      ensureUiFrame = 0;
      if (ensureUiInProgress) return;

      ensureUiInProgress = true;
      try {
        ensureUi();
      } finally {
        ensureUiInProgress = false;
      }
    });
  }

  function applyTheme(nextSettings, options = {}) {
    const { syncUi = true } = options;
    settings = normalizeSettings(nextSettings);

    const root = document.documentElement;
    const varsStyle = document.getElementById(VARS_STYLE_ID);
    if (!root || !(varsStyle instanceof HTMLStyleElement)) return;

    const theme = resolveTheme(settings);
    if (!theme) {
      lastThemePreview = normalizeTheme(getDefaultModeThemePreview());
      root.removeAttribute("data-ccf-theme-active");
      root.removeAttribute(DEFAULT_MODE_ATTR);
      root.removeAttribute("data-ccf-theme-mode");
      varsStyle.textContent = "";
      if (syncUi) syncUiFromSettings();
      queueDefaultModeUiRefresh();
      return;
    }

    lastThemePreview = normalizeTheme(theme);
    root.removeAttribute(DEFAULT_MODE_ATTR);

    const derived = buildDerivedTheme(theme);
    const vars = {
      "--ccf-theme-bg": theme.bg,
      "--ccf-theme-appbar": theme.appbar,
      "--ccf-theme-paper": theme.paper,
      "--ccf-theme-border": theme.border,
      "--ccf-theme-text": theme.text,
      "--ccf-theme-input-bg": theme.inputBg,
      "--ccf-theme-hover": derived.hover,
      "--ccf-theme-control-active": derived.controlActive,
      "--ccf-theme-muted-text": derived.mutedText,
      "--ccf-theme-placeholder": derived.placeholder,
      "--ccf-theme-overlay": derived.overlay,
      "--ccf-theme-shadow": derived.shadow,
      "--ccf-theme-surface-strong": derived.surfaceStrong,
      "--ccf-theme-focus-ring": derived.focusRing,
      "--ccf-theme-panel-glass-bg": derived.panelGlassBg,
      "--ccf-theme-save-card-bg": derived.saveCardBg,
      "--ccf-theme-panel-border": derived.panelBorder,
      "--ccf-theme-success": derived.success,
      "--ccf-theme-error": derived.error
    };

    root.setAttribute("data-ccf-theme-active", "1");
    root.setAttribute("data-ccf-theme-mode", settings.mode);
    varsStyle.textContent = `
      :root[data-ccf-theme-active="1"] {
        color-scheme: ${derived.colorScheme};
        ${Object.entries(vars).map(([key, value]) => `${key}: ${value};`).join("\n        ")}
      }
    `;

    if (syncUi) syncUiFromSettings();
  }

  function syncUiFromSettings(previewOverride = null) {
    const panel = getPanel();
    if (!(panel instanceof HTMLElement)) return;

    const modeSelect = panel.querySelector(`#${MODE_SELECT_ID}`);
    if (modeSelect instanceof HTMLSelectElement) {
      renderModeOptions(modeSelect);
      modeSelect.value = settings.mode;
    }

    const themeForInputs = normalizeOptionalTheme(previewOverride) || getUiThemePreview();
    panel.querySelectorAll('input[type="color"][data-key]').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const key = input.dataset.key || "";
      if (!Object.prototype.hasOwnProperty.call(themeForInputs, key)) return;
      input.value = themeForInputs[key];
    });

    panel.querySelectorAll('input[data-role="color-code"][data-key]').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (document.activeElement === input) return;
      const key = input.dataset.key || "";
      if (!Object.prototype.hasOwnProperty.call(themeForInputs, key)) return;
      input.value = formatColorCodeForDisplay(themeForInputs[key]);
    });

    syncThemeNameInput();
  }

  function getUiThemePreview() {
    if (settings.mode === MODE_DEFAULT) {
      return getDefaultModeThemePreview({ live: isPanelOpen() });
    }

    if (settings.mode === MODE_CUSTOM) {
      return settings.customTheme;
    }

    const activeTheme = resolveTheme(settings);
    if (activeTheme) {
      return activeTheme;
    }

    return settings.customTheme || { ...DEFAULT_CUSTOM_THEME };
  }

  function getThemePreviewForTransition() {
    if (settings.mode === MODE_DEFAULT) {
      return normalizeTheme(getDefaultModeThemePreview({ live: true }));
    }

    const activeTheme = resolveTheme(settings);
    if (activeTheme) {
      return normalizeTheme(activeTheme);
    }

    if (settings.mode === MODE_CUSTOM) {
      return normalizeTheme(settings.customTheme);
    }

    return normalizeTheme(lastThemePreview || getUiThemePreview());
  }

  function getDisplayedThemeFromPanel() {
    const panel = getPanel();
    if (!(panel instanceof HTMLElement)) return null;

    const theme = {};
    let hasAnyValue = false;

    panel.querySelectorAll('input[type="color"][data-key]').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      const key = input.dataset.key || "";
      if (!isThemeFieldKey(key)) return;

      const normalized = normalizeHexColor(input.value, "");
      if (!normalized) return;

      theme[key] = normalized;
      hasAnyValue = true;
    });

    return hasAnyValue ? normalizeTheme(theme) : null;
  }

  function renderModeOptions(modeSelect) {
    if (!(modeSelect instanceof HTMLSelectElement)) return;

    const options = [
      { value: MODE_DEFAULT, label: "기본값" },
      { value: MODE_LIGHT, label: "라이트" },
      ...settings.savedThemes.map((theme) => ({
        value: makeSavedMode(theme.id),
        label: theme.name
      })),
      { value: MODE_CUSTOM, label: "커스텀" }
    ];

    modeSelect.innerHTML = options
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join("");

    const normalizedMode = normalizeMode(settings.mode, settings.savedThemes);
    modeSelect.value = options.some((option) => option.value === normalizedMode) ? normalizedMode : MODE_DEFAULT;
  }

  function syncThemeNameInput() {
    const input = getThemeNameInput();
    if (!(input instanceof HTMLInputElement)) return;
    if (document.activeElement === input) return;

    input.value = themeNameDraft || getThemeNameDraftForMode(settings.mode);
  }

  function isThemeFieldKey(key) {
    return FIELD_DEFS.some((field) => field.key === key);
  }

  function previewThemeFieldValue(key, value) {
    if (!isThemeFieldKey(key)) return false;

    const normalized = parseColorCode(value, "");
    if (!normalized) return false;

    pendingThemeFieldPreview = { key, value: normalized };
    if (themeFieldPreviewFrame) return true;

    themeFieldPreviewFrame = window.requestAnimationFrame(() => {
      themeFieldPreviewFrame = 0;
      const preview = pendingThemeFieldPreview;
      pendingThemeFieldPreview = null;
      if (!preview) return;

      applyThemeFieldValue(preview.key, preview.value, {
        persist: false,
        syncUi: false,
        showStatus: false,
        syncFieldInputs: true
      });
    });

    return true;
  }

  function flushPendingThemeFieldPreview() {
    if (themeFieldPreviewFrame) {
      window.cancelAnimationFrame(themeFieldPreviewFrame);
      themeFieldPreviewFrame = 0;
    }

    const preview = pendingThemeFieldPreview;
    pendingThemeFieldPreview = null;
    return preview;
  }

  function commitThemeFieldValue(key, value) {
    flushPendingThemeFieldPreview();
    return applyThemeFieldValue(key, value, {
      persist: true,
      syncUi: true,
      showStatus: true
    });
  }

  function syncThemeFieldPreviewUi(key, value) {
    const panel = getPanel();
    if (!(panel instanceof HTMLElement) || !isThemeFieldKey(key)) return;

    const modeSelect = panel.querySelector(`#${MODE_SELECT_ID}`);
    if (modeSelect instanceof HTMLSelectElement) {
      modeSelect.value = settings.mode;
    }

    const codeInput = panel.querySelector(`input[data-role="color-code"][data-key="${key}"]`);
    if (codeInput instanceof HTMLInputElement && document.activeElement !== codeInput) {
      codeInput.value = formatColorCodeForDisplay(value);
    }
  }

  function applyThemeFieldValue(key, value, {
    showStatus = true,
    persist = true,
    syncUi = true,
    syncFieldInputs = false
  } = {}) {
    if (!isThemeFieldKey(key)) return false;

    const normalized = parseColorCode(value, "");
    if (!normalized) return false;

    ensureCustomMode();
    settings.customTheme[key] = normalized;
    if (persist) {
      persistSettings();
    }
    applyTheme(settings, { syncUi });
    if (syncFieldInputs) {
      syncThemeFieldPreviewUi(key, normalized);
    }

    if (showStatus) {
      setStatus("커스텀 색상을 반영했습니다.", "success");
    }

    return true;
  }

  function handleColorCodeTyping(input) {
    if (!(input instanceof HTMLInputElement)) return false;

    const normalized = parseColorCode(input.value, "");
    if (!normalized) {
      return false;
    }

    return applyThemeFieldValue(input.dataset.key || "", normalized);
  }

  function finalizeColorCodeInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;

    const key = input.dataset.key || "";
    if (!isThemeFieldKey(key)) return false;

    const rawValue = input.value;
    const normalized = parseColorCode(rawValue, "");
    if (normalized) {
      applyThemeFieldValue(key, normalized, { showStatus: false });
      input.value = formatColorCodeForDisplay(normalized);
      return true;
    }

    if (normalizeSpace(rawValue)) {
      setStatus("지원하지 않는 색상 코드입니다.", "error");
    }

    const themeForInputs = getUiThemePreview();
    input.value = formatColorCodeForDisplay(themeForInputs[key] || DEFAULT_CUSTOM_THEME[key]);
    return false;
  }

  function formatColorCodeForDisplay(value) {
    return normalizeHexColor(value, "#000000").toUpperCase();
  }

  function togglePanel(force) {
    const shouldOpen = typeof force === "boolean" ? force : !isPanelOpen();
    setPanelOpen(shouldOpen);
  }

  function setPanelOpen(open) {
    const panel = getPanel();
    const toggle = getToggle();
    if (!(panel instanceof HTMLElement) || !(toggle instanceof HTMLElement)) return;

    if (!open) {
      if (panelDragState) {
        endPanelDrag();
      }
      closeSaveThemeDialog();
    }

    panel.classList.toggle("open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      syncUiFromSettings();
      if (settings.mode === MODE_DEFAULT) {
        queueDefaultModeUiRefresh();
      }
      queuePanelPositionUpdate();
      window.setTimeout(() => {
        if (isPanelOpen()) {
          queuePanelPositionUpdate();
        }
      }, 0);
    }
  }

  function isPanelOpen() {
    return getPanel()?.classList.contains("open") || false;
  }

  function isSaveThemeDialogOpen() {
    return getSaveThemeDialog()?.classList.contains("open") || false;
  }

  function getToggle() {
    return document.getElementById(TOGGLE_ID);
  }

  function getPanel() {
    return document.getElementById(PANEL_ID);
  }

  function getSaveThemeDialog() {
    return document.getElementById(SAVE_DIALOG_ID);
  }

  function getThemeNameInput() {
    return document.getElementById(THEME_NAME_INPUT_ID);
  }

  function getImportThemeInput() {
    return document.getElementById(IMPORT_INPUT_ID);
  }

  function findCharacterToolbar() {
    const characterButton = document.querySelector('button[aria-label="캐릭터 선택"]');
    const helpButton = document.querySelector('button[aria-label="채팅 커맨드에 대해"]');
    if (!(characterButton instanceof HTMLElement) || !(helpButton instanceof HTMLElement)) {
      return null;
    }

    let current = characterButton.parentElement;
    while (current && current !== document.body) {
      if (
        current.contains(helpButton) &&
        current.querySelector('button[aria-label="캐릭터 선택"]') &&
        current.querySelector('button[aria-label="채팅 커맨드에 대해"]')
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function findDiceToolbar() {
    const d4Button = document.querySelector('button[aria-label="D4"]');
    const sendButton = [...document.querySelectorAll('button[type="submit"]')].find((button) =>
      button instanceof HTMLElement && /전송/.test(normalizeSpace(button.textContent || ""))
    );
    if (!(d4Button instanceof HTMLElement) || !(sendButton instanceof HTMLElement)) {
      return null;
    }

    let current = d4Button.parentElement;
    while (current && current !== document.body) {
      if (
        current.contains(sendButton) &&
        current.querySelector('button[aria-label="D4"]') &&
        current.querySelector('button[type="submit"]')
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  function findDicebotAnchor() {
    const linkMatches = [...document.querySelectorAll('a[href*="docs.bcdice.org"], a[href*="bcdice"]')];
    for (const link of linkMatches) {
      if (!(link instanceof HTMLElement)) continue;

      let current = link.parentElement;
      while (current && current !== document.body) {
        if (current.tagName === "DIV" && /dicebot engine/i.test(normalizeSpace(current.textContent || ""))) {
          return current;
        }
        current = current.parentElement;
      }
    }

    const directMatch = [...document.querySelectorAll('div[class*="MuiBox-root"], div')].find((node) =>
      node instanceof HTMLElement &&
      /dicebot engine/i.test(normalizeSpace(node.textContent || "")) &&
      !!node.querySelector('a[href*="docs.bcdice.org"], a[href*="bcdice"]')
    );

    if (directMatch instanceof HTMLElement) {
      return directMatch;
    }

    return null;
  }

  function isDicebotAnchorUsable(anchor) {
    return anchor instanceof HTMLElement && anchor !== document.body && document.documentElement?.contains(anchor);
  }

  function resolveDicebotAnchor(toggle = null) {
    const detectedAnchor = findDicebotAnchor();
    if (isDicebotAnchorUsable(detectedAnchor)) {
      lastDicebotAnchor = detectedAnchor;
      return detectedAnchor;
    }

    const currentAnchor = toggle instanceof HTMLElement ? toggle.parentElement : null;
    if (isDicebotAnchorUsable(currentAnchor)) {
      lastDicebotAnchor = currentAnchor;
      return currentAnchor;
    }

    const markedAnchor = document.querySelector(`[${ANCHOR_ATTR}="1"]`);
    if (isDicebotAnchorUsable(markedAnchor)) {
      lastDicebotAnchor = markedAnchor;
      return markedAnchor;
    }

    if (isDicebotAnchorUsable(lastDicebotAnchor)) {
      return lastDicebotAnchor;
    }

    lastDicebotAnchor = null;
    return null;
  }

  function mountToggle() {
    const toggle = getToggle();
    if (!(toggle instanceof HTMLElement) || !document.body) return;

    const anchor = resolveDicebotAnchor(toggle);
    if (anchor) {
      document.querySelectorAll(`[${ANCHOR_ATTR}="1"]`).forEach((element) => {
        if (element !== anchor) {
          element.removeAttribute(ANCHOR_ATTR);
        }
      });
      ensureAnchorBaselineHeight(anchor);
      anchor.setAttribute(ANCHOR_ATTR, "1");
      anchor.setAttribute(APPBAR_ATTR, "1");
      if (toggle.parentElement !== anchor) {
        anchor.appendChild(toggle);
      }
      toggle.hidden = false;
    } else {
      if (toggle.parentElement !== document.body) {
        document.body.appendChild(toggle);
      }
      toggle.hidden = true;
      if (isPanelOpen()) {
        setPanelOpen(false);
      }
    }

    const characterToolbar = findCharacterToolbar();
    if (characterToolbar) {
      characterToolbar.setAttribute(APPBAR_ATTR, "1");
    }

    const diceToolbar = findDiceToolbar();
    if (diceToolbar) {
      diceToolbar.setAttribute(APPBAR_ATTR, "1");
    }
  }

  function ensureAnchorBaselineHeight(anchor) {
    if (!(anchor instanceof HTMLElement)) return;
    if (anchor.style.getPropertyValue("--ccf-theme-anchor-height")) return;

    const measuredHeight = measureElementHeight(anchor);
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return;

    anchor.style.setProperty("--ccf-theme-anchor-height", `${measuredHeight}px`);
  }

  function measureElementHeight(element) {
    if (!(element instanceof HTMLElement)) return 0;

    const rectHeight = element.getBoundingClientRect().height;
    if (Number.isFinite(rectHeight) && rectHeight > 0) {
      return rectHeight;
    }

    const computedHeight = Number.parseFloat(getComputedStyle(element).height);
    if (Number.isFinite(computedHeight) && computedHeight > 0) {
      return computedHeight;
    }

    const firstChild = element.firstElementChild;
    if (firstChild instanceof HTMLElement) {
      const childRectHeight = firstChild.getBoundingClientRect().height;
      if (Number.isFinite(childRectHeight) && childRectHeight > 0) {
        return childRectHeight;
      }
    }

    return 0;
  }

  function queueDefaultModeUiRefresh() {
    if (defaultModeRefreshFrame) return;

    defaultModeRefreshFrame = window.requestAnimationFrame(() => {
      defaultModeRefreshFrame = 0;
      if (settings.mode !== MODE_DEFAULT) return;

      const liveTheme = ensureDefaultThemeSnapshot(true);
      if (isPanelOpen()) {
        syncUiFromSettings(liveTheme);
      }
    });
  }

  function queuePanelPositionUpdate() {
    if (panelLayoutFrame) return;
    panelLayoutFrame = window.requestAnimationFrame(() => {
      panelLayoutFrame = 0;
      updatePanelPosition();
    });
  }

  function updatePanelPosition() {
    const panel = getPanel();
    const toggle = getToggle();
    if (!(panel instanceof HTMLElement) || !(toggle instanceof HTMLElement) || toggle.hidden) return;

    const margin = 12;
    const gap = 10;
    const safePanelWidth = clamp(window.innerWidth - margin * 2, 160, 350);
    panel.style.width = `${Math.round(safePanelWidth)}px`;

    const panelHeight = Math.min(panel.offsetHeight || 560, Math.max(160, window.innerHeight - margin * 2));

    if (panelPosition) {
      const clampedPosition = clampPanelPosition(panelPosition, safePanelWidth, panelHeight, margin);
      applyPanelPosition(clampedPosition, safePanelWidth);

      if (clampedPosition.left !== panelPosition.left || clampedPosition.top !== panelPosition.top) {
        panelPosition = clampedPosition;
        persistPanelPosition();
      }
      return;
    }

    const rect = toggle.getBoundingClientRect();

    let left = rect.right - safePanelWidth;
    left = clamp(left, margin, Math.max(margin, window.innerWidth - safePanelWidth - margin));

    let top = rect.top - panelHeight - gap;
    if (top < margin) {
      top = rect.bottom + gap;
    }

    top = clamp(top, margin, Math.max(margin, window.innerHeight - panelHeight - margin));

    applyPanelPosition({ left, top }, safePanelWidth);
  }

  function startPanelDrag(event) {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.button !== 0) return;
    if (event.target.closest("button, input, select, textarea, a")) return;

    const panel = getPanel();
    if (!(panel instanceof HTMLElement) || !isPanelOpen()) return;

    const rect = panel.getBoundingClientRect();
    panelDragState = {
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };

    panel.classList.add("dragging");
    document.body.style.userSelect = "none";
    event.preventDefault();
  }

  function continuePanelDrag(event) {
    const panel = getPanel();
    if (!panelDragState || !(panel instanceof HTMLElement)) return;

    const width = panelDragState.width || panel.getBoundingClientRect().width || 350;
    const height = panelDragState.height || panel.getBoundingClientRect().height || 560;
    const nextPosition = clampPanelPosition(
      {
        left: panelDragState.left + (event.clientX - panelDragState.startX),
        top: panelDragState.top + (event.clientY - panelDragState.startY)
      },
      width,
      height,
      12
    );

    panelPosition = nextPosition;
    applyPanelPosition(nextPosition, width);
  }

  function endPanelDrag() {
    const panel = getPanel();
    if (panel instanceof HTMLElement) {
      panel.classList.remove("dragging");
    }
    document.body.style.userSelect = "";
    panelDragState = null;
    persistPanelPosition();
  }

  function clampPanelPosition(position, width, height, margin = 12) {
    return {
      left: clamp(position.left, margin, Math.max(margin, window.innerWidth - width - margin)),
      top: clamp(position.top, margin, Math.max(margin, window.innerHeight - height - margin))
    };
  }

  function applyPanelPosition(position, width) {
    const panel = getPanel();
    if (!(panel instanceof HTMLElement)) return;

    if (Number.isFinite(width)) {
      panel.style.width = `${Math.round(width)}px`;
    }
    panel.style.left = `${Math.round(position.left)}px`;
    panel.style.top = `${Math.round(position.top)}px`;
  }

  function openSaveThemeDialog() {
    const dialog = getSaveThemeDialog();
    const input = getThemeNameInput();
    if (!(dialog instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

    input.value = themeNameDraft || getThemeNameDraftForMode(settings.mode);
    dialog.classList.add("open");
    dialog.setAttribute("aria-hidden", "false");

    window.setTimeout(() => {
      if (!isSaveThemeDialogOpen()) return;
      input.focus({ preventScroll: true });
      input.select();
    }, 0);
  }

  function closeSaveThemeDialog() {
    const dialog = getSaveThemeDialog();
    if (!(dialog instanceof HTMLElement)) return;
    dialog.classList.remove("open");
    dialog.setAttribute("aria-hidden", "true");
  }

  function triggerThemeImport() {
    const input = getImportThemeInput();
    if (!(input instanceof HTMLInputElement)) return;
    input.value = "";
    input.click();
  }

  async function handleImportedThemeFile(input) {
    if (!(input instanceof HTMLInputElement)) return false;

    const file = input.files?.[0];
    input.value = "";
    if (!file) return false;

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      const imported = extractImportedThemePayload(parsed, file.name);
      if (!imported) {
        window.alert("가져올 수 있는 테마 파일이 아닙니다.");
        return false;
      }

      upsertSavedTheme(imported);
      return true;
    } catch (error) {
      console.warn("[CCF Theme] failed to import theme", error);
      window.alert("테마 파일을 읽지 못했습니다.");
      return false;
    }
  }

  function exportCurrentTheme() {
    const payload = createThemeExportPayload();
    const fileName = `${sanitizeThemeFileName(payload.name)}.ccf-theme.json`;
    downloadTextFile(fileName, `${JSON.stringify(payload, null, 2)}\n`, "application/json");
  }

  function deleteCurrentSavedTheme() {
    const savedTheme = getSavedThemeByMode(settings);
    if (!savedTheme) {
      window.alert("삭제할 저장 테마를 먼저 선택해 주세요.");
      return false;
    }

    if (!window.confirm(`"${savedTheme.name}" 테마를 삭제할까요?`)) {
      return false;
    }

    settings = {
      ...settings,
      mode: MODE_CUSTOM,
      customTheme: { ...savedTheme.theme },
      savedThemes: settings.savedThemes.filter((theme) => theme.id !== savedTheme.id)
    };
    themeNameDraft = "";

    persistSettings();
    applyTheme(settings);
    return true;
  }

  function saveCurrentTheme() {
    const input = getThemeNameInput();
    const rawName = input instanceof HTMLInputElement ? input.value : themeNameDraft;
    const name = normalizeThemeName(rawName, "");
    if (!name) {
      setStatus("테마 이름을 입력해 주세요.", "error");
      input?.focus({ preventScroll: true });
      input?.select();
      return;
    }

    const theme = normalizeTheme(getUiThemePreview() || settings.customTheme || DEFAULT_CUSTOM_THEME);
    const nextTheme = upsertSavedTheme({ name, theme });

    closeSaveThemeDialog();
    setStatus(nextTheme?.existing ? "기존 테마를 덮어썼습니다." : "새 테마를 저장했습니다.", "success");
  }

  function upsertSavedTheme(payload) {
    const name = normalizeThemeName(payload?.name, "");
    if (!name) return null;

    const theme = normalizeTheme(payload?.theme || payload);
    const savedThemes = [...settings.savedThemes];
    const existingIndex = savedThemes.findIndex((item) => normalizeThemeName(item.name, "") === name);
    const nextTheme =
      existingIndex >= 0
        ? { ...savedThemes[existingIndex], name, theme: { ...theme } }
        : { id: createSavedThemeId(), name, theme: { ...theme } };

    if (existingIndex >= 0) {
      savedThemes.splice(existingIndex, 1, nextTheme);
    } else {
      savedThemes.push(nextTheme);
    }

    settings = {
      ...settings,
      mode: makeSavedMode(nextTheme.id),
      customTheme: { ...theme },
      savedThemes
    };
    themeNameDraft = nextTheme.name;

    persistSettings();
    applyTheme(settings);

    return {
      ...nextTheme,
      existing: existingIndex >= 0
    };
  }

  function extractImportedThemePayload(value, fileName = "") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const sourceTheme = value.theme && typeof value.theme === "object" ? value.theme : value;
    if (!hasThemeFieldValues(sourceTheme)) {
      return null;
    }

    return {
      name: normalizeThemeName(value.name || stripFileExtension(fileName), "가져온 테마"),
      theme: normalizeTheme(sourceTheme)
    };
  }

  function hasThemeFieldValues(theme) {
    if (!theme || typeof theme !== "object") return false;
    return FIELD_DEFS.some((field) => Object.prototype.hasOwnProperty.call(theme, field.key));
  }

  function createThemeExportPayload() {
    const savedTheme = getSavedThemeByMode(settings);
    const theme = normalizeTheme(savedTheme?.theme || getUiThemePreview() || settings.customTheme || DEFAULT_CUSTOM_THEME);
    return {
      type: "ccf-theme-switcher-theme",
      version: 1,
      name: savedTheme?.name || getThemeDisplayName(settings.mode),
      theme,
      exportedAt: new Date().toISOString()
    };
  }

  function getThemeDisplayName(mode = settings.mode) {
    const savedTheme = getSavedThemeByMode(settings, mode);
    if (savedTheme?.name) {
      return savedTheme.name;
    }

    switch (mode) {
      case MODE_LIGHT:
        return "라이트";
      case MODE_CUSTOM:
        return "커스텀";
      default:
        return "기본값";
    }
  }

  function sanitizeThemeFileName(value) {
    const normalized = normalizeSpace(value).replace(/[\\/:*?"<>|]+/g, "-");
    return normalized || "ccf-theme";
  }

  function stripFileExtension(value) {
    return String(value || "").replace(/\.[^.]+$/, "");
  }

  function downloadTextFile(fileName, content, mimeType = "text/plain;charset=utf-8") {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function getThemeNameDraftForMode(mode = settings.mode) {
    const savedTheme = getSavedThemeByMode(settings, mode);
    return savedTheme?.name || "";
  }

  function getDefaultModeThemePreview(options = {}) {
    const live = options && options.live === true;
    return ensureDefaultThemeSnapshot(live);
  }

  function ensureDefaultThemeSnapshot(forceCapture = false) {
    const storedDefaultTheme = normalizeOptionalTheme(settings.defaultTheme);
    const versionMatches = settings.defaultThemeVersion === DEFAULT_THEME_VERSION;
    if (storedDefaultTheme && versionMatches && !forceCapture) {
      lastThemePreview = normalizeTheme(storedDefaultTheme);
      return storedDefaultTheme;
    }

    const canCapture = hasDefaultThemeCaptureTargets();
    if (!canCapture) {
      const fallbackTheme = storedDefaultTheme || { ...DEFAULT_MODE_FALLBACK_THEME };
      lastThemePreview = normalizeTheme(fallbackTheme);
      return fallbackTheme;
    }

    const capturedTheme = captureDefaultThemeSnapshot();
    const shouldPersist =
      !storedDefaultTheme ||
      !versionMatches ||
      !themesEqual(storedDefaultTheme, capturedTheme);

    if (shouldPersist) {
      settings = {
        ...settings,
        defaultTheme: capturedTheme,
        defaultThemeVersion: DEFAULT_THEME_VERSION
      };
      persistSettings();
    }
    lastThemePreview = normalizeTheme(capturedTheme);
    return capturedTheme;
  }

  function captureDefaultThemeSnapshot() {
    const root = document.documentElement;
    const varsStyle = document.getElementById(VARS_STYLE_ID);
    const canToggleTheme = root instanceof HTMLElement && varsStyle instanceof HTMLStyleElement;
    const wasActive = canToggleTheme && root.getAttribute("data-ccf-theme-active") === "1";
    const wasDefault = canToggleTheme && root.getAttribute(DEFAULT_MODE_ATTR) === "1";
    const previousMode = canToggleTheme ? root.getAttribute("data-ccf-theme-mode") : null;
    const previousVarsText = varsStyle instanceof HTMLStyleElement ? varsStyle.textContent : "";

    if (canToggleTheme && (wasActive || wasDefault)) {
      root.removeAttribute("data-ccf-theme-active");
      root.removeAttribute(DEFAULT_MODE_ATTR);
      root.removeAttribute("data-ccf-theme-mode");
      varsStyle.textContent = "";
    }

    try {
      return readDefaultModeThemeFromDom();
    } finally {
      if (canToggleTheme && (wasActive || wasDefault)) {
        if (wasActive) {
          root.setAttribute("data-ccf-theme-active", "1");
        }
        if (wasDefault) {
          root.setAttribute(DEFAULT_MODE_ATTR, "1");
        }
        if (previousMode) {
          root.setAttribute("data-ccf-theme-mode", previousMode);
        }
        varsStyle.textContent = previousVarsText;
      }
    }
  }

  function hasDefaultThemeCaptureTargets() {
    return !!(
      findDicebotAnchor() ||
      findCharacterToolbar() ||
      findDiceToolbar() ||
      document.querySelector(
        [
          'button[aria-label="캐릭터 선택"]',
          'button[aria-label="D4"]',
          'a[href*="docs.bcdice.org"]'
        ].join(", ")
      )
    );
  }

  function readDefaultModeThemeFromDom() {
    const fallback = DEFAULT_MODE_FALLBACK_THEME;
    const visibleInputSelector = [
      `[${APPBAR_ATTR}="1"] .MuiInputBase-root`,
      ".MuiInputBase-root",
      ".MuiOutlinedInput-root"
    ].join(", ");
    const visibleBorderSelector = [
      `[${APPBAR_ATTR}="1"] .MuiOutlinedInput-notchedOutline`,
      `[${APPBAR_ATTR}="1"] fieldset`,
      ".MuiOutlinedInput-notchedOutline",
      ".MuiInputBase-root fieldset",
      ".MuiOutlinedInput-root fieldset"
    ].join(", ");
    const visibleTextSelector = [
      `[${ANCHOR_ATTR}="1"] .MuiTypography-root`,
      `[${ANCHOR_ATTR}="1"] a`,
      `[${APPBAR_ATTR}="1"] .MuiInputBase-input`,
      `[${APPBAR_ATTR}="1"] .MuiButton-root`,
      `[${APPBAR_ATTR}="1"] .MuiButtonBase-root`,
      `[${APPBAR_ATTR}="1"] .MuiSvgIcon-root`,
      ".MuiTypography-root"
    ].join(", ");

    return normalizeTheme({
      bg: fallback.bg,
      appbar: fallback.appbar,
      paper: fallback.paper,
      border: fallback.border,
      text: fallback.text,
      inputBg: fallback.inputBg
    });
  }

  function getSavedThemeByMode(sourceSettings, mode = sourceSettings?.mode) {
    if (!isSavedMode(mode) || !sourceSettings?.savedThemes?.length) return null;
    const savedId = mode.slice(SAVED_MODE_PREFIX.length);
    return sourceSettings.savedThemes.find((theme) => theme.id === savedId) || null;
  }

  function makeSavedMode(id) {
    return `${SAVED_MODE_PREFIX}${id}`;
  }

  function isSavedMode(value) {
    return typeof value === "string" && value.startsWith(SAVED_MODE_PREFIX);
  }

  function ensureCustomMode(sourceTheme = null) {
    if (settings.mode === MODE_CUSTOM) return;
    if (!themeNameDraft) {
      themeNameDraft = getThemeNameDraftForMode(settings.mode);
    }
    settings = {
      ...settings,
      mode: MODE_CUSTOM,
      customTheme: normalizeTheme(sourceTheme || getThemePreviewForTransition() || settings.customTheme || DEFAULT_CUSTOM_THEME)
    };
  }

  function readStoredSettings() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaultSettings();
      return normalizeSettings(JSON.parse(raw));
    } catch (error) {
      console.warn("[CCF Theme] failed to read settings", error);
      return createDefaultSettings();
    }
  }

  function readStoredPanelPosition() {
    try {
      const raw = window.localStorage.getItem(PANEL_POSITION_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) {
        return null;
      }

      return {
        left: parsed.left,
        top: parsed.top
      };
    } catch (error) {
      console.warn("[CCF Theme] failed to read panel position", error);
      return null;
    }
  }

  function persistSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      return true;
    } catch (error) {
      console.warn("[CCF Theme] failed to save settings", error);
      setStatus("설정을 저장하지 못했습니다.", "error");
      return false;
    }
  }

  function persistPanelPosition() {
    try {
      if (!panelPosition) {
        window.localStorage.removeItem(PANEL_POSITION_KEY);
        return true;
      }

      window.localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({
        left: Math.round(panelPosition.left),
        top: Math.round(panelPosition.top)
      }));
      return true;
    } catch (error) {
      console.warn("[CCF Theme] failed to save panel position", error);
      return false;
    }
  }

  function createDefaultSettings() {
    return {
      mode: MODE_DEFAULT,
      defaultTheme: null,
      defaultThemeVersion: 0,
      customTheme: { ...DEFAULT_CUSTOM_THEME },
      savedThemes: []
    };
  }

  function normalizeSettings(value) {
    const base = createDefaultSettings();
    const savedThemes = normalizeSavedThemes(value?.savedThemes);
    const nextMode = normalizeMode(value?.mode, savedThemes);
    return {
      mode: nextMode,
      defaultTheme: normalizeOptionalTheme(value?.defaultTheme),
      defaultThemeVersion: Number.isInteger(value?.defaultThemeVersion) ? value.defaultThemeVersion : 0,
      customTheme: normalizeTheme(value?.customTheme || value?.theme || base.customTheme),
      savedThemes
    };
  }

  function normalizeMode(value, savedThemes = settings?.savedThemes || []) {
    if (isSavedMode(value) && savedThemes.some((theme) => makeSavedMode(theme.id) === value)) {
      return value;
    }

    return [
      MODE_DEFAULT,
      MODE_LIGHT,
      MODE_CUSTOM
    ].includes(value) ? value : MODE_DEFAULT;
  }

  function resolveTheme(value) {
    const savedTheme = getSavedThemeByMode(value);
    if (savedTheme) {
      return savedTheme.theme;
    }

    switch (value.mode) {
      case MODE_LIGHT:
        return PRESETS[value.mode];
      case MODE_CUSTOM:
        return value.customTheme;
      default:
        return null;
    }
  }

  function normalizeTheme(theme) {
    const fallback = DEFAULT_CUSTOM_THEME;
    const next = {};
    for (const field of FIELD_DEFS) {
      next[field.key] = parseColorCode(theme?.[field.key], fallback[field.key]);
    }
    return next;
  }

  function normalizeOptionalTheme(theme) {
    if (!theme || typeof theme !== "object") return null;
    return normalizeTheme(theme);
  }

  function themesEqual(a, b) {
    const left = normalizeOptionalTheme(a);
    const right = normalizeOptionalTheme(b);
    if (!left || !right) return false;
    return FIELD_DEFS.every((field) => left[field.key] === right[field.key]);
  }

  function normalizeSavedThemes(list) {
    if (!Array.isArray(list)) return [];

    return list.reduce((out, item, index) => {
      const name = normalizeThemeName(item?.name, "");
      if (!name) return out;

      out.push({
        id: normalizeSavedThemeId(item?.id, index),
        name,
        theme: normalizeTheme(item?.theme || item)
      });
      return out;
    }, []);
  }

  function normalizeSavedThemeId(value, index = 0) {
    const raw = typeof value === "string" ? value.trim() : "";
    return raw || `theme-${index + 1}`;
  }

  function createSavedThemeId() {
    return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeThemeName(value, fallback = "내 테마") {
    const normalized = normalizeSpace(value).slice(0, 24);
    return normalized || fallback;
  }

  function readThemeColorFromDom(candidates, fallback) {
    for (const candidate of candidates || []) {
      const elements = [...document.querySelectorAll(candidate.selector || "")];
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        if (isThemeSwitcherUiElement(element)) continue;
        if (!isRenderableThemeSample(element)) continue;

        const target = candidate.closest ? element.closest(candidate.closest) : element;
        if (!(target instanceof HTMLElement)) continue;
        if (isThemeSwitcherUiElement(target)) continue;
        if (!isRenderableThemeSample(target)) continue;

        const normalized = candidate.walkAncestors
          ? readThemeColorFromAncestors(target, candidate.property || "color")
          : readThemeColorFromElement(target, candidate.property || "color");
        if (normalized) {
          return normalized;
        }
      }
    }

    return fallback;
  }

  function isThemeSwitcherUiElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    return !!element.closest(
      [
        `#${PANEL_ID}`,
        `#${SAVE_DIALOG_ID}`,
        `#${TOGGLE_ID}`
      ].join(", ")
    );
  }

  function isRenderableThemeSample(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element === document.body || element === document.documentElement) return true;

    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number.parseFloat(style.opacity || "1") <= 0.01) return false;

    return element.getClientRects().length > 0;
  }

  function readThemeColorFromElement(element, property) {
    if (!(element instanceof HTMLElement)) return "";
    if (isThemeSwitcherUiElement(element)) return "";
    if (!isRenderableThemeSample(element)) return "";
    return cssColorToHex(getComputedStyle(element)[property || "color"], "");
  }

  function readThemeColorFromAncestors(element, property) {
    let current = element;
    while (current instanceof HTMLElement) {
      const value = readThemeColorFromElement(current, property);
      if (value) {
        return value;
      }

      if (current === document.body || current === document.documentElement) {
        break;
      }

      current = current.parentElement;
    }

    return "";
  }

  function cssColorToHex(value, fallback) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw || raw === "transparent") return fallback;

    const normalized = parseColorCode(raw, "");
    if (normalized) {
      return normalized;
    }

    return fallback;
  }

  function parseColorCode(value, fallback) {
    const raw = normalizeSpace(value);
    if (!raw) return fallback;

    const hex = normalizeHexColor(raw, "");
    if (hex) {
      return hex;
    }

    const rgb = parseRgbColorCode(raw);
    if (rgb) {
      return rgbToHex(rgb);
    }

    return fallback;
  }

  function parseRgbColorCode(value) {
    const raw = String(value || "").trim();

    const functionalMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*(?:,|\s)\s*(\d{1,3})\s*(?:,|\s)\s*(\d{1,3})(?:\s*(?:,|\/)\s*([0-9.]+))?\s*\)$/i);
    if (functionalMatch) {
      return parseRgbChannels(
        [functionalMatch[1], functionalMatch[2], functionalMatch[3]],
        functionalMatch[4]
      );
    }

    const tripletMatch = raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
    if (tripletMatch) {
      return parseRgbChannels([tripletMatch[1], tripletMatch[2], tripletMatch[3]]);
    }

    return null;
  }

  function parseRgbChannels(channels, alphaValue) {
    const values = channels.map((channel) => Number.parseInt(channel, 10));
    if (values.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
      return null;
    }

    if (alphaValue != null) {
      const alpha = Number.parseFloat(alphaValue);
      if (!Number.isFinite(alpha) || alpha <= 0.01 || alpha > 1) {
        return null;
      }
    }

    return {
      r: values[0],
      g: values[1],
      b: values[2]
    };
  }

  function parseHslColorCode(value) {
    const raw = String(value || "").trim();

    const functionalMatch = raw.match(/^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*(?:deg)?\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)%\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)%(?:\s*(?:,|\/)\s*([0-9.]+))?\s*\)$/i);
    if (functionalMatch) {
      return parseHslChannels(
        [functionalMatch[1], functionalMatch[2], functionalMatch[3]],
        functionalMatch[4]
      );
    }

    const tripletMatch = raw.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:deg)?\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*,\s*([+-]?\d+(?:\.\d+)?)%$/i);
    if (tripletMatch) {
      return parseHslChannels([tripletMatch[1], tripletMatch[2], tripletMatch[3]]);
    }

    return null;
  }

  function parseHslChannels(channels, alphaValue) {
    const values = channels.map((channel) => Number.parseFloat(channel));
    if (values.some((channel) => !Number.isFinite(channel))) {
      return null;
    }

    if (values[1] < 0 || values[1] > 100 || values[2] < 0 || values[2] > 100) {
      return null;
    }

    if (alphaValue != null) {
      const alpha = Number.parseFloat(alphaValue);
      if (!Number.isFinite(alpha) || alpha <= 0.01 || alpha > 1) {
        return null;
      }
    }

    return {
      h: ((values[0] % 360) + 360) % 360,
      s: values[1] / 100,
      l: values[2] / 100
    };
  }

  function rgbToHex(rgb) {
    return `#${[rgb.r, rgb.g, rgb.b]
      .map((channel) => clamp(channel, 0, 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  function rgbToHsl(rgb) {
    const r = clamp(rgb.r, 0, 255) / 255;
    const g = clamp(rgb.g, 0, 255) / 255;
    const b = clamp(rgb.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (delta > 0) {
      s = delta / (1 - Math.abs((2 * l) - 1));

      if (max === r) {
        h = 60 * (((g - b) / delta) % 6);
      } else if (max === g) {
        h = 60 * (((b - r) / delta) + 2);
      } else {
        h = 60 * (((r - g) / delta) + 4);
      }
    }

    if (h < 0) {
      h += 360;
    }

    return { h, s, l };
  }

  function rgbToHsv(rgb) {
    const r = clamp(rgb.r, 0, 255) / 255;
    const g = clamp(rgb.g, 0, 255) / 255;
    const b = clamp(rgb.b, 0, 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;

    if (delta > 0) {
      if (max === r) {
        h = 60 * (((g - b) / delta) % 6);
      } else if (max === g) {
        h = 60 * (((b - r) / delta) + 2);
      } else {
        h = 60 * (((r - g) / delta) + 4);
      }
    }

    if (h < 0) {
      h += 360;
    }

    return {
      h,
      s: max === 0 ? 0 : delta / max,
      v: max
    };
  }

  function hsvToRgb(hsv) {
    const h = ((Number(hsv?.h) || 0) % 360 + 360) % 360;
    const s = clamp(Number(hsv?.s) || 0, 0, 1);
    const v = clamp(Number(hsv?.v) || 0, 0, 1);
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
      r = c; g = x; b = 0;
    } else if (h < 120) {
      r = x; g = c; b = 0;
    } else if (h < 180) {
      r = 0; g = c; b = x;
    } else if (h < 240) {
      r = 0; g = x; b = c;
    } else if (h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function hslToRgb(hsl) {
    const h = ((Number(hsl?.h) || 0) % 360 + 360) % 360;
    const s = clamp(Number(hsl?.s) || 0, 0, 1);
    const l = clamp(Number(hsl?.l) || 0, 0, 1);
    const c = (1 - Math.abs((2 * l) - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - (c / 2);
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
      r = c; g = x; b = 0;
    } else if (h < 120) {
      r = x; g = c; b = 0;
    } else if (h < 180) {
      r = 0; g = c; b = x;
    } else if (h < 240) {
      r = 0; g = x; b = c;
    } else if (h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function normalizeHexColor(value, fallback) {
    const raw = typeof value === "string" ? value.trim() : "";
    const expanded = raw.startsWith("#") ? raw : `#${raw}`;
    const shortMatch = /^#([0-9a-fA-F]{3})$/.exec(expanded);
    if (shortMatch) {
      return `#${shortMatch[1].split("").map((char) => char + char).join("").toLowerCase()}`;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(expanded)) {
      return expanded.toLowerCase();
    }
    return fallback;
  }

  function buildDerivedTheme(theme) {
    const bgRgb = hexToRgb(theme.bg);
    const textRgb = hexToRgb(theme.text);
    const borderRgb = hexToRgb(theme.border);
    const paperRgb = hexToRgb(theme.paper);
    const appbarRgb = hexToRgb(theme.appbar);
    const inputRgb = hexToRgb(theme.inputBg);
    const isLight = getLuminance(bgRgb) > 0.58;
    const hoverBase = isLight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

    return {
      colorScheme: isLight ? "light" : "dark",
      hover: rgbaString(hoverBase, isLight ? 0.07 : 0.09),
      controlActive: rgbaString(hoverBase, isLight ? 0.11 : 0.14),
      mutedText: rgbaString(textRgb, 0.74),
      placeholder: rgbaString(textRgb, 0.42),
      overlay: rgbaString(isLight ? mixRgb(borderRgb, bgRgb, 0.45) : { r: 0, g: 0, b: 0 }, isLight ? 0.16 : 0.42),
      shadow: rgbaString(isLight ? mixRgb(borderRgb, bgRgb, 0.25) : { r: 0, g: 0, b: 0 }, isLight ? 0.18 : 0.35),
      surfaceStrong: rgbString(mixRgb(paperRgb, inputRgb, 0.52)),
      focusRing: rgbaString(mixRgb(borderRgb, textRgb, 0.38), isLight ? 0.26 : 0.3),
      panelGlassBg: rgbaString(mixRgb(paperRgb, appbarRgb, 0.34), isLight ? 0.84 : 0.8),
      saveCardBg: rgbaString(mixRgb(paperRgb, appbarRgb, 0.22), isLight ? 0.9 : 0.86),
      panelBorder: rgbaString(borderRgb, isLight ? 0.72 : 0.54),
      success: isLight ? "#245f4a" : "#a8f0c6",
      error: isLight ? "#9b3535" : "#ff9b9b"
    };
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex, "#000000").slice(1);
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16)
    };
  }

  function mixRgb(a, b, ratio) {
    const safeRatio = clamp(Number(ratio) || 0, 0, 1);
    return {
      r: Math.round(a.r + (b.r - a.r) * safeRatio),
      g: Math.round(a.g + (b.g - a.g) * safeRatio),
      b: Math.round(a.b + (b.b - a.b) * safeRatio)
    };
  }

  function rgbString(rgb) {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  function rgbaString(rgb, alpha) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
  }

  function getLuminance(rgb) {
    const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function setStatus(message, state = "") {
    const status = document.getElementById(STATUS_ID);
    if (!(status instanceof HTMLElement)) return;

    window.clearTimeout(statusTimer);
    status.textContent = message || "";
    status.dataset.state = state || "";

    if (message) {
      statusTimer = window.setTimeout(() => {
        if (!(status instanceof HTMLElement)) return;
        status.textContent = "";
        status.dataset.state = "";
      }, 2200);
    }
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
