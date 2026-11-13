// ==UserScript==
// @name         CCFOLIA Slash Macros by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-slash-macros
// @version      0.1.4
// @description  Save and run multi-line slash command macros from the CCFOLIA chat input.
// @description:ko 채팅 슬래시 커맨드 본문을 커스텀 커맨드로 저장하고 /m <이름>으로 펼쳐서 실행합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  // ----- lifecycle / signal ---------------------------------------------------

  const CCF_SM_SCRIPT_INFO = Object.freeze({
    id: "ccf-slash-macros",
    name: "CCFOLIA Slash Macros",
    version: "0.1.3",
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-slash-macros"
  });

  const ccfSmLifecycle = createLegacyLifecycle(CCF_SM_SCRIPT_INFO, {
    debugKey: "__CCF_SLASH_MACROS_DEBUG__",
    onTeardown() {
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(POPUP_ID)?.remove();
      document.getElementById(MODAL_ID)?.remove();
      document.querySelectorAll(`[${TOOLBAR_BTN_ATTR}]`).forEach((el) => el.remove());
    }
  });
  const ccfSmSignal = ccfSmLifecycle.signal;

  function ccfSmRegisterTeardown(fn) {
    ccfSmLifecycle.registerTeardown(fn);
  }

  function ccfSmWithSignal(options) {
    return ccfSmLifecycle.withSignal(options);
  }

  function ccfSmTeardown() {
    return ccfSmLifecycle.disable();
  }

  ccfSmLifecycle.installDebugApi({
    listMacros() { return readMacros(); },
    roomShare() { return { status: roomShare.status, room: roomShare.roomKey, count: roomShare.list.length, mine: roomShare.list.filter((m) => m.ownerUid === roomShare.uid && !m.deleted).map((m) => m.name) }; },
    openManager() { openManageModal(); },
    addMacro(name, body) { saveMacro(name, body); return readMacros(); }
  });

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

  // ----- constants ------------------------------------------------------------

  const STORAGE_KEY = "ccf-slash-macros-v1";
  const STYLE_ID = "ccf-slash-macros-style";
  const POPUP_ID = "ccf-slash-macros-popup";
  const MODAL_ID = "ccf-slash-macros-modal";
  const TOOLBAR_BTN_ATTR = "data-ccf-slash-macros-btn";
  const EDITOR_BOUND_ATTR = "data-ccf-slash-macros-bound";

  // /m <name> 자동완성 발동 패턴. 입력 전체가 정확히 /m 또는 /m <이름>일 때만 동작.
  const TRIGGER_PATTERN = /^\/m(?:\s+([^\n]*))?$/;

  const EDITOR_SELECTOR = 'textarea, [contenteditable="true"], [role="textbox"]';
  const HELP_BUTTON_SELECTOR = 'button[aria-label="채팅 커맨드에 대해"], button[aria-label*="チャットコマンド"], button[aria-label*="chat command" i]';
  const HELP_DIALOG_HINTS = ["/roll", "/desc", "/cc", "roll-table", "채팅 커맨드", "チャットコマンド"];

  // ----- storage (전역 — 모든 룸에서 공유) -------------------------------------

  let _macrosCache = null;

  function readMacros() {
    if (_macrosCache) return _macrosCache;
    let list = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list = parsed.filter(isValidMacro);
        } else if (parsed && typeof parsed === "object") {
          // 이전 버전(룸별 사전) 데이터가 있으면 합쳐서 마이그레이션.
          const merged = [];
          const seen = new Set();
          for (const value of Object.values(parsed)) {
            if (!Array.isArray(value)) continue;
            for (const m of value) {
              if (!isValidMacro(m) || seen.has(m.name)) continue;
              seen.add(m.name);
              merged.push({ name: m.name, body: m.body, updatedAt: m.updatedAt || Date.now() });
            }
          }
          list = merged;
          writeMacros(list); // 새 스키마로 즉시 저장
        }
      }
    } catch (error) {
      list = [];
    }
    _macrosCache = list;
    return list;
  }

  function writeMacros(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch (error) { console.warn("[CCF Slash] save failed", error); }
  }

  function isValidMacro(m) {
    return !!m && typeof m === "object" && typeof m.name === "string" && m.name.trim() && typeof m.body === "string";
  }

  function saveMacro(name, body) {
    const cleanName = String(name || "").trim();
    const cleanBody = String(body || "");
    if (!cleanName) throw new Error("커스텀 커맨드 이름이 비어있습니다.");
    const list = readMacros().slice();
    const idx = list.findIndex((m) => m.name === cleanName);
    const entry = { name: cleanName, body: cleanBody, updatedAt: Date.now() };
    // 사용자가 정한 순서를 유지: 새 항목은 끝에 추가, 기존 항목은 자리 그대로 갱신.
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    writeMacros(list);
    _macrosCache = null;
    if (myRoomEntry(cleanName)) setMacroShared(entry, true).catch((error) => console.warn("[CCF Slash] room update failed", error));
  }

  function deleteMacro(name) {
    const list = readMacros();
    const next = list.filter((m) => m.name !== name);
    if (next.length === list.length) return false;
    writeMacros(next);
    _macrosCache = null;
    const gone = list.find((m) => m.name === name);
    if (gone && myRoomEntry(name)) setMacroShared(gone, false).catch((error) => console.warn("[CCF Slash] room unshare failed", error));
    return true;
  }

  // 드래그 앤 드롭으로 순서 변경. fromIdx에 있는 항목을 toIdx 위치로 이동.
  function reorderMacro(fromIdx, toIdx) {
    const list = readMacros().slice();
    if (fromIdx < 0 || fromIdx >= list.length) return false;
    if (toIdx < 0 || toIdx > list.length) return false;
    if (fromIdx === toIdx) return false;
    const [item] = list.splice(fromIdx, 1);
    // splice 이후 toIdx 조정: fromIdx보다 뒤로 옮길 때 인덱스가 1 줄어든다.
    const adjusted = toIdx > fromIdx ? toIdx - 1 : toIdx;
    list.splice(adjusted, 0, item);
    writeMacros(list);
    _macrosCache = null;
    return true;
  }

  // ----- room sharing (rooms/{room}/macros, 핸드아웃과 같은 Firebase 연결) ---------------
  // 내 커맨드는 그대로 이 브라우저에 둔다. '룸 공유'를 켠 것만 룸 문서로 올라가고, 룸 구성원 모두의 목록·자동완성에 '룸 커맨드'로 보인다(이름 겹치면 내 것 우선, 룸 것은 "이름 (공유)").
  // 고치기·지우기는 만든 사람 또는 GM(규칙). 공유를 끄면 deleted 표시. 핸드아웃 연결이 없거나 규칙이 거절하면 공유 단추를 끄고 한 줄로 알린다.
  const roomShare = { list: [], status: "no-connection", unsub: null, roomKey: "", uid: "" };
  let modalRefresh = null;
  const sharedFb = () => { const f = window.__CCF_HANDOUT_FB__?.state?.(); return f?.db && f.uid && f.modules?.fs ? f : null; };
  const sharedIsGm = () => { try { return !!window.__CCF_HANDOUT_FB__?.isGm?.(); } catch (_) { return false; } };
  function roomKeyNow() { const m = String(location.pathname || "").match(/^\/rooms\/([^/?#]+)/); if (!m) return ""; try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; } }
  function macroDocId(uid, name) { let h = 5381; for (const ch of String(name)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0; return `${uid}_${h.toString(36)}`; }
  function myDisplayName() {
    try {
      const root = document.getElementById("root"); const key = root && Object.keys(root).find((k) => k.startsWith("__reactContainer"));
      const q = key ? [root[key].stateNode.current] : [];
      while (q.length) { const n = q.shift(); const st = n?.memoizedProps?.store?.getState?.(); if (st) { const uid = st.app?.user?.uid; const m = st.entities?.roomMembers?.entities?.[uid]; return String(m?.name || m?.displayName || st.app?.user?.displayName || "").slice(0, 40); } if (n?.child) q.push(n.child); if (n?.sibling) q.push(n.sibling); }
    } catch (_) { /* 이름 없이 */ }
    return "";
  }
  function syncRoomShare() {
    const fb = sharedFb(), key = roomKeyNow();
    if (!fb || !key) {
      if (roomShare.unsub) { try { roomShare.unsub(); } catch (_) {} roomShare.unsub = null; }
      const next = key ? "no-connection" : "no-room";
      if (roomShare.status !== next) { roomShare.status = next; roomShare.list = []; modalRefresh?.(); }
      return;
    }
    if (roomShare.unsub && roomShare.roomKey === key && roomShare.uid === fb.uid) return;
    if (roomShare.status === "denied" && roomShare.roomKey === key && Date.now() - (roomShare.deniedAt || 0) < 60000) return; // 규칙이 거절하면 1분 쉬었다 다시
    try { roomShare.unsub?.(); } catch (_) {}
    roomShare.roomKey = key; roomShare.uid = fb.uid; roomShare.status = "loading";
    const { collection, onSnapshot } = fb.modules.fs;
    roomShare.unsub = onSnapshot(collection(fb.db, "rooms", key, "macros"), (snap) => {
      const list = [];
      snap.forEach((d) => { const v = d.data() || {}; if (typeof v.name === "string" && v.name.trim() && typeof v.body === "string") list.push({ id: d.id, name: v.name, body: v.body, ownerUid: String(v.ownerUid || ""), ownerName: String(v.ownerName || ""), deleted: v.deleted === true }); });
      roomShare.list = list; roomShare.status = "ok"; modalRefresh?.();
    }, (error) => { roomShare.status = error?.code === "permission-denied" ? "denied" : "error"; roomShare.deniedAt = Date.now(); roomShare.list = []; roomShare.unsub = null; modalRefresh?.(); });
  }
  const roomShareTimer = setInterval(syncRoomShare, 3000);
  ccfSmRegisterTeardown(() => { clearInterval(roomShareTimer); try { roomShare.unsub?.(); } catch (_) {} roomShare.unsub = null; });
  const myRoomEntry = (name) => roomShare.list.find((m) => m.ownerUid === roomShare.uid && m.name === name && !m.deleted);
  const othersRoomMacros = () => roomShare.list.filter((m) => !m.deleted && m.ownerUid !== roomShare.uid);
  function roomShareNote() {
    if (roomShare.status === "no-connection") return "룸 공유는 핸드아웃 연결(인사 창의 확인) 뒤에 쓸 수 있습니다.";
    if (roomShare.status === "denied") return "룸 공유 규칙이 아직 게시되지 않아 공유할 수 없습니다.";
    if (roomShare.status === "error") return "룸 커맨드를 읽지 못했습니다.";
    if (roomShare.status === "loading") return "룸 커맨드를 읽는 중…";
    return "";
  }
  async function setMacroShared(macro, on) {
    const fb = sharedFb();
    if (!fb || roomShare.status !== "ok") throw new Error(roomShareNote() || "룸 공유를 쓸 수 없습니다.");
    const { doc, setDoc } = fb.modules.fs;
    await setDoc(doc(fb.db, "rooms", roomShare.roomKey, "macros", macroDocId(fb.uid, macro.name)), { name: macro.name, body: macro.body, ownerUid: fb.uid, ownerName: myDisplayName(), updatedAt: Date.now(), deleted: !on });
  }
  async function deleteRoomMacro(entry) {
    const fb = sharedFb();
    if (!fb) throw new Error(roomShareNote());
    const { doc, deleteDoc } = fb.modules.fs;
    await deleteDoc(doc(fb.db, "rooms", roomShare.roomKey, "macros", entry.id));
  }
  // 자동완성: 내 것 + 룸 것(이름이 내 것과 겹치지 않는 것만, "이름 (공유)")
  function popupMacros() {
    const mine = readMacros();
    const names = new Set(mine.map((m) => m.name));
    return [...mine, ...othersRoomMacros().filter((m) => !names.has(m.name)).map((m) => ({ name: `${m.name} (공유)`, body: m.body, shared: true }))];
  }

  // 다른 탭에서 변경되면 캐시 무효화
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) _macrosCache = null;
  }, ccfSmWithSignal());

  // ----- editor utilities -----------------------------------------------------

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isChatEditor(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (!isVisible(el)) return false;
    if (el.hasAttribute("readonly") || el.hasAttribute("disabled")) return false;
    if (el.closest('[role="dialog"], .MuiDialog-root')) return false;
    // 메시지 입력칸은 보통 D4/D6/... 다이스 버튼이나 전송 버튼이 들어 있는 툴바와 같은 컨테이너 내에 위치.
    let cur = el.parentElement;
    for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
      if (cur.querySelector('button[aria-label="D4"], button[aria-label="채팅 커맨드에 대해"]')) return true;
      if (cur.querySelector('button[type="submit"]')) return true;
    }
    return false;
  }

  function getEditorValue(editor) {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value;
    return editor.textContent || "";
  }

  function setEditorValue(editor, value) {
    if (!(editor instanceof HTMLElement)) return;
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(editor.constructor.prototype, "value")?.set;
      if (setter) setter.call(editor, value);
      else editor.value = value;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      // 커서를 끝으로 이동
      try {
        const end = value.length;
        editor.setSelectionRange?.(end, end);
      } catch (error) { /* selection failed (e.g. non-text input) */ }
      return;
    }
    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      editor.textContent = value;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // ----- autocomplete popup ---------------------------------------------------

  const popup = {
    el: null,
    listEl: null,
    boundEditor: null,
    items: [],
    activeIndex: 0,
    mode: "review"  // "review" = 펼치고 사용자가 Enter, "send" = 본문 펼친 직후 자동 전송
  };

  function ensurePopup() {
    if (popup.el && document.body.contains(popup.el)) return popup.el;
    const el = document.createElement("div");
    el.id = POPUP_ID;
    el.setAttribute("role", "listbox");
    el.hidden = true;
    const list = document.createElement("ul");
    list.className = "ccf-sm-popup-list";
    el.appendChild(list);
    document.body.appendChild(el);
    popup.el = el;
    popup.listEl = list;

    list.addEventListener("mousedown", (event) => {
      // input blur 방지
      event.preventDefault();
    }, ccfSmWithSignal());

    list.addEventListener("click", (event) => {
      const item = event.target instanceof Element ? event.target.closest("[data-macro-index]") : null;
      if (!item) return;
      const idx = Number(item.getAttribute("data-macro-index"));
      if (Number.isFinite(idx)) {
        popup.activeIndex = idx;
        expandSelected();
      }
    }, ccfSmWithSignal());

    return el;
  }

  function hidePopup() {
    if (!popup.el) return;
    popup.el.hidden = true;
    popup.boundEditor = null;
    popup.items = [];
    popup.activeIndex = 0;
    popup.mode = "review";
  }

  function renderPopup(editor, items, mode) {
    ensurePopup();
    popup.boundEditor = editor;
    popup.items = items;
    popup.activeIndex = 0;
    popup.mode = mode === "send" ? "send" : "review";

    popup.listEl.innerHTML = items.map((m, i) => `
      <li role="option" data-macro-index="${i}" class="ccf-sm-popup-item${i === 0 ? " is-active" : ""}">
        <span class="ccf-sm-popup-name">${escapeHtml(m.name)}</span>
        <span class="ccf-sm-popup-preview">${escapeHtml(previewBody(m.body))}</span>
      </li>
    `).join("");

    positionPopup(editor);
    popup.el.hidden = false;
  }

  function positionPopup(editor) {
    if (!popup.el || !(editor instanceof HTMLElement)) return;
    const rect = editor.getBoundingClientRect();
    const popupWidth = Math.min(Math.max(rect.width, 240), 480);
    popup.el.style.width = `${popupWidth}px`;
    popup.el.style.left = `${Math.round(rect.left)}px`;
    // 입력창 바로 위에 띄움
    const top = Math.round(rect.top - 8);
    popup.el.style.top = `${top}px`;
    popup.el.style.transform = "translateY(-100%)";
  }

  function previewBody(body) {
    const firstLine = String(body || "").split(/\r?\n/)[0] || "";
    return firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
  }

  function moveActive(delta) {
    if (popup.el?.hidden || !popup.items.length) return;
    const next = (popup.activeIndex + delta + popup.items.length) % popup.items.length;
    popup.activeIndex = next;
    [...popup.listEl.children].forEach((child, i) => {
      child.classList.toggle("is-active", i === next);
    });
    const active = popup.listEl.children[next];
    if (active instanceof HTMLElement) active.scrollIntoView({ block: "nearest" });
  }

  function expandSelected() {
    if (!popup.boundEditor || popup.el?.hidden) return false;
    const macro = popup.items[popup.activeIndex];
    if (!macro) return false;
    const editor = popup.boundEditor;
    setEditorValue(editor, macro.body);
    editor.focus();
    hidePopup();
    return true;
  }

  // ----- editor binding -------------------------------------------------------

  function handleEditorInput(event) {
    const editor = event.target;
    if (!(editor instanceof HTMLElement)) return;
    if (!isChatEditor(editor)) return;
    const value = getEditorValue(editor);

    // /m 프리픽스 모드 — 펼침만 하고 사용자가 다시 Enter로 전송 (review)
    const triggerMatch = value.match(TRIGGER_PATTERN);
    if (triggerMatch) {
      const filter = (triggerMatch[1] || "").trim().toLowerCase();
      const all = popupMacros();
      const items = !filter ? all : all.filter((m) => m.name.toLowerCase().includes(filter));
      if (items.length) renderPopup(editor, items, "review");
      else if (popup.boundEditor === editor) hidePopup();
      return;
    }

    // 직접 이름 매칭 모드 — 매크로 이름의 프리픽스와 일치하면 팝업.
    // 동작은 /m 모드와 동일 (펼침만, 사용자가 다시 Enter로 전송).
    const trimmed = value.trim();
    if (!trimmed) {
      if (popup.boundEditor === editor) hidePopup();
      return;
    }
    const lower = trimmed.toLowerCase();
    const matches = popupMacros().filter((m) => m.name.toLowerCase().startsWith(lower));
    if (matches.length) {
      renderPopup(editor, matches, "review");
    } else if (popup.boundEditor === editor) {
      hidePopup();
    }
  }

  function handleEditorKeydown(event) {
    const editor = event.target;
    if (popup.boundEditor !== editor || popup.el?.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault(); event.stopPropagation();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      moveActive(-1);
    } else if (event.key === "Enter" || event.key === "Tab") {
      // 전송 막고 본문만 펼침. 사용자가 다시 Enter를 눌러야 전송됨.
      if (expandSelected()) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      hidePopup();
    }
  }

  function handleEditorBlur(event) {
    if (popup.boundEditor === event.target) {
      // 클릭으로 항목 선택 시 mousedown에서 preventDefault 했으므로 즉시 숨겨도 안전
      setTimeout(() => {
        if (!ccfSmLifecycle.isActive()) return;
        if (document.activeElement === popup.boundEditor) return;
        hidePopup();
      }, 80);
    }
  }

  function bindEditor(editor) {
    if (!(editor instanceof HTMLElement)) return;
    if (editor.getAttribute(EDITOR_BOUND_ATTR) === "1") return;
    editor.setAttribute(EDITOR_BOUND_ATTR, "1");
    editor.addEventListener("input", handleEditorInput, ccfSmWithSignal());
    editor.addEventListener("keydown", handleEditorKeydown, ccfSmWithSignal({ capture: true }));
    editor.addEventListener("blur", handleEditorBlur, ccfSmWithSignal());
  }

  function scanEditors() {
    if (!document.body) return;
    document.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
      if (isChatEditor(editor)) bindEditor(editor);
    });
  }

  // ----- "채팅 커맨드에 대해" dialog detection ---------------------------------

  function isHelpDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) return false;
    if (!dialog.matches('.MuiDialog-root, [role="dialog"]')) return false;
    const text = (dialog.textContent || "");
    return HELP_DIALOG_HINTS.some((h) => text.includes(h));
  }

  function findDialogTitleHost(dialog) {
    if (!(dialog instanceof HTMLElement)) return null;
    return (
      dialog.querySelector(".MuiDialogTitle-root") ||
      dialog.querySelector("h1, h2, h3, h4") ||
      dialog.querySelector(".MuiDialog-paper > div:first-child")
    );
  }

  // MUI Dialog는 FocusTrap으로 포커스를 가두므로, 외부 모달(우리 매크로 관리 모달)을
  // 열기 전에 반드시 닫아야 입력칸 클릭/타이핑이 정상 동작한다.
  function closeMuiDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) return;
    // 1) backdrop 클릭 시뮬레이션 (가장 자연스러운 종료 경로)
    const backdrop = dialog.querySelector(".MuiBackdrop-root")
      || document.querySelector("body > .MuiDialog-root .MuiBackdrop-root")
      || document.querySelector('body > [role="presentation"] .MuiBackdrop-root');
    if (backdrop instanceof HTMLElement) {
      try {
        backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        backdrop.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return;
      } catch (error) { /* fall through */ }
    }
    // 2) Esc 키 폴백
    try {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", bubbles: true, cancelable: true }));
    } catch (error) { /* dispatch failed */ }
  }

  function injectHelpDialogButton(dialog) {
    const title = findDialogTitleHost(dialog);
    if (!title) return;
    if (title.querySelector(`[${TOOLBAR_BTN_ATTR}]`)) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(TOOLBAR_BTN_ATTR, "manage");
    btn.className = "ccf-sm-toolbar-btn";
    btn.textContent = "커스텀 커맨드";
    btn.title = "커스텀 커맨드 관리";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // MUI 다이얼로그의 FocusTrap이 우리 모달 입력칸으로의 포커스 이동을 막으므로,
      // 도움말 다이얼로그를 먼저 닫고 우리 모달을 연다.
      closeMuiDialog(dialog);
      // dialog 닫힘 transition이 끝난 뒤 열어야 backdrop이 우리 모달을 가리지 않는다.
      setTimeout(openManageModal, 60);
    }, ccfSmWithSignal());

    // 제목 영역 우측 끝에 배치
    title.style.display = title.style.display || "flex";
    title.style.alignItems = title.style.alignItems || "center";
    title.appendChild(btn);
  }

  // ----- management modal -----------------------------------------------------

  function openManageModal() {
    closeManageModal();
    const root = document.createElement("div");
    root.id = MODAL_ID;
    // 다른 스크립트(roll20-css-bridge, format-sync 등)가 우리 모달의 textarea +
    // submit 버튼 조합을 채팅 입력칸으로 오인해 자기 버튼을 주입하는 걸 막는다.
    root.setAttribute("data-ccr20-safe-ui", "1");
    root.setAttribute("data-ccf-safe-ui", "1");
    root.innerHTML = `
      <div class="ccf-sm-modal-backdrop"></div>
      <div class="ccf-sm-modal-card" role="dialog" aria-modal="true">
        <div class="ccf-sm-modal-head">
          <strong>커스텀 커맨드</strong>
          <button type="button" class="ccf-sm-modal-close" aria-label="닫기">×</button>
        </div>
        <div class="ccf-sm-modal-body">
          <div class="ccf-sm-modal-list" data-role="list"></div>
          <div class="ccf-sm-room" data-role="room"></div>
          <div class="ccf-sm-modal-form" data-role="form">
            <label class="ccf-sm-modal-label">
              <span>이름 (예: roll-weather)</span>
              <input type="text" data-role="name" autocomplete="off" spellcheck="false" />
            </label>
            <label class="ccf-sm-modal-label">
              <span>본문 (여러 줄, /m &lt;이름&gt; 입력 시 그대로 채워짐)</span>
              <textarea data-role="body" rows="8" spellcheck="false"></textarea>
            </label>
            <div class="ccf-sm-modal-actions">
              <div class="ccf-sm-modal-status" data-role="status" aria-live="polite"></div>
              <button type="button" data-role="clear">새로 작성</button>
              <button type="button" data-role="save">저장 / 덮어쓰기</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const listEl = root.querySelector('[data-role="list"]');
    const nameEl = root.querySelector('[data-role="name"]');
    const bodyEl = root.querySelector('[data-role="body"]');
    const statusEl = root.querySelector('[data-role="status"]');
    const formEl = root.querySelector('[data-role="form"]');
    const roomEl = root.querySelector('[data-role="room"]');

    const renderRoom = () => {
      const others = othersRoomMacros();
      const note = roomShareNote();
      const gm = sharedIsGm();
      roomEl.innerHTML = `<div class="ccf-sm-room-head"><strong>룸 커맨드</strong>${note ? `<span class="ccf-sm-room-note">${escapeHtml(note)}</span>` : ""}</div>` + (others.length
        ? others.map((m) => `<div class="ccf-sm-modal-row ccf-sm-room-row" data-room-id="${escapeHtml(m.id)}"><div class="ccf-sm-modal-row-main"><strong>${escapeHtml(m.name)} <span class="ccf-sm-room-owner">(공유${m.ownerName ? ` · ${escapeHtml(m.ownerName)}` : ""})</span></strong><code>${escapeHtml(previewBody(m.body))}</code></div><div class="ccf-sm-modal-row-actions"><button type="button" data-action="copy">내 커맨드로 복사</button>${gm ? '<button type="button" data-action="room-delete">삭제</button>' : ""}</div></div>`).join("")
        : (roomShare.status === "ok" ? '<p class="ccf-sm-modal-empty">다른 사람이 공유한 커맨드가 없습니다.</p>' : ""));
    };
    roomEl.addEventListener("click", async (event) => {
      const row = event.target instanceof Element ? event.target.closest("[data-room-id]") : null;
      const action = event.target instanceof Element ? event.target.getAttribute("data-action") : null;
      const entry = row && roomShare.list.find((m) => m.id === row.getAttribute("data-room-id"));
      if (!entry || !action) return;
      try {
        if (action === "copy") {
          const exists = readMacros().some((m) => m.name === entry.name);
          const name = exists ? `${entry.name} (복사)` : entry.name;
          saveMacro(name, entry.body);
          statusEl.textContent = `'${name}' 내 커맨드로 복사됨`;
          refresh();
        } else if (action === "room-delete") {
          if (!confirm(`룸 커맨드 '${entry.name}'을(를) 룸에서 지울까요? (만든 사람의 개인 커맨드는 남습니다)`)) return;
          await deleteRoomMacro(entry);
          statusEl.textContent = `'${entry.name}' 룸에서 지움`;
        }
      } catch (error) { statusEl.textContent = error?.message || "처리하지 못했습니다."; }
    }, ccfSmWithSignal());

    const refresh = () => {
      renderRoom();
      const macros = readMacros();
      if (!macros.length) {
        listEl.innerHTML = '<p class="ccf-sm-modal-empty">저장된 커스텀 커맨드가 없습니다. 아래에서 추가하세요.</p>';
        return;
      }
      listEl.innerHTML = macros.map((m, i) => `
        <div class="ccf-sm-modal-row" data-name="${escapeHtml(m.name)}" data-index="${i}" draggable="true">
          <span class="ccf-sm-modal-row-grip" aria-hidden="true" title="드래그해서 순서 변경">⋮⋮</span>
          <div class="ccf-sm-modal-row-main">
            <strong>${escapeHtml(m.name)}</strong>
            <code>${escapeHtml(previewBody(m.body))}</code>
          </div>
          <div class="ccf-sm-modal-row-actions">
            ${(() => { const on = !!myRoomEntry(m.name), usable = roomShare.status === "ok"; return `<button type="button" data-action="share" data-on="${on ? "1" : "0"}"${usable || on ? "" : " disabled"} title="${escapeHtml(usable ? (on ? "룸 공유 끄기" : "이 룸의 모두에게 공유") : roomShareNote())}">${on ? "공유 중" : "룸 공유"}</button>`; })()}
            <button type="button" data-action="edit">편집</button>
            <button type="button" data-action="delete">삭제</button>
          </div>
        </div>
      `).join("");
      bindRowDragHandlers(listEl, refresh);
    };

    listEl.addEventListener("click", (event) => {
      const row = event.target instanceof Element ? event.target.closest(".ccf-sm-modal-row") : null;
      if (!row) return;
      const name = row.getAttribute("data-name");
      const action = event.target instanceof Element ? event.target.getAttribute("data-action") : null;
      const target = readMacros().find((m) => m.name === name);
      if (!target) return;
      if (action === "share") {
        const on = !myRoomEntry(target.name);
        setMacroShared(target, on).then(() => { statusEl.textContent = on ? `'${target.name}' 룸에 공유됨` : `'${target.name}' 룸 공유 끔`; }).catch((error) => { statusEl.textContent = error?.message || "공유하지 못했습니다."; });
        return;
      }
      if (action === "edit") {
        nameEl.value = target.name;
        bodyEl.value = target.body;
        nameEl.focus();
        statusEl.textContent = `'${target.name}' 편집 중`;
      } else if (action === "delete") {
        if (!confirm(`'${target.name}' 커스텀 커맨드를 삭제할까요?`)) return;
        deleteMacro(target.name);
        statusEl.textContent = `'${target.name}' 삭제됨`;
        refresh();
      }
    }, ccfSmWithSignal());

    root.querySelector('[data-role="save"]').addEventListener("click", (event) => {
      event.preventDefault();
      try {
        saveMacro(nameEl.value, bodyEl.value);
        statusEl.textContent = `'${nameEl.value.trim()}' 저장됨`;
        refresh();
      } catch (error) {
        statusEl.textContent = error?.message || "저장 실패";
      }
    }, ccfSmWithSignal());

    root.querySelector('[data-role="clear"]').addEventListener("click", () => {
      nameEl.value = ""; bodyEl.value = ""; statusEl.textContent = ""; nameEl.focus();
    }, ccfSmWithSignal());

    root.querySelector(".ccf-sm-modal-close").addEventListener("click", closeManageModal, ccfSmWithSignal());
    root.querySelector(".ccf-sm-modal-backdrop").addEventListener("click", closeManageModal, ccfSmWithSignal());
    document.addEventListener("keydown", escapeModalListener, ccfSmWithSignal());

    // 헤더 드래그로 카드 이동
    enableModalDrag(root);

    // 다른 스크립트가 우리 모달 안으로 자기 버튼을 주입했다가 SAFE_UI 마커보다
    // 늦게 떨어지면 잔존할 수 있어, 모달 열 때마다 우리 영역 안의 외부 주입 버튼을 정리.
    const cleanForeignInjections = () => {
      root.querySelectorAll(".ccr20-open-btn, [data-ccr20-open-btn], .ccf-open-btn[data-ccf-open-btn]")
        .forEach((el) => el.remove());
    };
    cleanForeignInjections();
    requestAnimationFrame(cleanForeignInjections);
    setTimeout(cleanForeignInjections, 200);

    modalRefresh = () => { if (root.isConnected) refresh(); else modalRefresh = null; };
    syncRoomShare();
    refresh();
    nameEl.focus();
  }

  function escapeModalListener(event) {
    if (event.key === "Escape" && document.getElementById(MODAL_ID)) {
      closeManageModal();
    }
  }

  function bindRowDragHandlers(listEl, refresh) {
    if (!(listEl instanceof HTMLElement)) return;
    let draggingIdx = -1;

    listEl.querySelectorAll(".ccf-sm-modal-row").forEach((row) => {
      if (!(row instanceof HTMLElement)) return;

      row.addEventListener("dragstart", (event) => {
        draggingIdx = Number(row.getAttribute("data-index"));
        row.classList.add("is-dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          // FF에서 dragstart가 발화되도록 데이터를 한 번 세팅
          try { event.dataTransfer.setData("text/plain", row.getAttribute("data-name") || ""); } catch (error) { /* setData failed */ }
        }
      });

      row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        draggingIdx = -1;
        listEl.querySelectorAll(".ccf-sm-modal-row").forEach((r) => r.classList.remove("is-drop-before", "is-drop-after"));
      });

      row.addEventListener("dragover", (event) => {
        if (draggingIdx < 0) return;
        const overIdx = Number(row.getAttribute("data-index"));
        if (overIdx === draggingIdx) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const before = (event.clientY - rect.top) < rect.height / 2;
        listEl.querySelectorAll(".ccf-sm-modal-row").forEach((r) => r.classList.remove("is-drop-before", "is-drop-after"));
        row.classList.add(before ? "is-drop-before" : "is-drop-after");
      });

      row.addEventListener("drop", (event) => {
        if (draggingIdx < 0) return;
        event.preventDefault();
        const overIdx = Number(row.getAttribute("data-index"));
        const rect = row.getBoundingClientRect();
        const before = (event.clientY - rect.top) < rect.height / 2;
        const targetIdx = before ? overIdx : overIdx + 1;
        if (reorderMacro(draggingIdx, targetIdx)) {
          refresh();
        }
      });
    });
  }

  function enableModalDrag(root) {
    const card = root.querySelector(".ccf-sm-modal-card");
    const head = root.querySelector(".ccf-sm-modal-head");
    if (!(card instanceof HTMLElement) || !(head instanceof HTMLElement)) return;

    const state = { dragging: false, startX: 0, startY: 0, originLeft: 0, originTop: 0 };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      // 헤더 안의 인터랙티브 요소(닫기 버튼 등)에서는 드래그 시작 금지
      if (event.target instanceof Element && event.target.closest("button, input, textarea, a, [contenteditable]")) return;

      // 첫 드래그 직전, 중앙 정렬(transform: translate(-50%, -50%))을 명시적 left/top(px)으로 고정.
      const rect = card.getBoundingClientRect();
      card.style.left = `${rect.left}px`;
      card.style.top = `${rect.top}px`;
      card.style.transform = "none";

      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.originLeft = rect.left;
      state.originTop = rect.top;

      head.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };

    const onPointerMove = (event) => {
      if (!state.dragging) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      // 카드가 뷰포트를 완전히 벗어나지 않도록 살짝의 마진(헤더 일부는 항상 보이게).
      const minLeft = -w + 80;
      const maxLeft = window.innerWidth - 80;
      const minTop = 0;
      const maxTop = window.innerHeight - 40;
      const nextLeft = Math.min(Math.max(state.originLeft + dx, minLeft), maxLeft);
      const nextTop = Math.min(Math.max(state.originTop + dy, minTop), maxTop);
      card.style.left = `${nextLeft}px`;
      card.style.top = `${nextTop}px`;
    };

    const onPointerUp = (event) => {
      if (!state.dragging) return;
      state.dragging = false;
      try { head.releasePointerCapture?.(event.pointerId); } catch (error) { /* release failed */ }
    };

    head.addEventListener("pointerdown", onPointerDown, ccfSmWithSignal());
    head.addEventListener("pointermove", onPointerMove, ccfSmWithSignal());
    head.addEventListener("pointerup", onPointerUp, ccfSmWithSignal());
    head.addEventListener("pointercancel", onPointerUp, ccfSmWithSignal());
  }

  function closeManageModal() {
    document.getElementById(MODAL_ID)?.remove();
    document.removeEventListener("keydown", escapeModalListener);
  }

  // ----- styles ---------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${POPUP_ID} {
        position: fixed;
        z-index: 2147483600;
        background: #1f1f1f;
        color: #f4f0eb;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        box-shadow: 0 16px 36px rgba(0,0,0,0.45);
        font-family: "Segoe UI", "Malgun Gothic", sans-serif;
        font-size: 13px;
        line-height: 1.4;
        overflow: hidden;
        min-width: 240px;
        max-height: 260px;
        display: flex;
        flex-direction: column;
      }
      #${POPUP_ID}[hidden] { display: none !important; }
      #${POPUP_ID} .ccf-sm-popup-list {
        list-style: none;
        margin: 0;
        padding: 4px 0;
        overflow: auto;
        max-height: 260px;
      }
      #${POPUP_ID} .ccf-sm-popup-item {
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      #${POPUP_ID} .ccf-sm-popup-item.is-active,
      #${POPUP_ID} .ccf-sm-popup-item:hover {
        background: rgba(255,255,255,0.08);
      }
      #${POPUP_ID} .ccf-sm-popup-name {
        font-weight: 700;
        color: #ffffff;
      }
      #${POPUP_ID} .ccf-sm-popup-preview {
        opacity: 0.7;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ccf-sm-toolbar-btn {
        margin-left: auto;
        padding: 4px 10px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font-size: 15px;
        cursor: pointer;
      }
      .ccf-sm-toolbar-btn:hover { background: rgba(255,255,255,0.08); }

      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483601;
        font-family: "Segoe UI", "Malgun Gothic", sans-serif;
      }
      #${MODAL_ID} .ccf-sm-modal-backdrop {
        position: absolute; inset: 0;
        background: rgba(0,0,0,0.55);
      }
      #${MODAL_ID} .ccf-sm-modal-card {
        position: absolute;
        left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        width: min(640px, calc(100vw - 32px));
        max-height: calc(100vh - 48px);
        display: flex;
        flex-direction: column;
        background: rgba(44, 44, 44, 0.87);
        color: #ffffff;
        border-radius: 0;
        box-shadow: 0 3px 5px -1px rgba(0,0,0,0.2),
                    0 6px 10px 0 rgba(0,0,0,0.14),
                    0 1px 18px 0 rgba(0,0,0,0.12);
        overflow: hidden;
      }
      #${MODAL_ID} .ccf-sm-modal-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        font-size: 14px;
        cursor: move;
        user-select: none;
      }
      /* 드래그 핸들로 잡혀선 안 되는 인터랙티브 요소들은 별도 커서 */
      #${MODAL_ID} .ccf-sm-modal-head button { cursor: pointer; }
      #${MODAL_ID} .ccf-sm-modal-head .ccf-sm-toolbar-btn { cursor: pointer; }
      #${MODAL_ID} .ccf-sm-modal-close {
        appearance: none; background: transparent; color: inherit;
        border: 0; font-size: 22px; line-height: 1; cursor: pointer;
        width: 28px; height: 28px; border-radius: 0;
      }
      #${MODAL_ID} .ccf-sm-modal-close:hover { background: rgba(255,255,255,0.08); }
      #${MODAL_ID} .ccf-sm-modal-body {
        padding: 14px 18px 10px;
        overflow: auto;
        display: grid;
        gap: 14px;
      }
      #${MODAL_ID} .ccf-sm-modal-list {
        display: grid;
        gap: 6px;
        max-height: 220px;
        overflow: auto;
        padding-right: 4px;
      }
      #${MODAL_ID} .ccf-sm-modal-empty {
        margin: 0; padding: 10px 12px; opacity: 0.7;
        background: rgba(255,255,255,0.04); border-radius: 0; font-size: 12px;
      }
      #${MODAL_ID} .ccf-sm-modal-row {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.04);
        border-radius: 0;
        position: relative;
        transition: transform 160ms cubic-bezier(0.2, 0.7, 0.2, 1),
                    box-shadow 160ms cubic-bezier(0.2, 0.7, 0.2, 1),
                    background 160ms ease;
        will-change: transform;
      }
      #${MODAL_ID} .ccf-sm-modal-row.is-dragging {
        opacity: 0.55;
        background: rgba(255,255,255,0.10);
        transform: scale(1.01);
        box-shadow: 0 8px 18px rgba(0,0,0,0.35);
        z-index: 1;
      }
      #${MODAL_ID} .ccf-sm-modal-row.is-drop-before { transform: translateY(4px); }
      #${MODAL_ID} .ccf-sm-modal-row.is-drop-after { transform: translateY(-4px); }
      #${MODAL_ID} .ccf-sm-modal-row.is-drop-before::before,
      #${MODAL_ID} .ccf-sm-modal-row.is-drop-after::after {
        content: "";
        position: absolute;
        left: 4px; right: 4px; height: 2px;
        background: rgb(33, 150, 243);
        box-shadow: 0 0 6px rgba(33, 150, 243, 0.6);
      }
      #${MODAL_ID} .ccf-sm-modal-row.is-drop-before::before { top: -3px; }
      #${MODAL_ID} .ccf-sm-modal-row.is-drop-after::after { bottom: -3px; }
      #${MODAL_ID} .ccf-sm-modal-row-grip {
        flex: 0 0 auto;
        cursor: grab;
        font-size: 16px;
        line-height: 1;
        opacity: 0.45;
        user-select: none;
        letter-spacing: -2px;
      }
      #${MODAL_ID} .ccf-sm-modal-row-grip:active { cursor: grabbing; }
      #${MODAL_ID} .ccf-sm-modal-row:hover .ccf-sm-modal-row-grip { opacity: 0.75; }
      #${MODAL_ID} .ccf-sm-modal-row-main {
        flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
      }
      #${MODAL_ID} .ccf-sm-modal-row-main strong { font-size: 13px; color: #ffffff; }
      #${MODAL_ID} .ccf-sm-modal-row-main code {
        font-size: 11px; opacity: 0.7;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #${MODAL_ID} .ccf-sm-modal-row-actions {
        display: flex; gap: 6px; flex: 0 0 auto;
      }
      #${MODAL_ID} .ccf-sm-modal-row-actions button {
        appearance: none; padding: 4px 10px; border-radius: 0;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.04); color: inherit;
        font-size: 11px; cursor: pointer;
      }
      #${MODAL_ID} .ccf-sm-modal-row-actions button:hover { background: rgba(255,255,255,0.12); }
      #${MODAL_ID} .ccf-sm-modal-row-actions button[data-action="share"][data-on="1"] { border-color: rgba(33,150,243,.7); color: #90caf9; }
      #${MODAL_ID} .ccf-sm-modal-row-actions button:disabled { opacity: .45; cursor: default; }
      #${MODAL_ID} .ccf-sm-room { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
      #${MODAL_ID} .ccf-sm-room-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
      #${MODAL_ID} .ccf-sm-room-note { font-size: 11px; opacity: .7; }
      #${MODAL_ID} .ccf-sm-room-owner { font-weight: 400; opacity: .7; font-size: 11px; }

      #${MODAL_ID} .ccf-sm-modal-form {
        display: grid; gap: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.08);
      }
      #${MODAL_ID} .ccf-sm-modal-label {
        display: grid; gap: 4px;
        font-size: 12px;
      }
      #${MODAL_ID} .ccf-sm-modal-label span { opacity: 0.78; }
      #${MODAL_ID} input[data-role="name"],
      #${MODAL_ID} textarea[data-role="body"] {
        appearance: none;
        background: #161616;
        color: #f4f0eb;
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 0;
        padding: 8px 10px;
        font: inherit;
        line-height: 1.45;
        box-sizing: border-box;
        width: 100%;
      }
      #${MODAL_ID} textarea[data-role="body"] {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        resize: vertical;
        min-height: 140px;
      }
      #${MODAL_ID} .ccf-sm-modal-actions {
        display: flex; gap: 8px;
        align-items: center;
        justify-content: flex-end;
      }
      /* 상태 메시지를 액션 바 왼쪽에 두고 남는 공간 차지 → 버튼은 우측 고정. */
      #${MODAL_ID} .ccf-sm-modal-actions .ccf-sm-modal-status {
        flex: 1;
        min-width: 0;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* CCFOLIA 캐릭터 편집 팝업 하단의 MUI Button(text variant) 디자인을 차용:
         배경 투명 / 굵은 대문자 / 보조=핑크 / 메인=블루. */
      #${MODAL_ID} .ccf-sm-modal-actions button {
        appearance: none;
        padding: 6px 8px;
        border: 0;
        border-radius: 0;
        background: rgba(0,0,0,0);
        color: rgb(220, 0, 78);
        font-family: Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        font-weight: 700;
        text-transform: uppercase;
        min-width: 64px;
        line-height: 1.75;
        box-shadow: none;
        cursor: pointer;
      }
      #${MODAL_ID} .ccf-sm-modal-actions button[data-role="save"] {
        color: rgb(33, 150, 243);
      }
      #${MODAL_ID} .ccf-sm-modal-actions button:hover {
        background-color: rgba(255,255,255,0.06);
      }
      #${MODAL_ID} .ccf-sm-modal-status {
        font-size: 11px; opacity: 0.7;
      }
      /* 메시지가 비어 있을 때는 grid에서 빠져 행 간격(gap)·하단 여백을 차지하지 않도록. */
      #${MODAL_ID} .ccf-sm-modal-status:empty {
        display: none;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    ccfSmRegisterTeardown(() => style.remove());
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  // ----- main observer --------------------------------------------------------

  function start() {
    injectStyle();
    scanEditors();

    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        scanEditors();
        // 도움말 다이얼로그 감지
        document.querySelectorAll('.MuiDialog-root, [role="dialog"]').forEach((dialog) => {
          if (isHelpDialog(dialog)) injectHelpDialogButton(dialog);
        });
      });
    };

    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    ccfSmRegisterTeardown(() => obs.disconnect());

    window.addEventListener("resize", () => {
      if (popup.boundEditor && popup.el && !popup.el.hidden) positionPopup(popup.boundEditor);
    }, ccfSmWithSignal());
  }

  function waitForBody(callback) {
    const tick = () => {
      if (document.body) { callback(); return; }
      window.requestAnimationFrame(tick);
    };
    tick();
  }

  waitForBody(start);
})();
