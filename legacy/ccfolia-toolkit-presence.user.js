// ==UserScript==
// @name         CCFOLIA Toolkit Presence by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-toolkit-presence
// @version      0.0.1
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
    // 네이티브 MUI 다이얼로그(캐릭터 이미지 라이브러리 / Unsplash 검색 등) 안의 입력은
    // 채팅 입력창이 아니므로 presence 페이로드를 주입하지 않는다.
    // (주입 시 Unsplash 검색 쿼리가 오염되어 414 URI Too Long 발생)
    if (editor instanceof Element && editor.closest?.(".MuiDialog-root")) return true;
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
