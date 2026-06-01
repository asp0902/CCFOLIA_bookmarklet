// ==UserScript==
// @name         CCFOLIA Suite Manager by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-suite
// @version      0.5.8
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
    version: getUserscriptVersion("0.5.8"),
    greasyForkScriptId: 570244,
    installUrl: "https://greasyfork.org/ko/scripts/570244-ccf-suite-manager-by-capybara-korea"
  });
  const ROOT_FLOATING_ATTR = "data-ccf-suite-floating";
  const COMPACT_VIEWPORT_QUERY = "(max-width: 600px)";
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

    window.addEventListener("capybara-toolkit-presence:panel-state", (event) => {
      state.panelOpen = !!event.detail?.open;
      render();
    }, ccfSuiteWithSignal());
  }

  function ensureUi() {
    if (!document.body) return;
    if (isHiddenRoute() || isCompactViewport()) {
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
          aria-controls="capybara-toolkit-presence"
          aria-label="CCF Suite ????繹먮굟爰?
          title="CCF Suite ????繹먮굟爰?
        >
          <img class="ccf-suite-toggle-icon" src="${CAPYBARA_ICON_DATA_URL}" alt="">
          <span class="ccf-suite-sr-only">&#xD234;&#xD0B7; &#xC0AC;&#xC6A9;&#xC790;</span>
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
          aria-controls="capybara-toolkit-presence"
          aria-label="&#xD234;&#xD0B7; &#xC0AC;&#xC6A9;&#xC790; &#xC5F4;&#xAE30;"
        >
          <img class="ccf-suite-toggle-icon" alt="">
          <span class="ccf-suite-sr-only">&#xD234;&#xD0B7; &#xC0AC;&#xC6A9;&#xC790;</span>
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

      root.querySelector("#ccf-suite-panel")?.remove();
      root.querySelector(".ccf-suite-toggle-icon")?.setAttribute("src", CAPYBARA_ICON_DATA_URL);

      root.querySelector("#ccf-suite-toggle")?.addEventListener("click", () => {
        const isOpen = window.__CAPYBARA_TOOLKIT_PRESENCE__?.isPanelOpen?.() === true;
        setPanelOpen(!isOpen);
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

    toggle?.setAttribute("aria-expanded", state.panelOpen ? "true" : "false");
    if (badge) badge.hidden = true;

    if (!managerEntryContainer && panel) {
      managerEntryContainer = document.createElement("div");
      managerEntryContainer.id = "ccf-suite-manager-entry";
      managerEntryContainer.className = "ccf-suite-list ccf-suite-manager-list";
      root.querySelector(".ccf-suite-settings")?.after(managerEntryContainer);
    }

    if (!toggle || !badge || !panel || !managerEntryContainer || !list || !summary) return;

    panel.hidden = true;
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
    window.__CAPYBARA_TOOLKIT_PRESENCE__?.setPanelOpen?.(state.panelOpen);
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

  function isCompactViewport() {
    return window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;
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

    const syncRootPlacement = () => {
      const root = document.getElementById("ccf-suite-root");

      if (isHiddenRoute() || isCompactViewport()) {
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
    };

    // 모든 DOM 변경마다 syncRootPlacement(querySelectorAll + getBoundingClientRect)을
    // 실행하면 React가 룸 목록을 그리는 동안 레이아웃 thrash가 심하다. rAF로 디바운스.
    let placementPending = false;
    const scheduledSync = () => {
      if (placementPending) return;
      placementPending = true;
      window.requestAnimationFrame(() => {
        placementPending = false;
        syncRootPlacement();
      });
    };
    const observer = new MutationObserver(scheduledSync);

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    ccfSuiteRegisterTeardown(() => observer.disconnect());

    const compactViewport = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    compactViewport.addEventListener("change", syncRootPlacement, ccfSuiteWithSignal());
  }

  // ============================================================
  // Home enhancer: 룸 즐겨찾기 + 방문기록 통합 (v0.1.1)
  // ============================================================

  const CCFH_STORAGE_FAV = "ccfh-favorites-v1";
  const CCFH_STORAGE_HISTORY = "ccfh-history-v1";
  const CCFH_STORAGE_META = "ccfh-room-meta-v1";
  const CCFH_STORAGE_FOLD = "ccfh-section-fold-v1";
  const CCFH_STORAGE_VIEW = "ccfh-section-view-v1";
  const CCFH_ROOM_HREF_RE = /^\/rooms\/([A-Za-z0-9_-]+)\/?$/;
  const CCFH_ROOM_PAGE_RE = /^\/rooms\/([A-Za-z0-9_-]+)(?:\/.*)?$/;
  const CCFH_STAR_ATTR = "data-ccfh-star";
  const CCFH_VISITED_ATTR = "data-ccfh-visited";
  const CCFH_FAV_ATTR = "data-ccfh-fav";
  const CCFH_CARD_ATTR = "data-ccfh-card";
  const CCFH_ORIGINAL_ORDER_ATTR = "data-ccfh-original-order";
  const CCFH_STYLE_ID = "ccfh-style";

  function ccfhReadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }
  function ccfhWriteJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (err) { console.warn("[CCFH] save failed", key, err); }
  }

  // 같은 refresh 사이클 안에서 ccfhFavorites / ccfhHistory / ccfhRoomMeta가
  // 여러 번 호출되며 매번 JSON.parse 비용을 치르던 문제를 막기 위한 캐시.
  // 쓰기 시 즉시 무효화하므로 같은 탭에서의 데이터 일관성은 보장된다.
  const _ccfhCache = { fav: null, hist: null, meta: null };
  function _ccfhInvalidate(keys) {
    if (!keys) { _ccfhCache.fav = null; _ccfhCache.hist = null; _ccfhCache.meta = null; return; }
    for (const k of keys) _ccfhCache[k] = null;
  }
  // 다른 탭에서의 변경에도 캐시를 비운다.
  window.addEventListener("storage", (event) => {
    if (!event || !event.key) return;
    if (event.key === CCFH_STORAGE_FAV) _ccfhCache.fav = null;
    else if (event.key === CCFH_STORAGE_HISTORY) _ccfhCache.hist = null;
    else if (event.key === CCFH_STORAGE_META) _ccfhCache.meta = null;
  });

  function ccfhFavorites() {
    if (_ccfhCache.fav) return _ccfhCache.fav;
    const a = ccfhReadJson(CCFH_STORAGE_FAV, []);
    const list = Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
    _ccfhCache.fav = list;
    return list;
  }
  function ccfhSaveFavorites(arr) {
    _ccfhCache.fav = null;
    ccfhWriteJson(CCFH_STORAGE_FAV, [...new Set(arr.filter(Boolean))]);
  }
  function ccfhIsFavorite(id) { return ccfhFavorites().includes(id); }
  function ccfhToggleFavorite(id) {
    const favs = ccfhFavorites().slice();
    const i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.unshift(id);
    ccfhSaveFavorites(favs);
    return i < 0;
  }
  function ccfhHistory() {
    if (_ccfhCache.hist) return _ccfhCache.hist;
    const a = ccfhReadJson(CCFH_STORAGE_HISTORY, []);
    const list = Array.isArray(a) ? a.filter((e) => e && typeof e.id === "string") : [];
    _ccfhCache.hist = list;
    return list;
  }
  function ccfhSaveHistory(arr) {
    _ccfhCache.hist = null;
    ccfhWriteJson(CCFH_STORAGE_HISTORY, arr);
  }
  function ccfhRoomMeta() {
    if (_ccfhCache.meta) return _ccfhCache.meta;
    const data = ccfhReadJson(CCFH_STORAGE_META, {});
    const obj = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    _ccfhCache.meta = obj;
    return obj;
  }
  function ccfhSaveRoomMeta(meta) {
    _ccfhCache.meta = null;
    ccfhWriteJson(CCFH_STORAGE_META, meta);
  }
  function ccfhCachedRoomMeta(id) {
    const meta = ccfhRoomMeta()[id];
    return meta && typeof meta === "object" ? meta : {};
  }
  function ccfhFoldState() {
    const data = ccfhReadJson(CCFH_STORAGE_FOLD, {});
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  }
  function ccfhSetFoldState(key, folded) {
    if (!key) return;
    const state = ccfhFoldState();
    state[key] = !!folded;
    ccfhWriteJson(CCFH_STORAGE_FOLD, state);
  }
  function ccfhIsFolded(key) {
    return !!ccfhFoldState()[key];
  }
  function ccfhViewState() {
    const data = ccfhReadJson(CCFH_STORAGE_VIEW, {});
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  }
  function ccfhSetViewState(key, view) {
    if (!key) return;
    const state = ccfhViewState();
    state[key] = view;
    ccfhWriteJson(CCFH_STORAGE_VIEW, state);
  }
  function ccfhGetView(key) {
    return ccfhViewState()[key] || "card";
  }
  function ccfhCleanText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }
  function ccfhIsGenericRoomName(name) {
    const text = ccfhCleanText(name);
    if (!text) return true;
    return /^ccfolia(?:\s|$)/i.test(text) || /オンラインセッションツール/i.test(text);
  }
  function ccfhIsGenericThumbnail(url) {
    if (!url) return true;
    return /ccfolia\.png$/i.test(url);
  }
  function ccfhResolveHistoryEntry(entry) {
    const cached = ccfhCachedRoomMeta(entry.id);
    const name = ccfhCleanText(entry.name);
    const resolvedName = ccfhIsGenericRoomName(name) && cached.name ? cached.name : name;
    let thumb = entry.thumbnail || "";
    // 썸네일이 코코포리아 기본 이미지일 경우, 이전에 캐싱된 이미지가 있다면 그것을 우선 사용
    if (ccfhIsGenericThumbnail(thumb) && cached.thumbnail && !ccfhIsGenericThumbnail(cached.thumbnail)) {
      thumb = cached.thumbnail;
    }
    return {
      ...entry,
      name: resolvedName || cached.name || "(이름 없음)",
      thumbnail: thumb || cached.thumbnail || "",
      date: entry.date || cached.date || ""
    };
  }
  function ccfhRepairHistoryWithMeta() {
    const list = ccfhHistory();
    let changed = false;
    const next = list.map((entry) => {
      const resolved = ccfhResolveHistoryEntry(entry);
      if (resolved.name !== entry.name || resolved.thumbnail !== entry.thumbnail) changed = true;
      return resolved;
    });
    if (changed) ccfhSaveHistory(next);
  }
  function ccfhRecordVisit(entry) {
    if (!entry || !entry.id) return;
    const list = ccfhHistory().filter((e) => e.id !== entry.id);
    const resolved = ccfhResolveHistoryEntry(entry);
    list.unshift({
      id: entry.id,
      name: resolved.name,
      thumbnail: resolved.thumbnail,
      date: resolved.date,
      visitedAt: Date.now()
    });
    ccfhSaveHistory(list);
  }
  function ccfhRemoveHistory(id) {
    ccfhSaveHistory(ccfhHistory().filter((e) => e.id !== id));
  }

  function ccfhInjectStyle() {
    if (document.getElementById(CCFH_STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = CCFH_STYLE_ID;
    s.textContent = `
      .ccfh-star-btn {
        appearance: none;
        background: transparent;
        border: 0;
        box-sizing: border-box;
        width: 20px;
        height: 20px;
        min-width: 20px;
        max-width: 20px;
        padding: 5px;
        margin: 0 -1px 0 0;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 20px;
        font-size: 14px;
        line-height: 1;
        color: #b9bdc7;
        overflow: hidden;
        vertical-align: middle;
        transition: color 0.14s ease;
      }
      .ccfh-star-btn:hover { color: #ffc83a; }
      .ccfh-star-btn[data-active="1"] { color: #ffc83a; }
      .ccfh-star-btn[data-active="1"]:hover { color: #ffd76a; }
      [${CCFH_CARD_ATTR}] .MuiCardHeader-content,
      [${CCFH_CARD_ATTR}] [class*="MuiCardHeader-content"] {
        min-width: 0;
      }
      [data-ccfh-actions] {
        align-items: center;
        flex-wrap: nowrap !important;
        min-width: 0;
      }
      [data-ccfh-actions] > .MuiTypography-root,
      [data-ccfh-actions] > h1,
      [data-ccfh-actions] > h2,
      [data-ccfh-actions] > h3,
      [data-ccfh-actions] > h4,
      [data-ccfh-actions] > h5,
      [data-ccfh-actions] > h6 {
        display: flex !important;
        align-items: baseline;
        gap: 0;
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: clip !important;
      }
      [data-ccfh-actions] > .MuiBox-root,
      [data-ccfh-actions] > [class*="MuiBox-root"] {
        flex: 1 1 0;
        min-width: 0;
      }
      .ccfh-room-title-main {
        display: block;
        flex: 1 1 auto;
        min-width: 0;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .ccfh-room-title-date {
        display: inline-block;
        flex: 0 0 auto;
        margin-left: 0.35em;
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
      }
      [data-ccfh-actions] > span {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
      }
      [${CCFH_CARD_ATTR}] .MuiTypography-noWrap,
      [${CCFH_CARD_ATTR}] h1,
      [${CCFH_CARD_ATTR}] h2,
      [${CCFH_CARD_ATTR}] h3,
      [${CCFH_CARD_ATTR}] h4,
      [${CCFH_CARD_ATTR}] h5,
      [${CCFH_CARD_ATTR}] h6 {
        min-width: 0;
        max-width: 100%;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      [${CCFH_VISITED_ATTR}] { position: relative; }
      [${CCFH_VISITED_ATTR}]::after {
        content: "방문";
        position: absolute;
        top: 6px;
        left: 6px;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        pointer-events: none;
        z-index: 2;
      }
      #ccfh-shortcut-sections {
        margin: 10px 16px 10px;
        font-family: "Roboto", "Noto Sans KR", sans-serif;
        --ccfh-grid-columns: repeat(auto-fill, minmax(220px, 1fr));
        --ccfh-grid-gap: 16px;
      }
      .ccfh-room-section { margin: 0 0 20px; }
      .ccfh-section-header-wrap {
        position: relative;
        margin-bottom: 12px;
      }
      .ccfh-room-section-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 -8px;
        padding: 6px 10px;
        padding-right: 140px;
        width: calc(100% + 16px);
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: rgba(255, 255, 255, 0.86);
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.02em;
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        transition: background 120ms ease;
      }
      .ccfh-room-section-heading:hover { background: rgba(255,255,255,0.06); }
      .ccfh-room-section-heading:focus-visible { outline: 2px solid rgba(255,200,58,0.6); outline-offset: 2px; }
      .ccfh-section-fold-arrow {
        display: inline-block;
        width: 12px;
        text-align: center;
        transition: transform 160ms ease;
        color: rgba(255,255,255,0.6);
      }
      .ccfh-header-controls {
        position: absolute;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 2;
      }
      .ccfh-sort-select, .ccfh-view-toggle {
        background: rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.86);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 12px;
        outline: none;
        cursor: pointer;
        height: 26px;
        box-sizing: border-box;
        transition: background 120ms ease;
      }
      .ccfh-sort-select:hover, .ccfh-view-toggle:hover {
        background: rgba(255,255,255,0.16);
      }
      .ccfh-view-toggle {
        width: 32px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .ccfh-view-toggle svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }
      .ccfh-sort-select option {
        background: #2a2a2a;
        color: #fff;
      }
      .ccfh-room-section.is-folded { margin-bottom: 6px; }
      .ccfh-room-section.is-folded .ccfh-section-header-wrap { margin-bottom: 0; }
      .ccfh-room-section.is-folded .ccfh-section-fold-arrow { transform: rotate(-90deg); }
      .ccfh-section-count {
        margin-left: -4px;
        color: rgba(255,255,255,0.45);
        font-weight: 500;
      }
      .ccfh-room-card-grid-wrapper {
        display: grid;
        grid-template-rows: 1fr;
        transition: grid-template-rows 240ms ease-in-out;
      }
      .ccfh-room-section.is-folded .ccfh-room-card-grid-wrapper {
        grid-template-rows: 0fr;
      }
      .ccfh-room-card-grid {
        display: grid;
        grid-template-columns: var(--ccfh-grid-columns);
        gap: var(--ccfh-grid-gap);
        min-height: 0;
        overflow: hidden;
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
        transition: opacity 240ms ease-in-out, transform 240ms ease-in-out, visibility 0s 0s;
      }
      .ccfh-room-section.is-folded .ccfh-room-card-grid {
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: opacity 240ms ease-in-out, transform 240ms ease-in-out, visibility 0s 240ms;
      }
      .ccfh-room-like-card {
        position: relative;
        overflow: hidden;
        border-radius: 4px;
        background: #2f3136;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
        transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
      }
      .ccfh-room-like-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.34);
        filter: brightness(1.04);
      }
      .ccfh-room-like-card[draggable="true"] { cursor: grab; }
      .ccfh-room-like-card.is-dragging,
      .ccfh-room-like-card.is-dragging:hover {
        opacity: 0.4;
        transform: scale(0.96);
        cursor: grabbing;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        z-index: 10;
      }
      .ccfh-room-like-link {
        display: block;
        color: inherit;
        text-decoration: none;
      }
      .ccfh-room-like-thumb {
        display: flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 16 / 9;
        background-size: cover;
        background-position: center;
        background-color: #202225;
        color: rgba(255,255,255,0.35);
        font-size: 11px;
        letter-spacing: 0.08em;
      }
      .ccfh-room-like-body {
        padding: 12px 68px 12px 12px;
        box-sizing: border-box;
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .ccfh-room-like-title {
        color: rgba(255,255,255,0.92);
        font-size: 14px;
        font-weight: 700;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .ccfh-room-like-meta {
        color: rgba(255,255,255,0.5);
        font-size: 12px;
        line-height: 1.2;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .ccfh-room-like-actions {
        position: absolute;
        right: 8px;
        bottom: 8px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        z-index: 2;
      }
      .ccfh-room-like-star,
      .ccfh-room-like-remove {
        appearance: none;
        width: 24px;
        height: 24px;
        border: 0;
        border-radius: 999px;
        background: rgba(0,0,0,0.28);
        color: rgba(255,255,255,0.72);
        cursor: pointer;
        font-size: 15px;
        line-height: 24px;
        text-align: center;
        padding: 0;
      }
      .ccfh-room-like-star { color: #ffc83a; }
      .ccfh-room-like-remove:hover,
      .ccfh-room-like-star:hover { background: rgba(0,0,0,0.46); }
      .ccfh-room-section.is-list-view .ccfh-room-card-grid {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .ccfh-room-section.is-list-view .ccfh-room-like-link {
        display: flex;
        align-items: center;
      }
      .ccfh-room-section.is-list-view .ccfh-room-like-thumb {
        width: 88px;
        height: 50px;
        flex: 0 0 auto;
      }
      .ccfh-room-section.is-list-view .ccfh-room-like-body {
        min-height: 50px;
        padding: 6px 68px 6px 12px;
        flex: 1 1 0;
        align-items: center;
      }
      .ccfh-room-section.is-list-view .ccfh-room-like-title {
        font-size: 13px;
      }
      .ccfh-room-section.is-list-view .ccfh-room-like-actions {
        top: 50%;
        bottom: auto;
        transform: translateY(-50%);
      }
      .ccfh-show-more-wrap {
        grid-column: 1 / -1;
        display: flex;
        justify-content: flex-end;
        padding-top: 4px;
      }
      .ccfh-show-more-btn {
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 4px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 13px;
        font-weight: 700;
        padding: 8px 16px;
        cursor: pointer;
        transition: color 120ms ease, background 120ms ease;
      }
      .ccfh-show-more-btn:hover {
        color: rgba(255, 255, 255, 0.86);
        background: rgba(255, 255, 255, 0.08);
      }
      .ccfh-section-divider {
        border: 0;
        border-top: 2px dotted rgba(255, 255, 255, 0.24);
        margin: 16px 0 6px;
      }
      @media (max-width: 600px) {
        #ccfh-shortcut-sections {
          margin: 16px 8px 20px;
          --ccfh-grid-columns: repeat(auto-fill, minmax(160px, 1fr));
          --ccfh-grid-gap: 12px;
        }
      .ccfh-room-like-title { font-size: 13px; }
        .ccfh-room-like-meta { font-size: 11px; }
      }
    `;
    document.head.appendChild(s);
  }

  function ccfhRoomIdFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      const m = u.pathname.match(CCFH_ROOM_HREF_RE) || u.pathname.match(CCFH_ROOM_PAGE_RE);
      return m ? m[1] : null;
    } catch (err) { return null; }
  }

  function ccfhFindRoomCardElement(anchor) {
    const structural = ccfhFindStructuralRoomItem(anchor);
    if (structural) return structural;
    const directCard = anchor.closest("li, [data-rbd-draggable-id], [class*='RoomCard'], [class*='roomCard']");
    const muiCard = anchor.closest(".MuiCard-root");
    const base = directCard || muiCard || anchor.parentElement || anchor;
    const gridItem = (muiCard || base).closest(".MuiGrid-item, [class*='MuiGrid-grid-xs-'], [class*='MuiGrid-grid-sm-'], [class*='MuiGrid-grid-md-'], [class*='MuiGrid-grid-lg-'], [class*='MuiGrid-grid-xl-']");
    return gridItem && gridItem.contains(anchor) ? gridItem : base;
  }

  function ccfhFindStructuralRoomItem(anchor) {
    let cur = anchor.closest(".MuiCard-root") || anchor;
    while (cur && cur.parentElement && cur.parentElement !== document.body) {
      const parent = cur.parentElement;
      const siblingsWithRooms = Array.from(parent.children).filter((child) => child.querySelector && child.querySelector('a[href*="/rooms/"]'));
      if (siblingsWithRooms.length >= 2) return cur;
      cur = parent;
    }
    return null;
  }

  function ccfhFindRoomCards(root) {
    const scope = root || document;
    const anchors = Array.from(scope.querySelectorAll('a[href*="/rooms/"]'));
    const seen = new Set();
    const out = [];
    for (const a of anchors) {
      const id = ccfhRoomIdFromHref(a.getAttribute("href") || "");
      if (!id) continue;
      const card = ccfhFindRoomCardElement(a);
      if (!card || seen.has(card)) continue;
      seen.add(card);
      card.setAttribute(CCFH_CARD_ATTR, "1");
      out.push({ id, anchor: a, card });
    }
    return out;
  }

  function ccfhFindTrashButton(card) {
    const buttons = Array.from(card.querySelectorAll("button")).filter((b) => !b.hasAttribute(CCFH_STAR_ATTR));
    for (const b of buttons) {
      const label = (b.getAttribute("aria-label") || "").toLowerCase();
      if (/delete|trash|remove|삭제|제거|削除/.test(label)) return b;
      const svg = b.querySelector("svg");
      if (svg && /trash|delete|m6 7|m9 3v1/i.test(svg.outerHTML)) return b;
      if (/delete|trash/i.test(b.getAttribute("data-testid") || "")) return b;
    }
    return buttons.length ? buttons[buttons.length - 1] : null;
  }

  function ccfhEnsureStar(roomInfo) {
    const { id, card } = roomInfo;
    card.setAttribute(CCFH_CARD_ATTR, "1");
    let star = card.querySelector(`[${CCFH_STAR_ATTR}="${CSS.escape(id)}"]`);
    const trash = ccfhFindTrashButton(card);
    if (!star) {
      star = document.createElement("button");
      star.type = "button";
      star.className = "ccfh-star-btn";
      star.setAttribute(CCFH_STAR_ATTR, id);
      star.setAttribute("aria-label", "즐겨찾기 토글");
      star.title = "즐겨찾기";
      star.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ccfhToggleFavorite(id);
        ccfhUpdateStar(star, id);
        ccfhMarkFavorite(card, id);
        // 단축 섹션이 있으면 재렌더 (즐겨찾기 토글 즉시 반영)
        if (typeof ccfhRenderRoomShortcutSections === "function") {
          ccfhRenderRoomShortcutSections();
        }
      });
    }
    if (trash && trash.parentElement) {
      // 휴지통 버튼의 좌측에 배치
      if (star.parentElement !== trash.parentElement || star.nextElementSibling !== trash) {
        trash.parentElement.insertBefore(star, trash);
      }
    } else if (!star.parentElement) {
      card.appendChild(star);
    }
    const actions = star.closest(".MuiCardActions-root, [class*='MuiCardActions-root']");
    if (actions) {
      actions.setAttribute("data-ccfh-actions", "1");
      ccfhPrepareTitleLine(ccfhFindActionTitleElement(actions));
    }
    ccfhUpdateStar(star, id);
    ccfhMarkFavorite(card, id);
  }

  function ccfhUpdateStar(star, id) {
    if (ccfhIsFavorite(id)) {
      star.textContent = "★";
      star.setAttribute("data-active", "1");
    } else {
      star.textContent = "☆";
      star.removeAttribute("data-active");
    }
  }

  function ccfhMarkFavorite(card, id) {
    const favs = ccfhFavorites();
    const index = favs.indexOf(id);
    if (index >= 0) {
      card.setAttribute(CCFH_FAV_ATTR, "1");
      card.style.order = String(-10000 + index);
    } else {
      card.removeAttribute(CCFH_FAV_ATTR);
      card.style.removeProperty("order");
    }
  }

  function ccfhEnsureOriginalOrder(parent, infos) {
    if (!parent || !Array.isArray(infos)) return;
    const ordered = infos
      .slice()
      .sort((a, b) => {
        return Array.prototype.indexOf.call(parent.children, a.card)
          - Array.prototype.indexOf.call(parent.children, b.card);
      });
    ordered.forEach((info, index) => {
      if (!info.card.hasAttribute(CCFH_ORIGINAL_ORDER_ATTR)) {
        info.card.setAttribute(CCFH_ORIGINAL_ORDER_ATTR, String(index));
      }
    });
  }

  function ccfhGetOriginalOrder(info, fallbackIndex) {
    const value = Number(info.card.getAttribute(CCFH_ORIGINAL_ORDER_ATTR));
    return Number.isFinite(value) ? value : fallbackIndex;
  }

  let ccfhReorderInProgress = false;
  let ccfhShortcutRenderInProgress = false;
  function ccfhReorderFavorites(force) {
    if (ccfhReorderInProgress && !force) return;
    ccfhReorderInProgress = true;
    try {
      const groups = new Map();
      for (const info of ccfhFindRoomCards(document)) {
        const parent = info.card.parentElement;
        if (!parent) continue;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(info);
      }
      for (const [parent, infos] of groups) {
        ccfhEnsureOriginalOrder(parent, infos);
        const favs = ccfhFavorites();
        const sorted = infos.slice().sort((a, b) => {
          const ai = favs.indexOf(a.id);
          const bi = favs.indexOf(b.id);
          if (ai >= 0 && bi >= 0) return ai - bi;
          if (ai >= 0) return -1;
          if (bi >= 0) return 1;
          return ccfhGetOriginalOrder(a, infos.indexOf(a))
            - ccfhGetOriginalOrder(b, infos.indexOf(b));
        });
        const marker = document.createComment("ccfh-order");
        parent.insertBefore(marker, infos[0].card);
        const fragment = document.createDocumentFragment();
        sorted.forEach((info) => {
          ccfhMarkFavorite(info.card, info.id);
          fragment.appendChild(info.card);
        });
        parent.insertBefore(fragment, marker);
        marker.remove();
      }
    } finally {
      setTimeout(() => { ccfhReorderInProgress = false; }, 0);
    }
  }

  function ccfhIsHomePage() {
    // 주의: 루트("/")는 ccfolia.com 랜딩 페이지(로그인 전, "지금 바로 시작" 화면)이므로 제외.
    // 단축 섹션은 로그인 후 대시보드(/home, /rooms 목록)에서만 표시.
    const p = location.pathname;
    return /^\/(home|rooms)\/?$/.test(p);
  }

  function ccfhCurrentRoomId() {
    const m = location.pathname.match(CCFH_ROOM_PAGE_RE);
    return m ? m[1] : null;
  }

  function ccfhTextWithoutCaption(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("small, span").forEach((child) => {
      const className = child.getAttribute("class") || "";
      if (/caption|ccfh-room-title-date/i.test(className)) child.remove();
    });
    return ccfhCleanText(clone.textContent);
  }

  function ccfhFindTitleCaption(el) {
    if (!el) return null;
    return Array.from(el.querySelectorAll("small, span")).find((child) => {
      const className = child.getAttribute("class") || "";
      return /caption|ccfh-room-title-date/i.test(className);
    }) || null;
  }

  function ccfhFindActionTitleElement(actions) {
    if (!actions) return null;
    return Array.from(actions.children).find((el) => (
      /^H[1-6]$/i.test(el.tagName) ||
      /\bMuiTypography-root\b/.test(el.getAttribute("class") || "")
    )) || null;
  }

  function ccfhSetTitleLine(titleEl, name, dateText, captionTemplate) {
    if (!titleEl) return;
    const titleText = ccfhCleanText(name);
    const captionText = ccfhCleanText(dateText);
    const main = document.createElement("span");
    main.className = "ccfh-room-title-main";
    main.textContent = titleText;
    const captionClone = captionText && captionTemplate ? captionTemplate.cloneNode(true) : null;
    titleEl.textContent = "";
    titleEl.appendChild(main);
    if (captionText) {
      const caption = captionClone || document.createElement("span");
      if (!caption.className || typeof caption.className !== "string") {
        caption.className = "MuiTypography-root MuiTypography-caption ccfh-room-title-date";
      } else if (!/\bccfh-room-title-date\b/.test(caption.className)) {
        caption.className = `${caption.className} ccfh-room-title-date`;
      }
      caption.textContent = captionText;
      titleEl.appendChild(caption);
    }
    titleEl.setAttribute("data-ccfh-title-line", "1");
  }

  function ccfhPrepareTitleLine(titleEl) {
    if (!titleEl) return;
    const titleText = ccfhTextWithoutCaption(titleEl);
    const caption = ccfhFindTitleCaption(titleEl);
    const dateText = caption ? ccfhCleanText(caption.textContent) : "";
    if (titleEl.querySelector(":scope > .ccfh-room-title-main")) {
      const date = ccfhFindTitleCaption(titleEl);
      if (date && !/\bccfh-room-title-date\b/.test(date.className || "")) {
        date.className = `${date.className || ""} ccfh-room-title-date`.trim();
      }
      titleEl.setAttribute("data-ccfh-title-line", "1");
      return;
    }
    ccfhSetTitleLine(titleEl, titleText, dateText, caption);
  }

  function ccfhFindCardTitleElement(card) {
    const headings = Array.from(card.querySelectorAll("h1, h2, h3, h4, h5, h6"));
    const heading = headings.find((el) => !ccfhIsGenericRoomName(ccfhTextWithoutCaption(el)));
    return heading || card.querySelector('[class*="title" i], [class*="name" i]');
  }

  function ccfhExtractRoomNameFromCard(card) {
      const originalTitleEl = ccfhFindCardTitleElement(card);
      if (!originalTitleEl) return "";
      
      // 💡 핵심: 코코포리아의 원본 DOM이 망가지는 것을 막기 위해 복제본 생성
      const titleEl = originalTitleEl.cloneNode(true);
      ccfhPrepareTitleLine(titleEl); // 복제본에만 구조 변경을 수행
      
      const primary = ccfhTextWithoutCaption(titleEl);
      if (primary && !ccfhIsGenericRoomName(primary)) return primary;
      const full = ccfhCleanText(titleEl.textContent);
      return ccfhIsGenericRoomName(full) ? "" : full;
    }

    function ccfhExtractRoomDateFromCard(card) {
      const originalTitleEl = ccfhFindCardTitleElement(card);
      if (!originalTitleEl) return "";

      // 💡 핵심: 여기서도 복제본 생성
      const titleEl = originalTitleEl.cloneNode(true);
      ccfhPrepareTitleLine(titleEl);

      const caption = ccfhFindTitleCaption(titleEl);
      return caption ? ccfhCleanText(caption.textContent) : "";
    }

  function ccfhExtractRoomDateFromCard(card, options) {
    const titleEl = ccfhFindCardTitleElement(card);
    if (!titleEl) return "";
    if (!options || options.prepare !== false) ccfhPrepareTitleLine(titleEl);
    const caption = ccfhFindTitleCaption(titleEl);
    return caption ? ccfhCleanText(caption.textContent) : "";
  }

  function ccfhExtractThumbnailFromCard(card) {
    const urlRe = /url\((['"]?)(.*?)\1\)/;
    // 1) MuiCardMedia 우선 — 코코포리아 카드 썸네일은 거의 항상 여기에 있음
    const cardMedia = card.querySelector('.MuiCardMedia-root, [class*="MuiCardMedia-root"]');
    if (cardMedia) {
      const inlineBg = cardMedia.style && cardMedia.style.backgroundImage || "";
      let m = inlineBg && inlineBg.match(urlRe);
      if (m && m[2]) return m[2];
      try {
        const computed = window.getComputedStyle(cardMedia).backgroundImage || "";
        if (computed && computed !== "none") {
          m = computed.match(urlRe);
          if (m && m[2]) return m[2];
        }
      } catch (_) { /* noop */ }
      const innerImg = cardMedia.querySelector("img[src]");
      if (innerImg) return innerImg.currentSrc || innerImg.src || innerImg.getAttribute("src") || "";
    }
    // 2) 카드 내부 background-image 가진 요소 중 url(...)을 가진 것
    const bgEl = Array.from(card.querySelectorAll('[style*="background-image"]'))
      .find((el) => /url\(/.test(el.style && el.style.backgroundImage || ""));
    if (bgEl) {
      const m = (bgEl.style.backgroundImage || "").match(urlRe);
      if (m && m[2]) return m[2];
    }
    // 3) 마지막 fallback — 카드 내부 첫 img
    const img = card.querySelector("img[src]");
    if (img) return img.currentSrc || img.src || img.getAttribute("src") || "";
    return "";
  }

  function ccfhCollectHomeRoomMeta(roomInfos) {
    const meta = ccfhRoomMeta();
    let changed = false;
    for (const { id, card } of roomInfos) {
      if (card.hasAttribute(CCFH_VISITED_ATTR)) continue;
      const name = ccfhExtractRoomNameFromCard(card);
      const date = ccfhExtractRoomDateFromCard(card);
      const thumbnail = ccfhExtractThumbnailFromCard(card);
      if (!name && !date && !thumbnail) continue;
      const current = meta[id] || {};
      if ((name && current.name !== name) || (date && current.date !== date) || (thumbnail && current.thumbnail !== thumbnail)) {
        meta[id] = {
          ...current,
          ...(name ? { name } : {}),
          ...(date ? { date } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          updatedAt: Date.now()
        };
        changed = true;
      }
    }
    if (changed) ccfhSaveRoomMeta(meta);
  }

  function ccfhRememberRoomFromAnchor(anchor) {
      const id = ccfhRoomIdFromHref(anchor && anchor.getAttribute("href"));
      if (!id) return;
      const card = ccfhFindRoomCardElement(anchor);
      if (!card || card.hasAttribute(CCFH_VISITED_ATTR)) return;
      
      // 옵션 제거 후 원상복구
      const name = ccfhExtractRoomNameFromCard(card);
      const date = ccfhExtractRoomDateFromCard(card);
      const thumbnail = ccfhExtractThumbnailFromCard(card);
      
      if (!name && !date && !thumbnail) return;
      const meta = ccfhRoomMeta();
      const current = meta[id] || {};
      meta[id] = {
        ...current,
        ...(name ? { name } : {}),
        ...(date ? { date } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        updatedAt: Date.now()
      };
      ccfhSaveRoomMeta(meta);
    }

  function ccfhFindRoomName(id) {
    const cached = id ? ccfhCachedRoomMeta(id) : {};
    if (cached.name) return cached.name;
    const t = (document.title || "").trim();
    const cleaned = t.replace(/\s*[|\-–]\s*ccfolia.*$/i, "").trim();
    if (cleaned && !ccfhIsGenericRoomName(cleaned)) return cleaned;
    const els = document.querySelectorAll("h1, h2, h3, h4, h5, h6, [class*='RoomName'], [class*='roomName'], [class*='Title']");
    for (const el of els) {
      const text = ccfhTextWithoutCaption(el);
      if (text && text.length <= 80 && !ccfhIsGenericRoomName(text)) return text;
    }
    if (cached.name) return cached.name;
    return "";
  }

  function ccfhFindRoomThumbnail(id) {
    const cached = id ? ccfhCachedRoomMeta(id) : {};
    if (cached.thumbnail && !ccfhIsGenericThumbnail(cached.thumbnail)) return cached.thumbnail;
    
    const og = document.querySelector('meta[property="og:image"]');
    const ogUrl = og ? og.getAttribute("content") : "";
    if (ogUrl && !ccfhIsGenericThumbnail(ogUrl)) return ogUrl;
    
    const img = document.querySelector('img[src*="ccfolia"], img[src*="rooms/"], img[src*="cdn"]');
    const imgUrl = img ? img.src : "";
    if (imgUrl && !ccfhIsGenericThumbnail(imgUrl)) return imgUrl;
    
    return cached.thumbnail || ogUrl || imgUrl || "";
  }

  let ccfhLastRecordKey = "";
  function ccfhMaybeRecordCurrent() {
    const id = ccfhCurrentRoomId();
    if (!id) return;
    const name = ccfhFindRoomName(id);
    if (!name) return;
    const key = `${id}::${name}`;
    if (key === ccfhLastRecordKey) return;
    ccfhLastRecordKey = key;
    ccfhRecordVisit({ id, name, thumbnail: ccfhFindRoomThumbnail(id) });
    console.info("[CCFH] recorded visit:", id, name);
  }

  function ccfhInjectVisitedCards() {
    if (!ccfhIsHomePage()) return;

    // 이미 방문 카드로 표시된 것은 제외하고 "원본" 카드만 수집
    const allCards = ccfhFindRoomCards(document);
    ccfhCollectHomeRoomMeta(allCards);
    ccfhRepairHistoryWithMeta();
    const owned = allCards.filter(({ card }) => !card.hasAttribute(CCFH_VISITED_ATTR));
    if (!owned.length) return; // 템플릿 카드가 없으면 스킵

    const template = owned[0].card;
    const parent = template.parentElement;
    if (!parent) return;

    const ownedIds = new Set(owned.map((o) => o.id));
    const history = ccfhHistory().filter((e) => !ownedIds.has(e.id)).map(ccfhResolveHistoryEntry);

    // 더 이상 history에 없는 방문 카드는 제거
    const validIds = new Set(history.map((e) => e.id));
    parent.querySelectorAll(`[${CCFH_VISITED_ATTR}]`).forEach((el) => {
      const id = el.getAttribute(CCFH_VISITED_ATTR);
      if (!validIds.has(id)) el.remove();
    });

    // 카드 생성/갱신
    history.forEach((entry) => {
      let visitedCard = parent.querySelector(`[${CCFH_VISITED_ATTR}="${CSS.escape(entry.id)}"]`);
      if (!visitedCard) {
        visitedCard = template.cloneNode(true);
        visitedCard.querySelectorAll(`[${CCFH_STAR_ATTR}]`).forEach((el) => el.remove());
        visitedCard.removeAttribute(CCFH_FAV_ATTR);
        visitedCard.setAttribute(CCFH_VISITED_ATTR, entry.id);
        parent.appendChild(visitedCard);
      }
      ccfhPopulateVisitedCard(visitedCard, entry);
      ccfhEnsureStar({ id: entry.id, card: visitedCard, anchor: visitedCard.querySelector("a") });
    });
  }

  function ccfhNavigateToRoom(id) {
    if (!id) return;
    const url = `/rooms/${encodeURIComponent(id)}`;
    if (location.pathname === url) return;
    location.assign(url);
  }

  function ccfhIsPlainLeftClick(event) {
    return event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey;
  }

  function ccfhIsRoomCardControl(target) {
    if (!(target instanceof Element)) return true;
    if (target.closest(`[${CCFH_STAR_ATTR}]`)) return true;
    const button = target.closest("button");
    if (button) return true;
    const input = target.closest("input, textarea, select, option, label");
    if (input) return true;
    const roleButton = target.closest('[role="button"]');
    if (roleButton && !roleButton.matches('a[href*="/rooms/"]')) return true;
    // 코코포리아 카드의 액션 영역(제목/날짜/삭제 버튼)은 룸 입장 클릭 영역에서 제외
    if (target.closest('.MuiCardActions-root, [class*="MuiCardActions-root"]')) return true;
    // 우리 단축 카드의 텍스트 영역(제목/날짜)도 입장 영역에서 제외
    if (target.closest('.ccfh-room-like-body')) return true;
    return false;
  }

  function ccfhFindRoomClickInfo(target) {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest('a[href*="/rooms/"]');
    if (anchor) {
      const id = ccfhRoomIdFromHref(anchor.getAttribute("href") || "");
      if (!id) return null;
      return {
        id,
        anchor,
        card: ccfhFindRoomCardElement(anchor)
      };
    }
    const card = target.closest(`[${CCFH_CARD_ATTR}]`);
    if (!card) return null;
    const cardAnchor = card.querySelector('a[href*="/rooms/"]');
    if (!cardAnchor) return null;
    const id = ccfhRoomIdFromHref(cardAnchor.getAttribute("href") || "");
    if (!id) return null;
    return {
      id,
      anchor: cardAnchor,
      card
    };
  }

  function ccfhHandleRoomCardClick(event) {
    if (!ccfhIsHomePage()) return;
    if (!ccfhIsPlainLeftClick(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const info = ccfhFindRoomClickInfo(target);
    if (!info || !info.id || !info.card) return;
    const isVisitedCard = info.card.hasAttribute(CCFH_VISITED_ATTR);
    const trashButton = target.closest("button");
    if (trashButton) {
      if (isVisitedCard && /delete|trash|remove|삭제|제거|削除/.test((trashButton.getAttribute("aria-label") || "").toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        ccfhRemoveHistory(info.id);
        info.card.remove();
      }
      return;
    }
    if (ccfhIsRoomCardControl(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!isVisitedCard) {
      ccfhRememberRoomFromAnchor(info.anchor);
    }
    ccfhNavigateToRoom(info.id);
  }

  function ccfhBindGlobalRoomNavigation() {
    if (document.documentElement.hasAttribute("data-ccfh-global-room-nav")) return;
    document.documentElement.setAttribute("data-ccfh-global-room-nav", "1");
    document.addEventListener("click", ccfhHandleRoomCardClick, true);

    document.addEventListener("contextmenu", (event) => {
      if (!ccfhIsHomePage()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const info = ccfhFindRoomClickInfo(target);
      if (info && info.id && info.card) {
        event.preventDefault();
        event.stopPropagation();
        const roomUrl = location.origin + "/rooms/" + info.id;
        const roomName = ccfhExtractRoomNameFromCard(info.card) || ccfhFindRoomName(info.id) || "선택한 룸";
        navigator.clipboard.writeText(roomUrl).then(() => {
          showToast("룸 주소 복사 완료", roomName);
        }).catch(() => {
          showToast("복사 실패", "클립보드 접근 권한이 필요합니다.");
        });
      }
    }, true);
  }

  function ccfhPopulateVisitedCard(card, entry) {
    card.setAttribute(CCFH_CARD_ATTR, "1");
    // 앵커 href 갱신
    card.querySelectorAll("a").forEach((a) => {
      a.setAttribute("href", `/rooms/${entry.id}`);
    });
    // 썸네일 교체
    if (entry.thumbnail) {
      card.querySelectorAll("img").forEach((img) => {
        img.src = entry.thumbnail;
        img.removeAttribute("srcset");
      });
      card.querySelectorAll('[style*="background-image"]').forEach((el) => {
        el.style.backgroundImage = `url(${JSON.stringify(entry.thumbnail)})`;
      });
    }
    // 룸 이름 교체 (가장 굵은 텍스트 후보 우선)
    const titleEl = ccfhFindCardTitleElement(card) || card.querySelector('h1, h2, h3, h4, h5, h6, [class*="title" i], [class*="name" i]');
    if (titleEl) ccfhSetTitleLine(titleEl, entry.name, entry.date, ccfhFindTitleCaption(titleEl));
    // 휴지통 버튼은 "방문기록에서 제거"로 의미 변경 — 라벨 갱신 + 동작은 위 click 핸들러에서 처리
    const trash = ccfhFindTrashButton(card);
    if (trash) {
      trash.setAttribute("aria-label", "방문기록에서 제거");
      trash.title = "방문기록에서 제거";
    }
  }

  function ccfhEntryFromMeta(id) {
    const meta = ccfhCachedRoomMeta(id);
    if (!id || !meta.name) return null;
    return {
      id,
      name: meta.name || "(이름 없음)",
      thumbnail: meta.thumbnail || "",
      date: meta.date || "",
      visitedAt: meta.updatedAt || 0
    };
  }

  function ccfhFindHomeMountPoint() {
    const firstRoomAnchor = document.querySelector('a[href*="/rooms/"]');
    if (!firstRoomAnchor) return null;
    const firstCard = ccfhFindRoomCardElement(firstRoomAnchor);
    if (!firstCard) return firstRoomAnchor;
    let cur = firstCard;
    while (cur && cur.parentElement && cur.parentElement !== document.body) {
      const parent = cur.parentElement;
      const roomChildren = Array.from(parent.children)
        .filter((child) => child.querySelector && child.querySelector('a[href*="/rooms/"]'));
      if (roomChildren.length >= 2) return parent;
      cur = parent;
    }
    return firstCard;
  }

  function ccfhFormatVisitDate(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = today.getTime() - target.getTime();
    if (diff === 0) return "오늘";
    if (diff === 86400000) return "어제";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}.${m}.${d}`;
  }

  let ccfhDraggingCard = null;
  let ccfhDragSectionKey = null;

  function ccfhSaveReorderedSection(grid, sectionKey) {
    if (!grid) return;
    const newIds = Array.from(grid.querySelectorAll(".ccfh-room-like-card"))
      .map((card) => card.getAttribute("data-ccfh-shortcut-card"))
      .filter(Boolean);

    if (sectionKey === "favorites") {
      const currentFavs = ccfhFavorites();
      const unrendered = currentFavs.filter((id) => !newIds.includes(id));
      ccfhSaveFavorites([...newIds, ...unrendered]);
    } else if (sectionKey === "recent") {
      const currentHistory = ccfhHistory();
      const newHistory = [];
      newIds.forEach((id) => {
        const found = currentHistory.find((e) => e.id === id);
        if (found) newHistory.push(found);
      });
      const unrendered = currentHistory.filter((e) => !newIds.includes(e.id));
      ccfhSaveHistory([...newHistory, ...unrendered]);
    }
    ccfhRenderRoomShortcutSections();
  }

  function ccfhCreateRoomLikeCard(entry, isFavoriteSection, foldKey) {
    const id = entry.id;
    const name = entry.name || "(이름 없음)";
    const url = `/rooms/${encodeURIComponent(id)}`;
    const isFav = ccfhIsFavorite(id);

    const card = document.createElement("article");
    card.className = "ccfh-room-like-card";
    card.setAttribute("data-ccfh-shortcut-card", id);
    card.draggable = true;

    card.addEventListener("dragstart", (e) => {
      ccfhDraggingCard = card;
      ccfhDragSectionKey = foldKey;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setTimeout(() => card.classList.add("is-dragging"), 0);
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragging");
      if (ccfhDraggingCard) {
        ccfhSaveReorderedSection(card.parentElement, foldKey);
        ccfhDraggingCard = null;
        ccfhDragSectionKey = null;
      }
    });

    const link = document.createElement("a");
    link.className = "ccfh-room-like-link";
    link.href = url;
    link.title = name;
    link.draggable = false;

    const thumb = document.createElement("div");
    thumb.className = "ccfh-room-like-thumb";
    if (entry.thumbnail) {
      thumb.style.backgroundImage = `url(${JSON.stringify(entry.thumbnail)})`;
    } else {
      thumb.classList.add("is-empty");
      thumb.textContent = "NO IMAGE";
    }

    const body = document.createElement("div");
    body.className = "ccfh-room-like-body";

    const title = document.createElement("div");
    title.className = "ccfh-room-like-title";
    title.textContent = name;

    const meta = document.createElement("div");
    meta.className = "ccfh-room-like-meta";
    meta.textContent = ccfhFormatVisitDate(entry.visitedAt) || entry.date || "";

    body.append(title, meta);
    link.append(thumb, body);

    const actions = document.createElement("div");
    actions.className = "ccfh-room-like-actions";

    const star = document.createElement("button");
    star.type = "button";
    star.className = "ccfh-room-like-star";
    star.textContent = isFav ? "★" : "☆";
    star.title = isFav ? "즐겨찾기 해제" : "즐겨찾기 추가";
    star.setAttribute("aria-label", star.title);
    star.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      ccfhToggleFavorite(id);
      ccfhRenderRoomShortcutSections();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ccfh-room-like-remove";
    remove.textContent = "×";
    remove.title = isFavoriteSection ? "즐겨찾기에서 제거" : "방문 기록에서 제거";
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isFavoriteSection) {
        const next = ccfhFavorites().filter((favId) => favId !== id);
        ccfhSaveFavorites(next);
      } else {
        ccfhRemoveHistory(id);
      }
      ccfhRenderRoomShortcutSections();
    });

    actions.append(star, remove);
    card.append(link, actions);
    return card;
  }

  const ccfhExpandedSections = {};

  function ccfhCreateRoomSection(title, entries, isFavoriteSection, foldKey) {
    const section = document.createElement("section");
    section.className = "ccfh-room-section";
    const folded = ccfhIsFolded(foldKey);
    if (folded) section.classList.add("is-folded");

    const headerWrap = document.createElement("div");
    headerWrap.className = "ccfh-section-header-wrap";

    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "ccfh-room-section-heading";
    heading.setAttribute("aria-expanded", String(!folded));

    const arrow = document.createElement("span");
    arrow.className = "ccfh-section-fold-arrow";
    arrow.textContent = "▾";

    const titleSpan = document.createElement("span");
    titleSpan.className = "ccfh-section-title";
    titleSpan.textContent = title;

    const countSpan = document.createElement("span");
    countSpan.className = "ccfh-section-count";
    countSpan.textContent = `(${entries.length})`;

    heading.append(arrow, titleSpan, countSpan);

    heading.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nowFolded = !section.classList.contains("is-folded");
      section.classList.toggle("is-folded", nowFolded);
      heading.setAttribute("aria-expanded", String(!nowFolded));
      ccfhSetFoldState(foldKey, nowFolded);
    });

    headerWrap.appendChild(heading);

    const controls = document.createElement("div");
    controls.className = "ccfh-header-controls";
    const viewToggle = document.createElement("button");
    viewToggle.type = "button";
    viewToggle.className = "ccfh-view-toggle";

    const iconList = '<svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>';
    const iconGrid = '<svg viewBox="0 0 24 24"><path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z"/></svg>';

    const currentView = ccfhGetView(foldKey);
    if (currentView === "list") {
      section.classList.add("is-list-view");
      viewToggle.innerHTML = iconGrid;
      viewToggle.title = "카드형으로 보기";
    } else {
      viewToggle.innerHTML = iconList;
      viewToggle.title = "리스트형으로 보기";
    }

    viewToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isList = section.classList.contains("is-list-view");
      if (isList) {
        section.classList.remove("is-list-view");
        ccfhSetViewState(foldKey, "card");
        viewToggle.innerHTML = iconList;
        viewToggle.title = "리스트형으로 보기";
      } else {
        section.classList.add("is-list-view");
        ccfhSetViewState(foldKey, "list");
        viewToggle.innerHTML = iconGrid;
        viewToggle.title = "카드형으로 보기";
      }
    });

    controls.appendChild(viewToggle);
    headerWrap.appendChild(controls);

    const wrapper = document.createElement("div");
    wrapper.className = "ccfh-room-card-grid-wrapper";

    const grid = document.createElement("div");
    grid.className = "ccfh-room-card-grid";

    grid.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!ccfhDraggingCard || ccfhDragSectionKey !== foldKey) return;
      e.dataTransfer.dropEffect = "move";
      
      const targetCard = e.target.closest(".ccfh-room-like-card:not(.is-dragging)");
      if (targetCard && targetCard !== ccfhDraggingCard) {
        const box = targetCard.getBoundingClientRect();
        const isListView = section.classList.contains("is-list-view");
        const isAfter = isListView
          ? e.clientY > box.top + box.height / 2
          : e.clientX > box.left + box.width / 2;
        if (isAfter) {
          const next = targetCard.nextElementSibling;
          if (next && next.classList.contains("ccfh-show-more-wrap")) return;
          grid.insertBefore(ccfhDraggingCard, next);
        } else {
          grid.insertBefore(ccfhDraggingCard, targetCard);
        }
      }
    });
    grid.addEventListener("drop", (e) => e.preventDefault());

    const limit = 15;
    const isExpanded = !!ccfhExpandedSections[foldKey];
    const visibleEntries = isExpanded ? entries : entries.slice(0, limit);

    visibleEntries.forEach((entry) => {
      grid.appendChild(ccfhCreateRoomLikeCard(entry, isFavoriteSection, foldKey));
    });

    if (entries.length > limit) {
      const moreWrap = document.createElement("div");
      moreWrap.className = "ccfh-show-more-wrap";
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "ccfh-show-more-btn";
      moreBtn.textContent = isExpanded ? "접기" : `더보기 (${entries.length - limit}개)`;
      moreBtn.addEventListener("click", () => {
        ccfhExpandedSections[foldKey] = !isExpanded;
        ccfhRenderRoomShortcutSections();
      });
      moreWrap.appendChild(moreBtn);
      grid.appendChild(moreWrap);
    }

    wrapper.appendChild(grid);
    section.append(headerWrap, wrapper);
    return section;
  }

  function ccfhDetectCocoColumnCount() {
    const cards = ccfhFindRoomCards(document)
      .map((info) => info.card)
      .filter((card) => !card.closest("#ccfh-shortcut-sections"));
    if (cards.length === 0) return 0;
    const card = cards[0];
    const parent = card.parentElement;
    if (!parent) return 0;
    const pw = parent.getBoundingClientRect().width;
    const cw = card.getBoundingClientRect().width;
    if (pw > 0 && cw > 0) {
      return Math.round(pw / cw);
    }
    return 0;
  }

  function ccfhDetectCocoGridGap() {
    const firstAnchor = document.querySelector('a[href*="/rooms/"]');
    if (!firstAnchor) return 0;
    const firstCard = ccfhFindRoomCardElement(firstAnchor);
    if (!firstCard || !firstCard.parentElement) return 0;
    const cs = window.getComputedStyle(firstCard.parentElement);
    const raw = cs.gap || cs.columnGap || cs.gridColumnGap || "";
    const match = String(raw).match(/^([\d.]+)px/);
    return match ? Math.round(parseFloat(match[1])) : 0;
  }

  function ccfhBackupData() {
    const favs = ccfhFavorites();
    const hist = ccfhHistory();
    if (!favs.length && !hist.length) {
      alert("백업할 데이터가 없습니다.");
      return;
    }
    const meta = ccfhRoomMeta();
    const backupData = {
      type: "ccfh-backup",
      version: 2,
      timestamp: Date.now(),
      favorites: favs,
      history: hist,
      meta: {}
    };
    const idsToBackup = new Set([...favs, ...hist.map((e) => e.id)]);
    idsToBackup.forEach((id) => {
      if (meta[id]) backupData.meta[id] = meta[id];
    });

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.download = `ccfolia-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function ccfhRestoreData() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const isV1 = data.type === "ccfh-favorites-backup";
          const isV2 = data.type === "ccfh-backup";
          if (!isV1 && !isV2) {
            return alert("올바른 백업 파일이 아닙니다.");
          }
          const favCount = Array.isArray(data.favorites) ? data.favorites.length : 0;
          const histCount = Array.isArray(data.history) ? data.history.length : 0;
          if (!confirm(`즐겨찾기 ${favCount}개, 방문 기록 ${histCount}개를 복원하시겠습니까?\n(기존 데이터와 병합됩니다.)`)) return;
          if (favCount > 0) {
            const currentFavs = ccfhFavorites();
            ccfhSaveFavorites([...new Set([...currentFavs, ...data.favorites])]);
          }
          if (histCount > 0) {
            const currentHistory = ccfhHistory();
            const existingIds = new Set(currentHistory.map((h) => h.id));
            const mergedHistory = [...currentHistory];
            data.history.forEach((entry) => {
              if (!existingIds.has(entry.id)) {
                mergedHistory.push(entry);
                existingIds.add(entry.id);
              }
            });
            mergedHistory.sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0));
            ccfhSaveHistory(mergedHistory);
          }
          if (data.meta && typeof data.meta === "object") ccfhSaveRoomMeta(Object.assign(ccfhRoomMeta(), data.meta));
          ccfhRefresh();
          if (typeof showToast === "function") showToast("데이터 복원 완료", `즐겨찾기 ${favCount}개, 방문 기록 ${histCount}개가 복원/병합되었습니다.`);
        } catch (err) {
          alert("파일을 읽거나 복원하는 중 오류가 발생했습니다.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  let ccfhLastShortcutSignature = "";
  function ccfhRenderRoomShortcutSections(force) {
    if (!ccfhIsHomePage()) return;

    const history = ccfhHistory().map(ccfhResolveHistoryEntry);
    const favIds = ccfhFavorites();

    const favoriteRooms = favIds
      .map((id) => history.find((entry) => entry.id === id) || ccfhEntryFromMeta(id))
      .filter(Boolean);

    const recentRooms = history.filter((entry) => !favIds.includes(entry.id));

    if (!favoriteRooms.length && !recentRooms.length) {
      const existing0 = document.getElementById("ccfh-shortcut-sections");
      if (existing0) existing0.remove();
      ccfhLastShortcutSignature = "";
      return;
    }

    // 동일한 데이터/펼침 상태라면 비싼 DOM 재생성을 건너뛴다.
    const sigFav = favoriteRooms.map((r) => `${r.id}|${r.name || ""}|${r.thumbnail || ""}`).join(",");
    const sigRec = recentRooms.map((r) => `${r.id}|${r.name || ""}|${r.thumbnail || ""}|${r.visitedAt || 0}`).join(",");
    const sigExpand = JSON.stringify(ccfhExpandedSections || {});
    const signature = `${sigFav}::${sigRec}::${sigExpand}`;
    const existing = document.getElementById("ccfh-shortcut-sections");
    if (!force && existing && signature === ccfhLastShortcutSignature) {
      return;
    }

    ccfhShortcutRenderInProgress = true;
    try {
      if (existing) existing.remove();

      const root = document.createElement("section");
      root.id = "ccfh-shortcut-sections";
      root.className = "ccfh-shortcut-sections";

      if (favoriteRooms.length) {
        root.appendChild(ccfhCreateRoomSection("즐겨찾기", favoriteRooms, true, "favorites"));
      }
      if (recentRooms.length) {
        root.appendChild(ccfhCreateRoomSection("최근 방문 기록", recentRooms, false, "recent"));
      }

      const divider = document.createElement("hr");
      divider.className = "ccfh-section-divider";
      root.appendChild(divider);

      const mount = ccfhFindHomeMountPoint();
      if (mount && mount.parentElement) {
        mount.parentElement.insertBefore(root, mount);
      } else {
        document.body.prepend(root);
      }

      // 코코포리아 원본 그리드의 컬럼 수와 gap을 감지해서 단축 섹션에 동일 적용
      const cocoCols = ccfhDetectCocoColumnCount();
      if (cocoCols > 0) {
        root.style.setProperty("--ccfh-grid-columns", `repeat(${cocoCols}, 1fr)`);
      }
      const cocoGap = ccfhDetectCocoGridGap();
      if (cocoGap > 0) {
        root.style.setProperty("--ccfh-grid-gap", `${cocoGap}px`);
      }
      ccfhLastShortcutSignature = signature;
    } finally {
      setTimeout(() => { ccfhShortcutRenderInProgress = false; }, 0);
    }
  }

  function ccfhInjectBackupRestoreButtons() {
    if (!ccfhIsHomePage()) return;
    const tablist = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
    if (!tablist) return;
    if (document.getElementById("ccfh-backup-controls")) return;

    const controls = document.createElement("div");
    controls.id = "ccfh-backup-controls";
    controls.style.marginLeft = "auto";
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "6px";
    controls.style.paddingRight = "8px";

    const backupBtn = document.createElement("button");
    backupBtn.type = "button";
    backupBtn.className = "ccfh-view-toggle";
    backupBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
    backupBtn.title = "데이터 백업 (.json)";
    backupBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof ccfhBackupData === "function") ccfhBackupData();
      else if (typeof ccfhBackupFavorites === "function") ccfhBackupFavorites();
    });

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "ccfh-view-toggle";
    restoreBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>';
    restoreBtn.title = "데이터 복원 (.json)";
    restoreBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof ccfhRestoreData === "function") ccfhRestoreData();
      else if (typeof ccfhRestoreFavorites === "function") ccfhRestoreFavorites();
    });

    controls.append(backupBtn, restoreBtn);
    tablist.appendChild(controls);
  }

  function ccfhRefresh() {
    ccfhInjectStyle();
    if (ccfhIsHomePage()) {
      const roomInfos = ccfhFindRoomCards(document);
      ccfhCollectHomeRoomMeta(roomInfos);
      ccfhRepairHistoryWithMeta();
      // 원본 카드에도 즐겨찾기 별 버튼 주입 (DOM 재정렬은 안 함)
      roomInfos.forEach(ccfhEnsureStar);
      ccfhRenderRoomShortcutSections();
      ccfhInjectBackupRestoreButtons();
    }
    if (ccfhCurrentRoomId()) ccfhMaybeRecordCurrent();
  }

  function ccfhInit() {
    ccfhInjectStyle();
    ccfhBindGlobalRoomNavigation();

    // 우리가 관심 있는 경로에서만 MutationObserver를 가동한다.
    // (홈/룸 목록/룸 진입 페이지가 아니면 옵저버 콜백을 통째로 스킵)
    const isRelevantRoute = () => ccfhIsHomePage() || !!ccfhCurrentRoomId();

    let pendingTimer = 0;
    const schedule = () => {
      if (pendingTimer) return;
      pendingTimer = window.setTimeout(() => {
        pendingTimer = 0;
        ccfhRefresh();
      }, 120);
    };
    const obs = new MutationObserver((mutations) => {
      if (ccfhReorderInProgress) return;
      if (ccfhShortcutRenderInProgress) return;
      if (ccfhDraggingCard) return;
      if (!isRelevantRoute()) return;
      // 룸 링크가 추가/제거되었거나, 우리가 관리하는 노드 변경이 있을 때만 갱신
      let interesting = false;
      for (const m of mutations) {
        if (m.target && m.target.id === "ccfh-shortcut-sections") continue;
        const added = m.addedNodes;
        for (let i = 0; i < added.length; i++) {
          const n = added[i];
          if (n.nodeType !== 1) continue;
          if (n.matches && (n.matches('a[href*="/rooms/"]') || n.querySelector('a[href*="/rooms/"]'))) {
            interesting = true; break;
          }
        }
        if (interesting) break;
        const removed = m.removedNodes;
        for (let i = 0; i < removed.length; i++) {
          const n = removed[i];
          if (n.nodeType !== 1) continue;
          if (n.hasAttribute && (n.hasAttribute(CCFH_CARD_ATTR) || n.hasAttribute(CCFH_VISITED_ATTR))) {
            interesting = true; break;
          }
        }
        if (interesting) break;
      }
      if (!interesting) return;
      schedule();
    });
    // documentElement 전체 → body로 축소 (head 변동에는 관심 없음)
    obs.observe(document.body, { childList: true, subtree: true });

    // SPA 네비게이션 후킹
    const fire = () => window.dispatchEvent(new Event("ccfh:locationchange"));
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { const r = origPush.apply(this, args); fire(); return r; };
    history.replaceState = function (...args) { const r = origReplace.apply(this, args); fire(); return r; };
    window.addEventListener("popstate", fire);
    window.addEventListener("ccfh:locationchange", () => {
      ccfhLastRecordKey = "";
      setTimeout(ccfhRefresh, 50);
      setTimeout(ccfhRefresh, 600);
    });

    // 창 크기가 바뀌면 코코포리아 그리드 컬럼 수가 달라지므로 단축 섹션도 재측정/재렌더
    let ccfhResizeTimer = 0;
    window.addEventListener("resize", () => {
      if (!ccfhIsHomePage()) return;
      if (!document.getElementById("ccfh-shortcut-sections")) return;
      clearTimeout(ccfhResizeTimer);
      ccfhResizeTimer = setTimeout(() => {
        ccfhRenderRoomShortcutSections(true);
      }, 150);
    });

    // 룸 페이지 제목이 늦게 채워지는 경우를 위한 폴링
    // (룸 페이지가 아닐 때는 작업 없음 + 주기 완화)
    setInterval(() => {
      if (!ccfhCurrentRoomId()) return;
      ccfhMaybeRecordCurrent();
    }, 4000);

    ccfhRefresh();
    console.info("[CCFH] Home enhancer integrated v0.1.2 (scoped observer, throttled refresh)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ccfhInit, { once: true });
  } else {
    ccfhInit();
  }
})();


// Integrated toolkit presence indicator.
(() => {
  "use strict";

  const DEBUG_KEY = "__CAPYBARA_TOOLKIT_PRESENCE__";
  const ROOT_ID = "capybara-toolkit-presence";
  const STYLE_ID = "capybara-toolkit-presence-style";
  const SAFE_UI_ATTR = "data-capybara-toolkit-presence";
  const CLIENT_ID_KEY = "capybara-toolkit-presence-client-id";
  const PRESENCE_KEY = "capybaraToolkitPresence";
  const PRESENCE_VERSION = 1;
  const FALLBACK_TOOLKIT_VERSION = "0.1.23";
  const ACTIVE_MS = 12 * 1000;
  const STALE_MS = 20 * 1000;
  const SYNC_INTERVAL_MS = 5000;
  const FIRESTORE_PROJECT_ID = "ccfolia-160aa";
  const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  const FIRESTORE_SUBCOLLECTION = "capybaraToolkitBgm";
  const FIRESTORE_DOC_PREFIX = "presence_";
  const FIRESTORE_TOKEN_TTL_MS = 5 * 60 * 1000;
  const FIREBASE_AUTH_DB_NAME = "firebaseLocalStorageDb";
  const FIREBASE_AUTH_STORE_NAME = "firebaseLocalStorage";
  const INVIS_START = "\u2063\u2063\u2063";
  const INVIS_END = "\u2062\u2062\u2062";
  const INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
  const INVIS_REVERSE = new Map(INVIS_MAP.map((ch, index) => [ch, index]));
  const EDITOR_SELECTOR = 'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]';
  const CHAT_MACRO_MENU_SELECTOR = '[role="listbox"], [id^="downshift-"][id$="-menu"]';
  const MESSAGE_TEXT_SELECTOR = [
    'p.MuiTypography-root.MuiTypography-body2',
    '.MuiListItemText-root > p',
    '[data-index] p',
    'li p'
  ].join(", ");

  // Replace an already-running presence integration instead of binding twice.
  window[DEBUG_KEY]?.disable?.();

  let active = true;
  let scanTimer = 0;
  let peerRoomKey = "";
  const abort = new AbortController();
  const peers = new Map();
  const clientId = getClientId();
  let refreshTimer = 0;
  let panelOpen = false;
  let syncInFlight = false;
  let wasToolkitRunning = false;
  let cachedDisplayName = "";
  let tokenCache = { token: "", fetchedAt: 0 };

  const api = {
    integration: "ccfolia-suite",
    __owner: abort.signal,
    decorateEnvelope,
    decorateOutgoingText,
    getPeers: () => [...peers.values()],
    isPanelOpen: () => panelOpen,
    setPanelOpen,
    togglePanel: () => setPanelOpen(!panelOpen),
    syncNow: () => syncPresenceNow(),
    disable
  };

  window[DEBUG_KEY] = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true, signal: abort.signal });
  } else {
    start();
  }

  function start() {
    if (!active) return;
    injectStyles();
    ensurePanel();
    bindSendTriggers();
    observeMessages();
    scanMessages();
    renderPanel();
    void syncPresenceNow();
    refreshTimer = window.setInterval(() => void syncPresenceNow(), SYNC_INTERVAL_MS);
    window.addEventListener("resize", renderPanel, { signal: abort.signal });
  }

  function disable() {
    if (!active) return false;
    active = false;
    abort.abort();
    window.clearInterval(refreshTimer);
    window.clearTimeout(scanTimer);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll('[data-capybara-presence-bound], [data-capybara-presence-enter-bound]').forEach((element) => {
      delete element.dataset.capybaraPresenceBound;
      delete element.dataset.capybaraPresenceEnterBound;
    });
    if (window[DEBUG_KEY]?.__owner === abort.signal) {
      delete window[DEBUG_KEY];
    }
    return true;
  }

  function isCcfoliaRoom() {
    return /(?:^|\.)ccfolia\.com$/i.test(location.hostname) && /^\/rooms\/[^/?#]+/i.test(location.pathname);
  }

  function getRoomKey() {
    return location.pathname.match(/^\/rooms\/([^/?#]+)/i)?.[1] || location.pathname;
  }

  function getClientId() {
    try {
      const stored = window.localStorage.getItem(CLIENT_ID_KEY);
      if (stored) return stored;
      const next = `capybara-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(CLIENT_ID_KEY, next);
      return next;
    } catch (error) {
      return `capybara-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function createPresencePayload(name) {
    return {
      type: "toolkitPresence",
      v: PRESENCE_VERSION,
      roomKey: getRoomKey(),
      clientId,
      name: sanitizeName(name) || "\uB098",
      at: Date.now(),
      toolkitVersion: String(window.__CAPYBARA_TOOLKIT__?.version || FALLBACK_TOOLKIT_VERSION)
    };
  }

  function sanitizeName(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function isToolkitRunning() {
    return !!window.__CAPYBARA_TOOLKIT__;
  }

  function getPresenceDisplayName() {
    const current = sanitizeName(getLocalDisplayName());
    if (current && current !== "\uB098") cachedDisplayName = current;
    return cachedDisplayName || current || "\uB098";
  }

  function rememberPresence(payload, options = {}) {
    if (!isCcfoliaRoom() || !payload || payload.roomKey !== getRoomKey() || !payload.clientId) return false;
    if (peerRoomKey !== payload.roomKey) {
      peers.clear();
      peerRoomKey = payload.roomKey;
    }

    const at = Number(payload.at) || Date.now();
    const previous = peers.get(payload.clientId);
    if (!options.self && Date.now() - at > STALE_MS) return false;
    if (previous && at < previous.at) return false;
    const name = sanitizeName(payload.name) || (payload.clientId === clientId ? "\uB098" : "\uD234\uD0B7 \uC0AC\uC6A9\uC790");
    peers.set(payload.clientId, {
      clientId: payload.clientId,
      name,
      at,
      toolkitVersion: String(payload.toolkitVersion || ""),
      self: options.self === true || (previous?.self === true && payload.clientId === clientId && isToolkitRunning())
    });
    return true;
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    renderPanel();
    try {
      window.dispatchEvent(new CustomEvent("capybara-toolkit-presence:panel-state", {
        detail: { open: panelOpen }
      }));
    } catch (error) {
      // Ignore event dispatch failures in restricted contexts.
    }
  }

  async function syncPresenceNow() {
    if (!active || syncInFlight || !isCcfoliaRoom()) return;
    syncInFlight = true;
    try {
      const running = isToolkitRunning();
      if (running) {
        const payload = createPresencePayload(getPresenceDisplayName());
        rememberPresence(payload, { self: true });
        await writeRemotePresence(payload);
      } else {
        peers.delete(clientId);
        if (wasToolkitRunning) {
          await removeRemotePresence();
        }
      }
      wasToolkitRunning = running;
      await readRemotePresence();
      renderPanel();
    } finally {
      syncInFlight = false;
    }
  }

  function getPresenceDocumentUrl() {
    const docId = `${FIRESTORE_DOC_PREFIX}${clientId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 900)}`;
    return `${FIRESTORE_BASE_URL}/rooms/${encodeURIComponent(getRoomKey())}/${FIRESTORE_SUBCOLLECTION}/${encodeURIComponent(docId)}`;
  }

  function getPresenceCollectionUrl() {
    return `${FIRESTORE_BASE_URL}/rooms/${encodeURIComponent(getRoomKey())}/${FIRESTORE_SUBCOLLECTION}?pageSize=100`;
  }

  async function writeRemotePresence(payload) {
    const token = await readFirebaseIdToken();
    if (!token) return;
    try {
      const response = await fetch(getPresenceDocumentUrl(), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ fields: encodeFirestoreFields(payload) }),
        credentials: "omit",
        mode: "cors"
      });
      if (response.status === 401) tokenCache = { token: "", fetchedAt: 0 };
    } catch (error) {
      // Chat-envelope presence remains available if remote sync is unavailable.
    }
  }

  async function removeRemotePresence() {
    const token = await readFirebaseIdToken();
    if (!token) return;
    try {
      const response = await fetch(getPresenceDocumentUrl(), {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` },
        credentials: "omit",
        mode: "cors"
      });
      if (response.status === 401) tokenCache = { token: "", fetchedAt: 0 };
    } catch (error) {
      // The short expiry removes a disconnected user if DELETE cannot be sent.
    }
  }

  async function readRemotePresence() {
    let token = "";
    try {
      token = await readFirebaseIdToken();
      const headers = token ? { "Authorization": `Bearer ${token}` } : {};
      const response = await fetch(getPresenceCollectionUrl(), {
        method: "GET",
        headers,
        credentials: "omit",
        mode: "cors"
      });
      if (response.status === 401) tokenCache = { token: "", fetchedAt: 0 };
      if (response.status === 404) return;
      if (!response.ok) return;
      const data = await response.json();
      const now = Date.now();
      for (const document of Array.isArray(data?.documents) ? data.documents : []) {
        const payload = decodeFirestoreFields(document?.fields);
        if (payload.type !== "toolkitPresence" || payload.roomKey !== getRoomKey()) continue;
        if (!payload.clientId || now - Number(payload.at || 0) > STALE_MS) continue;
        if (payload.clientId === clientId && !isToolkitRunning()) continue;
        rememberPresence(payload, { self: payload.clientId === clientId && isToolkitRunning() });
      }
    } catch (error) {
      // Keep the last recent snapshot while the remote channel is unavailable.
    }

    const now = Date.now();
    for (const [id, peer] of peers) {
      if (id === clientId && isToolkitRunning()) continue;
      if (now - peer.at > STALE_MS) peers.delete(id);
    }
  }

  function encodeFirestoreFields(payload) {
    const fields = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (typeof value === "string") fields[key] = { stringValue: value };
      else if (typeof value === "boolean") fields[key] = { booleanValue: value };
      else if (typeof value === "number" && Number.isFinite(value)) {
        fields[key] = Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
      }
    }
    return fields;
  }

  function decodeFirestoreFields(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (typeof value?.stringValue === "string") out[key] = value.stringValue;
      else if (typeof value?.booleanValue === "boolean") out[key] = value.booleanValue;
      else if (typeof value?.integerValue === "string") out[key] = Number(value.integerValue);
      else if (typeof value?.doubleValue === "number") out[key] = value.doubleValue;
    }
    return out;
  }

  async function readFirebaseIdToken() {
    const now = Date.now();
    if (tokenCache.token && now - tokenCache.fetchedAt < FIRESTORE_TOKEN_TTL_MS) return tokenCache.token;
    try {
      const token = await openFirebaseAuthDbAndExtractToken();
      tokenCache = { token: token || "", fetchedAt: now };
      return token || "";
    } catch (error) {
      return "";
    }
  }

  function openFirebaseAuthDbAndExtractToken() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finalize = (value, error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      let request;
      try {
        request = indexedDB.open(FIREBASE_AUTH_DB_NAME);
      } catch (error) {
        finalize("", error);
        return;
      }
      request.onerror = () => finalize("", request.error || new Error("firebase auth db open failed"));
      request.onblocked = () => finalize("");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FIREBASE_AUTH_STORE_NAME)) {
          db.close();
          finalize("");
          return;
        }
        let transaction;
        try {
          transaction = db.transaction(FIREBASE_AUTH_STORE_NAME, "readonly");
        } catch (error) {
          db.close();
          finalize("", error);
          return;
        }
        const result = transaction.objectStore(FIREBASE_AUTH_STORE_NAME).getAll();
        result.onerror = () => {
          db.close();
          finalize("", result.error);
        };
        result.onsuccess = () => {
          const rows = Array.isArray(result.result) ? result.result : [];
          db.close();
          let token = "";
          for (const row of rows) {
            const candidate = row?.value?.stsTokenManager?.accessToken;
            if (typeof candidate !== "string" || candidate.length < 20) continue;
            token = candidate;
            if (String(row?.fbase_key || "").startsWith("firebase:authUser:")) break;
          }
          finalize(token);
        };
      };
    });
  }

  function decorateEnvelope(envelope, visibleText = "") {
    if (!active || !isToolkitRunning() || !envelope || typeof envelope !== "object") return envelope;
    const name = getPresenceDisplayName();
    envelope[PRESENCE_KEY] = createPresencePayload(name);
    if (!envelope.text && typeof visibleText === "string") {
      envelope.text = visibleText;
    }
    rememberPresence(envelope[PRESENCE_KEY], { self: true });
    renderPanel();
    return envelope;
  }

  function decorateOutgoingText(value) {
    const currentText = normalizeText(value);
    if (!isToolkitRunning()) return currentText;
    const extracted = extractEnvelope(currentText);
    const visibleText = extracted ? extracted.visibleText : stripInvisibleEnvelope(currentText);
    if (!visibleText.trim()) return currentText;

    const envelope = extracted?.envelope && typeof extracted.envelope === "object"
      ? extracted.envelope
      : { v: 1, text: visibleText };
    decorateEnvelope(envelope, visibleText);

    const encoded = encodeEnvelopeToInvisible(envelope);
    if (!extracted) return visibleText + encoded;
    return `${extracted.visibleText}${encoded}${extracted.afterText || ""}`;
  }

  function hasVisibleChatMacroMenuForEditor(editor) {
    if (!(editor instanceof HTMLTextAreaElement) || editor.getAttribute("name") !== "text") return false;

    const controls = [editor, editor.closest?.('[role="combobox"]')]
      .filter((control) => control instanceof HTMLElement);
    if (controls.some((control) => {
      if (control.getAttribute("aria-expanded") === "true") return true;
      const activeDescendant = control.getAttribute("aria-activedescendant");
      return !!activeDescendant && !!document.getElementById(activeDescendant);
    })) {
      return true;
    }

    const relatedIds = getChatMacroMenuIdsForEditor(editor);
    const directMenus = [...relatedIds]
      .map((id) => document.getElementById(id))
      .filter((menu) => menu instanceof HTMLElement);
    const candidates = [...new Set([...directMenus, ...document.querySelectorAll(CHAT_MACRO_MENU_SELECTOR)])];

    return candidates.some((menu) => {
      if (!(menu instanceof HTMLElement) || !isVisible(menu)) return false;
      if (!String(menu.textContent || "").trim()) return false;
      if (relatedIds.has(menu.id)) return true;

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

  function getChatMacroMenuIdsForEditor(editor) {
    if (!(editor instanceof HTMLTextAreaElement) || editor.getAttribute("name") !== "text") return new Set();
    const ids = new Set();
    [editor, editor.closest?.('[role="combobox"]')]
      .filter((control) => control instanceof HTMLElement)
      .forEach((control) => {
        [control.getAttribute("aria-controls"), control.getAttribute("aria-owns")]
          .filter(Boolean)
          .forEach((id) => ids.add(id));
      });
    const inputId = editor.id || "";
    if (inputId.endsWith("-input")) ids.add(`${inputId.slice(0, -6)}-menu`);
    return ids;
  }

  function bindSendTriggers() {
    const bind = () => {
      document.querySelectorAll('button[type="submit"]').forEach((button) => {
        if (button.dataset.capybaraPresenceBound === "1") return;
        button.dataset.capybaraPresenceBound = "1";
        button.addEventListener("click", () => {
          if (!active) return;
          const editor = findEditorFromNode(button);
          if (editor) preparePresenceForSend(editor);
        }, { capture: true, signal: abort.signal });
      });

      document.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
        if (!(editor instanceof HTMLElement)) return;
        if (editor.closest?.(`[${SAFE_UI_ATTR}="1"]`)) return;
        if (editor.dataset.capybaraPresenceEnterBound === "1") return;
        editor.dataset.capybaraPresenceEnterBound = "1";
        editor.addEventListener("keydown", (event) => {
          if (!active) return;
          if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
          if (hasVisibleChatMacroMenuForEditor(editor)) return;
          preparePresenceForSend(editor);
        }, { capture: true, signal: abort.signal });
      });
    };

    bind();
    const observer = new MutationObserver(bind);
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    abort.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }

  function preparePresenceForSend(editor) {
    const currentText = getEditorText(editor);
    const visibleText = stripInvisibleEnvelope(currentText);
    if (!visibleText.trim()) return true;

    const nextText = decorateOutgoingText(currentText);
    if (nextText === currentText) return true;

    setEditorText(editor, nextText);
    scheduleEditorRestore(editor, visibleText, nextText);
    return true;
  }

  function scheduleEditorRestore(editor, rawText, outgoingText) {
    [180, 450, 1000, 2000].forEach((delay, index, checkpoints) => {
      window.setTimeout(() => {
        if (!active || !document.contains(editor)) return;
        const current = getEditorText(editor);
        if (current !== outgoingText && !current.includes(INVIS_START)) return;
        if (current.includes(INVIS_START)) {
          setEditorText(editor, stripInvisibleEnvelope(current));
          return;
        }
        if (index === checkpoints.length - 1 && current === outgoingText) {
          setEditorText(editor, rawText);
        }
      }, delay);
    });
  }

  function observeMessages() {
    const observer = new MutationObserver(scheduleScanMessages);
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true, characterData: true });
    abort.signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  }

  function scheduleScanMessages() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scanMessages();
    }, 120);
  }

  function scanMessages() {
    let changed = false;
    document.querySelectorAll(MESSAGE_TEXT_SELECTOR).forEach((node) => {
      const text = node.getAttribute?.("data-ccf-raw") || node.textContent || "";
      const payload = extractPresencePayload(text);
      if (payload) {
        changed = rememberPresence(payload) || changed;
      }
    });
    if (changed || isCcfoliaRoom()) renderPanel();
  }

  function extractPresencePayload(text) {
    const extracted = extractEnvelope(text);
    const payload = extracted?.envelope?.[PRESENCE_KEY];
    if (!payload || typeof payload !== "object") return null;
    return payload;
  }

  function ensurePanel() {
    if (!isCcfoliaRoom()) {
      document.getElementById(ROOT_ID)?.remove();
      return null;
    }
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      existing.hidden = !panelOpen;
      return existing;
    }
    const root = document.createElement("section");
    root.id = ROOT_ID;
    root.setAttribute(SAFE_UI_ATTR, "1");
    root.setAttribute("aria-live", "polite");
    root.hidden = !panelOpen;
    root.innerHTML = `
      <div class="capybara-presence-title">\uD234\uD0B7 \uC0AC\uC6A9\uC790</div>
      <div class="capybara-presence-list"></div>
      <div class="capybara-presence-note">\uC2E4\uC2DC\uAC04 \uC2E4\uD589 \uC0C1\uD0DC \uAE30\uC900</div>
    `;
    (document.body || document.documentElement).appendChild(root);
    return root;
  }

  function renderPanel() {
    if (!isCcfoliaRoom()) {
      document.getElementById(ROOT_ID)?.remove();
      return;
    }
    if (peerRoomKey !== getRoomKey()) {
      peers.clear();
      peerRoomKey = getRoomKey();
      if (isToolkitRunning()) {
        rememberPresence(createPresencePayload(getPresenceDisplayName()), { self: true });
      }
    }
    const root = ensurePanel();
    if (!root) return;
    root.hidden = !panelOpen;
    const list = root.querySelector(".capybara-presence-list");
    if (!list) return;

    const now = Date.now();
    const rows = [...peers.values()]
      .filter((peer) => peer.self || now - peer.at <= STALE_MS)
      .sort((a, b) => Number(b.self) - Number(a.self) || b.at - a.at || a.name.localeCompare(b.name));

    list.innerHTML = "";
    rows.forEach((peer) => {
      const row = document.createElement("div");
      const age = Math.max(0, now - peer.at);
      const state = peer.self || age <= ACTIVE_MS ? "active" : "idle";
      row.className = `capybara-presence-row ${state}`;
      row.innerHTML = `
        <span class="capybara-presence-dot" aria-hidden="true"></span>
        <span class="capybara-presence-name">${escapeHtml(peer.self ? `${peer.name} (\uB098)` : peer.name)}</span>
        <span class="capybara-presence-age">${escapeHtml(peer.self ? "\uC811\uC18D \uC911" : formatAge(age))}</span>
      `;
      list.appendChild(row);
    });
    if (panelOpen) positionPanel(root);
  }

  function positionPanel(root) {
    const toggle = document.getElementById("ccf-suite-toggle");
    if (!(toggle instanceof HTMLElement) || !isVisible(toggle)) {
      root.style.left = "auto";
      root.style.top = "auto";
      root.style.right = "14px";
      root.style.bottom = "70px";
      return;
    }

    root.style.right = "auto";
    root.style.bottom = "auto";
    const padding = 12;
    const gap = 10;
    const toggleRect = toggle.getBoundingClientRect();
    const panelRect = root.getBoundingClientRect();
    const width = panelRect.width || 220;
    const height = panelRect.height || 120;
    const maxLeft = Math.max(padding, window.innerWidth - width - padding);
    const left = Math.max(padding, Math.min(maxLeft, toggleRect.right - width));
    let top = toggleRect.top - height - gap;
    if (top < padding) {
      top = Math.min(window.innerHeight - height - padding, toggleRect.bottom + gap);
    }
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.max(padding, Math.round(top))}px`;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        z-index: 2147482400;
        width: min(220px, calc(100vw - 28px));
        box-sizing: border-box;
        padding: 9px 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        background: rgba(28, 28, 28, 0.92);
        color: #fff;
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
        font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #${ROOT_ID}[hidden] {
        display: none !important;
      }

      #${ROOT_ID} .capybara-presence-title {
        font-weight: 800;
        margin-bottom: 6px;
      }

      #${ROOT_ID} .capybara-presence-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      #${ROOT_ID} .capybara-presence-row {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr) auto;
        align-items: center;
        gap: 6px;
        min-height: 18px;
      }

      #${ROOT_ID} .capybara-presence-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: #9ca3af;
      }

      #${ROOT_ID} .capybara-presence-row.active .capybara-presence-dot {
        background: #58d68d;
      }

      #${ROOT_ID} .capybara-presence-row.idle .capybara-presence-dot {
        background: #f4c542;
      }

      #${ROOT_ID} .capybara-presence-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      #${ROOT_ID} .capybara-presence-age,
      #${ROOT_ID} .capybara-presence-note {
        color: rgba(255, 255, 255, 0.62);
        font-size: 11px;
      }

      #${ROOT_ID} .capybara-presence-note {
        margin-top: 6px;
      }

    `;
    document.documentElement.appendChild(style);
  }

  function findEditorFromNode(node) {
    const direct = normalizeEditorCandidate(node);
    if (direct) return direct;

    const origin = node instanceof Element ? node : null;
    const composer = findClosestComposerBar(origin);
    const candidates = [];

    if (composer) {
      candidates.push(...composer.querySelectorAll(EDITOR_SELECTOR));
      let cur = composer.parentElement;
      for (let i = 0; i < 5 && cur; i += 1, cur = cur.parentElement) {
        candidates.push(...cur.querySelectorAll(EDITOR_SELECTOR));
      }
    }

    if (!candidates.length) {
      candidates.push(...document.querySelectorAll(EDITOR_SELECTOR));
    }

    return pickBestEditor(candidates, origin || composer);
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
    if (!el.querySelector('button[type="submit"]')) return false;
    return [...el.querySelectorAll("button")].some((btn) => /^D\d+$/i.test(getButtonLabel(btn))) ||
      [...el.querySelectorAll(EDITOR_SELECTOR)].some((editor) => normalizeEditorCandidate(editor));
  }

  function normalizeEditorCandidate(node) {
    if (!(node instanceof HTMLElement)) return null;
    if (node.closest?.(`[${SAFE_UI_ATTR}="1"]`)) return null;
    if (!node.matches?.(EDITOR_SELECTOR)) {
      const closest = node.closest?.(EDITOR_SELECTOR);
      return closest instanceof HTMLElement ? normalizeEditorCandidate(closest) : null;
    }
    if (node instanceof HTMLInputElement && node.type !== "text") return null;
    if (!isVisible(node)) return null;
    return node;
  }

  function pickBestEditor(candidates, anchor = null) {
    const unique = [...new Set(candidates.map(normalizeEditorCandidate).filter(Boolean))];
    if (!unique.length) return null;
    unique.sort((a, b) => scoreEditor(b, anchor) - scoreEditor(a, anchor));
    return unique[0] || null;
  }

  function scoreEditor(editor, anchor = null) {
    const hint = [
      editor.getAttribute("placeholder"),
      editor.getAttribute("aria-label"),
      editor.getAttribute("name"),
      editor.id,
      typeof editor.className === "string" ? editor.className : ""
    ].filter(Boolean).join(" ").toLowerCase();
    const rect = editor.getBoundingClientRect();
    let score = 0;
    if (editor instanceof HTMLTextAreaElement) score += 80;
    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") score += 50;
    if (/message|chat|comment|send|message|채팅|메시지|입력|발언/i.test(hint)) score += 100;
    if (/name|character|display.?name|nickname|이름|캐릭터/i.test(hint)) score -= 160;
    if (rect.width >= 240) score += 20;
    if (rect.height >= 40) score += 20;
    if (anchor instanceof HTMLElement) score -= Math.min(distanceBetween(anchor, editor) / 8, 80);
    return score;
  }

  function getLocalDisplayName() {
    const editor = document.activeElement instanceof Element ? findEditorFromNode(document.activeElement) : null;
    const composer = editor ? findClosestComposerBar(editor) : null;
    const name = getNameFromComposer(composer) || getNameFromVisibleUi();
    return sanitizeName(name) || "\uB098";
  }

  function getNameFromComposer(composer) {
    if (!(composer instanceof HTMLElement)) return "";
    const inputs = [...composer.querySelectorAll('input[type="text"], [contenteditable="true"], [role="textbox"]')];
    for (const input of inputs) {
      if (normalizeEditorCandidate(input)) continue;
      const value = getEditorText(input);
      const hint = [
        input.getAttribute("placeholder"),
        input.getAttribute("aria-label"),
        input.getAttribute("name"),
        input.id
      ].filter(Boolean).join(" ").toLowerCase();
      if (value && /name|character|nickname|이름|캐릭터/i.test(hint)) return value;
    }
    return "";
  }

  function getNameFromVisibleUi() {
    const selectors = [
      '[aria-label*="\uC774\uB984"]',
      '[placeholder*="\uC774\uB984"]',
      '[aria-label*="name" i]',
      '[placeholder*="name" i]'
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = getEditorText(el);
      if (sanitizeName(value)) return value;
    }
    return "";
  }

  function getEditorText(editor) {
    if (!editor) return "";
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      return normalizeText(editor.value || "");
    }
    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      return normalizeText(typeof editor.innerText === "string" ? editor.innerText : (editor.textContent || ""));
    }
    return normalizeText(editor.textContent || "");
  }

  function setEditorText(editor, value) {
    if (!editor) return;
    const nextValue = normalizeText(value);
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(editor.constructor.prototype, "value")?.set;
      if (setter) setter.call(editor, nextValue);
      else editor.value = nextValue;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      editor.textContent = nextValue;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function stripInvisibleEnvelope(text) {
    const normalized = normalizeText(text);
    const extracted = extractEnvelope(normalized);
    if (!extracted) return normalized;
    return `${extracted.visibleText}${extracted.afterText || ""}`;
  }

  function extractEnvelope(fullText) {
    const text = normalizeText(fullText);
    const startIndex = text.indexOf(INVIS_START);
    const endIndex = text.indexOf(INVIS_END, startIndex + INVIS_START.length);
    if (startIndex < 0 || endIndex < 0) return null;

    const visibleText = text.slice(0, startIndex);
    const encodedPart = text.slice(startIndex + INVIS_START.length, endIndex);
    const afterText = text.slice(endIndex + INVIS_END.length);

    try {
      return {
        visibleText,
        envelope: JSON.parse(decodeInvisibleToJson(encodedPart)),
        afterText
      };
    } catch (error) {
      return null;
    }
  }

  function encodeEnvelopeToInvisible(envelope) {
    const json = JSON.stringify(envelope);
    const base64 = utf8ToBase64(json);
    let bits = "";
    for (const ch of base64) {
      bits += ch.charCodeAt(0).toString(2).padStart(8, "0");
    }

    let out = INVIS_START;
    for (let i = 0; i < bits.length; i += 2) {
      out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, "0"), 2)];
    }
    return out + INVIS_END;
  }

  function decodeInvisibleToJson(encodedPart) {
    let bits = "";
    for (const ch of encodedPart) {
      const value = INVIS_REVERSE.get(ch);
      if (value == null) continue;
      bits += value.toString(2).padStart(2, "0");
    }

    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return base64ToUtf8(String.fromCharCode(...bytes).replace(/\0+$/g, ""));
  }

  function utf8ToBase64(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  function base64ToUtf8(base64) {
    return decodeURIComponent(escape(atob(base64)));
  }

  function normalizeText(value) {
    return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
  }

  function formatAge(age) {
    const seconds = Math.max(0, Math.floor(age / 1000));
    if (seconds < 60) return "\uBC29\uAE08";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}\uBD84 \uC804`;
    return `${Math.floor(minutes / 60)}\uC2DC\uAC04 \uC804`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[ch]);
  }

  function getButtonLabel(button) {
    return (button?.getAttribute?.("aria-label") || button?.textContent || "").trim().toUpperCase();
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

