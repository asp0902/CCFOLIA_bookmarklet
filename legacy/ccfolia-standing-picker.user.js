// ==UserScript==
// @name         CCFOLIA Standing Picker by Capybara_korea
// @namespace    https://gre0asyfork.org/users/Capybara_korea/ccf-standing-picker
// @version      0.1.13
// @description  Lets you select CCFOLIA standing labels quickly from chat with @.
// @description:ko CCFOLIA 채팅 입력 중 @로 캐릭터 스탠딩 라벨을 빠르게 선택합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

try { window.__CCF_STANDING_PICKER_DEBUG__?.disable?.(); } catch (error) { /* previous instance cleanup failed */ }

let ccfspActive = true;
const ccfspDisposers = [];
const ccfspAbort = new AbortController();
const ccfspSignal = ccfspAbort.signal;
const CCFSP_STYLE_ID = 'ccfolia-standing-picker-userscript-style';
const CCFSP_STYLE = "/* [DADA] */\n#ccfolia-standing-popup{\n  position: fixed;\n  width: 320px;\n  max-height: 320px;\n  background: rgba(20,20,20,0.92);\n  color: #fff;\n  border: 1px solid rgba(255,255,255,0.12);\n  border-radius: 12px;\n  overflow: hidden;\n  z-index: 2147483647;\n  box-shadow: 0 12px 40px rgba(0,0,0,0.45);\n  backdrop-filter: blur(6px);\n}\n#ccfolia-standing-popup .ccsp-list{\n  max-height: 280px;\n  overflow: auto;\n  padding: 6px;\n}\n#ccfolia-standing-popup .ccsp-item{\n  display: grid;\n  grid-template-columns: 36px 1fr;\n  gap: 10px;\n  align-items: center;\n  padding: 7px 8px;\n  border-radius: 10px;\n  cursor: pointer;\n}\n#ccfolia-standing-popup .ccsp-item:hover{ background: rgba(255,255,255,0.08); }\n#ccfolia-standing-popup .ccsp-item.is-selected{\n  background: rgba(255,255,255,0.16);\n  outline: 1px solid rgba(255,255,255,0.18);\n}\n#ccfolia-standing-popup .ccsp-thumb{\n  width: 36px; height: 36px;\n  border-radius: 10px;\n  object-fit: cover;\n  background: rgba(255,255,255,0.06);\n}\n#ccfolia-standing-popup .ccsp-label{\n  font-size: 13px;\n  line-height: 1.15;\n  word-break: break-word;\n}\n#ccfolia-standing-preview{\n  position: fixed;\n  width: 240px; height: 240px;\n  border-radius: 14px;\n  overflow: hidden;\n  z-index: 2147483647;\n  border: 1px solid rgba(255,255,255,0.12);\n  box-shadow: 0 10px 30px rgba(0,0,0,0.45);\n  background: rgba(0,0,0,0.4);\n  pointer-events: none;\n}\n#ccfolia-standing-preview img{ width:100%; height:100%; object-fit:cover; }\n\n/* [DADA] 깜빡임 방지용 강제 숨김 */\n.ccsp-ghost {\n  opacity: 0 !important;\n  pointer-events: none !important;\n  visibility: hidden !important;\n  position: fixed !important;\n  left: -10000vw !important;\n  top: -10000vh !important;\n  z-index: -1 !important;\n}\n\nbody.ccsp-scanning div.MuiDialog-root:not(.ccsp-preserve),\nbody.ccsp-scanning div.MuiPaper-root:not(.ccsp-preserve),\nbody.ccsp-scanning div[role=\"presentation\"]:not(.ccsp-preserve) {\n  opacity: 0 !important;\n  pointer-events: none !important;\n  visibility: hidden !important;\n  transition: none !important;\n}\n\n.ccsp-hidden-dialog {\n  visibility: hidden !important;\n  pointer-events: none !important;\n}\n";

function ccfspInjectStyle() {
  document.getElementById(CCFSP_STYLE_ID)?.remove();
  const style = document.createElement('style');
  style.id = CCFSP_STYLE_ID;
  style.dataset.capybaraToolkitStyle = 'standing-picker userscript';
  style.textContent = CCFSP_STYLE;
  (document.head || document.documentElement).appendChild(style);
  ccfspRegisterTeardown(() => style.remove());
}

function ccfspRegisterTeardown(fn) {
  if (typeof fn === "function") ccfspDisposers.push(fn);
}

function ccfspWithSignal(options) {
  if (options == null) return { signal: ccfspSignal };
  if (typeof options === "boolean") return { capture: options, signal: ccfspSignal };
  if (typeof options === "object") {
    if (options.signal && options.signal !== ccfspSignal) return options;
    return { ...options, signal: ccfspSignal };
  }
  return { signal: ccfspSignal };
}

function ccfspTeardown() {
  if (!ccfspActive) return false;
  ccfspActive = false;
  try { ccfspAbort.abort(); } catch (error) { /* abort failed */ }
  while (ccfspDisposers.length) {
    const disposer = ccfspDisposers.pop();
    try { disposer(); } catch (error) { /* disposer failed */ }
  }
  try {
    closePopup();
    document.getElementById('ccfolia-standing-popup')?.remove();
    document.getElementById('ccfolia-standing-preview')?.remove();
    document.getElementById('ccfolia-standing-toast')?.remove();
    document.querySelectorAll('[data-capybara-toolkit-style*="standing-picker"]').forEach(el => el.remove());
    document.body?.classList.remove('ccsp-scanning');
    document.querySelectorAll('.ccsp-preserve').forEach(el => el.classList.remove('ccsp-preserve'));
    document.querySelectorAll('.ccsp-ghost').forEach(el => el.classList.remove('ccsp-ghost'));
  } catch (error) { /* dom sweep failed */ }
  try {
    if (window.__CCF_STANDING_PICKER_DEBUG__ && window.__CCF_STANDING_PICKER_DEBUG__.__owner === ccfspSignal) {
      delete window.__CCF_STANDING_PICKER_DEBUG__;
    }
  } catch (error) { /* debug api cleanup failed */ }
  return true;
}

ccfspInjectStyle();

window.__CCF_STANDING_PICKER_DEBUG__ = {
  __owner: ccfspSignal,
  isActive() { return ccfspActive; },
  findCharacterSelectButton() { return findCharacterSelectButton(); },
  clickCharacterSelectButton() {
    const btn = findCharacterSelectButton();
    if (!btn) return false;
    clickCharacterSelectButton(btn);
    return true;
  },
  disable() { return ccfspTeardown(); }
};

const state = {
  popupEl: null,
  previewEl: null,
  selectedIndex: 0,
  currentInputEl: null,
  currentCharacterName: null,
  lastSeenName: null,
  lastCharacterShortcutAt: 0,
  isFetching: false,
  items: [],
  standingsCacheByCharName: new Map()
};

const TRIGGER = '@';

const PANEL_TITLES_MY_CHARS = [
  "내 캐릭터 목록", "내 캐릭터 리스트", // KR
  "My character list", "My characters", "Character list", "Characters", // EN
  "マイキャラクター一覧", "自分のキャラクター一覧", // JP
  "我的角色一覽", "我的角色一览", "我的角色列表", // CN
];

const STANDING_SECTION_TITLES = [
  "스탠딩", // KR
  "Standing Image / Difference", "Standing Image", "Standing",
  "Standing image / difference", "Standing Image / difference", "Standing image / Difference", // EN
  "立ち絵・差分", "立絵・差分", // JP
  "立繪、差分", "立绘、差분", "立繪，差分", "立绘，差分", // CN
];

const I18N_MAP = {
  ko: {
    no_char: "선택된 캐릭터가 없습니다.",
    panel_not_found: "캐릭터 목록 패널을 확인해주세요.",
    not_in_list: "캐릭터 목록에 '{name}'이 없습니다.",
    row_not_found: "캐릭터 영역을 찾지 못했습니다.",
    load_failed: "스탠딩 목록을 불러올 수 없습니다."
  },
  ja: {
    no_char: "キャラクターが選択されていません。",
    panel_not_found: "キャラクター一覧パネルを確認してください。",
    not_in_list: "キャラクター一覧에 '{name}' が見つかりません。",
    row_not_found: "キャラクターの行が見つかりません。",
    load_failed: "立ち絵一覧を読み込めませんでした。"
  },
  en: {
    no_char: "No character selected.",
    panel_not_found: "Please check the character list panel.",
    not_in_list: "'{name}' not found in the list.",
    row_not_found: "Character row not found.",
    load_failed: "Failed to load standings."
  },
  zhTw: {
    no_char: "未選擇角色。",
    panel_not_found: "請檢查角色列表面板。",
    not_in_list: "角色列表中找不到 '{name}'。",
    row_not_found: "找不到角色區域。",
    load_failed: "無法讀取立繪列表。"
  }
};

function getLanguage() {
  const lng = localStorage.getItem('i18nextLng') || 'ko';
  if (lng.startsWith('ja')) return 'ja';
  if (lng.startsWith('en')) return 'en';
  if (lng.startsWith('zh')) return 'zhTw';
  return 'ko';
}

function getText(key, params = {}) {
  const lang = getLanguage();
  let msg = I18N_MAP[lang][key] || I18N_MAP['ko'][key];
  Object.keys(params).forEach(p => {
    msg = msg.replace(`{${p}}`, params[p]);
  });
  return msg;
}

const delayTimer = (ms) => new Promise(r => setTimeout(r, ms));
const removeSpaces = (s) => (s || '').replace(/\s+/g,' ').trim();

function getInputValue(el) {
  return el?.isContentEditable ? (el.textContent || '') : (el?.value ?? '');
}

function setInputValue(el, v) {
  if (!el) return;
  if (el.isContentEditable) el.textContent = v;
  else el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function showToast(msg) {
  const id = 'ccfolia-standing-toast';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = `
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      background: rgba(0,0,0,0.82); color:#fff; padding:8px 10px; border-radius:10px;
      font-size:12px; z-index:2147483647; max-width:80vw; white-space:pre-wrap;
    `;
    document.documentElement.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 1000);
}

function isTypingAt(el) {
  if (!el) return false;
  const v = getInputValue(el);
  if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
    const start = el.selectionStart;
    const before = v.slice(0, start);
    return /(^|[\s\n])@([^\s\n@]*)$/.test(before);
  }
  return /(^|[\s\n])@([^\s\n@]*)$/.test(v);
}

function getChatInput() {
  const active = document.activeElement;
  if (isChatInput(active)) return active;
  return Array.from(document.querySelectorAll('textarea[name="text"], textarea, [contenteditable="true"], [role="textbox"]'))
    .find(isChatInput) || null;
}

function isChatInput(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.closest?.('[role="dialog"], .MuiDialog-root, .MuiPopover-root, #ccfolia-standing-popup')) return false;
  if (el.matches?.('textarea[name="text"]')) return true;
  const text = [
    el.getAttribute?.('name') || '',
    el.getAttribute?.('aria-label') || '',
    el.getAttribute?.('placeholder') || '',
    el.getAttribute?.('title') || ''
  ].join(' ');
  if (/message|chat|comment|send|input|textbox|메시지|채팅|입력|발언/i.test(text)) return true;
  if (el.closest?.('.MuiDrawer-paper')) return true;
  const form = el.closest?.('form');
  return !!form?.querySelector?.('button[type="submit"]');
}

function getDialog() {
  const h6s = Array.from(document.querySelectorAll('h6'));
  const target = h6s.find(h => STANDING_SECTION_TITLES.includes(removeSpaces(h.textContent)));
  if (!target) return null;
  return target.closest('form') || target.closest('[role="dialog"]') || target.closest('div.MuiPaper-root') || null;
}

function getCharPanel() {
  const titles = new Set(PANEL_TITLES_MY_CHARS.map(removeSpaces));
  const h6s = Array.from(document.querySelectorAll('h6'));
  const titleEl = h6s.find(h => titles.has(removeSpaces(h.textContent)));
  if (!titleEl) return null;
  return titleEl.closest('div.MuiPaper-root.MuiPaper-elevation6') || titleEl.closest('div.MuiPaper-root') || null;
}

function getNameInput() {
  const inputs = Array.from(document.querySelectorAll('input[name="name"]'));
  if (!inputs.length) return null;
  const visible = inputs.find(i => i.offsetParent !== null && !i.disabled);
  if (visible) return visible;
  const dialog = getDialog();
  if (dialog) {
    const inDialog = dialog.querySelector('input[name="name"]');
    if (inDialog) return inDialog;
  }
  return inputs[0];
}

function setCurrentChar() {
  const inp = getNameInput();
  const v = removeSpaces(inp?.value || '');
  if (!v) return;
  if (v !== state.lastSeenName) {
    state.lastSeenName = v;
    state.currentCharacterName = v;
  }
}

function guessCharName() {
  if (state.currentCharacterName) return state.currentCharacterName;

  const labelRe = /(캐릭터|character|キャラクター|角色)/i;
  const btns = Array.from(document.querySelectorAll('button,[role="button"]'))
    .filter(b => labelRe.test(b.getAttribute('aria-label') || ''));

  btns.sort((a, b) => ((a.getAttribute('aria-label') || '').length) - ((b.getAttribute('aria-label') || '').length));

  const textRe = /(캐릭터|character|キャラクター|角色|選擇|选择|選択|selection|select)/i;
  for (const b of btns.slice(0, 10)) {
    const t = removeSpaces(b.textContent);
    if (t && t.length <= 40 && !textRe.test(t)) return t;
  }
  return null;
}

function getDialogWrap(dialogRoot) {
  return dialogRoot?.closest('[role="presentation"]') || dialogRoot?.closest('[role="dialog"]') || dialogRoot;
}

function hideDialog(container) {
  if (!container) return () => {};
  container.classList.add('ccsp-hidden-dialog');
  return () => { container.classList.remove('ccsp-hidden-dialog'); };
}

function closePanel(panelRoot) {
  if (!panelRoot) return;
  const closeBtn = panelRoot.querySelector('button svg[data-testid="CloseIcon"]')?.closest('button');
  if (closeBtn) closeBtn.click();
}

function closeByBackdrop(container) {
  const backdrop = container?.querySelector?.('.MuiBackdrop-root') || container?.querySelector?.('[class*="Backdrop"]') || null;
  if (backdrop) {
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    backdrop.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }
  return false;
}

function closeDialog(dialogRoot, closeBtn) {
  const container = getDialogWrap(dialogRoot);
  if (closeBtn) { try { closeBtn.click(); return; } catch {} }
  const btn = container?.querySelector?.('button svg[data-testid="CloseIcon"]')?.closest('button') || null;
  if (btn) { try { btn.click(); return; } catch {} }
  if (closeByBackdrop(container)) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

async function showHiddenPanel() {
  let panel = getCharPanel();
  if (panel) {
    return { panel, restoreVisibility: () => {}, openedByUs: false };
  }

  const re = /(내\s*캐릭터|캐릭터\s*목록|My\s*characters|My\s*character|Character\s*list|自分のキャラクター|キャラクター一覧|マイキャラクター|我的角色)/i;
  const candidates = Array.from(document.querySelectorAll('button,[role="button"]'))
    .map(el => ({ el, s: (el.getAttribute('aria-label')||'') + ' ' + (el.getAttribute('title')||'') + ' ' + removeSpaces(el.textContent) }))
    .filter(o => re.test(o.s))
    .map(o => o.el);

  for (const el of candidates.slice(0, 5)) {
    try { el.click(); } catch {}
    for (let i=0; i<15; i++) {
      await delayTimer(20);
      panel = getCharPanel();
      if (panel) {
        const container = panel.closest('[role="presentation"]') || panel;
        return { panel, restoreVisibility: hideDialog(container), openedByUs: true };
      }
    }
  }
  showToast(getText('panel_not_found'));
  return { panel: null, restoreVisibility: () => {}, openedByUs: false };
}

function getStandingData(dialogRoot) {
  const inputs = Array.from(dialogRoot.querySelectorAll('input[name^="faces."][name$=".label"]'));
  const items = [];

  for (const inp of inputs) {
    const label = removeSpaces(inp.value || '');
    if (!label) continue;

    let img = '';
    let container = inp.parentElement;
    for (let i = 0; i < 5; i++) {
        if (!container || container === dialogRoot) break;

        const imgEl = container.querySelector('img.MuiAvatar-img') ||
                      container.querySelector('button img') ||
                      container.querySelector('img');

        if (imgEl) {
            const src = imgEl.getAttribute('src');
            // svg, xml이 아닌 이미지 선택 (단순 아이콘 제외)
            if (src && src.length > 0 && !src.startsWith('data:image/svg+xml')) {
                img = src;
                break;
            }
        }

        const style = window.getComputedStyle(container);
        const bg = style.backgroundImage;
        if (bg && bg !== 'none' && bg.startsWith('url(')) {
            img = bg.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
            break;
        }

        container = container.parentElement;
    }

    items.push({ label, img });
  }

  const seen = new Set();
  return items.filter(it => (seen.has(it.label) ? false : (seen.add(it.label), true)));
}

const isloadPopupData = (conditionFunction, timeoutMs = 1000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkCondition = () => {
      const result = conditionFunction();
      if (result) return resolve(result);
      if (Date.now() - startTime > timeoutMs) return resolve(null);
      requestAnimationFrame(checkCondition);
    };
    checkCondition();
  });
};

async function getStandings() {
  setCurrentChar();
  const name = state.currentCharacterName || guessCharName();

  if (!name) {
    showToast(getText('no_char'));
    return { name: null, standings: [] };
  }

  state.currentCharacterName = name;

  document.querySelectorAll('.MuiPaper-root, .MuiDialog-root, [role="presentation"]').forEach(el => {
    el.classList.add('ccsp-preserve');
  });

  document.body.classList.add('ccsp-scanning');

  const domObserver = new MutationObserver((mutations) => {
    if (!ccfspActive) return;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.parentNode === document.body) {
          if (!node.id?.startsWith('ccfolia-standing-')) {
            node.classList.add('ccsp-ghost');
          }
        }
      });
    });
  });
  domObserver.observe(document.body, { childList: true });
  ccfspRegisterTeardown(() => domObserver.disconnect());

  try {
    let dialogRoot = getDialog();
    let panelOpenedByUs = false;
    let dialogOpenedByUs = false;
    let myPanel = null;

    if (!dialogRoot) {
      dialogOpenedByUs = true;
      const res = await showHiddenPanel();
      if (!res.panel) return { name, standings: [] };

      myPanel = res.panel;
      panelOpenedByUs = res.openedByUs;

      const spans = Array.from(myPanel.querySelectorAll('span.MuiListItemText-primary'));
      const targetSpan = spans.find(s => removeSpaces(s.textContent) === removeSpaces(name));

      if (!targetSpan) {
        if (panelOpenedByUs) closePanel(myPanel);
        showToast(getText('not_in_list', { name }));
        return { name, standings: [] };
      }

      const rowBtn = targetSpan.closest('div[role="button"]') || targetSpan.closest('li')?.querySelector('div[role="button"]');
      rowBtn.click();

      dialogRoot = await isloadPopupData(() => getDialog());
    }

    if (!dialogRoot) {
      if (panelOpenedByUs && myPanel) closePanel(myPanel);
      return { name, standings: [] };
    }

    const container = getDialogWrap(dialogRoot);
    const closeBtn = container?.querySelector?.('button svg[data-testid="CloseIcon"]')?.closest('button') || null;

    let standings = [];
    standings = await isloadPopupData(() => {
      const currentNameInDialog = removeSpaces(getNameInput()?.value || '');
      if (currentNameInDialog !== removeSpaces(name)) return null;

      const extracted = getStandingData(dialogRoot);
      return extracted.length > 0 ? extracted : null;
    }, 1200);

    if (dialogOpenedByUs) closeDialog(dialogRoot, closeBtn);
    if (panelOpenedByUs && myPanel) closePanel(myPanel);

    if (standings && standings.length > 0) {
      state.standingsCacheByCharName.set(state.currentCharacterName, standings);
      return { name: state.currentCharacterName, standings };
    } else {
      showToast(getText('load_failed'));
      return { name: state.currentCharacterName, standings: [] };
    }
  } finally {
    domObserver.disconnect();
    await delayTimer(30);
    document.body.classList.remove('ccsp-scanning');

    document.querySelectorAll('.ccsp-ghost, .ccsp-preserve').forEach(el => {
      el.classList.remove('ccsp-ghost', 'ccsp-preserve');
    });

    if (state.currentInputEl && document.activeElement !== state.currentInputEl) {
      state.currentInputEl.focus();
    }
  }
}

/* UI */
function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function closePopup() {
  state.popupEl?.remove();
  state.previewEl?.remove();
  state.popupEl = null;
  state.previewEl = null;
  state.selectedIndex = 0;
  state.items = [];
}

function setPopupPosition(el) {
  if (!state.popupEl || !el) return;
  const rect = el.getBoundingClientRect();
  state.popupEl.style.left = `${Math.max(8, rect.left)}px`;
  state.popupEl.style.top = `${Math.max(8, rect.top - state.popupEl.offsetHeight - 8)}px`;

  const pr = state.popupEl.getBoundingClientRect();
  if (pr.top < 0) state.popupEl.style.top = `${Math.min(window.innerHeight - pr.height - 8, rect.bottom + 8)}px`;
  setPreviewPosition();
}

function setPreviewPosition() {
  if (!state.popupEl || !state.previewEl || state.previewEl.style.display === 'none') return;
  const popupRect = state.popupEl.getBoundingClientRect();
  const width = state.previewEl.getBoundingClientRect().width || 240;
  const left = Math.min(window.innerWidth - width - 8, popupRect.right + 10);
  const top = Math.max(8, Math.min(window.innerHeight - 250, popupRect.top));
  state.previewEl.style.left = `${left}px`;
  state.previewEl.style.top = `${top}px`;
}

function showPreview(item) {
  if (!state.previewEl) return;
  if (!item?.img) { state.previewEl.style.display = 'none'; return; }
  state.previewEl.innerHTML = `<img src="${item.img}" alt="">`;
  state.previewEl.style.display = 'block';
  setPreviewPosition();
}

function setHighlight(idx, doScroll) {
  if (!state.popupEl || !state.items.length) return;
  state.selectedIndex = Math.max(0, Math.min(state.items.length - 1, idx));

  const rows = Array.from(state.popupEl.querySelectorAll('.ccsp-item'));
  rows.forEach((row, i) => row.classList.toggle('is-selected', i === state.selectedIndex));

  if (doScroll) rows[state.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  showPreview(state.items[state.selectedIndex]);
}

function showPopup(items) {
  closePopup();
  state.items = items;
  state.popupEl = document.createElement('div');
  state.popupEl.id = 'ccfolia-standing-popup';
  state.popupEl.innerHTML = `<div class="ccsp-list" role="listbox"></div>`;
  document.documentElement.appendChild(state.popupEl);

  state.previewEl = document.createElement('div');
  state.previewEl.id = 'ccfolia-standing-preview';
  state.previewEl.style.display = 'none';
  document.documentElement.appendChild(state.previewEl);

  const list = state.popupEl.querySelector('.ccsp-list');
  items.forEach((it, idx) => {
    const row = document.createElement('div');
    row.className = 'ccsp-item';
    row.setAttribute('role', 'option');
    row.innerHTML = `
      <img class="ccsp-thumb" src="${it.img || ''}" alt="">
      <div class="ccsp-label">${escapeHtml(it.label)}</div>
    `;
    row.addEventListener('mouseenter', () => setHighlight(idx, true));
    row.addEventListener('mousemove', (e) => {
      if (!it.img) return;
      state.previewEl.innerHTML = `<img src="${it.img}" alt="">`;
      state.previewEl.style.display = 'block';
      const w = 240, h = 240;
      state.previewEl.style.left = `${Math.min(window.innerWidth - w - 8, e.clientX + 12)}px`;
      state.previewEl.style.top = `${Math.min(window.innerHeight - h - 8, e.clientY + 12)}px`;
    });
    row.addEventListener('mouseleave', () => showPreview(state.items[state.selectedIndex]));
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => insertLabel(items[idx]));
    list.appendChild(row);
  });

  setHighlight(0, false);
  setPopupPosition(state.currentInputEl);
}

function replaceLabel(label) {
  const el = state.currentInputEl;
  if (!el) return;
  const v = getInputValue(el);
  if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = v.slice(0, start);
    const after = v.slice(end);
    const matchData = before.match(/(^|[\s\n])@([^\s\n@]*)$/);
    if (matchData) {
      const tokenStart = before.length - matchData[0].length + matchData[1].length;
      const newBefore = before.slice(0, tokenStart) + label;
      const newVal = newBefore + after;
      setInputValue(el, newVal);
      const newPos = newBefore.length;
      el.setSelectionRange?.(newPos, newPos);
      el.focus();
      return;
    }
  }
  setInputValue(el, v + label);
  el.focus();
}

function insertLabel(item) {
  if (!item?.label) return;
  replaceLabel(item.label);
  closePopup();
}


function isVisibleButton(btn) {
  if (!btn || btn.nodeType !== 1) return false;
  if (btn.disabled) return false;
  const rect = btn.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getButtonSearchText(btn) {
  const iconNames = Array.from(btn.querySelectorAll('svg[data-testid]'))
    .map(svg => svg.getAttribute('data-testid') || '')
    .join(' ');
  return [
    btn.getAttribute('aria-label') || '',
    btn.getAttribute('title') || '',
    removeSpaces(btn.textContent || ''),
    iconNames
  ].join(' ');
}

function queryCharacterSelectButton() {
  const selectors = [
    'button[aria-label="캐릭터 선택"]',
    'button[aria-label="Character selection"]',
    'button[aria-label="Select character"]',
    'button[aria-label="キャラクター選択"]',
    'button[aria-label="キャラクター 選択"]'
  ];
  const matches = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
  return matches.find(isVisibleButton) || matches.find((btn) => btn?.tagName === 'BUTTON' && !btn.disabled) || null;
}

function findCharacterSelectButton() {
  const direct = queryCharacterSelectButton();
  if (direct) return direct;

  const exactLabelRe = /^(?:캐릭터\s*선택|character\s*selection|select\s*character|キャラクター\s*選択|角色\s*(?:选择|選擇))$/i;
  const selectRe = /(?:선택|select|selection|選択|選擇|选择)/i;
  const characterRe = /(?:캐릭터|character|chara|キャラクター|角色)/i;
  const listRe = /(?:목록|리스트|list|一覧|一览|列表)/i;
  const characterIconRe = /(?:Face|Person|AccountCircle|PermIdentity|Badge|Groups?)Icon/i;
  const buttons = Array.from(document.querySelectorAll('button')).filter(isVisibleButton);

  for (const btn of buttons) {
    const label = removeSpaces(btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
    if (exactLabelRe.test(label) && !listRe.test(label)) return btn;
  }

  for (const btn of buttons) {
    const text = getButtonSearchText(btn);
    if (!listRe.test(text) && characterRe.test(text) && selectRe.test(text)) return btn;
  }

  for (const btn of buttons) {
    const text = getButtonSearchText(btn);
    if (!listRe.test(text) && selectRe.test(text) && characterIconRe.test(text)) return btn;
  }

  for (const btn of buttons) {
    const text = getButtonSearchText(btn);
    if (!listRe.test(text) && characterIconRe.test(text) && !btn.classList.contains('MuiIconButton-root')) return btn;
  }

  return null;
}

function isBackquoteShortcut(event) {
  // Shift+` 는 ~ 입력이므로 단축키로 가로채지 않는다.
  // 수식키는 이벤트가 직접 알려주는 값만 신뢰 (수동 추적은 keyup 을 놓치면 고착됨).
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.shiftKey || event.getModifierState?.('Shift')) return false;
  return event.code === 'Backquote' ||
    event.key === '`' ||
    event.key === '₩' ||
    event.key === '｀' ||
    event.keyCode === 192 ||
    event.which === 192;
}

function clickCharacterSelectButton(btn) {
  if (!btn || btn.nodeType !== 1) return;
  try { btn.focus({ preventScroll: true }); } catch {}
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      const EventCtor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      btn.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type.endsWith('down') ? 1 : 0 }));
    } catch {}
  }
  try { btn.click(); } catch {}
}

function isEditableElement(el) {
  return !!el && el.nodeType === 1 &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute?.('role') === 'textbox');
}

function canUseCharacterShortcutFrom(el) {
  if (!el || el === document.body || el === document.documentElement) return true;
  if (isChatInput(el)) return true;
  return !isEditableElement(el);
}

function consumeShortcutEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function runCharacterShortcut(event) {
  if (!isBackquoteShortcut(event)) return false;
  if (!canUseCharacterShortcutFrom(document.activeElement)) return false;

  consumeShortcutEvent(event);
  if (event.repeat) return true;

  const now = Date.now();
  if (now - state.lastCharacterShortcutAt < 160) return true;

  const btn = findCharacterSelectButton();
  if (btn) {
    state.lastCharacterShortcutAt = now;
    clickCharacterSelectButton(btn);
    // 이 순간부터만 방향키를 가져간다 (매크로 자동완성 등과 충돌 방지).
    nativePick.armed = true;
  }
  return true;
}

async function handleKeydown(event) {
  if (!ccfspActive) return;
  if (runCharacterShortcut(event)) return;
  if (handleNativeCharacterPickerKey(event)) return;
  if (event.isComposing) return;

  if (state.popupEl) {
    if (event.key === 'Escape') { closePopup(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight(state.selectedIndex + 1, true); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight(state.selectedIndex - 1, true); return; }
    if (event.key === 'Enter') {
      if (state.items[state.selectedIndex]) {
        event.preventDefault();
        insertLabel(state.items[state.selectedIndex]);
      }
      return;
    }
  }

  if (event.key !== TRIGGER) return;
  if (state.isFetching) return;

  const msgEl = getChatInput();
  if (!msgEl || document.activeElement !== msgEl) return;

  state.currentInputEl = msgEl;
  state.isFetching = true;

  try {
    await delayTimer(0);
    const { standings } = await getStandings();
    if (!ccfspActive) return;
    if (standings?.length) {
      showPopup(standings);
    }
  } finally {
    state.isFetching = false;
  }
}

function handleKeyup(event) {
  if (!ccfspActive) return;
  runCharacterShortcut(event);
}

function handleInput(event) {
  if (!state.popupEl) return;
  if (!state.currentInputEl) return;
  if (!isChatInput(event.target) || event.target !== state.currentInputEl) return;
  if (!isTypingAt(state.currentInputEl)) closePopup();
}

function handleClick() {
  if (state.popupEl && state.currentInputEl && !isTypingAt(state.currentInputEl)) {
    closePopup();
  }
}

function handleResize() {
  setPopupPosition(state.currentInputEl);
}

function initEvents() {
  document.addEventListener('input', handleInput, ccfspWithSignal(true));
  document.addEventListener('keydown', handleKeydown, ccfspWithSignal(true));
  document.addEventListener('keyup', handleKeyup, ccfspWithSignal(true));
  document.addEventListener('click', handleClick, ccfspWithSignal(true));
  window.addEventListener('keydown', handleKeydown, ccfspWithSignal(true));
  window.addEventListener('keyup', handleKeyup, ccfspWithSignal(true));
  window.addEventListener('resize', handleResize, ccfspWithSignal());
  window.addEventListener('scroll', handleResize, ccfspWithSignal(true));
}


(function runWatcherLoop() {
  const handle = setInterval(() => {
    if (!ccfspActive) return;
    setCurrentChar();
    if (!state.currentCharacterName) {
      state.currentCharacterName = guessCharName() || null;
    }
  }, 250);
  ccfspRegisterTeardown(() => clearInterval(handle));
})();



/* ===== 네이티브 캐릭터 선택창 키보드 조작 ===== */
// armed: ` 로 캐릭터 선택창을 연 경우에만 방향키를 가져간다.
// 이 표시가 없으면 채팅 매크로 자동완성처럼 코코포리아가 직접 방향키로 다루는 목록까지
// 가로채서, 매크로를 키보드로 고를 수 없게 된다.
const nativePick = { items: [], index: -1, armed: false };
const ccfspVisible = (el) => {
  if (!el || el.nodeType !== 1) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const ccfspIsChatLog = (el) =>
  !!el && (el.getAttribute?.('role') === 'log' || !!el.closest?.('[role="log"]'));
function ccfspPickerItems(list) {
  return Array.from(list.children).filter((item) => {
    if (!ccfspVisible(item)) return false;
    if (item.querySelector('.MuiListItemSecondaryAction-root')) return false;
    const t = removeSpaces(
      item.querySelector('.MuiListItemText-primary')?.textContent ||
      item.getAttribute('aria-label') || item.textContent || '');
    if (!t) return false;
    return !!item.querySelector('img, .MuiAvatar-root') ||
      item.matches('[role="option"], [role="menuitem"]');
  });
}
// 채팅 입력창의 매크로 자동완성(downshift) 목록은 코코포리아가 방향키로 직접 다룬다.
// 캐릭터 선택창으로 오인해 가로채면 매크로를 키보드로 고를 수 없게 되므로 후보에서 제외.
function ccfspIsAutocompleteList(el) {
  if (!el) return false;
  if (/^downshift/i.test(el.id || '')) return true;
  if (el.closest?.('[role="combobox"]')) return true;
  if (!el.id || typeof CSS === 'undefined' || !CSS.escape) return false;
  const id = CSS.escape(el.id);
  const owner = document.querySelector(`[aria-controls="${id}"], [aria-owns="${id}"]`);
  if (!owner) return false;
  return owner.tagName === 'TEXTAREA' || owner.tagName === 'INPUT' ||
    owner.getAttribute('role') === 'combobox';
}
function ccfspFindPicker() {
  const lists = Array.from(document.querySelectorAll('ul.MuiList-root, [role="listbox"], [role="menu"]'))
    .filter(ccfspVisible)
    .filter((l) => !ccfspIsChatLog(l))
    .filter((l) => !ccfspIsAutocompleteList(l))
    .map((list) => ({ list, items: ccfspPickerItems(list) }))
    .filter((c) => c.items.length);
  lists.sort((a, b) => b.items.length - a.items.length);
  return lists[0] || null;
}
function ccfspClearPick() {
  nativePick.items.forEach((i) => i.removeAttribute('data-ccfsp-nav'));
  nativePick.items = []; nativePick.index = -1; nativePick.armed = false;
}
function ccfspHighlight(idx) {
  const items = nativePick.items;
  if (!items.length) return;
  items.forEach((i) => i.removeAttribute('data-ccfsp-nav'));
  const max = items.length - 1;
  nativePick.index = idx < 0 ? max : (idx > max ? 0 : idx);
  const item = items[nativePick.index];
  item.setAttribute('data-ccfsp-nav', '1');
  const f = item.matches('button, [role="option"], [role="menuitem"]')
    ? item : item.querySelector('button, [role="button"], [role="option"], [role="menuitem"]') || item;
  try { f.focus({ preventScroll: true }); } catch {}
  try { item.scrollIntoView({ block: 'nearest' }); } catch {}
}
function ccfspActivate(item) {
  if (!item) return;
  const t = item.matches('button, [role="option"], [role="menuitem"]')
    ? item : item.querySelector('button, [role="button"], [role="option"], [role="menuitem"]') || item;
  for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
    try {
      const C = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      t.dispatchEvent(new C(type, { bubbles: true, cancelable: true, view: window,
        pointerId: 1, pointerType: 'mouse', button: 0, buttons: type.endsWith('down') ? 1 : 0 }));
    } catch {}
  }
  try { t.click(); } catch {}
  ccfspClearPick();
  ccfspFocusChatInput();
}

// 캐릭터를 고른 뒤 바로 타이핑할 수 있도록 입력칸으로 커서를 옮긴다.
// 코코포리아가 선택 직후 포커스를 자기 쪽으로 되돌리므로 한 번만 시도하면 놓친다
// → 몇 시점에 나눠 시도하고, 이미 입력칸에 있으면 건드리지 않는다.
function ccfspFocusChatInput() {
  [0, 60, 150, 320, 600].forEach((delay) => {
    setTimeout(() => {
      if (!ccfspActive) return;
      const input = getChatInput();
      if (!input || document.activeElement === input) return;
      // 선택창이 아직 떠 있으면 기다린다 (그 위에서 포커스를 뺏으면 선택이 취소될 수 있다).
      if (ccfspFindPicker()) return;
      try {
        input.focus({ preventScroll: true });
        if (typeof input.selectionStart === 'number') {
          const end = input.value ? input.value.length : 0;
          input.setSelectionRange(end, end);
        }
      } catch {}
    }, delay);
  });
}
function handleNativeCharacterPickerKey(event) {
  if (state.popupEl) return false;
  if (event.key === 'Escape') { ccfspClearPick(); return false; }
  // ` 로 캐릭터 선택창을 연 상태가 아니면 방향키/Enter 에 손대지 않는다.
  // (채팅 매크로 자동완성은 코코포리아가 직접 방향키로 다룬다)
  if (!nativePick.armed) return false;
  if (!['ArrowDown','ArrowUp','Enter'].includes(event.key)) return false;
  const found = ccfspFindPicker();
  if (!found) { ccfspClearPick(); return false; }
  nativePick.items = found.items;
  if (nativePick.index >= found.items.length) nativePick.index = -1;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
  if (event.key === 'ArrowDown') { ccfspHighlight(nativePick.index < 0 ? 0 : nativePick.index + 1); return true; }
  if (event.key === 'ArrowUp')   { ccfspHighlight(nativePick.index < 0 ? found.items.length - 1 : nativePick.index - 1); return true; }
  ccfspActivate(found.items[nativePick.index < 0 ? 0 : nativePick.index]);
  return true;
}
(function () {
  const s = document.createElement('style');
  s.dataset.capybaraToolkitStyle = 'standing-picker nav';
  s.textContent = '[data-ccfsp-nav="1"]{background:rgba(233,30,99,.18)!important;' +
    'outline:1px solid rgba(233,30,99,.92)!important;outline-offset:-1px!important;}';
  (document.head || document.documentElement).appendChild(s);
  ccfspRegisterTeardown(() => s.remove());
})();



initEvents();

})();
