// ==UserScript==
// @name         CCF Theme Switcher by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-theme-switcher
// @version      0.2.5
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
  const DICEBOT_STYLE_ID = "ccf-theme-switcher-dicebot-style";
  const DICEBOT_ATTR = "data-ccf-dicebot";
  const DICEBOT_TOPBAR_SELECTOR = "span.MuiTypography-caption";
  const DICEBOT_MAP = Object.freeze({
    "언성 듀엣": "unsung-duet",
    // CCFOLIA 한국어 UI에서는 "크툴루의 부름 7판" 으로 표기됨.
    // 영문 표기도 같이 등록 (다국어 UI / BCDice 원문 표기 대응).
    "크툴루의 부름 7판": "cree-grrr",
    "Call of Cthulhu 7th Edition": "cree-grrr"
  });

  // 사용자가 "테마 커스텀" 카드의 드롭다운에서 선택 가능한 커스텀 시트 테마 목록.
  // 각 테마는 CCFOLIA의 특정 다이스봇 이름과 매핑되며, 다이스봇이 일치 + 해당 테마가
  // ON 상태일 때만 적용된다. (CSS는 buildDicebotStyleSheet에서 dicebot id로 스코프됨)
  // "none" 은 어떤 다이스봇과도 매칭되지 않는 sentinel — 선택 시 어떤 커스텀 시트도
  // 적용되지 않음 (= 사이트 기본 상태로 되돌림)
  const SHEET_THEME_NONE_ID = "none";
  const SHEET_THEMES = Object.freeze([
    Object.freeze({
      id: SHEET_THEME_NONE_ID,
      name: "기본",
      description: "커스텀 시트를 적용하지 않습니다."
    }),
    Object.freeze({
      id: "unsung-duet",
      name: "언성 듀엣",
      description: "언성 듀엣 룸용 / 팝업 디자인·트리거 이미지·BGM 보호 일괄 적용"
    }),
    Object.freeze({
      id: "cree-grrr",
      name: "CREE-GRRR!",
      description: "CREE-GRRR! 시트용 / 팝업·채팅 다이스 결과(원형/깃발 이미지) 디자인"
    })
  ]);
  // 기존 사용자의 unsungDuetEnabled:true 설정을 그대로 보존하려고 기본값은 "unsung-duet" 유지.
  // 신규/마이그레이션 시 normalizeSettings 가 "기본" 으로 떨어뜨리지 않도록 함.
  const DEFAULT_SHEET_THEME_ID = "unsung-duet";
  const SHEET_THEME_SELECT_PANEL_ID = "ccf-theme-switcher-sheet-theme-select-panel";
  const SHEET_THEME_SELECT_TOOLKIT_ID = "ccf-theme-switcher-sheet-theme-select-toolkit";

  // CREE-GRRR! 채팅 다이스 결과 인젝션 마커 / 클래스
  const CREE_GRRR_FORMATTED_ATTR = "data-ccf-cree-grrr-formatted";
  const CREE_GRRR_ROLLRESULT_CLASS = "ccf-cree-grrr-rollresult";
  const CREE_GRRR_STATUS_CLASS = "ccf-cree-grrr-result-status";
  // 다이스 카드 — Roll20 sheet-rolltemplate-coc 와 동일한 카드 레이아웃 (CC<= 판정용)
  const CREE_GRRR_CARD_CLASS = "ccf-cree-grrr-dicecard";
  // 일반 다이스 카드 — CC<= 가 아닌 일반 굴림(1D10+5, 데미지 굴림 등) 용 컴팩트 카드
  const CREE_GRRR_SIMPLE_CARD_CLASS = "ccf-cree-grrr-simpledicecard";
  const CREE_GRRR_ORIGINAL_ATTR = "data-ccf-cree-grrr-original";
  // 인식할 판정 결과 상태 키워드 — CCFOLIA(CoC 7판 BCDice) 가 실제로 출력하는 텍스트.
  // CREE-GRRR! 시트(Roll20)는 다른 명칭을 쓰므로 매칭한 다음 mapCcfStatusToCreeGrrr 로
  // Roll20 명칭(스페셜/크리티컬/극단적 성공/...) 으로 치환해 뱃지에 표시한다.
  const CREE_GRRR_STATUS_TOKENS = Object.freeze([
    "대실패",
    "실패",
    "보통 성공",
    "어려운 성공",
    "대단한 성공",
    "대성공"
  ]);
  // 다이스봇 출력의 화살표/구분자 — BCDice 는 →(U+2192), ＞(U+FF1E), 일반 > 모두 사용.
  // (=는 "1D100<=50" 같은 수식 안에서도 등장해 d100 결과로 오인되므로 제외)
  const CREE_GRRR_ARROW_CLASS = "[\\u2192\\uFF1E>]";
  // 패턴: (1) "→ 73" 결과 숫자, (2) "→ 보통 성공" 또는 (3) "(보통 성공)" 상태 키워드
  // 키워드는 길이 내림차순으로 정렬해 "보통 성공" 이 "성공" 보다 먼저 매칭되도록 함
  const CREE_GRRR_STATUS_ALT = [...CREE_GRRR_STATUS_TOKENS]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/\s+/g, "\\s*"))
    .join("|");
  const CREE_GRRR_DICE_PATTERN = new RegExp(
    CREE_GRRR_ARROW_CLASS + "\\s*(\\d+)(?!\\d)" +
    "|" + CREE_GRRR_ARROW_CLASS + "\\s*(" + CREE_GRRR_STATUS_ALT + ")" +
    "|\\((" + CREE_GRRR_STATUS_ALT + ")\\)",
    "g"
  );

  // 언성 듀엣: 채팅 트리거 텍스트 → Roll20 시트의 rolltemplate 이미지.
  // CCFOLIA는 raw URL을 자동 임베드하지 않으므로 마크다운 링크 형태로 발송.
  // 동시에 클라이언트 측에서 DOM 인젝션으로 <img>로 치환해 시각적으로 보이게 함.
  const UNSUNG_DUET_URLS = Object.freeze({
    "【시프터 판정】": "https://i.imgur.com/FFUXgYg.png",
    "【바인더 판정】": "https://i.imgur.com/Jt8hw3i.png",
    "【프래그먼트 효과】": "https://i.imgur.com/dcMRZ62.png",
    "【이계화】": "https://i.imgur.com/cfVWYGn.png"
  });
  // 트리거 → 발송 메시지에 들어갈 텍스트 ([이미지](URL) 형태)
  const UNSUNG_DUET_TRIGGER_MAP = Object.freeze(
    Object.fromEntries(
      Object.entries(UNSUNG_DUET_URLS).map(([k, url]) => [k, `[이미지](${url})`])
    )
  );
  const UNSUNG_DUET_FIELD_BOUND_ATTR = "data-ccf-unsung-duet-bound";
  const UNSUNG_DUET_TOGGLE_ID = "ccf-theme-switcher-unsung-duet-toggle";
  const UNSUNG_DUET_MSG_INJECTED_ATTR = "data-ccf-unsung-duet-msg-injected";
  const UNSUNG_DUET_IMG_CLASS = "ccf-unsung-duet-msg-img";
  // 알려진 URL → alt 텍스트 매핑 (역방향 인식용)
  const UNSUNG_DUET_URL_TO_ALT = Object.freeze({
    "https://i.imgur.com/FFUXgYg.png": "시프터 판정",
    "https://i.imgur.com/Jt8hw3i.png": "바인더 판정",
    "https://i.imgur.com/dcMRZ62.png": "프래그먼트 효과",
    "https://i.imgur.com/cfVWYGn.png": "이계화"
  });
  const TOGGLE_ID = "ccf-theme-switcher-toggle";
  const PANEL_ID = "ccf-theme-switcher-panel";
  const PANEL_POSITION_KEY = "ccf-theme-switcher-panel-position-v1";
  const TOGGLE_SIZE = 24;
  const TOGGLE_ANCHOR_INSET = 8;
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
    version: getUserscriptVersion("0.2.5"),
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
    if (toggleLayoutFrame) {
      try { window.cancelAnimationFrame(toggleLayoutFrame); } catch (error) { /* raf cleanup failed */ }
      toggleLayoutFrame = 0;
    }
    while (ccfThemeDisposers.length) {
      const disposer = ccfThemeDisposers.pop();
      try { disposer(); } catch (error) { /* disposer failed */ }
    }
    try {
      document.querySelectorAll([
        `#${STYLE_ID}`,
        `#${VARS_STYLE_ID}`,
        `#${DICEBOT_STYLE_ID}`,
        `#${TOGGLE_ID}`,
        `#${PANEL_ID}`,
        `#${CHARACTER_COLOR_POPOVER_ID}`,
        `.${CHARACTER_COLOR_WRAPPER_CLASS}`,
        '[data-ccf-theme-injected="1"]',
        'style[data-ccf-theme-style]'
      ].join(", ")).forEach(el => el.remove());
      document.documentElement?.removeAttribute(ROOT_READY_ATTR);
      document.documentElement?.removeAttribute("data-ccf-theme-active");
      document.documentElement?.removeAttribute("data-ccf-theme-mode");
      document.documentElement?.removeAttribute(DEFAULT_MODE_ATTR);
      document.documentElement?.removeAttribute(DICEBOT_ATTR);
      document.body?.removeAttribute(UI_READY_ATTR);
      document.querySelectorAll([
        `[${ANCHOR_ATTR}]`,
        `[${APPBAR_ATTR}]`,
        '[style*="--ccf-theme-anchor-height"]',
        `[${CHARACTER_COLOR_INPUT_BOUND_ATTR}]`,
        `[${CHARACTER_COLOR_CONTAINER_BOUND_ATTR}]`,
        `[${CHARACTER_COLOR_RENDER_STATE_ATTR}]`,
        `[${CHARACTER_COLOR_MODE_BOUND_ATTR}]`,
        `[${CHARACTER_COLOR_PROXY_BOUND_ATTR}]`,
        `[${CHARACTER_COLOR_NATIVE_INPUT_ATTR}]`,
        `[${UNSUNG_DUET_FIELD_BOUND_ATTR}]`,
        `[${UNSUNG_DUET_MSG_INJECTED_ATTR}]`,
        `.${UNSUNG_DUET_IMG_CLASS}`,
        `[${CREE_GRRR_FORMATTED_ATTR}]`,
        `[${CREE_GRRR_ORIGINAL_ATTR}]`,
        `.${CREE_GRRR_CARD_CLASS}`,
        `.${CREE_GRRR_SIMPLE_CARD_CLASS}`,
        `.${CREE_GRRR_ROLLRESULT_CLASS}`,
        `.${CREE_GRRR_STATUS_CLASS}`
      ].join(", ")).forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.removeProperty("--ccf-theme-anchor-height");
        }
        el.removeAttribute(ANCHOR_ATTR);
        el.removeAttribute(APPBAR_ATTR);
        el.removeAttribute(CHARACTER_COLOR_INPUT_BOUND_ATTR);
        el.removeAttribute(CHARACTER_COLOR_CONTAINER_BOUND_ATTR);
        el.removeAttribute(CHARACTER_COLOR_RENDER_STATE_ATTR);
        el.removeAttribute(CHARACTER_COLOR_MODE_BOUND_ATTR);
        el.removeAttribute(CHARACTER_COLOR_PROXY_BOUND_ATTR);
        el.removeAttribute(CHARACTER_COLOR_NATIVE_INPUT_ATTR);
        el.removeAttribute(UNSUNG_DUET_FIELD_BOUND_ATTR);
        el.removeAttribute(UNSUNG_DUET_MSG_INJECTED_ATTR);
        el.removeAttribute(CREE_GRRR_FORMATTED_ATTR);
        el.removeAttribute(CREE_GRRR_ORIGINAL_ATTR);
      });
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
  let toggleLayoutFrame = 0;
  let defaultModeRefreshFrame = 0;
  let themeFieldPreviewFrame = 0;
  let pendingThemeFieldPreview = null;
  let themeNameDraft = "";
  let panelDragState = null;
  let lastDicebotAnchor = null;
  let unsungDuetEnterReentry = false;
  let toolkitToggleObserver = null;
  let toolkitToggleObserverHost = null;
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

  // 모듈 로드 확정 로그. 이 로그조차 콘솔에 안 보이면 스크립트 자체가 GitHub
  // Pages 에서 fetch 되지 않았거나 로더가 다른 경로로 실행 중인 것.
  try {
    console.warn(
      "[CREE-GRRR!] theme-switcher module loaded",
      { url: location.href, time: new Date().toISOString() }
    );
  } catch (_) { /* ignore */ }

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
    let tryInitErrorLogged = false;
    const tryInit = () => {
      try {
        if (!ccfThemeActive) return false;
        if (!document.documentElement) return false;

        if (document.documentElement.getAttribute(ROOT_READY_ATTR) !== "1") {
          document.documentElement.setAttribute(ROOT_READY_ATTR, "1");
          injectStyles();
          applyTheme(settings, { syncUi: false });
        }

        if (!document.body) return false;

        ensureUi();
        ensureDefaultThemeSnapshot();
      } catch (err) {
        // tryInit 실패가 start() 의 후속 setup(setInterval, DOMContentLoaded 등)
        // 등록을 막아 ensureUi 가 영영 재시도되지 않는 침묵 실패를 방지.
        // 첫 실패만 로깅(이후 호출은 같은 에러로 콘솔 폭주 방지).
        if (!tryInitErrorLogged) {
          tryInitErrorLogged = true;
          try { console.warn("[CCF Theme] tryInit threw — recovering", err); } catch (_) {}
        }
        return false;
      }
      // 본문 — 위 try 블록 안에서 처리한 것 외 추가 동작은 try 밖에 두기 위해 분리

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
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        #${TOGGLE_ID} {
          position: fixed;
          z-index: 2147482600;
          width: 24px;
          height: 24px;
          left: 0;
          top: 0;
          transform: none;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #ffffff;
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
          /* 우측 패딩 30px = 쉐브론(10px) + 우측 여백(12px) + 텍스트와 쉐브론 사이(8px) */
          padding: 0 30px 0 12px;
          box-sizing: border-box;
          background-color: var(--ccf-theme-input-bg, rgba(21, 20, 20, 0.88));
          /* 네이티브 쉐브론이 항상 우측 끝에 붙어 위치 조절이 불가능하므로,
             appearance:none + 커스텀 SVG 쉐브론으로 교체하고 background-position
             으로 쉐브론을 우측에서 12px 떼어 놓는다. */
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%23f4f0eb' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
          background-repeat: no-repeat;
          background-position: right 12px center;
          background-size: 10px 6px;
          color: var(--ccf-theme-text, #f4f0eb);
          font: inherit;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
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

    // 다이스봇 스타일시트는 매 호출마다 최신 textContent 로 강제 갱신.
    // 스크립트 버전을 올렸을 때 기존 <style> 가 그대로 남아 옛 CSS(과거 인라인 뱃지 등)
    // 가 화면에 살아 있는 문제를 방지.
    let dicebotStyle = document.getElementById(DICEBOT_STYLE_ID);
    if (!(dicebotStyle instanceof HTMLStyleElement)) {
      dicebotStyle = document.createElement("style");
      dicebotStyle.id = DICEBOT_STYLE_ID;
      document.documentElement.appendChild(dicebotStyle);
    }
    const nextContent = buildDicebotStyleSheet();
    if (dicebotStyle.textContent !== nextContent) {
      dicebotStyle.textContent = nextContent;
    }
  }

  function buildDicebotStyleSheet() {
    // Roll20 "언성 듀엣" 커스텀시트 팔레트
    // (Roll20 원본: bg #1c3245 / border #004d67 / muted #8895A1 / accent #fff)
    const UD = {
      // 반투명: CCFOLIA 네이티브 다크 배경이 비쳐 보이도록 알파 낮춤
      bgGlass: "rgba(28, 50, 69, 0.55)",
      bgGlassInner: "rgba(28, 50, 69, 0.32)",
      bgSolid: "#1c3245",
      // 텍스트 입력칸은 청록 톤 유지
      bgChip: "rgba(0, 77, 103, 0.28)",
      inputBorder: "#004d67",
      inputBorderSoft: "rgba(0, 77, 103, 0.55)",
      // 텍스트 입력칸을 제외한 나머지 영역(헤더/보더/셀렉트/스크롤바 등)은
      // 언성 듀엣 배경과 동일한 블랙 톤으로 통일
      accent: "#000000",
      accentSoft: "rgba(0, 0, 0, 0.55)",
      accentHover: "rgba(0, 0, 0, 0.45)",
      muted: "#8895A1",
      text: "#ffffff",
      shadow: "rgba(0, 0, 0, 0.45)",
      // Roll20 시트의 헤더 일러스트(언성 듀엣 룰 타이틀 그려져 있는 .sheet-outer 배경)
      sheetBg: "url(https://i.imgur.com/htxGxau.png)"
    };

    return `
      /* === [언성 듀엣] 캐릭터 편집 팝업 ============================= */
      /* Dialog paper 자체: 반투명 + 블랙 보더(=inset shadow).
         외곽선은 inset box-shadow만으로 표현 — 레이아웃 영향 없음.
         min-width: MUI 'sm' 기본값(600px)을 명시해 CCFOLIA 네이티브 너비 보장. */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper,
      html[${DICEBOT_ATTR}="unsung-duet"] div[role="dialog"] > .MuiPaper-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiPaper-root.MuiDialog-paper {
        background-color: ${UD.bgGlass} !important;
        background-image: none !important;
        color: ${UD.text} !important;
        border: 0 !important;
        min-width: min(600px, calc(100vw - 64px)) !important;
        box-shadow:
          inset 0 0 0 1px ${UD.accent},
          0 18px 40px ${UD.shadow} !important;
      }

      /* DialogActions(삭제/복제/맵에서 집어넣기):
         - 세 버튼이 가로 폭을 균등 분배하도록 flex:1 1 0
         - 텍스트는 어떤 너비에서도 한 줄 유지 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogActions-root .MuiButton-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogActions-root .MuiButtonBase-root {
        flex: 1 1 0 !important;
        min-width: 0 !important;
        white-space: nowrap !important;
      }

      /* 캐릭터 편집 헤더 (MuiAppBar) — 블랙 톤.
         border-bottom 대신 inset box-shadow로 가짜 보더 — 레이아웃 영향 없음 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAppBar-root,
      html[${DICEBOT_ATTR}="unsung-duet"] div[role="dialog"] .MuiAppBar-root {
        background: ${UD.accentSoft} !important;
        background-image: none !important;
        color: ${UD.text} !important;
        border-bottom: 0 !important;
        box-shadow:
          inset 0 -1px 0 0 ${UD.accent},
          0 4px 14px ${UD.shadow} !important;
      }
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAppBar-root .MuiTypography-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAppBar-root .MuiIconButton-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAppBar-root .MuiSvgIcon-root {
        color: ${UD.text} !important;
      }
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAppBar-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAppBar-root .MuiIconButton-root:hover {
        background: ${UD.accentHover} !important;
      }

      /* DialogContent: Roll20 시트의 헤더 일러스트를 깔아 룰 타이틀이 보이게 함.
         배경 이미지 + 반투명 청록 톤 오버레이가 겹쳐 보이도록 두 레이어 사용. */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root {
        background-image:
          linear-gradient(${UD.bgGlassInner}, ${UD.bgGlassInner}),
          ${UD.sheetBg} !important;
        background-repeat: no-repeat, no-repeat !important;
        background-position: center top, center top !important;
        background-size: cover, contain !important;
        background-color: transparent !important;
      }

      /* 내부 Paper/카드/아코디언 — MuiAppBar는 위 헤더 규칙이 처리하므로 제외 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiPaper-root:not(.MuiAppBar-root),
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiCard-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiAccordion-root {
        background: ${UD.bgGlassInner} !important;
        color: ${UD.text} !important;
        border-color: ${UD.accentSoft} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDivider-root {
        border-color: ${UD.accentSoft} !important;
      }

      /* 텍스트 톤 — DialogActions(삭제/복제 등 액션 버튼)는 CCFOLIA 네이티브
         색을 유지하기 위해 DialogContent 스코프로 한정 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiTypography-root:not([style*="color:"]),
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiFormLabel-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiInputLabel-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiFormControlLabel-label,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiTab-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiButton-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiButtonBase-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiSvgIcon-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogTitle-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogTitle-root .MuiTypography-root {
        color: ${UD.text} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiTypography-caption,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiFormHelperText-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiListItemText-secondary {
        color: ${UD.muted} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiInputBase-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiOutlinedInput-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiFilledInput-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiInputBase-input,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper textarea,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper input[type="text"],
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper input[type="number"] {
        background: ${UD.bgChip} !important;
        color: ${UD.text} !important;
        border-radius: 0 !important;
      }

      /* 입력칸 보더는 청록 유지 (Roll20 시트 톤) */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiInputBase-root fieldset {
        border-color: ${UD.inputBorder} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .Mui-focused .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiInputBase-root.Mui-focused fieldset {
        border-color: ${UD.muted} !important;
        box-shadow: 0 0 0 2px rgba(136, 149, 161, 0.25) !important;
      }

      /* 탭/리스트 선택 — 블랙 액센트 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiTab-root.Mui-selected,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiListItemButton-root.Mui-selected,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .Mui-selected > .MuiListItemButton-root {
        background: ${UD.accent} !important;
        color: ${UD.text} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiTabs-indicator {
        background: ${UD.text} !important;
      }

      /* 호버 — 블랙 톤 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiTab-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiListItemButton-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiMenuItem-root:hover {
        background: ${UD.accentHover} !important;
      }

      /* 캐릭터 시트 팝업 스크롤바 — 블랙 액센트 */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper ::-webkit-scrollbar-track {
        background: ${UD.bgSolid};
      }
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper ::-webkit-scrollbar-thumb {
        background: ${UD.accent};
        border: 2px solid ${UD.bgSolid};
        border-radius: 999px;
      }

      /* === [언성 듀엣] 다이스 롤 채팅 메시지 ======================== */
      /* 채팅 로그 영역의 메시지 아이템 (li) 에 카드 톤 적용 */
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="polite"] li,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="assertive"] li {
        background: ${UD.bgGlass} !important;
        border: 1px solid ${UD.inputBorder} !important;
        border-radius: 10px !important;
        margin: 6px 8px !important;
        padding: 8px 12px !important;
        box-shadow: 0 8px 18px ${UD.shadow} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li p.MuiTypography-body2,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="polite"] li p.MuiTypography-body2,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="assertive"] li p.MuiTypography-body2 {
        color: ${UD.muted} !important;
      }

      /* 다이스 결과(예: "1D6 → 4") 강조: 화살표/숫자가 들어가는 패턴을
         가진 메시지의 굵은 텍스트는 흰색으로 띄움 */
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li strong,
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li b,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="polite"] li strong,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="assertive"] li strong {
        color: ${UD.text} !important;
        font-weight: bold;
      }

      /* 캐릭터 이름(닉네임) 라벨 톤 */
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li .MuiTypography-caption,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="polite"] li .MuiTypography-caption,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="assertive"] li .MuiTypography-caption {
        color: ${UD.text} !important;
        font-weight: bold;
      }

      /* 트리거 텍스트가 치환된 <img> — 채팅 메시지에서 가운데 정렬 */
      .${UNSUNG_DUET_IMG_CLASS} {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 6px auto;
        border-radius: 4px;
      }

      ${buildCreeGrrrStyleSheet()}
    `;
  }

  function buildCreeGrrrStyleSheet() {
    // CREE-GRRR! 커스텀 시트 팔레트 (Roll20 원본 시트에서 추출)
    // - 베이스: 어두운 톤 + sheet-wrap 헤더 이미지(https://i.imgur.com/MUGe6Qi.png)
    // - 액센트: #1ff2f2 (시안)
    // - 본문 텍스트: #FFF / 보조 #d1d1d1 / dim #c2c2c2
    // - 입력칸: rgba(0,0,0,0.5) + 흰색 보더, 라운드 4~7px
    // - 폰트: DungGeunMo + Galmuri (Roll20 시트와 동일 외관)
    const CG = {
      bgGlass: "rgba(7, 12, 25, 0.72)",
      bgGlassInner: "rgba(7, 12, 25, 0.45)",
      bgSolid: "#0b122a",
      bgChip: "rgba(0, 0, 0, 0.5)",
      accent: "#1ff2f2",
      accentSoft: "rgba(31, 242, 242, 0.45)",
      accentHover: "rgba(31, 242, 242, 0.15)",
      border: "#ffffff",
      borderSoft: "rgba(255, 255, 255, 0.4)",
      muted: "#d1d1d1",
      dim: "#c2c2c2",
      text: "#ffffff",
      shadow: "rgba(0, 0, 0, 0.55)",
      sheetBg: "url(https://i.imgur.com/MUGe6Qi.png)",
      diceBoxBg: "url(https://i.imgur.com/hj7QazV.png)",
      // Roll20 시트의 'DungGeunMo' 픽셀 폰트와 'Galmuri'. 원본 시트와 동일한 폰트
      // 패밀리를 import 해 CCFOLIA 측에도 적용한다. (한글 글리프 지원 + 동일 외형)
      fontImport:
        "@font-face{font-family:'DungGeunMo';src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff') format('woff');font-weight:normal;font-style:normal;}" +
        "@import url('https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css');"
    };

    return `
      /* === [CREE-GRRR!] 폰트 임포트 (Roll20 시트 외관과 동일하게) ====== */
      ${CG.fontImport}

      /* === [CREE-GRRR!] 캐릭터 편집 팝업 ============================ */
      /* paper: 상/하단 시안 라인만, border-radius 0 으로 모서리 라운드 제거.
         좌/우 시안은 어디에도 그리지 않음(체크된 위치의 LR 시안 모두 삭제). */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper,
      html[${DICEBOT_ATTR}="cree-grrr"] div[role="dialog"] > .MuiPaper-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiPaper-root.MuiDialog-paper {
        background-color: ${CG.bgGlass} !important;
        background-image: none !important;
        color: ${CG.text} !important;
        border: 0 !important;
        border-radius: 0 !important;
        min-width: min(600px, calc(100vw - 64px)) !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
        box-shadow:
          inset 0 1px 0 0 ${CG.accent},
          inset 0 -1px 0 0 ${CG.accent},
          0 18px 40px ${CG.shadow} !important;
      }

      /* DialogActions 상단 시안 라인 — pseudo-element ::before 로 y=1px 위치에
         1px 라인. 스크롤바와 1px 떨어진 위치. 부모 컨테이너는 position:relative
         만 추가하고 layout(display/padding/gap 등)은 절대 건들지 않음 →
         BGM 미니 팝업 등 fullWidth 가 아닌 액션 바의 MUI 기본 layout 보존.
         하단 모서리도 라운드 제거(border-radius:0). */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialogActions-root.MuiDialogActions-spacing {
        position: relative !important;
        border-radius: 0 !important;
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialogActions-root.MuiDialogActions-spacing::before {
        content: "" !important;
        position: absolute !important;
        top: 1px !important;
        left: 0 !important;
        right: 0 !important;
        height: 1px !important;
        background: ${CG.accent} !important;
        pointer-events: none !important;
        z-index: 1 !important;
      }

      /* 캐릭터 편집 팝업 fullWidth 버튼만 강제 균등 분배. :has() 미지원 브라우저
         호환 위해 부모는 건드리지 않고 자식 버튼만 직접 스타일 — MuiButton-fullWidth
         가 붙은 버튼에만 flex:1 1 0 + width:0 으로 동일 분배. BGM 등 fullWidth 없는
         케이스는 이 셀렉터에 매칭되지 않아 영향 없음 (MUI 기본 layout 유지). */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialogActions-root.MuiDialogActions-spacing > .MuiButton-fullWidth {
        flex: 1 1 0 !important;
        flex-grow: 1 !important;
        flex-shrink: 1 !important;
        flex-basis: 0 !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: none !important;
        white-space: nowrap !important;
        box-sizing: border-box !important;
      }

      /* 폰트는 캐릭터 편집(fullWidth) 이든 BGM 미니 팝업(자연 폭) 이든 공통.
         시트 픽셀 폰트 + 14px 로 통일. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialogActions-root.MuiDialogActions-spacing > .MuiButton-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialogActions-root.MuiDialogActions-spacing > .MuiButtonBase-root {
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
        font-size: 14px !important;
        letter-spacing: 0 !important;
      }

      /* 캐릭터 편집 헤더 (MuiAppBar) — 블랙 베이스. 좌/우 시안 제거(체크 지점),
         상/하단만 시안 라인 유지(상단=다이얼로그 최상단, 하단=AppBar↔Content 구분선). */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAppBar-root,
      html[${DICEBOT_ATTR}="cree-grrr"] div[role="dialog"] .MuiAppBar-root {
        background: ${CG.bgSolid} !important;
        background-image: none !important;
        color: ${CG.text} !important;
        border-bottom: 0 !important;
        border-radius: 0 !important;
        box-shadow:
          inset 0 1px 0 0 ${CG.accent},
          inset 0 -1px 0 0 ${CG.accent},
          0 4px 14px ${CG.shadow} !important;
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAppBar-root .MuiTypography-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAppBar-root .MuiIconButton-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAppBar-root .MuiSvgIcon-root {
        color: ${CG.text} !important;
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAppBar-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAppBar-root .MuiIconButton-root:hover {
        background: ${CG.accentHover} !important;
      }

      /* DialogContent: 시트 헤더 일러스트 + 어두운 오버레이.
         좌/우 시안 inset 제거(체크 지점) — 다이얼로그는 상/하단 가로 라인과
         AppBar↔Content / Content↔Actions 구분선만 갖는 미니멀 구성. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root {
        background-image:
          linear-gradient(${CG.bgGlassInner}, ${CG.bgGlassInner}),
          ${CG.sheetBg} !important;
        background-repeat: no-repeat, no-repeat !important;
        background-position: center top, center top !important;
        background-size: cover, cover !important;
        background-color: transparent !important;
      }

      /* 내부 Paper/카드/아코디언 */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiPaper-root:not(.MuiAppBar-root),
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiCard-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiAccordion-root {
        background: ${CG.bgGlassInner} !important;
        color: ${CG.text} !important;
        border-color: ${CG.accentSoft} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDivider-root {
        border-color: ${CG.accentSoft} !important;
      }

      /* 필드 라벨(소항목) — 이름/이니셔티브/토큰 사이즈/참고 URL 등 캐릭터 편집
         팝업의 모든 input/select 라벨 텍스트. 색상은 CYAN(#1DE2E2),
         폰트는 입력창과 동일한 DungGeunMo 픽셀 폰트. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiInputLabel-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiFormLabel-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiFormControlLabel-label {
        color: #1DE2E2 !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
      }

      /* 그 외 본문 텍스트 톤 — 흰색 (DialogContent 스코프로 한정, DialogActions 네이티브 유지) */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiTypography-root:not([style*="color:"]),
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiTab-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiButton-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiButtonBase-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiSvgIcon-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogTitle-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogTitle-root .MuiTypography-root {
        color: ${CG.text} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiTypography-caption,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiFormHelperText-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiListItemText-secondary {
        color: ${CG.dim} !important;
      }

      /* 입력칸 — 검은 베이스 + 흰색 텍스트(사용자가 입력하는 실제 값은 화이트).
         라벨(소항목)은 별도 규칙으로 CYAN(#1DE2E2). 폰트는 DungGeunMo 픽셀 폰트. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiInputBase-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiOutlinedInput-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiFilledInput-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiInputBase-input,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiSelect-select,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper textarea,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper input[type="text"],
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper input[type="number"],
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper input[type="url"] {
        background: ${CG.bgChip} !important;
        color: ${CG.text} !important;
        border-radius: 4px !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiInputBase-root fieldset {
        border-color: ${CG.borderSoft} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .Mui-focused .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiInputBase-root.Mui-focused fieldset {
        border-color: ${CG.accent} !important;
        box-shadow: 0 0 0 2px rgba(31, 242, 242, 0.22) !important;
      }

      /* 탭/리스트 선택 — 시안 액센트 */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiTab-root.Mui-selected,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiListItemButton-root.Mui-selected,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .Mui-selected > .MuiListItemButton-root {
        background: ${CG.accentHover} !important;
        color: ${CG.accent} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiTabs-indicator {
        background: ${CG.accent} !important;
      }

      /* 호버 — 시안 톤 */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiTab-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiListItemButton-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper .MuiDialogContent-root .MuiMenuItem-root:hover {
        background: ${CG.accentHover} !important;
      }

      /* 캐릭터 시트 팝업 스크롤바 — 시안 액센트 */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper ::-webkit-scrollbar-track {
        background: ${CG.bgSolid};
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper ::-webkit-scrollbar-thumb {
        background: ${CG.accent};
        border: 2px solid ${CG.bgSolid};
        border-radius: 999px;
      }

      /* === [CREE-GRRR!] 다이스 롤 채팅 메시지 ======================= */
      /* Roll20 시트의 .sheet-rolltemplate-coc 박스 디자인을 CCFOLIA 채팅
         메시지(li)에 차용 — 검은 카드 + 시안 보더 + DungGeunMo 폰트 */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li {
        background: ${CG.bgGlass} !important;
        border: 1px solid ${CG.accent} !important;
        border-radius: 10px !important;
        margin: 6px 8px !important;
        padding: 10px 14px !important;
        box-shadow: 0 8px 18px ${CG.shadow}, inset 0 0 0 1px rgba(31, 242, 242, 0.12) !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
      }

      /* 본문 텍스트 — 어두운 톤에서 가독성 위해 #d1d1d1 */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li p.MuiTypography-body2,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li p.MuiTypography-body2,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li p.MuiTypography-body2 {
        color: ${CG.muted} !important;
        font-family: inherit !important;
      }

      /* 다이스 결과 강조 (굵은 텍스트 → 시안) */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li strong,
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li b,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li strong,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li strong {
        color: ${CG.accent} !important;
        font-weight: normal !important; /* 픽셀 폰트라 굵게 처리 불필요 */
      }

      /* 인라인 롤 결과 — 시안 강조 */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li .inlinerollresult,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li .inlinerollresult,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li .inlinerollresult {
        background: none !important;
        border: none !important;
        color: ${CG.accent} !important;
        padding: 0 !important;
        font-weight: normal !important;
      }

      /* 캐릭터 이름(닉네임) — 시안 액센트 */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li .MuiTypography-caption,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li .MuiTypography-caption,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li .MuiTypography-caption {
        color: ${CG.accent} !important;
      }

      /* 채팅 입력창 영역에도 폰트 톤 통일 (선택 사항) */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li a {
        color: ${CG.accent} !important;
      }

      /* 레거시 v0.1.x 인라인 뱃지 무력화 — 브라우저에 옛 CSS가 캐시되어 살아 있어도
         시각 효과가 안 나오게 강제 unset. JS 측 cleanupLegacyCreeGrrrSpans 와 이중 안전망. */
      .${CREE_GRRR_ROLLRESULT_CLASS},
      .${CREE_GRRR_STATUS_CLASS} {
        all: unset !important;
        display: inline !important;
      }

      /* 카드를 머금은 host 요소 — 강제 display:block 으로 인라인 컨텍스트의 클리핑 회피.
         배경/패딩/마진 모두 해제해 카드가 자기 레이아웃 그대로 보이게 함. */
      [${CREE_GRRR_FORMATTED_ATTR}="1"] {
        display: block !important;
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
      }

      /* === [CREE-GRRR!] 다이스 판정 결과 카드 ========================
         Roll20 시트의 sheet-rolltemplate-coc (243×370px) 와 동일한 카드 레이아웃.
         스킬명 / 3개의 작은 원(판정기준·/2·/5) / 큰 중앙 원(판정값) / 판정단계 텍스트
         JS 측에서 dicebot==='cree-grrr' + 판정 텍스트(CC<=N 또는 (1D100<=N)) 매칭
         시에만 카드를 빌드해 메시지 본문을 대체. */
      .${CREE_GRRR_CARD_CLASS} {
        position: relative;
        display: block;
        width: 243px;
        height: 370px;
        margin: 6px 0;
        background-color: rgba(7, 12, 25, 0.85);
        background-image: url(https://i.imgur.com/hj7QazV.png);
        background-repeat: no-repeat;
        background-position: center;
        background-size: contain;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif;
        color: ${CG.accent};
        text-align: center;
        box-sizing: border-box;
      }
      /* 스킬명 뱃지 — 좌측 상단 */
      .${CREE_GRRR_CARD_CLASS}__skill {
        position: absolute;
        top: 28px;
        left: 0;
        padding: 5px 20px;
        background-color: rgba(40, 170, 226, 0.25);
        font-size: 16px;
        color: ${CG.accent};
        max-width: 60%;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      /* 3개의 작은 판정 원 (판정기준 / 기준/2 / 기준/5) */
      .${CREE_GRRR_CARD_CLASS}__targets {
        position: absolute;
        top: 88px;
        left: 0;
        right: 0;
        display: flex;
        justify-content: center;
        gap: 14px;
      }
      .${CREE_GRRR_CARD_CLASS}__target {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        background-color: rgba(7, 12, 25, 0.55);
        background-image: url(https://i.imgur.com/XmfjgaY.png);
        background-repeat: no-repeat;
        background-position: center;
        background-size: contain;
        border: 1px solid ${CG.accent};
        border-radius: 50%;
        box-sizing: border-box;
        font-size: 16px;
        color: ${CG.accent};
        font-family: inherit;
      }
      /* 큰 중앙 원 — 판정값 (실제 d100 굴림) */
      .${CREE_GRRR_CARD_CLASS}__result {
        position: absolute;
        top: 150px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 106px;
        height: 106px;
        background-color: rgba(7, 12, 25, 0.55);
        background-image: url(https://i.imgur.com/QxyXISE.png);
        background-repeat: no-repeat;
        background-position: center;
        background-size: contain;
        border: 1.5px solid ${CG.accent};
        border-radius: 50%;
        box-sizing: border-box;
        font-size: 52px;
        line-height: 1;
        color: ${CG.accent};
        font-family: inherit;
      }
      /* 판정단계 텍스트 — 카드 하단 */
      .${CREE_GRRR_CARD_CLASS}__status {
        position: absolute;
        bottom: 50px;
        left: 0;
        right: 0;
        font-size: 22px;
        font-family: inherit;
      }
      .${CREE_GRRR_CARD_CLASS}__status--fail {
        color: #de0000;
      }
      .${CREE_GRRR_CARD_CLASS}__status--success {
        color: ${CG.accent};
      }

      /* === [CREE-GRRR!] 일반 다이스 카드 (CC<= 가 아닌 일반 굴림용) =======
         원본 시트의 .sheet-rolltemplate-coc-dice-roll 사양 1:1 이식.
         - 카드 프레임: 293mfNY.png (시안 보더 + 어두운 배경이 이미지에 포함)
         - 사이즈: 243 × 86 고정
         - 좌측: 65×65 결과 원(QxyXISE.png), font 30px, 시안색
         - 우측: caption 텍스트 139px, font 16px, 흰색 (#fff)
         - 별도 border / border-radius 없음 (프레임 PNG 가 처리) */
      .${CREE_GRRR_SIMPLE_CARD_CLASS} {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 243px;
        height: 86px;
        margin: 6px 0;
        padding: 0 15px;
        background: url(https://i.imgur.com/293mfNY.png) 0 0 no-repeat;
        background-size: contain;
        color: ${CG.accent};
        font-family: 'DungGeunMo', 'Galmuri', sans-serif;
        box-sizing: border-box;
        vertical-align: top;
      }
      .${CREE_GRRR_SIMPLE_CARD_CLASS}__result {
        width: 65px;
        height: 65px;
        background: url(https://i.imgur.com/QxyXISE.png) center no-repeat;
        background-size: contain;
        line-height: 65px;
        font-size: 30px;
        text-align: center;
        color: ${CG.accent};
        font-family: inherit;
        flex: 0 0 auto;
      }
      .${CREE_GRRR_SIMPLE_CARD_CLASS}__formula {
        width: 139px;
        font-size: 16px;
        text-align: center;
        color: #fff;
        font-family: inherit;
      }
    `;
  }

  function ensureUi() {
    if (!ccfThemeActive) return;
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
      toggle.addEventListener("click", () => {
        if (!ccfThemeActive) return;
        togglePanel();
      }, ccfThemeWithSignal());
    }

    // 각 단계를 개별 try-catch 로 감싸서 한 단계의 실패가 뒤따르는 호출
    // (특히 injectCreeGrrrDiceFormatting) 을 막지 않도록 한다.
    // 이전엔 ensureUi 안의 어떤 호출이 한 번 throw 하면 그 이후 호출이 영영
    // 실행되지 않아 다이스 카드 인젝션이 침묵 실패하는 경로가 있었음.
    try { mountToggle(); } catch (e) { try { console.warn("[CCF Theme] mountToggle failed", e); } catch (_) {} }
    try { applyDicebotAttribute(); } catch (e) { try { console.warn("[CCF Theme] applyDicebotAttribute failed", e); } catch (_) {} }
    try { bindUnsungDuetTriggerFields(); } catch (e) { try { console.warn("[CCF Theme] bindUnsungDuetTriggerFields failed", e); } catch (_) {} }
    try { injectUnsungDuetMessageImages(); } catch (e) { try { console.warn("[CCF Theme] injectUnsungDuetMessageImages failed", e); } catch (_) {} }
    try { injectCreeGrrrDiceFormatting(); } catch (e) { try { console.warn("[CCF Theme] injectCreeGrrrDiceFormatting failed", e); } catch (_) {} }
    try { installYouTubePauseInterceptor(); } catch (e) { try { console.warn("[CCF Theme] installYouTubePauseInterceptor failed", e); } catch (_) {} }
    try { ensureToolkitToggleWatcher(); } catch (e) { try { console.warn("[CCF Theme] ensureToolkitToggleWatcher failed", e); } catch (_) {} }
    try { mountUnsungDuetToolkitToggle(); } catch (e) { try { console.warn("[CCF Theme] mountUnsungDuetToolkitToggle failed", e); } catch (_) {} }

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
          <label class="ccf-theme-row">
            <span>커스텀 시트 테마</span>
            <select id="${SHEET_THEME_SELECT_PANEL_ID}" class="ccf-theme-select" aria-label="커스텀 시트 테마 선택">
              ${SHEET_THEMES.map((theme) => `
                <option value="${escapeHtml(theme.id)}">${escapeHtml(theme.name)}</option>
              `).join("")}
            </select>
          </label>
          <div class="ccf-theme-actions">
            <button
              type="button"
              class="ccf-theme-btn"
              id="${UNSUNG_DUET_TOGGLE_ID}"
              data-action="toggle-unsung-duet"
              aria-pressed="true"
            >선택 테마: ON</button>
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

        if (action === "toggle-unsung-duet") {
          const nextEnabled = !isSheetThemeEnabled();
          settings = { ...settings, unsungDuetEnabled: nextEnabled };
          persistSettings();
          syncUnsungDuetToggle();
          applyDicebotAttribute();
          // 토글 OFF → 이미 인젝트된 이미지/마킹을 즉시 정리해 원본 텍스트로 복원
          // 토글 ON → 새 테마의 인젝션을 기존 메시지에도 즉시 적용
          if (!nextEnabled) revertUnsungDuetDomState();
          else reapplySheetThemeInjections();
          const themeName = SHEET_THEMES.find((t) => t.id === getSelectedSheetThemeId())?.name || "";
          setStatus(
            nextEnabled
              ? `${themeName} 테마를 활성화했습니다.`
              : `${themeName} 테마를 비활성화했습니다.`,
            "success"
          );
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

      panel.querySelector(`#${SHEET_THEME_SELECT_PANEL_ID}`)?.addEventListener("change", (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLSelectElement)) return;
        const value = target.value;
        if (!SHEET_THEMES.some((t) => t.id === value)) return;
        settings = { ...settings, selectedSheetTheme: value };
        persistSettings();
        applyDicebotAttribute();
        // 다른 테마로 전환 — 이전 테마의 인젝션 흔적(이미지 치환 등) 즉시 정리
        revertUnsungDuetDomState();
        // 새 테마 인젝션을 즉시 재실행
        reapplySheetThemeInjections();
        syncUnsungDuetToggle();
        const themeName = SHEET_THEMES.find((t) => t.id === value)?.name || value;
        setStatus(`커스텀 시트 테마: ${themeName}`, "success");
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
      if (!ccfThemeActive) return;
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

    input.addEventListener("input", refresh, ccfThemeWithSignal());
    input.addEventListener("change", refresh, ccfThemeWithSignal());
  }

  function bindCharacterColorContainer(container) {
    if (!(container instanceof HTMLElement)) return;
    if (container.getAttribute(CHARACTER_COLOR_CONTAINER_BOUND_ATTR) === "1") return;

    container.setAttribute(CHARACTER_COLOR_CONTAINER_BOUND_ATTR, "1");

    const refreshFromContainer = (event) => {
      if (!ccfThemeActive) return;
      const clickedColor = resolveNativeCharacterColorFromTarget(event?.target, container);
      if (clickedColor) {
        pendingCharacterColorSelections.set(container, clickedColor);
      }

      const runRefresh = () => {
        if (!ccfThemeActive) return;
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

    container.addEventListener("click", refreshFromContainer, ccfThemeWithSignal(true));
    container.addEventListener("pointerup", refreshFromContainer, ccfThemeWithSignal(true));
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
      queueTogglePositionUpdate();
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
      if (!ccfThemeActive) return;
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
    syncUnsungDuetToggle();
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
      if (!ccfThemeActive) return;
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
        if (!ccfThemeActive) return;
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

  function detectDicebotName() {
    // 탑바의 `<span class="MuiTypography-caption">…</span>` 들을 훑어
    // DICEBOT_MAP 의 키와 일치하는 텍스트가 있으면 해당 식별자를 돌려준다.
    const spans = document.querySelectorAll(DICEBOT_TOPBAR_SELECTOR);
    for (const span of spans) {
      if (!(span instanceof HTMLElement)) continue;
      const text = normalizeSpace(span.textContent || "");
      if (!text) continue;
      if (Object.prototype.hasOwnProperty.call(DICEBOT_MAP, text)) {
        return DICEBOT_MAP[text];
      }
    }
    return "";
  }

  function getSelectedSheetThemeId() {
    const v = settings?.selectedSheetTheme;
    return SHEET_THEMES.some((t) => t.id === v) ? v : DEFAULT_SHEET_THEME_ID;
  }

  function isSheetThemeEnabled() {
    // 레거시 키 unsungDuetEnabled를 시트 테마 전체 ON/OFF 마스터 스위치로 재사용
    return settings?.unsungDuetEnabled !== false;
  }

  function applyDicebotAttribute() {
    const root = document.documentElement;
    if (!root) return;
    // 사용자가 드롭다운에서 명시적으로 선택 + ON 했으면 그 테마를 무조건 적용.
    // (CCFOLIA 다이스봇 표시명이 환경마다 미묘하게 달라 감지가 실패하는 케이스를 회피.
    //  detectDicebotName() 의 결과는 더 이상 게이트로 사용하지 않는다.)
    let id = "";
    if (isSheetThemeEnabled()) {
      const selected = getSelectedSheetThemeId();
      if (selected && selected !== SHEET_THEME_NONE_ID) {
        id = selected;
      }
    }
    const current = root.getAttribute(DICEBOT_ATTR) || "";
    if (id) {
      if (current !== id) root.setAttribute(DICEBOT_ATTR, id);
    } else if (current) {
      root.removeAttribute(DICEBOT_ATTR);
    }
  }

  // === 언성 듀엣: 채팅 트리거 텍스트 → 이미지 URL 자동 치환 ============
  function getCurrentDicebotId() {
    return document.documentElement?.getAttribute(DICEBOT_ATTR) || "";
  }

  function replaceUnsungDuetTriggers(text) {
    if (typeof text !== "string" || !text) return text;
    let result = text;
    for (const [trigger, url] of Object.entries(UNSUNG_DUET_TRIGGER_MAP)) {
      if (result.indexOf(trigger) >= 0) {
        result = result.split(trigger).join(url);
      }
    }
    return result;
  }

  function setReactInputValue(el, value) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function isUnsungDuetTextField(field) {
    if (field instanceof HTMLTextAreaElement) return true;
    if (field instanceof HTMLInputElement) {
      const type = (field.type || "text").toLowerCase();
      return type === "text" || type === "search" || type === "url" || type === "email" || type === "";
    }
    return false;
  }

  function hasActiveChatMacroSelection(field) {
    if (!(field instanceof HTMLTextAreaElement) || field.getAttribute("name") !== "text") return false;

    const controls = [field, field.closest?.('[role="combobox"]')]
      .filter((control) => control instanceof HTMLElement);
    if (controls.some((control) => {
      if (control.getAttribute("aria-expanded") === "true") return true;
      const activeDescendant = control.getAttribute("aria-activedescendant");
      return !!activeDescendant && !!document.getElementById(activeDescendant);
    })) {
      return true;
    }

    const inputId = field.id || "";
    const relatedIds = [
      field.getAttribute("aria-controls"),
      field.getAttribute("aria-owns"),
      inputId.endsWith("-input") ? `${inputId.slice(0, -6)}-menu` : ""
    ].filter(Boolean);

    return relatedIds.some((id) => {
      const menu = document.getElementById(id);
      if (!(menu instanceof HTMLElement) || !String(menu.textContent || "").trim()) return false;
      const style = window.getComputedStyle(menu);
      return style.display !== "none" && style.visibility !== "hidden" && menu.getClientRects().length > 0;
    });
  }

  function bindUnsungDuetField(field) {
    if (!isUnsungDuetTextField(field)) return;
    if (field.getAttribute(UNSUNG_DUET_FIELD_BOUND_ATTR) === "1") return;
    field.setAttribute(UNSUNG_DUET_FIELD_BOUND_ATTR, "1");

    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      // Shift+Enter는 줄바꿈, IME 조합 중 Enter는 한글 확정용 — 둘 다 발송이 아님
      if (event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (hasActiveChatMacroSelection(field)) return;
      if (unsungDuetEnterReentry) return;
      if (getCurrentDicebotId() !== "unsung-duet") return;

      const original = field.value;
      const replaced = replaceUnsungDuetTriggers(original);
      if (replaced === original) return;

      // 트리거 발견 — 원 Enter는 막고, value 치환 후 React state가 갱신될 시간을
      // 준 뒤 새 Enter 키 이벤트를 재발송해서 CCFOLIA 채팅 전송 핸들러를 깨움
      event.preventDefault();
      event.stopPropagation();

      setReactInputValue(field, replaced);

      window.setTimeout(() => {
        unsungDuetEnterReentry = true;
        try {
          const replay = new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false
          });
          field.dispatchEvent(replay);

          // 일부 빌드는 form submit으로 발송하므로 form fallback도 시도
          const form = field.closest("form");
          if (form && typeof form.requestSubmit === "function") {
            try { form.requestSubmit(); } catch (error) { /* requestSubmit 실패 무시 */ }
          }

          // 본인이 발송한 트리거 메시지 → 곧 컷인이 재생됨.
          // 다음 N초간 YouTube iframe으로 가는 pauseVideo 명령을 차단해
          // BGM이 일시정지되지 않도록 표시.
          markUnsungDuetCutinActive();
        } finally {
          window.setTimeout(() => { unsungDuetEnterReentry = false; }, 120);
        }
      }, 0);
    }, ccfThemeWithSignal(true));
  }

  function syncUnsungDuetToggle() {
    const enabled = isSheetThemeEnabled();
    const selectedId = getSelectedSheetThemeId();
    const themeName = SHEET_THEMES.find((t) => t.id === selectedId)?.name || "";
    const button = document.getElementById(UNSUNG_DUET_TOGGLE_ID);
    if (button instanceof HTMLButtonElement) {
      button.textContent = enabled ? `${themeName} 테마: ON` : `${themeName} 테마: OFF`;
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
    const panelSelect = document.getElementById(SHEET_THEME_SELECT_PANEL_ID);
    if (panelSelect instanceof HTMLSelectElement && panelSelect.value !== selectedId) {
      panelSelect.value = selectedId;
    }
    syncUnsungDuetToolkitToggle();
  }

  // === 카피바라 툴킷 패널의 "테마 커스텀" 카드 안에 토글 인젝트 =============
  function findToolkitThemeCard() {
    const toolkitRoot = document.getElementById("capybara-toolkit-root");
    const shadow = toolkitRoot?.shadowRoot;
    if (!shadow) return null;
    return shadow.querySelector('article.feature[data-feature="ccf-theme-switcher"]');
  }

  function mountUnsungDuetToolkitToggle() {
    const card = findToolkitThemeCard();
    if (!card) return;

    let row = card.querySelector("[data-ccf-unsung-duet-row]");
    if (!row) {
      row = document.createElement("div");
      row.setAttribute("data-ccf-unsung-duet-row", "1");
      // 툴킷은 shadow DOM 이라 외부 CSS 가 안 먹음 → 인라인 스타일로 처리
      row.style.cssText =
        "display:flex;flex-direction:column;gap:6px;" +
        // 상단 여백을 줄여 카드 설명문과 드롭다운 사이가 너무 떨어져 보이지 않게 함
        "padding:4px 0 0 0;margin-top:4px;" +
        "border-top:1px solid rgba(255,255,255,0.08);";

      // 상단: 드롭다운(테마 선택) + ON/OFF 버튼
      const topLine = document.createElement("div");
      topLine.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px;";

      const select = document.createElement("select");
      select.id = SHEET_THEME_SELECT_TOOLKIT_ID;
      select.setAttribute("data-ccf-sheet-theme-select", "toolkit");
      select.setAttribute("aria-label", "커스텀 시트 테마 선택");
      // shadow DOM이라 외부 .ccf-theme-select 스타일이 안 먹어서 인라인으로 톤만 맞춤
      // 네이티브 select 의 쉐브론은 항상 우측 끝에 붙어 위치를 못 옮긴다.
      // 우측 여백을 주기 위해 appearance:none + 커스텀 SVG 쉐브론으로 교체하고
      // background-position 으로 쉐브론을 오른쪽 끝에서 떼어 놓는다.
      const CHEVRON_SVG =
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'>" +
        "<path d='M1 1l4 4 4-4' stroke='%23333' stroke-width='1.5' fill='none' " +
        "stroke-linecap='round' stroke-linejoin='round'/></svg>";
      select.style.cssText =
        "flex:1 1 auto;min-width:0;font-size:13px;line-height:1.3;" +
        "appearance:none;-webkit-appearance:none;-moz-appearance:none;" +
        "background-color:#ffffff;color:#222;" +
        "background-image:url(\"" + CHEVRON_SVG + "\");" +
        "background-repeat:no-repeat;background-position:right 12px center;" +
        "background-size:10px 6px;" +
        "border:1px solid rgba(0,0,0,0.2);border-radius:4px;" +
        // 우측 패딩 = 쉐브론(10px) + 우측 여백(12px) + 텍스트와 쉐브론 사이 간격(8px)
        "padding:4px 30px 4px 8px;";
      for (const theme of SHEET_THEMES) {
        const opt = document.createElement("option");
        opt.value = theme.id;
        opt.textContent = theme.name;
        select.appendChild(opt);
      }
      select.addEventListener("change", (event) => {
        event.stopPropagation();
        const value = event.currentTarget.value;
        if (!SHEET_THEMES.some((t) => t.id === value)) return;
        settings = { ...settings, selectedSheetTheme: value };
        persistSettings();
        applyDicebotAttribute();
        // 다른 테마로 전환할 때 이전 테마의 DOM 인젝션(이미지 치환 등) 흔적 정리
        revertUnsungDuetDomState();
        // 새 테마 인젝션을 즉시 재실행 — 옵저버를 기다리지 않고 기존 메시지도 처리
        reapplySheetThemeInjections();
        syncUnsungDuetToggle();
        const themeName = SHEET_THEMES.find((t) => t.id === value)?.name || value;
        setStatus(`커스텀 시트 테마: ${themeName}`, "success");
      });

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn toggle"; // 툴킷 기존 버튼 스타일 차용
      btn.setAttribute("data-ccf-unsung-duet-btn", "1");
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !isSheetThemeEnabled();
        settings = { ...settings, unsungDuetEnabled: next };
        persistSettings();
        applyDicebotAttribute();
        if (!next) revertUnsungDuetDomState();
        else reapplySheetThemeInjections();
        syncUnsungDuetToggle();
        const themeName = SHEET_THEMES.find((t) => t.id === getSelectedSheetThemeId())?.name || "";
        setStatus(
          next ? `${themeName} 테마를 활성화했습니다.` : `${themeName} 테마를 비활성화했습니다.`,
          "success"
        );
      });

      topLine.appendChild(select);
      topLine.appendChild(btn);

      // 하단: 현재 선택된 테마의 설명
      const desc = document.createElement("div");
      desc.setAttribute("data-ccf-sheet-theme-desc", "toolkit");
      desc.style.cssText = "font-size:11px;opacity:0.7;line-height:1.4;";

      row.appendChild(topLine);
      row.appendChild(desc);
      card.appendChild(row);
    }

    syncUnsungDuetToolkitToggle();
  }

  function syncUnsungDuetToolkitToggle() {
    const card = findToolkitThemeCard();
    if (!card) return;
    const btn = card.querySelector('[data-ccf-unsung-duet-btn="1"]');
    if (btn instanceof HTMLButtonElement) {
      const enabled = isSheetThemeEnabled();
      btn.textContent = enabled ? "ON" : "OFF";
      btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      btn.setAttribute("data-on", enabled ? "1" : "0");
    }
    const select = card.querySelector(`#${SHEET_THEME_SELECT_TOOLKIT_ID}`);
    const selectedId = getSelectedSheetThemeId();
    if (select instanceof HTMLSelectElement && select.value !== selectedId) {
      select.value = selectedId;
    }
    const desc = card.querySelector('[data-ccf-sheet-theme-desc="toolkit"]');
    if (desc instanceof HTMLElement) {
      const theme = SHEET_THEMES.find((t) => t.id === selectedId);
      desc.textContent = theme?.description || "";
    }
  }

  function ensureToolkitToggleWatcher() {
    const toolkitRoot = document.getElementById("capybara-toolkit-root");
    const shadow = toolkitRoot?.shadowRoot;
    if (!shadow) return;
    const body = shadow.querySelector(".body");
    if (!(body instanceof HTMLElement)) return;

    // 기존 옵저버가 같은 body 를 보고 있으면 그대로 둠
    if (toolkitToggleObserver && toolkitToggleObserverHost === body) return;
    if (toolkitToggleObserver) {
      try { toolkitToggleObserver.disconnect(); } catch (error) { /* ignore */ }
    }

    toolkitToggleObserver = new MutationObserver(() => {
      if (!ccfThemeActive) return;
      mountUnsungDuetToolkitToggle();
    });
    toolkitToggleObserver.observe(body, { childList: true, subtree: false });
    toolkitToggleObserverHost = body;

    ccfThemeRegisterTeardown(() => {
      try { toolkitToggleObserver?.disconnect(); } catch (error) { /* ignore */ }
      toolkitToggleObserver = null;
      toolkitToggleObserverHost = null;
    });

    // 옵저버 설정 직후, 이미 렌더된 카드에 한 번 인젝트
    mountUnsungDuetToolkitToggle();
  }

  // 토글 OFF 시 — 이미 채팅에 인젝트된 <img>와 마킹된 li 속성을 청소해
  // CCFOLIA 원본 메시지가 다시 텍스트 그대로 보이도록 복원.
  function revertUnsungDuetDomState() {
    document.querySelectorAll(`.${UNSUNG_DUET_IMG_CLASS}`).forEach((img) => {
      const url = img.getAttribute("src") || "";
      const alt = UNSUNG_DUET_URL_TO_ALT[url] || "";
      const parent = img.parentNode;
      if (!parent) return;
      // 가능하면 원본 [이미지](URL) 텍스트로 복원
      const restored = document.createTextNode(`[이미지](${url})`);
      parent.replaceChild(restored, img);
    });
    document.querySelectorAll(`[${UNSUNG_DUET_MSG_INJECTED_ATTR}="1"]`).forEach((el) => {
      el.removeAttribute(UNSUNG_DUET_MSG_INJECTED_ATTR);
    });
    revertCreeGrrrDomState();
  }

  // 테마 전환/토글 ON 직후 호출 — 옵저버를 기다리지 않고 기존 메시지에도 즉시
  // 새 테마의 인젝션을 적용. (옵저버는 새 mutation 에만 반응하므로 기존 메시지가
  // 누락되는 문제를 회피.)
  function reapplySheetThemeInjections() {
    try {
      bindUnsungDuetTriggerFields();
      injectUnsungDuetMessageImages();
      injectCreeGrrrDiceFormatting();
    } catch (error) { /* 인젝션 실패는 무시 — 다음 mutation 에서 재시도 */ }
  }

  // CREE-GRRR! 인젝션 복원 — 결과 숫자/상태 span 을 원래 텍스트 노드로 되돌림
  // CREE-GRRR! 카드 인젝션 복원 — 카드를 제거하고 원본 텍스트를 되돌림.
  function revertCreeGrrrDomState() {
    document.querySelectorAll(`[${CREE_GRRR_FORMATTED_ATTR}="1"]`).forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const original = el.getAttribute(CREE_GRRR_ORIGINAL_ATTR);
      if (original !== null) {
        // 내부 카드 노드 제거하고 원본 텍스트로 되돌리기
        el.textContent = original;
        el.removeAttribute(CREE_GRRR_ORIGINAL_ATTR);
      }
      // 혹시 display:none 으로 숨겨놨던 케이스 호환 복원
      if (el.style && el.style.display === "none") {
        el.style.display = "";
      }
      el.removeAttribute(CREE_GRRR_ORIGINAL_ATTR);
      el.removeAttribute(CREE_GRRR_FORMATTED_ATTR);
    });
    // 혹시 어딘가 남아 있는 카드 노드 정리 (방어적) — 스킬 카드 + 일반 카드 둘 다
    document.querySelectorAll(`.${CREE_GRRR_CARD_CLASS}, .${CREE_GRRR_SIMPLE_CARD_CLASS}`).forEach((card) => card.remove());
    cleanupLegacyCreeGrrrSpans();
  }

  // 이전 버전(v0.1.x) 이 만든 인라인 뱃지 span 잔존물을 텍스트로 복원.
  // CSS 캐시 / 옛 DOM 상태로 인해 채팅·알림 팝업에 살아 있는 경우를 청소.
  function cleanupLegacyCreeGrrrSpans() {
    const selector = `.${CREE_GRRR_ROLLRESULT_CLASS}, .${CREE_GRRR_STATUS_CLASS}`;
    document.querySelectorAll(selector).forEach((span) => {
      if (!(span instanceof HTMLElement)) return;
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent || ""), span);
    });
  }

  // CREE-GRRR!: 채팅 다이스 판정 결과를 Roll20 시트 카드로 대체.
  // 클래스 의존성을 완전히 제거하고 텍스트 노드 자체를 스캔 → 어떤 CCFOLIA 빌드든
  // 다이스 패턴이 있는 텍스트면 무조건 캡처. 텍스트 노드의 부모 요소가 host 가 되어
  // 그 안에서 카드로 교체.
  //
  // parser 가 엄격해서(target + 화살표 + 굴림값) 데미지/일반 굴림은 통과 못함.
  // 진짜 오버레이 UI(다이얼로그/메뉴/툴팁) 는 별도 제외.
  const CREE_GRRR_SKIP_ANCESTOR_SELECTOR = [
    `[role="dialog"]`,
    `[role="menu"]`,
    `[role="menuitem"]`,
    `[role="tooltip"]`,
    `.MuiTooltip-popper`,
    `.MuiDialog-paper`,
    `.MuiSnackbar-root`
  ].join(", ");
  // 텍스트 노드 사전 필터 — 다이스 명령+화살표 결과가 모두 있는 텍스트만 통과.
  // 트리거 종류:
  //   (1) CC<=N / CCB<=N / CCS<=N        — 스킬 판정 카드 (243×370)
  //   (2) (1D100<=N)                      — 스킬 판정 카드 (CC 없이 d100 만 있는 케이스)
  //   (3) \d*[dD]\d+ (일반 다이스 표기)   — 일반 다이스 카드 (간단한 원+수식)
  const CREE_GRRR_TEXT_FAST_PATTERN =
    /(CC[BS]?<=\d|\(\s*1D100\s*<=\s*\d|\d*[dD]\d+).*[→＞>]\s*\d/is;

  // 디버그용 상태 — 첫 호출 시 한 번만 진단 로그를 띄워 함수 도달 여부와
  // 테마 게이트 상태를 콘솔로 확인할 수 있게 한다. 매 mutation 마다 로그가
  // 쌓이지 않도록 일회성. console.warn 사용 (Chrome DevTools 의 기본 필터
  // 에서도 안전하게 표시되며, info 보다 시각적으로 두드러진다).
  const creeGrrrInjectState = {
    firstCallLogged: false,
    lastSampleLogged: 0,
    callCount: 0
  };

  function injectCreeGrrrDiceFormatting() {
    creeGrrrInjectState.callCount++;
    // 첫 호출 + 매 100회마다 진단 로그를 강제 출력. 함수 도달 자체를 확실히
    // 확인할 수 있게 함. (mutation 폭주로 너무 잦은 호출 방지 위해 100 단위)
    if (!creeGrrrInjectState.firstCallLogged || creeGrrrInjectState.callCount % 100 === 0) {
      try {
        const enabled = isSheetThemeEnabled();
        const themeId = getSelectedSheetThemeId();
        console.warn(
          `[CREE-GRRR!] inject reached #${creeGrrrInjectState.callCount}`,
          {
            sheetThemeEnabled: enabled,
            selectedSheetTheme: themeId,
            gatePass: enabled && themeId === "cree-grrr",
            documentHasBody: !!document.body
          }
        );
      } catch (e) {
        try { console.warn("[CREE-GRRR!] inject: first call (error reading state)", e); } catch (_) {}
      }
      creeGrrrInjectState.firstCallLogged = true;
    }

    const enabled = isSheetThemeEnabled();
    const themeId = getSelectedSheetThemeId();

    if (!enabled) return;
    if (themeId !== "cree-grrr") return;
    cleanupLegacyCreeGrrrSpans();
    if (!document.body) return;

    // 채팅 메시지 본문 후보 — CCFOLIA 빌드별로 셀렉터가 다양해서 넓게 잡는다.
    // (1) MuiTypography body1/body2 의 p/div/span 모두 후보
    // (2) 이미 처리된 노드는 제외
    // (3) 스킵 조상(다이얼로그/메뉴/툴팁) 안에 있으면 나중에 closest 로 거른다
    const candidates = document.querySelectorAll([
      `p.MuiTypography-body2:not([${CREE_GRRR_FORMATTED_ATTR}="1"])`,
      `p.MuiTypography-body1:not([${CREE_GRRR_FORMATTED_ATTR}="1"])`,
      `div.MuiTypography-body2:not([${CREE_GRRR_FORMATTED_ATTR}="1"])`,
      `div.MuiTypography-body1:not([${CREE_GRRR_FORMATTED_ATTR}="1"])`,
      `span.MuiTypography-body2:not([${CREE_GRRR_FORMATTED_ATTR}="1"])`,
      `span.MuiTypography-body1:not([${CREE_GRRR_FORMATTED_ATTR}="1"])`
    ].join(", "));

    const seen = new WeakSet();
    let scanned = 0;
    let transformed = 0;
    let fastPatternMissed = 0;
    let parserMissed = 0;
    let sampleText = "";

    candidates.forEach((host) => {
      if (!(host instanceof HTMLElement)) return;
      if (seen.has(host)) return;
      seen.add(host);
      if (host.hasAttribute(CREE_GRRR_FORMATTED_ATTR)) return;
      if (host.closest(CREE_GRRR_SKIP_ANCESTOR_SELECTOR)) return;

      const text = host.textContent || "";
      if (!text) return;
      scanned++;

      if (!CREE_GRRR_TEXT_FAST_PATTERN.test(text)) {
        // 다이스 패턴이 없는 일반 채팅 — 카운트만 (정상)
        fastPatternMissed++;
        return;
      }

      if (!sampleText) sampleText = text.slice(0, 120);

      // (a) CC<= 스킬 판정 카드 우선 시도. 매칭되면 큰 카드(243×370) 생성.
      const parsed = parseCreeGrrrDiceRoll(text);
      if (parsed) {
        transformed++;
        if (!parsed.skill) {
          try {
            console.warn("[CREE-GRRR!] skill name empty — raw text follows:", text);
          } catch (_) { /* ignore */ }
        }
        const card = buildCreeGrrrDiceCard(parsed);
        host.setAttribute(CREE_GRRR_ORIGINAL_ATTR, text);
        host.setAttribute(CREE_GRRR_FORMATTED_ATTR, "1");
        host.replaceChildren(card);
        return;
      }

      // (b) CC<= 가 아닌 일반 다이스 굴림(1D10+5, 데미지 등)은 컴팩트 카드 시도.
      const simple = parseCreeGrrrSimpleDiceRoll(text);
      if (simple) {
        transformed++;
        const card = buildCreeGrrrSimpleDiceCard(simple);
        host.setAttribute(CREE_GRRR_ORIGINAL_ATTR, text);
        host.setAttribute(CREE_GRRR_FORMATTED_ATTR, "1");
        host.replaceChildren(card);
        return;
      }

      // 어느 쪽도 매칭 안 됨
      parserMissed++;
    });

    // 다이스 패턴은 보였는데 파싱이 실패했거나, 변환이 일어났을 때만 로그.
    // (일반 채팅만 들어와서 fastPatternMissed 만 잔뜩 쌓이는 경우는 조용히 무시.)
    if (transformed > 0 || parserMissed > 0) {
      const now = Date.now();
      if (now - creeGrrrInjectState.lastSampleLogged > 250) {
        creeGrrrInjectState.lastSampleLogged = now;
        try {
          console.info(
            `[CREE-GRRR!] dice cards: candidates=${candidates.length} scanned=${scanned} ` +
            `noPattern=${fastPatternMissed} parserMissed=${parserMissed} transformed=${transformed}` +
            (sampleText ? `\n  sample: ${sampleText}` : "")
          );
        } catch (_) { /* ignore */ }
      }
    }
  }

  // CoC 7판 판정 메시지 파싱.
  //   입력 예: "CC<=60 건강 (1D100<=60) 보너스, 패널티 주사위[0] ＞ 43 ＞ 43 ＞ 보통 성공"
  //   반환: { skill, target, halfTarget, fifthTarget, rollValue, status, statusKind }
  //   매칭 실패 시 null (카드 미생성, 메시지 원본 유지).
  function parseCreeGrrrDiceRoll(text) {
    if (!text || typeof text !== "string") return null;

    // 판정기준 (target): CC<=N 우선, 없으면 (1D100<=N) 에서 추출
    let target = null;
    const ccMatch = text.match(/CC[BS]?<=(\d+)/i);
    const d100Match = text.match(/\(\s*1D100\s*<=\s*(\d+)\s*\)/i);
    const targetSource = ccMatch || d100Match;
    if (targetSource) target = parseInt(targetSource[1], 10);
    if (target === null || !Number.isFinite(target) || target < 1) return null;

    // 스킬명 — "CC<=N <skill> (1D100<=N)" 형식이 BCDice 표준 출력.
    // 스킬명에 괄호가 포함될 수 있음 (예: "교육(지식)", "심리학(인간)") 이므로
    // 이전의 [^()]+? 는 부적합. `.+?` 로 모든 문자 허용하되 종료 마커를
    // `\(\s*1D100\s*<=` 로 잡아 후속 매칭이 깨지지 않게 한다.
    // 또한 CCFOLIA 가 메시지에 삽입하는 zero-width 문자(U+200B~U+200F, U+2060,
    // U+FEFF, U+2028~U+202F)는 모두 제거.
    let skill = "";
    const skillBetween = text.match(/CC[BS]?<=\d+\s+(.+?)\s*\(\s*1D100\s*<=/i);
    if (skillBetween) {
      skill = skillBetween[1]
        .replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/g, "")
        .trim();
    }
    if (!skill) {
      // (2) prefix 케이스: 줄 시작부터 CC<=N 직전까지의 텍스트 중 마지막 단어구.
      //     예: "진천: 법률 CC<=5 (1D100<=5) ..." → "법률"
      //     채팅 닉네임/콜론 등은 마지막 ':' 이후 부분만 사용.
      const prefixMatch = text.match(/^([^\n]*?)\s*CC[BS]?<=/i);
      if (prefixMatch) {
        let prefix = prefixMatch[1]
          .replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/g, "");
        const lastColon = Math.max(prefix.lastIndexOf(":"), prefix.lastIndexOf("："));
        if (lastColon >= 0) prefix = prefix.slice(lastColon + 1);
        prefix = prefix.trim().replace(/^["“'‘<\[]+|["”'’>\]]+$/g, "").trim();
        // 닉네임 같은 너무 긴 prefix 는 스킬명으로 안 쳐도 됨 (20자 이하만)
        if (prefix && prefix.length <= 20 && !/^\d+$/.test(prefix)) {
          skill = prefix;
        }
      }
    }
    // (3) trailing 전략은 "보너스, 패널티 주사위" 같은 BCDice 정형 텍스트를
    //     오인식할 위험이 커서 제거. 위 (1)(2) 가 실패하면 스킬명 비움.

    // 굴림값 (rollValue): 모든 "＞/>/→ N" 중 마지막 숫자 (보너스/페널티 적용 후 최종값)
    const arrowRe = new RegExp(CREE_GRRR_ARROW_CLASS + "\\s*(\\d+)(?!\\d)", "g");
    const rolls = [];
    let am;
    while ((am = arrowRe.exec(text)) !== null) {
      const n = parseInt(am[1], 10);
      if (n >= 1 && n <= 100) rolls.push(n);
    }
    if (rolls.length === 0) return null;
    const rollValue = rolls[rolls.length - 1];

    // 판정단계: 메시지 끝쪽의 마지막 상태 키워드
    const statusRe = new RegExp(
      CREE_GRRR_ARROW_CLASS + "\\s*(" + CREE_GRRR_STATUS_ALT + ")",
      "g"
    );
    const statusMatches = [...text.matchAll(statusRe)];
    const rawStatus = statusMatches.length > 0
      ? statusMatches[statusMatches.length - 1][1].replace(/\s+/g, " ").trim()
      : null;
    const status = rawStatus ? mapCcfStatusToCreeGrrr(rawStatus, rollValue) : null;
    const statusKind = classifyCreeGrrrStatus(status);

    return {
      skill,
      target,
      halfTarget: Math.floor(target / 2),
      fifthTarget: Math.floor(target / 5),
      rollValue,
      status,
      statusKind
    };
  }

  // 표시할 판정단계가 성공류인지 실패류인지 분류 (텍스트 색상용).
  function classifyCreeGrrrStatus(status) {
    if (!status) return "neutral";
    if (/(실패|펌블)/.test(status)) return "fail";
    return "success";
  }

  // 카드 DOM 생성 — 스킬명·3개 작은 원·큰 중앙 원·상태 텍스트.
  function buildCreeGrrrDiceCard(parsed) {
    const card = document.createElement("div");
    card.className = CREE_GRRR_CARD_CLASS;

    if (parsed.skill) {
      const skillEl = document.createElement("div");
      skillEl.className = `${CREE_GRRR_CARD_CLASS}__skill`;
      skillEl.textContent = parsed.skill;
      card.appendChild(skillEl);
    }

    const targets = document.createElement("div");
    targets.className = `${CREE_GRRR_CARD_CLASS}__targets`;
    for (const value of [parsed.target, parsed.halfTarget, parsed.fifthTarget]) {
      const t = document.createElement("span");
      t.className = `${CREE_GRRR_CARD_CLASS}__target`;
      t.textContent = String(value);
      targets.appendChild(t);
    }
    card.appendChild(targets);

    const result = document.createElement("div");
    result.className = `${CREE_GRRR_CARD_CLASS}__result`;
    result.textContent = String(parsed.rollValue);
    card.appendChild(result);

    if (parsed.status) {
      const statusEl = document.createElement("div");
      statusEl.className =
        `${CREE_GRRR_CARD_CLASS}__status ${CREE_GRRR_CARD_CLASS}__status--${parsed.statusKind}`;
      statusEl.textContent = parsed.status;
      card.appendChild(statusEl);
    }

    return card;
  }

  // 일반 다이스 굴림 파싱 (CC<= 가 아닌 모든 다이스 결과).
  //   입력 예: "(1D10+33+1D5) ＞ 5[1D10]+33+3[1D5] ＞ 41"
  //           "1D100 ＞ 84"
  //           "(2D6) ＞ 5+3 ＞ 8"
  //   반환: { formula: "1D10+33+1D5", result: 41 } 또는 null
  //   CC<= 또는 (1D100<=N) 이 포함된 텍스트는 스킬 판정 카드 쪽으로 양보.
  function parseCreeGrrrSimpleDiceRoll(text) {
    if (!text || typeof text !== "string") return null;
    // CC<= 스킬 판정/d100 판정은 스킬 카드 쪽에서 처리하므로 여기선 양보
    if (/CC[BS]?<=\d/i.test(text)) return null;
    if (/\(\s*1D100\s*<=\s*\d/i.test(text)) return null;

    // 다이스 수식 매칭 — NdM 형태(+/-/* 로 연결된 추가 항 포함).
    // 시도 우선순위:
    //   1. "(formula)" 처럼 괄호로 둘러싸인 BCDice 명령부 우선
    //   2. 없으면 첫 등장하는 NdM 토큰부터 수식 끝까지
    const cleaned = text.replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/g, "");

    let formula = "";
    const parenForm = cleaned.match(/\(\s*(\d*[dD]\d+(?:\s*[+\-*\/]\s*(?:\d+|\d*[dD]\d+))*)\s*\)/);
    if (parenForm) {
      formula = parenForm[1].replace(/\s+/g, "");
    } else {
      const bareForm = cleaned.match(/(\d*[dD]\d+(?:\s*[+\-*\/]\s*(?:\d+|\d*[dD]\d+))*)/);
      if (bareForm) formula = bareForm[1].replace(/\s+/g, "");
    }
    if (!formula) return null;

    // 최종 결과 — 마지막 화살표 뒤 숫자
    const arrowRe = new RegExp(CREE_GRRR_ARROW_CLASS + "\\s*(\\d+)(?!\\d)", "g");
    const rolls = [];
    let m;
    while ((m = arrowRe.exec(cleaned)) !== null) {
      rolls.push(parseInt(m[1], 10));
    }
    if (rolls.length === 0) return null;
    const result = rolls[rolls.length - 1];

    return { formula, result };
  }

  // 일반 다이스 카드 DOM — 좌측 원형 결과값 + 우측 수식 라벨.
  function buildCreeGrrrSimpleDiceCard(parsed) {
    const card = document.createElement("div");
    card.className = CREE_GRRR_SIMPLE_CARD_CLASS;

    const resultEl = document.createElement("div");
    resultEl.className = `${CREE_GRRR_SIMPLE_CARD_CLASS}__result`;
    resultEl.textContent = String(parsed.result);
    card.appendChild(resultEl);

    const formulaEl = document.createElement("div");
    formulaEl.className = `${CREE_GRRR_SIMPLE_CARD_CLASS}__formula`;
    formulaEl.textContent = `${parsed.formula} Roll`;
    card.appendChild(formulaEl);

    return card;
  }

  // CCFOLIA 판정 텍스트 → CREE-GRRR! 시트(Roll20) 표시 명칭 매핑.
  //   대실패          → 대실패        (단, d100 결과가 100 이면 "펌블")
  //   실패            → 실패         (단, d100 결과가 96~99 이면 "치명적 실패")
  //   보통 성공       → 성공
  //   어려운 성공     → 어려운 성공
  //   대단한 성공     → 극단적 성공
  //   대성공          → 스페셜       (단, d100 결과가 1 이면 "크리티컬")
  function mapCcfStatusToCreeGrrr(ccfTerm, rollValue) {
    if (typeof ccfTerm !== "string") return ccfTerm;
    const normalized = ccfTerm.replace(/\s+/g, "");
    switch (normalized) {
      case "대실패":      return rollValue === 100 ? "펌블" : "대실패";
      case "실패":
        return (rollValue !== null && rollValue >= 96 && rollValue <= 99)
          ? "치명적 실패"
          : "실패";
      case "보통성공":    return "성공";
      case "어려운성공":  return "어려운 성공";
      case "대단한성공":  return "극단적 성공";
      case "대성공":      return rollValue === 1 ? "크리티컬" : "스페셜";
      default:            return ccfTerm;
    }
  }

  function bindUnsungDuetTriggerFields() {
    // dicebot이 unsung-duet일 때만 신규 필드 바인딩 — 다른 다이스봇일 땐 사이드 이펙트 없음
    if (getCurrentDicebotId() !== "unsung-duet") return;
    const selector = [
      `textarea:not([${UNSUNG_DUET_FIELD_BOUND_ATTR}="1"])`,
      `input[type="text"]:not([${UNSUNG_DUET_FIELD_BOUND_ATTR}="1"])`,
      `input[type="search"]:not([${UNSUNG_DUET_FIELD_BOUND_ATTR}="1"])`,
      `input:not([type]):not([${UNSUNG_DUET_FIELD_BOUND_ATTR}="1"])`
    ].join(", ");
    document.querySelectorAll(selector).forEach((field) => {
      if (field instanceof HTMLElement) bindUnsungDuetField(field);
    });
  }

  // 채팅 로그 메시지에서 알려진 imgur URL을 <img>로 인라인 치환.
  // CCFOLIA가 메시지 텍스트 내 URL을 자동 임베드하지 않기 때문에 클라이언트
  // 쪽에서 DOM에 직접 이미지 요소를 끼워 넣어 시각적으로 보이게 한다.
  //
  // 인식하는 패턴 (모두 처리):
  //   1) [이미지](https://i.imgur.com/XXXX.png) - 마크다운 링크 텍스트
  //   2) <a href="https://i.imgur.com/XXXX.png">…</a> - 렌더된 링크 요소
  //   3) https://i.imgur.com/XXXX.png - raw URL 텍스트
  function injectUnsungDuetMessageImages() {
    if (getCurrentDicebotId() !== "unsung-duet") return;

    // 채팅 메시지가 들어 있을 수 있는 가능한 모든 컨테이너의 li를 스캔
    // (CCFOLIA의 채팅 영역은 빌드/버전에 따라 다양한 셀렉터를 가질 수 있음)
    const messages = document.querySelectorAll(
      `li:not([${UNSUNG_DUET_MSG_INJECTED_ATTR}="1"])`
    );

    let anyInjected = false;
    messages.forEach((message) => {
      if (!(message instanceof HTMLElement)) return;

      // 빠른 사전 필터: 메시지 텍스트에 알려진 URL 일부 또는 [이미지](가 포함되어 있는지
      const text = message.textContent || "";
      if (!hasUnsungDuetSignal(text) && !hasUnsungDuetAnchor(message)) return;

      const replacedText = replaceTextNodesWithImages(message);
      const replacedAnchor = replaceAnchorsWithImages(message);
      if (replacedText || replacedAnchor) {
        message.setAttribute(UNSUNG_DUET_MSG_INJECTED_ATTR, "1");
        anyInjected = true;
      }
    });

    if (anyInjected) markUnsungDuetCutinActive();
  }

  function hasUnsungDuetSignal(text) {
    if (!text) return false;
    if (text.indexOf("[이미지](") >= 0) return true;
    for (const url of Object.values(UNSUNG_DUET_URLS)) {
      if (text.indexOf(url) >= 0) return true;
    }
    for (const trigger of Object.keys(UNSUNG_DUET_URLS)) {
      if (text.indexOf(trigger) >= 0) return true;
    }
    return false;
  }

  function hasUnsungDuetAnchor(root) {
    if (!(root instanceof HTMLElement)) return false;
    const anchors = root.querySelectorAll("a[href]");
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (UNSUNG_DUET_URL_TO_ALT[href]) return true;
    }
    return false;
  }

  function replaceAnchorsWithImages(root) {
    if (!(root instanceof HTMLElement)) return false;
    const anchors = [...root.querySelectorAll("a[href]")];
    let modified = false;
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      const alt = UNSUNG_DUET_URL_TO_ALT[href];
      if (!alt) continue;
      const img = createUnsungDuetImage(href, alt);
      a.parentNode?.replaceChild(img, a);
      modified = true;
    }
    return modified;
  }

  function createUnsungDuetImage(url, alt) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt || "";
    img.className = UNSUNG_DUET_IMG_CLASS;
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    return img;
  }

  // === YouTube pauseVideo 명령 가로채기 ==================================
  // 이전 접근(다중 playVideo 호출)은 BGM과 동시 재생은 성공했지만 컷인 종료 후
  // CCFOLIA 내부 BGM 컨트롤러 상태가 desync 되는 부작용이 있었음(BGM01 폰트색
  // 변경, 빨강 뱃지 사라짐, 재생바 미복귀). 그래서 접근을 바꿔서: CCFOLIA가
  // 애초에 YouTube iframe에 pauseVideo 명령을 보내지 못하게 가로챈다.
  // 이렇게 하면 CCFOLIA 컨트롤러는 BGM이 계속 재생 중이라고 인식하므로 desync 없음.
  function findYouTubeIframes() {
    return document.querySelectorAll([
      'iframe[src*="youtube.com/embed"]',
      'iframe[src*="youtube-nocookie.com/embed"]',
      'iframe[src*="youtube.com/watch"]'
    ].join(", "));
  }

  function isYouTubeContentWindow(win) {
    const iframes = findYouTubeIframes();
    for (const iframe of iframes) {
      if (iframe instanceof HTMLIFrameElement && iframe.contentWindow === win) {
        return true;
      }
    }
    return false;
  }

  // 컷인 활성 윈도우 — 트리거 메시지가 발생/감지된 직후 N초간만 pauseVideo 차단.
  // 평소(컷인이 없는 일반 상황)에는 사용자가 BGM을 수동 일시정지하면 정상 작동.
  let unsungDuetCutinActiveUntil = 0;
  const UNSUNG_DUET_CUTIN_WINDOW_MS = 7000;

  function markUnsungDuetCutinActive() {
    if (getCurrentDicebotId() !== "unsung-duet") return;
    unsungDuetCutinActiveUntil = Date.now() + UNSUNG_DUET_CUTIN_WINDOW_MS;
  }

  function isUnsungDuetCutinActive() {
    return Date.now() < unsungDuetCutinActiveUntil;
  }

  function installYouTubePauseInterceptor() {
    if (window.__ccfUnsungDuetPauseInterceptorInstalled) return;
    window.__ccfUnsungDuetPauseInterceptorInstalled = true;

    const originalPostMessage = Window.prototype.postMessage;
    Window.prototype.postMessage = function (message, ...rest) {
      try {
        // 다이스봇이 언성 듀엣이고, 컷인 활성 윈도우 안이며,
        // 타깃이 YouTube iframe contentWindow일 때만 pauseVideo 차단
        if (
          this !== window &&
          getCurrentDicebotId() === "unsung-duet" &&
          isUnsungDuetCutinActive() &&
          isYouTubeContentWindow(this) &&
          typeof message === "string"
        ) {
          const parsed = JSON.parse(message);
          if (parsed && parsed.event === "command" && parsed.func === "pauseVideo") {
            return; // pauseVideo 차단
          }
        }
      } catch (error) { /* JSON 파싱 실패 등 — 정상 흐름으로 통과 */ }
      return originalPostMessage.apply(this, [message, ...rest]);
    };

    ccfThemeRegisterTeardown(() => {
      try { Window.prototype.postMessage = originalPostMessage; }
      catch (error) { /* prototype 복원 실패 무시 */ }
      window.__ccfUnsungDuetPauseInterceptorInstalled = false;
    });
  }

  // 채팅 메시지 텍스트에서 매칭할 패턴 — 세 형태 모두 처리:
  //   그룹1: [이미지](URL) 안의 URL
  //   그룹2: raw URL
  //   그룹3: 【…】 트리거 텍스트 (CCFOLIA 다이스봇이 원문을 그대로 echo back할 때)
  const UNSUNG_DUET_TEXT_PATTERN = /\[이미지\]\((https:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.png)\)|(https:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.png)|(【(?:시프터 판정|바인더 판정|프래그먼트 효과|이계화)】)/g;

  function replaceTextNodesWithImages(root) {
    if (!(root instanceof HTMLElement)) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent) return NodeFilter.FILTER_REJECT;
        const parent = node.parentNode;
        if (parent instanceof HTMLElement) {
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "IMG" || tag === "A") {
            // <a> 안의 텍스트는 별도 replaceAnchorsWithImages 로 처리
            return NodeFilter.FILTER_REJECT;
          }
        }
        // 알려진 URL / [이미지]( / 【…】 트리거 텍스트 중 하나라도 있는지 사전 필터
        const t = node.textContent;
        if (t.indexOf("[이미지](") >= 0) return NodeFilter.FILTER_ACCEPT;
        for (const url of Object.keys(UNSUNG_DUET_URL_TO_ALT)) {
          if (t.indexOf(url) >= 0) return NodeFilter.FILTER_ACCEPT;
        }
        for (const trigger of Object.keys(UNSUNG_DUET_URLS)) {
          if (t.indexOf(trigger) >= 0) return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    });

    const targets = [];
    let current;
    while ((current = walker.nextNode())) {
      targets.push(current);
    }
    if (targets.length === 0) return false;

    let modified = false;
    for (const textNode of targets) {
      const text = textNode.textContent || "";
      UNSUNG_DUET_TEXT_PATTERN.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let foundAny = false;
      let match;
      while ((match = UNSUNG_DUET_TEXT_PATTERN.exec(text)) !== null) {
        // URL 매칭 (그룹1·2) 또는 트리거 텍스트 매칭 (그룹3) — 어느 쪽이든 URL로 정규화
        let url = match[1] || match[2];
        let alt = url ? UNSUNG_DUET_URL_TO_ALT[url] : "";
        if (!url && match[3]) {
          url = UNSUNG_DUET_URLS[match[3]] || "";
          alt = match[3].replace(/[【】]/g, "");
        }
        if (!url) continue;
        foundAny = true;
        if (match.index > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
        }
        fragment.appendChild(createUnsungDuetImage(url, alt));
        cursor = match.index + match[0].length;
      }
      if (!foundAny) continue;
      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }

      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(fragment, textNode);
        modified = true;
      }
    }
    return modified;
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
          if (element instanceof HTMLElement) {
            element.style.removeProperty("--ccf-theme-anchor-height");
          }
          element.removeAttribute(ANCHOR_ATTR);
        }
      });
      anchor.setAttribute(ANCHOR_ATTR, "1");
      anchor.setAttribute(APPBAR_ATTR, "1");
      if (toggle.parentElement !== document.body) {
        document.body.appendChild(toggle);
      }
      toggle.hidden = false;
      positionToggleAtAnchor(toggle, anchor);
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

  function updateTogglePosition() {
    const toggle = getToggle();
    if (!(toggle instanceof HTMLElement) || toggle.hidden) return;
    const anchor = resolveDicebotAnchor(toggle);
    if (!anchor) {
      toggle.hidden = true;
      if (isPanelOpen()) {
        setPanelOpen(false);
      }
      return;
    }
    positionToggleAtAnchor(toggle, anchor);
  }

  function positionToggleAtAnchor(toggle, anchor) {
    if (!(toggle instanceof HTMLElement) || !(anchor instanceof HTMLElement)) return false;

    const rect = anchor.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.height <= 0) return false;

    const maxLeft = Math.max(0, window.innerWidth - TOGGLE_SIZE);
    const maxTop = Math.max(0, window.innerHeight - TOGGLE_SIZE);
    const left = clamp(rect.right - TOGGLE_SIZE - TOGGLE_ANCHOR_INSET, 0, maxLeft);
    const top = clamp(rect.top + ((rect.height - TOGGLE_SIZE) / 2), 0, maxTop);

    toggle.style.left = `${Math.round(left)}px`;
    toggle.style.top = `${Math.round(top)}px`;
    return true;
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
      if (!ccfThemeActive) return;
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
      if (!ccfThemeActive) return;
      updatePanelPosition();
    });
  }

  function queueTogglePositionUpdate() {
    if (toggleLayoutFrame) return;
    toggleLayoutFrame = window.requestAnimationFrame(() => {
      toggleLayoutFrame = 0;
      if (!ccfThemeActive) return;
      updateTogglePosition();
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
      if (!ccfThemeActive) return;
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
      savedThemes: [],
      // 시트 테마 마스터 ON/OFF (레거시 호환 위해 unsungDuetEnabled 키 유지)
      unsungDuetEnabled: true,
      // 드롭다운으로 선택된 커스텀 시트 테마 id (SHEET_THEMES.id 중 하나)
      selectedSheetTheme: DEFAULT_SHEET_THEME_ID
    };
  }

  function normalizeSettings(value) {
    const base = createDefaultSettings();
    const savedThemes = normalizeSavedThemes(value?.savedThemes);
    const nextMode = normalizeMode(value?.mode, savedThemes);
    const sheetThemeId = SHEET_THEMES.some((t) => t.id === value?.selectedSheetTheme)
      ? value.selectedSheetTheme
      : DEFAULT_SHEET_THEME_ID;
    return {
      mode: nextMode,
      defaultTheme: normalizeOptionalTheme(value?.defaultTheme),
      defaultThemeVersion: Number.isInteger(value?.defaultThemeVersion) ? value.defaultThemeVersion : 0,
      customTheme: normalizeTheme(value?.customTheme || value?.theme || base.customTheme),
      savedThemes,
      unsungDuetEnabled: typeof value?.unsungDuetEnabled === "boolean" ? value.unsungDuetEnabled : true,
      selectedSheetTheme: sheetThemeId
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
        if (!ccfThemeActive) return;
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
