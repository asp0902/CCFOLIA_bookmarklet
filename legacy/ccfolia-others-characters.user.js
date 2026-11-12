// ==UserScript==
// @name         CCFOLIA Others' Characters in My Character List by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-others-characters
// @version      0.1.0
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
 * 인세인 룸이면 사이코로픽션 시트 버튼도 붙는다(시트 스크립트의 __CCF_CHARACTER_SHEET_DEBUG__.openForCharacter).
 */
(() => {
  "use strict";
  if (location.hostname !== "ccfolia.com" && !location.hostname.endsWith(".ccfolia.com")) return;
  const VERSION = "0.1.0";
  const ROW_ATTR = "data-ccf-others-row";
  const SAFE_ATTR = "data-capybara-toolkit-others";
  const DELETE_LABELS = ["토큰을 화면에서 삭제", "Remove token from screen", "コマを画面から削除"];
  const OWNER_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const SHEET_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 10 8 3 8-3-8-3z"/><path d="m4 10 1 8 7 3 7-3 1-8M12 13v8"/><path d="M4 10 2 7l7-3 3 3M12 7l3-3 7 2-2 4"/></svg>';

  try { window.__CCF_OTHERS_CHARS__?.disable?.(); } catch (error) { /* 이전 인스턴스 정리 실패 */ }
  const abort = new AbortController();
  const state = { store: null, frame: 0, unsubscribe: null, finder: 0 };

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
      if (!character || !character.owner || character.owner === uid || !String(character.name || "").trim()) continue;
      list.push({ id, name: String(character.name).trim(), icon: /^https?:\/\//i.test(character.iconUrl || "") ? character.iconUrl : "", order: Number(character.order) || 0, owner: String(character.owner), ownerName: String(members[character.owner]?.displayName || "").trim() });
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

  function nativeRows(dialog) {
    const rows = [];
    dialog.querySelectorAll("button[aria-label], button[title]").forEach((button) => {
      if (!DELETE_LABELS.some((text) => labelOf(button).includes(text))) return;
      const row = button.closest('li, .MuiListItem-root, [role="listitem"], [role="row"]') || button.parentElement?.parentElement;
      if (row && isNativeRow(row) && !rows.includes(row)) rows.push(row);
    });
    return rows;
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

  function sync() {
    state.frame = 0;
    if (!state.store) return;
    const dialogs = [...document.querySelectorAll('.MuiDialog-root, [role="dialog"]')].filter((dialog) => dialog.querySelector("button[aria-label], button[title]"));
    if (!dialogs.length) { if (document.querySelector(`[${ROW_ATTR}]`)) clearRows(); return; }
    const others = readOthers();
    if (!others) { if (document.querySelector(`[${ROW_ATTR}]`)) clearRows(); return; }
    const sheetApi = (() => { const api = window.__CCF_CHARACTER_SHEET_DEBUG__; return api?.detected?.() && typeof api.openForCharacter === "function" ? api : null; })();
    for (const dialog of dialogs) {
      const rows = nativeRows(dialog);
      if (!rows.length) continue;
      const last = rows[rows.length - 1];
      const parent = last.parentElement;
      if (!parent) continue;
      const signature = JSON.stringify([others.map((c) => [c.id, c.name, c.icon, c.ownerName]), !!sheetApi]);
      const present = [...parent.children].filter((node) => node.hasAttribute(ROW_ATTR));
      // 이미 같은 목록이 맨 끝에 같은 순서로 붙어 있으면 아무것도 쓰지 않는다
      if (parent.getAttribute("data-ccf-others-sig") === signature && present.length === others.length && present.every((node, index) => node.getAttribute(ROW_ATTR) === others[index].id) && last.nextElementSibling === present[0] || (!others.length && !present.length)) continue;
      present.forEach((node) => node.remove());
      parent.setAttribute("data-ccf-others-sig", signature);
      let anchor = last;
      for (const entry of others) { const row = buildRow(rows[0], entry, sheetApi); anchor.after(row); anchor = row; }
    }
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
    observer.disconnect();
    cancelAnimationFrame(state.frame);
    clearInterval(state.finder);
    try { state.unsubscribe?.(); } catch (error) { /* ignore */ }
    clearRows();
  }

  window.__CCF_OTHERS_CHARS__ = { version: VERSION, disable, others: () => readOthers(), sync };
  if (!attach()) state.finder = window.setInterval(() => { if (attach()) { clearInterval(state.finder); state.finder = 0; } }, 1000);
})();
