// ==UserScript==
// @name         CCFOLIA Suite Manager by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-suite
// @version      0.4.0
// @description  Manages installed CCFOLIA suite scripts and shows update notices.
// @description:ko CCFOLIA용 스위트 스크립트 설치 상태를 확인하고 업데이트 알림을 보여줍니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const SESSION_STARTED_AT = new Date().toISOString();
  const SESSION_ID = `ccf-suite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const REGISTRY_KEY = "ccf-suite-registry-v1";
  const SETTINGS_KEY = "ccf-suite-manager-settings-v1";
  const SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const REMOTE_CATALOG_KEY = "ccf-suite-remote-catalog-v1";
  const REGISTER_EVENT = "ccf-suite:register";
  const REQUEST_EVENT = "ccf-suite:request-register";
  const REQUEST_DELAYS = [120, 900, 2400];
  const REMOTE_CATALOG_TTL_MS = 1000 * 60 * 60 * 6;
  const REMOTE_FETCH_TIMEOUT_MS = 8000;
  const GREASY_FORK_API_URLS = Object.freeze([
    "https://api.greasyfork.org",
    "https://greasyfork.org"
  ]);
  const SUITE_MANAGER_SCRIPT = Object.freeze({
    id: "ccf-suite-manager",
    name: "CCFOLIA Suite Manager",
    version: getUserscriptVersion("0.1.0"),
    greasyForkScriptId: 570244,
    installUrl: "https://greasyfork.org/ko/scripts/570244-ccf-suite-manager-by-capybara-korea"
  });
  const ROOT_FLOATING_ATTR = "data-ccf-suite-floating";
  const PRIMARY_ANCHOR_LABELS = Object.freeze([
    "내 캐릭터 목록",
    "캐릭터 선택",
    "マイキャラクター一覧",
    "キャラクター選択",
    "My character list",
    "My characters",
    "Character selection",
    "Select character"
  ]);
  const SECONDARY_ANCHOR_FRAGMENTS = Object.freeze([
    "내 캐릭터",
    "캐릭터",
    "character",
    "キャラクター"
  ]);
  const DICE_ANCHOR_LABELS = Object.freeze(["D4", "D6", "D8", "D10", "D12", "D20", "D100"]);
  const LEGACY_INSTALL_SELECTORS = Object.freeze({
    "ccf-format-sync": Object.freeze([
      "#ccf-render-style",
      "#ccf-format-style",
      "#ccf-format-modal",
      ".ccf-open-btn[data-ccf-open-btn=\"1\"]"
    ]),
    "ccf-theme-switcher": Object.freeze([
      "#ccf-theme-switcher-style",
      "#ccf-theme-switcher-toggle",
      "[data-ccf-theme-switcher-root=\"1\"]",
      "[data-ccf-theme-switcher-ui=\"1\"]"
    ]),
    "ccf-roll20-css-bridge": Object.freeze([
      "#ccr20-style",
      "#ccr20-modal",
      "#ccr20-floating",
      ".ccr20-open-btn[data-ccr20-open-btn=\"1\"]"
    ]),
    "ccf-chat-notifier": Object.freeze([
      "#ccf-bgm-enhancer-style",
      "[data-ccf-bgm-panel=\"1\"]",
      "[data-ccf-bgm-progress-host=\"1\"]",
      "[data-ccf-youtube-bgm-registered]"
    ])
  });
  const HIDDEN_SCRIPT_IDS = Object.freeze(new Set([
    "ccf-log-package",
    "ccf-log-package-all-tabs"
  ]));
  const HIDDEN_SCRIPT_NAME_PATTERNS = Object.freeze([
    /^CCF\s+Log\s+Package\s+Exporter\b/i,
    /\bccf-log-package\b/i
  ]);

  const CAPYBARA_ICON_DATA_URL = [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZMAAAGsCAYAAAAYMEoZAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEQAACxEBf2RfkQAAMQ",
    "NJREFUeF7tnQeYZFWZhr/u6h66JzFBYBgkjwLmiMKqoKKuAVkVFUUx4eoa1hUMqyuIeQ3grq4i6pgzuOacc1qzrAorugooqGBEDAv7vM25Wl6qp8NUuFX1vs",
    "/zPiMjdFfdunX/c87/n/8kIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi",
    "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi",
    "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiImPPLrvsknXr1k",
    "2sWbNmcnZ2tjUzM9Piz7Vr17Y2bNjQ2nnnnSc3bdqUiYmJ+n8qIiJyBWefffbk1q1b15544on7H3XUUTc4/PDDb3Tve9/7Rs961rNu+Na3vvU655xzzu6XXn",
    "rpii1bthhQRESkI6smJiY2tVqtw6empj44OTl5QavVurjVav1iamrq51NTU2cecsghp7z+9a+/9kUXXbRun332WWFAERGRuSWtiYmJFv+z1WqdODMz8/HNmz",
    "d/e/Pmzb9cu3btn9avX3/ZTjvtdNnmzZv/b4899vhdq9U6f3p6+ivHHnvsK88666wj9t57bwJQ/ccOGl7QiiSrk6ztIH8/xb/XwNcuIjJc7Ljjjtm6devsyp",
    "UrrzU5Ofncvfba69uTk5O/T3L5fK5du/ayPfbY47Lp6ekLDjvssHecddZZ99l77713aEIeZXZ2lj92SLJrksOTnJLk5Ule0ebLkvxrkgOTbCxBZ3LQr11EZG",
    "g57bTTpmdmZg5Ys2bNv++0004saf1fPXhUTkxMzDk5OXl5q9W6fPfdd798enr64iOPPPIt55133n6XXXZZa82aNfVf0RcIigSEJCuT3C3JSUneleTiJLyndv",
    "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",
    "q9VN1r3IvVGSaV1T1aOd892X6/tv/71X3ebiNKp0VERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERE",
    "RERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERE",
    "RERERERERERERERERERERERERERERERERERERERERERESkI/8P/22UlZVSnCMAAAAASUVORK5CYII=",
  ].join("");

  // Add new suite scripts here. Fill installUrl/changelogUrl once you publish them.
  const CATALOG = Object.freeze([
    {
      id: "ccf-format-sync",
      name: "CCFOLIA Format Sync",
      greasyForkScriptId: 570082,
      latestVersion: "0.0.3",
      summary: "채팅 서식 동기화, Roll20 /desc 지원, 화면 전체 서식 적용",
      installUrl: "https://greasyfork.org/ko/scripts/570082-ccf-format-sync-by-capybara-korea",
      changelogUrl: ""
    },
    {
      id: "ccf-theme-switcher",
      name: "CCFOLIA Theme Switcher",
      greasyForkScriptId: 570241,
      latestVersion: "0.0.2",
      summary: "테마 전환, 캐릭터 색상 변경, 모달 화면 스타일 적용",
      installUrl: "https://greasyfork.org/ko/scripts/570241-ccf-theme-switcher-by-capybara-korea",
      changelogUrl: ""
    },
    {
      id: "ccf-roll20-css-bridge",
      name: "CCFOLIA Roll20 CSS Bridge",
      greasyForkScriptId: 578087,
      latestVersion: "0.2.0",
      summary: "Roll20 /desc CSS 매크로를 CCFOLIA 채팅 서식으로 변환합니다.",
      installUrl: "https://greasyfork.org/ko/scripts/578087-ccfolia-roll20-css-bridge-by-capybara-korea",
      changelogUrl: ""
    },
    {
      id: "ccf-chat-notifier",
      name: "CCFOLIA Chat Notifier",
      greasyForkScriptId: 578091,
      latestVersion: "0.2.0",
      summary: "CCFOLIA 룸이 비활성 상태일 때 새 채팅을 소리로 알립니다.",
      installUrl: "https://greasyfork.org/ko/scripts/578091-ccf-chat-notifier-by-capybara-korea",
      changelogUrl: ""
    }
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    notifyUpdates: true,
    autoOpenOnUpdate: false,
    notifiedVersions: {}
  });

  const state = {
    settings: readSettings(),
    scriptStates: readScriptStates(),
    remoteCatalog: readRemoteCatalog(),
    remoteCatalogRequest: null,
    panelOpen: false,
    expandedCards: {},
    toastTimer: 0,
    noticeTimer: 0
  };

  let ccfSuiteActive = true;
  const ccfSuiteDisposers = [];
  const ccfSuiteAbort = new AbortController();
  const ccfSuiteSignal = ccfSuiteAbort.signal;

  function ccfSuiteRegisterTeardown(fn) {
    if (typeof fn === "function") ccfSuiteDisposers.push(fn);
  }

  function ccfSuiteWithSignal(options) {
    if (options == null) return { signal: ccfSuiteSignal };
    if (typeof options === "boolean") return { capture: options, signal: ccfSuiteSignal };
    if (typeof options === "object") {
      if (options.signal && options.signal !== ccfSuiteSignal) return options;
      return { ...options, signal: ccfSuiteSignal };
    }
    return { signal: ccfSuiteSignal };
  }

  function ccfSuiteTeardown() {
    if (!ccfSuiteActive) return false;
    ccfSuiteActive = false;
    try { ccfSuiteAbort.abort(); } catch (error) { /* abort failed */ }
    while (ccfSuiteDisposers.length) {
      const disposer = ccfSuiteDisposers.pop();
      try { disposer(); } catch (error) { /* disposer failed */ }
    }
    try {
      if (state.toastTimer) { window.clearTimeout(state.toastTimer); state.toastTimer = 0; }
      if (state.noticeTimer) { window.clearTimeout(state.noticeTimer); state.noticeTimer = 0; }
    } catch (error) { /* timer cleanup failed */ }
    try {
      document.getElementById("ccf-suite-root")?.remove();
      document.getElementById("ccf-suite-style")?.remove();
    } catch (error) { /* dom sweep failed */ }
    try {
      if (window.__CCF_SUITE_DEBUG__ && window.__CCF_SUITE_DEBUG__.__owner === ccfSuiteSignal) {
        delete window.__CCF_SUITE_DEBUG__;
      }
    } catch (error) { /* debug api cleanup failed */ }
    return true;
  }

  window.__CCF_SUITE_DEBUG__ = {
    __owner: ccfSuiteSignal,
    isActive() { return ccfSuiteActive; },
    disable() { return ccfSuiteTeardown(); }
  };

  installApi();
  bindEvents();
  waitForBody(() => {
    ensureUi();
    observeAnchor();
  });

  function installApi() {
    window.__CCF_SUITE_MANAGER_SESSION_ID = SESSION_ID;
    window.CCFSuiteManager = Object.freeze({
      sessionId: SESSION_ID,
      openPanel: () => setPanelOpen(true),
      requestRegistration: () => requestRegistrations(),
      isScriptEnabled: (scriptId) => isScriptEnabled(scriptId)
    });
  }

  function bindEvents() {
    window.addEventListener(REGISTER_EVENT, () => {
      render();
      scheduleNotice();
    }, ccfSuiteWithSignal());

    window.addEventListener("storage", (event) => {
      if (event.key === REGISTRY_KEY || event.key === SETTINGS_KEY || event.key === SCRIPT_STATE_KEY || event.key === REMOTE_CATALOG_KEY) {
        if (event.key === SETTINGS_KEY) {
          state.settings = readSettings();
        }
        if (event.key === SCRIPT_STATE_KEY) {
          state.scriptStates = readScriptStates();
        }
        if (event.key === REMOTE_CATALOG_KEY) {
          state.remoteCatalog = readRemoteCatalog();
        }
        render();
        scheduleNotice();
      }
    }, ccfSuiteWithSignal());

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.panelOpen) {
        setPanelOpen(false);
      }
    }, ccfSuiteWithSignal());
  }

  function ensureUi() {
    if (!document.body) return;
    if (isHiddenRoute()) {
      state.panelOpen = false;
      removeRoot();
      return;
    }

    injectStyle();

    let root = document.getElementById("ccf-suite-root");
    const shouldInitialize = !root;

    if (!root) {
      root = document.createElement("div");
      root.id = "ccf-suite-root";
      root.innerHTML = `
        <button
          type="button"
          id="ccf-suite-toggle"
          aria-expanded="false"
          aria-controls="ccf-suite-panel"
          aria-label="CCF Suite ????繹먮굟爰?
          title="CCF Suite ????繹먮굟爰?
        >
          <img class="ccf-suite-toggle-icon" src="${CAPYBARA_ICON_DATA_URL}" alt="">
          <span class="ccf-suite-sr-only">CCF Suite</span>
          <span id="ccf-suite-badge" hidden>0</span>
        </button>
        <aside id="ccf-suite-panel" hidden>
          <div class="ccf-suite-head">
            <div>
              <strong>CCFOLIA Suite Manager</strong>
              <span id="ccf-suite-manager-status" class="ccf-suite-chip-row" aria-live="polite"></span>
              <p>????筌? ????釉먮빱??? ??????띻콣?????썹땟???????????怨뚮뼺?됰뗀????????꿔꺂??틝??????癲ル슢?????</p>
            </div>
            <div class="ccf-suite-head-actions">
              <button type="button" id="ccf-suite-close" aria-label="???????>??/button>
            </div>
          </div>
          <div class="ccf-suite-settings">
            <label><input type="checkbox" id="ccf-suite-notify"> ??????띻콣?????썹땟????????/label>
            <label><input type="checkbox" id="ccf-suite-auto-open"> ??????띻콣?????썹땟??????????걘?????癲?????繹먮굟爰?/label>
          </div>
          <div id="ccf-suite-summary" class="ccf-suite-summary"></div>
          <div id="ccf-suite-list" class="ccf-suite-list"></div>
          <div class="ccf-suite-footer">??????ш끽維쀩?嚥?????멸괜??????살퓢???????????????댁삩????숆강???????ㅳ늾????쒓랜堉????諭??怨뚮뼺?源놁벀?? ??????ш끽維쀩?嚥??????μ떜媛?걫??곸돥????꿔꺂??????쒐춯誘↔틕??????살퓢??????????癲ル슢?????</div>
        </aside>
        <div id="ccf-suite-toast" hidden></div>
      `;

      root.innerHTML = `
        <button
          type="button"
          id="ccf-suite-toggle"
          aria-expanded="false"
          aria-controls="ccf-suite-panel"
          aria-label="CCF Suite 열기"
        >
          <img class="ccf-suite-toggle-icon" alt="">
          <span class="ccf-suite-sr-only">CCF Suite</span>
          <span id="ccf-suite-badge" hidden>0</span>
        </button>
        <aside id="ccf-suite-panel" hidden>
          <div class="ccf-suite-head">
            <div>
              <strong>CCFOLIA Suite Manager</strong>
              <p>설치 상태와 업데이트 여부를 한곳에서 확인합니다.</p>
            </div>
            <div class="ccf-suite-head-actions">
              <button type="button" id="ccf-suite-close" aria-label="닫기">
                <svg class="ccf-suite-close-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="ccf-suite-settings">
            <label><input type="checkbox" id="ccf-suite-notify"> 업데이트 알림</label>
            <label><input type="checkbox" id="ccf-suite-auto-open"> 업데이트 시 패널 자동 열기</label>
          </div>
          <div id="ccf-suite-manager-entry" class="ccf-suite-list ccf-suite-manager-list"></div>
          <div id="ccf-suite-list" class="ccf-suite-list"></div>
          <div id="ccf-suite-summary" class="ccf-suite-summary"></div>
        </aside>
        <div id="ccf-suite-toast" hidden></div>
      `;

      root.querySelector(".ccf-suite-toggle-icon")?.setAttribute("src", CAPYBARA_ICON_DATA_URL);

      root.querySelector("#ccf-suite-toggle")?.addEventListener("click", () => {
        setPanelOpen(!state.panelOpen);
      });

      root.querySelector("#ccf-suite-close")?.addEventListener("click", () => {
        setPanelOpen(false);
      });

      root.querySelector("#ccf-suite-notify")?.addEventListener("change", (event) => {
        updateSettings({ notifyUpdates: !!event.target?.checked });
      });

      root.querySelector("#ccf-suite-auto-open")?.addEventListener("change", (event) => {
        updateSettings({ autoOpenOnUpdate: !!event.target?.checked });
      });

      root.addEventListener("click", (event) => {
        const linkButton = event.target instanceof Element ? event.target.closest("[data-url]") : null;
        const url = linkButton?.getAttribute("data-url");
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      });
    }

    const anchor = findAnchor();
    mountRoot(root, anchor);
    render();

    if (shouldInitialize) {
      requestRegistrations();
      void refreshRemoteCatalog(false);
      scheduleNotice();
    }
  }

  function injectStyle() {
    if (document.getElementById("ccf-suite-style")) return;

    const style = document.createElement("style");
    style.id = "ccf-suite-style";
    style.textContent = `
      #ccf-suite-root {
        position: relative;
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        margin-right: 6px;
        z-index: 2147483000;
        font-family: "Segoe UI", "Malgun Gothic", sans-serif;
        color: inherit;
      }
      #ccf-suite-root[${ROOT_FLOATING_ATTR}="1"] {
        position: fixed;
        top: 16px;
        right: 16px;
        margin-right: 0;
      }
      #ccf-suite-root[${ROOT_FLOATING_ATTR}="1"] #ccf-suite-toggle {
        background: rgba(37, 30, 28, 0.94);
        color: #f8f3ee;
        box-shadow: 0 14px 28px rgba(0, 0, 0, 0.22);
      }
      #ccf-suite-root[${ROOT_FLOATING_ATTR}="1"] .ccf-suite-toggle-icon {
        filter: none;
      }
      #ccf-suite-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: 40px;
        min-width: 40px;
        height: 40px;
        min-height: 40px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        box-shadow: none;
        backdrop-filter: none;
      }
      #ccf-suite-toggle:hover {
        background: rgba(127,127,127,0.12);
      }
      #ccf-suite-toggle:focus-visible {
        outline: none;
        box-shadow: 0 0 0 2px rgba(127,127,127,0.28);
      }
      .ccf-suite-toggle-icon {
        width: 24px;
        height: 24px;
        display: block;
        color: inherit;
        object-fit: contain;
        filter: brightness(0) invert(1);
      }
      .ccf-suite-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      #ccf-suite-badge {
        position: absolute;
        top: 1px;
        right: 0;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        border: 0;
        background: rgba(255,255,255,0.96);
        color: #202020;
        font-size: 10px;
        line-height: 14px;
        text-align: center;
        font-weight: 700;
        box-sizing: border-box;
      }
      #ccf-suite-panel {
        position: absolute;
        right: 0;
        top: calc(100% + 12px);
        width: min(420px, calc(100vw - 28px));
        max-height: min(78vh, 760px);
        overflow: auto;
        padding: 16px;
        border: 0;
        border-radius: 0;
        background: #2a2a2a;
        box-shadow: 0 22px 46px rgba(0,0,0,0.38);
        backdrop-filter: blur(18px);
        color: #f8f3ee;
      }
      #ccf-suite-panel[hidden], #ccf-suite-toast[hidden] { display: none !important; }
      #ccf-suite-toast {
        position: absolute;
        right: 0;
        top: calc(100% + 12px);
        width: min(320px, calc(100vw - 28px));
        padding: 14px 16px;
        border: 0;
        border-radius: 0;
        background: rgba(37,30,28,0.97);
        box-shadow: 0 16px 30px rgba(0,0,0,0.3);
        font-size: 12px;
        line-height: 1.5;
        color: #f8f3ee;
      }
      .ccf-suite-head, .ccf-suite-card-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }
      .ccf-suite-head p, .ccf-suite-meta, .ccf-suite-summary, .ccf-suite-footer, .ccf-suite-card-title span {
        margin: 4px 0 0;
        color: rgba(248,243,238,0.74);
        font-size: 12px;
        line-height: 1.5;
      }
      #ccf-suite-manager-status {
        display: inline-flex;
        margin-left: 8px;
        justify-content: flex-start;
        vertical-align: middle;
      }
      .ccf-suite-head-actions, .ccf-suite-actions, .ccf-suite-toast-actions, .ccf-suite-chip-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .ccf-suite-head-actions button, .ccf-suite-action, .ccf-suite-toast-actions button {
        border: 0;
        border-radius: 0;
        padding: 7px 10px;
        background: rgba(255,255,255,0.08);
        color: inherit;
        cursor: pointer;
      }
      #ccf-suite-close {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        min-width: 32px;
        height: 32px;
        padding: 0;
        background: #2a2a2a;
        transform: translateY(-5px);
      }
      #ccf-suite-close {
        line-height: 1;
      }
      .ccf-suite-close-icon {
        display: block;
        width: 20px;
        height: 20px;
        fill: currentColor;
      }
      .ccf-suite-settings, .ccf-suite-summary {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: 0;
      }
      .ccf-suite-settings {
        background: rgba(255,255,255,0.05);
      }
      .ccf-suite-summary {
        margin-top: 0;
        padding: 12px 6px 0;
        background: #2a2a2a;
      }
      .ccf-suite-settings label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
      .ccf-suite-settings label + label { margin-top: 8px; }
      .ccf-suite-list { display: grid; gap: 10px; margin-top: 14px; }
      .ccf-suite-manager-list { margin-top: 12px; }
      .ccf-suite-card {
        padding: 12px;
        border-radius: 0;
        border: 0;
        background: rgba(255,255,255,0.04);
      }
      .ccf-suite-card[data-version="outdated"] {
        box-shadow: none;
      }
      .ccf-suite-card-head {
        display: block;
      }
      .ccf-suite-card-title {
        min-width: 0;
      }
      .ccf-suite-card-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ccf-suite-card-controls {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        min-height: 24px;
      }
      .ccf-suite-card-title strong {
        display: block;
        font-size: 15px;
      }
      .ccf-suite-card-title .ccf-suite-chip-row {
        justify-content: flex-end;
      }
      .ccf-suite-card-title span { display: block; }
      .ccf-suite-card-description {
        display: block;
        margin: 4px 0 0;
        color: rgba(248,243,238,0.74);
        font-size: 14px;
        line-height: 1.5;
      }
      .ccf-suite-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        height: 24px;
        padding: 0 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
      }
      .ccf-suite-chip-label {
        display: block;
        transform: translateY(-1px);
      }
      .ccf-suite-chip.install-active { background: rgba(126,214,157,0.18); color: #bff2cb; }
      .ccf-suite-chip.install-recorded, .ccf-suite-chip.install-missing, .ccf-suite-chip.version-unknown {
        background: rgba(255,255,255,0.1);
        color: #efe5dd;
      }
      .ccf-suite-chip.version-outdated { background: rgba(255,149,99,0.22); color: #ffd3be; }
      .ccf-suite-manager-chip {
        appearance: none;
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      .ccf-suite-manager-chip:hover {
        filter: brightness(1.08);
      }
      .ccf-suite-manager-chip:focus-visible {
        outline: 2px solid rgba(255,211,190,0.8);
        outline-offset: 2px;
      }
      .ccf-suite-script-toggle {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 24px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        font-weight: 700;
        color: #efe5dd;
      }
      .ccf-suite-script-toggle input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .ccf-suite-script-toggle-track {
        position: relative;
        display: inline-block;
        width: 34px;
        height: 20px;
        border-radius: 999px;
        background: rgba(255,255,255,0.16);
        transition: background-color 140ms ease;
        flex: 0 0 auto;
      }
      .ccf-suite-script-toggle-track::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #f7f1eb;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
        transition: transform 140ms ease, background-color 140ms ease;
      }
      .ccf-suite-script-toggle input:checked + .ccf-suite-script-toggle-label + .ccf-suite-script-toggle-track {
        background: rgba(126,214,157,0.38);
      }
      .ccf-suite-script-toggle input:checked + .ccf-suite-script-toggle-label + .ccf-suite-script-toggle-track::after {
        transform: translateX(14px);
        background: #ebfff1;
      }
      .ccf-suite-script-toggle input:focus-visible + .ccf-suite-script-toggle-label + .ccf-suite-script-toggle-track {
        outline: 2px solid rgba(255,255,255,0.34);
        outline-offset: 2px;
      }
      .ccf-suite-script-toggle-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 40px;
        color: inherit;
        text-align: center;
      }
      .ccf-suite-script-toggle input:checked + .ccf-suite-script-toggle-label {
        color: #bff2cb;
      }
      .ccf-suite-meta { display: grid; gap: 4px; margin-top: 10px; }
      .ccf-suite-card-details { margin-top: 8px; }
      .ccf-suite-actions { margin-top: 10px; }
      .ccf-suite-action[disabled] { opacity: 0.45; cursor: not-allowed; }
      .ccf-suite-detail-toggle {
        appearance: none;
        display: inline-flex;
        align-items: center;
        align-self: center;
        justify-content: center;
        box-sizing: border-box;
        width: 24px;
        min-width: 24px;
        height: 24px;
        padding: 0;
        border-radius: 999px;
        transform: translateY(0.5px);
      }
      .ccf-suite-detail-toggle-icon {
        display: block;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        transform: translateY(-0.5px);
      }
      .ccf-suite-detail-toggle[aria-expanded="true"] {
        transform: translateY(0.5px);
      }
      .ccf-suite-detail-toggle[aria-expanded="true"] .ccf-suite-detail-toggle-icon {
        transform: translateY(-0.5px) rotate(180deg);
      }
      .ccf-suite-footer { margin-top: 14px; }
    `;

    (document.head || document.documentElement).appendChild(style);
  }

  function render() {
    const root = document.getElementById("ccf-suite-root");
    if (!root) return;

    const managerEntry = getSuiteManagerEntry();
    const entries = getEntries();
    const trackedEntries = [managerEntry, ...entries];
    const outdated = trackedEntries.filter((entry) => entry.isInstalled && entry.enabled && entry.versionState === "outdated");
    const activeCount = trackedEntries.filter((entry) => entry.isInstalled && entry.enabled).length;
    const missingCount = trackedEntries.filter((entry) => !entry.isInstalled).length;

    const toggle = root.querySelector("#ccf-suite-toggle");
    const badge = root.querySelector("#ccf-suite-badge");
    const panel = root.querySelector("#ccf-suite-panel");
    let managerEntryContainer = root.querySelector("#ccf-suite-manager-entry");
    const list = root.querySelector("#ccf-suite-list");
    const summary = root.querySelector("#ccf-suite-summary");
    const notify = root.querySelector("#ccf-suite-notify");
    const autoOpen = root.querySelector("#ccf-suite-auto-open");

    if (!managerEntryContainer) {
      managerEntryContainer = document.createElement("div");
      managerEntryContainer.id = "ccf-suite-manager-entry";
      managerEntryContainer.className = "ccf-suite-list ccf-suite-manager-list";
      root.querySelector(".ccf-suite-settings")?.after(managerEntryContainer);
    }

    if (!toggle || !badge || !panel || !managerEntryContainer || !list || !summary) return;

    toggle.setAttribute("aria-expanded", state.panelOpen ? "true" : "false");
    panel.hidden = !state.panelOpen;
    badge.hidden = outdated.length < 1;
    badge.textContent = String(outdated.length);
    if (notify) notify.checked = !!state.settings.notifyUpdates;
    if (autoOpen) autoOpen.checked = !!state.settings.autoOpenOnUpdate;

    renderManagerEntry(managerEntryContainer, managerEntry);
    summary.textContent = `활성 ${activeCount}개, 업데이트 필요 ${outdated.length}개, 미설치 ${missingCount}개, 전체 ${trackedEntries.length}개`;
    renderList(list, entries);
  }

  function renderList(container, entries) {
    container.textContent = "";

    for (const entry of entries) {
      container.appendChild(renderEntryCard(entry));
    }
  }

  function renderManagerEntry(container, entry) {
    container.textContent = "";
    container.appendChild(renderEntryCard(entry));
  }

  function renderEntryCard(entry) {
    const card = document.createElement("article");
    card.className = "ccf-suite-card";
    card.dataset.version = entry.versionState;
    card.dataset.id = entry.id;

    const detailsId = `ccf-suite-details-${entry.id}`;
    const expanded = !!state.expandedCards[entry.id];

    const head = document.createElement("div");
    head.className = "ccf-suite-card-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "ccf-suite-card-title";

    const titleRow = document.createElement("div");
    titleRow.className = "ccf-suite-card-title-row";

    const title = document.createElement("strong");
    title.textContent = entry.name;

    const summaryText = document.createElement("span");
    summaryText.className = "ccf-suite-card-description";
    summaryText.textContent = entry.summary || "설명 정보가 아직 등록되지 않았습니다.";

    const chipRow = document.createElement("div");
    chipRow.className = "ccf-suite-chip-row";
    if (Array.isArray(entry.statusChips)) {
      for (const chip of entry.statusChips) {
        chipRow.appendChild(makeChip(chip.label, chip.className));
      }
    } else if (entry.isInstalled && entry.canToggle !== false) {
      chipRow.appendChild(makeScriptToggle(entry));
    } else if (entry.isInstalled) {
      chipRow.appendChild(makeChip(entry.enabled ? "활성" : "비활성", entry.enabled ? "install-active" : "install-recorded"));
    } else {
      chipRow.appendChild(makeChip(getInstallLabel(entry.installState), `install-${entry.installState}`));
    }
    const versionLabel = getVersionLabel(entry.versionState);
    if (versionLabel) {
      chipRow.appendChild(makeChip(versionLabel, `version-${entry.versionState}`));
    }

    const controls = document.createElement("div");
    controls.className = "ccf-suite-card-controls";

    const detailToggle = document.createElement("button");
    detailToggle.type = "button";
    detailToggle.className = "ccf-suite-action ccf-suite-detail-toggle";
    detailToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    detailToggle.setAttribute("aria-controls", detailsId);
    detailToggle.setAttribute("aria-label", expanded ? "상세 정보 접기" : "상세 정보 펼치기");
    const detailToggleIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    detailToggleIcon.setAttribute("class", "ccf-suite-detail-toggle-icon");
    detailToggleIcon.setAttribute("viewBox", "0 0 24 24");
    detailToggleIcon.setAttribute("aria-hidden", "true");
    const detailTogglePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    detailTogglePath.setAttribute("d", "M7 10l5 5 5-5");
    detailToggleIcon.appendChild(detailTogglePath);
    detailToggle.appendChild(detailToggleIcon);
    detailToggle.addEventListener("click", () => {
      toggleCardDetails(entry.id);
    });

    controls.append(chipRow, detailToggle);
    titleRow.append(title, controls);
    titleWrap.append(titleRow);

    const meta = document.createElement("div");
    meta.className = "ccf-suite-meta";
    meta.innerHTML =
      `<div>설치 버전: ${escapeHtml(entry.installedVersion || "정보 없음")}</div>` +
      `<div>최신 버전: ${escapeHtml(entry.latestVersion || "정보 없음")}</div>` +
      `<div>마지막 확인: ${escapeHtml(entry.lastSeenAt ? formatDate(entry.lastSeenAt) : "미확인")}</div>`;

    const actions = document.createElement("div");
    actions.className = "ccf-suite-actions";
    const primary = document.createElement("button");
    primary.type = "button";
    primary.className = "ccf-suite-action";
    if (entry.installUrl) {
      primary.dataset.url = entry.installUrl;
      primary.textContent = entry.primaryActionLabel || (entry.isInstalled ? "업데이트" : "설치");
    } else {
      primary.disabled = true;
      primary.textContent = "URL 없음";
      primary.title = "설치 URL이 등록되면 이 버튼을 사용할 수 있습니다.";
    }
    actions.appendChild(primary);

    if (entry.changelogUrl) {
      const changelog = document.createElement("button");
      changelog.type = "button";
      changelog.className = "ccf-suite-action";
      changelog.dataset.url = entry.changelogUrl;
      changelog.textContent = "변경 내역";
      actions.appendChild(changelog);
    }

    const details = document.createElement("div");
    details.id = detailsId;
    details.className = "ccf-suite-card-details";
    details.hidden = !expanded;
    details.append(summaryText, meta, actions);

    head.append(titleWrap);
    card.append(head, details);
    return card;
  }

  function getSuiteManagerEntry() {
    const remote = state.remoteCatalog?.manager && typeof state.remoteCatalog.manager === "object"
      ? state.remoteCatalog.manager
      : {};
    const latestVersion = remote.latestVersion || "";
    const versionState = getVersionState(SUITE_MANAGER_SCRIPT.version, latestVersion);

    return {
      id: SUITE_MANAGER_SCRIPT.id,
      name: SUITE_MANAGER_SCRIPT.name,
      summary: "이 관리 패널 자체의 설치 상태와 Greasy Fork 최신 버전을 확인합니다.",
      installedVersion: SUITE_MANAGER_SCRIPT.version,
      latestVersion,
      lastSeenAt: remote.checkedAt || SESSION_STARTED_AT,
      installUrl: remote.scriptUrl || SUITE_MANAGER_SCRIPT.installUrl,
      changelogUrl: "",
      isInstalled: true,
      enabled: true,
      installState: "active",
      versionState,
      canToggle: false,
      primaryActionLabel: versionState === "outdated" ? "업데이트" : "설치 페이지",
      statusChips: [
        { label: "설치됨", className: "install-active" },
        { label: "활성", className: "install-active" }
      ]
    };
  }

  function getEntries() {
    const registry = readRegistry();
    const catalogMap = new Map(CATALOG.map((item) => [item.id, item]));
    const remoteCatalogMap = state.remoteCatalog?.scripts && typeof state.remoteCatalog.scripts === "object"
      ? state.remoteCatalog.scripts
      : {};
    const ids = new Set([...catalogMap.keys(), ...Object.keys(registry.scripts)]);

    return [...ids]
      .filter((id) => !isHiddenScriptRecord(id, registry.scripts[id], catalogMap.get(id)))
      .map((id) => {
        const catalog = catalogMap.get(id) || {};
        const detected = detectInstalledScript(id);
        const stored = registry.scripts[id] || null;
        const installed = stored || detected
          ? {
              ...(stored || {}),
              ...(detected || {})
            }
          : null;
        const isInstalled = !!(detected || installed?.lastSeenSessionId === SESSION_ID);
        const installState = isInstalled ? "active" : "missing";
        const remoteCatalog = remoteCatalogMap[id] && typeof remoteCatalogMap[id] === "object"
          ? remoteCatalogMap[id]
          : {};
        const latestVersion = remoteCatalog.latestVersion || catalog.latestVersion || "";
        return {
          id,
          name: catalog.name || installed?.name || id,
          summary: catalog.summary || "",
          installedVersion: installed?.version || "",
          latestVersion,
          lastSeenAt: installed?.lastSeenAt || "",
          installUrl: catalog.installUrl || remoteCatalog.scriptUrl || installed?.installUrl || "",
          changelogUrl: catalog.changelogUrl || installed?.changelogUrl || "",
          isInstalled,
          enabled: isScriptEnabled(id),
          installState,
          versionState: isInstalled ? getVersionState(installed?.version, latestVersion) : ""
        };
      })
      .sort((left, right) => getPriority(left) - getPriority(right) || left.name.localeCompare(right.name, "ko"));
  }

  function isHiddenScriptRecord(id, stored, catalog) {
    const normalizedId = normalizeSpace(id).toLowerCase();
    if (HIDDEN_SCRIPT_IDS.has(normalizedId) || normalizedId.startsWith("ccf-log-package")) return true;

    const values = [
      id,
      stored?.id,
      stored?.name,
      stored?.namespace,
      stored?.installUrl,
      stored?.changelogUrl,
      catalog?.id,
      catalog?.name,
      catalog?.namespace,
      catalog?.installUrl,
      catalog?.changelogUrl
    ].map(normalizeSpace).filter(Boolean);

    return values.some((value) => HIDDEN_SCRIPT_NAME_PATTERNS.some((pattern) => pattern.test(value)));
  }

  function detectInstalledScript(id) {
    const selectors = LEGACY_INSTALL_SELECTORS[id];
    if (!Array.isArray(selectors)) return null;

    for (const selector of selectors) {
      try {
        if (!document.querySelector(selector)) continue;
        return {
          id,
          lastSeenAt: new Date().toISOString(),
          lastSeenSessionId: SESSION_ID
        };
      } catch (error) {
        // Ignore selector failures.
      }
    }

    return null;
  }

  function getVersionState(installedVersion, latestVersion) {
    if (!installedVersion || !latestVersion) return "unknown";
    const result = compareVersions(installedVersion, latestVersion);
    if (result < 0) return "outdated";
    if (result > 0) return "unknown";
    return "current";
  }

  function getPriority(entry) {
    if (entry.isInstalled && entry.versionState === "outdated") return 0;
    if (!entry.isInstalled) return 1;
    return 2;
  }

  function scheduleNotice() {
    window.clearTimeout(state.noticeTimer);
    state.noticeTimer = window.setTimeout(maybeNotifyUpdates, REQUEST_DELAYS[REQUEST_DELAYS.length - 1] + 300);
  }

  function maybeNotifyUpdates() {
    if (!state.settings.notifyUpdates) return;

    const updates = [getSuiteManagerEntry(), ...getEntries()].filter((entry) => {
      if (!entry.isInstalled || !entry.enabled || entry.versionState !== "outdated") return false;
      return state.settings.notifiedVersions[entry.id] !== entry.latestVersion;
    });

    if (!updates.length) return;

    const notifiedVersions = { ...state.settings.notifiedVersions };
    for (const entry of updates) {
      notifiedVersions[entry.id] = entry.latestVersion;
    }
    updateSettings({ notifiedVersions });

    if (state.settings.autoOpenOnUpdate) {
      setPanelOpen(true);
    }

    showToast(
      updates.length === 1 ? `${updates[0].name} 업데이트가 있습니다` : `${updates.length}개 항목에 업데이트가 있습니다`,
      updates.length === 1
        ? `설치 ${updates[0].installedVersion || "미확인"} / 최신 ${updates[0].latestVersion || "미확인"}`
        : updates.map((entry) => entry.name).join(", ")
    );
  }

  function showToast(title, body) {
    const toast = document.getElementById("ccf-suite-toast");
    if (!toast) return;

    toast.innerHTML = `
      <div><strong>${escapeHtml(title)}</strong></div>
      <div style="margin-top:4px;">${escapeHtml(body)}</div>
      <div class="ccf-suite-toast-actions" style="margin-top:12px;">
        <button type="button" id="ccf-suite-toast-open">패널 열기</button>
        <button type="button" id="ccf-suite-toast-close">닫기</button>
      </div>
    `;
    toast.hidden = false;
    toast.querySelector("#ccf-suite-toast-open")?.addEventListener("click", () => {
      toast.hidden = true;
      setPanelOpen(true);
    });
    toast.querySelector("#ccf-suite-toast-close")?.addEventListener("click", () => {
      toast.hidden = true;
    });

    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 10000);
  }

  function requestRegistrations() {
    REQUEST_DELAYS.forEach((delay) => {
      window.setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { sessionId: SESSION_ID } }));
        } catch (error) {
          // Ignore.
        }
        render();
      }, delay);
    });
  }

  function setPanelOpen(open) {
    state.panelOpen = !!open;
    render();
  }

  function toggleCardDetails(id) {
    state.expandedCards = {
      ...state.expandedCards,
      [id]: !state.expandedCards[id]
    };
    render();
  }

  function readRemoteCatalog() {
    const raw = readJson(REMOTE_CATALOG_KEY, {});
    return {
      fetchedAt: Number(raw?.fetchedAt) || 0,
      manager: raw?.manager && typeof raw.manager === "object" && !Array.isArray(raw.manager)
        ? raw.manager
        : {},
      scripts: raw?.scripts && typeof raw.scripts === "object" && !Array.isArray(raw.scripts)
        ? raw.scripts
        : {}
    };
  }

  function shouldRefreshRemoteCatalog(force = false) {
    if (force) return true;
    const fetchedAt = Number(state.remoteCatalog?.fetchedAt) || 0;
    return !fetchedAt || (Date.now() - fetchedAt) >= REMOTE_CATALOG_TTL_MS;
  }

  function refreshRemoteCatalog(force = false) {
    if (!shouldRefreshRemoteCatalog(force)) {
      return Promise.resolve(state.remoteCatalog);
    }
    if (state.remoteCatalogRequest) {
      return state.remoteCatalogRequest;
    }

    state.remoteCatalogRequest = fetchRemoteCatalog()
      .catch((error) => {
        console.warn("[CCF SUITE] latest version sync failed", error);
        return state.remoteCatalog;
      })
      .finally(() => {
        state.remoteCatalogRequest = null;
        render();
        scheduleNotice();
      });

    return state.remoteCatalogRequest;
  }

  async function fetchRemoteCatalog() {
    const previousManager = state.remoteCatalog?.manager && typeof state.remoteCatalog.manager === "object"
      ? state.remoteCatalog.manager
      : {};
    const previousScripts = state.remoteCatalog?.scripts && typeof state.remoteCatalog.scripts === "object"
      ? state.remoteCatalog.scripts
      : {};
    let nextManager = previousManager;

    try {
      nextManager = await fetchGreasyForkScriptMeta(SUITE_MANAGER_SCRIPT);
    } catch (error) {
      console.warn("[CCF SUITE] failed to fetch suite manager latest version", error);
    }

    const results = await Promise.all(CATALOG.map(async (item) => {
      try {
        const remote = await fetchGreasyForkScriptMeta(item);
        return [item.id, remote];
      } catch (error) {
        console.warn(`[CCF SUITE] failed to fetch ${item.id} latest version`, error);
        return previousScripts[item.id] ? [item.id, previousScripts[item.id]] : null;
      }
    }));

    const nextScripts = {};
    for (const result of results) {
      if (!Array.isArray(result) || result.length !== 2) continue;
      nextScripts[result[0]] = result[1];
    }

    if (!Object.keys(nextScripts).length && !Object.keys(nextManager || {}).length) {
      return state.remoteCatalog;
    }

    const nextCatalog = {
      fetchedAt: Date.now(),
      manager: nextManager,
      scripts: nextScripts
    };

    state.remoteCatalog = nextCatalog;
    writeJson(REMOTE_CATALOG_KEY, nextCatalog);
    return nextCatalog;
  }

  async function fetchGreasyForkScriptMeta(item) {
    const scriptId = Number(item?.greasyForkScriptId);
    if (!Number.isFinite(scriptId) || scriptId <= 0) {
      throw new Error("missing-script-id");
    }

    const data = await fetchGreasyForkScriptData(scriptId);
    const latestVersion = normalizeSpace(data?.version || "");
    if (!latestVersion) {
      throw new Error("missing-version");
    }

    return {
      latestVersion,
      checkedAt: new Date().toISOString(),
      scriptUrl: normalizeSpace(data?.url || item?.installUrl || buildGreasyForkScriptPageUrl(scriptId)),
      codeUpdatedAt: normalizeSpace(data?.code_updated_at || "")
    };
  }

  async function fetchGreasyForkScriptData(scriptId) {
    try {
      return await fetchGreasyForkScriptJson(scriptId);
    } catch (jsonError) {
      const meta = await fetchGreasyForkScriptMetaFile(scriptId);
      if (meta?.version) {
        return meta;
      }
      throw jsonError;
    }
  }

  async function fetchGreasyForkScriptJson(scriptId) {
    let lastError = null;

    for (const baseUrl of GREASY_FORK_API_URLS) {
      try {
        return await fetchJsonWithTimeout(`${baseUrl}/scripts/${encodeURIComponent(scriptId)}.json`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("remote-fetch-failed");
  }

  async function fetchGreasyForkScriptMetaFile(scriptId) {
    const url = buildGreasyForkScriptMetaUrl(scriptId);
    const metaText = await fetchTextWithTimeout(url);
    const version = parseGreasyForkMetaVersion(metaText);
    if (!version) {
      throw new Error("missing-meta-version");
    }

    return {
      version,
      url: buildGreasyForkScriptPageUrl(scriptId)
    };
  }

  async function fetchJsonWithTimeout(url) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS)
      : 0;

    try {
      const response = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: {
          Accept: "application/json"
        },
        signal: controller?.signal
      });

      if (!response.ok) {
        throw new Error(`http-${response.status}`);
      }

      return await response.json();
    } finally {
      if (timer) {
        window.clearTimeout(timer);
      }
    }
  }

  async function fetchTextWithTimeout(url) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? window.setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS)
      : 0;

    try {
      const response = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: {
          Accept: "text/plain, text/javascript, application/javascript"
        },
        signal: controller?.signal
      });

      if (!response.ok) {
        throw new Error(`http-${response.status}`);
      }

      return await response.text();
    } finally {
      if (timer) {
        window.clearTimeout(timer);
      }
    }
  }

  function buildGreasyForkScriptPageUrl(scriptId) {
    return `https://greasyfork.org/scripts/${encodeURIComponent(scriptId)}`;
  }

  function buildGreasyForkScriptMetaUrl(scriptId) {
    return `${buildGreasyForkScriptPageUrl(scriptId)}/code/script.meta.js`;
  }

  function parseGreasyForkMetaVersion(metaText) {
    const match = String(metaText || "").match(/^[ \t]*\/\/[ \t]*@version[ \t]+([^\r\n]+)$/m);
    return normalizeSpace(match?.[1] || "");
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

  function readRegistry() {
    const raw = readJson(REGISTRY_KEY, {});
    return raw && typeof raw.scripts === "object"
      ? { scripts: raw.scripts }
      : { scripts: {} };
  }

  function readSettings() {
    const raw = readJson(SETTINGS_KEY, {});
    return {
      notifyUpdates: typeof raw.notifyUpdates === "boolean" ? raw.notifyUpdates : DEFAULT_SETTINGS.notifyUpdates,
      autoOpenOnUpdate: typeof raw.autoOpenOnUpdate === "boolean" ? raw.autoOpenOnUpdate : DEFAULT_SETTINGS.autoOpenOnUpdate,
      notifiedVersions: raw.notifiedVersions && typeof raw.notifiedVersions === "object" ? raw.notifiedVersions : {}
    };
  }

  function readScriptStates() {
    const raw = readJson(SCRIPT_STATE_KEY, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function isScriptEnabled(scriptId) {
    return state.scriptStates[scriptId] !== false;
  }

  function updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    writeJson(SETTINGS_KEY, state.settings);
    render();
  }

  function updateScriptEnabled(scriptId, enabled) {
    const nextValue = !!enabled;
    if (state.scriptStates[scriptId] === nextValue) return;

    state.scriptStates = {
      ...state.scriptStates,
      [scriptId]: nextValue
    };

    writeJson(SCRIPT_STATE_KEY, state.scriptStates);
    render();
    window.setTimeout(() => {
      window.location.reload();
    }, 80);
  }

  function readJson(key, fallbackValue) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch (error) {
      return fallbackValue;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Ignore storage failures.
    }
  }

  function compareVersions(left, right) {
    const a = String(left || "").split(/[^0-9A-Za-z]+/).filter(Boolean);
    const b = String(right || "").split(/[^0-9A-Za-z]+/).filter(Boolean);
    const length = Math.max(a.length, b.length);

    for (let index = 0; index < length; index += 1) {
      const partA = a[index] ?? "0";
      const partB = b[index] ?? "0";
      const numA = /^\d+$/.test(partA) ? Number(partA) : partA.toLowerCase();
      const numB = /^\d+$/.test(partB) ? Number(partB) : partB.toLowerCase();
      if (numA === numB) continue;
      if (typeof numA === "number" && typeof numB === "number") return numA < numB ? -1 : 1;
      return String(numA).localeCompare(String(numB), "en");
    }

    return 0;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function getInstallLabel(value) {
    if (value === "active") return "활성";
    if (value === "recorded") return "미설치";
    return "미설치";
  }

  function getVersionLabel(value) {
    if (!value) return "";
    if (value === "outdated") return "업데이트 필요";
    if (value === "current") return "";
    return "비교 정보 없음";
  }

  function makeChip(text, className) {
    const chip = document.createElement("span");
    chip.className = `ccf-suite-chip ${className}`;
    const label = document.createElement("span");
    label.className = "ccf-suite-chip-label";
    label.textContent = text;
    chip.appendChild(label);
    return chip;
  }

  function makeScriptToggle(entry) {
    const wrapper = document.createElement("label");
    wrapper.className = "ccf-suite-script-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!entry.enabled;
    input.setAttribute("aria-label", `${entry.name} ${entry.enabled ? "비활성화" : "활성화"}`);

    const track = document.createElement("span");
    track.className = "ccf-suite-script-toggle-track";
    track.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "ccf-suite-script-toggle-label";
    label.textContent = entry.enabled ? "활성" : "비활성";

    input.addEventListener("change", () => {
      updateScriptEnabled(entry.id, input.checked);
    });

    wrapper.append(input, label, track);
    return wrapper;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;");
  }

  function waitForBody(callback) {
    const tick = () => {
      if (document.body) {
        callback();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    tick();
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function compareVisualOrder(a, b) {
    const rectA = a.getBoundingClientRect();
    const rectB = b.getBoundingClientRect();
    return rectA.top - rectB.top || rectA.left - rectB.left;
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getNormalizedPath() {
    return (window.location.pathname || "").replace(/\/+$/, "") || "/";
  }

  function isHiddenRoute() {
    const path = getNormalizedPath();
    return path === "/" || path === "/home" || path.endsWith("/chat");
  }

  function removeRoot() {
    document.getElementById("ccf-suite-root")?.remove();
  }

  function findAnchorByLabel(labels) {
    for (const label of labels) {
      const button = document.querySelector(`button[aria-label="${label}"]`);
      if (isVisibleElement(button)) {
        return button;
      }
    }
    return null;
  }

  function findAnchorByFragment(fragments) {
    const buttons = [...document.querySelectorAll("button[aria-label]")]
      .filter((button) => isVisibleElement(button))
      .sort(compareVisualOrder);

    for (const button of buttons) {
      const label = normalizeSpace(button.getAttribute("aria-label")).toLowerCase();
      if (fragments.some((fragment) => label.includes(fragment))) {
        return button;
      }
    }

    return null;
  }

  function findAnchor() {
    return (
      findAnchorByLabel(PRIMARY_ANCHOR_LABELS) ||
      findAnchorByFragment(SECONDARY_ANCHOR_FRAGMENTS) ||
      findAnchorByLabel(DICE_ANCHOR_LABELS)
    );
  }

  function mountRoot(root, anchor) {
    if (!(root instanceof HTMLElement) || !document.body) {
      return;
    }

    if (anchor instanceof HTMLElement && anchor.parentElement) {
      if (root.parentElement !== anchor.parentElement || root.nextElementSibling !== anchor) {
        anchor.before(root);
      }
      root.removeAttribute(ROOT_FLOATING_ATTR);
      return;
    }

    if (root.parentElement !== document.body) {
      document.body.appendChild(root);
    }
    root.setAttribute(ROOT_FLOATING_ATTR, "1");
  }

  function observeAnchor() {
    if (!document.body) return;

    const observer = new MutationObserver(() => {
      const root = document.getElementById("ccf-suite-root");

      if (isHiddenRoute()) {
        state.panelOpen = false;
        if (root) {
          root.remove();
        }
        return;
      }

      const anchor = findAnchor();

      if (!root) {
        ensureUi();
        return;
      }

      mountRoot(root, anchor);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    ccfSuiteRegisterTeardown(() => observer.disconnect());
  }
})();
