// ==UserScript==
// @name         CCFOLIA Toolkit Presence by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-toolkit-presence
// @version      0.0.21
// @description  카피바라 툴킷 사용자 패널 — 같은 룸의 툴킷 사용자 presence 송수신. ccfolia-suite에서 분리.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==
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

  // ---- 룸 상단 툴바의 "카피바라 도구" 펭귄 메뉴 ----
  // 버튼·창은 여기서만 만든다. 각 기능 스크립트는 로드 순서와 무관하게 window.__CCF_TOOLKIT_MENU__.register({ id, order, label, icon, visible(), badge?(), onClick(), mount?(container), unmount?() }) 로 항목만 등록한다.
  // mount 가 있는 항목은 "GM 도구" 창의 탭이 되어 mount(container)로 자기 내용을 탭 본문에 그린다(탭을 바꾸거나 창을 닫으면 unmount()). mount 가 없는 항목은 예전처럼 메뉴 항목.
  // 창을 코드로 열려면 registry.openTool(id)(그 탭으로 열기) / closeTool() / isToolOpen().
  // (레지스트리 객체는 먼저 로드된 쪽이 만들고, 여기서는 sync 를 붙인다). 항목이 하나도 보이지 않으면 버튼을 숨긴다.
  const MENU_BUTTON_ATTR = "data-ccf-toolkit-menu-button";
  // 이전 전신 펭귄 실루엣(tools/gen-penguin-svg.cjs 가 만든 path, 눈 1.9배 수정 포함)을 그대로 두고 viewBox 만 머리 쪽(10.3 0.5 9.8 9.8)으로 잘라 확대한 것: 도형은 새로 그리지 않았다.
  const PENGUIN_SVG = '<svg width="24" height="24" viewBox="10.3 0.5 9.8 9.8" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M13.73 2L14.48 2.01L15.26 2.25L15.76 2.51L17.02 3.38L18.62 3.95L19.03 4.31L19.21 4.7L17.99 4.85L17.23 5.05L15.74 5.84L15.41 6.09L15.41 6.75L16.2 7.79L16.48 8.4L16.72 9.37L16.75 10.39L16.59 11.94L16.59 12.83L16.67 13.49L16.62 14.85L16.46 15.79L16.04 17.18L15.62 18.07L15.33 18.49L15.11 18.66L14.71 18.66L14.65 18.76L14.36 20.07L13.68 21.3L13.68 21.93L13.87 22.15L14.11 22.26L15 22.28L15.47 22.41L16 22.7L16.25 22.95L16.33 23.16L15.5 23.15L15.47 23.36L15.19 23.28L14.45 23.28L14.29 23.51L13.77 23.31L13.14 23.31L13.11 23.41L12.41 23.38L12.35 23.75L11.44 23.75L11.41 23.96L10.75 23.8L10.05 23.8L9.86 24.01L9.36 23.88L8.68 23.88L8.66 23.99L8.18 23.72L7.96 23.4L7.99 22.16L7.7 22.06L7.44 21.35L6.99 19.41L6.78 17.97L6.13 17.97L5.73 19.04L5.33 19.5L5.22 19.56L4.96 19.53L4.79 19.15L4.82 18.07L5 16.47L5.5 14.09L6.07 12.38L6.94 10.68L7.73 8.77L8.49 7.66L10.19 6.12L10.92 4.1L11.5 3.15L11.96 2.69L12.43 2.38L13.04 2.12L13.72 2.01ZM14.57 5.25L14.83 5.33L14.54 5.62L14.44 5.83L14.44 6.85L15.28 8.11L15.59 8.71L15.88 9.68L15.96 10.65L15.67 12.36L14.75 15.64L13.65 18.99L13.1 20.25L12.04 20.21L11.46 20.47L9.89 20.47L9.55 20.63L9.18 21.02L8.54 20.22L8.25 19.54L7.99 17.94L8.01 16.84L8.17 15.69L8.36 14.9L9.22 12.8L9.27 11.39L9.19 10.97L9.48 10.23L10.02 9.56L11.12 8.73L12.18 7.64L12.63 7.01L13.02 6.06L13.25 5.79L13.77 5.45L14.56 5.26ZM14.23 3.66a0.69 0.69 0 1 0 1.38 0a0.69 0.69 0 1 0 -1.38 0ZM14.56 3.66a0.36 0.36 0 1 0 0.72 0a0.36 0.36 0 1 0 -0.72 0Z"/></svg>';
  const menuState = { button: null, frame: 0 };

  // section:true 항목은 공용 "설정" 탭 안의 소제목 구역으로 그려지고 메뉴·탭으로는 따로 나오지 않는다.
  function visibleRegistryItems() {
    const registry = window.__CCF_TOOLKIT_MENU__;
    return registry?.items ? [...registry.items.values()] : [];
  }
  function settingsSections() { return visibleRegistryItems().filter((item) => item.section === true && typeof item.mount === "function").filter((item) => { try { return item.visible ? !!item.visible() : true; } catch (_) { return false; } }).sort((a, b) => (a.order ?? 99) - (b.order ?? 99)); }
  function toolkitMenuItems() {
    const items = visibleRegistryItems().filter((item) => item.section !== true);
    return items.filter((item) => { try { return item.visible ? !!item.visible() : true; } catch (_) { return false; } }).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }

  function findMenuAnchor() {
    const labelled = (words) => [...document.querySelectorAll("button[aria-label], button[title], [role='button'][aria-label]")]
      .find((node) => words.some((word) => `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`.includes(word)) && !node.hasAttribute(MENU_BUTTON_ATTR) && !node.disabled); // 비활성(참여자에게 보이는 [GM] 버튼)은 닻으로 쓰지 않는다: 복제하면 클릭도 툴팁도 안 된다
    return labelled(["컷인 목록", "カットイン一覧", "Cut-in list", "Cutin list"])
      || labelled(["내 캐릭터 목록", "내 캐릭터", "캐릭터 목록", "My characters", "My character", "マイキャラクター", "キャラクター一覧"]);
  }

  // ---- 펭귄 버튼의 툴팁: 코코포리아의 MUI Tooltip 을 잰 값 그대로 (버튼은 메뉴 없이 GM 도구 창을 바로 열고, 다시 누르면 닫는다) (룸 메뉴·계정 메뉴·툴바 버튼, 테스트 룸 실측) ----
  // 메뉴: 투명 백드롭(fixed, 바깥 클릭으로 닫힘) 위에 paper rgba(44,44,44,.87) 모서리 4 elevation8 그림자, ul 패딩 8 0, 항목 padding 6 16, Roboto 16/24 자간 .15008px,
  // hover rgba(255,255,255,.08) · focus-visible .12, 글자 왼쪽(margin-right 28)·아이콘 오른쪽 20px, 버튼 아래 왼쪽 맞춤, Grow(opacity 전체 시간 · transform 0.666배, scale .75→1, 시간은 높이로 정하는 auto).
  const MUI_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
  // 툴팁(MUI Tooltip): 배경 rgb(22,22,22), Roboto 12/500 흰색, 패딩 4 8, 모서리 4, 위쪽 여백 14 · 가운데 맞춤 · 버튼 아래, 100ms 뒤 Grow(opacity 200ms · transform 133ms), 최대 폭 300.
  const tipState = { node: null, timer: 0 };
  function hideToolkitTip() {
    window.clearTimeout(tipState.timer); tipState.timer = 0;
    const node = tipState.node; tipState.node = null;
    if (!node) return;
    const tip = node.firstElementChild;
    if (tip) { tip.style.opacity = "0"; tip.style.transform = "scale(0.75)"; }
    window.setTimeout(() => node.remove(), 150);
  }
  function showToolkitTip() {
    window.clearTimeout(tipState.timer);
    tipState.timer = window.setTimeout(() => {
      tipState.timer = 0;
      if (tipState.node || !menuState.button || menuState.button.hidden) return;
      const node = document.createElement("div");
      node.setAttribute(SAFE_UI_ATTR, "1");
      node.setAttribute("role", "tooltip");
      node.style.cssText = "position:fixed;z-index:2147483001;pointer-events:none;top:0;left:0;margin:0";
      const tip = document.createElement("div");
      tip.textContent = "GM 도구";
      tip.style.cssText = "box-sizing:border-box;margin:14px 2px 2px;max-width:300px;padding:4px 8px;border-radius:4px;background:rgb(22,22,22);color:#fff;font:500 12px/normal Roboto,Helvetica,Arial,sans-serif;word-wrap:break-word;box-shadow:0px 1px 3px 0px rgba(0,0,0,.2),0px 1px 1px 0px rgba(0,0,0,.14),0px 2px 1px -1px rgba(0,0,0,.12);opacity:0;transform:scale(0.75);transform-origin:center top;transition:opacity 200ms " + MUI_EASE + ",transform 133ms " + MUI_EASE;
      node.appendChild(tip);
      document.documentElement.appendChild(node);
      const rect = menuState.button.getBoundingClientRect();
      node.style.transform = `translate3d(${Math.round(rect.left + rect.width / 2 - node.offsetWidth / 2)}px,${Math.round(rect.bottom)}px,0)`;
      tipState.node = node;
      void tip.offsetHeight;
      tip.style.opacity = "1"; tip.style.transform = "none";
    }, 100);
  }

  // ---- GM 도구 창: 코코포리아 기본 모달 모양(paper rgba(44,44,44,.87), 모서리 4px, MUI 그림자), 제목 "GM 도구", 탭(MUI Tabs 밑줄 파랑), 마지막 탭 기억 ----
  // 시트로 채팅을 보내며 쓰는 창이라 배경을 가리는 백드롭은 없고 제목줄을 끌어 옮길 수 있다.
  const TOOLS_TAB_KEY = "ccfGmToolsTab";
  const toolsState = { host: null, tab: "", mounted: null, tabsKey: "", sectionsKey: "", pos: { x: 0, y: 0 } };

  // 공용 "설정" 탭: 각 기능이 section:true 로 등록한 설정 화면을 소제목 구역으로 한 곳에 모은다.
  const GEAR_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  const SETTINGS_TAB_ID = "gm-settings";
  const settingsMounted = [];
  const sectionsKey = () => settingsSections().map((item) => item.id + ":" + item.label).join("|");
  function mountSettingsTab(container) {
    const wrap = document.createElement("div");
    wrap.className = "ccf-gt-settings";
    toolsState.sectionsKey = sectionsKey();
    for (const item of settingsSections()) {
      const section = document.createElement("section");
      section.setAttribute("data-ccf-settings-section", item.id);
      const title = document.createElement("h3");
      title.textContent = item.label;
      const body = document.createElement("div");
      if (item.hideTitle) section.append(body); else section.append(title, body); // 소제목 없이 그릴 구역(핸드아웃: 내용의 라벨로 충분)
      wrap.appendChild(section);
      settingsMounted.push(item);
      try { item.mount(body); } catch (error) { console.warn("[toolkit-menu] settings section failed", item.id, error); }
    }
    container.appendChild(wrap);
  }
  function unmountSettingsTab() {
    while (settingsMounted.length) { const item = settingsMounted.pop(); try { item.unmount?.(); } catch (error) { console.warn("[toolkit-menu] settings section unmount failed", error); } }
  }

  function openSettingsFromMenu() { openGmTools(SETTINGS_TAB_ID); }

  function toolTabs() { return toolkitMenuItems().filter((item) => typeof item.mount === "function"); }

  function rememberedToolTab() { try { return localStorage.getItem(TOOLS_TAB_KEY) || ""; } catch (_) { return ""; } }

  function ensureToolsStyle() {
    if (document.getElementById("ccf-gm-tools-style")) return;
    const style = document.createElement("style");
    style.id = "ccf-gm-tools-style";
    style.setAttribute(SAFE_UI_ATTR, "1");
    style.textContent = `
      #ccf-gm-tools{position:fixed;inset:0;z-index:2147482999;pointer-events:none;font-family:"Roboto","Noto Sans KR","Noto Sans JP",system-ui,sans-serif;color:#fff}
      #ccf-gm-tools .ccf-gt-window,#ccf-gm-tools .ccf-gt-window>*{box-sizing:border-box}
      #ccf-gm-tools .ccf-gt-window{position:absolute;inset:10px;margin:auto;width:min(640px,92vw);height:min(900px,calc(100vh - 64px));pointer-events:auto;display:flex;flex-direction:column;background:rgba(44,44,44,.87);background-image:none;border-radius:4px;box-shadow:0px 11px 15px -7px rgba(0,0,0,.2),0px 24px 38px 3px rgba(0,0,0,.14),0px 9px 46px 8px rgba(0,0,0,.12);overflow:hidden}
      #ccf-gm-tools .ccf-gt-window>header{display:flex;align-items:center;flex:0 0 auto;min-height:54px;padding:0 8px 0 24px;background:#212121;cursor:move;user-select:none;touch-action:none}
      #ccf-gm-tools .ccf-gt-window>header>h2{margin:0;flex:1;font-size:16px;font-weight:700;line-height:25.12px;letter-spacing:.09996px}
      #ccf-gm-tools .ccf-gt-settings{position:absolute;inset:0;overflow:auto;padding:0 24px 24px}
      #ccf-gm-tools .ccf-gt-settings h3{margin:20px 0 8px;font-size:14px;font-weight:700;line-height:21.98px;letter-spacing:.09996px}
      #ccf-gm-tools .ccf-gt-settings section+section{margin-top:12px}
      #ccf-gm-tools .ccf-gt-close,#ccf-gm-tools .ccf-gt-tab{font:inherit;color:inherit}
      #ccf-gm-tools .ccf-gt-close{all:unset;box-sizing:border-box;cursor:pointer;width:40px;height:40px;display:inline-grid;place-items:center;border-radius:50%;transition:background-color 150ms}
      #ccf-gm-tools .ccf-gt-close:hover{background:rgba(255,255,255,.08)}
      #ccf-gm-tools .ccf-gt-close svg{width:24px;height:24px;fill:currentColor}
      #ccf-gm-tools .ccf-gt-tabs[hidden]{display:none}
      #ccf-gm-tools .ccf-gt-tabs{display:flex;flex:0 0 auto;min-height:48px;background:#212121;border-bottom:1px solid rgba(255,255,255,.12)}
      #ccf-gm-tools .ccf-gt-tab{all:unset;box-sizing:border-box;position:relative;cursor:pointer;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:6px 16px;font-size:14px;font-weight:700;color:rgba(255,255,255,.7)}
      #ccf-gm-tools .ccf-gt-tab:hover{background:rgba(255,255,255,.06)}
      #ccf-gm-tools .ccf-gt-tab[aria-selected="true"]{color:#fff}
      #ccf-gm-tools .ccf-gt-tab[aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:#2196f3}
      #ccf-gm-tools .ccf-gt-tab svg{width:20px;height:20px}
      #ccf-gm-tools .ccf-gt-tab .ccf-gt-badge{min-width:18px;padding:0 5px;border-radius:9px;background:#f50057;color:#fff;font-size:11px;text-align:center}
      #ccf-gm-tools .ccf-gt-body{position:relative;flex:1 1 auto;min-height:0;overflow:hidden}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function renderToolTabs() {
    const bar = toolsState.host?.querySelector(".ccf-gt-tabs");
    if (!bar) return;
    const tabs = toolTabs();
    const key = tabs.map((item) => `${item.id}:${item.label}`).join("|");
    bar.hidden = tabs.length < 2; // 보이는 탭이 하나면 탭 줄 없이 그 내용만
    const body = toolsState.host.querySelector(".ccf-gt-body"); // 탭이 하나면 도구 자신의 제목이 보이게(둘 이상이면 탭 이름이 제목): 도구 CSS 가 이 표시를 본다
    if (body) { if (tabs.length < 2) body.setAttribute("data-single-tab", "1"); else body.removeAttribute("data-single-tab"); }
    if (toolsState.tabsKey !== key) {
      toolsState.tabsKey = key;
      bar.textContent = "";
      for (const item of tabs) {
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "ccf-gt-tab";
        tab.setAttribute("role", "tab");
        tab.setAttribute("data-ccf-tool-tab", item.id);
        tab.innerHTML = `<span>${escapeHtml(item.label)}</span>`;
        tab.addEventListener("click", () => showToolTab(item.id), { signal: abort.signal });
        bar.appendChild(tab);
      }
      bar.setAttribute("role", "tablist");
    }
    bar.querySelectorAll(".ccf-gt-tab").forEach((tab) => {
      const selected = tab.getAttribute("data-ccf-tool-tab") === toolsState.tab;
      if (tab.getAttribute("aria-selected") !== String(selected)) tab.setAttribute("aria-selected", String(selected));
    });
  }

  function unmountTool() {
    const item = toolsState.mounted;
    toolsState.mounted = null;
    if (!item) return;
    try { item.unmount?.(); } catch (error) { console.warn("[toolkit-menu] unmount failed", error); }
    const body = toolsState.host?.querySelector(".ccf-gt-body");
    if (body) body.textContent = "";
  }

  function showToolTab(id) {
    const item = toolTabs().find((entry) => entry.id === id);
    const body = toolsState.host?.querySelector(".ccf-gt-body");
    if (!item || !body) return false;
    if (toolsState.mounted?.id === id) { toolsState.tab = id; renderToolTabs(); return true; }
    unmountTool();
    toolsState.tab = id;
    try { localStorage.setItem(TOOLS_TAB_KEY, id); } catch (_) { /* 저장 불가 */ }
    renderToolTabs();
    toolsState.mounted = item;
    try { item.mount(body); } catch (error) { console.warn("[toolkit-menu] mount failed", error); }
    return true;
  }

  function openGmTools(tabId) {
    const tabs = toolTabs();
    if (!tabs.length) return false;
    const wanted = tabs.find((item) => item.id === tabId) || tabs.find((item) => item.id === rememberedToolTab()) || tabs[0];
    if (!toolsState.host) {
      ensureToolsStyle();
      const host = document.createElement("div");
      host.id = "ccf-gm-tools";
      host.setAttribute(SAFE_UI_ATTR, "1");
      host.innerHTML = '<section class="ccf-gt-window" role="dialog" aria-label="GM 도구"><header><h2>GM 도구</h2><button type="button" class="ccf-gt-close" aria-label="닫기" title="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></header><nav class="ccf-gt-tabs" hidden></nav><div class="ccf-gt-body"></div></section>';
      host.querySelector(".ccf-gt-close").addEventListener("click", () => closeGmTools(), { signal: abort.signal });
      host.addEventListener("keydown", (event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); closeGmTools(); menuState.button?.focus(); } }, { signal: abort.signal });
      const win = host.querySelector(".ccf-gt-window");
      win.style.transform = `translate3d(${toolsState.pos.x}px,${toolsState.pos.y}px,0)`;
      host.querySelector("header").addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        event.preventDefault();
        const start = { x: event.clientX, y: event.clientY, pos: { ...toolsState.pos } };
        const move = (next) => { toolsState.pos = { x: start.pos.x + next.clientX - start.x, y: start.pos.y + next.clientY - start.y }; win.style.transform = `translate3d(${toolsState.pos.x}px,${toolsState.pos.y}px,0)`; };
        const stop = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); document.removeEventListener("pointercancel", stop); };
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", stop); document.addEventListener("pointercancel", stop);
      }, { signal: abort.signal });
      document.documentElement.appendChild(host);
      toolsState.host = host;
      toolsState.tabsKey = "";
      menuState.button?.setAttribute("aria-expanded", "true");
    }
    return showToolTab(wanted.id);
  }

  function closeGmTools() {
    if (!toolsState.host) return;
    unmountTool();
    toolsState.host.remove();
    toolsState.host = null;
    toolsState.tab = "";
    toolsState.tabsKey = "";
    menuState.button?.setAttribute("aria-expanded", "false");
  }

  // 항목 목록이 바뀌었을 때(방 이동, 인세인 룸이 아니게 됨 등) 열린 창을 맞춘다
  function syncGmTools() {
    if (!toolsState.host) return;
    const tabs = toolTabs();
    if (!tabs.length) { closeGmTools(); return; }
    if (!tabs.some((item) => item.id === toolsState.tab)) { showToolTab(tabs[0].id); return; }
    renderToolTabs();
    if (toolsState.mounted?.id === SETTINGS_TAB_ID && toolsState.sectionsKey !== sectionsKey()) { unmountTool(); toolsState.tab = ""; showToolTab(SETTINGS_TAB_ID); }
  }

  function syncToolkitMenu() {
    syncGmTools();
    const items = toolkitMenuItems();
    const anchor = items.length && isCcfoliaRoom() ? findMenuAnchor() : null;
    if (!anchor?.parentElement) {
      if (menuState.button && !menuState.button.hidden) { menuState.button.hidden = true; hideToolkitTip(); }
      return;
    }
    if (!menuState.button || !menuState.button.isConnected) {
      document.querySelectorAll(`[${MENU_BUTTON_ATTR}]`).forEach((node) => node.remove());
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(MENU_BUTTON_ATTR, "1");
      button.setAttribute(SAFE_UI_ATTR, "1");
      button.setAttribute("aria-label", "GM 도구");
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("mouseenter", showToolkitTip, { signal: abort.signal });
      button.addEventListener("mouseleave", hideToolkitTip, { signal: abort.signal });
      button.addEventListener("focus", () => { if (button.matches(":focus-visible")) showToolkitTip(); }, { signal: abort.signal });
      button.addEventListener("blur", hideToolkitTip, { signal: abort.signal });
      button.className = anchor.className.replace(/Mui-(?:disabled|focusVisible)/g, "").trim();
      button.innerHTML = PENGUIN_SVG;
      button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); hideToolkitTip(); toolsState.host ? closeGmTools() : openGmTools(); // 메뉴 없이 GM 도구 창을 바로 연다(마지막에 연 탭, 열려 있으면 닫기)
       }, { signal: abort.signal });
      menuState.button = button;
    }
    const button = menuState.button;
    if (button.previousElementSibling !== anchor) anchor.parentElement.insertBefore(button, anchor.nextSibling);
    if (button.hidden) button.hidden = false;
    // 배지: 항목 중 하나라도 배지가 있으면 버튼에도 점을 단다
    let hasBadge = false;
    for (const item of items) { try { if (item.badge && item.badge()) hasBadge = true; } catch (_) { /* 배지 계산 실패는 무시 */ } }
    if (button.getAttribute("data-badge") !== (hasBadge ? "1" : "0")) button.setAttribute("data-badge", hasBadge ? "1" : "0");
  }

  function scheduleToolkitMenuSync() {
    if (menuState.frame) return;
    menuState.frame = window.requestAnimationFrame(() => { menuState.frame = 0; syncToolkitMenu(); });
  }

  function startToolkitMenu() {
    const registry = (window.__CCF_TOOLKIT_MENU__ ||= { items: new Map(), register(item) { if (this.items.get(item.id)?.onClick === item.onClick) return; this.items.set(item.id, item); this.sync?.(); } });
    registry.sync = scheduleToolkitMenuSync;
    registry.register({ id: SETTINGS_TAB_ID, order: 80, label: "설정", icon: GEAR_ICON, visible: () => settingsSections().length > 0, onClick: openSettingsFromMenu, mount: mountSettingsTab, unmount: unmountSettingsTab });
    registry.openTool = (id) => openGmTools(id);
    registry.closeTool = () => closeGmTools();
    registry.isToolOpen = () => !!toolsState.host;
    const style = document.createElement("style");
    style.setAttribute(SAFE_UI_ATTR, "1");
    style.textContent = `[${MENU_BUTTON_ATTR}][data-badge="1"]{position:relative}[${MENU_BUTTON_ATTR}][data-badge="1"]::after{content:"";position:absolute;top:8px;right:8px;width:8px;height:8px;border-radius:50%;background:#f50057}`;
    document.head.appendChild(style);
    const observer = new MutationObserver((records) => {
      if (records.every((record) => record.target instanceof Element && record.target.closest(`[${SAFE_UI_ATTR}="1"]`))) return;
      scheduleToolkitMenuSync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    abort.signal.addEventListener("abort", () => { observer.disconnect(); hideToolkitTip(); closeGmTools(); document.getElementById("ccf-gm-tools-style")?.remove(); menuState.button?.remove(); style.remove(); }, { once: true });
    scheduleToolkitMenuSync();
  }

  function start() {
    if (!active) return;
    queueMicrotask(startToolkitMenu); // 아래 const 선언이 끝난 뒤에 시작(TDZ 방지)
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

  // 판정 명령은 원문 그대로 나가야 코코포리아(BCDice)가 굴린다.
  // 이 스크립트는 항상 켜져 있어, format-sync / roll20-bridge 가 양보해도
  // 여기서 봉투를 붙이면 결국 명령이 인식되지 않는다. (choice[a,b] 미판정 원인)
  // 규칙은 두 스크립트와 동일 — 메시지가 명령으로 "시작"할 때만.
  function looksLikeCcfDiceCommand(text) {
    const raw = String(text || "");
    if (!raw) return false;
    const body = raw.replace(/\[\[[^\]]*\]\]/g, "").trim();
    if (!body) return false;
    return /^S?(?:choice|CHOICE)\s*\[/.test(body)
      || /^S?\d*[dD]\d+\b/.test(body)
      || /^S?CCB?\s*<=/i.test(body)
      || /^S?(?:ST|FT|BET|RTT[1-6]?|TVT|TET|TPT|TST|TKT|TMT)\b/i.test(body)
      || /^SC\([1-6]\)/i.test(body);
  }

  function preparePresenceForSend(editor) {
    // 네이티브 MUI 다이얼로그(캐릭터 이미지 라이브러리 / Unsplash 검색 등) 안의 입력은
    // 채팅 입력창이 아니므로 presence 페이로드를 주입하지 않는다.
    // (주입 시 Unsplash 검색 쿼리가 오염되어 414 URI Too Long 발생)
    if (editor instanceof Element && editor.closest?.('.MuiDialog-root, [role="dialog"]')) return true;
    const currentText = getEditorText(editor);
    const visibleText = stripInvisibleEnvelope(currentText);
    if (!visibleText.trim()) return true;
    if (looksLikeCcfDiceCommand(visibleText)) return true;

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
    // 접속자 패널 자신(renderPanel 이 목록을 다시 쓴다)이나 다른 툴킷 요소의 변화에는 반응하지 않는다 — 안 그러면 패널이 스스로를 계속 다시 그린다.
    const owned = (node) => { const el = node instanceof Element ? node : node?.parentElement; return !!el?.closest?.('[data-ccf-safe-markup="1"], [data-ccr20-safe-ui="1"], [data-capybara-toolkit-presence="1"]'); };
    const observer = new MutationObserver((records) => {
      if (records.every((record) => owned(record.target))) return;
      scheduleScanMessages();
    });
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

    // 내용이 지난번과 같으면 다시 만들지 않는다(매번 비우고 채우면 문서 변화가 끊이지 않는다).
    const renderKey = rows.map((peer) => {
      const age = Math.max(0, now - peer.at);
      return [peer.self ? 1 : 0, peer.self || age <= ACTIVE_MS ? "a" : "i", peer.name, peer.self ? "" : formatAge(age)].join("|");
    }).join("|") + "#" + (panelOpen ? 1 : 0);
    if (renderPanel.lastKey === renderKey && list.childElementCount === rows.length) return;
    renderPanel.lastKey = renderKey;
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
