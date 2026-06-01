// ==UserScript==
// @name         CCFOLIA Slash Macros by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-slash-macros
// @version      0.1.0
// @description  Save and run multi-line slash command macros from the CCFOLIA chat input.
// @description:ko 채팅 슬래시 커맨드 본문을 매크로로 저장하고 /m <이름>으로 펼쳐서 실행합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  try { window.__CCF_SLASH_MACROS_DEBUG__?.disable?.(); } catch (error) { /* prior instance cleanup failed */ }

  // ----- lifecycle / signal ---------------------------------------------------

  let ccfSmActive = true;
  const ccfSmDisposers = [];
  const ccfSmAbort = new AbortController();
  const ccfSmSignal = ccfSmAbort.signal;

  function ccfSmRegisterTeardown(fn) {
    if (typeof fn === "function") ccfSmDisposers.push(fn);
  }

  function ccfSmWithSignal(options) {
    if (options == null) return { signal: ccfSmSignal };
    if (typeof options === "boolean") return { capture: options, signal: ccfSmSignal };
    if (typeof options === "object") {
      if (options.signal && options.signal !== ccfSmSignal) return options;
      return { ...options, signal: ccfSmSignal };
    }
    return { signal: ccfSmSignal };
  }

  function ccfSmTeardown() {
    if (!ccfSmActive) return false;
    ccfSmActive = false;
    try { ccfSmAbort.abort(); } catch (error) { /* abort failed */ }
    while (ccfSmDisposers.length) {
      const disposer = ccfSmDisposers.pop();
      try { disposer(); } catch (error) { /* disposer failed */ }
    }
    try {
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(POPUP_ID)?.remove();
      document.getElementById(MODAL_ID)?.remove();
      document.querySelectorAll(`[${TOOLBAR_BTN_ATTR}]`).forEach((el) => el.remove());
    } catch (error) { /* dom sweep failed */ }
    try {
      if (window.__CCF_SLASH_MACROS_DEBUG__ && window.__CCF_SLASH_MACROS_DEBUG__.__owner === ccfSmSignal) {
        delete window.__CCF_SLASH_MACROS_DEBUG__;
      }
    } catch (error) { /* debug api cleanup failed */ }
    return true;
  }

  window.__CCF_SLASH_MACROS_DEBUG__ = {
    __owner: ccfSmSignal,
    isActive() { return ccfSmActive; },
    disable() { return ccfSmTeardown(); },
    listMacros() { return readMacros(); },
    addMacro(name, body) { saveMacro(name, body); return readMacros(); }
  };

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
          merged.sort((a, b) => a.name.localeCompare(b.name));
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
    if (!cleanName) throw new Error("매크로 이름이 비어있습니다.");
    const list = readMacros().slice();
    const idx = list.findIndex((m) => m.name === cleanName);
    const entry = { name: cleanName, body: cleanBody, updatedAt: Date.now() };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    list.sort((a, b) => a.name.localeCompare(b.name));
    writeMacros(list);
    _macrosCache = null;
  }

  function deleteMacro(name) {
    const list = readMacros();
    const next = list.filter((m) => m.name !== name);
    if (next.length === list.length) return false;
    writeMacros(next);
    _macrosCache = null;
    return true;
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
    activeIndex: 0
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
  }

  function renderPopup(editor, items) {
    ensurePopup();
    popup.boundEditor = editor;
    popup.items = items;
    popup.activeIndex = 0;

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
    setEditorValue(popup.boundEditor, macro.body);
    popup.boundEditor.focus();
    hidePopup();
    return true;
  }

  // ----- editor binding -------------------------------------------------------

  function handleEditorInput(event) {
    const editor = event.target;
    if (!(editor instanceof HTMLElement)) return;
    if (!isChatEditor(editor)) return;
    const value = getEditorValue(editor);
    const match = value.match(TRIGGER_PATTERN);
    if (!match) {
      if (popup.boundEditor === editor) hidePopup();
      return;
    }
    const filter = (match[1] || "").trim().toLowerCase();
    const all = readMacros();
    const items = !filter
      ? all
      : all.filter((m) => m.name.toLowerCase().includes(filter));
    if (!items.length) {
      hidePopup();
      return;
    }
    renderPopup(editor, items);
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
        if (!ccfSmActive) return;
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

  function injectHelpDialogButton(dialog) {
    const title = findDialogTitleHost(dialog);
    if (!title) return;
    if (title.querySelector(`[${TOOLBAR_BTN_ATTR}]`)) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute(TOOLBAR_BTN_ATTR, "manage");
    btn.className = "ccf-sm-toolbar-btn";
    btn.textContent = "내 매크로";
    btn.title = "내 슬래시 매크로 관리";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openManageModal();
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
    root.innerHTML = `
      <div class="ccf-sm-modal-backdrop"></div>
      <div class="ccf-sm-modal-card" role="dialog" aria-modal="true">
        <div class="ccf-sm-modal-head">
          <strong>내 슬래시 매크로 (모든 룸 공용)</strong>
          <button type="button" class="ccf-sm-modal-close" aria-label="닫기">×</button>
        </div>
        <div class="ccf-sm-modal-body">
          <div class="ccf-sm-modal-list" data-role="list"></div>
          <form class="ccf-sm-modal-form" data-role="form">
            <label class="ccf-sm-modal-label">
              <span>이름 (예: roll-weather)</span>
              <input type="text" data-role="name" autocomplete="off" spellcheck="false" />
            </label>
            <label class="ccf-sm-modal-label">
              <span>본문 (여러 줄, /m &lt;이름&gt; 입력 시 그대로 채워짐)</span>
              <textarea data-role="body" rows="8" spellcheck="false"></textarea>
            </label>
            <div class="ccf-sm-modal-actions">
              <button type="button" data-role="clear">새로 작성</button>
              <button type="submit" data-role="save">저장 / 덮어쓰기</button>
            </div>
            <div class="ccf-sm-modal-status" data-role="status" aria-live="polite"></div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const listEl = root.querySelector('[data-role="list"]');
    const nameEl = root.querySelector('[data-role="name"]');
    const bodyEl = root.querySelector('[data-role="body"]');
    const statusEl = root.querySelector('[data-role="status"]');
    const formEl = root.querySelector('[data-role="form"]');

    const refresh = () => {
      const macros = readMacros();
      if (!macros.length) {
        listEl.innerHTML = '<p class="ccf-sm-modal-empty">저장된 매크로가 없습니다. 아래에서 추가하세요.</p>';
        return;
      }
      listEl.innerHTML = macros.map((m) => `
        <div class="ccf-sm-modal-row" data-name="${escapeHtml(m.name)}">
          <div class="ccf-sm-modal-row-main">
            <strong>${escapeHtml(m.name)}</strong>
            <code>${escapeHtml(previewBody(m.body))}</code>
          </div>
          <div class="ccf-sm-modal-row-actions">
            <button type="button" data-action="edit">편집</button>
            <button type="button" data-action="delete">삭제</button>
          </div>
        </div>
      `).join("");
    };

    listEl.addEventListener("click", (event) => {
      const row = event.target instanceof Element ? event.target.closest(".ccf-sm-modal-row") : null;
      if (!row) return;
      const name = row.getAttribute("data-name");
      const action = event.target instanceof Element ? event.target.getAttribute("data-action") : null;
      const target = readMacros().find((m) => m.name === name);
      if (!target) return;
      if (action === "edit") {
        nameEl.value = target.name;
        bodyEl.value = target.body;
        nameEl.focus();
        statusEl.textContent = `'${target.name}' 편집 중`;
      } else if (action === "delete") {
        if (!confirm(`'${target.name}' 매크로를 삭제할까요?`)) return;
        deleteMacro(target.name);
        statusEl.textContent = `'${target.name}' 삭제됨`;
        refresh();
      }
    }, ccfSmWithSignal());

    formEl.addEventListener("submit", (event) => {
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

    refresh();
    nameEl.focus();
  }

  function escapeModalListener(event) {
    if (event.key === "Escape" && document.getElementById(MODAL_ID)) {
      closeManageModal();
    }
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
        color: #ffe9c2;
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
        border: 1px solid rgba(255,255,255,0.22);
        border-radius: 999px;
        background: rgba(255,255,255,0.06);
        color: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      .ccf-sm-toolbar-btn:hover { background: rgba(255,255,255,0.12); }

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
        background: #232323;
        color: #f4f0eb;
        border-radius: 12px;
        box-shadow: 0 28px 60px rgba(0,0,0,0.5);
        overflow: hidden;
      }
      #${MODAL_ID} .ccf-sm-modal-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        font-size: 14px;
      }
      #${MODAL_ID} .ccf-sm-modal-close {
        appearance: none; background: transparent; color: inherit;
        border: 0; font-size: 22px; line-height: 1; cursor: pointer;
        width: 28px; height: 28px; border-radius: 6px;
      }
      #${MODAL_ID} .ccf-sm-modal-close:hover { background: rgba(255,255,255,0.08); }
      #${MODAL_ID} .ccf-sm-modal-body {
        padding: 14px 18px 18px;
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
        background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 12px;
      }
      #${MODAL_ID} .ccf-sm-modal-row {
        display: flex; align-items: center; gap: 12px;
        padding: 8px 12px;
        background: rgba(255,255,255,0.04);
        border-radius: 8px;
      }
      #${MODAL_ID} .ccf-sm-modal-row-main {
        flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
      }
      #${MODAL_ID} .ccf-sm-modal-row-main strong { font-size: 13px; color: #ffe9c2; }
      #${MODAL_ID} .ccf-sm-modal-row-main code {
        font-size: 11px; opacity: 0.7;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #${MODAL_ID} .ccf-sm-modal-row-actions {
        display: flex; gap: 6px; flex: 0 0 auto;
      }
      #${MODAL_ID} .ccf-sm-modal-row-actions button {
        appearance: none; padding: 4px 10px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(255,255,255,0.04); color: inherit;
        font-size: 11px; cursor: pointer;
      }
      #${MODAL_ID} .ccf-sm-modal-row-actions button:hover { background: rgba(255,255,255,0.12); }

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
        border-radius: 6px;
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
        display: flex; gap: 8px; justify-content: flex-end;
      }
      #${MODAL_ID} .ccf-sm-modal-actions button {
        appearance: none; padding: 7px 14px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.22);
        background: rgba(255,255,255,0.06); color: inherit;
        font-size: 12px; cursor: pointer;
      }
      #${MODAL_ID} .ccf-sm-modal-actions button[data-role="save"] {
        background: #ffb74d; color: #2a1a00; border-color: transparent;
        font-weight: 700;
      }
      #${MODAL_ID} .ccf-sm-modal-actions button:hover { filter: brightness(1.08); }
      #${MODAL_ID} .ccf-sm-modal-status {
        font-size: 11px; opacity: 0.7; min-height: 14px;
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
