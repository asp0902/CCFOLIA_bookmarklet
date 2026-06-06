(() => {
  "use strict";

  const VERSION = "0.1.32";
  const BUILD_ID = "2026-06-06-loader-reinject-chat-notifier-0278";
  const GLOBAL_KEY = "__CAPYBARA_TOOLKIT__";
  const LEGACY_DEBUG_ENTRIES = Object.freeze([
    { key: "__CCF_CHAT_NOTIFIER_DEBUG__" },
    { key: "__CCF_FORMAT_SYNC_DEBUG__" },
    { key: "__CAPYBARA_TOOLKIT_PRESENCE__", toolkitScriptPrefix: "ccf-toolkit-presence:" },
    { key: "__CCF_ROLL20_BRIDGE_DEBUG__" },
    { key: "__CCF_THEME_SWITCHER_DEBUG__" },
    { key: "__CCF_LOG_PACKAGE_DEBUG__" },
    { key: "__CCF_STANDING_PICKER_DEBUG__", toolkitScriptPrefix: "ccfolia-standing-picker:" },
    { key: "__CCF_SUITE_DEBUG__", toolkitScriptPrefix: "ccf-suite-manager:" },
    { key: "__CCF_PALETTE_FILTER_DEBUG__" },
    { key: "__CCF_HANDOUT_DEBUG__", toolkitScriptPrefix: "ccf-handout:" }
  ]);
  const EXISTING = window[GLOBAL_KEY];
  if (EXISTING && typeof EXISTING.closePanel === "function") {
    if (EXISTING.buildId === BUILD_ID) {
      EXISTING.closePanel();
      return;
    }
    resetExistingToolkit(EXISTING);
  }

  const DB_NAME = "capybara-toolkit";
  const DB_VERSION = 1;
  const STORE_META = "meta";
  const STORE_FEATURES = "features";
  const STORE_BUNDLES = "bundles";
  const STORE_ASSETS = "assets";
  const STORE_ROOM_DATA = "roomData";
  const LEGACY_STATE_KEY = "ccf-suite-script-states-v1";
  const LEGACY_REQUEST_EVENT = "ccf-suite:request-register";
  const ROUTE_CHANGE_EVENT = "capybara-toolkit:route-change";
  const SESSION_ID = `capybara-toolkit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const FEATURE_CATALOG = Object.freeze([
    {
      id: "ccf-chat-notifier",
      title: "BGM / Alarm",
      summary: "새 채팅 알림음, BGM 진행바, YouTube BGM 목록과 재생 UI",
      scripts: ["legacy/ccfolia-chat-notifier.user.js"],
      roomOnly: true,
      primaryAction: "sound"
    },
    {
      id: "ccf-format-sync",
      title: "서식 편집 도구",
      summary: "채팅 입력창 위 서식 편집 툴바, 렌더러, 루비/툴팁/블러 서식",
      scripts: ["legacy/ccfolia-format-sync.user.js"]
    },
    {
      id: "ccf-roll20-css-bridge",
      title: "Roll20 CSS 변환",
      summary: "Roll20 /desc CSS 매크로를 코코포리아 표시용 메시지로 변환",
      scripts: ["legacy/ccfolia-roll20-css-bridge.user.js"]
    },
    {
      id: "ccf-theme-switcher",
      title: "테마 커스텀",
      summary: "코코포리아 색상 테마, 캐릭터 색상 팔레트, 테마 가져오기/내보내기",
      scripts: ["legacy/ccfolia-theme-switcher.user.js"]
    },
    {
      id: "ccf-log-package",
      title: "로그 패키지",
      summary: "현재 룸 로그 캡처, 패키징, 카피바라 로그 편집기 연동",
      scripts: ["legacy/ccfolia-log-package.user.js"],
      roomOnly: true
    },
    {
      id: "ccf-slash-macros",
      title: "슬래시 매크로",
      summary: "/m <이름>으로 저장한 멀티라인 슬래시 커맨드를 입력창에 펼침 (모든 룸 공용)",
      scripts: ["legacy/ccfolia-slash-macros.user.js"],
      roomOnly: true,
      // 항상 동작해야 하므로 패널 카드 목록에서 숨기고, 룸 진입 시 자동 로드.
      alwaysOn: true,
      hiddenFromPanel: true
    },
    {
      id: "ccf-roll-triggers",
      title: "판정 매크로 자동 실행",
      summary: "/desc로 렌더된 판정 알약을 클릭하면 채팅 팔레트를 자동 선택해 굴림",
      scripts: ["legacy/ccfolia-roll-triggers.user.js"],
      roomOnly: true,
      alwaysOn: true,
      hiddenFromPanel: true
    },
    {
      id: "ccf-handout",
      title: "핸드아웃",
      summary: "Roll20 스타일 핸드아웃 — 제목/공개 본문/GM 전용 본문, 이미지, 캐릭터별 비밀 권한. 룸 상단 캐릭터 패널 옆 H 아이콘으로 열기. (1단계: 본인 화면 전용)",
      scripts: ["legacy/ccfolia-handout.user.js"],
      roomOnly: true
    }
  ]);

  const state = {
    baseUrl: resolveBaseUrl(),
    dbPromise: null,
    loaded: new Set(),
    loading: new Map(),
    cacheMessages: new Map(),
    root: null,
    shadow: null,
    isOpen: false,
    status: "준비됨",
    launcherDrag: null,
    suppressNextToggle: false,
    customOrder: [],
    customOrderLoaded: false,
    routeHref: location.href,
    routeRefreshFrame: 0,
    watchersBound: false,
    rootObserver: null,
    rootObserverHost: null
  };

  if (typeof window.__CCF_SUITE_MANAGER_SESSION_ID !== "string") {
    window.__CCF_SUITE_MANAGER_SESSION_ID = SESSION_ID;
  }

  const api = {
    version: VERSION,
    buildId: BUILD_ID,
    baseUrl: state.baseUrl.href,
    features: FEATURE_CATALOG.map((feature) => ({ ...feature })),
    ensurePanel,
    openPanel,
    closePanel,
    togglePanel,
    loadFeature,
    refreshCache,
    storage: {
      getSetting,
      setSetting,
      getRoomData,
      setRoomData,
      backupKnownLocalStorage
    }
  };

  Object.defineProperty(window, GLOBAL_KEY, {
    value: api,
    configurable: true
  });

  ensurePanel();
  bindRuntimeWatchers();
  closePanel();
  persistMeta().catch(() => {});
  restoreFeatureStates().catch(reportError);

  function resetExistingToolkit(existing) {
    try {
      existing.closePanel?.();
    } catch (error) {
      console.warn("[Capybara Toolkit] close previous panel failed", error);
    }

    for (const entry of LEGACY_DEBUG_ENTRIES) {
      if (entry.toolkitScriptPrefix && !hasToolkitScriptMarker(entry.toolkitScriptPrefix)) continue;
      const legacyApi = window[entry.key];
      if (legacyApi && typeof legacyApi.disable === "function") {
        try {
          legacyApi.disable();
        } catch (error) {
          console.warn(`[Capybara Toolkit] ${entry.key}.disable() failed`, error);
        }
      }
    }

    document.querySelectorAll([
      "#capybara-toolkit-root",
      "[data-capybara-toolkit-script]",
      "[data-capybara-toolkit-style]"
    ].join(",")).forEach((element) => element.remove());

    try {
      delete window[GLOBAL_KEY];
    } catch (error) {
      Object.defineProperty(window, GLOBAL_KEY, {
        value: undefined,
        configurable: true
      });
    }
  }

  function hasToolkitScriptMarker(prefix) {
    return Array.from(document.querySelectorAll("script[data-capybara-toolkit-script]"))
      .some((script) => (script.dataset.capybaraToolkitScript || "").startsWith(prefix));
  }

  function resolveBaseUrl() {
    const script = document.currentScript;
    const explicit = script?.dataset?.capybaraToolkitBaseUrl || window.__CAPYBARA_TOOLKIT_BASE_URL__;
    if (explicit) {
      return new URL(explicit, location.href);
    }
    if (script?.src) {
      if (/\/src\/[^/?#]*$/i.test(new URL(script.src, location.href).pathname)) {
        return new URL("../", script.src);
      }
      return new URL(".", script.src);
    }
    return new URL("./", location.href);
  }

  function isCcfoliaHost() {
    return /(?:^|\.)ccfolia\.com$/i.test(location.hostname);
  }

  function isRoomPage() {
    return /^\/rooms\/[^/?#]+/i.test(location.pathname);
  }

  function getToolkitHost() {
    return document.documentElement || document.body;
  }

  function mountToolkitRoot(root) {
    const host = getToolkitHost();
    if (!host || !(root instanceof HTMLElement)) return false;
    if (root.parentNode !== host) {
      host.appendChild(root);
    }
    return true;
  }

  function urlFor(path) {
    return new URL(path, state.baseUrl).href;
  }

  function openDb() {
    if (state.dbPromise) return state.dbPromise;
    state.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of [STORE_META, STORE_FEATURES, STORE_BUNDLES, STORE_ASSETS, STORE_ROOM_DATA]) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: "key" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    });
    return state.dbPromise;
  }

  async function withStore(storeName, mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let settled = false;
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error || tx.error || new Error("IndexedDB transaction failed"));
        }
      };

      let result;
      try {
        result = operation(store);
      } catch (error) {
        fail(error);
        return;
      }

      if (result && typeof result === "object" && "onsuccess" in result) {
        result.onsuccess = () => done(result.result);
        result.onerror = () => fail(result.error);
      } else {
        tx.oncomplete = () => done(result);
      }
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error);
    });
  }

  function idbGet(store, key) {
    return withStore(store, "readonly", (objectStore) => objectStore.get(key));
  }
  function idbPut(store, value) {
    return withStore(store, "readwrite", (objectStore) => objectStore.put(value));
  }

  async function persistMeta() {
    await idbPut(STORE_META, {
      key: "toolkit",
      version: VERSION,
      baseUrl: state.baseUrl.href,
      lastSeenAt: new Date().toISOString(),
      lastSeenUrl: location.href
    });
  }

  async function restoreFeatureStates() {
    if (!isCcfoliaHost()) return;

    const records = await Promise.all(FEATURE_CATALOG.map((f) => getFeatureRecord(f.id).catch(() => null)));
    for (let i = 0; i < FEATURE_CATALOG.length; i++) {
      const feature = FEATURE_CATALOG[i];
      const record = records[i];
      const disabledByPage = feature.roomOnly && !isRoomPage();
      // 항상 동작해야 하는 기능은 IndexedDB 기록 유무와 무관하게 자동 로드.
      if (feature.alwaysOn) {
        if (!disabledByPage) loadFeature(feature).catch(reportError);
        continue;
      }
      if (record && record.enabled) {
        if (!disabledByPage) {
          loadFeature(feature).catch(reportError);
        }
      }
    }
  }

  async function getSetting(key, fallback = null) {
    const record = await idbGet(STORE_META, `setting:${key}`);
    return record ? record.value : fallback;
  }

  async function setSetting(key, value) {
    await idbPut(STORE_META, {
      key: `setting:${key}`,
      value,
      updatedAt: new Date().toISOString()
    });
  }

  async function getFeatureRecord(featureId) {
    return idbGet(STORE_FEATURES, `feature:${featureId}`);
  }

  async function setFeatureRecord(featureId, patch) {
    const previous = await getFeatureRecord(featureId);
    const next = {
      key: `feature:${featureId}`,
      id: featureId,
      enabled: true,
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await idbPut(STORE_FEATURES, next);
    return next;
  }

  async function getRoomData(featureId, roomKey = getCurrentRoomKey()) {
    return idbGet(STORE_ROOM_DATA, `room:${featureId}:${roomKey}`);
  }

  async function setRoomData(featureId, roomKey, value) {
    const key = `room:${featureId}:${roomKey || getCurrentRoomKey()}`;
    await idbPut(STORE_ROOM_DATA, {
      key,
      featureId,
      roomKey: roomKey || getCurrentRoomKey(),
      value,
      updatedAt: new Date().toISOString()
    });
  }

  function getCurrentRoomKey() {
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "global";
  }

  function getOrderedFeatures() {
    const orderMap = new Map(state.customOrder.map((id, index) => [id, index]));
    // 카드 목록에서는 hiddenFromPanel/alwaysOn 기능을 제외.
    return [...FEATURE_CATALOG]
      .filter((feature) => !feature.hiddenFromPanel)
      .sort((a, b) => {
        const indexA = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
        const indexB = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
        return indexA - indexB;
      });
  }

  function ensurePanel() {
    if (state.root) {
      mountToolkitRoot(state.root);
      observeToolkitHost();
      return;
    }

    const root = document.createElement("div");
    root.id = "capybara-toolkit-root";
    root.style.position = "fixed";
    root.style.zIndex = "2147483647";
    root.style.right = "16px";
    root.style.bottom = "16px";
    root.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    const iconUrl = urlFor("assets/capybara-icon.png");
    const shadow = root.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; color: #171717; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        button { font: inherit; }
        .fab {
          width: 48px; height: 48px; border: 0; border-radius: 999px;
          background: #fff; color: #111; cursor: pointer; display: grid; place-items: center;
          box-shadow: 0 12px 32px rgba(0,0,0,.22); padding: 4px; overflow: hidden;
          touch-action: none; user-select: none; position: relative; z-index: 2;
        }
        .fab:hover { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(0,0,0,.25); }
        .fab:active { transform: translateY(0); }
        .fab-icon { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
        .panel {
          width: min(420px, calc(100vw - 32px)); max-height: min(660px, calc(100vh - 88px));
          display: none; flex-direction: column; overflow: hidden;
          background: #fff; border: 1px solid #d7d7d7; border-radius: 0;
          box-shadow: 0 18px 60px rgba(0,0,0,.24);
          position: absolute; bottom: 58px; right: 0; z-index: 1;
        }
        :host([data-pos-y="top"]) .panel { top: 58px; bottom: auto; }
        :host([data-pos-y="bottom"]) .panel { bottom: 58px; top: auto; }
        :host([data-pos-x="left"]) .panel { left: 0; right: auto; }
        :host([data-pos-x="right"]) .panel { right: 0; left: auto; }
        .panel[data-open="1"] { display: flex; }
        header { padding: 14px 14px 12px; border-bottom: 1px solid #e5e5e5; display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
        h1 { margin: 0; font-size: 15px; line-height: 1.25; color: #111; }
        .sub { margin-top: 3px; font-size: 12px; color: #666; }
        .close { width: 28px; height: 28px; border: 1px solid #d7d7d7; border-radius: 6px; background: #fff; cursor: pointer; }
        .body { overflow: auto; padding: 10px; position: relative; }
        .notice { padding: 9px 10px; border: 1px solid #e4d2a3; background: #fff8e6; color: #5d4300; border-radius: 6px; font-size: 12px; line-height: 1.45; margin-bottom: 10px; }
        .feature { 
          border: 1px solid #e1e1e1; border-radius: 8px; padding: 10px; margin-bottom: 8px; 
          background: #fbfbfb; cursor: grab; touch-action: none; will-change: transform;
        }
        .feature:active { cursor: grabbing; }
        .feature.dragging { visibility: hidden !important; position: relative; z-index: 1; }
        .feature.animating { pointer-events: none !important; }
        .feature[data-loaded="1"] { border-color: #b0b0b0; background: #f0f0f0; }
        .feature[data-experimental="1"] { background: #f8f8f8; }
        .drag-clone {
          position: fixed !important; z-index: 2147483647 !important; pointer-events: none !important;
          margin: 0 !important; box-sizing: border-box !important;
          border: 1px solid #e1e1e1; border-radius: 8px; padding: 10px;
          background: rgba(251, 251, 251, 0.95); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
          will-change: transform;
        }
        .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .name { font-size: 13px; font-weight: 800; color: #171717; line-height: 1.35; }
        .summary { margin-top: 3px; font-size: 12px; color: #555; line-height: 1.45; }
        .actions { display: flex; gap: 6px; flex: 0 0 auto; }
        .btn {
          min-width: 58px; height: 30px; padding: 0 9px; border: 1px solid #111; border-radius: 6px;
          background: #111; color: #fff; cursor: pointer; font-size: 12px; font-weight: 700;
        }
        .btn.secondary { border-color: #d1d1d1; background: #fff; color: #222; }
        .btn.toggle { min-width: 48px; letter-spacing: 0; }
        .btn.toggle[data-on="0"] { border-color: #d1d1d1; background: #fff; color: #222; }
        .btn.toggle[data-on="1"] { border-color: #111; background: #111; color: #fff; }
        .btn[disabled] { opacity: .55; cursor: default; }
        footer { border-top: 1px solid #e5e5e5; padding: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
        .footer-toast {
          margin-right: auto;
          font-size: 12px;
          color: #424242;
          opacity: 0;
          transform: translateY(2px);
          transition: opacity 160ms ease, transform 160ms ease;
          pointer-events: none;
        }
        .footer-toast[data-visible="1"] { opacity: 1; transform: translateY(0); }
        @media (prefers-color-scheme: dark) {
          .footer-toast { color: #9e9e9e; }
        }
        @media (prefers-color-scheme: dark) {
          :host { color: #eee; }
          .panel { background: #171717; border-color: #333; }
          header, footer { border-color: #303030; }
          h1, .name { color: #f5f5f5; }
          .sub, .summary { color: #aaa; }
          .feature { background: #202020; border-color: #333; }
          .feature[data-loaded="1"] { background: #2a2a2a; border-color: #555; }
          .drag-clone { background: rgba(32, 32, 32, 0.95); border-color: #333; }
          .notice { background: #2a2415; border-color: #6f5c2b; color: #f0d996; }
          .close, .btn.secondary { background: #151515; border-color: #444; color: #eee; }
        }
      </style>
      <section class="panel" part="panel">
        <header>
          <div>
            <h1>카피바라 툴킷</h1>
            <div class="sub"></div>
          </div>
          <button class="close" type="button" data-action="close" title="닫기">×</button>
        </header>
        <div class="body"></div>
        <footer>
          <span class="footer-toast" aria-live="polite"></span>
          <button class="btn secondary" type="button" data-action="cache">캐시 갱신</button>
          <button class="btn secondary" type="button" data-action="backup">저장</button>
        </footer>
      </section>
      <button class="fab" type="button" data-action="toggle" title="카피바라 툴킷">C</button>
    `;

    const fab = shadow.querySelector(".fab");
    if (fab) {
      fab.textContent = "";
      fab.setAttribute("aria-label", "Capybara Toolkit");
      const icon = document.createElement("img");
      icon.className = "fab-icon";
      icon.src = iconUrl;
      icon.alt = "";
      fab.appendChild(icon);
      bindLauncherDrag(fab);
    }

    // --- 부드러운 드래그 앤 드롭 애니메이션 (Pointer Events & FLIP) ---
    const bodyContainer = shadow.querySelector(".body");
    let featureDragState = null;

    function animateReorder(container, excludeRow, mutateFn) {
      const rows = Array.from(container.querySelectorAll(".feature")).filter(r => r !== excludeRow);
      const firstRects = new Map(rows.map(r => [r, r.getBoundingClientRect()]));

      mutateFn();

      rows.forEach(row => {
        const first = firstRects.get(row);
        if (!first) return;
        const last = row.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;

        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

        const token = `${Date.now()}:${Math.random()}`;
        row.dataset.animToken = token;
        row.classList.add("animating");
        row.style.transition = "none";
        row.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        row.getBoundingClientRect(); // 강제 렌더링 트리거

        requestAnimationFrame(() => {
          if (row.dataset.animToken !== token) return;
          row.style.transition = "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)";
          row.style.transform = "";
        });

        setTimeout(() => {
          if (row.dataset.animToken !== token) return;
          row.classList.remove("animating");
          row.style.transition = "";
          row.style.transform = "";
          delete row.dataset.animToken;
        }, 280);
      });
    }

    function handleFeatureDragMove(e) {
      if (!featureDragState || e.pointerId !== featureDragState.pointerId) return;

      const dx = e.clientX - featureDragState.startX;
      const dy = e.clientY - featureDragState.startY;

      if (!featureDragState.dragging) {
        if (Math.hypot(dx, dy) < 5) return;
        featureDragState.dragging = true;

        const rect = featureDragState.row.getBoundingClientRect();
        const clone = featureDragState.row.cloneNode(true);
        clone.classList.add("drag-clone");
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        
        shadow.appendChild(clone);
        featureDragState.clone = clone;
        featureDragState.row.classList.add("dragging");
      }

      e.preventDefault();
      e.stopPropagation();

      featureDragState.clone.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

      // 드롭 타겟 찾기
      const siblings = Array.from(featureDragState.container.querySelectorAll(".feature:not(.dragging)"));
      const target = siblings.find(sib => {
        const rect = sib.getBoundingClientRect();
        return e.clientY < rect.top + rect.height / 2;
      });

      if (target !== featureDragState.row.nextElementSibling) {
        animateReorder(featureDragState.container, featureDragState.row, () => {
          if (target) {
            featureDragState.container.insertBefore(featureDragState.row, target);
          } else {
            featureDragState.container.appendChild(featureDragState.row);
          }
        });
      }
    }

    function handleFeatureDragEnd(e) {
      if (!featureDragState || e.pointerId !== featureDragState.pointerId) return;

      window.removeEventListener("pointermove", handleFeatureDragMove, true);
      window.removeEventListener("pointerup", handleFeatureDragEnd, true);
      window.removeEventListener("pointercancel", handleFeatureDragEnd, true);

      if (featureDragState.dragging) {
        e.preventDefault();
        e.stopPropagation();

        const row = featureDragState.row;
        const clone = featureDragState.clone;

        row.classList.remove("dragging");

        let dx = 0, dy = 0;
        if (clone) {
          const cloneRect = clone.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          dx = cloneRect.left - rowRect.left;
          dy = cloneRect.top - rowRect.top;
          clone.remove();
        }

        // 드롭 시 쫀득하게 제자리로 돌아가는 애니메이션
        const token = `${Date.now()}:${Math.random()}`;
        row.dataset.dropToken = token;
        row.style.transition = "none";
        row.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        row.getBoundingClientRect();

        requestAnimationFrame(() => {
          if (row.dataset.dropToken !== token) return;
          row.style.transition = "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)";
          row.style.transform = "";
        });

        setTimeout(() => {
          if (row.dataset.dropToken !== token) return;
          row.style.transition = "";
          row.style.transform = "";
          delete row.dataset.dropToken;
        }, 220);

        // 변경된 순서 저장
        const newOrder = Array.from(featureDragState.container.querySelectorAll(".feature")).map(el => el.dataset.feature);
        state.customOrder = newOrder;
        setSetting("feature-order", newOrder).catch(reportError);
      }
      featureDragState = null;
    }

    bodyContainer.addEventListener("pointerdown", (e) => {
      // 좌클릭일 때만 실행
      if (e.button !== 0) return;
      
      const featureEl = e.target.closest(".feature");
      // 버튼/폼 컨트롤 위에서는 드래그 무시 — preventDefault 가 select 의 native open
      // 이나 input focus 를 막아버리므로 카드에 임베드된 컨트롤은 모두 통과시킨다
      if (
        !featureEl ||
        e.target.closest("button, select, input, textarea, label, a[href]")
      ) return;

      e.preventDefault(); // 텍스트 선택 등 방지

      featureDragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        row: featureEl,
        clone: null,
        dragging: false,
        container: bodyContainer
      };

      window.addEventListener("pointermove", handleFeatureDragMove, true);
      window.addEventListener("pointerup", handleFeatureDragEnd, true);
      window.addEventListener("pointercancel", handleFeatureDragEnd, true);
    });
    // --- 드래그 애니메이션 끝 ---

    shadow.addEventListener("click", handlePanelClick);
    state.root = root;
    state.shadow = shadow;
    mountToolkitRoot(root);
    observeToolkitHost();
    restoreLauncherPosition().catch(reportError);
    window.addEventListener("resize", clampCurrentLauncherPosition, { passive: true });
    renderPanel();
  }

  function bindRuntimeWatchers() {
    if (state.watchersBound) return;
    state.watchersBound = true;

    window.addEventListener("popstate", scheduleRouteRefresh, { passive: true });
    window.addEventListener("hashchange", scheduleRouteRefresh, { passive: true });
    window.addEventListener("pageshow", scheduleRouteRefresh, { passive: true });
    window.addEventListener("focus", scheduleRouteRefresh, { passive: true });
    window.addEventListener(ROUTE_CHANGE_EVENT, scheduleRouteRefresh, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleRouteRefresh();
    }, true);

    patchHistoryNavigation("pushState");
    patchHistoryNavigation("replaceState");
    observeToolkitHost();
  }

  function patchHistoryNavigation(method) {
    const current = history?.[method];
    if (typeof current !== "function" || current.__capybaraToolkitDispatchPatched) return;

    const original = current.__capybaraToolkitOriginal || current;

    const patched = function capybaraToolkitHistoryPatch(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
      return result;
    };
    patched.__capybaraToolkitDispatchPatched = true;
    patched.__capybaraToolkitOriginal = original;

    try {
      history[method] = patched;
    } catch (error) {
      console.warn(`[Capybara Toolkit] history.${method} patch failed`, error);
    }
  }

  function observeToolkitHost() {
    const host = getToolkitHost();
    if (!host || state.rootObserverHost === host) return;

    state.rootObserver?.disconnect();
    const observer = new MutationObserver(() => {
      if (!state.root || !state.root.isConnected) {
        scheduleRouteRefresh();
      }
    });
    observer.observe(host, { childList: true });
    state.rootObserver = observer;
    state.rootObserverHost = host;
  }

  function scheduleRouteRefresh() {
    if (state.routeRefreshFrame) return;
    state.routeRefreshFrame = window.requestAnimationFrame(() => {
      state.routeRefreshFrame = 0;
      refreshAfterRouteChange().catch(reportError);
    });
  }

  async function refreshAfterRouteChange() {
    ensurePanel();
    observeToolkitHost();

    const nextHref = location.href;
    const routeChanged = nextHref !== state.routeHref;
    if (routeChanged) {
      state.routeHref = nextHref;
      await persistMeta().catch(() => {});
      await restoreFeatureStates().catch(reportError);
    }

    await renderPanel();
  }

  async function renderPanel() {
    if (!state.shadow) return;
    
    if (!state.customOrderLoaded) {
      state.customOrder = await getSetting("feature-order", []) || [];
      state.customOrderLoaded = true;
    }

    const panel = state.shadow.querySelector(".panel");
    const body = state.shadow.querySelector(".body");
    const sub = state.shadow.querySelector(".sub");
    panel.dataset.open = state.isOpen ? "1" : "0";
    sub.textContent = `v${VERSION} · ${isCcfoliaHost() ? "ccfolia" : "다른 사이트"} · ${state.baseUrl.href}`;

    const records = await Promise.all(FEATURE_CATALOG.map((feature) => getFeatureRecord(feature.id).catch(() => null)));
    const recordMap = new Map(records.filter(Boolean).map((record) => [record.id, record]));
    const notice = isCcfoliaHost()
      ? ""
      : `<div class="notice">코코포리아 탭에서 실행해야 레거시 기능을 주입할 수 있습니다. 지금은 패널과 저장소만 확인할 수 있어요.</div>`;

    body.innerHTML = notice + getOrderedFeatures().map((feature) => {
      const record = recordMap.get(feature.id);
      const loaded = state.loaded.has(feature.id);
      const disabledByPage = feature.roomOnly && !isRoomPage();
      const disabled = state.loading.has(feature.id) || (!loaded && (!isCcfoliaHost() || disabledByPage));
      const buttonText = state.loading.has(feature.id) ? "..." : (loaded ? "ON" : "OFF");

      // Pointer Event 방식을 위해 HTML5의 draggable="true"는 제거되었습니다.
      return `
        <article class="feature" data-feature="${escapeAttr(feature.id)}" data-loaded="${loaded ? "1" : "0"}" data-experimental="${feature.experimental ? "1" : "0"}">
          <div class="row">
            <div>
              <div class="name">${escapeHtml(feature.title)}</div>
              <div class="summary">${escapeHtml(feature.summary)}</div>
            </div>
            <div class="actions">
              <button class="btn toggle" type="button" data-action="feature-toggle" data-feature="${escapeAttr(feature.id)}" data-on="${loaded ? "1" : "0"}" aria-pressed="${loaded ? "true" : "false"}" ${disabled ? "disabled" : ""}>${buttonText}</button>
            </div>
          </div>
          ${disabledByPage ? `<div class="summary">이 기능은 코코포리아 룸 안에서 켜는 편이 안전합니다.</div>` : ""}
        </article>
      `;
    }).join("");
  }

  function openPanel() {
    ensurePanel();
    state.isOpen = true;
    renderPanel().catch(reportError);
  }

  function closePanel() {
    state.isOpen = false;
    renderPanel().catch(reportError);
  }

  let footerToastTimer = 0;
  function showFooterToast(text) {
    const el = state.shadow?.querySelector(".footer-toast");
    if (!(el instanceof HTMLElement)) return;
    el.textContent = text;
    el.setAttribute("data-visible", "1");
    if (footerToastTimer) clearTimeout(footerToastTimer);
    footerToastTimer = window.setTimeout(() => {
      footerToastTimer = 0;
      el.removeAttribute("data-visible");
      // fade-out transition 끝난 뒤 텍스트 비우기
      setTimeout(() => {
        if (el.getAttribute("data-visible") !== "1") el.textContent = "";
      }, 200);
    }, 1800);
  }

  function togglePanel() {
    state.isOpen = !state.isOpen;
    renderPanel().catch(reportError);
  }

  function bindLauncherDrag(fab) {
    fab.addEventListener("pointerdown", handleLauncherPointerDown);
  }

  function handleLauncherPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    if (!state.root) return;

    const rect = state.root.getBoundingClientRect();
    state.launcherDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    window.addEventListener("pointermove", handleLauncherPointerMove, true);
    window.addEventListener("pointerup", handleLauncherPointerEnd, true);
    window.addEventListener("pointercancel", handleLauncherPointerEnd, true);
  }

  function handleLauncherPointerMove(event) {
    const drag = state.launcherDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;

    drag.moved = true;
    event.preventDefault();
    applyLauncherPosition({
      x: drag.originX + dx,
      y: drag.originY + dy
    });
  }

  function handleLauncherPointerEnd(event) {
    const drag = state.launcherDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    window.removeEventListener("pointermove", handleLauncherPointerMove, true);
    window.removeEventListener("pointerup", handleLauncherPointerEnd, true);
    window.removeEventListener("pointercancel", handleLauncherPointerEnd, true);
    state.launcherDrag = null;

    if (drag.moved) {
      state.suppressNextToggle = true;
      const rect = state.root.getBoundingClientRect();
      setSetting("launcher-position", {
        x: rect.left,
        y: rect.top,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }).catch(reportError);
      window.setTimeout(() => {
        state.suppressNextToggle = false;
      }, 0);
    }
  }

  async function restoreLauncherPosition() {
    const saved = await getSetting("launcher-position", null);
    if (!saved || typeof saved.x !== "number" || typeof saved.y !== "number") return;
    applyLauncherPosition(saved);
  }

  function applyLauncherPosition(position) {
    if (!state.root) return;
    const margin = 8;
    const width = 48;
    const height = 48;
    const x = clamp(Number(position.x) || margin, margin, Math.max(margin, window.innerWidth - width - margin));
    const y = clamp(Number(position.y) || margin, margin, Math.max(margin, window.innerHeight - height - margin));

    state.root.style.left = `${Math.round(x)}px`;
    state.root.style.top = `${Math.round(y)}px`;
    state.root.style.right = "auto";
    state.root.style.bottom = "auto";

    state.root.dataset.posX = x < window.innerWidth / 2 ? "left" : "right";
    state.root.dataset.posY = y < window.innerHeight / 2 ? "top" : "bottom";
  }

  function clampCurrentLauncherPosition() {
    if (!state.root || state.root.style.left === "") return;
    const rect = state.root.getBoundingClientRect();
    applyLauncherPosition({ x: rect.left, y: rect.top });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function handlePanelClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "toggle") {
      if (state.suppressNextToggle) {
        state.suppressNextToggle = false;
        return;
      }
      togglePanel();
      return;
    }
    if (action === "close") {
      closePanel();
      return;
    }
    if (action === "feature-toggle") {
      const feature = FEATURE_CATALOG.find((item) => item.id === button.dataset.feature);
      if (feature) {
        toggleFeature(feature.id).catch(reportError);
      }
      return;
    }
    if (action === "cache") {
      refreshCache().then(() => showFooterToast("저장되었습니다")).catch(reportError);
      return;
    }
    if (action === "backup") {
      backupKnownLocalStorage().then((count) => {
        state.status = `localStorage 저장값 ${count}개를 IndexedDB에 백업했습니다.`;
        renderPanel().catch(reportError);
        showFooterToast("저장되었습니다");
      }).catch(reportError);
      return;
    }
  }

  async function toggleFeature(featureOrId) {
    const feature = typeof featureOrId === "string"
      ? FEATURE_CATALOG.find((item) => item.id === featureOrId)
      : featureOrId;
    if (!feature) throw new Error("Unknown feature");
    if (state.loaded.has(feature.id)) {
      await disableFeature(feature);
      return;
    }
    await loadFeature(feature);
  }

  function callLegacyDisable(globalKey) {
    const debugApi = window[globalKey];
    if (debugApi && typeof debugApi.disable === "function") {
      try {
        return !!debugApi.disable();
      } catch (error) {
        console.error(`[Capybara Toolkit] ${globalKey}.disable() threw`, error);
        return false;
      }
    }
    return false;
  }

  const LEGACY_TEARDOWN_HOOKS = Object.freeze({
    "ccf-chat-notifier": () => callLegacyDisable("__CCF_CHAT_NOTIFIER_DEBUG__"),
    "ccf-format-sync": () => callLegacyDisable("__CCF_FORMAT_SYNC_DEBUG__"),
    "ccf-toolkit-presence": () => callLegacyDisable("__CAPYBARA_TOOLKIT_PRESENCE__"),
    "ccf-roll20-css-bridge": () => callLegacyDisable("__CCF_ROLL20_BRIDGE_DEBUG__"),
    "ccf-theme-switcher": () => callLegacyDisable("__CCF_THEME_SWITCHER_DEBUG__"),
    "ccf-log-package": () => callLegacyDisable("__CCF_LOG_PACKAGE_DEBUG__"),
    "ccfolia-standing-picker": () => callLegacyDisable("__CCF_STANDING_PICKER_DEBUG__"),
    "ccf-suite-manager": () => callLegacyDisable("__CCF_SUITE_DEBUG__"),
    "ccf-handout": () => callLegacyDisable("__CCF_HANDOUT_DEBUG__")
  });

  async function disableFeature(feature) {
    setLegacyScriptEnabled(feature.legacyStateId || feature.id, false);

    let teardownRan = false;
    const teardownHook = LEGACY_TEARDOWN_HOOKS[feature.id];
    if (typeof teardownHook === "function") {
      try {
        teardownRan = !!teardownHook();
      } catch (error) {
        reportError(error);
      }
    }

    if (teardownRan) {
      for (const scriptPath of feature.scripts || []) {
        const marker = `${feature.id}:${scriptPath}`;
        document.querySelector(`script[data-capybara-toolkit-script="${cssEscape(marker)}"]`)?.remove();
      }
      for (const stylePath of feature.styles || []) {
        document.querySelector(`link[data-capybara-toolkit-style="${cssEscape(stylePath)}"]`)?.remove();
      }
    }

    state.loaded.delete(feature.id);
    await setFeatureRecord(feature.id, {
      enabled: false,
      disabledAt: new Date().toISOString(),
      unloadRequiresReload: !teardownRan
    });
    state.status = teardownRan
      ? `${feature.title} OFF. 레거시 동작이 즉시 정지되었습니다.`
      : `${feature.title} OFF. 이미 주입된 레거시 동작은 새로고침 후 완전히 멈춥니다.`;
    await renderPanel();
  }

  async function loadFeature(featureOrId) {
    const feature = typeof featureOrId === "string"
      ? FEATURE_CATALOG.find((item) => item.id === featureOrId)
      : featureOrId;
    if (!feature) throw new Error("Unknown feature");
    if (state.loaded.has(feature.id)) {
      state.status = `${feature.title}은 이미 실행 중입니다.`;
      await renderPanel();
      return;
    }
    if (state.loading.has(feature.id)) return state.loading.get(feature.id);

    const job = (async () => {
      state.status = `${feature.title} 실행 준비 중...`;
      await renderPanel();
      setLegacyScriptEnabled(feature.legacyStateId || feature.id, true);

      for (const cssPath of feature.styles || []) {
        await cacheBundle(feature.id, "style", cssPath).catch((error) => rememberCacheMessage(cssPath, error));
        injectStyle(cssPath);
      }

      for (const scriptPath of feature.scripts || []) {
        await cacheBundle(feature.id, "script", scriptPath).catch((error) => rememberCacheMessage(scriptPath, error));
        await injectScript(feature.id, scriptPath);
      }

      state.loaded.add(feature.id);
      await setFeatureRecord(feature.id, {
        enabled: true,
        loadedAt: new Date().toISOString(),
        source: "bookmarklet-loader"
      });
      state.status = `${feature.title} 실행 완료`;
      window.dispatchEvent(new CustomEvent(LEGACY_REQUEST_EVENT, {
        detail: { targetId: feature.legacyStateId || feature.id }
      }));
      if (feature.primaryAction === "sound") {
        const primed = await primeChatNotifierSound().catch(() => false);
        state.status = primed
          ? `${feature.title} 실행 완료. 알림음이 활성화되었습니다.`
          : `${feature.title} 실행 완료. 알림음 활성화에 실패했습니다. 브라우저 자동재생 정책을 확인하세요.`;
      }
      await renderPanel();
    })().finally(() => {
      state.loading.delete(feature.id);
      renderPanel().catch(() => {});
    });

    state.loading.set(feature.id, job);
    return job;
  }

  function setLegacyScriptEnabled(scriptId, enabled) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(LEGACY_STATE_KEY) || "{}");
      const next = parsed && typeof parsed === "object" ? parsed : {};
      next[scriptId] = enabled !== false;
      window.localStorage.setItem(LEGACY_STATE_KEY, JSON.stringify(next));
    } catch (error) {
      // The compatibility key is intentionally tiny; failing here should not block execution.
    }
  }

  async function cacheBundle(featureId, kind, path) {
    const url = urlFor(path);
    // CDN(GitHub Pages 등) 캐시 우회를 위해 cache buster 부여
    const response = await fetch(withCacheBuster(url), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Cache failed: ${response.status} ${response.statusText}`);
    }
    const source = await response.text();
    const record = {
      key: `bundle:${kind}:${path}`,
      featureId,
      kind,
      path,
      url,
      source,
      bytes: source.length,
      cachedAt: new Date().toISOString(),
      toolkitVersion: VERSION
    };
    await idbPut(STORE_BUNDLES, record);
    await setFeatureRecord(featureId, { cachedAt: record.cachedAt });
    return record;
  }

  async function refreshCache() {
    state.status = "기능 번들을 IndexedDB에 캐시하는 중...";
    await renderPanel();
    let count = 0;
    for (const feature of FEATURE_CATALOG) {
      for (const cssPath of feature.styles || []) {
        await cacheBundle(feature.id, "style", cssPath);
        count += 1;
      }
      for (const scriptPath of feature.scripts || []) {
        await cacheBundle(feature.id, "script", scriptPath);
        count += 1;
      }
    }
    state.status = `번들 ${count}개 캐시 완료`;
    await renderPanel();
  }

  function injectStyle(path) {
    if (document.querySelector(`link[data-capybara-toolkit-style="${cssEscape(path)}"]`)) return;
    const url = withCacheBuster(urlFor(path));
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.dataset.capybaraToolkitStyle = path;
    (document.head || document.documentElement).appendChild(link);
  }

  async function injectScript(featureId, path) {
    const marker = `${featureId}:${path}`;
    if (document.querySelector(`script[data-capybara-toolkit-script="${cssEscape(marker)}"]`)) return;

    const baseUrl = urlFor(path);
    const url = withCacheBuster(baseUrl);
    try {
      await injectScriptTag(url, marker);
      return;
    } catch (scriptError) {
      const cached = await idbGet(STORE_BUNDLES, `bundle:script:${path}`);
      if (!cached?.source) throw scriptError;
      try {
        runSource(cached.source, baseUrl);
      } catch (evalError) {
        throw new Error(`스크립트 주입 실패: ${scriptError.message || scriptError}; 캐시 실행 실패: ${evalError.message || evalError}`);
      }
    }
  }

  function withCacheBuster(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}t=${Date.now()}`;
  }

  function injectScriptTag(url, marker) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = false;
      script.dataset.capybaraToolkitScript = marker;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Script blocked or unavailable: ${url}`));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function runSource(source, sourceUrl) {
    const fn = new Function(`${source}\n//# sourceURL=${sourceUrl}`);
    fn.call(window);
  }

  async function primeChatNotifierSound() {
    let debugApi = window.__CCF_CHAT_NOTIFIER_DEBUG__;
    for (let attempt = 0; attempt < 20 && (!debugApi || typeof debugApi.primeSound !== "function"); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      debugApi = window.__CCF_CHAT_NOTIFIER_DEBUG__;
    }
    if (!debugApi || typeof debugApi.primeSound !== "function") {
      return false;
    }
    return !!(await debugApi.primeSound());
  }

  function rememberCacheMessage(path, error) {
    state.cacheMessages.set(path, error?.message || String(error));
  }

  async function backupKnownLocalStorage() {
    const prefixes = [
      "ccf-chat-notifier:youtube-bgm:",
      "ccf-inline-image:",
      "ccf-theme-switcher-",
      "ccf-character-color-",
      "ccf-suite-"
    ];
    const exact = new Set([
      "ccf-inline-image:index",
      "ccf-suite-registry-v1",
      "ccf-suite-script-states-v1"
    ]);
    let count = 0;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (!exact.has(key) && !prefixes.some((prefix) => key.startsWith(prefix))) continue;
      await idbPut(STORE_ASSETS, {
        key: `localStorage:${key}`,
        originalKey: key,
        value: window.localStorage.getItem(key),
        backedUpAt: new Date().toISOString()
      });
      count += 1;
    }
    return count;
  }

  function formatTime(iso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  function reportError(error) {
    console.error("[Capybara Toolkit]", error);
    state.status = error?.message || String(error);
    renderPanel().catch(() => {});
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const escapeAttr = escapeHtml;

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }
})();
