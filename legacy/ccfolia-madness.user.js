// ==UserScript==
// @name         CCFOLIA Madness Alert (Cthulhu rooms) by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-madness
// @version      0.1.0
// @description  Cthulhu rooms only: when a character loses 5 or more SAN at once, or 1/5 or more of the SAN it had when first seen today, a small card offers the madness table commands (nothing is sent by itself).
// @description:ko 크툴루 룸에서만: 캐릭터의 SAN 이 한 번에 5 이상, 또는 오늘 처음 본 값의 1/5 이상 줄면 작은 알림 카드로 광기 표 커맨드를 제안합니다(자동 전송 없음).
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * #121 광기 발현 자동 표시. 기본 규칙(사용자 답이 없는 부분은 아래 기본값):
 *  - 감지: 코코포리아 저장소 roomCharacters 의 status 에서 라벨이 SAN(이성·이성치·正気度 포함)인 값의 변화. (시스템 메시지 "[이름] SAN : 57 → 55"는 같은 변화를 글로 남긴 것이라 저장소 값을 본다.)
 *  - 조건: 한 번에 5 이상 감소 → 일시적 광기 후보, 오늘(날짜가 바뀌면 리셋) 처음 본 SAN 값 대비 누적 감소가 그 값의 1/5 이상 → 부정기 광기 후보. 기준값은 룸·캐릭터별로 localStorage 에 둔다.
 *  - 표시: 그 캐릭터의 소유자 화면과 GM(방장) 화면에만 작은 카드. 버튼은 광기 표 커맨드(기본 일시적 "TI"·부정기 "II", 설정에서 바꿀 수 있음)를 채팅 입력칸에 넣고 전송한다(카드는 알림만, 자동 전송 없음).
 *  - 크툴루 룰 룸(룸 시스템 이름에 cthulhu / coc / 크툴루 가 들어감)에서만.
 */
(() => {
  "use strict";
  if (location.hostname !== "ccfolia.com" && !location.hostname.endsWith(".ccfolia.com")) return;
  const VERSION = "0.1.0";
  const SAFE_ATTR = "data-capybara-toolkit-madness";
  const SAN_RE = /^(san|san値|sanity|이성|이성치|이성값|正気度|sanチェック)$/i;
  const DEFAULT_COMMANDS = { temporary: "TI", indefinite: "II" };

  try { window.__CCF_MADNESS__?.disable?.(); } catch (error) { /* 이전 인스턴스 정리 실패 */ }
  const abort = new AbortController();
  const state = { store: null, unsubscribe: null, last: new Map(), roomKey: "", queued: false, card: null };

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

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const storageKey = (roomId) => `ccf-madness-v1:${roomId}`;
  function readStore(roomId) { try { const raw = JSON.parse(localStorage.getItem(storageKey(roomId)) || "{}"); return { chars: raw.chars && typeof raw.chars === "object" ? raw.chars : {}, commands: { ...DEFAULT_COMMANDS, ...(raw.commands || {}) } }; } catch (_) { return { chars: {}, commands: { ...DEFAULT_COMMANDS } }; } }
  function writeStore(roomId, data) { try { localStorage.setItem(storageKey(roomId), JSON.stringify(data)); } catch (_) { /* 저장 불가 */ } }

  // 순수 판정: prev → next 로 SAN 이 줄었을 때 알릴 것이 있는지. record = { day, base } (그날 처음 본 값). 반환 { record, alert } — alert: null | { temporary, indefinite, drop, cumulative, base }
  function evaluate(record, prev, next, day) {
    const rec = record && record.day === day && Number.isFinite(record.base) ? { ...record } : { day, base: prev };
    if (!(next < prev)) return { record: rec, alert: null };
    const drop = prev - next;
    const cumulative = rec.base - next;
    const temporary = drop >= 5;
    const indefinite = cumulative > 0 && cumulative >= rec.base / 5;
    if (indefinite) rec.base = next; // 알린 뒤에는 그 값에서 다시 센다
    return { record: rec, alert: temporary || indefinite ? { temporary, indefinite, drop, cumulative, base: indefinite ? cumulative + next : rec.base } : null };
  }

  function sanOf(character) {
    for (const entry of Array.isArray(character?.status) ? character.status : []) {
      if (entry && SAN_RE.test(String(entry.label || "").trim().replace(/\s+/g, "")) && Number.isFinite(Number(entry.value))) return Number(entry.value);
    }
    return null;
  }

  function context() {
    const snapshot = state.store?.getState?.();
    const roomId = snapshot?.app?.state?.roomId;
    const room = roomId ? snapshot?.entities?.rooms?.entities?.[roomId] : null;
    if (!roomId || !room) return null;
    const system = String(room.diceBotSystem || room.system || "");
    return { snapshot, roomId, room, uid: snapshot?.app?.user?.uid || "", cthulhu: /cthulhu|coc|크툴루|クトゥルフ/i.test(system) };
  }

  function scan() {
    state.queued = false;
    const ctx = context();
    if (!ctx) return;
    if (state.roomKey !== ctx.roomId) { state.roomKey = ctx.roomId; state.last = new Map(); }
    const characters = ctx.snapshot?.entities?.roomCharacters?.entities || {};
    const seen = new Set();
    let data = null;
    for (const [id, character] of Object.entries(characters)) {
      const san = character ? sanOf(character) : null;
      if (san === null) continue;
      seen.add(id);
      const prev = state.last.get(id);
      state.last.set(id, san);
      if (prev === undefined || !ctx.cthulhu) { // 처음 본 값 = 기준값(알리지 않는다)
        if (prev === undefined && ctx.cthulhu) { data ||= readStore(ctx.roomId); if (!data.chars[id] || data.chars[id].day !== today()) { data.chars[id] = { day: today(), base: san }; writeStore(ctx.roomId, data); } }
        continue;
      }
      if (san === prev) continue;
      data ||= readStore(ctx.roomId);
      const result = evaluate(data.chars[id], prev, san, today());
      data.chars[id] = result.record; writeStore(ctx.roomId, data);
      const mine = character.owner && character.owner === ctx.uid;
      const gm = ctx.room.owner && ctx.room.owner === ctx.uid;
      if (result.alert && (mine || gm)) showCard({ id, name: String(character.name || "").trim() || "캐릭터", from: prev, to: san, ...result.alert, commands: data.commands });
    }
    for (const id of [...state.last.keys()]) if (!seen.has(id)) state.last.delete(id);
  }

  function scheduleScan() { if (state.queued) return; state.queued = true; queueMicrotask(scan); }

  // ---- 알림 카드 ----
  function sendToChat(text) {
    const box = [...document.querySelectorAll("textarea")].find((el) => el.offsetParent && !el.closest(`[${SAFE_ATTR}]`) && !el.closest(".MuiDialog-root"));
    if (!box) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    const form = box.closest("form");
    const send = [...(form || document).querySelectorAll("button")].find((b) => /^(전송|送信|send)$/i.test(b.textContent.trim()));
    if (send) { send.click(); return true; }
    box.focus();
    return true;
  }

  function closeCard() { state.card?.remove(); state.card = null; }
  function showCard(info) {
    closeCard();
    const card = document.createElement("div");
    card.setAttribute(SAFE_ATTR, "1");
    card.setAttribute("role", "alert");
    card.style.cssText = "position:fixed;right:16px;bottom:200px;z-index:2147482990;width:300px;box-sizing:border-box;padding:12px 16px 8px;background:rgba(44,44,44,.95);color:#fff;border-radius:4px;box-shadow:0 5px 5px -3px rgba(0,0,0,.2),0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12);font:14px/1.5 Roboto,'Noto Sans KR',sans-serif";
    const reasons = [info.temporary ? `한 번에 −${info.drop}` : "", info.indefinite ? `오늘 누적 −${info.cumulative}(기준 ${info.base}의 1/5 이상)` : ""].filter(Boolean).join(" · ");
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    card.innerHTML = `<div style="font-weight:700;margin-bottom:2px">광기 발현 판정</div><div style="color:rgba(255,255,255,.85)">[${esc(info.name)}] SAN ${info.from} → ${info.to}</div><div style="color:rgba(255,255,255,.6);font-size:12px">${esc(reasons)}</div>
      <div style="display:flex;gap:4px;justify-content:flex-end;margin-top:6px;flex-wrap:wrap">${info.temporary ? `<button type="button" data-cmd="temporary">일시적 광기 표</button>` : ""}${info.indefinite ? `<button type="button" data-cmd="indefinite">부정기 광기 표</button>` : ""}<button type="button" data-cmd="close">닫기</button></div>`;
    for (const button of card.querySelectorAll("button")) button.style.cssText = "all:unset;box-sizing:border-box;cursor:pointer;padding:4px 8px;border-radius:4px;color:#64b5f6;font:500 13px Roboto,'Noto Sans KR',sans-serif;text-transform:none";
    card.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-cmd]");
      if (!button) return;
      const cmd = button.dataset.cmd;
      if (cmd !== "close") sendToChat(info.commands[cmd] || DEFAULT_COMMANDS[cmd]);
      closeCard();
    }, { signal: abort.signal });
    document.documentElement.appendChild(card);
    state.card = card;
  }

  // ---- 공용 설정 탭 구역 ----
  function mountSettings(container) {
    const roomId = state.roomKey || context()?.roomId || "";
    const data = roomId ? readStore(roomId) : { chars: {}, commands: { ...DEFAULT_COMMANDS } };
    container.innerHTML = `<div style="font-size:13px;color:rgba(255,255,255,.7);margin-bottom:8px">크툴루 룸에서 SAN 이 한 번에 5 이상, 또는 오늘 처음 본 값의 1/5 이상 줄면 알림 카드가 뜹니다. 카드의 버튼이 아래 커맨드를 채팅으로 보냅니다.</div>
      <label style="display:block;margin:6px 0">일시적 광기 표 커맨드 <input data-k="temporary" value="${(data.commands.temporary || "").replace(/"/g, "&quot;")}" style="margin-left:6px;width:120px;padding:4px 6px;background:#1b1b1b;color:#fff;border:1px solid rgba(255,255,255,.23)"></label>
      <label style="display:block;margin:6px 0">부정기 광기 표 커맨드 <input data-k="indefinite" value="${(data.commands.indefinite || "").replace(/"/g, "&quot;")}" style="margin-left:6px;width:120px;padding:4px 6px;background:#1b1b1b;color:#fff;border:1px solid rgba(255,255,255,.23)"></label>
      <div style="margin-top:8px"><button type="button" data-a="reset" style="padding:4px 10px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;cursor:pointer">오늘 기준값 초기화</button> <span data-role="note" style="margin-left:8px;font-size:12px;color:rgba(255,255,255,.6)"></span></div>`;
    const note = container.querySelector("[data-role=note]");
    container.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-k]"); if (!input || !roomId) return;
      const next = readStore(roomId); next.commands[input.dataset.k] = input.value.trim() || DEFAULT_COMMANDS[input.dataset.k]; writeStore(roomId, next); note.textContent = "저장됨";
    }, { signal: abort.signal });
    container.querySelector("[data-a=reset]").addEventListener("click", () => { if (!roomId) return; const next = readStore(roomId); next.chars = {}; writeStore(roomId, next); state.last = new Map(); scheduleScan(); note.textContent = "초기화했습니다 (다음 SAN 값부터 다시 셉니다)"; }, { signal: abort.signal });
  }

  function start() {
    const registry = (window.__CCF_TOOLKIT_MENU__ ||= { items: new Map(), register(item) { if (this.items.get(item.id)?.onClick === item.onClick) return; this.items.set(item.id, item); this.sync?.(); } });
    const noop = () => {};
    registry.register({ id: "madness-settings", section: true, order: 20, label: "광기 발현 알림", visible: () => !!context()?.cthulhu, onClick: noop, mount: mountSettings, unmount: noop });
    const attach = () => {
      state.store ||= findStore();
      if (!state.store) return false;
      state.unsubscribe = state.store.subscribe(scheduleScan);
      scheduleScan();
      return true;
    };
    if (!attach()) state.finder = window.setInterval(() => { if (attach()) { window.clearInterval(state.finder); state.finder = 0; } }, 1000);
  }

  function disable() {
    abort.abort();
    window.clearInterval(state.finder);
    try { state.unsubscribe?.(); } catch (_) { /* 구독 해제 실패 */ }
    closeCard();
    if (window.__CCF_MADNESS__?.__owner === abort.signal) delete window.__CCF_MADNESS__;
    return true;
  }

  window.__CCF_MADNESS__ = { __owner: abort.signal, version: VERSION, evaluate, sanOf, disable, scan: () => scan(), state: () => ({ room: state.roomKey, last: [...state.last.entries()], card: !!state.card }) };
  start();
})();
