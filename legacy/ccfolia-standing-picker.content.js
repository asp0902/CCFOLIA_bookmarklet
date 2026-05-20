let ccfspActive = true;
const ccfspDisposers = [];
const ccfspAbort = new AbortController();
const ccfspSignal = ccfspAbort.signal;

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
    document.querySelectorAll('link[data-capybara-toolkit-style*="standing-picker"]').forEach(el => el.remove());
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

window.__CCF_STANDING_PICKER_DEBUG__ = {
  __owner: ccfspSignal,
  isActive() { return ccfspActive; },
  disable() { return ccfspTeardown(); }
};

const state = {
  popupEl: null,
  previewEl: null,
  selectedIndex: 0,
  currentInputEl: null,
  currentCharacterName: null,
  lastSeenName: null,
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
  return document.querySelector('textarea[name="text"]');
}

function isChatInput(el) {
  const msgEl = getChatInput();
  return !!msgEl && el === msgEl;
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


async function handleKeydown(event) {
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
    if (standings?.length) {
      showPopup(standings);
    }
  } finally {
    state.isFetching = false;
  }
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
  document.addEventListener('click', handleClick, ccfspWithSignal(true));
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

initEvents();
