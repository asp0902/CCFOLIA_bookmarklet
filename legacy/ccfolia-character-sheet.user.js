// ==UserScript==
// @name         CCFOLIA Saikoro Fiction Character Sheet by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-character-sheet
// @version      0.5.5
// @description  Detect inSANe rooms and add room-local character sheets with BCDice commands.
// @description:ko 사이코로픽션 룸을 감지해 룸별 캐릭터 시트와 BCDice 판정 입력 기능을 추가합니다. 현재 인세인을 지원합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const FEATURE_ID = "ccf-character-sheet";
  const DEBUG_KEY = "__CCF_CHARACTER_SHEET_DEBUG__";
  const ROOT_ID = "ccf-character-sheet-root";
  const STYLE_ID = "ccf-character-sheet-style";
  const ICON_ATTR = "data-ccf-character-sheet-icon";
  const DIALOG_BUTTON_ATTR = "data-ccf-character-sheet-dialog-button";
  const VERSION = "0.5.5";
  const TRANSFER_KIND = "capybara.insane-sheet";
  const TRANSFER_VERSION = 1;
  const MAX_TRANSFER_BYTES = 500_000;
  const CATEGORIES = Object.freeze([
    ["폭력", "소각", "고문", "포박", "협박", "파괴", "구타", "절단", "찌르기", "사격", "전쟁", "매장"],
    ["정서", "연심", "기쁨", "걱정", "부끄러움", "웃음", "인내", "놀람", "노여움", "원한", "슬픔", "친애"],
    ["지각", "고통", "관능", "촉감", "냄새", "맛", "소리", "풍경", "추적", "예술", "제육감", "그늘"],
    ["기술", "분해", "전자기기", "정리", "약품", "효율", "미디어", "카메라", "탈것", "기계", "함정", "병기"],
    ["지식", "물리학", "수학", "화학", "생물학", "의학", "교양", "인류학", "역사", "민속학", "고고학", "천문학"],
    ["괴이", "시간", "혼돈", "심해", "죽음", "영혼", "마술", "암흑", "종말", "꿈", "지저", "우주"]
  ]);
  const TABLE_COMMANDS = Object.freeze([
    ["장면표", "ST"], ["공포표", "FT"], ["직업표", "JT"], ["관계표", "RCT"], ["랜덤 특기", "RTT"]
  ]);

  function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isInsaneDicebot(texts = [], hrefs = []) {
    const names = new Set(["인세인", "インセイン", "insane"]);
    if (texts.some((text) => names.has(normalizedText(text)))) return true;
    return hrefs.some((href) => {
      try {
        return /(?:^|\/)insane(?:\/|$)/i.test(new URL(href, location.href).pathname);
      } catch (error) {
        return /(?:^|\/)insane(?:[/?#]|$)/i.test(String(href || ""));
      }
    });
  }

  function getSkillTarget(acquired, targetId, removedGaps = []) {
    const [targetColumn, targetRow] = String(targetId).split(":").map(Number);
    const known = Array.isArray(acquired) ? acquired : [];
    let distance = Infinity;
    for (const id of known) {
      const [column, row] = String(id).split(":").map(Number);
      if (![column, row, targetColumn, targetRow].every(Number.isInteger)) continue;
      let next = Math.abs(row - targetRow) + Math.abs(column - targetColumn);
      for (let gap = Math.min(column, targetColumn); gap < Math.max(column, targetColumn); gap += 1) {
        if (!removedGaps[gap]) next += 1;
      }
      distance = Math.min(distance, next);
    }
    return Number.isFinite(distance) ? 5 + distance : null;
  }

  function getCuriosityGaps(value) {
    const gaps = [false, false, false, false, false];
    if (value === "" || value == null) return gaps;
    const column = Number(value);
    if (!Number.isInteger(column) || column < 0 || column > 5) return gaps;
    if (column > 0) gaps[column - 1] = true;
    if (column < 5) gaps[column] = true;
    return gaps;
  }

  function clampDialogDrag(rect, deltaX, deltaY, viewportWidth, viewportHeight, margin = 8) {
    return {
      x: Math.min(Math.max(deltaX, margin - rect.left), viewportWidth - margin - rect.right),
      y: Math.min(Math.max(deltaY, margin - rect.top), viewportHeight - margin - rect.bottom)
    };
  }

  function isCharacterEditTitle(value) {
    const text = normalizedText(value);
    return ["캐릭터 편집", "キャラクター編集", "edit character", "character edit", "编辑角色"].some((label) => text.includes(label));
  }

  function nativeStatusPatch(rows = []) {
    const patch = {};
    const fields = { 생명력: ["life", "lifeMax"], 이성치: ["sanity", "sanityMax"] };
    for (const row of rows) {
      const keys = fields[String(row?.label || "").trim()];
      if (!keys) continue;
      patch[keys[0]] = nonNegativeNumber(row.value);
      patch[keys[1]] = nonNegativeNumber(row.max);
    }
    return patch;
  }

  function normalizePermissions(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, flags]) => {
      const name = cleanText(key, 100).trim();
      if (!name || !flags || typeof flags !== "object") return [];
      const permission = { view: !!flags.view, secret: !!flags.secret, edit: !!flags.edit };
      return permission.view || permission.secret || permission.edit ? [[name, permission]] : [];
    }));
  }

  function validSkillId(id) {
    return /^([0-5]):(10|[0-9])$/.test(String(id));
  }

  function cleanText(value, maxLength = 20_000) {
    return typeof value === "string" ? value.slice(0, maxLength) : String(value ?? "").slice(0, maxLength);
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegativeNumber(value, fallback = 0) {
    return Math.max(0, finiteNumber(value, fallback));
  }

  function copyJsonObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeItems(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(0, 100).flatMap(([key, raw]) => {
      const label = cleanText(key, 100).trim();
      if (!label || raw === "" || raw == null || !Number.isFinite(Number(raw))) return [];
      return [[label, nonNegativeNumber(raw)]];
    }));
  }

  function normalizeTransferSheet(raw, idFactory = makeId) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("시트 데이터가 없습니다.");
    const curiosityNumber = Number(raw.curiosity);
    const curiosity = Number.isInteger(curiosityNumber) && curiosityNumber >= 0 && curiosityNumber < 6 ? curiosityNumber : "";
    const defaultGaps = getCuriosityGaps(curiosity);
    const sheet = makeSheet(cleanText(raw.name || "가져온 시트", 200), idFactory);
    return {
      ...copyJsonObject(raw),
      ...sheet,
      name: cleanText(raw.name || "가져온 시트", 200),
      player: cleanText(raw.player, 200),
      age: cleanText(raw.age, 100),
      gender: cleanText(raw.gender, 100),
      occupation: cleanText(raw.occupation, 300),
      life: nonNegativeNumber(raw.life, 6),
      lifeMax: nonNegativeNumber(raw.lifeMax, 6),
      sanity: nonNegativeNumber(raw.sanity, 6),
      sanityMax: nonNegativeNumber(raw.sanityMax, 6),
      merit: nonNegativeNumber(raw.merit),
      curiosity,
      removedGaps: Array.from({ length: 5 }, (_, index) => Array.isArray(raw.removedGaps) ? !!raw.removedGaps[index] : defaultGaps[index]),
      skills: [...new Set((Array.isArray(raw.skills) ? raw.skills : []).filter(validSkillId))].slice(0, 66),
      fear: validSkillId(raw.fear) ? String(raw.fear) : "",
      modifier: finiteNumber(raw.modifier),
      rootLaw: !!raw.rootLaw,
      abilities: (Array.isArray(raw.abilities) ? raw.abilities : []).slice(0, 100).map((item, index) => ({
        ...copyJsonObject(item),
        id: cleanText(item?.id, 100) || `${sheet.id}:ability:${index}`,
        name: cleanText(item?.name, 300), type: cleanText(item?.type, 100), target: cleanText(item?.target, 300),
        cost: cleanText(item?.cost, 100), effect: cleanText(item?.effect, 20_000), memo: cleanText(item?.memo, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      people: (Array.isArray(raw.people) ? raw.people : []).slice(0, 100).map((item, index) => ({
        ...copyJsonObject(item),
        id: cleanText(item?.id, 100) || `${sheet.id}:person:${index}`,
        name: cleanText(item?.name, 300), shelter: !!item?.shelter, emotion: cleanText(item?.emotion, 300),
        detail: cleanText(item?.detail, 20_000), memo: cleanText(item?.memo, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      mission: cleanText(raw.mission, 50_000),
      secret: cleanText(raw.secret, 50_000),
      memo: cleanText(raw.memo, 50_000),
      profile: { ...copyJsonObject(raw.profile), catchphrase: cleanText(raw.profile?.catchphrase, 20_000), setting: cleanText(raw.profile?.setting, 50_000) },
      flashback: cleanText(raw.flashback, 50_000),
      respec: {
        ...copyJsonObject(raw.respec),
        newWorld: !!raw.respec?.newWorld, session: !!raw.respec?.session, roleplay: !!raw.respec?.roleplay,
        gain: !!raw.respec?.gain, empathy: nonNegativeNumber(raw.respec?.empathy),
        mission: !!raw.respec?.mission, other: nonNegativeNumber(raw.respec?.other)
      },
      items: normalizeItems(raw.items),
      madnessState: { ...copyJsonObject(raw.madnessState), current: nonNegativeNumber(raw.madnessState?.current), delirium: !!raw.madnessState?.delirium },
      madness: (Array.isArray(raw.madness) ? raw.madness : []).slice(0, 100).map((item) => ({
        ...copyJsonObject(item),
        name: cleanText(item?.name, 300), trigger: cleanText(item?.trigger, 10_000),
        revealed: !!item?.revealed, effect: cleanText(item?.effect, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      permissions: normalizePermissions(raw.permissions),
      extensions: copyJsonObject(raw.extensions)
    };
  }

  function parseTransferPayload(text, idFactory = makeId) {
    if (typeof text !== "string" || !text.trim()) throw new Error("붙여넣을 JSON이 없습니다.");
    if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES) throw new Error("시트 JSON이 너무 큽니다.");
    let payload;
    try { payload = JSON.parse(text); } catch (error) { throw new Error("올바른 JSON이 아닙니다."); }
    if (payload?.kind !== TRANSFER_KIND) throw new Error("사이코로픽션 시트 API 형식이 아닙니다.");
    if (payload.version !== TRANSFER_VERSION) throw new Error(`지원하지 않는 시트 버전: ${payload.version ?? "없음"}`);
    return normalizeTransferSheet(payload.data, idFactory);
  }

  const testHook = window.__CCF_CHARACTER_SHEET_TEST_HOOK__;
  if (testHook && typeof testHook === "object") {
    Object.assign(testHook, { CATEGORIES, isInsaneDicebot, getSkillTarget, getCuriosityGaps, clampDialogDrag, isCharacterEditTitle, nativeStatusPatch, normalizeItems, normalizePermissions, normalizeData, parseTransferPayload });
    return;
  }

  try { window[DEBUG_KEY]?.disable?.(); } catch (error) { /* previous cleanup failed */ }

  const abort = new AbortController();
  const signal = abort.signal;
  const state = {
    active: true,
    roomKey: "",
    data: makeData(),
    open: false,
    view: "list",
    renderFrame: 0,
    saveTimer: 0,
    dialogPosition: { x: 0, y: 0 },
    openNotes: new Set(),
    nativeCharacterDialog: null
  };

  registerWithSuite();
  installStyle();
  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("paste", handleTransferPaste, { capture: true, signal });
  window.addEventListener("capybara-toolkit:route-change", scheduleRefresh, { signal });
  window.addEventListener("popstate", scheduleRefresh, { signal });
  window[DEBUG_KEY] = {
    __owner: signal,
    version: VERSION,
    isActive: () => state.active,
    detected: detectRoom,
    open: () => openSheet(),
    data: () => structuredClone(state.data),
    importText: (text) => importTransferText(text),
    disable
  };
  scheduleRefresh();

  function registerWithSuite() {
    const info = {
      id: FEATURE_ID,
      name: "CCFOLIA Saikoro Fiction Character Sheet",
      version: VERSION,
      namespace: "https://greasyfork.org/users/Capybara_korea/ccf-character-sheet"
    };
    const register = () => {
      try {
        const key = "ccf-suite-registry-v1";
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        const registry = parsed && typeof parsed.scripts === "object" ? parsed : { scripts: {} };
        registry.scripts[FEATURE_ID] = { ...registry.scripts[FEATURE_ID], ...info, lastSeenAt: new Date().toISOString(), lastSeenUrl: location.href };
        localStorage.setItem(key, JSON.stringify(registry));
        window.dispatchEvent(new CustomEvent("ccf-suite:register", { detail: registry.scripts[FEATURE_ID] }));
      } catch (error) { /* registry failure does not block feature */ }
    };
    register();
    window.addEventListener("ccf-suite:request-register", (event) => {
      if (!event.detail?.targetId || event.detail.targetId === FEATURE_ID) register();
    }, { signal });
  }

  function disable() {
    if (!state.active) return false;
    state.active = false;
    abort.abort();
    observer.disconnect();
    cancelAnimationFrame(state.renderFrame);
    clearTimeout(state.saveTimer);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.querySelectorAll(`[${ICON_ATTR}], [${DIALOG_BUTTON_ATTR}]`).forEach((node) => node.remove());
    if (window[DEBUG_KEY]?.__owner === signal) delete window[DEBUG_KEY];
    return true;
  }

  function roomKey() {
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function detectRoom() {
    if (!roomKey()) return false;
    const texts = [...document.querySelectorAll("span.MuiTypography-caption")]
      .filter((node) => !node.closest('[role="log"], [aria-live], li'))
      .map((node) => node.textContent || "");
    const hrefs = [...document.querySelectorAll('a[href*="docs.bcdice.org"], a[href*="bcdice"]')].map((node) => node.href || node.getAttribute("href") || "");
    return isInsaneDicebot(texts, hrefs);
  }

  function scheduleRefresh() {
    if (!state.active || state.renderFrame) return;
    state.renderFrame = requestAnimationFrame(async () => {
      state.renderFrame = 0;
      const nextRoom = roomKey();
      if (nextRoom !== state.roomKey) {
        state.roomKey = nextRoom;
        state.data = await loadData(nextRoom);
        if (state.open) render();
      }
      if (detectRoom()) {
        mountIcon();
        mountCharacterDialogButtons();
      }
      else {
        document.querySelectorAll(`[${ICON_ATTR}], [${DIALOG_BUTTON_ATTR}]`).forEach((node) => node.remove());
        closeSheet();
      }
    });
  }

  function makeId() {
    return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function makeSheet(name = "새 시트", idFactory = makeId) {
    return {
      id: idFactory(), name, player: "", age: "", gender: "", occupation: "",
      life: 6, lifeMax: 6, sanity: 6, sanityMax: 6,
      curiosity: "", removedGaps: [false, false, false, false, false],
      skills: [], fear: "", abilities: [], people: [], mission: "", secret: "", memo: ""
    };
  }

  function makeData() {
    const sheet = makeSheet();
    return { version: 1, selectedId: sheet.id, sheets: [sheet], permissions: {} };
  }

  function normalizeData(value) {
    if (!value || !Array.isArray(value.sheets) || !value.sheets.length) return makeData();
    const sheets = value.sheets.map((raw, index) => {
      const base = makeSheet(`시트 ${index + 1}`);
      const sheet = { ...base, ...raw };
      sheet.removedGaps = Array.from({ length: 5 }, (_, i) => !!raw.removedGaps?.[i]);
      sheet.skills = Array.isArray(raw.skills) ? raw.skills.filter(validSkillId) : [];
      sheet.abilities = (Array.isArray(raw.abilities) ? raw.abilities : []).map((item, itemIndex) => ({ ...item, id: item.id || `${sheet.id}:ability:${itemIndex}` }));
      sheet.people = (Array.isArray(raw.people) ? raw.people : []).map((item, itemIndex) => ({ ...item, id: item.id || `${sheet.id}:person:${itemIndex}` }));
      return sheet;
    });
    const selectedId = sheets.some((sheet) => sheet.id === value.selectedId) ? value.selectedId : sheets[0].id;
    const legacyPermissions = value.sheets.find((sheet) => sheet.id === selectedId)?.permissions;
    sheets.forEach((sheet) => { delete sheet.permissions; });
    return { version: 1, selectedId, sheets, permissions: normalizePermissions(value.permissions || legacyPermissions) };
  }

  async function loadData(key) {
    if (!key) return makeData();
    try {
      const toolkit = window.__CAPYBARA_TOOLKIT__;
      if (toolkit?.storage?.getRoomData) {
        const record = await toolkit.storage.getRoomData(FEATURE_ID, key);
        return normalizeData(record?.value);
      }
      return normalizeData(JSON.parse(localStorage.getItem(`${FEATURE_ID}:${key}`) || "null"));
    } catch (error) {
      console.warn("[ccf-character-sheet] load failed", error);
      return makeData();
    }
  }

  function saveSoon() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveData, 120);
  }

  async function saveData() {
    if (!state.roomKey) return;
    try {
      const toolkit = window.__CAPYBARA_TOOLKIT__;
      if (toolkit?.storage?.setRoomData) await toolkit.storage.setRoomData(FEATURE_ID, state.roomKey, state.data);
      else localStorage.setItem(`${FEATURE_ID}:${state.roomKey}`, JSON.stringify(state.data));
      status("저장됨");
    } catch (error) {
      console.warn("[ccf-character-sheet] save failed", error);
      status("저장 실패");
    }
  }

  function currentSheet() {
    return state.data.sheets.find((sheet) => sheet.id === state.data.selectedId) || state.data.sheets[0];
  }

  function findCharacterButton() {
    const labels = ["내 캐릭터", "캐릭터 목록", "My character", "My characters", "マイキャラクター", "キャラクター一覧", "我的角色"];
    const candidates = [...document.querySelectorAll("button[aria-label], button[title], [role='button'][aria-label]")];
    return candidates.find((node) => labels.some((label) => `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`.includes(label))) || null;
  }

  function mountIcon() {
    if (document.querySelector(`[${ICON_ATTR}]`)) return;
    const anchor = findCharacterButton();
    if (!anchor?.parentElement) return;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(ICON_ATTR, "toolbar");
    button.setAttribute("aria-label", "사이코로픽션");
    button.title = "사이코로픽션";
    button.innerHTML = diceIcon();
    button.addEventListener("click", openPanel, { signal });
    anchor.parentElement.insertBefore(button, anchor.nextSibling);
  }

  function mountCharacterDialogButtons() {
    document.querySelectorAll('.MuiDialog-root, [role="dialog"]').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.closest(`#${ROOT_ID}`)) return;
      const topbar = dialog.querySelector(".MuiAppBar-root, .MuiDialogTitle-root");
      const host = topbar?.querySelector(".MuiToolbar-root") || topbar;
      const title = [...(host?.querySelectorAll("h1,h2,h3,h4,h5,h6,[class*='MuiTypography']") || [])].find((node) => isCharacterEditTitle(node.textContent));
      if (!title || host.querySelector(`[${DIALOG_BUTTON_ATTR}]`)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = host.querySelector("button")?.className || "";
      button.setAttribute(DIALOG_BUTTON_ATTR, "native-topbar");
      button.setAttribute("aria-label", "사이코로픽션 열기");
      button.title = "사이코로픽션";
      button.innerHTML = diceIcon();
      button.addEventListener("click", () => openSheetFromCharacterDialog(dialog), { signal });
      title.insertAdjacentElement("afterend", button);
    });
  }

  function openSheetFromCharacterDialog(dialog) {
    syncSheetFromNativeDialog(dialog);
    state.nativeCharacterDialog = dialog;
    syncNativeItems(currentSheet(), dialog);
    state.view = "sheet";
    openSheet();
  }

  function openPanel() {
    state.nativeCharacterDialog = null;
    state.view = "list";
    openSheet();
  }

  function syncSheetFromNativeDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) return;
    const sheet = currentSheet();
    const name = dialog.querySelector('input[name="name"]');
    const memo = dialog.querySelector('textarea[name="memo"]');
    const rows = [...dialog.querySelectorAll('input[name^="status."][name$=".label"]')].map((label) => {
      const base = label.name.replace(/\.label$/, "");
      return {
        label: label.value,
        value: dialog.querySelector(`input[name="${base}.value"]`)?.value,
        max: dialog.querySelector(`input[name="${base}.max"]`)?.value
      };
    });
    if (name?.value) sheet.name = name.value;
    if (memo) sheet.memo = memo.value;
    Object.assign(sheet, nativeStatusPatch(rows));
    saveSoon();
  }

  function syncNativeCharacterField(key, value) {
    const dialog = state.nativeCharacterDialog;
    if (!(dialog instanceof HTMLElement) || !dialog.isConnected) return;
    const direct = { name: 'input[name="name"]', memo: 'textarea[name="memo"]' };
    let input = direct[key] ? dialog.querySelector(direct[key]) : null;
    if (!input) {
      const statusKey = { life: ["생명력", "value"], lifeMax: ["생명력", "max"], sanity: ["이성치", "value"], sanityMax: ["이성치", "max"] }[key];
      const label = statusKey && [...dialog.querySelectorAll('input[name^="status."][name$=".label"]')].find((node) => node.value.trim() === statusKey[0]);
      if (label) input = dialog.querySelector(`input[name="${label.name.replace(/\.label$/, `.${statusKey[1]}`)}"]`);
    }
    if (!input) return;
    setNativeInputValue(input, value);
  }

  function setNativeInputValue(input, value) {
    const previous = input.value;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, String(value)); else input.value = String(value);
    input._valueTracker?.setValue(previous);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  }

  function findNativeCharacterDialog() {
    return [...document.querySelectorAll('.MuiDialog-root, [role="dialog"]')].find((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.closest(`#${ROOT_ID}`)) return false;
      return [...dialog.querySelectorAll("h1,h2,h3,h4,h5,h6,[class*='MuiTypography']")].some((node) => isCharacterEditTitle(node.textContent));
    }) || null;
  }

  async function syncNativeItems(sheet, dialog = state.nativeCharacterDialog || findNativeCharacterDialog()) {
    if (!(dialog instanceof HTMLElement) || !dialog.isConnected) return;
    const entries = Object.entries(normalizeItems(sheet.items));
    if (!entries.length) return;
    const labels = () => [...dialog.querySelectorAll('input[name^="status."][name$=".label"]')];
    const add = [...dialog.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .find((node) => node.textContent.trim() === "스테이터스")?.parentElement?.querySelector('button:has(svg[data-testid="AddIcon"])');
    for (const [labelText, value] of entries) {
      let label = labels().find((node) => node.value.trim() === labelText);
      if (!label && add) {
        const known = new Set(labels().map((node) => node.name));
        add.click();
        for (let frame = 0; frame < 10 && !label; frame += 1) {
          await new Promise(requestAnimationFrame);
          label = labels().find((node) => !known.has(node.name));
        }
        if (label) setNativeInputValue(label, labelText);
      }
      if (!label) continue;
      await new Promise(requestAnimationFrame);
      const input = dialog.querySelector(`input[name="${label.name.replace(/\.label$/, ".value")}"]`);
      if (input) setNativeInputValue(input, value);
    }
  }

  function openSheet() {
    if (!detectRoom()) return false;
    state.open = true;
    ensureRoot();
    render();
    return true;
  }

  function closeSheet() {
    state.open = false;
    state.nativeCharacterDialog = null;
    document.getElementById(ROOT_ID)?.remove();
  }

  function ensureRoot() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.addEventListener("click", handleClick, { signal });
    root.addEventListener("input", handleInput, { signal });
    root.addEventListener("change", handleInput, { signal });
    document.body.appendChild(root);
  }

  function render() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !state.open) return;
    const scrollTop = root.querySelector(".ccf-cs-dialog>main")?.scrollTop || 0;
    const sheet = currentSheet();
    const editor = state.view === "sheet";
    root.innerHTML = `
      <section class="ccf-cs-dialog${editor ? " is-editor" : " is-panel"}" role="dialog" aria-modal="false" aria-labelledby="ccf-cs-title">
        <header><h2 id="ccf-cs-title">${editor ? escapeHtml(sheet.name || "이름 없음") : "사이코로픽션"}</h2>${editor ? `<button class="ccf-cs-icon" data-action="back-list" aria-label="캐릭터 시트 목록" title="목록">${backIcon()}</button><button class="ccf-cs-icon" data-action="panel-settings" aria-label="설정" title="설정">${settingsIcon()}</button>` : ""}<button class="ccf-cs-icon" data-action="close" aria-label="닫기" title="닫기">${closeIcon()}</button></header>
        ${editor ? `<main>${renderSections(sheet)}</main>
        <footer>${TABLE_COMMANDS.map(([label, command]) => `<button data-command="${command}" title="${label} 명령 입력">${label}</button>`).join("")}</footer>` : `${renderPanelTabs()}<main class="ccf-cs-panel-main">${state.view === "settings" ? renderSettings() : renderSheetList()}</main>`}
      </section>`;
    const dialog = root.querySelector(".ccf-cs-dialog");
    dialog.style.transform = `translate3d(${state.dialogPosition.x}px,${state.dialogPosition.y}px,0)`;
    dialog.querySelector("main").scrollTop = scrollTop;
    enableDialogDrag(dialog);
    resizeInlineMemos(dialog);
  }

  function renderPanelTabs() {
    return `<nav class="ccf-cs-tabs" aria-label="사이코로픽션 메뉴"><button data-action="panel-list" aria-selected="${state.view === "list"}">목록</button><button data-action="panel-settings" aria-selected="${state.view === "settings"}">설정</button></nav>`;
  }

  function renderSheetList() {
    const rows = state.data.sheets.map((sheet) => `<div class="ccf-cs-sheet-item"><button class="ccf-cs-sheet-row" data-action="open-sheet" data-sheet-id="${escapeHtml(sheet.id)}"><strong>${escapeHtml(sheet.name || "이름 없음")}</strong><span>${escapeHtml(sheet.player || "플레이어 미설정")}</span></button><button class="ccf-cs-sheet-delete" data-action="delete-sheet-list" data-sheet-id="${escapeHtml(sheet.id)}" aria-label="${escapeHtml(sheet.name || "이름 없음")} 시트 삭제" title="삭제">${closeIcon()}</button></div>`).join("");
    return `<section class="ccf-cs-panel-section"><div class="ccf-cs-panel-heading"><h3>캐릭터 시트 목록</h3><button data-action="add-sheet" aria-label="캐릭터 시트 추가" title="캐릭터 시트 추가">＋</button></div><div class="ccf-cs-sheet-list">${rows}</div></section>`;
  }

  function renderSettings() {
    const rows = permissionRows(state.data.permissions).map(({ key, label, image }) => {
      const value = state.data.permissions?.[key] || {};
      return `<div class="ccf-cs-perm-name">${key === "*" ? "" : renderPlayerAvatar(image)}${escapeHtml(label)}</div>${["view", "secret", "edit"].map((column) => `<label class="ccf-cs-perm-cell"><input type="checkbox" data-perm-key="${escapeHtml(key)}" data-perm-col="${column}"${value[column] ? " checked" : ""}><span></span></label>`).join("")}`;
    }).join("");
    return `<section class="ccf-cs-panel-section ccf-cs-settings"><h3>시트 권한</h3><p>모든 캐릭터 시트에 공통 적용됩니다.<br>공개: 특기·어빌리티·인물 표시<br>비밀: 메모 표시<br>수정: 시트 열람 및 수정</p><div class="ccf-cs-perm-grid"><b>이름</b><b>공개</b><b>비밀</b><b>수정</b>${rows}</div></section>`;
  }

  function enableDialogDrag(dialog) {
    const handle = dialog?.querySelector("header");
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button,input,select,textarea,a")) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, position: { ...state.dialogPosition }, rect: dialog.getBoundingClientRect() };
      const move = (nextEvent) => {
        const delta = clampDialogDrag(start.rect, nextEvent.clientX - start.x, nextEvent.clientY - start.y, innerWidth, innerHeight);
        state.dialogPosition = { x: start.position.x + delta.x, y: start.position.y + delta.y };
        dialog.style.transform = `translate3d(${state.dialogPosition.x}px,${state.dialogPosition.y}px,0)`;
      };
      const stop = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", stop);
        document.removeEventListener("pointercancel", stop);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", stop);
      document.addEventListener("pointercancel", stop);
    }, { signal });
  }

  function renderSections(sheet) {
    const skillOptions = CATEGORIES.flatMap((category, column) => category.slice(1).map((name, row) => `<option value="${column}:${row}"${sheet.fear === `${column}:${row}` ? " selected" : ""}>${category[0]} · ${name}</option>`)).join("");
    const basic = `<div class="ccf-cs-basic">
      ${field("player", "플레이어", sheet.player)}${field("name", "캐릭터명", sheet.name)}
      <label class="ccf-cs-profile-memo"><span>캐릭터 메모</span><textarea data-field="memo" placeholder="나이 / 성별 / 직업">${escapeHtml(profileMemo(sheet))}</textarea></label>
      <div class="ccf-cs-field-pair">${numberField("life", "생명력", sheet.life)}${numberField("lifeMax", "최대 생명력", sheet.lifeMax)}</div>
      <div class="ccf-cs-field-pair">${numberField("sanity", "이성치", sheet.sanity)}${numberField("sanityMax", "최대 이성치", sheet.sanityMax)}</div>
    </div>`;
    const skillSettings = `<div class="ccf-cs-skill-options">
      <label>호기심 분야<select data-field="curiosity"><option value="">선택 안 함</option>${CATEGORIES.map((category, index) => `<option value="${index}"${String(index) === String(sheet.curiosity) ? " selected" : ""}>${category[0]}</option>`).join("")}</select></label>
      <label>공포심<select data-field="fear"><option value="">선택 안 함</option>${skillOptions}</select></label>
    </div>`;
    return section("", basic, "ccf-cs-basic-section")
      + section("특기", renderSkills(sheet) + skillSettings, "ccf-cs-section-wide")
      + section("어빌리티 리스트", renderRepeaters("abilities", sheet.abilities, [["name", "어빌리티"], ["type", "타입"], ["target", "지정특기"]]), "", "abilities")
      + section("인물", renderRepeaters("people", sheet.people, [["name", "이름"], ["emotion", "감정"], ["detail", "설명"]]), "", "people");
  }

  function section(title, content, className = "", addKey = "") {
    const heading = title || addKey ? `<div class="ccf-cs-section-head">${title ? `<h3>${title}</h3>` : ""}${addKey ? `<button class="ccf-cs-section-add" data-add="${addKey}" aria-label="${title} 추가" title="${title} 추가">＋</button>` : ""}</div>` : "";
    return `<section class="ccf-cs-form-section ${className}">${heading}${content}</section>`;
  }

  function profileMemo(sheet) {
    if (sheet.memo) return sheet.memo;
    return [["나이", sheet.age], ["성별", sheet.gender], ["직업", sheet.occupation]]
      .filter(([, value]) => String(value || "").trim())
      .map(([label, value]) => `${label}: ${value}`)
      .join("\n");
  }

  function permissionRows(permissions = {}) {
    const rows = [{ key: "*", label: "전원" }];
    const handout = window.__CCF_HANDOUT_DEBUG__;
    const players = handout?.getPlayers?.() || [];
    const peers = window.__CAPYBARA_TOOLKIT_PRESENCE__?.getPeers?.() || [];
    for (const peer of peers) {
      const name = cleanText(peer?.name, 100).trim();
      if (name && !rows.some((row) => row.key === name)) rows.push({ key: name, label: peer.self ? `${name} (나)` : name });
    }
    for (const key of Object.keys(permissions)) {
      if (key !== "*" && !rows.some((row) => row.key === key)) rows.push({ key, label: key });
    }
    for (const player of players) {
      if (player.name && !rows.some((row) => row.key === player.name)) rows.push({ key: player.name, label: player.name });
    }
    for (const row of rows) {
      if (row.key !== "*") row.image = handout?.getPlayerImage?.(row.key) || "";
    }
    return rows;
  }

  function renderPlayerAvatar(image) {
    return `<span class="ccf-cs-player-avatar" aria-hidden="true">${/^https?:\/\//i.test(image || "") ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : ""}</span>`;
  }

  function closeIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  }

  function settingsIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.2 7.2 0 0 0-1.69-.98L14.5 2.42A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.49.49 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.08.66-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.38.31.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.08.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"/></svg>';
  }

  function backIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.42-1.41L7.83 13H20v-2z"/></svg>';
  }

  function diceIcon() {
    return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 8 3 8-3-8-3z"/><path d="m4 10 1 8 7 3 7-3 1-8M12 13v8"/><path d="M4 10 2 7l7-3 3 3M12 7l3-3 7 2-2 4"/><circle cx="7.8" cy="14.6" r=".8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="13.8" r=".8" fill="currentColor" stroke="none"/><circle cx="15.4" cy="17.1" r=".8" fill="currentColor" stroke="none"/></svg>';
  }

  function renderSkills(sheet) {
    return `<div class="ccf-cs-skills">${CATEGORIES.map((category, column) => `<section><h3>${category[0]}</h3>${category.slice(1).map((name, row) => {
      const id = `${column}:${row}`;
      const target = getSkillTarget(sheet.skills, id, sheet.removedGaps);
      return `<div class="ccf-cs-skill${sheet.fear === id ? " is-fear" : ""}${sheet.skills.includes(id) ? " is-selected" : ""}"><input type="checkbox" data-skill="${id}" aria-label="${name} 습득"${sheet.skills.includes(id) ? " checked" : ""}><button data-roll="${id}" title="${name} 판정 입력">${name}<small>${target || "–"}</small></button></div>`;
    }).join("")}</section>${column < CATEGORIES.length - 1 ? `<i class="ccf-cs-gap${sheet.removedGaps[column] ? " is-active" : ""}" aria-hidden="true"></i>` : ""}`).join("")}</div>`;
  }

  function renderRepeaters(key, items, fields) {
    const heading = `<div class="ccf-cs-repeater-head" aria-hidden="true"><div class="ccf-cs-repeater-fields">${fields.map(([, label]) => `<span>${label}</span>`).join("")}</div></div>`;
    return `<div class="ccf-cs-repeaters">${heading}${items.map((item, index) => {
      const noteKey = `${currentSheet().id}:${key}:${item.id || index}`;
      const noteOpen = state.openNotes.has(noteKey);
      const itemName = item.name || `${index + 1}번 항목`;
      const memo = item.memo || (key === "abilities" ? item.effect : "");
      return `<section><button class="ccf-cs-note-toggle${noteOpen || memo ? " is-active" : ""}" data-note="${key}" data-item-id="${escapeHtml(item.id || index)}" data-index="${index}" aria-label="${escapeHtml(itemName)} 메모 ${noteOpen ? "닫기" : "열기"}" aria-expanded="${noteOpen}"></button><div class="ccf-cs-repeater-fields">${fields.map(([fieldName, label]) => fieldName === "detail" ? `<textarea data-list="${key}" data-index="${index}" data-prop="${fieldName}" aria-label="${escapeHtml(itemName)} ${label}">${escapeHtml(item[fieldName] || "")}</textarea>` : `<input data-list="${key}" data-index="${index}" data-prop="${fieldName}" aria-label="${escapeHtml(itemName)} ${label}" value="${escapeHtml(item[fieldName] || "")}">`).join("")}</div><button class="ccf-cs-remove" data-remove="${key}" data-index="${index}" aria-label="삭제" title="삭제">×</button>${noteOpen ? `<textarea class="ccf-cs-inline-memo" data-list="${key}" data-index="${index}" data-prop="memo" placeholder="메모" aria-label="${escapeHtml(itemName)} 메모">${escapeHtml(memo)}</textarea>` : ""}</section>`;
    }).join("")}</div>`;
  }

  function resizeInlineMemos(scope) {
    scope?.querySelectorAll?.(".ccf-cs-inline-memo").forEach((textarea) => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    });
  }

  function field(name, label, value) {
    return `<label>${label}<input data-field="${name}" value="${escapeHtml(value)}"></label>`;
  }

  function numberField(name, label, value) {
    return `<label>${label}<input type="number" min="0" data-field="${name}" value="${Number(value) || 0}"></label>`;
  }

  function handleInput(event) {
    const target = event.target;
    const sheet = currentSheet();
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (target.dataset.field) {
      const key = target.dataset.field;
      sheet[key] = target.type === "number" ? Number(target.value) : target.value;
      if (key === "curiosity") {
        sheet.removedGaps = getCuriosityGaps(target.value);
        updateSkillsView();
      } else if (key === "name") {
        const title = document.querySelector(`#${ROOT_ID} #ccf-cs-title`);
        if (title) title.textContent = target.value || "이름 없음";
      }
      syncNativeCharacterField(key, sheet[key]);
      saveSoon();
      return;
    }
    if (target.dataset.skill) {
      sheet.skills = target.checked ? [...new Set([...sheet.skills, target.dataset.skill])] : sheet.skills.filter((id) => id !== target.dataset.skill);
      target.closest(".ccf-cs-skill")?.classList.toggle("is-selected", target.checked);
      updateSkillsView();
      saveSoon();
      return;
    }
    if (target.dataset.list) {
      const item = sheet[target.dataset.list]?.[Number(target.dataset.index)];
      if (item) item[target.dataset.prop] = target.value;
      if (target.classList.contains("ccf-cs-inline-memo")) resizeInlineMemos(target.parentElement);
      saveSoon();
      return;
    }
    if (target.dataset.permKey && target.dataset.permCol) {
      const key = target.dataset.permKey;
      state.data.permissions ||= {};
      state.data.permissions[key] ||= { view: false, secret: false, edit: false };
      state.data.permissions[key][target.dataset.permCol] = target.checked;
      state.data.permissions = normalizePermissions(state.data.permissions);
      saveSoon();
    }
  }

  function handleClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.action === "close") return closeSheet();
    if (button.dataset.action === "panel-list" || button.dataset.action === "back-list") { state.view = "list"; return render(); }
    if (button.dataset.action === "panel-settings") { state.view = "settings"; return render(); }
    if (button.dataset.action === "open-sheet") { state.data.selectedId = button.dataset.sheetId; state.view = "sheet"; return render(); }
    if (button.dataset.action === "delete-sheet-list") {
      if (state.data.sheets.length === 1) return;
      const sheet = state.data.sheets.find((item) => item.id === button.dataset.sheetId);
      if (!sheet || !confirm(`'${sheet.name || "이름 없음"}' 시트를 삭제할까요?`)) return;
      state.data.sheets = state.data.sheets.filter((item) => item.id !== sheet.id);
      if (state.data.selectedId === sheet.id) state.data.selectedId = state.data.sheets[0].id;
      render(); saveSoon(); return;
    }
    if (button.dataset.action === "add-sheet") {
      const sheet = makeSheet(`시트 ${state.data.sheets.length + 1}`);
      state.data.sheets.push(sheet); state.data.selectedId = sheet.id; state.view = "sheet"; render(); saveSoon(); return;
    }
    if (button.dataset.add) {
      currentSheet()[button.dataset.add].push({ id: makeId() }); render(); saveSoon(); return;
    }
    if (button.dataset.note) {
      const noteKey = `${currentSheet().id}:${button.dataset.note}:${button.dataset.itemId || button.dataset.index}`;
      state.openNotes.has(noteKey) ? state.openNotes.delete(noteKey) : state.openNotes.add(noteKey);
      render(); return;
    }
    if (button.dataset.remove) {
      currentSheet()[button.dataset.remove].splice(Number(button.dataset.index), 1); state.openNotes.clear(); render(); saveSoon(); return;
    }
    if (button.dataset.command) return writeChat(button.dataset.command);
    if (button.dataset.roll) return inputSkillRoll(button.dataset.roll);
  }

  function updateSkillsView() {
    const root = document.getElementById(ROOT_ID);
    const sheet = currentSheet();
    root?.querySelectorAll(".ccf-cs-gap").forEach((gap, index) => gap.classList.toggle("is-active", !!sheet.removedGaps[index]));
    root?.querySelectorAll("button[data-roll]").forEach((button) => {
      button.parentElement?.classList.toggle("is-fear", sheet.fear === button.dataset.roll);
      const target = getSkillTarget(sheet.skills, button.dataset.roll, sheet.removedGaps);
      const value = button.querySelector("small");
      if (value) value.textContent = target || "–";
    });
  }

  function inputSkillRoll(id) {
    const sheet = currentSheet();
    const target = getSkillTarget(sheet.skills, id, sheet.removedGaps);
    if (!target) return status("습득 특기를 먼저 선택");
    const [column, row] = id.split(":").map(Number);
    const name = CATEGORIES[column][row + 1];
    const fear = sheet.fear === id;
    writeChat(`2D6${fear ? "-2" : ""}>=${target} [${name}${fear ? "/공포심" : ""}]`);
  }

  function looksLikeTransfer(text) {
    return typeof text === "string" && text.includes(`"${TRANSFER_KIND}"`);
  }

  function handleTransferPaste(event) {
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!looksLikeTransfer(text) || !detectRoom()) return;
    event.preventDefault();
    event.stopPropagation();
    importTransferText(text);
  }

  async function readTransferFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      importTransferText(text);
    } catch (error) {
      status("클립보드를 읽지 못함: Ctrl+V 사용");
    }
  }

  function importTransferText(text) {
    try {
      const sheet = parseTransferPayload(text);
      if (!Object.keys(state.data.permissions || {}).length) state.data.permissions = normalizePermissions(sheet.permissions);
      delete sheet.permissions;
      state.data.sheets.push(sheet);
      state.data.selectedId = sheet.id;
      state.open = true;
      state.view = "sheet";
      ensureRoot();
      render();
      syncNativeItems(sheet);
      status("시트 가져옴");
      saveSoon();
      return sheet;
    } catch (error) {
      if (state.open) status(error.message || "시트를 가져오지 못함");
      console.warn("[ccf-character-sheet] import failed", error);
      return null;
    }
  }

  function writeChat(command) {
    const editors = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')];
    const editor = editors.find((node) => !node.closest(`#${ROOT_ID}, [role="dialog"], .MuiDialog-root`) && isVisible(node) && findSubmitScope(node));
    if (!editor) return status("채팅 입력창을 찾지 못함");
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(editor.constructor.prototype, "value")?.set;
      if (setter) setter.call(editor, command); else editor.value = command;
    } else editor.textContent = command;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.focus();
    closeSheet();
  }

  function findSubmitScope(editor) {
    let node = editor.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      if (node.querySelector('button[type="submit"]')) return node;
    }
    return null;
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function status(message) {
    const node = document.getElementById("ccf-cs-status");
    if (node) node.textContent = message;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${ICON_ATTR}] { all:unset;box-sizing:border-box;width:40px;height:40px;margin:0 2px;color:inherit;display:inline-grid;place-items:center;border-radius:50%;cursor:pointer;vertical-align:middle;transition:background-color 150ms cubic-bezier(.4,0,.2,1) }
      [${ICON_ATTR}]:hover { background:rgba(255,255,255,.1) }
      [${DIALOG_BUTTON_ATTR}] { display:inline-grid;place-items:center;width:48px;height:48px;padding:0;transition:background-color 150ms cubic-bezier(.4,0,.2,1) }
      [${DIALOG_BUTTON_ATTR}] svg { pointer-events:none }
      #${ROOT_ID},#${ROOT_ID} * { box-sizing:border-box;font-family:"Roboto","Noto Sans KR","Noto Sans JP",system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0 }
      #${ROOT_ID} { position:fixed;inset:0;z-index:2147483000;color:#eee;font-size:14px;pointer-events:none }
      #${ROOT_ID} .ccf-cs-dialog { position:absolute;inset:10px;margin:auto;width:min(500px,calc(100vw - 20px));height:min(600px,calc(100vh - 20px));pointer-events:auto;display:grid;background:rgba(33,33,33,.82);border:0;border-radius:0;box-shadow:0 12px 32px rgba(0,0,0,.55);overflow:hidden }
      #${ROOT_ID} .ccf-cs-dialog.is-editor { grid-template-rows:56px minmax(0,1fr) auto }
      #${ROOT_ID} .ccf-cs-dialog.is-panel { grid-template-rows:56px 48px minmax(0,1fr) }
      #${ROOT_ID} header,#${ROOT_ID} footer { display:flex;align-items:center;gap:8px;padding:8px 16px;border:0 }
      #${ROOT_ID} .ccf-cs-dialog>header { background:#212121!important;color:#fff }
      #${ROOT_ID} .ccf-cs-dialog>footer { background:#212121 }
      #${ROOT_ID} header { cursor:move;touch-action:none;user-select:none }
      #${ROOT_ID} header h2 { margin:0;font-size:.875rem;font-weight:bold;flex:1 }
      #${ROOT_ID} button,#${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea { font:inherit;color:inherit }
      #${ROOT_ID} button { min-height:36px;padding:0 12px;background:transparent;border:1px solid rgba(255,255,255,.23);border-radius:4px;cursor:pointer;transition:background-color 150ms cubic-bezier(.4,0,.2,1),color 150ms cubic-bezier(.4,0,.2,1),border-color 150ms cubic-bezier(.4,0,.2,1) }
      #${ROOT_ID} button:hover { background:rgba(255,255,255,.08) }
      #${ROOT_ID} button:active { background:rgba(255,255,255,.16) }
      #${ROOT_ID} .ccf-cs-icon { width:40px;min-width:40px;padding:0;border:0;background:transparent;display:grid;place-items:center }
      #${ROOT_ID} .ccf-cs-icon svg { width:24px;height:24px;fill:currentColor;pointer-events:none }
      #${ROOT_ID} main { min-height:0;overflow:auto;padding:0 20px 24px;scrollbar-color:#777 #212121 }
      #${ROOT_ID} .ccf-cs-tabs { display:flex;height:48px;padding:0 16px;background:#212121;border:0 }
      #${ROOT_ID} .ccf-cs-tabs button { min-width:96px;height:48px;border:0;border-bottom:2px solid transparent;border-radius:0;color:#9e9e9e;font-weight:bold }
      #${ROOT_ID} .ccf-cs-tabs button[aria-selected="true"] { color:#fff;border-bottom-color:#f50057 }
      #${ROOT_ID} .ccf-cs-panel-main { padding:20px }
      #${ROOT_ID} .ccf-cs-panel-section { max-width:680px;margin:0 auto }
      #${ROOT_ID} .ccf-cs-panel-heading { display:flex;align-items:center;margin-bottom:8px }
      #${ROOT_ID} .ccf-cs-panel-heading h3,#${ROOT_ID} .ccf-cs-settings h3 { margin:0;font-size:14px;font-weight:bold }
      #${ROOT_ID} .ccf-cs-panel-heading button { margin-left:auto;width:36px;padding:0;border:0;border-radius:0;font-size:20px }
      #${ROOT_ID} .ccf-cs-sheet-list { display:grid }
      #${ROOT_ID} .ccf-cs-sheet-item { display:grid;grid-template-columns:minmax(0,1fr) 40px;align-items:center }
      #${ROOT_ID} .ccf-cs-sheet-row { display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;width:100%;padding:14px 8px;border:0;border-radius:0;text-align:left }
      #${ROOT_ID} .ccf-cs-sheet-delete { width:40px;min-width:40px;padding:0;border:0;border-radius:0;display:grid;place-items:center }
      #${ROOT_ID} .ccf-cs-sheet-delete svg { width:20px;height:20px;fill:currentColor;pointer-events:none }
      #${ROOT_ID} .ccf-cs-sheet-row strong { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
      #${ROOT_ID} .ccf-cs-sheet-row span { overflow:hidden;color:#bdbdbd;text-overflow:ellipsis;white-space:nowrap }
      #${ROOT_ID} .ccf-cs-settings { display:grid;gap:18px }
      #${ROOT_ID} .ccf-cs-perm-name { display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere }
      #${ROOT_ID} .ccf-cs-player-avatar { display:inline-flex;width:24px;height:24px;flex:0 0 24px;border-radius:0;overflow:hidden;background:rgba(255,255,255,.08) }
      #${ROOT_ID} .ccf-cs-player-avatar img { display:block;width:100%;height:100%;object-fit:cover;border-radius:0 }
      #${ROOT_ID} .ccf-cs-settings>p { margin:0;color:#bdbdbd;line-height:1.65 }
      #${ROOT_ID} .ccf-cs-settings>button { justify-self:start;border:0;border-radius:0;color:#f50057;font-weight:bold }
      #${ROOT_ID} .ccf-cs-form-section { padding:22px 0 24px }
      #${ROOT_ID} .ccf-cs-section-head { display:flex;align-items:center;gap:8px;margin:0 0 16px }
      #${ROOT_ID} .ccf-cs-section-head h3 { margin:0;color:#fff;font-size:14px;font-weight:bold }
      #${ROOT_ID} .ccf-cs-section-add,#${ROOT_ID} .ccf-cs-remove { min-height:32px;padding:0;border:0;border-radius:0;background:transparent }
      #${ROOT_ID} .ccf-cs-section-add { width:32px;font-size:20px }
      #${ROOT_ID} .ccf-cs-section-wide { overflow-x:auto }
      #${ROOT_ID} label { display:grid;gap:5px;color:#bdbdbd;font-size:13px;transition:color 200ms cubic-bezier(.4,0,.2,1) }
      #${ROOT_ID} .ccf-cs-dialog main label:focus-within { color:#2196f3 }
      #${ROOT_ID} input:not([type="checkbox"]),#${ROOT_ID} select,#${ROOT_ID} textarea { width:100%;min-height:36px;padding:4px 2px 2px;color:#fff;font-size:16px;background-color:transparent;background-image:linear-gradient(#2196f3,#2196f3);background-repeat:no-repeat;background-position:center bottom;background-size:0 2px;border:0;border-bottom:1px solid rgba(255,255,255,.55);border-radius:0;outline:0;transition:border-color 200ms cubic-bezier(.4,0,.2,1),border-width 150ms cubic-bezier(.4,0,.2,1),background-size 200ms cubic-bezier(.4,0,.2,1) }
      #${ROOT_ID} select { padding-right:32px }
      #${ROOT_ID} select option { color:#000 }
      #${ROOT_ID} input:not([type="checkbox"]):hover,#${ROOT_ID} select:hover,#${ROOT_ID} textarea:hover { border-bottom-color:rgba(255,255,255,.87);border-bottom-width:2px }
      #${ROOT_ID} input:not([type="checkbox"]):focus,#${ROOT_ID} select:focus,#${ROOT_ID} textarea:focus { border-bottom-color:transparent;border-bottom-width:2px;background-size:100% 2px }
      #${ROOT_ID} textarea { min-height:100px;resize:vertical }
      #${ROOT_ID} .ccf-cs-basic { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px }
      #${ROOT_ID} .ccf-cs-basic-section { padding-top:22px }
      #${ROOT_ID} .ccf-cs-profile-memo { grid-column:1/-1;display:block;padding:12px 16px 0;background:rgba(255,255,255,.1);color:#bdbdbd }
      #${ROOT_ID} .ccf-cs-profile-memo span { display:block;margin-bottom:2px }
      #${ROOT_ID} .ccf-cs-profile-memo textarea { width:calc(100% + 32px);min-height:140px;margin:0 -16px;padding:0 16px;background-color:transparent;resize:none }
      #${ROOT_ID} .ccf-cs-field-pair,#${ROOT_ID} .ccf-cs-skill-options { grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px }
      #${ROOT_ID} .ccf-cs-skill-options { margin-top:18px }
      #${ROOT_ID} .ccf-cs-skill input { appearance:none;width:13px;min-width:13px;height:13px;min-height:13px;margin:2px;background:#363636;border:0;border-radius:4px;cursor:pointer;transition:background-color 200ms ease }
      #${ROOT_ID} .ccf-cs-skill input:checked { background:#f50057 }
      #${ROOT_ID} .ccf-cs-skills { display:grid;grid-template-columns:repeat(5,minmax(105px,1fr) 12px) minmax(105px,1fr);min-width:740px }
      #${ROOT_ID} .ccf-cs-skills section { background:transparent;border:0 }
      #${ROOT_ID} .ccf-cs-gap { display:block;width:6px;justify-self:center;background:#363636;border-radius:0;transition:background-color 200ms ease }
      #${ROOT_ID} .ccf-cs-gap.is-active { background:#f50057 }
      #${ROOT_ID} .ccf-cs-skills h3 { margin:0;padding:4px;text-align:center;font-size:13px;font-weight:600;background:transparent;border-bottom:2px solid #363636 }
      #${ROOT_ID} .ccf-cs-skill { display:flex;align-items:center;gap:6px;padding:4px 10px;border:0 }
      #${ROOT_ID} .ccf-cs-skill.is-selected { background:rgba(255,255,255,.14) }
      #${ROOT_ID} .ccf-cs-skill.is-selected button { font-weight:bold }
      #${ROOT_ID} .ccf-cs-skill.is-fear button { color:#f50057 }
      #${ROOT_ID} .ccf-cs-skill button { flex:1;display:flex;justify-content:space-between;align-items:center;min-height:22px;border:0;background:transparent;padding:0;font-size:.9em }
      #${ROOT_ID} .ccf-cs-skill small { color:#fff }
      #${ROOT_ID} .ccf-cs-repeaters { display:grid;gap:12px }
      #${ROOT_ID} .ccf-cs-repeater-head { display:grid;grid-template-columns:32px minmax(0,1fr) 32px;gap:10px;color:#bdbdbd;font-size:13px }
      #${ROOT_ID} .ccf-cs-repeater-head .ccf-cs-repeater-fields { grid-column:2 }
      #${ROOT_ID} .ccf-cs-repeaters section { display:grid;grid-template-columns:32px minmax(0,1fr) 32px;gap:10px;align-items:start;padding-bottom:12px;border:0 }
      #${ROOT_ID} .ccf-cs-note-toggle { align-self:center;justify-self:center;width:13px;min-width:13px;height:13px;min-height:13px;padding:0;background:#363636;border:0;border-radius:0 }
      #${ROOT_ID} .ccf-cs-note-toggle.is-active { background:#f50057 }
      #${ROOT_ID} .ccf-cs-remove { width:32px;font-size:20px;color:#bdbdbd }
      #${ROOT_ID} .ccf-cs-repeater-fields { display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px }
      #${ROOT_ID} .ccf-cs-repeater-fields input,#${ROOT_ID} .ccf-cs-repeater-fields textarea { height:36px;min-height:36px;resize:none }
      #${ROOT_ID} .ccf-cs-inline-memo { grid-column:2/3;min-height:40px;height:auto;overflow:hidden;resize:none;field-sizing:content }
      #${ROOT_ID} footer { flex-wrap:wrap }
      #${ROOT_ID} footer .ccf-cs-save { margin-left:auto;color:#f50057;font-weight:bold }
      #${ROOT_ID} .ccf-cs-dialog>footer button { border:0;border-radius:0 }
      #${ROOT_ID} .ccf-cs-perm-grid { display:grid;grid-template-columns:minmax(0,1fr) repeat(3,64px);align-items:center;padding:8px 16px;overflow:auto }
      #${ROOT_ID} .ccf-cs-perm-grid>b { padding:8px 4px;color:#fff;text-align:center }
      #${ROOT_ID} .ccf-cs-perm-grid>b:first-child { text-align:left }
      #${ROOT_ID} .ccf-cs-perm-name { padding:12px 4px;border-top:1px solid rgba(255,255,255,.12);color:#fff }
      #${ROOT_ID} .ccf-cs-perm-cell { display:grid;place-items:center;align-self:stretch;border-top:1px solid rgba(255,255,255,.12) }
      #${ROOT_ID} .ccf-cs-perm-cell input { width:18px;min-height:18px;accent-color:#f50057 }
      #${ROOT_ID} .ccf-cs-perm-cell span { display:none }
      @media (max-width:700px) {
        #${ROOT_ID} .ccf-cs-repeaters section { grid-template-columns:32px minmax(0,1fr) 32px }
        #${ROOT_ID} .ccf-cs-repeater-fields { grid-template-columns:1fr }
        #${ROOT_ID} main { padding:0 12px 16px }
        #${ROOT_ID} #ccf-cs-status { display:none }
        #${ROOT_ID} .ccf-cs-perm-grid { grid-template-columns:minmax(0,1fr) repeat(3,52px);padding:8px }
      }
    `;
    document.documentElement.appendChild(style);
  }
})();
