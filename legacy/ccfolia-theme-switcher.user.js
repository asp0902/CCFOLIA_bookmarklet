// ==UserScript==
// @name         CCF Theme Switcher by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-theme-switcher
// @version      0.2.16
// @description  Adds a theme switcher panel, custom color themes, and theme import/export tools to CCFOLIA.
// @description:ko CCFOLIA???뚮쭏 ?꾪솚 ?⑤꼸, ?ъ슜??吏???됱긽 ?뚮쭏, ?뚮쭏 媛?몄삤湲??대낫?닿린 湲곕뒫??異붽??⑸땲??
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
    "?몄꽦 ???: "unsung-duet",
    // CCFOLIA ?쒓뎅??UI?먯꽌??"?ы댋猷⑥쓽 遺由?7?? ?쇰줈 ?쒓린??
    // ?곷Ц ?쒓린??媛숈씠 ?깅줉 (?ㅺ뎅??UI / BCDice ?먮Ц ?쒓린 ???.
    "?ы댋猷⑥쓽 遺由?7??: "cree-grrr",
    "Call of Cthulhu 7th Edition": "cree-grrr"
  });

  // ?ъ슜?먭? "?뚮쭏 而ㅼ뒪?" 移대뱶???쒕∼?ㅼ슫?먯꽌 ?좏깮 媛?ν븳 而ㅼ뒪? ?쒗듃 ?뚮쭏 紐⑸줉.
  // 媛??뚮쭏??CCFOLIA???뱀젙 ?ㅼ씠?ㅻ큸 ?대쫫怨?留ㅽ븨?섎ŉ, ?ㅼ씠?ㅻ큸???쇱튂 + ?대떦 ?뚮쭏媛
  // ON ?곹깭???뚮쭔 ?곸슜?쒕떎. (CSS??buildDicebotStyleSheet?먯꽌 dicebot id濡??ㅼ퐫?꾨맖)
  // "none" ? ?대뼡 ?ㅼ씠?ㅻ큸怨쇰룄 留ㅼ묶?섏? ?딅뒗 sentinel ???좏깮 ???대뼡 而ㅼ뒪? ?쒗듃??
  // ?곸슜?섏? ?딆쓬 (= ?ъ씠??湲곕낯 ?곹깭濡??섎룎由?
  const SHEET_THEME_NONE_ID = "none";
  const SHEET_THEMES = Object.freeze([
    Object.freeze({
      id: SHEET_THEME_NONE_ID,
      name: "湲곕낯",
      description: "而ㅼ뒪? ?쒗듃瑜??곸슜?섏? ?딆뒿?덈떎."
    }),
    Object.freeze({
      id: "unsung-duet",
      name: "?몄꽦 ???,
      description: "?몄꽦 ???猷몄슜 / ?앹뾽 ?붿옄?맞룻듃由ш굅 ?대?吏쨌BGM 蹂댄샇 ?쇨큵 ?곸슜"
    }),
    Object.freeze({
      id: "cree-grrr",
      name: "CREE-GRRR!",
      description: "CREE-GRRR! ?쒗듃??/ ?앹뾽쨌梨꾪똿 ?ㅼ씠??寃곌낵(?먰삎/源껊컻 ?대?吏) ?붿옄??
    })
  ]);
  // ?좉퇋 ?쒖꽦???ъ슜?먯쓽 而ㅼ뒪? ?쒗듃 ?뚮쭏 湲곕낯 ?좏깮媛? ?ъ슜?먭? ?쒕∼?ㅼ슫?먯꽌 紐낆떆?곸쑝濡?
  // ?ㅻⅨ ?뚮쭏瑜?怨⑤씪 ??ν븳 寃쎌슦 (selectedSheetTheme媛 SHEET_THEMES.id 以??섎굹? ?쇱튂) ??
  // normalizeSettings 媛 洹?媛믪쓣 洹몃?濡?蹂댁〈?쒕떎.
  const DEFAULT_SHEET_THEME_ID = SHEET_THEME_NONE_ID;
  const SHEET_THEME_SELECT_PANEL_ID = "ccf-theme-switcher-sheet-theme-select-panel";

  // CREE-GRRR! 梨꾪똿 ?ㅼ씠??寃곌낵 ?몄젥??留덉빱 / ?대옒??
  const CREE_GRRR_FORMATTED_ATTR = "data-ccf-cree-grrr-formatted";
  const CREE_GRRR_MESSAGE_ROW_ATTR = "data-ccf-cree-grrr-message-row";
  const CREE_GRRR_ROLLRESULT_CLASS = "ccf-cree-grrr-rollresult";
  const CREE_GRRR_STATUS_CLASS = "ccf-cree-grrr-result-status";
  // ?ㅼ씠??移대뱶 ??Roll20 sheet-rolltemplate-coc ? ?숈씪??移대뱶 ?덉씠?꾩썐 (CC<= ?먯젙??
  const CREE_GRRR_CARD_CLASS = "ccf-cree-grrr-dicecard";
  // ?쇰컲 ?ㅼ씠??移대뱶 ??CC<= 媛 ?꾨땶 ?쇰컲 援대┝(1D10+5, ?곕?吏 援대┝ ?? ??而댄뙥??移대뱶
  const CREE_GRRR_SIMPLE_CARD_CLASS = "ccf-cree-grrr-simpledicecard";
  const CREE_GRRR_ORIGINAL_ATTR = "data-ccf-cree-grrr-original";
  // ?몄떇???먯젙 寃곌낵 ?곹깭 ?ㅼ썙????CCFOLIA(CoC 7??BCDice) 媛 ?ㅼ젣濡?異쒕젰?섎뒗 ?띿뒪??
  // CREE-GRRR! ?쒗듃(Roll20)???ㅻⅨ 紐낆묶???곕?濡?留ㅼ묶???ㅼ쓬 mapCcfStatusToCreeGrrr 濡?
  // Roll20 紐낆묶(?ㅽ럹???щ━?곗뺄/洹밸떒???깃났/...) ?쇰줈 移섑솚??諭껋????쒖떆?쒕떎.
  const CREE_GRRR_STATUS_TOKENS = Object.freeze([
    "??ㅽ뙣",
    "?ㅽ뙣",
    "蹂댄넻 ?깃났",
    "?대젮???깃났",
    "??⑦븳 ?깃났",
    "??깃났"
  ]);
  // ?ㅼ씠?ㅻ큸 異쒕젰???붿궡??援щ텇????BCDice ????U+2192), 竊?U+FF1E), ?쇰컲 > 紐⑤몢 ?ъ슜.
  // (=??"1D100<=50" 媛숈? ?섏떇 ?덉뿉?쒕룄 ?깆옣??d100 寃곌낵濡??ㅼ씤?섎?濡??쒖쇅)
  const CREE_GRRR_ARROW_CLASS = "[\\u2192\\uFF1E>]";
  // ?⑦꽩: (1) "??73" 寃곌낵 ?レ옄, (2) "??蹂댄넻 ?깃났" ?먮뒗 (3) "(蹂댄넻 ?깃났)" ?곹깭 ?ㅼ썙??
  // ?ㅼ썙?쒕뒗 湲몄씠 ?대┝李⑥닚?쇰줈 ?뺣젹??"蹂댄넻 ?깃났" ??"?깃났" 蹂대떎 癒쇱? 留ㅼ묶?섎룄濡???
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

  // ?몄꽦 ??? 梨꾪똿 ?몃━嫄??띿뒪????Roll20 ?쒗듃??rolltemplate ?대?吏.
  // CCFOLIA??raw URL???먮룞 ?꾨쿋?쒗븯吏 ?딆쑝誘濡?留덊겕?ㅼ슫 留곹겕 ?뺥깭濡?諛쒖넚.
  // ?숈떆???대씪?댁뼵??痢≪뿉??DOM ?몄젥?섏쑝濡?<img>濡?移섑솚???쒓컖?곸쑝濡?蹂댁씠寃???
  const UNSUNG_DUET_URLS = Object.freeze({
    "?먯떆?꾪꽣 ?먯젙??: "https://i.imgur.com/FFUXgYg.png",
    "?먮컮?몃뜑 ?먯젙??: "https://i.imgur.com/Jt8hw3i.png",
    "?먰봽?섍렇癒쇳듃 ?④낵??: "https://i.imgur.com/dcMRZ62.png",
    "?먯씠怨꾪솕??: "https://i.imgur.com/cfVWYGn.png"
  });
  // ?몃━嫄???諛쒖넚 硫붿떆吏???ㅼ뼱媛??띿뒪??([?대?吏](URL) ?뺥깭)
  const UNSUNG_DUET_TRIGGER_MAP = Object.freeze(
    Object.fromEntries(
      Object.entries(UNSUNG_DUET_URLS).map(([k, url]) => [k, `[?대?吏](${url})`])
    )
  );
  const UNSUNG_DUET_FIELD_BOUND_ATTR = "data-ccf-unsung-duet-bound";
  const UNSUNG_DUET_TOGGLE_ID = "ccf-theme-switcher-unsung-duet-toggle";
  const UNSUNG_DUET_MSG_INJECTED_ATTR = "data-ccf-unsung-duet-msg-injected";
  const UNSUNG_DUET_IMG_CLASS = "ccf-unsung-duet-msg-img";
  const CUTIN_VOLUME_BOUND_ATTR = "data-ccf-cutin-volume-bound";
  const CUTIN_VOLUME_LEGACY_HELPER_CLASS = "ccf-cutin-volume-helper";
  const CUTIN_VOLUME_STORAGE_KEY = "ccf-theme-cutin-volume-absolute-v1";
  const CUTIN_VOLUME_APPLY_WINDOW_MS = 10000;
  const CUTIN_VOLUME_APPLY_DELAYS_MS = Object.freeze([0, 16, 80, 200, 500]);
  // 而룹씤 ?뚮━ 利앺룺 (media.volume ?곹븳 1???섎뒗 遺?ㅽ듃, WebAudio GainNode)
  const CUTIN_BOOST_HELPER_CLASS = "ccf-cutin-boost-helper";
  const CUTIN_BOOST_STORAGE_KEY = "ccf-theme-cutin-boost-v1";
  const CUTIN_BOOST_MAX = 4;
  // ?뚮젮吏?URL ??alt ?띿뒪??留ㅽ븨 (??갑???몄떇??
  const UNSUNG_DUET_URL_TO_ALT = Object.freeze({
    "https://i.imgur.com/FFUXgYg.png": "?쒗봽???먯젙",
    "https://i.imgur.com/Jt8hw3i.png": "諛붿씤???먯젙",
    "https://i.imgur.com/dcMRZ62.png": "?꾨옒洹몃㉫???④낵",
    "https://i.imgur.com/cfVWYGn.png": "?닿퀎??
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
    { key: "bg", label: "諛곌꼍" },
    { key: "appbar", label: "?곹븯??諛? },
    { key: "paper", label: "?⑤꼸" },
    { key: "border", label: "?뚮몢由? },
    { key: "text", label: "?띿뒪?? },
    { key: "inputBg", label: "?낅젰李? }
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
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_THEME_SWITCHER_SCRIPT_INFO = Object.freeze({
    id: "ccf-theme-switcher",
    name: "CCF Theme Switcher",
    version: getUserscriptVersion("0.2.15"),
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-theme-switcher"
  });

  const ccfThemeLifecycle = createLegacyLifecycle(CCF_THEME_SWITCHER_SCRIPT_INFO, {
    debugKey: "__CCF_THEME_SWITCHER_DEBUG__",
    onTeardown() {
      if (toggleLayoutFrame) {
        try { window.cancelAnimationFrame(toggleLayoutFrame); } catch (error) { /* raf cleanup failed */ }
        toggleLayoutFrame = 0;
      }
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
        `[${CREE_GRRR_MESSAGE_ROW_ATTR}]`,
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
        el.removeAttribute(CREE_GRRR_MESSAGE_ROW_ATTR);
        el.removeAttribute(CREE_GRRR_ORIGINAL_ATTR);
      });
    }
  });
  const ccfThemeSignal = ccfThemeLifecycle.signal;
  const ccfThemeRegisterTeardown = (fn) => ccfThemeLifecycle.registerTeardown(fn);
  const ccfThemeWithSignal = (options) => ccfThemeLifecycle.withSignal(options);
  const ccfThemeTeardown = () => ccfThemeLifecycle.disable();

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
      } catch (error) { /* suite ?깅줉 ?ㅽ뙣 臾댁떆 */ }
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

  ccfThemeLifecycle.installDebugApi();

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
  let cutinVolumeAbsolutePatchInstalled = false;
  let cutinVolumeAbsoluteLastValue = null;
  let cutinVolumeAbsoluteApplyUntil = 0;
  const cutinVolumeAbsoluteBySource = new Map();
  const cutinVolumeApplyingMedia = new WeakSet();
  let cutinBoostLastValue = 1;
  const cutinBoostBySource = new Map();
  const cutinBoostGraphs = new WeakMap();
  let cutinBoostAudioCtx = null;

  // 紐⑤뱢 濡쒕뱶 ?뺤젙 濡쒓렇. ??濡쒓렇議곗감 肄섏넄????蹂댁씠硫??ㅽ겕由쏀듃 ?먯껜媛 GitHub
  // Pages ?먯꽌 fetch ?섏? ?딆븯嫄곕굹 濡쒕뜑媛 ?ㅻⅨ 寃쎈줈濡??ㅽ뻾 以묒씤 寃?
  try {
    console.warn(
      "[CREE-GRRR!] theme-switcher module loaded",
      { url: location.href, time: new Date().toISOString() }
    );
  } catch (_) { /* ignore */ }

  start();

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

  function start() {
    let tryInitErrorLogged = false;
    const tryInit = () => {
      try {
        if (!ccfThemeLifecycle.isActive()) return false;
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
        // tryInit ?ㅽ뙣媛 start() ???꾩냽 setup(setInterval, DOMContentLoaded ??
        // ?깅줉??留됱븘 ensureUi 媛 ?곸쁺 ?ъ떆?꾨릺吏 ?딅뒗 移⑤У ?ㅽ뙣瑜?諛⑹?.
        // 泥??ㅽ뙣留?濡쒓퉭(?댄썑 ?몄텧? 媛숈? ?먮윭濡?肄섏넄 ??＜ 諛⑹?).
        if (!tryInitErrorLogged) {
          tryInitErrorLogged = true;
          try { console.warn("[CCF Theme] tryInit threw ??recovering", err); } catch (_) {}
        }
        return false;
      }
      // 蹂몃Ц ????try 釉붾줉 ?덉뿉??泥섎━??寃???異붽? ?숈옉? try 諛뽰뿉 ?먭린 ?꾪빐 遺꾨━

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
      if (!ccfThemeLifecycle.isActive()) { window.clearInterval(timer); return; }
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

        /* Native audio editing renders its visible card inside a Popover carrier.
           Leave the carrier invisible so the original CCFOLIA mini-modal remains intact. */
        html[data-ccf-theme-active="1"] .MuiPopover-paper:not(.ccf-youtube-bgm-popover):has(> .MuiPaper-root > form input[name="name"]):has(input[name="volume"][type="range"]):has(button[type="submit"]) {
          min-width: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }

        input[${CUTIN_VOLUME_BOUND_ATTR}="1"] {
          accent-color: var(--ccf-theme-control-active, currentColor);
        }

        html[data-ccf-theme-active="1"] .MuiDivider-root {
          border-color: var(--ccf-theme-border) !important;
        }

        html[data-ccf-theme-active="1"] [role="log"] .MuiListItem-root,
        html[data-ccf-theme-active="1"] [aria-live="polite"] .MuiListItem-root,
        html[data-ccf-theme-active="1"] [aria-live="assertive"] .MuiListItem-root,
        html[data-ccf-theme-active="1"] .MuiDrawer-paper ul.MuiList-root > .MuiListItem-root {
          border-bottom-color: var(--ccf-theme-message-divider) !important;
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

        html[data-ccf-theme-active="1"] .MuiBackdrop-root:not(.MuiBackdrop-invisible) {
          background: var(--ccf-theme-overlay) !important;
        }
        html[data-ccf-theme-active="1"] .MuiBackdrop-invisible {
          background: transparent !important;
        }

        /* #24 ??罹먮┃???대?吏 蹂寃?Unsplash ??native MUI Dialog ??input ?
           native ?붿옄???좎?. ?꾩쓽 input/select/placeholder/border 猷곕뱾??紐⑤몢
           Dialog scope ?덉뿉??revert 濡??섎룎由곕떎. */
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiInputBase-root,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiOutlinedInput-root,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiFilledInput-root,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiSelect-select,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiInputBase-input,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiInputBase-multiline {
          background: revert !important;
          color: revert !important;
        }
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiInputBase-root fieldset,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiOutlinedInput-notchedOutline,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiInputBase-root.Mui-focused fieldset,
        html[data-ccf-theme-active="1"] .MuiDialog-root .Mui-focused .MuiOutlinedInput-notchedOutline {
          border-color: revert !important;
          box-shadow: revert !important;
        }
        html[data-ccf-theme-active="1"] .MuiDialog-root input,
        html[data-ccf-theme-active="1"] .MuiDialog-root textarea,
        html[data-ccf-theme-active="1"] .MuiDialog-root select {
          color: revert !important;
          caret-color: revert !important;
        }
        html[data-ccf-theme-active="1"] .MuiDialog-root input::placeholder,
        html[data-ccf-theme-active="1"] .MuiDialog-root textarea::placeholder,
        html[data-ccf-theme-active="1"] .MuiDialog-root .MuiInputBase-input::placeholder {
          color: revert !important;
          opacity: revert !important;
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
          /* ?곗륫 ?⑤뵫 30px = ?먮툕濡?10px) + ?곗륫 ?щ갚(12px) + ?띿뒪?몄? ?먮툕濡??ъ씠(8px) */
          padding: 0 30px 0 12px;
          box-sizing: border-box;
          background-color: var(--ccf-theme-input-bg, rgba(21, 20, 20, 0.88));
          /* ?ㅼ씠?곕툕 ?먮툕濡좎씠 ??긽 ?곗륫 ?앹뿉 遺숈뼱 ?꾩튂 議곗젅??遺덇??ν븯誘濡?
             appearance:none + 而ㅼ뒪? SVG ?먮툕濡좎쑝濡?援먯껜?섍퀬 background-position
             ?쇰줈 ?먮툕濡좎쓣 ?곗륫?먯꽌 12px ?쇱뼱 ?볥뒗?? */
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

    // ?ㅼ씠?ㅻ큸 ?ㅽ??쇱떆?몃뒗 留??몄텧留덈떎 理쒖떊 textContent 濡?媛뺤젣 媛깆떊.
    // ?ㅽ겕由쏀듃 踰꾩쟾???щ졇????湲곗〈 <style> 媛 洹몃?濡??⑥븘 ??CSS(怨쇨굅 ?몃씪??諭껋? ??
    // 媛 ?붾㈃???댁븘 ?덈뒗 臾몄젣瑜?諛⑹?.
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
    // Roll20 "?몄꽦 ??? 而ㅼ뒪??쒗듃 ?붾젅??
    // (Roll20 ?먮낯: bg #1c3245 / border #004d67 / muted #8895A1 / accent #fff)
    const UD = {
      // 諛섑닾紐? CCFOLIA ?ㅼ씠?곕툕 ?ㅽ겕 諛곌꼍??鍮꾩퀜 蹂댁씠?꾨줉 ?뚰뙆 ??땄
      bgGlass: "rgba(28, 50, 69, 0.55)",
      bgGlassInner: "rgba(28, 50, 69, 0.32)",
      bgSolid: "#1c3245",
      // ?띿뒪???낅젰移몄? 泥?줉 ???좎?
      bgChip: "rgba(0, 77, 103, 0.28)",
      inputBorder: "#004d67",
      inputBorderSoft: "rgba(0, 77, 103, 0.55)",
      // ?띿뒪???낅젰移몄쓣 ?쒖쇅???섎㉧吏 ?곸뿭(?ㅻ뜑/蹂대뜑/??됲듃/?ㅽ겕濡ㅻ컮 ???
      // ?몄꽦 ???諛곌꼍怨??숈씪??釉붾옓 ?ㅼ쑝濡??듭씪
      accent: "#000000",
      accentSoft: "rgba(0, 0, 0, 0.55)",
      accentHover: "rgba(0, 0, 0, 0.45)",
      muted: "#8895A1",
      text: "#ffffff",
      shadow: "rgba(0, 0, 0, 0.45)",
      // Roll20 ?쒗듃???ㅻ뜑 ?쇰윭?ㅽ듃(?몄꽦 ???猷???댄? 洹몃젮???덈뒗 .sheet-outer 諛곌꼍)
      sheetBg: "url(https://i.imgur.com/htxGxau.png)"
    };

    return `
      /* === [?몄꽦 ??? 罹먮┃???몄쭛 ?앹뾽 ============================= */
      /* Dialog paper ?먯껜: 諛섑닾紐?+ 釉붾옓 蹂대뜑(=inset shadow).
         ?멸낸?좎? inset box-shadow留뚯쑝濡??쒗쁽 ???덉씠?꾩썐 ?곹뼢 ?놁쓬.
         min-width: MUI 'sm' 湲곕낯媛?600px)??紐낆떆??CCFOLIA ?ㅼ씠?곕툕 ?덈퉬 蹂댁옣. */
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

      /* DialogActions(??젣/蹂듭젣/留듭뿉??吏묒뼱?ｊ린):
         - ??踰꾪듉??媛濡???쓣 洹좊벑 遺꾨같?섎룄濡?flex:1 1 0
         - ?띿뒪?몃뒗 ?대뼡 ?덈퉬?먯꽌????以??좎? */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogActions-root .MuiButton-root,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogActions-root .MuiButtonBase-root {
        flex: 1 1 0 !important;
        min-width: 0 !important;
        white-space: nowrap !important;
      }

      /* 罹먮┃???몄쭛 ?ㅻ뜑 (MuiAppBar) ??釉붾옓 ??
         border-bottom ???inset box-shadow濡?媛吏?蹂대뜑 ???덉씠?꾩썐 ?곹뼢 ?놁쓬 */
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

      /* DialogContent: Roll20 ?쒗듃???ㅻ뜑 ?쇰윭?ㅽ듃瑜?源붿븘 猷???댄???蹂댁씠寃???
         諛곌꼍 ?대?吏 + 諛섑닾紐?泥?줉 ???ㅻ쾭?덉씠媛 寃뱀퀜 蹂댁씠?꾨줉 ???덉씠???ъ슜. */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root {
        background-image:
          linear-gradient(${UD.bgGlassInner}, ${UD.bgGlassInner}),
          ${UD.sheetBg} !important;
        background-repeat: no-repeat, no-repeat !important;
        background-position: center top, center top !important;
        background-size: cover, contain !important;
        background-color: transparent !important;
      }

      /* ?대? Paper/移대뱶/?꾩퐫?붿뼵 ??MuiAppBar?????ㅻ뜑 洹쒖튃??泥섎━?섎?濡??쒖쇅 */
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

      /* ?띿뒪??????DialogActions(??젣/蹂듭젣 ???≪뀡 踰꾪듉)??CCFOLIA ?ㅼ씠?곕툕
         ?됱쓣 ?좎??섍린 ?꾪빐 DialogContent ?ㅼ퐫?꾨줈 ?쒖젙 */
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

      /* ?낅젰移?蹂대뜑??泥?줉 ?좎? (Roll20 ?쒗듃 ?? */
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiInputBase-root fieldset {
        border-color: ${UD.inputBorder} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .Mui-focused .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiInputBase-root.Mui-focused fieldset {
        border-color: ${UD.muted} !important;
        box-shadow: 0 0 0 2px rgba(136, 149, 161, 0.25) !important;
      }

      /* ??由ъ뒪???좏깮 ??釉붾옓 ?≪꽱??*/
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiTab-root.Mui-selected,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiListItemButton-root.Mui-selected,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .Mui-selected > .MuiListItemButton-root {
        background: ${UD.accent} !important;
        color: ${UD.text} !important;
      }

      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiTabs-indicator {
        background: ${UD.text} !important;
      }

      /* ?몃쾭 ??釉붾옓 ??*/
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiTab-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiListItemButton-root:hover,
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper .MuiDialogContent-root .MuiMenuItem-root:hover {
        background: ${UD.accentHover} !important;
      }

      /* 罹먮┃???쒗듃 ?앹뾽 ?ㅽ겕濡ㅻ컮 ??釉붾옓 ?≪꽱??*/
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper ::-webkit-scrollbar-track {
        background: ${UD.bgSolid};
      }
      html[${DICEBOT_ATTR}="unsung-duet"] .MuiDialog-paper ::-webkit-scrollbar-thumb {
        background: ${UD.accent};
        border: 2px solid ${UD.bgSolid};
        border-radius: 999px;
      }

      /* === [?몄꽦 ??? ?ㅼ씠??濡?梨꾪똿 硫붿떆吏 ======================== */
      /* 梨꾪똿 濡쒓렇 ?곸뿭??硫붿떆吏 ?꾩씠??(li) ??移대뱶 ???곸슜 */
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

      /* ?ㅼ씠??寃곌낵(?? "1D6 ??4") 媛뺤“: ?붿궡???レ옄媛 ?ㅼ뼱媛???⑦꽩??
         媛吏?硫붿떆吏??援듭? ?띿뒪?몃뒗 ?곗깋?쇰줈 ?꾩? */
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li strong,
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li b,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="polite"] li strong,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="assertive"] li strong {
        color: ${UD.text} !important;
        font-weight: bold;
      }

      /* 罹먮┃???대쫫(?됰꽕?? ?쇰꺼 ??*/
      html[${DICEBOT_ATTR}="unsung-duet"] [role="log"] li .MuiTypography-caption,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="polite"] li .MuiTypography-caption,
      html[${DICEBOT_ATTR}="unsung-duet"] [aria-live="assertive"] li .MuiTypography-caption {
        color: ${UD.text} !important;
        font-weight: bold;
      }

      /* ?몃━嫄??띿뒪?멸? 移섑솚??<img> ??梨꾪똿 硫붿떆吏?먯꽌 媛?대뜲 ?뺣젹 */
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
    // CREE-GRRR! 而ㅼ뒪? ?쒗듃 ?붾젅??(Roll20 ?먮낯 ?쒗듃?먯꽌 異붿텧)
    // - 踰좎씠?? ?대몢????+ sheet-wrap ?ㅻ뜑 ?대?吏(https://i.imgur.com/MUGe6Qi.png)
    // - ?≪꽱?? #1ff2f2 (?쒖븞)
    // - 蹂몃Ц ?띿뒪?? #FFF / 蹂댁“ #d1d1d1 / dim #c2c2c2
    // - ?낅젰移? rgba(0,0,0,0.5) + ?곗깋 蹂대뜑, ?쇱슫??4~7px
    // - ?고듃: DungGeunMo + Galmuri (Roll20 ?쒗듃? ?숈씪 ?멸?)
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
      // Roll20 ?쒗듃??'DungGeunMo' ?쎌? ?고듃? 'Galmuri'. ?먮낯 ?쒗듃? ?숈씪???고듃
      // ?⑤?由щ? import ??CCFOLIA 痢≪뿉???곸슜?쒕떎. (?쒓? 湲由ы봽 吏??+ ?숈씪 ?명삎)
      fontImport:
        "@font-face{font-family:'DungGeunMo';src:url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_six@1.2/DungGeunMo.woff') format('woff');font-weight:normal;font-style:normal;}" +
        "@import url('https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css');"
    };

    return `
      /* === [CREE-GRRR!] ?고듃 ?꾪룷??(Roll20 ?쒗듃 ?멸?怨??숈씪?섍쾶) ====== */
      ${CG.fontImport}

      /* === [CREE-GRRR!] 罹먮┃???몄쭛 ?앹뾽 ============================ */
      /* paper: ???섎떒 ?쒖븞 ?쇱씤留? border-radius 0 ?쇰줈 紐⑥꽌由??쇱슫???쒓굅.
         BGM ?몄쭛 誘몃땲紐⑤떖? ?ㅼ씠?곕툕 ?ш린/?멸????좎??섍린 ?꾪빐 ?쒖쇅?쒕떎.
         data-ccf-native-dialog="1" 留덉빱媛 ?덈뒗 紐⑤떖(?? ?대?吏 ?쇱씠釉뚮윭由?
         Unsplash) ??native ?좎?瑜??꾪빐 ?쒖쇅?쒕떎 (#24, JS observer 媛 留덊궧). */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]),
      html[${DICEBOT_ATTR}="cree-grrr"] div[role="dialog"]:not([data-ccf-native-dialog="1"]) > .MuiPaper-root:not(.MuiPopover-paper):not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]),
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiPaper-root.MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) {
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

      /* DialogActions??罹먮┃???몄쭛 ?앹뾽?먮쭔 ?쒖븞 ?ㅽ??쇱쓣 ?곸슜?쒕떎. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogActions-root.MuiDialogActions-spacing {
        position: relative !important;
        border-radius: 0 !important;
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogActions-root.MuiDialogActions-spacing::before {
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

      /* 罹먮┃???몄쭛 ?앹뾽??DialogActions留?媛뺤젣 flex 洹좊벑 遺꾨같?쒕떎. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogActions-root.MuiDialogActions-spacing {
        display: flex !important;
        flex-direction: row !important;
        align-items: stretch !important;
        justify-content: stretch !important;
        gap: 8px !important;
        padding: 8px !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogActions-root.MuiDialogActions-spacing > * {
        flex: 1 1 0 !important;
        flex-grow: 1 !important;
        flex-shrink: 1 !important;
        flex-basis: 0 !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: none !important;
        margin: 0 !important;
        white-space: nowrap !important;
        box-sizing: border-box !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogActions-root.MuiDialogActions-spacing > .MuiButton-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogActions-root.MuiDialogActions-spacing > .MuiButtonBase-root {
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
        font-size: 14px !important;
        letter-spacing: 0 !important;
      }

      /* 罹먮┃???몄쭛 ?ㅻ뜑 (MuiAppBar) ??釉붾옓 踰좎씠?? 醫????쒖븞 ?쒓굅(泥댄겕 吏??,
         ???섎떒留??쒖븞 ?쇱씤 ?좎?(?곷떒=?ㅼ씠?쇰줈洹?理쒖긽?? ?섎떒=AppBar?봀ontent 援щ텇??. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAppBar-root {
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
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAppBar-root .MuiTypography-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAppBar-root .MuiIconButton-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAppBar-root .MuiSvgIcon-root {
        color: ${CG.text} !important;
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAppBar-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAppBar-root .MuiIconButton-root:hover {
        background: ${CG.accentHover} !important;
      }

      /* DialogContent: ?쒗듃 ?ㅻ뜑 ?쇰윭?ㅽ듃 + ?대몢???ㅻ쾭?덉씠.
         醫????쒖븞 inset ?쒓굅(泥댄겕 吏?? ???ㅼ씠?쇰줈洹몃뒗 ???섎떒 媛濡??쇱씤怨?
         AppBar?봀ontent / Content?볾ctions 援щ텇?좊쭔 媛뽯뒗 誘몃땲硫 援ъ꽦. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root {
        background-image:
          linear-gradient(${CG.bgGlassInner}, ${CG.bgGlassInner}),
          ${CG.sheetBg} !important;
        background-repeat: no-repeat, no-repeat !important;
        background-position: center top, center top !important;
        background-size: cover, cover !important;
        background-color: transparent !important;
      }

      /* ?대? Paper/移대뱶/?꾩퐫?붿뼵 */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiPaper-root:not(.MuiAppBar-root),
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiCard-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiAccordion-root {
        background: ${CG.bgGlassInner} !important;
        color: ${CG.text} !important;
        border-color: ${CG.accentSoft} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDivider-root {
        border-color: ${CG.accentSoft} !important;
      }

      /* ?꾨뱶 ?쇰꺼(?뚰빆紐? ???대쫫/?대땲?뷀떚釉??좏겙 ?ъ씠利?李멸퀬 URL ??罹먮┃???몄쭛
         ?앹뾽??紐⑤뱺 input/select ?쇰꺼 ?띿뒪?? ?됱긽? CYAN(#1DE2E2),
         ?고듃???낅젰李쎄낵 ?숈씪??DungGeunMo ?쎌? ?고듃. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiInputLabel-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiFormLabel-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiFormControlLabel-label {
        color: #1DE2E2 !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
      }

      /* 洹???蹂몃Ц ?띿뒪???????곗깋 (DialogContent ?ㅼ퐫?꾨줈 ?쒖젙, DialogActions ?ㅼ씠?곕툕 ?좎?) */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiTypography-root:not([style*="color:"]),
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiTab-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiButton-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiButtonBase-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiSvgIcon-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogTitle-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogTitle-root .MuiTypography-root {
        color: ${CG.text} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiTypography-caption,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiFormHelperText-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiListItemText-secondary {
        color: ${CG.dim} !important;
      }

      /* ?낅젰移???寃? 踰좎씠??+ ?곗깋 ?띿뒪???ъ슜?먭? ?낅젰?섎뒗 ?ㅼ젣 媛믪? ?붿씠??.
         ?쇰꺼(?뚰빆紐?? 蹂꾨룄 洹쒖튃?쇰줈 CYAN(#1DE2E2). ?고듃??DungGeunMo ?쎌? ?고듃. */
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiInputBase-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiOutlinedInput-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiFilledInput-root,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiInputBase-input,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiSelect-select,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) textarea,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) input[type="text"],
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) input[type="number"],
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) input[type="url"] {
        background: ${CG.bgChip} !important;
        color: ${CG.text} !important;
        border-radius: 4px !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiInputBase-root fieldset {
        border-color: ${CG.borderSoft} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .Mui-focused .MuiOutlinedInput-notchedOutline,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiInputBase-root.Mui-focused fieldset {
        border-color: ${CG.accent} !important;
        box-shadow: 0 0 0 2px rgba(31, 242, 242, 0.22) !important;
      }

      /* ??由ъ뒪???좏깮 ???쒖븞 ?≪꽱??*/
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiTab-root.Mui-selected,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiListItemButton-root.Mui-selected,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .Mui-selected > .MuiListItemButton-root {
        background: ${CG.accentHover} !important;
        color: ${CG.accent} !important;
      }

      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiTabs-indicator {
        background: ${CG.accent} !important;
      }

      /* ?몃쾭 ???쒖븞 ??*/
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiButtonBase-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiTab-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiListItemButton-root:hover,
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) .MuiDialogContent-root .MuiMenuItem-root:hover {
        background: ${CG.accentHover} !important;
      }

      /* 罹먮┃???쒗듃 ?앹뾽 ?ㅽ겕濡ㅻ컮 ???쒖븞 ?≪꽱??*/
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) ::-webkit-scrollbar-track {
        background: ${CG.bgSolid};
      }
      html[${DICEBOT_ATTR}="cree-grrr"] .MuiDialog-paper:not([data-ccf-bgm-dialog-paper="1"]):not([data-ccf-native-dialog="1"]) ::-webkit-scrollbar-thumb {
        background: ${CG.accent};
        border: 2px solid ${CG.bgSolid};
        border-radius: 999px;
      }

      /* === [CREE-GRRR!] ?ㅼ씠??濡?梨꾪똿 硫붿떆吏 ======================= */
      /* Roll20 ?쒗듃??.sheet-rolltemplate-coc 諛뺤뒪 ?붿옄?몄쓣 CCFOLIA 梨꾪똿
         硫붿떆吏(li)??李⑥슜 ??寃? 移대뱶 + ?쒖븞 蹂대뜑 + DungGeunMo ?고듃 */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"],
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"],
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] {
        background: ${CG.bgGlass} !important;
        border: 1px solid ${CG.accent} !important;
        border-radius: 10px !important;
        margin: 6px 8px !important;
        padding: 10px 14px !important;
        box-shadow: 0 8px 18px ${CG.shadow}, inset 0 0 0 1px rgba(31, 242, 242, 0.12) !important;
        font-family: 'DungGeunMo', 'Galmuri', sans-serif !important;
      }

      /* 蹂몃Ц ?띿뒪?????대몢???ㅼ뿉??媛?낆꽦 ?꾪빐 #d1d1d1 */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] p.MuiTypography-body2,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] p.MuiTypography-body2,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] p.MuiTypography-body2 {
        color: ${CG.muted} !important;
        font-family: inherit !important;
      }

      /* ?ㅼ씠??寃곌낵 媛뺤“ (援듭? ?띿뒪?????쒖븞) */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] strong,
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] b,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] strong,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] strong {
        color: ${CG.accent} !important;
        font-weight: normal !important; /* ?쎌? ?고듃??援듦쾶 泥섎━ 遺덊븘??*/
      }

      /* ?몃씪??濡?寃곌낵 ???쒖븞 媛뺤“ */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] .inlinerollresult,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] .inlinerollresult,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] .inlinerollresult {
        background: none !important;
        border: none !important;
        color: ${CG.accent} !important;
        padding: 0 !important;
        font-weight: normal !important;
      }

      /* 罹먮┃???대쫫(?됰꽕?? ???쒖븞 ?≪꽱??*/
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] .MuiTypography-caption,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="polite"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] .MuiTypography-caption,
      html[${DICEBOT_ATTR}="cree-grrr"] [aria-live="assertive"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] .MuiTypography-caption {
        color: ${CG.accent} !important;
      }

      /* 梨꾪똿 ?낅젰李??곸뿭?먮룄 ?고듃 ???듭씪 (?좏깮 ?ы빆) */
      html[${DICEBOT_ATTR}="cree-grrr"] [role="log"] li[${CREE_GRRR_MESSAGE_ROW_ATTR}="1"] a {
        color: ${CG.accent} !important;
      }

      /* ?덇굅??v0.1.x ?몃씪??諭껋? 臾대젰????釉뚮씪?곗?????CSS媛 罹먯떆?섏뼱 ?댁븘 ?덉뼱??
         ?쒓컖 ?④낵媛 ???섏삤寃?媛뺤젣 unset. JS 痢?cleanupLegacyCreeGrrrSpans ? ?댁쨷 ?덉쟾留? */
      .${CREE_GRRR_ROLLRESULT_CLASS},
      .${CREE_GRRR_STATUS_CLASS} {
        all: unset !important;
        display: inline !important;
      }

      /* 移대뱶瑜?癒멸툑? host ?붿냼 ??媛뺤젣 display:block ?쇰줈 ?몃씪??而⑦뀓?ㅽ듃???대━???뚰뵾.
         諛곌꼍/?⑤뵫/留덉쭊 紐⑤몢 ?댁젣??移대뱶媛 ?먭린 ?덉씠?꾩썐 洹몃?濡?蹂댁씠寃???
         React-safe: host ???먮낯 ?띿뒪???섎━癒쇳듃 children ? DOM ???⑥븘 ?덈릺 ?붾㈃?먯꽌留??④?.
         (font-size: 0 ?쇰줈 ?띿뒪???몃뱶 ?쒓컖???쒓굅 + ?섎━癒쇳듃 child ??display:none) */
      [${CREE_GRRR_FORMATTED_ATTR}="1"] {
        display: block !important;
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        font-size: 0 !important;
        line-height: 0 !important;
      }
      [${CREE_GRRR_FORMATTED_ATTR}="1"] > *:not(.${CREE_GRRR_CARD_CLASS}):not(.${CREE_GRRR_SIMPLE_CARD_CLASS}) {
        display: none !important;
      }
      [${CREE_GRRR_FORMATTED_ATTR}="1"] > .${CREE_GRRR_CARD_CLASS},
      [${CREE_GRRR_FORMATTED_ATTR}="1"] > .${CREE_GRRR_SIMPLE_CARD_CLASS} {
        font-size: 14px !important;
        line-height: normal !important;
      }

      /* === [CREE-GRRR!] ?ㅼ씠???먯젙 寃곌낵 移대뱶 ========================
         Roll20 ?쒗듃??sheet-rolltemplate-coc (243횞370px) ? ?숈씪??移대뱶 ?덉씠?꾩썐.
         ?ㅽ궗紐?/ 3媛쒖쓽 ?묒? ???먯젙湲곗?쨌/2쨌/5) / ??以묒븰 ???먯젙媛? / ?먯젙?④퀎 ?띿뒪??
         JS 痢≪뿉??dicebot==='cree-grrr' + ?먯젙 ?띿뒪??CC<=N ?먮뒗 (1D100<=N)) 留ㅼ묶
         ?쒖뿉留?移대뱶瑜?鍮뚮뱶??硫붿떆吏 蹂몃Ц???泥? */
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
      /* ?ㅽ궗紐?諭껋? ??醫뚯륫 ?곷떒 */
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
      /* 3媛쒖쓽 ?묒? ?먯젙 ??(?먯젙湲곗? / 湲곗?/2 / 湲곗?/5) */
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
      /* ??以묒븰 ?????먯젙媛?(?ㅼ젣 d100 援대┝) */
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
      /* ?먯젙?④퀎 ?띿뒪????移대뱶 ?섎떒 */
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

      /* === [CREE-GRRR!] ?쇰컲 ?ㅼ씠??移대뱶 (CC<= 媛 ?꾨땶 ?쇰컲 援대┝?? =======
         ?먮낯 ?쒗듃??.sheet-rolltemplate-coc-dice-roll ?ъ뼇 1:1 ?댁떇.
         - 移대뱶 ?꾨젅?? 293mfNY.png (?쒖븞 蹂대뜑 + ?대몢??諛곌꼍???대?吏???ы븿)
         - ?ъ씠利? 243 횞 86 怨좎젙
         - 醫뚯륫: 65횞65 寃곌낵 ??QxyXISE.png), font 30px, ?쒖븞??
         - ?곗륫: caption ?띿뒪??139px, font 16px, ?곗깋 (#fff)
         - 蹂꾨룄 border / border-radius ?놁쓬 (?꾨젅??PNG 媛 泥섎━) */
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
    if (!ccfThemeLifecycle.isActive()) return;
    if (!document.body) return;

    if (!document.getElementById(TOGGLE_ID)) {
      const toggle = document.createElement("button");
      toggle.id = TOGGLE_ID;
      toggle.type = "button";
      toggle.title = "?뚮쭏 ?⑤꼸 ?닿린";
      toggle.setAttribute("aria-label", "?뚮쭏 ?⑤꼸 ?닿린");
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
        if (!ccfThemeLifecycle.isActive()) return;
        togglePanel();
      }, ccfThemeWithSignal());
    }

    // 媛??④퀎瑜?媛쒕퀎 try-catch 濡?媛먯떥?????④퀎???ㅽ뙣媛 ?ㅻ뵲瑜대뒗 ?몄텧
    // (?뱁엳 injectCreeGrrrDiceFormatting) ??留됱? ?딅룄濡??쒕떎.
    // ?댁쟾??ensureUi ?덉쓽 ?대뼡 ?몄텧????踰?throw ?섎㈃ 洹??댄썑 ?몄텧???곸쁺
    // ?ㅽ뻾?섏? ?딆븘 ?ㅼ씠??移대뱶 ?몄젥?섏씠 移⑤У ?ㅽ뙣?섎뒗 寃쎈줈媛 ?덉뿀??
    try { mountToggle(); } catch (e) { try { console.warn("[CCF Theme] mountToggle failed", e); } catch (_) {} }
    try { applyDicebotAttribute(); } catch (e) { try { console.warn("[CCF Theme] applyDicebotAttribute failed", e); } catch (_) {} }
    try { installCutinVolumeAbsolutePatch(); } catch (e) { try { console.warn("[CCF Theme] installCutinVolumeAbsolutePatch failed", e); } catch (_) {} }
    try { bindCutinVolumeRatioInputs(); } catch (e) { try { console.warn("[CCF Theme] bindCutinVolumeRatioInputs failed", e); } catch (_) {} }
    try { bindUnsungDuetTriggerFields(); } catch (e) { try { console.warn("[CCF Theme] bindUnsungDuetTriggerFields failed", e); } catch (_) {} }
    try { injectUnsungDuetMessageImages(); } catch (e) { try { console.warn("[CCF Theme] injectUnsungDuetMessageImages failed", e); } catch (_) {} }
    try { injectCreeGrrrDiceFormatting(); } catch (e) { try { console.warn("[CCF Theme] injectCreeGrrrDiceFormatting failed", e); } catch (_) {} }
    try { installYouTubePauseInterceptor(); } catch (e) { try { console.warn("[CCF Theme] installYouTubePauseInterceptor failed", e); } catch (_) {} }
    if (!document.getElementById(PANEL_ID)) {
      const panel = document.createElement("aside");
      panel.id = PANEL_ID;
      panel.setAttribute("aria-hidden", "true");
      panel.innerHTML = `
        <div class="ccf-theme-card">
          <div class="ccf-theme-head">
            <div class="ccf-theme-title">
              <strong>CCF Theme</strong>
              <span>硫붿씤 ?щ㎎ ?ㅽ겕由쏀듃? 遺꾨━???낅┰ ?뚮쭏?낅땲??</span>
            </div>
            <button type="button" class="ccf-theme-close" data-action="close" aria-label="?뚮쭏 ?⑤꼸 ?リ린">횞</button>
          </div>
          <label class="ccf-theme-row">
            <span>?뚮쭏 紐⑤뱶</span>
            <select id="${MODE_SELECT_ID}" class="ccf-theme-select" aria-label="?뚮쭏 紐⑤뱶">
              <option value="${MODE_DEFAULT}">湲곕낯媛?/option>
              <option value="${MODE_LIGHT}">?쇱씠??/option>
              <option value="${MODE_CUSTOM}">而ㅼ뒪?</option>
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
                  aria-label="${escapeHtml(field.label)} ?됱긽"
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
            <button type="button" class="ccf-theme-btn" data-action="save-theme">?꾩옱 ?됱긽 ???/button>
            <button type="button" class="ccf-theme-btn" data-action="reset">湲곕낯 ?뚮쭏濡?蹂듭썝</button>
          </div>
          <div class="ccf-theme-actions">
            <button type="button" class="ccf-theme-btn" data-action="import-theme">媛?몄삤湲?/button>
            <button type="button" class="ccf-theme-btn" data-action="export-theme">?대낫?닿린</button>
            <button type="button" class="ccf-theme-btn" data-action="delete-theme">?뚮쭏 ??젣</button>
          </div>
          <label class="ccf-theme-row">
            <span>而ㅼ뒪? ?쒗듃 ?뚮쭏</span>
            <select id="${SHEET_THEME_SELECT_PANEL_ID}" class="ccf-theme-select" aria-label="而ㅼ뒪? ?쒗듃 ?뚮쭏 ?좏깮">
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
            >?좏깮 ?뚮쭏: ON</button>
          </div>
          <input id="${IMPORT_INPUT_ID}" type="file" accept=".json,application/json" hidden>
        </div>
        <div id="${SAVE_DIALOG_ID}" aria-hidden="true">
          <div class="ccf-theme-save-card" role="dialog" aria-modal="true" aria-labelledby="${SAVE_DIALOG_ID}-title">
            <p id="${SAVE_DIALOG_ID}-title" class="ccf-theme-save-title">?뚮쭏 ?대쫫 ???/p>
            <p class="ccf-theme-save-note">媛숈? ?대쫫?쇰줈 ??ν븯硫?湲곗〈 ?뚮쭏瑜???뼱?곷땲??</p>
            <input
              id="${THEME_NAME_INPUT_ID}"
              class="ccf-theme-select"
              type="text"
              maxlength="24"
              placeholder="?? ???쇱씠???뚮쭏"
              aria-label="??ν븷 ?뚮쭏 ?대쫫"
            >
            <div class="ccf-theme-save-actions">
              <button type="button" class="ccf-theme-btn" data-action="cancel-save-theme">痍⑥냼</button>
              <button type="button" class="ccf-theme-btn" data-action="confirm-save-theme">???/button>
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
          // ?좉? OFF ???대? ?몄젥?몃맂 ?대?吏/留덊궧??利됱떆 ?뺣━???먮낯 ?띿뒪?몃줈 蹂듭썝
          // ?좉? ON ?????뚮쭏???몄젥?섏쓣 湲곗〈 硫붿떆吏?먮룄 利됱떆 ?곸슜
          if (!nextEnabled) revertUnsungDuetDomState();
          else reapplySheetThemeInjections();
          const themeName = SHEET_THEMES.find((t) => t.id === getSelectedSheetThemeId())?.name || "";
          setStatus(
            nextEnabled
              ? `${themeName} ?뚮쭏瑜??쒖꽦?뷀뻽?듬땲??`
              : `${themeName} ?뚮쭏瑜?鍮꾪솢?깊솕?덉뒿?덈떎.`,
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
            isCustomMode ? "而ㅼ뒪? ?됱긽??湲곕낯媛믪쑝濡?蹂듭썝?덉뒿?덈떎." : "湲곕낯 ?뚮쭏濡?蹂듭썝?덉뒿?덈떎.",
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
        setStatus("而ㅼ뒪? ?됱긽??諛섏쁺?덉뒿?덈떎.", "success");
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
          nextMode === MODE_DEFAULT ? "?ъ씠??湲곕낯 ?됱쑝濡??뚯븘媛묐땲??" : "?뚮쭏瑜?蹂寃쏀뻽?듬땲??",
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
        // ?ㅻⅨ ?뚮쭏濡??꾪솚 ???댁쟾 ?뚮쭏???몄젥???붿쟻(?대?吏 移섑솚 ?? 利됱떆 ?뺣━
        revertUnsungDuetDomState();
        // ???뚮쭏 ?몄젥?섏쓣 利됱떆 ?ъ떎??
        reapplySheetThemeInjections();
        syncUnsungDuetToggle();
        const themeName = SHEET_THEMES.find((t) => t.id === value)?.name || value;
        setStatus(`而ㅼ뒪? ?쒗듃 ?뚮쭏: ${themeName}`, "success");
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
      if (!ccfThemeLifecycle.isActive()) return;
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
      if (!ccfThemeLifecycle.isActive()) return;
      const clickedColor = resolveNativeCharacterColorFromTarget(event?.target, container);
      if (clickedColor) {
        pendingCharacterColorSelections.set(container, clickedColor);
      }

      const runRefresh = () => {
        if (!ccfThemeLifecycle.isActive()) return;
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
      if (!ccfThemeLifecycle.isActive()) return;
      scheduleEnsureUi();
      markNativeDialogs();
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
    ccfThemeRegisterTeardown(() => { bodyObserver?.disconnect(); bodyObserver = null; });
  }

  // #24 ???대?吏 ?쇱씠釉뚮윭由?ROOM/ALL/Unsplash) ?ㅼ씠?쇰줈洹몃? native ?좎? ??곸쑝濡?留덊궧.
  // input[name="query"] ??Unsplash ??뿉?쒕쭔 議댁옱 ???덉젙?곸씠吏 ?딆쓬.
  // ????ㅻ뜑 ButtonGroup ??ROOM/ALL/Unsplash ?띿뒪??踰꾪듉???덈뒗吏濡??앸퀎 (??臾닿?).
  function markNativeDialogs() {
    try {
      const dialogs = document.querySelectorAll('.MuiDialog-root, div[role="dialog"]');
      dialogs.forEach((dlg) => {
        if (!(dlg instanceof HTMLElement)) return;
        if (dlg.getAttribute('data-ccf-native-dialog') === '1') return; // ?대? 留덊궧??
        const buttons = dlg.querySelectorAll('header .MuiButtonGroup-root button, .MuiAppBar-root .MuiButtonGroup-root button');
        let isImageLib = false;
        for (const btn of buttons) {
          const txt = (btn.textContent || '').trim();
          if (txt === 'Unsplash' || txt === 'ROOM' || txt === 'ALL') { isImageLib = true; break; }
        }
        // fallback: input[name="query"] 媛 ?덉쑝硫?(Unsplash ???쒖꽦 ?곹깭) ???몄젙
        if (!isImageLib && dlg.querySelector('input[name="query"]')) isImageLib = true;
        if (!isImageLib) return;
        dlg.setAttribute('data-ccf-native-dialog', '1');
        const paper = dlg.querySelector('.MuiDialog-paper, .MuiPaper-root');
        if (paper instanceof HTMLElement) paper.setAttribute('data-ccf-native-dialog', '1');
      });
    } catch (_) { /* observer ??踰??ㅽ뙣??臾댁떆 */ }
  }

  function scheduleEnsureUi() {
    if (ensureUiFrame) return;

    ensureUiFrame = window.requestAnimationFrame(() => {
      ensureUiFrame = 0;
      if (!ccfThemeLifecycle.isActive()) return;
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
      "--ccf-theme-message-divider": derived.messageDivider,
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
      { value: MODE_DEFAULT, label: "湲곕낯媛? },
      { value: MODE_LIGHT, label: "?쇱씠?? },
      ...settings.savedThemes.map((theme) => ({
        value: makeSavedMode(theme.id),
        label: theme.name
      })),
      { value: MODE_CUSTOM, label: "而ㅼ뒪?" }
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
      if (!ccfThemeLifecycle.isActive()) return;
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
      setStatus("而ㅼ뒪? ?됱긽??諛섏쁺?덉뒿?덈떎.", "success");
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
      setStatus("吏?먰븯吏 ?딅뒗 ?됱긽 肄붾뱶?낅땲??", "error");
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
        if (!ccfThemeLifecycle.isActive()) return;
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
    const characterButton = document.querySelector('button[aria-label="罹먮┃???좏깮"]');
    const helpButton = document.querySelector('button[aria-label="梨꾪똿 而ㅻ㎤?쒖뿉 ???]');
    if (!(characterButton instanceof HTMLElement) || !(helpButton instanceof HTMLElement)) {
      return null;
    }

    let current = characterButton.parentElement;
    while (current && current !== document.body) {
      if (
        current.contains(helpButton) &&
        current.querySelector('button[aria-label="罹먮┃???좏깮"]') &&
        current.querySelector('button[aria-label="梨꾪똿 而ㅻ㎤?쒖뿉 ???]')
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
      button instanceof HTMLElement && /?꾩넚/.test(normalizeSpace(button.textContent || ""))
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
    // ?묐컮??`<span class="MuiTypography-caption">??/span>` ?ㅼ쓣 ?묒뼱
    // DICEBOT_MAP ???ㅼ? ?쇱튂?섎뒗 ?띿뒪?멸? ?덉쑝硫??대떦 ?앸퀎?먮? ?뚮젮以??
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
    // ?덇굅????unsungDuetEnabled瑜??쒗듃 ?뚮쭏 ?꾩껜 ON/OFF 留덉뒪???ㅼ쐞移섎줈 ?ъ궗??
    return settings?.unsungDuetEnabled !== false;
  }

  function applyDicebotAttribute() {
    const root = document.documentElement;
    if (!root) return;
    // ?ъ슜?먭? ?쒕∼?ㅼ슫?먯꽌 紐낆떆?곸쑝濡??좏깮 + ON ?덉쑝硫?洹??뚮쭏瑜?臾댁“嫄??곸슜.
    // (CCFOLIA ?ㅼ씠?ㅻ큸 ?쒖떆紐낆씠 ?섍꼍留덈떎 誘몃쵖?섍쾶 ?щ씪 媛먯?媛 ?ㅽ뙣?섎뒗 耳?댁뒪瑜??뚰뵾.
    //  detectDicebotName() ??寃곌낵?????댁긽 寃뚯씠?몃줈 ?ъ슜?섏? ?딅뒗??)
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

  // === ?몄꽦 ??? 梨꾪똿 ?몃━嫄??띿뒪?????대?吏 URL ?먮룞 移섑솚 ============
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

  function bindCutinVolumeRatioInputs() {
    document.querySelectorAll(`.${CUTIN_VOLUME_LEGACY_HELPER_CLASS}`).forEach((helper) => helper.remove());

    document.querySelectorAll('input[name="volume"]').forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      if (!isCutinVolumeRatioInput(input)) return;
      bindCutinVolumeRatioInput(input);
    });
  }

  function isCutinVolumeRatioInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.getAttribute(CUTIN_VOLUME_BOUND_ATTR) === "1") return true;
    if ((input.name || "").trim() !== "volume") return false;
    if (input.closest(".ccf-youtube-bgm-popover, #ccf-theme-switcher-panel")) return false;

    const type = (input.type || "text").toLowerCase();
    if (!["range", "number", "text"].includes(type)) return false;

    const form = input.closest("form");
    if (!(form instanceof HTMLElement)) return false;
    const hasNativeAudioFields = !!form.querySelector('input[name="name"]')
      && !!form.querySelector('button[type="submit"], input[type="submit"]');

    const min = Number.parseFloat(input.min || "");
    const max = Number.parseFloat(input.max || "");
    const value = Number.parseFloat(input.value || "");
    const isRatioRange = (Number.isFinite(max) && max <= 1)
      || (Number.isFinite(value) && value >= 0 && value <= 1 && (!Number.isFinite(max) || max <= 1));

    return hasNativeAudioFields && isRatioRange;
  }

  function bindCutinVolumeRatioInput(input) {
    if (input.getAttribute(CUTIN_VOLUME_BOUND_ATTR) === "1") {
      normalizeCutinVolumeInput(input, { dispatch: false });
      rememberCutinVolumeAbsoluteInput(input);
      ensureCutinBoostHelper(input);
      return;
    }

    input.setAttribute(CUTIN_VOLUME_BOUND_ATTR, "1");
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.inputMode = "decimal";
    input.title = "0? 臾댁쓬, 1? ?쒖뒪??蹂쇰ⅷ??理쒕?移섏엯?덈떎.";
    input.setAttribute("aria-label", "?④낵??蹂쇰ⅷ");
    stripCutinVolumeHelperReference(input);

    normalizeCutinVolumeInput(input, { dispatch: false });
    rememberCutinVolumeAbsoluteInput(input);

    input.addEventListener("input", () => {
      normalizeCutinVolumeInput(input, { dispatch: false });
      rememberCutinVolumeAbsoluteInput(input);
    }, ccfThemeWithSignal(true));

    input.addEventListener("change", () => {
      normalizeCutinVolumeInput(input, { dispatch: true });
      rememberCutinVolumeAbsoluteInput(input);
    }, ccfThemeWithSignal(true));

    input.addEventListener("blur", () => {
      normalizeCutinVolumeInput(input, { dispatch: true });
      rememberCutinVolumeAbsoluteInput(input);
    }, ccfThemeWithSignal(true));

    const form = input.closest("form");
    if (form instanceof HTMLFormElement && form.dataset.ccfCutinVolumeSubmitBound !== "1") {
      form.dataset.ccfCutinVolumeSubmitBound = "1";
      form.addEventListener("submit", () => {
        normalizeCutinVolumeInput(input, { dispatch: false });
        rememberCutinVolumeAbsoluteInput(input);
      }, ccfThemeWithSignal(true));
    }

    ensureCutinBoostHelper(input);
  }

  // ===== 而룹씤 ?뚮━ 利앺룺 (횞1~횞4) =====
  // media.volume? 1???곹븳?대씪 "蹂쇰ⅷ 理쒕??몃뜲???묒쓬"???닿껐?????녿떎.
  // WebAudio GainNode濡?利앺룺?섎릺, cross-origin ?뚯썝? crossOrigin="anonymous"濡?
  // ?щ줈?쒗빐 CORS ?덉슜???뺤씤???ㅼ뿉留?洹몃옒?꾨? 留뚮뱺??(誘명뿀????臾댁쓬???섎?濡?.

  function clampCutinBoost(value) {
    const number = Number.parseFloat(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(number)) return 1;
    return Math.round(clamp(number, 1, CUTIN_BOOST_MAX) * 10) / 10;
  }

  function ensureCutinBoostHelper(volumeInput) {
    const form = volumeInput?.closest?.("form");
    if (!(form instanceof HTMLElement)) return;

    let helper = form.querySelector(`.${CUTIN_BOOST_HELPER_CLASS}`);
    let boostInput = helper?.querySelector?.("input") || null;

    if (!helper) {
      helper = document.createElement("label");
      helper.className = CUTIN_BOOST_HELPER_CLASS;
      helper.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;opacity:.92;";

      const caption = document.createElement("span");
      caption.textContent = "?뚮━ 利앺룺";

      boostInput = document.createElement("input");
      boostInput.type = "number";
      boostInput.min = "1";
      boostInput.max = String(CUTIN_BOOST_MAX);
      boostInput.step = "0.1";
      boostInput.inputMode = "decimal";
      boostInput.style.cssText = "width:64px;padding:2px 6px;box-sizing:border-box;";
      boostInput.title = "1蹂대떎 ?ш쾶 ?섎㈃ ?ъ깮 ???뚮━瑜?利앺룺?⑸땲??(理쒕? 4諛?. 蹂쇰ⅷ 理쒕?(1.0)濡쒕룄 ?묒? ?뚯썝??";
      boostInput.setAttribute("aria-label", "而룹씤 ?뚮━ 利앺룺 諛곗쑉");

      const unit = document.createElement("span");
      unit.textContent = "諛?;

      helper.append(caption, boostInput, unit);
      volumeInput.insertAdjacentElement("afterend", helper);

      const onBoostCommit = () => {
        const value = clampCutinBoost(boostInput.value);
        boostInput.value = String(value);
        rememberCutinBoostForForm(volumeInput, value);
      };
      boostInput.addEventListener("change", onBoostCommit, ccfThemeWithSignal(true));
      boostInput.addEventListener("blur", onBoostCommit, ccfThemeWithSignal(true));
    }

    if (boostInput && document.activeElement !== boostInput) {
      boostInput.value = String(lookupCutinBoostForKeys(collectCutinVolumeSourceKeys(volumeInput)));
    }
  }

  function lookupCutinBoostForKeys(keys) {
    for (const key of keys || []) {
      if (cutinBoostBySource.has(key)) return clampCutinBoost(cutinBoostBySource.get(key));
    }
    return clampCutinBoost(cutinBoostLastValue);
  }

  function rememberCutinBoostForForm(volumeInput, value) {
    const boost = clampCutinBoost(value);
    cutinBoostLastValue = boost;
    cutinVolumeAbsoluteApplyUntil = Date.now() + CUTIN_VOLUME_APPLY_WINDOW_MS;
    for (const key of collectCutinVolumeSourceKeys(volumeInput)) {
      cutinBoostBySource.set(key, boost);
    }
    persistCutinBoostStore();
  }

  function persistCutinBoostStore() {
    try {
      const sources = {};
      cutinBoostBySource.forEach((value, key) => {
        if (typeof key === "string" && Number.isFinite(value)) sources[key] = clampCutinBoost(value);
      });
      window.localStorage.setItem(CUTIN_BOOST_STORAGE_KEY, JSON.stringify({
        lastValue: clampCutinBoost(cutinBoostLastValue),
        sources
      }));
    } catch (error) { /* ignore storage failures */ }
  }

  function restoreCutinBoostStore() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CUTIN_BOOST_STORAGE_KEY) || "{}");
      if (Number.isFinite(Number(parsed?.lastValue))) {
        cutinBoostLastValue = clampCutinBoost(parsed.lastValue);
      }
      if (parsed?.sources && typeof parsed.sources === "object") {
        Object.entries(parsed.sources).forEach(([key, value]) => {
          if (typeof key === "string" && Number.isFinite(Number(value))) {
            cutinBoostBySource.set(key, clampCutinBoost(value));
          }
        });
      }
    } catch (error) { /* ignore storage failures */ }
  }

  function resolveCutinBoostForMedia(media) {
    if (!(media instanceof HTMLMediaElement)) return 1;
    const keys = new Set();
    addCutinVolumeSourceKeys(keys, media.currentSrc || media.src || "");
    media.querySelectorAll?.("source[src]").forEach((source) => {
      addCutinVolumeSourceKeys(keys, source.getAttribute("src") || "");
    });
    for (const key of keys) {
      if (cutinBoostBySource.has(key)) return clampCutinBoost(cutinBoostBySource.get(key));
    }
    if (!isCutinVolumeMediaCandidate(media)) return 1;
    return clampCutinBoost(cutinBoostLastValue);
  }

  function getCutinBoostAudioContext() {
    if (!cutinBoostAudioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try { cutinBoostAudioCtx = new Ctx(); } catch (error) { return null; }
    }
    if (cutinBoostAudioCtx.state === "suspended") {
      cutinBoostAudioCtx.resume().catch(() => {});
    }
    return cutinBoostAudioCtx;
  }

  function prepareCutinBoostForMedia(media, boost) {
    if (!(media instanceof HTMLMediaElement)) return;
    const target = clampCutinBoost(boost);
    const graph = cutinBoostGraphs.get(media);
    if (graph) {
      graph.gain.gain.value = target;
      getCutinBoostAudioContext();
      return;
    }
    if (target <= 1.01) return;
    if (media.dataset.ccfCutinBoostCors === "fail") return;
    media.dataset.ccfCutinBoostTarget = String(target);
    if (media.dataset.ccfCutinBoostPending === "1") return;

    // CORS ?덉슜 ?뺤씤 ?꾩뿉 MediaElementSource瑜?留뚮뱾硫? 誘명뿀???뚯썝? ?섎룎由????놁씠
    // 臾댁쓬???쒕떎. crossOrigin ?щ줈?쒓? ?깃났(canplay)???ㅼ뿉留?洹몃옒??援ъ꽦.
    if (media.crossOrigin === "anonymous" && media.readyState >= 2) {
      buildCutinBoostGraph(media);
      return;
    }

    media.dataset.ccfCutinBoostPending = "1";
    const cleanup = () => {
      media.removeEventListener("error", onError);
      media.removeEventListener("canplay", onReady);
      delete media.dataset.ccfCutinBoostPending;
    };
    const onError = () => {
      cleanup();
      media.dataset.ccfCutinBoostCors = "fail";
      console.warn("[CCF Theme] 而룹씤 利앺룺: CORS 誘명뿀???뚯썝 ??利앺룺 ?놁씠 ?ъ깮?⑸땲??", media.currentSrc || media.src || "");
      try {
        media.crossOrigin = null;
        media.load();
        media.play().catch(() => {});
      } catch (_) { /* ignore */ }
    };
    const onReady = () => {
      cleanup();
      buildCutinBoostGraph(media);
    };
    media.addEventListener("error", onError, { once: true });
    media.addEventListener("canplay", onReady, { once: true });
    try {
      if (media.crossOrigin !== "anonymous") {
        media.crossOrigin = "anonymous";
        media.load();
      }
      media.play().catch(() => {});
    } catch (error) {
      onError();
    }
  }

  function buildCutinBoostGraph(media) {
    const ctx = getCutinBoostAudioContext();
    if (!ctx) return;
    try {
      const sourceNode = ctx.createMediaElementSource(media);
      const gainNode = ctx.createGain();
      gainNode.gain.value = clampCutinBoost(media.dataset.ccfCutinBoostTarget);
      sourceNode.connect(gainNode);
      gainNode.connect(ctx.destination);
      cutinBoostGraphs.set(media, { gain: gainNode });
    } catch (error) {
      console.warn("[CCF Theme] 而룹씤 利앺룺 洹몃옒??援ъ꽦 ?ㅽ뙣", error);
    }
  }

  function normalizeCutinVolumeInput(input, options = {}) {
    if (!(input instanceof HTMLInputElement)) return "";
    const normalized = normalizeCutinVolumeRatio(input.value);
    if (input.value !== normalized) {
      if (options.dispatch === true) {
        setReactInputValue(input, normalized);
      } else {
        input.value = normalized;
      }
    }
    input.dataset.ccfCutinVolumeAbsolute = normalized;
    return normalized;
  }

  function normalizeCutinVolumeRatio(value) {
    const number = Number.parseFloat(String(value ?? "").replace(",", "."));
    const safe = Number.isFinite(number) ? number : 1;
    return (Math.round(clamp(safe, 0, 1) * 100) / 100).toFixed(2);
  }

  function stripCutinVolumeHelperReference(input) {
    if (!(input instanceof HTMLInputElement)) return;
    const describedBy = (input.getAttribute("aria-describedby") || "")
      .split(/\s+/)
      .filter((id) => id && !id.startsWith("ccf-cutin-volume-helper-"));
    if (describedBy.length) {
      input.setAttribute("aria-describedby", describedBy.join(" "));
    } else {
      input.removeAttribute("aria-describedby");
    }
  }

  function rememberCutinVolumeAbsoluteInput(input) {
    if (!(input instanceof HTMLInputElement)) return null;
    const value = Number(normalizeCutinVolumeRatio(input.value));
    if (!Number.isFinite(value)) return null;
    cutinVolumeAbsoluteLastValue = clamp(value, 0, 1);
    cutinVolumeAbsoluteApplyUntil = Date.now() + CUTIN_VOLUME_APPLY_WINDOW_MS;

    for (const key of collectCutinVolumeSourceKeys(input)) {
      cutinVolumeAbsoluteBySource.set(key, cutinVolumeAbsoluteLastValue);
    }
    persistCutinVolumeAbsoluteStore();
    return cutinVolumeAbsoluteLastValue;
  }

  function collectCutinVolumeSourceKeys(input) {
    const keys = new Set();
    const form = input?.closest?.("form");
    if (!(form instanceof HTMLElement)) return keys;

    form.querySelectorAll("input, textarea").forEach((field) => {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
      if (field === input) return;
      const name = (field.getAttribute("name") || "").toLowerCase();
      const value = String(field.value || "").trim();
      if (!value) return;
      if (!isCutinVolumeSourceValue(value) && !/(url|src|source|file|path|sound|audio)/i.test(name)) return;
      addCutinVolumeSourceKeys(keys, value);
    });

    return keys;
  }

  function isCutinVolumeSourceValue(value) {
    return /^(?:https?:|blob:|data:|filesystem:|\/\/)/i.test(String(value || "").trim());
  }

  function addCutinVolumeSourceKeys(keys, value) {
    const raw = String(value || "").trim();
    if (!raw) return;
    keys.add(raw);
    try {
      const url = new URL(raw, location.href);
      keys.add(url.href);
      url.hash = "";
      keys.add(url.href);
      url.search = "";
      keys.add(url.href);
      const fileName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      if (fileName) keys.add(fileName);
    } catch (error) {
      const tail = raw.split(/[\\/]/).pop();
      if (tail) keys.add(tail);
    }
  }

  function persistCutinVolumeAbsoluteStore() {
    try {
      const sources = {};
      cutinVolumeAbsoluteBySource.forEach((value, key) => {
        if (typeof key === "string" && Number.isFinite(value)) sources[key] = clamp(value, 0, 1);
      });
      window.localStorage.setItem(CUTIN_VOLUME_STORAGE_KEY, JSON.stringify({
        lastValue: Number.isFinite(cutinVolumeAbsoluteLastValue) ? cutinVolumeAbsoluteLastValue : null,
        sources
      }));
    } catch (error) { /* ignore storage failures */ }
  }

  function restoreCutinVolumeAbsoluteStore() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CUTIN_VOLUME_STORAGE_KEY) || "{}");
      if (Number.isFinite(Number(parsed?.lastValue))) {
        cutinVolumeAbsoluteLastValue = clamp(Number(parsed.lastValue), 0, 1);
      }
      if (parsed?.sources && typeof parsed.sources === "object") {
        Object.entries(parsed.sources).forEach(([key, value]) => {
          if (typeof key === "string" && Number.isFinite(Number(value))) {
            cutinVolumeAbsoluteBySource.set(key, clamp(Number(value), 0, 1));
          }
        });
      }
    } catch (error) { /* ignore storage failures */ }
  }

  function installCutinVolumeAbsolutePatch() {
    if (cutinVolumeAbsolutePatchInstalled) return;
    cutinVolumeAbsolutePatchInstalled = true;
    restoreCutinVolumeAbsoluteStore();
    restoreCutinBoostStore();

    const handleMediaEvent = (event) => {
      if (event?.target instanceof HTMLMediaElement) {
        applyCutinVolumeAbsoluteToMedia(event.target);
      }
    };

    document.addEventListener("play", handleMediaEvent, ccfThemeWithSignal(true));
    document.addEventListener("playing", handleMediaEvent, ccfThemeWithSignal(true));
    document.addEventListener("volumechange", handleMediaEvent, ccfThemeWithSignal(true));

    const originalPlay = HTMLMediaElement.prototype.play;
    if (typeof originalPlay === "function" && originalPlay.__ccfCutinVolumePatched !== true) {
      const patchedPlay = function ccfCutinVolumePlay(...args) {
        applyCutinVolumeAbsoluteToMedia(this, { allowDelayed: true });
        try {
          const boost = resolveCutinBoostForMedia(this);
          if (boost > 1.01 || cutinBoostGraphs.has(this)) prepareCutinBoostForMedia(this, boost);
        } catch (error) { /* boost ?ㅽ뙣媛 ?ъ깮??留됱? ?딅룄濡?*/ }
        const result = originalPlay.apply(this, args);
        scheduleCutinVolumeAbsoluteReapply(this);
        return result;
      };
      patchedPlay.__ccfCutinVolumePatched = true;
      HTMLMediaElement.prototype.play = patchedPlay;
      ccfThemeRegisterTeardown(() => {
        try {
          if (HTMLMediaElement.prototype.play === patchedPlay) {
            HTMLMediaElement.prototype.play = originalPlay;
          }
        } catch (error) { /* ignore restore failures */ }
      });
    }
  }

  function scheduleCutinVolumeAbsoluteReapply(media) {
    if (!(media instanceof HTMLMediaElement)) return;
    for (const delay of CUTIN_VOLUME_APPLY_DELAYS_MS) {
      window.setTimeout(() => applyCutinVolumeAbsoluteToMedia(media), delay);
    }
  }

  function applyCutinVolumeAbsoluteToMedia(media, options = {}) {
    if (!(media instanceof HTMLMediaElement) || cutinVolumeApplyingMedia.has(media)) return false;
    const boostGraph = cutinBoostGraphs.get(media);
    if (boostGraph) {
      try { boostGraph.gain.gain.value = resolveCutinBoostForMedia(media); } catch (_) { /* ignore */ }
    }
    const volume = resolveCutinVolumeAbsoluteForMedia(media, options);
    if (!Number.isFinite(volume)) return false;

    const nextVolume = clamp(volume, 0, 1);
    if (Math.abs(Number(media.volume) - nextVolume) < 0.001) return true;

    try {
      cutinVolumeApplyingMedia.add(media);
      media.volume = nextVolume;
      return true;
    } catch (error) {
      return false;
    } finally {
      window.setTimeout(() => cutinVolumeApplyingMedia.delete(media), 0);
    }
  }

  function resolveCutinVolumeAbsoluteForMedia(media, options = {}) {
    const sourceMatch = getCutinVolumeAbsoluteFromMediaSource(media);
    if (Number.isFinite(sourceMatch)) return sourceMatch;
    if (!isCutinVolumeMediaCandidate(media)) return null;
    if (
      Date.now() <= cutinVolumeAbsoluteApplyUntil ||
      isUnsungDuetCutinActive()
    ) {
      return Number.isFinite(cutinVolumeAbsoluteLastValue) ? cutinVolumeAbsoluteLastValue : null;
    }
    return null;
  }

  function getCutinVolumeAbsoluteFromMediaSource(media) {
    const keys = new Set();
    addCutinVolumeSourceKeys(keys, media.currentSrc || media.src || "");
    media.querySelectorAll?.("source[src]").forEach((source) => {
      addCutinVolumeSourceKeys(keys, source.getAttribute("src") || "");
    });

    for (const key of keys) {
      if (cutinVolumeAbsoluteBySource.has(key)) return cutinVolumeAbsoluteBySource.get(key);
    }
    return null;
  }

  function isCutinVolumeMediaCandidate(media) {
    if (!(media instanceof HTMLMediaElement)) return false;
    if (media.closest?.(".ccf-youtube-bgm-popover, [data-ccf-bgm-panel], [data-ccf-youtube-bgm]")) return false;
    if (media.loop) return false;
    const duration = Number(media.duration);
    if (Number.isFinite(duration) && duration > 30) return false;
    return Date.now() <= cutinVolumeAbsoluteApplyUntil || isUnsungDuetCutinActive();
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
      // Shift+Enter??以꾨컮轅? IME 議고빀 以?Enter???쒓? ?뺤젙????????諛쒖넚???꾨떂
      if (event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (hasActiveChatMacroSelection(field)) return;
      if (unsungDuetEnterReentry) return;
      if (getCurrentDicebotId() !== "unsung-duet") return;

      const original = field.value;
      const replaced = replaceUnsungDuetTriggers(original);
      if (replaced === original) return;

      // ?몃━嫄?諛쒓껄 ????Enter??留됯퀬, value 移섑솚 ??React state媛 媛깆떊???쒓컙??
      // 以 ????Enter ???대깽?몃? ?щ컻?≫빐??CCFOLIA 梨꾪똿 ?꾩넚 ?몃뱾?щ? 源⑥?
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

          // ?쇰? 鍮뚮뱶??form submit?쇰줈 諛쒖넚?섎?濡?form fallback???쒕룄
          const form = field.closest("form");
          if (form && typeof form.requestSubmit === "function") {
            try { form.requestSubmit(); } catch (error) { /* requestSubmit ?ㅽ뙣 臾댁떆 */ }
          }

          // 蹂몄씤??諛쒖넚???몃━嫄?硫붿떆吏 ??怨?而룹씤???ъ깮??
          // ?ㅼ쓬 N珥덇컙 YouTube iframe?쇰줈 媛??pauseVideo 紐낅졊??李⑤떒??
          // BGM???쇱떆?뺤??섏? ?딅룄濡??쒖떆.
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
      button.textContent = enabled ? `${themeName} ?뚮쭏: ON` : `${themeName} ?뚮쭏: OFF`;
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
    }
    const panelSelect = document.getElementById(SHEET_THEME_SELECT_PANEL_ID);
    if (panelSelect instanceof HTMLSelectElement && panelSelect.value !== selectedId) {
      panelSelect.value = selectedId;
    }
  }

  // ?좉? OFF ?????대? 梨꾪똿???몄젥?몃맂 <img>? 留덊궧??li ?띿꽦??泥?냼??
  // CCFOLIA ?먮낯 硫붿떆吏媛 ?ㅼ떆 ?띿뒪??洹몃?濡?蹂댁씠?꾨줉 蹂듭썝.
  function revertUnsungDuetDomState() {
    document.querySelectorAll(`.${UNSUNG_DUET_IMG_CLASS}`).forEach((img) => {
      const url = img.getAttribute("src") || "";
      const alt = UNSUNG_DUET_URL_TO_ALT[url] || "";
      const parent = img.parentNode;
      if (!parent) return;
      // 媛?ν븯硫??먮낯 [?대?吏](URL) ?띿뒪?몃줈 蹂듭썝
      const restored = document.createTextNode(`[?대?吏](${url})`);
      parent.replaceChild(restored, img);
    });
    document.querySelectorAll(`[${UNSUNG_DUET_MSG_INJECTED_ATTR}="1"]`).forEach((el) => {
      el.removeAttribute(UNSUNG_DUET_MSG_INJECTED_ATTR);
    });
    revertCreeGrrrDomState();
  }

  // ?뚮쭏 ?꾪솚/?좉? ON 吏곹썑 ?몄텧 ???듭?踰꾨? 湲곕떎由ъ? ?딄퀬 湲곗〈 硫붿떆吏?먮룄 利됱떆
  // ???뚮쭏???몄젥?섏쓣 ?곸슜. (?듭?踰꾨뒗 ??mutation ?먮쭔 諛섏쓳?섎?濡?湲곗〈 硫붿떆吏媛
  // ?꾨씫?섎뒗 臾몄젣瑜??뚰뵾.)
  function reapplySheetThemeInjections() {
    try {
      bindUnsungDuetTriggerFields();
      injectUnsungDuetMessageImages();
      injectCreeGrrrDiceFormatting();
    } catch (error) { /* ?몄젥???ㅽ뙣??臾댁떆 ???ㅼ쓬 mutation ?먯꽌 ?ъ떆??*/ }
  }

  // React-safe 移대뱶 遺李? host(p.MuiTypography-*)???먮낯 children ? ?먮?吏 ?딄퀬
  // 移대뱶留?留덉?留됱뿉 append. CCFOLIA React 媛 host ??firstChild(?띿뒪???몃뱶)瑜?
  // 洹몃?濡?李얠쓣 ???덉뼱??reconciliation ??源⑥?吏 ?딆쓬. ?먮낯 ?띿뒪?몃뒗 CSS 濡??④?.
  function attachCreeGrrrCard(host, card, text) {
    if (!(host instanceof HTMLElement) || !(card instanceof HTMLElement)) return;
    host.setAttribute(CREE_GRRR_ORIGINAL_ATTR, text);
    host.setAttribute(CREE_GRRR_FORMATTED_ATTR, "1");
    host.closest("li")?.setAttribute(CREE_GRRR_MESSAGE_ROW_ATTR, "1");
    // 媛숈? host ???대? ?ㅻⅨ 移대뱶媛 遺숈뼱 ?덉쑝硫??쒓굅 (?ъ떎???鍮?
    host.querySelectorAll(`:scope > .${CREE_GRRR_CARD_CLASS}, :scope > .${CREE_GRRR_SIMPLE_CARD_CLASS}`)
      .forEach((existing) => existing.remove());
    host.appendChild(card);
  }

  // CREE-GRRR! 移대뱶 ?몄젥??蹂듭썝 ??移대뱶瑜??쒓굅?섍퀬 host ??留덊궧留??쒓굅.
  // ?먮낯 ?띿뒪?몃뒗 洹몃?濡??먮?濡?textContent 蹂듭썝??遺덊븘?? (洹멸쾶 React-safe.)
  function revertCreeGrrrDomState() {
    document.querySelectorAll(`[${CREE_GRRR_FORMATTED_ATTR}="1"]`).forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      // ?대? 移대뱶留??쒓굅 ??host ???먮낯 ?띿뒪???섎━癒쇳듃 children ? 洹몃?濡?蹂댁〈
      el.querySelectorAll(`:scope > .${CREE_GRRR_CARD_CLASS}, :scope > .${CREE_GRRR_SIMPLE_CARD_CLASS}`)
        .forEach((card) => card.remove());
      // ?뱀떆 display:none ?쇰줈 ?④꺼?⑤뜕 耳?댁뒪 ?명솚 蹂듭썝
      if (el.style && el.style.display === "none") {
        el.style.display = "";
      }
      el.removeAttribute(CREE_GRRR_ORIGINAL_ATTR);
      el.removeAttribute(CREE_GRRR_FORMATTED_ATTR);
    });
    document.querySelectorAll(`[${CREE_GRRR_MESSAGE_ROW_ATTR}]`).forEach((row) => {
      row.removeAttribute(CREE_GRRR_MESSAGE_ROW_ATTR);
    });
    // ?뱀떆 ?대뵖媛 ?⑥븘 ?덈뒗 移대뱶 ?몃뱶 ?뺣━ (諛⑹뼱?? ???ㅽ궗 移대뱶 + ?쇰컲 移대뱶 ????
    document.querySelectorAll(`.${CREE_GRRR_CARD_CLASS}, .${CREE_GRRR_SIMPLE_CARD_CLASS}`).forEach((card) => card.remove());
    cleanupLegacyCreeGrrrSpans();
  }

  // ?댁쟾 踰꾩쟾(v0.1.x) ??留뚮뱺 ?몃씪??諭껋? span ?붿〈臾쇱쓣 ?띿뒪?몃줈 蹂듭썝.
  // CSS 罹먯떆 / ??DOM ?곹깭濡??명빐 梨꾪똿쨌?뚮┝ ?앹뾽???댁븘 ?덈뒗 寃쎌슦瑜?泥?냼.
  function cleanupLegacyCreeGrrrSpans() {
    const selector = `.${CREE_GRRR_ROLLRESULT_CLASS}, .${CREE_GRRR_STATUS_CLASS}`;
    document.querySelectorAll(selector).forEach((span) => {
      if (!(span instanceof HTMLElement)) return;
      const parent = span.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(span.textContent || ""), span);
    });
  }

  // CREE-GRRR!: 梨꾪똿 ?ㅼ씠???먯젙 寃곌낵瑜?Roll20 ?쒗듃 移대뱶濡??泥?
  // ?대옒???섏〈?깆쓣 ?꾩쟾???쒓굅?섍퀬 ?띿뒪???몃뱶 ?먯껜瑜??ㅼ틪 ???대뼡 CCFOLIA 鍮뚮뱶??
  // ?ㅼ씠???⑦꽩???덈뒗 ?띿뒪?몃㈃ 臾댁“嫄?罹≪쿂. ?띿뒪???몃뱶??遺紐??붿냼媛 host 媛 ?섏뼱
  // 洹??덉뿉??移대뱶濡?援먯껜.
  //
  // parser 媛 ?꾧꺽?댁꽌(target + ?붿궡??+ 援대┝媛? ?곕?吏/?쇰컲 援대┝? ?듦낵 紐삵븿.
  // 吏꾩쭨 ?ㅻ쾭?덉씠 UI(?ㅼ씠?쇰줈洹?硫붾돱/?댄똻) ??蹂꾨룄 ?쒖쇅.
  const CREE_GRRR_SKIP_ANCESTOR_SELECTOR = [
    `[role="dialog"]`,
    `[role="menu"]`,
    `[role="menuitem"]`,
    `[role="tooltip"]`,
    `.MuiTooltip-popper`,
    `.MuiDialog-paper`,
    `.MuiPopover-paper`,
    `.MuiSnackbar-root`
  ].join(", ");
  // ?띿뒪???몃뱶 ?ъ쟾 ?꾪꽣 ???ㅼ씠??紐낅졊+?붿궡??寃곌낵媛 紐⑤몢 ?덈뒗 ?띿뒪?몃쭔 ?듦낵.
  // ?몃━嫄?醫낅쪟:
  //   (1) CC<=N / CCB<=N / CCS<=N        ???ㅽ궗 ?먯젙 移대뱶 (243횞370)
  //   (2) (1D100<=N)                      ???ㅽ궗 ?먯젙 移대뱶 (CC ?놁씠 d100 留??덈뒗 耳?댁뒪)
  //   (3) \d*[dD]\d+ (?쇰컲 ?ㅼ씠???쒓린)   ???쇰컲 ?ㅼ씠??移대뱶 (媛꾨떒?????섏떇)
  const CREE_GRRR_TEXT_FAST_PATTERN =
    /(CC[BS]?<=\d|\(\s*1D100\s*<=\s*\d|\d*[dD]\d+).*[?믭폔>]\s*\d/is;

  // ?붾쾭洹몄슜 ?곹깭 ??泥??몄텧 ????踰덈쭔 吏꾨떒 濡쒓렇瑜??꾩썙 ?⑥닔 ?꾨떖 ?щ??
  // ?뚮쭏 寃뚯씠???곹깭瑜?肄섏넄濡??뺤씤?????덇쾶 ?쒕떎. 留?mutation 留덈떎 濡쒓렇媛
  // ?볦씠吏 ?딅룄濡??쇳쉶?? console.warn ?ъ슜 (Chrome DevTools ??湲곕낯 ?꾪꽣
  // ?먯꽌???덉쟾?섍쾶 ?쒖떆?섎ŉ, info 蹂대떎 ?쒓컖?곸쑝濡??먮뱶?ъ쭊??.
  const creeGrrrInjectState = {
    firstCallLogged: false,
    lastSampleLogged: 0,
    callCount: 0
  };

  function injectCreeGrrrDiceFormatting() {
    creeGrrrInjectState.callCount++;

    const enabled = isSheetThemeEnabled();
    const themeId = getSelectedSheetThemeId();

    if (!enabled) return;
    if (themeId !== "cree-grrr") return;
    cleanupLegacyCreeGrrrSpans();
    if (!document.body) return;

    // 梨꾪똿 硫붿떆吏 蹂몃Ц ?꾨낫 ??CCFOLIA 鍮뚮뱶蹂꾨줈 ??됲꽣媛 ?ㅼ뼇?댁꽌 ?볤쾶 ?〓뒗??
    // (1) MuiTypography body1/body2 ??p/div/span 紐⑤몢 ?꾨낫
    // (2) ?대? 泥섎━???몃뱶???쒖쇅
    // (3) ?ㅽ궢 議곗긽(?ㅼ씠?쇰줈洹?硫붾돱/?댄똻) ?덉뿉 ?덉쑝硫??섏쨷??closest 濡?嫄곕Ⅸ??
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
        // ?ㅼ씠???⑦꽩???녿뒗 ?쇰컲 梨꾪똿 ??移댁슫?몃쭔 (?뺤긽)
        fastPatternMissed++;
        return;
      }

      if (!sampleText) sampleText = text.slice(0, 120);

      // (a) CC<= ?ㅽ궗 ?먯젙 移대뱶 ?곗꽑 ?쒕룄. 留ㅼ묶?섎㈃ ??移대뱶(243횞370) ?앹꽦.
      const parsed = parseCreeGrrrDiceRoll(text);
      if (parsed) {
        transformed++;
        if (!parsed.skill) {
          try {
            console.warn("[CREE-GRRR!] skill name empty ??raw text follows:", text);
          } catch (_) { /* ignore */ }
        }
        const card = buildCreeGrrrDiceCard(parsed);
        attachCreeGrrrCard(host, card, text);
        return;
      }

      // (b) CC<= 媛 ?꾨땶 ?쇰컲 ?ㅼ씠??援대┝(1D10+5, ?곕?吏 ??? 而댄뙥??移대뱶 ?쒕룄.
      const simple = parseCreeGrrrSimpleDiceRoll(text);
      if (simple) {
        transformed++;
        const card = buildCreeGrrrSimpleDiceCard(simple);
        attachCreeGrrrCard(host, card, text);
        return;
      }

      // ?대뒓 履쎈룄 留ㅼ묶 ????
      parserMissed++;
    });

    // ?ㅼ씠???⑦꽩? 蹂댁??붾뜲 ?뚯떛???ㅽ뙣?덇굅?? 蹂?섏씠 ?쇱뼱?ъ쓣 ?뚮쭔 濡쒓렇.
    // (?쇰컲 梨꾪똿留??ㅼ뼱???fastPatternMissed 留??붾쑊 ?볦씠??寃쎌슦??議곗슜??臾댁떆.)
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

  // CoC 7???먯젙 硫붿떆吏 ?뚯떛.
  //   ?낅젰 ?? "CC<=60 嫄닿컯 (1D100<=60) 蹂대꼫?? ?⑤꼸??二쇱궗??0] 竊?43 竊?43 竊?蹂댄넻 ?깃났"
  //   諛섑솚: { skill, target, halfTarget, fifthTarget, rollValue, status, statusKind }
  //   留ㅼ묶 ?ㅽ뙣 ??null (移대뱶 誘몄깮?? 硫붿떆吏 ?먮낯 ?좎?).
  function parseCreeGrrrDiceRoll(text) {
    if (!text || typeof text !== "string") return null;

    // ?먯젙湲곗? (target): CC<=N ?곗꽑, ?놁쑝硫?(1D100<=N) ?먯꽌 異붿텧
    let target = null;
    const ccMatch = text.match(/CC[BS]?<=(\d+)/i);
    const d100Match = text.match(/\(\s*1D100\s*<=\s*(\d+)\s*\)/i);
    const targetSource = ccMatch || d100Match;
    if (targetSource) target = parseInt(targetSource[1], 10);
    if (target === null || !Number.isFinite(target) || target < 1) return null;

    // ?ㅽ궗紐???"CC<=N <skill> (1D100<=N)" ?뺤떇??BCDice ?쒖? 異쒕젰.
    // ?ㅽ궗紐낆뿉 愿꾪샇媛 ?ы븿?????덉쓬 (?? "援먯쑁(吏??", "?щ━???멸컙)") ?대?濡?
    // ?댁쟾??[^()]+? ??遺?곹빀. `.+?` 濡?紐⑤뱺 臾몄옄 ?덉슜?섎릺 醫낅즺 留덉빱瑜?
    // `\(\s*1D100\s*<=` 濡??≪븘 ?꾩냽 留ㅼ묶??源⑥?吏 ?딄쾶 ?쒕떎.
    // ?먰븳 CCFOLIA 媛 硫붿떆吏???쎌엯?섎뒗 zero-width 臾몄옄(U+200B~U+200F, U+2060,
    // U+FEFF, U+2028~U+202F)??紐⑤몢 ?쒓굅.
    let skill = "";
    const skillBetween = text.match(/CC[BS]?<=\d+\s+(.+?)\s*\(\s*1D100\s*<=/i);
    if (skillBetween) {
      skill = skillBetween[1]
        .replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/g, "")
        .trim();
    }
    if (!skill) {
      // (2) prefix 耳?댁뒪: 以??쒖옉遺??CC<=N 吏곸쟾源뚯????띿뒪??以?留덉?留??⑥뼱援?
      //     ?? "吏꾩쿇: 踰뺣쪧 CC<=5 (1D100<=5) ..." ??"踰뺣쪧"
      //     梨꾪똿 ?됰꽕??肄쒕줎 ?깆? 留덉?留?':' ?댄썑 遺遺꾨쭔 ?ъ슜.
      const prefixMatch = text.match(/^([^\n]*?)\s*CC[BS]?<=/i);
      if (prefixMatch) {
        let prefix = prefixMatch[1]
          .replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/g, "");
        const lastColon = Math.max(prefix.lastIndexOf(":"), prefix.lastIndexOf("竊?));
        if (lastColon >= 0) prefix = prefix.slice(lastColon + 1);
        prefix = prefix.trim().replace(/^["????\[]+|["????\]]+$/g, "").trim();
        // ?됰꽕??媛숈? ?덈Т 湲?prefix ???ㅽ궗紐낆쑝濡???爾먮룄 ??(20???댄븯留?
        if (prefix && prefix.length <= 20 && !/^\d+$/.test(prefix)) {
          skill = prefix;
        }
      }
    }
    // (3) trailing ?꾨왂? "蹂대꼫?? ?⑤꼸??二쇱궗?? 媛숈? BCDice ?뺥삎 ?띿뒪?몃?
    //     ?ㅼ씤?앺븷 ?꾪뿕??而ㅼ꽌 ?쒓굅. ??(1)(2) 媛 ?ㅽ뙣?섎㈃ ?ㅽ궗紐?鍮꾩?.

    // 援대┝媛?(rollValue): 紐⑤뱺 "竊?>/??N" 以?留덉?留??レ옄 (蹂대꼫???섎꼸???곸슜 ??理쒖쥌媛?
    const arrowRe = new RegExp(CREE_GRRR_ARROW_CLASS + "\\s*(\\d+)(?!\\d)", "g");
    const rolls = [];
    let am;
    while ((am = arrowRe.exec(text)) !== null) {
      const n = parseInt(am[1], 10);
      if (n >= 1 && n <= 100) rolls.push(n);
    }
    if (rolls.length === 0) return null;
    const rollValue = rolls[rolls.length - 1];

    // ?먯젙?④퀎: 硫붿떆吏 ?앹そ??留덉?留??곹깭 ?ㅼ썙??
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

  // ?쒖떆???먯젙?④퀎媛 ?깃났瑜섏씤吏 ?ㅽ뙣瑜섏씤吏 遺꾨쪟 (?띿뒪???됱긽??.
  function classifyCreeGrrrStatus(status) {
    if (!status) return "neutral";
    if (/(?ㅽ뙣|?뚮툝)/.test(status)) return "fail";
    return "success";
  }

  // 移대뱶 DOM ?앹꽦 ???ㅽ궗紐끒?媛??묒? ?먃룻겙 以묒븰 ?먃룹긽???띿뒪??
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

  // ?쇰컲 ?ㅼ씠??援대┝ ?뚯떛 (CC<= 媛 ?꾨땶 紐⑤뱺 ?ㅼ씠??寃곌낵).
  //   ?낅젰 ?? "(1D10+33+1D5) 竊?5[1D10]+33+3[1D5] 竊?41"
  //           "1D100 竊?84"
  //           "(2D6) 竊?5+3 竊?8"
  //   諛섑솚: { formula: "1D10+33+1D5", result: 41 } ?먮뒗 null
  //   CC<= ?먮뒗 (1D100<=N) ???ы븿???띿뒪?몃뒗 ?ㅽ궗 ?먯젙 移대뱶 履쎌쑝濡??묐낫.
  function parseCreeGrrrSimpleDiceRoll(text) {
    if (!text || typeof text !== "string") return null;
    // CC<= ?ㅽ궗 ?먯젙/d100 ?먯젙? ?ㅽ궗 移대뱶 履쎌뿉??泥섎━?섎?濡??ш린???묐낫
    if (/CC[BS]?<=\d/i.test(text)) return null;
    if (/\(\s*1D100\s*<=\s*\d/i.test(text)) return null;

    // ?ㅼ씠???섏떇 留ㅼ묶 ??NdM ?뺥깭(+/-/* 濡??곌껐??異붽? ???ы븿).
    // ?쒕룄 ?곗꽑?쒖쐞:
    //   1. "(formula)" 泥섎읆 愿꾪샇濡??섎윭?몄씤 BCDice 紐낅졊遺 ?곗꽑
    //   2. ?놁쑝硫?泥??깆옣?섎뒗 NdM ?좏겙遺???섏떇 ?앷퉴吏
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

    // 理쒖쥌 寃곌낵 ??留덉?留??붿궡?????レ옄
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

  // ?쇰컲 ?ㅼ씠??移대뱶 DOM ??醫뚯륫 ?먰삎 寃곌낵媛?+ ?곗륫 ?섏떇 ?쇰꺼.
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

  // CCFOLIA ?먯젙 ?띿뒪????CREE-GRRR! ?쒗듃(Roll20) ?쒖떆 紐낆묶 留ㅽ븨.
  //   ??ㅽ뙣          ????ㅽ뙣        (?? d100 寃곌낵媛 100 ?대㈃ "?뚮툝")
  //   ?ㅽ뙣            ???ㅽ뙣         (?? d100 寃곌낵媛 96~99 ?대㈃ "移섎챸???ㅽ뙣")
  //   蹂댄넻 ?깃났       ???깃났
  //   ?대젮???깃났     ???대젮???깃났
  //   ??⑦븳 ?깃났     ??洹밸떒???깃났
  //   ??깃났          ???ㅽ럹??      (?? d100 寃곌낵媛 1 ?대㈃ "?щ━?곗뺄")
  function mapCcfStatusToCreeGrrr(ccfTerm, rollValue) {
    if (typeof ccfTerm !== "string") return ccfTerm;
    const normalized = ccfTerm.replace(/\s+/g, "");
    switch (normalized) {
      case "??ㅽ뙣":      return rollValue === 100 ? "?뚮툝" : "??ㅽ뙣";
      case "?ㅽ뙣":
        return (rollValue !== null && rollValue >= 96 && rollValue <= 99)
          ? "移섎챸???ㅽ뙣"
          : "?ㅽ뙣";
      case "蹂댄넻?깃났":    return "?깃났";
      case "?대젮?댁꽦怨?:  return "?대젮???깃났";
      case "??⑦븳?깃났":  return "洹밸떒???깃났";
      case "??깃났":      return rollValue === 1 ? "?щ━?곗뺄" : "?ㅽ럹??;
      default:            return ccfTerm;
    }
  }

  function bindUnsungDuetTriggerFields() {
    // dicebot??unsung-duet???뚮쭔 ?좉퇋 ?꾨뱶 諛붿씤?????ㅻⅨ ?ㅼ씠?ㅻ큸?????ъ씠???댄럺???놁쓬
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

  // 梨꾪똿 濡쒓렇 硫붿떆吏?먯꽌 ?뚮젮吏?imgur URL??<img>濡??몃씪??移섑솚.
  // CCFOLIA媛 硫붿떆吏 ?띿뒪????URL???먮룞 ?꾨쿋?쒗븯吏 ?딄린 ?뚮Ц???대씪?댁뼵??
  // 履쎌뿉??DOM??吏곸젒 ?대?吏 ?붿냼瑜??쇱썙 ?ｌ뼱 ?쒓컖?곸쑝濡?蹂댁씠寃??쒕떎.
  //
  // ?몄떇?섎뒗 ?⑦꽩 (紐⑤몢 泥섎━):
  //   1) [?대?吏](https://i.imgur.com/XXXX.png) - 留덊겕?ㅼ슫 留곹겕 ?띿뒪??
  //   2) <a href="https://i.imgur.com/XXXX.png">??/a> - ?뚮뜑??留곹겕 ?붿냼
  //   3) https://i.imgur.com/XXXX.png - raw URL ?띿뒪??
  function injectUnsungDuetMessageImages() {
    if (getCurrentDicebotId() !== "unsung-duet") return;

    // 梨꾪똿 硫붿떆吏媛 ?ㅼ뼱 ?덉쓣 ???덈뒗 媛?ν븳 紐⑤뱺 而⑦뀒?대꼫??li瑜??ㅼ틪
    // (CCFOLIA??梨꾪똿 ?곸뿭? 鍮뚮뱶/踰꾩쟾???곕씪 ?ㅼ뼇????됲꽣瑜?媛吏????덉쓬)
    const messages = document.querySelectorAll(
      `li:not([${UNSUNG_DUET_MSG_INJECTED_ATTR}="1"])`
    );

    let anyInjected = false;
    messages.forEach((message) => {
      if (!(message instanceof HTMLElement)) return;

      // 鍮좊Ⅸ ?ъ쟾 ?꾪꽣: 硫붿떆吏 ?띿뒪?몄뿉 ?뚮젮吏?URL ?쇰? ?먮뒗 [?대?吏](媛 ?ы븿?섏뼱 ?덈뒗吏
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
    if (text.indexOf("[?대?吏](") >= 0) return true;
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

  // === YouTube pauseVideo 紐낅졊 媛濡쒖콈湲?==================================
  // ?댁쟾 ?묎렐(?ㅼ쨷 playVideo ?몄텧)? BGM怨??숈떆 ?ъ깮? ?깃났?덉?留?而룹씤 醫낅즺 ??
  // CCFOLIA ?대? BGM 而⑦듃濡ㅻ윭 ?곹깭媛 desync ?섎뒗 遺?묒슜???덉뿀??BGM01 ?고듃??
  // 蹂寃? 鍮④컯 諭껋? ?щ씪吏? ?ъ깮諛?誘몃났洹). 洹몃옒???묎렐??諛붽퓭?? CCFOLIA媛
  // ?좎큹??YouTube iframe??pauseVideo 紐낅졊??蹂대궡吏 紐삵븯寃?媛濡쒖콌??
  // ?대젃寃??섎㈃ CCFOLIA 而⑦듃濡ㅻ윭??BGM??怨꾩냽 ?ъ깮 以묒씠?쇨퀬 ?몄떇?섎?濡?desync ?놁쓬.
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

  // 而룹씤 ?쒖꽦 ?덈룄?????몃━嫄?硫붿떆吏媛 諛쒖깮/媛먯???吏곹썑 N珥덇컙留?pauseVideo 李⑤떒.
  // ?됱냼(而룹씤???녿뒗 ?쇰컲 ?곹솴)?먮뒗 ?ъ슜?먭? BGM???섎룞 ?쇱떆?뺤??섎㈃ ?뺤긽 ?묐룞.
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
        // ?ㅼ씠?ㅻ큸???몄꽦 ??ｌ씠怨? 而룹씤 ?쒖꽦 ?덈룄???덉씠硫?
        // ?源껋씠 YouTube iframe contentWindow???뚮쭔 pauseVideo 李⑤떒
        if (
          this !== window &&
          getCurrentDicebotId() === "unsung-duet" &&
          isUnsungDuetCutinActive() &&
          isYouTubeContentWindow(this) &&
          typeof message === "string"
        ) {
          const parsed = JSON.parse(message);
          if (parsed && parsed.event === "command" && parsed.func === "pauseVideo") {
            return; // pauseVideo 李⑤떒
          }
        }
      } catch (error) { /* JSON ?뚯떛 ?ㅽ뙣 ?????뺤긽 ?먮쫫?쇰줈 ?듦낵 */ }
      return originalPostMessage.apply(this, [message, ...rest]);
    };

    ccfThemeRegisterTeardown(() => {
      try { Window.prototype.postMessage = originalPostMessage; }
      catch (error) { /* prototype 蹂듭썝 ?ㅽ뙣 臾댁떆 */ }
      window.__ccfUnsungDuetPauseInterceptorInstalled = false;
    });
  }

  // 梨꾪똿 硫붿떆吏 ?띿뒪?몄뿉??留ㅼ묶???⑦꽩 ?????뺥깭 紐⑤몢 泥섎━:
  //   洹몃９1: [?대?吏](URL) ?덉쓽 URL
  //   洹몃９2: raw URL
  //   洹몃９3: ?먥╉??몃━嫄??띿뒪??(CCFOLIA ?ㅼ씠?ㅻ큸???먮Ц??洹몃?濡?echo back????
  const UNSUNG_DUET_TEXT_PATTERN = /\[?대?吏\]\((https:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.png)\)|(https:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.png)|(???:?쒗봽???먯젙|諛붿씤???먯젙|?꾨옒洹몃㉫???④낵|?닿퀎????/g;

  function replaceTextNodesWithImages(root) {
    if (!(root instanceof HTMLElement)) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent) return NodeFilter.FILTER_REJECT;
        const parent = node.parentNode;
        if (parent instanceof HTMLElement) {
          const tag = parent.tagName;
          if (tag === "SCRIPT" || tag === "STYLE" || tag === "IMG" || tag === "A") {
            // <a> ?덉쓽 ?띿뒪?몃뒗 蹂꾨룄 replaceAnchorsWithImages 濡?泥섎━
            return NodeFilter.FILTER_REJECT;
          }
        }
        // ?뚮젮吏?URL / [?대?吏]( / ?먥╉??몃━嫄??띿뒪??以??섎굹?쇰룄 ?덈뒗吏 ?ъ쟾 ?꾪꽣
        const t = node.textContent;
        if (t.indexOf("[?대?吏](") >= 0) return NodeFilter.FILTER_ACCEPT;
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
        // URL 留ㅼ묶 (洹몃９1쨌2) ?먮뒗 ?몃━嫄??띿뒪??留ㅼ묶 (洹몃９3) ???대뒓 履쎌씠??URL濡??뺢퇋??
        let url = match[1] || match[2];
        let alt = url ? UNSUNG_DUET_URL_TO_ALT[url] : "";
        if (!url && match[3]) {
          url = UNSUNG_DUET_URLS[match[3]] || "";
          alt = match[3].replace(/[?먦?/g, "");
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
      if (!ccfThemeLifecycle.isActive()) return;
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
      if (!ccfThemeLifecycle.isActive()) return;
      updatePanelPosition();
    });
  }

  function queueTogglePositionUpdate() {
    if (toggleLayoutFrame) return;
    toggleLayoutFrame = window.requestAnimationFrame(() => {
      toggleLayoutFrame = 0;
      if (!ccfThemeLifecycle.isActive()) return;
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
      if (!ccfThemeLifecycle.isActive()) return;
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
        window.alert("媛?몄삱 ???덈뒗 ?뚮쭏 ?뚯씪???꾨떃?덈떎.");
        return false;
      }

      upsertSavedTheme(imported);
      return true;
    } catch (error) {
      console.warn("[CCF Theme] failed to import theme", error);
      window.alert("?뚮쭏 ?뚯씪???쎌? 紐삵뻽?듬땲??");
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
      window.alert("??젣??????뚮쭏瑜?癒쇱? ?좏깮??二쇱꽭??");
      return false;
    }

    if (!window.confirm(`"${savedTheme.name}" ?뚮쭏瑜???젣?좉퉴??`)) {
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
      setStatus("?뚮쭏 ?대쫫???낅젰??二쇱꽭??", "error");
      input?.focus({ preventScroll: true });
      input?.select();
      return;
    }

    const theme = normalizeTheme(getUiThemePreview() || settings.customTheme || DEFAULT_CUSTOM_THEME);
    const nextTheme = upsertSavedTheme({ name, theme });

    closeSaveThemeDialog();
    setStatus(nextTheme?.existing ? "湲곗〈 ?뚮쭏瑜???뼱?쇱뒿?덈떎." : "???뚮쭏瑜???ν뻽?듬땲??", "success");
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
      name: normalizeThemeName(value.name || stripFileExtension(fileName), "媛?몄삩 ?뚮쭏"),
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
        return "?쇱씠??;
      case MODE_CUSTOM:
        return "而ㅼ뒪?";
      default:
        return "湲곕낯媛?;
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
          'button[aria-label="罹먮┃???좏깮"]',
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
      setStatus("?ㅼ젙????ν븯吏 紐삵뻽?듬땲??", "error");
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
      // ?쒗듃 ?뚮쭏 留덉뒪??ON/OFF (?덇굅???명솚 ?꾪빐 unsungDuetEnabled ???좎?)
      unsungDuetEnabled: true,
      // ?쒕∼?ㅼ슫?쇰줈 ?좏깮??而ㅼ뒪? ?쒗듃 ?뚮쭏 id (SHEET_THEMES.id 以??섎굹)
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

  function normalizeThemeName(value, fallback = "???뚮쭏") {
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
      messageDivider: rgbaString(mixRgb(borderRgb, textRgb, isLight ? 0.16 : 0.08), isLight ? 0.82 : 0.42),
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
        if (!ccfThemeLifecycle.isActive()) return;
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
