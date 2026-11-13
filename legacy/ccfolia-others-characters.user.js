// ==UserScript==
// @name         CCFOLIA Others' Characters in My Character List by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-others-characters
// @version      0.1.6
// @description  GM only: shows the characters owned by other people inside CCFOLIA's "My characters" list (shaded rows with a small owner icon); clicking one opens CCFOLIA's own edit dialog.
// @description:ko GM 화면에서만: 코코포리아 '내 캐릭터 목록' 안에 다른 사람 소유 캐릭터를 옅은 음영 + 작은 소유자 아이콘 행으로 함께 보여 주고, 클릭하면 코코포리아 편집창을 엽니다(삭제 버튼 없음).
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * GM 이 만든 캐릭터의 소유권을 참가자가 가져가면 GM 의 '내 캐릭터 목록'(owner = 내 uid)에서 사라진다. 코코포리아는 누구나 다른 사람 소유 캐릭터를 편집할 수 있으므로(번들 확인: 비밀 캐릭터만 소유자·편집 권한자 제한)
 * 목록 끝에 다른 사람 소유 캐릭터를 이어 붙인다. 네이티브 행 하나를 본떠 만들고(React 가 다시 그려도 값이 같으면 DOM 을 건드리지 않는다), 삭제 같은 네이티브 버튼은 넣지 않는다.
 * 편집창은 코코포리아의 보드 캐릭터 더블클릭과 같은 상태 변경(app/state/seted: openRoomCharacter + openRoomCharacterId)으로 연다.
 * 행 자체는 룸의 룰·다이스봇과 무관하게 모든 룸에서 붙는다. 인세인 룸이면 사이코로픽션 시트 버튼도 붙는다(시트 스크립트의 __CCF_CHARACTER_SHEET_DEBUG__.openForCharacter).
 */
(() => {
  "use strict";
  if (location.hostname !== "ccfolia.com" && !location.hostname.endsWith(".ccfolia.com")) return;
  const VERSION = "0.1.6";
  const ROW_ATTR = "data-ccf-others-row";
  const SAFE_ATTR = "data-capybara-toolkit-others";
  const DELETE_LABELS = ["토큰을 화면에서 삭제", "Remove token from screen", "コマを画面から削除"];
  const OWNER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const SHEET_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 8 3 8-3-8-3z"/><path d="m4 10 1 8 7 3 7-3 1-8M12 13v8"/><path d="M4 10 2 7l7-3 3 3M12 7l3-3 7 2-2 4"/></svg>';

  try { window.__CCF_OTHERS_CHARS__?.disable?.(); } catch (error) { /* 이전 인스턴스 정리 실패 */ }
  const abort = new AbortController();
  const state = { store: null, frame: 0, unsubscribe: null, finder: 0, syncCount: 0, lastSyncAt: 0, lastSyncResult: "", lastError: "", speakerInjected: 0, speakerReason: "아직 화자 선택창을 못 봄" };
  const SPEAKER_ATTR = "data-ccf-others-speaker";

  function findStore() {
    if (state.store) return state.store;
    const root = document.getElementById("root") || document.body?.firstElementChild;
    const key = root ? Object.keys(root).find((name) => name.startsWith("__reactContainer")) : "";
    const fiber = key ? root[key]?.stateNode?.current : null;
    if (!fiber) return null;
    const isStore = (value) => value && typeof value === "object" && typeof value.dispatch === "function" && typeof value.getState === "function" && typeof value.subscribe === "function";
    const seen = new WeakSet();
    let found = null;
    const visit = (value) => { if (found || !value || typeof value !== "object" || seen.has(value)) return; seen.add(value); if (isStore(value)) found = value; };
    const walk = (node, depth = 0) => {
      if (found || !node || depth > 50) return;
      visit(node.memoizedProps); visit(node.memoizedState); visit(node.stateNode);
      if (node.memoizedProps?.store) visit(node.memoizedProps.store);
      if (node.memoizedProps?.value) visit(node.memoizedProps.value);
      walk(node.child, depth + 1); walk(node.sibling, depth + 1);
    };
    walk(fiber);
    return found;
  }

  // GM(방장)이고 다른 사람 소유 캐릭터가 있으면 그 목록, 아니면 null(= 행을 넣지 않는다)
  function readOthers() {
    const store = state.store;
    const snapshot = store?.getState?.();
    const uid = snapshot?.app?.user?.uid;
    const roomId = snapshot?.app?.state?.roomId;
    const room = roomId ? snapshot?.entities?.rooms?.entities?.[roomId] : null;
    if (!uid || !room?.owner || room.owner !== uid) return null; // GM 화면에서만
    const members = snapshot?.app?.room?.members?.entities || {};
    const list = [];
    for (const [id, character] of Object.entries(snapshot?.entities?.roomCharacters?.entities || {})) {
      if (!character || !character.owner || character.owner === uid) continue;
      list.push({ id, rawName: String(character.name || ""), name: String(character.name || "").trim() || "NONAME", icon: /^https?:\/\//i.test(character.iconUrl || "") ? character.iconUrl : "", order: Number(character.order) || 0, owner: String(character.owner), ownerName: String(members[character.owner]?.displayName || "").trim() });
    }
    list.sort((a, b) => (a.ownerName || a.owner).localeCompare(b.ownerName || b.owner, "ko") || a.order - b.order || a.name.localeCompare(b.name, "ko"));
    return list;
  }

  // 코코포리아 보드 토큰 더블클릭과 같은 상태 변경: 편집창 열기
  function openEditor(id) {
    const store = state.store;
    const appState = store?.getState?.()?.app?.state;
    if (!store || !appState || !("openRoomCharacterId" in appState)) return false;
    store.dispatch({ type: "app/state/seted", payload: { ...appState, openRoomCharacter: true, openRoomCharacterId: id } });
    return true;
  }

  const labelOf = (node) => `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`;
  const isNativeRow = (row) => !row.hasAttribute(ROW_ATTR);
  // 실제 코코포리아의 "내 캐릭터 목록"은 MUI Dialog 가 아니라 떠 있는 Paper 패널(제목 h6)이다. 제목으로 패널을 찾고, 대화상자(Dialog)로 그려진 경우도 같이 본다.
  const PANEL_TITLES = ["내캐릭터목록", "mycharacters", "マイキャラクター", "キャラクター一覧", "캐릭터목록"];
  const normalize = (text) => String(text || "").replace(/\s+/g, "").toLowerCase();
  // 제목 h6 를 감싸는 가장 가까운 Paper 는 제목 줄(AppBar 도 MuiPaper-root)이다. 목록(.scrollable-list / 행 이름)을 품은 바깥 Paper(창)까지 올라간다.
  function windowOf(heading) {
    let fallback = null;
    for (let node = heading.parentElement; node; node = node.parentElement) {
      if (node.matches?.(".MuiPaper-root, [role='dialog']")) {
        fallback = node;
        if (node.querySelector(".scrollable-list, .MuiListItemText-primary")) return node;
      }
      if (node === document.body) break;
    }
    return fallback;
  }
  function listPanels() {
    const panels = new Set();
    document.querySelectorAll('.MuiDialog-root, [role="dialog"]').forEach((dialog) => { if (dialog.querySelector("button[aria-label], button[title]")) panels.add(dialog); });
    document.querySelectorAll("h6, h5, h4, h3, h2").forEach((heading) => {
      if (!PANEL_TITLES.includes(normalize(heading.textContent))) return;
      const panel = windowOf(heading);
      if (panel instanceof HTMLElement) panels.add(panel);
    });
    return [...panels].filter((panel) => panel.getClientRects().length);
  }
  // 내 캐릭터가 하나도 없는 GM(복제할 네이티브 행이 없음)을 위한 직접 그린 행: MUI ListItem 과 같은 클래스·모양.
  function fallbackTemplate() {
    const li = document.createElement("li");
    li.className = "MuiListItem-root MuiListItem-gutters MuiListItem-padding";
    li.style.cssText = "display:flex;align-items:center;gap:12px;padding:8px 16px;list-style:none;box-sizing:border-box;width:100%";
    const avatar = document.createElement("div");
    avatar.className = "MuiListItemAvatar-root";
    avatar.style.cssText = "flex:none;width:40px;height:40px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.12)";
    const image = document.createElement("img");
    image.className = "MuiAvatar-img";
    image.style.cssText = "width:40px;height:40px;object-fit:cover;display:block";
    avatar.append(image);
    const text = document.createElement("div");
    text.className = "MuiListItemText-root";
    text.style.cssText = "flex:1;min-width:0";
    const name = document.createElement("h6");
    name.className = "MuiTypography-root MuiListItemText-primary";
    name.style.cssText = "margin:0;font:inherit;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    text.append(name);
    li.append(avatar, text);
    return li;
  }

  // 코코포리아 번들로 확인한 실제 구조(내 캐릭터 목록 = 떠 있는 창): Paper > [제목 줄 | .scrollable-list > div > 정렬 목록 div > (클래스 없는 position:relative 래퍼 div > ListItem(button, dense) + 보조 동작)].
  // 행의 삭제 버튼 이름(번역)이나 켜짐 여부(켜져 있지 않은 캐릭터는 "추가" 버튼)에 기대지 않고, 행 안의 이름 글자(.MuiListItemText-primary)로 행을 찾는다.
  function rowOf(node) {
    let row = node.closest(".MuiListItem-container, .MuiListItem-root, li, [role='listitem']");
    if (!row) return null;
    if (row.parentElement?.classList.contains("MuiListItem-container")) row = row.parentElement;
    // 정렬용 래퍼(클래스 없는 div, 자식 하나)까지 올라간다: 형제 행은 그 래퍼의 형제다
    while (row.parentElement && !row.parentElement.className && row.parentElement.children.length === 1 && !row.parentElement.matches("ul, ol, [role='list']")) row = row.parentElement;
    return row;
  }

  function nativeRows(panel) {
    const rows = [];
    panel.querySelectorAll(".MuiListItemText-primary").forEach((name) => {
      if (name.closest(`[${ROW_ATTR}]`)) return;
      const row = rowOf(name);
      if (row && isNativeRow(row) && !rows.includes(row)) rows.push(row);
    });
    return rows;
  }

  // 네이티브 행이 없을 때 직접 그린 행을 붙일 목록 칸: MUI List 가 있으면 그것, 없으면 스크롤 영역(.scrollable-list)의 안쪽 div
  function listContainer(panel) {
    return panel.querySelector("ul.MuiList-root, [role='list'], ul") || panel.querySelector(".scrollable-list > div") || panel.querySelector(".scrollable-list");
  }

  function buildRow(template, entry, sheetApi) {
    const row = template.cloneNode(true);
    row.removeAttribute("id");
    row.setAttribute(ROW_ATTR, entry.id);
    row.setAttribute(SAFE_ATTR, "1");
    row.querySelectorAll("button, [data-ccf-character-sheet-row-button]").forEach((node) => node.remove()); // 삭제 등 네이티브 버튼은 넣지 않는다
    row.style.background = "rgba(255,255,255,.06)";
    row.style.cursor = "pointer";
    const ownerLabel = entry.ownerName ? `소유자: ${entry.ownerName}` : "다른 사람 소유";
    row.title = ownerLabel;
    const primary = row.querySelector(".MuiListItemText-primary, h6");
    if (primary) primary.textContent = entry.name; else row.append(document.createTextNode(entry.name));
    row.querySelectorAll(".MuiListItemText-secondary").forEach((node) => node.remove());
    const image = row.querySelector("img");
    if (image) { if (entry.icon) { image.src = entry.icon; image.alt = ""; image.referrerPolicy = "no-referrer"; } else image.removeAttribute("src"); }
    else {
      const styled = [...row.querySelectorAll("[style*='background-image']")][0];
      if (styled) styled.style.backgroundImage = entry.icon ? `url("${entry.icon}")` : "none";
    }
    const badge = document.createElement("span");
    badge.setAttribute(SAFE_ATTR, "1");
    badge.title = ownerLabel;
    badge.style.cssText = "display:inline-flex;align-items:center;gap:4px;flex:none;margin:0 4px;color:rgba(255,255,255,.6);font-size:12px";
    badge.innerHTML = `${OWNER_ICON}${entry.ownerName ? `<span>${entry.ownerName.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])}</span>` : ""}`;
    row.append(badge);
    const stop = (event) => event.stopPropagation();
    if (sheetApi) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(SAFE_ATTR, "1");
      button.setAttribute("aria-label", "사이코로픽션 시트");
      button.title = "사이코로픽션 시트";
      button.style.cssText = "display:inline-grid;place-items:center;flex:none;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:none;color:inherit;cursor:pointer";
      button.innerHTML = SHEET_ICON;
      button.addEventListener("click", (event) => { event.stopPropagation(); event.preventDefault(); sheetApi.openForCharacter(entry.name); }, { signal: abort.signal });
      for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart"]) button.addEventListener(type, stop, { signal: abort.signal });
      row.append(button);
    }
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.addEventListener("click", (event) => { event.preventDefault(); openEditor(entry.id); }, { signal: abort.signal });
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEditor(entry.id); } }, { signal: abort.signal });
    return row;
  }

  function clearRows() { document.querySelectorAll(`[${ROW_ATTR}]`).forEach((node) => node.remove()); }

  // ---- 채팅 화자(캐릭터) 선택창 ----
  // 코코포리아의 선택창(번들 0f872b7d hW)은 Popover 안 목록이고, 항목 컴포넌트(nW)는 props { characterId, onSelect, isActive } 를 받는다. onSelect(이름, id) 는 앱 상태
  // roomChatName/roomChatId 를 바꾸고 창을 닫는다. 발화 캐릭터는 roomChatId 가 있고 이름이 같으면 "전체" 캐릭터에서 찾으므로(getCurrentRoomChatCharacter) 남의 캐릭터도 그 이름·아이콘·색으로 말한다.
  // 그래서 같은 onSelect 를 그대로 부른다. 항목 props 는 항목 요소의 React 파이버를 몇 단계 올라가 읽는다.
  function speakerPropsOf(element) {
    try {
      const key = Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
      for (let fiber = key ? element[key] : null, depth = 0; fiber && depth < 8; fiber = fiber.return, depth += 1) {
        const props = fiber.memoizedProps;
        if (props && typeof props.characterId === "string" && typeof props.onSelect === "function") return props;
      }
    } catch (_) { /* 못 읽음 */ }
    return null;
  }
  function findSpeakerMenu() {
    for (const popover of document.querySelectorAll(".MuiPopover-root, .MuiMenu-root")) {
      const items = [...popover.querySelectorAll(".MuiMenuItem-root, .MuiListItem-root, .MuiListItemButton-root, [role='menuitem']")].filter((node) => !node.hasAttribute(SPEAKER_ATTR));
      const withProps = items.map((node) => ({ node, props: speakerPropsOf(node) })).filter((entry) => entry.props);
      if (withProps.length) return { popover, items: withProps.map((entry) => entry.node), onSelect: withProps[0].props.onSelect };
    }
    return null;
  }
  function buildSpeakerRow(template, entry, onSelect) {
    const row = template.cloneNode(true);
    row.setAttribute(SPEAKER_ATTR, entry.id);
    row.setAttribute(SAFE_ATTR, "1");
    row.classList.remove("Mui-selected", "Mui-focusVisible");
    row.removeAttribute("id");
    row.tabIndex = -1;
    row.title = `소유자: ${entry.ownerName || entry.owner.slice(0, 6)}`;
    row.style.background = "rgba(255, 255, 255, 0.04)";
    const img = row.querySelector("img");
    if (img) { if (entry.icon) img.src = entry.icon; else img.removeAttribute("src"); }
    const primary = row.querySelector(".MuiListItemText-primary");
    if (primary) primary.textContent = entry.name;
    const secondary = row.querySelector(".MuiListItemText-secondary");
    if (secondary) { secondary.innerHTML = `${OWNER_ICON} `; secondary.append(document.createTextNode(entry.ownerName || "다른 사람")); secondary.style.display = "inline-flex"; secondary.style.alignItems = "center"; secondary.style.gap = "4px"; }
    // 이름이 빈 캐릭터는 코코포리아가 발화 캐릭터로 고를 수 없다(이름으로 맞춰 본다): NONAME 으로 보이되 누를 수 없다
    const usable = entry.name !== "NONAME" || entry.rawName;
    if (!usable) { row.style.opacity = "0.5"; row.style.pointerEvents = "none"; row.title += " · 이름이 없어 발화할 수 없음"; }
    const choose = (event) => { event.preventDefault(); event.stopPropagation(); try { onSelect(entry.rawName, entry.id); } catch (error) { state.lastError = String(error?.message || error); } };
    row.addEventListener("click", choose, { signal: abort.signal });
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") choose(event); }, { signal: abort.signal });
    return row;
  }
  function syncSpeakerMenu() {
    const menu = findSpeakerMenu();
    if (!menu) { if (!document.querySelector(".MuiPopover-root, .MuiMenu-root")) state.speakerReason = "화자 선택창이 열려 있지 않음"; return 0; }
    const others = readOthers();
    if (!others) { menu.popover.querySelectorAll(`[${SPEAKER_ATTR}]`).forEach((node) => node.remove()); state.speakerReason = "GM(방장) 화면이 아님"; return 0; }
    const last = menu.items[menu.items.length - 1];
    const present = [...menu.popover.querySelectorAll(`[${SPEAKER_ATTR}]`)];
    const signature = JSON.stringify(others.map((c) => [c.id, c.name, c.icon, c.ownerName]));
    if (menu.popover.getAttribute("data-ccf-others-speaker-sig") === signature && present.length === others.length && last.nextElementSibling === present[0]) { state.speakerReason = `정상: ${present.length}명 표시`; return 0; }
    present.forEach((node) => node.remove());
    menu.popover.setAttribute("data-ccf-others-speaker-sig", signature);
    let anchor = last;
    for (const entry of others) { const row = buildSpeakerRow(last, entry, menu.onSelect); anchor.after(row); anchor = row; }
    state.speakerInjected += others.length;
    state.speakerReason = others.length ? `정상: ${others.length}명 표시` : "다른 사람 소유 캐릭터가 없음";
    return others.length;
  }

  // sync 는 예외를 삼키지 않고 기록한다(diag 의 lastError / lastSyncResult)
  function sync() {
    state.frame = 0;
    state.syncCount += 1; state.lastSyncAt = Date.now();
    try {
      const inserted = syncInner();
      state.lastSyncResult = state.store ? `ok: ${inserted || 0}행 새로 붙임, DOM 의 다른 사람 행 ${document.querySelectorAll(`[${ROW_ATTR}]`).length}` : "저장소 없음";
      state.lastError = "";
    } catch (error) { state.lastError = String(error?.stack || error?.message || error).slice(0, 300); state.lastSyncResult = "예외"; }
  }

  function syncInner() {
    let inserted = 0;
    if (!state.store) return 0;
    inserted += syncSpeakerMenu();
    const dialogs = listPanels();
    if (!dialogs.length) { if (document.querySelector(`[${ROW_ATTR}]`)) clearRows(); return inserted; }
    const others = readOthers();
    if (!others) { if (document.querySelector(`[${ROW_ATTR}]`)) clearRows(); return inserted; }
    const sheetApi = (() => { const api = window.__CCF_CHARACTER_SHEET_DEBUG__; return api?.detected?.() && typeof api.openForCharacter === "function" ? api : null; })();
    for (const dialog of dialogs) {
      let rows = nativeRows(dialog);
      let template = rows[0];
      let last = rows[rows.length - 1];
      let parent = last?.parentElement;
      if (!rows.length) {
        // 네이티브 행이 없다: 패널 안의 목록(ul / role=list)이 있으면 거기에, 직접 그린 행으로
        const own = listContainer(dialog);
        if (!own) continue;
        parent = own;
        template = fallbackTemplate();
        last = [...own.children].filter((node) => !node.hasAttribute(ROW_ATTR)).pop() || null;
      }
      if (!parent) continue;
      const signature = JSON.stringify([others.map((c) => [c.id, c.name, c.icon, c.ownerName]), !!sheetApi]);
      // 행이 늦게 그려지기 전에 직접 그린 행을 다른 칸에 붙였다면(네이티브 행이 없던 때) 걷어낸다: 목록 칸이 바뀌면 이전 칸의 행은 남기지 않는다
      dialog.querySelectorAll(`[${ROW_ATTR}]`).forEach((node) => { if (node.parentElement !== parent) node.remove(); });
      const present = [...parent.children].filter((node) => node.hasAttribute(ROW_ATTR));
      // 이미 같은 목록이 맨 끝에 같은 순서로 붙어 있으면 아무것도 쓰지 않는다
      if (parent.getAttribute("data-ccf-others-sig") === signature && present.length === others.length && present.every((node, index) => node.getAttribute(ROW_ATTR) === others[index].id) && (last ? last.nextElementSibling : parent.firstElementChild) === present[0] || (!others.length && !present.length)) continue;
      present.forEach((node) => node.remove());
      parent.setAttribute("data-ccf-others-sig", signature);
      let anchor = last;
      for (const entry of others) { const row = buildRow(template, entry, sheetApi); if (anchor) anchor.after(row); else parent.prepend(row); anchor = row; inserted += 1; }
    }
    return inserted;
  }

  function schedule() { if (!state.frame) state.frame = requestAnimationFrame(sync); }

  function attach() {
    const store = findStore();
    if (!store) return false;
    state.store = store;
    state.unsubscribe = store.subscribe(schedule);
    schedule();
    return true;
  }

  const observer = new MutationObserver((records) => {
    if (records.every((record) => record.target instanceof Element && record.target.closest(`[${SAFE_ATTR}="1"]`))) return;
    schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function disable() {
    abort.abort();
    document.querySelectorAll(`[${SPEAKER_ATTR}]`).forEach((node) => node.remove());
    observer.disconnect();
    cancelAnimationFrame(state.frame);
    clearInterval(state.finder);
    try { state.unsubscribe?.(); } catch (error) { /* ignore */ }
    clearRows();
  }

  // 안 보이는 이유를 돌려준다(읽기만 한다): window.__CCF_OTHERS_CHARS__.diag()
  function diag() {
    sync(); // 호출할 때 실제로 한 번 돌린다(주입 포함): 결과는 아래 lastSyncResult / lastError
    const out = { syncCount: state.syncCount, lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : "", lastSyncResult: state.lastSyncResult, lastError: state.lastError, otherNames: [], version: VERSION, store: !!state.store, gm: null, reason: "", room: null, uid: "", panels: [], characters: 0, ownedByOthers: 0, othersListed: 0, rowsInDom: document.querySelectorAll(`[${ROW_ATTR}]`).length, speaker: null };
    const snapshot = state.store?.getState?.();
    if (!snapshot) { out.reason = "저장소를 아직 못 찾음"; return out; }
    const uid = snapshot?.app?.user?.uid || "";
    const roomId = snapshot?.app?.state?.roomId || "";
    const room = roomId ? snapshot?.entities?.rooms?.entities?.[roomId] : null;
    out.uid = uid ? uid.slice(0, 6) + "…" : ""; out.room = roomId || null;
    out.gm = !!(uid && room?.owner && room.owner === uid);
    const all = Object.values(snapshot?.entities?.roomCharacters?.entities || {});
    out.characters = all.length;
    out.ownedByOthers = all.filter((c) => c && c.owner && c.owner !== uid).length;
    const listed = readOthers() || [];
    out.othersListed = listed.length;
    out.otherNames = listed.map((entry) => Array.from(entry.name).slice(0, 4).join(""));
    const panels = listPanels();
    out.titleCandidates = [...document.querySelectorAll("h6, h5, h4, h3, h2")].filter((heading) => PANEL_TITLES.includes(normalize(heading.textContent))).map((heading) => ({ visible: heading.getClientRects().length > 0, chain: (() => { const chain = []; for (let node = heading.parentElement; node && chain.length < 8; node = node.parentElement) chain.push(node.tagName.toLowerCase() + (node.className && typeof node.className === "string" ? "." + node.className.split(" ").filter(Boolean).slice(0, 3).join(".") : "")); return chain; })(), picked: panels.includes(windowOf(heading)), names: (windowOf(heading)?.querySelectorAll(".MuiListItemText-primary").length) ?? 0 }));
    out.scrollableLists = document.querySelectorAll(".scrollable-list").length;
    out.speaker = { injectedTotal: state.speakerInjected, rowsNow: document.querySelectorAll(`[${SPEAKER_ATTR}]`).length, reason: state.speakerReason };
    out.panels = panels.map((panel) => ({ title: (panel.querySelector("h6, h5, h4, h3, h2")?.textContent || "").trim().slice(0, 20), nativeRows: nativeRows(panel).length, hasList: !!listContainer(panel), hasScrollable: !!panel.querySelector(".scrollable-list"), cls: String(panel.className || "").split(" ").filter(Boolean).slice(0, 4).join("."), kind: panel.matches(".MuiDialog-root, [role='dialog']") ? "dialog" : "paper" }));
    out.reason = !uid || !room ? "룸 정보/uid 없음" : !out.gm ? "GM(방장) 계정이 아님(소유자 비교 uid)" : !out.ownedByOthers ? "다른 사람 소유 캐릭터가 저장소에 없음" : !panels.length ? "'내 캐릭터 목록' 패널이 열려 있지 않음(패널을 열어야 함)" : panels.every((panel) => !nativeRows(panel).length && !listContainer(panel)) ? "패널 안에 목록 요소를 못 찾음" : out.rowsInDom ? "정상: 행이 붙어 있음" : "조건은 맞는데 행이 없음(sync 실행 확인)";
    return out;
  }

  window.__CCF_OTHERS_CHARS__ = { version: VERSION, disable, others: () => readOthers(), sync, diag };
  if (!attach()) state.finder = window.setInterval(() => { if (attach()) { clearInterval(state.finder); state.finder = 0; } }, 1000);
})();
