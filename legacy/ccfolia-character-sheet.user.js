// ==UserScript==
// @name         CCFOLIA inSANe Character Sheet by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-character-sheet
// @version      0.2.1
// @description  Detect inSANe rooms and add room-local character sheets with BCDice commands.
// @description:ko 인세인 룸을 감지해 룸별 캐릭터 시트와 BCDice 판정 입력 기능을 추가합니다.
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
  const VERSION = "0.2.1";
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

  function normalizeTransferSheet(raw, idFactory = makeId) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("시트 데이터가 없습니다.");
    const curiosityNumber = Number(raw.curiosity);
    const curiosity = Number.isInteger(curiosityNumber) && curiosityNumber >= 0 && curiosityNumber < 6 ? curiosityNumber : "";
    const defaultGaps = [false, false, false, false, false];
    if (curiosity !== "") {
      if (curiosity > 0) defaultGaps[curiosity - 1] = true;
      if (curiosity < 5) defaultGaps[curiosity] = true;
    }
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
      abilities: (Array.isArray(raw.abilities) ? raw.abilities : []).slice(0, 100).map((item) => ({
        ...copyJsonObject(item),
        name: cleanText(item?.name, 300), type: cleanText(item?.type, 100), target: cleanText(item?.target, 300),
        cost: cleanText(item?.cost, 100), effect: cleanText(item?.effect, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      people: (Array.isArray(raw.people) ? raw.people : []).slice(0, 100).map((item) => ({
        ...copyJsonObject(item),
        name: cleanText(item?.name, 300), shelter: !!item?.shelter, emotion: cleanText(item?.emotion, 300),
        detail: cleanText(item?.detail, 20_000), extensions: copyJsonObject(item?.extensions)
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
      items: Object.fromEntries(Object.entries(copyJsonObject(raw.items)).slice(0, 100).map(([key, value]) => [cleanText(key, 100), nonNegativeNumber(value)])),
      madnessState: { ...copyJsonObject(raw.madnessState), current: nonNegativeNumber(raw.madnessState?.current), delirium: !!raw.madnessState?.delirium },
      madness: (Array.isArray(raw.madness) ? raw.madness : []).slice(0, 100).map((item) => ({
        ...copyJsonObject(item),
        name: cleanText(item?.name, 300), trigger: cleanText(item?.trigger, 10_000),
        revealed: !!item?.revealed, effect: cleanText(item?.effect, 20_000), extensions: copyJsonObject(item?.extensions)
      })),
      extensions: copyJsonObject(raw.extensions)
    };
  }

  function parseTransferPayload(text, idFactory = makeId) {
    if (typeof text !== "string" || !text.trim()) throw new Error("붙여넣을 JSON이 없습니다.");
    if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES) throw new Error("시트 JSON이 너무 큽니다.");
    let payload;
    try { payload = JSON.parse(text); } catch (error) { throw new Error("올바른 JSON이 아닙니다."); }
    if (payload?.kind !== TRANSFER_KIND) throw new Error("인세인 시트 API 형식이 아닙니다.");
    if (payload.version !== TRANSFER_VERSION) throw new Error(`지원하지 않는 시트 버전: ${payload.version ?? "없음"}`);
    return normalizeTransferSheet(payload.data, idFactory);
  }

  const testHook = window.__CCF_CHARACTER_SHEET_TEST_HOOK__;
  if (testHook && typeof testHook === "object") {
    Object.assign(testHook, { CATEGORIES, isInsaneDicebot, getSkillTarget, clampDialogDrag, isCharacterEditTitle, parseTransferPayload });
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
    tab: "basic",
    renderFrame: 0,
    saveTimer: 0,
    dialogPosition: { x: 0, y: 0 }
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
      name: "CCFOLIA inSANe Character Sheet",
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
    return { version: 1, selectedId: sheet.id, sheets: [sheet] };
  }

  function normalizeData(value) {
    if (!value || !Array.isArray(value.sheets) || !value.sheets.length) return makeData();
    const sheets = value.sheets.map((raw, index) => {
      const base = makeSheet(`시트 ${index + 1}`);
      const sheet = { ...base, ...raw };
      sheet.removedGaps = Array.from({ length: 5 }, (_, i) => !!raw.removedGaps?.[i]);
      sheet.skills = Array.isArray(raw.skills) ? raw.skills.filter(validSkillId) : [];
      sheet.abilities = Array.isArray(raw.abilities) ? raw.abilities : [];
      sheet.people = Array.isArray(raw.people) ? raw.people : [];
      return sheet;
    });
    return { version: 1, selectedId: sheets.some((sheet) => sheet.id === value.selectedId) ? value.selectedId : sheets[0].id, sheets };
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
    button.setAttribute("aria-label", "인세인 캐릭터 시트");
    button.title = "인세인 캐릭터 시트";
    button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>';
    button.addEventListener("click", openSheet, { signal });
    anchor.parentElement.insertBefore(button, anchor.nextSibling);
  }

  function mountCharacterDialogButtons() {
    document.querySelectorAll('.MuiDialog-root, [role="dialog"]').forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || dialog.closest(`#${ROOT_ID}`)) return;
      const title = dialog.querySelector(".MuiAppBar-root, .MuiDialogTitle-root")?.textContent || "";
      const actions = dialog.querySelector(".MuiDialogActions-root");
      if (!isCharacterEditTitle(title) || !actions || actions.querySelector(`[${DIALOG_BUTTON_ATTR}]`)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = actions.querySelector("button")?.className || "";
      button.setAttribute(DIALOG_BUTTON_ATTR, "native-dialog");
      button.setAttribute("aria-label", "인세인 캐릭터 시트 열기");
      button.textContent = "인세인 시트";
      button.addEventListener("click", () => openSheetFromCharacterDialog(dialog), { signal });
      actions.appendChild(button);
    });
  }

  function openSheetFromCharacterDialog(dialog) {
    const closeLabels = ["닫기", "close", "閉じる", "关闭"];
    const closeButton = [...dialog.querySelectorAll("button")].find((button) => {
      const label = normalizedText(`${button.getAttribute("aria-label") || ""} ${button.title || ""}`);
      return button.getAttribute(DIALOG_BUTTON_ATTR) == null && closeLabels.some((item) => label.includes(item));
    }) || dialog.querySelector(".MuiAppBar-root button");
    closeButton?.click();
    setTimeout(openSheet, 80);
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
    const sheet = currentSheet();
    root.innerHTML = `
      <div class="ccf-cs-backdrop" data-action="close"></div>
      <section class="ccf-cs-dialog" role="dialog" aria-modal="true" aria-labelledby="ccf-cs-title">
        <header><h2 id="ccf-cs-title">인세인 캐릭터 시트</h2><button class="ccf-cs-icon" data-action="close" aria-label="닫기" title="닫기">×</button></header>
        <div class="ccf-cs-sheetbar">
          <select data-action="select-sheet" aria-label="캐릭터 시트 선택">${state.data.sheets.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === sheet.id ? " selected" : ""}>${escapeHtml(item.name || "이름 없음")}</option>`).join("")}</select>
          <button data-action="import-sheet" title="관리 도구 시트 API 붙여넣기">붙여넣기</button>
          <button class="ccf-cs-icon" data-action="add-sheet" aria-label="시트 추가" title="시트 추가">＋</button>
          <button class="ccf-cs-icon" data-action="delete-sheet" aria-label="시트 삭제" title="시트 삭제">−</button>
          <span id="ccf-cs-status" role="status" aria-live="polite"></span>
        </div>
        <nav class="ccf-cs-tabs" aria-label="시트 항목">${[["basic", "기본"], ["skills", "특기"], ["abilities", "어빌리티"], ["people", "인물"], ["notes", "메모"]].map(([id, label]) => `<button data-tab="${id}" aria-selected="${state.tab === id}">${label}</button>`).join("")}</nav>
        <main>${renderTab(sheet)}</main>
        <footer>${TABLE_COMMANDS.map(([label, command]) => `<button data-command="${command}" title="${label} 명령 입력">${label}</button>`).join("")}<button class="ccf-cs-save" data-action="save">저장</button></footer>
      </section>`;
    const dialog = root.querySelector(".ccf-cs-dialog");
    dialog.style.transform = `translate3d(${state.dialogPosition.x}px,${state.dialogPosition.y}px,0)`;
    enableDialogDrag(dialog);
  }

  function enableDialogDrag(dialog) {
    const handle = dialog?.querySelector("header");
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button,input,select,textarea,a") || innerWidth <= 700) return;
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

  function renderTab(sheet) {
    if (state.tab === "skills") return renderSkills(sheet);
    if (state.tab === "abilities") return renderRepeaters("abilities", sheet.abilities, [["name", "이름"], ["type", "종류"], ["target", "지정 특기"], ["cost", "코스트"], ["effect", "효과"]]);
    if (state.tab === "people") return renderRepeaters("people", sheet.people, [["name", "이름"], ["emotion", "감정"], ["detail", "설명"]]);
    if (state.tab === "notes") return `<div class="ccf-cs-notes">${textArea("mission", "사명", sheet.mission)}${textArea("secret", "비밀", sheet.secret)}${textArea("memo", "메모", sheet.memo)}</div>`;
    const skillOptions = CATEGORIES.flatMap((category, column) => category.slice(1).map((name, row) => `<option value="${column}:${row}"${sheet.fear === `${column}:${row}` ? " selected" : ""}>${category[0]} · ${name}</option>`)).join("");
    return `<div class="ccf-cs-basic">
      ${field("name", "이름", sheet.name)}${field("player", "플레이어", sheet.player)}${field("age", "나이", sheet.age)}${field("gender", "성별", sheet.gender)}${field("occupation", "직업", sheet.occupation)}
      ${numberField("life", "생명력", sheet.life)}${numberField("lifeMax", "최대 생명력", sheet.lifeMax)}${numberField("sanity", "이성치", sheet.sanity)}${numberField("sanityMax", "최대 이성치", sheet.sanityMax)}
      <label>호기심 분야<select data-field="curiosity"><option value="">선택 안 함</option>${CATEGORIES.map((category, index) => `<option value="${index}"${String(index) === String(sheet.curiosity) ? " selected" : ""}>${category[0]}</option>`).join("")}</select></label>
      <label>공포심<select data-field="fear"><option value="">선택 안 함</option>${skillOptions}</select></label>
      <fieldset class="ccf-cs-gaps"><legend>무시할 갭</legend>${sheet.removedGaps.map((checked, index) => `<label><input type="checkbox" data-gap="${index}"${checked ? " checked" : ""}> ${CATEGORIES[index][0]}–${CATEGORIES[index + 1][0]}</label>`).join("")}</fieldset>
    </div>`;
  }

  function renderSkills(sheet) {
    return `<div class="ccf-cs-skills">${CATEGORIES.map((category, column) => `<section><h3>${category[0]}</h3>${category.slice(1).map((name, row) => {
      const id = `${column}:${row}`;
      const target = getSkillTarget(sheet.skills, id, sheet.removedGaps);
      return `<div class="ccf-cs-skill${sheet.fear === id ? " is-fear" : ""}"><input type="checkbox" data-skill="${id}" aria-label="${name} 습득"${sheet.skills.includes(id) ? " checked" : ""}><button data-roll="${id}" title="${name} 판정 입력">${name}<small>${target || "–"}</small></button></div>`;
    }).join("")}</section>`).join("")}</div>`;
  }

  function renderRepeaters(key, items, fields) {
    return `<div class="ccf-cs-repeaters">${items.map((item, index) => `<section>${fields.map(([fieldName, label]) => `<label>${label}${fieldName === "effect" || fieldName === "detail" ? `<textarea data-list="${key}" data-index="${index}" data-prop="${fieldName}">${escapeHtml(item[fieldName] || "")}</textarea>` : `<input data-list="${key}" data-index="${index}" data-prop="${fieldName}" value="${escapeHtml(item[fieldName] || "")}">`}</label>`).join("")}<button class="ccf-cs-remove" data-remove="${key}" data-index="${index}" aria-label="삭제">삭제</button></section>`).join("")}<button data-add="${key}">＋ 추가</button></div>`;
  }

  function field(name, label, value) {
    return `<label>${label}<input data-field="${name}" value="${escapeHtml(value)}"></label>`;
  }

  function numberField(name, label, value) {
    return `<label>${label}<input type="number" min="0" data-field="${name}" value="${Number(value) || 0}"></label>`;
  }

  function textArea(name, label, value) {
    return `<label>${label}<textarea data-field="${name}">${escapeHtml(value)}</textarea></label>`;
  }

  function handleInput(event) {
    const target = event.target;
    const sheet = currentSheet();
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    if (target.dataset.action === "select-sheet") {
      state.data.selectedId = target.value;
      render();
      saveSoon();
      return;
    }
    if (target.dataset.field) {
      const key = target.dataset.field;
      sheet[key] = target.type === "number" ? Number(target.value) : target.value;
      if (key === "curiosity") {
        sheet.removedGaps.fill(false);
        const column = Number(target.value);
        if (Number.isInteger(column)) {
          if (column > 0) sheet.removedGaps[column - 1] = true;
          if (column < 5) sheet.removedGaps[column] = true;
        }
        render();
      } else if (key === "name") {
        const option = document.querySelector(`#${ROOT_ID} select[data-action="select-sheet"] option:checked`);
        if (option) option.textContent = target.value || "이름 없음";
      }
      saveSoon();
      return;
    }
    if (target.dataset.gap != null) {
      sheet.removedGaps[Number(target.dataset.gap)] = target.checked;
      render();
      saveSoon();
      return;
    }
    if (target.dataset.skill) {
      sheet.skills = target.checked ? [...new Set([...sheet.skills, target.dataset.skill])] : sheet.skills.filter((id) => id !== target.dataset.skill);
      render();
      saveSoon();
      return;
    }
    if (target.dataset.list) {
      const item = sheet[target.dataset.list]?.[Number(target.dataset.index)];
      if (item) item[target.dataset.prop] = target.value;
      saveSoon();
    }
  }

  function handleClick(event) {
    if (event.target.classList.contains("ccf-cs-backdrop")) return closeSheet();
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.action === "close") return closeSheet();
    if (button.dataset.tab) { state.tab = button.dataset.tab; return render(); }
    if (button.dataset.action === "save") return saveData();
    if (button.dataset.action === "import-sheet") return readTransferFromClipboard();
    if (button.dataset.action === "add-sheet") {
      const sheet = makeSheet(`시트 ${state.data.sheets.length + 1}`);
      state.data.sheets.push(sheet); state.data.selectedId = sheet.id; render(); saveSoon(); return;
    }
    if (button.dataset.action === "delete-sheet") {
      if (state.data.sheets.length === 1) return status("시트 1개는 남아야 함");
      if (!confirm("현재 시트를 삭제할까요?")) return;
      state.data.sheets = state.data.sheets.filter((sheet) => sheet.id !== state.data.selectedId);
      state.data.selectedId = state.data.sheets[0].id; render(); saveSoon(); return;
    }
    if (button.dataset.add) {
      currentSheet()[button.dataset.add].push({}); render(); saveSoon(); return;
    }
    if (button.dataset.remove) {
      currentSheet()[button.dataset.remove].splice(Number(button.dataset.index), 1); render(); saveSoon(); return;
    }
    if (button.dataset.command) return writeChat(button.dataset.command);
    if (button.dataset.roll) return inputSkillRoll(button.dataset.roll);
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
      state.data.sheets.push(sheet);
      state.data.selectedId = sheet.id;
      state.tab = "basic";
      state.open = true;
      ensureRoot();
      render();
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
      [${ICON_ATTR}] { all:unset;box-sizing:border-box;width:40px;height:40px;margin:0 2px;color:inherit;display:inline-grid;place-items:center;border-radius:50%;cursor:pointer;vertical-align:middle }
      [${ICON_ATTR}]:hover { background:rgba(255,255,255,.1) }
      [${DIALOG_BUTTON_ATTR}] { white-space:nowrap }
      #${ROOT_ID},#${ROOT_ID} * { box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0 }
      #${ROOT_ID} { position:fixed;inset:0;z-index:2147483000;color:#eee;font-size:14px }
      #${ROOT_ID} .ccf-cs-backdrop { position:absolute;inset:0;background:rgba(0,0,0,.64) }
      #${ROOT_ID} .ccf-cs-dialog { position:absolute;inset:12px;margin:auto;width:min(980px,calc(100vw - 24px));height:min(820px,calc(100vh - 24px));display:grid;grid-template-rows:56px 50px 44px minmax(0,1fr) auto;background:#212121;border:1px solid #555;border-radius:4px;box-shadow:0 12px 32px rgba(0,0,0,.55);overflow:hidden }
      #${ROOT_ID} header,#${ROOT_ID} .ccf-cs-sheetbar,#${ROOT_ID} footer { display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid #424242 }
      #${ROOT_ID} header { cursor:move;touch-action:none;user-select:none }
      #${ROOT_ID} header h2 { margin:0;font-size:.875rem;font-weight:bold;flex:1 }
      #${ROOT_ID} button,#${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea { font:inherit;color:inherit }
      #${ROOT_ID} button { min-height:34px;padding:0 12px;background:#303030;border:1px solid #555;border-radius:2px;cursor:pointer }
      #${ROOT_ID} button:hover { background:#3d3d3d }
      #${ROOT_ID} .ccf-cs-icon { width:36px;min-width:36px;padding:0;font-size:24px;border:0;background:transparent }
      #${ROOT_ID} .ccf-cs-sheetbar select { min-width:0;max-width:260px }
      #${ROOT_ID} #ccf-cs-status { margin-left:auto;color:#aaa;font-size:12px }
      #${ROOT_ID} .ccf-cs-tabs { display:flex;border-bottom:1px solid #424242;overflow-x:auto }
      #${ROOT_ID} .ccf-cs-tabs button { flex:1;min-width:86px;border:0;border-radius:0;background:transparent }
      #${ROOT_ID} .ccf-cs-tabs button[aria-selected="true"] { color:#f50057;border-bottom:2px solid #f50057 }
      #${ROOT_ID} main { min-height:0;overflow:auto;padding:16px }
      #${ROOT_ID} label { display:grid;gap:5px;color:#bdbdbd }
      #${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea { width:100%;min-height:36px;padding:7px 9px;background:#303030;border:1px solid #616161;border-radius:2px }
      #${ROOT_ID} textarea { min-height:100px;resize:vertical }
      #${ROOT_ID} .ccf-cs-basic { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px }
      #${ROOT_ID} .ccf-cs-gaps { grid-column:1/-1;display:flex;flex-wrap:wrap;gap:12px;border:1px solid #555;padding:12px }
      #${ROOT_ID} .ccf-cs-gaps label { display:flex;align-items:center;gap:4px }
      #${ROOT_ID} .ccf-cs-gaps input,#${ROOT_ID} .ccf-cs-skill input { width:18px;min-height:18px;accent-color:#f50057 }
      #${ROOT_ID} .ccf-cs-skills { display:grid;grid-template-columns:repeat(6,minmax(118px,1fr));gap:1px;background:#555;border:1px solid #555;min-width:760px }
      #${ROOT_ID} .ccf-cs-skills section { background:#262626 }
      #${ROOT_ID} .ccf-cs-skills h3 { margin:0;padding:10px;text-align:center;font-size:14px;background:#303030 }
      #${ROOT_ID} .ccf-cs-skill { display:flex;align-items:center;gap:4px;padding:3px 5px;border-top:1px solid #3d3d3d }
      #${ROOT_ID} .ccf-cs-skill.is-fear { box-shadow:inset 3px 0 #d32f2f }
      #${ROOT_ID} .ccf-cs-skill button { flex:1;display:flex;justify-content:space-between;align-items:center;border:0;background:transparent;padding:0 5px }
      #${ROOT_ID} .ccf-cs-skill small { color:#9e9e9e }
      #${ROOT_ID} .ccf-cs-repeaters { display:grid;gap:12px }
      #${ROOT_ID} .ccf-cs-repeaters section { display:grid;grid-template-columns:repeat(5,minmax(0,1fr)) auto;gap:10px;padding-bottom:12px;border-bottom:1px solid #555 }
      #${ROOT_ID} .ccf-cs-remove { align-self:end }
      #${ROOT_ID} .ccf-cs-notes { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px }
      #${ROOT_ID} footer { flex-wrap:wrap;border-top:1px solid #424242;border-bottom:0 }
      #${ROOT_ID} footer .ccf-cs-save { margin-left:auto;color:#f50057;font-weight:bold }
      @media (max-width:700px) {
        #${ROOT_ID} .ccf-cs-dialog { inset:0;width:100vw;height:100vh;border:0;border-radius:0;transform:none!important }
        #${ROOT_ID} header { cursor:default }
        #${ROOT_ID} .ccf-cs-basic { grid-template-columns:repeat(2,minmax(0,1fr)) }
        #${ROOT_ID} .ccf-cs-repeaters section,#${ROOT_ID} .ccf-cs-notes { grid-template-columns:1fr }
        #${ROOT_ID} main { padding:10px }
      }
    `;
    document.documentElement.appendChild(style);
  }
})();
