// 웹 공유 설정 모달. 툴바 아이콘을 누르면 background.js 가 코코포리아 탭(ISOLATED world)에 주입한다.
// 다시 누르면 닫힌다. 모양은 코코포리아의 다이얼로그(어두운 Material 스타일)에 맞춘다.
(() => {
  "use strict";
  const HOST_ID = "capybara-share-modal-host";
  const existing = document.getElementById(HOST_ID);
  if (existing) { existing.__capybaraClose?.(); return; }

  const relayOrigin = value => {
    try {
      const parsed = new URL(String(value || "").trim());
      return parsed.origin === "http://127.0.0.1:8787" || parsed.protocol === "https:" ? parsed.origin : "";
    } catch (_) { return ""; }
  };
  const STATUS_LABEL = { pending: "대기 중", approved: "승인됨", rejected: "거절됨", revoked: "접근 취소됨" };
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    node.append(...children.flat().filter(Boolean));
    return node;
  };

  const css = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .backdrop { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.5); font-family: "Noto Sans KR", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .paper { width: min(560px, calc(100vw - 64px)); max-height: calc(100vh - 64px); display: flex; flex-direction: column;
      background: #222; color: #fff; border-radius: 4px; overflow: hidden;
      box-shadow: 0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12); }
    header { display: flex; align-items: center; gap: 8px; padding: 16px 24px 8px; }
    h2 { flex: none; margin: 0; font-size: 1.25rem; font-weight: 500; line-height: 1.6; letter-spacing: .0075em; }
    .body { padding: 20px 24px; overflow: auto; font-size: 1rem; line-height: 1.5; }
    .muted { color: rgba(255,255,255,.7); font-size: .875rem; }
    .field { margin-top: 16px; }
    .field > label { display: block; margin-bottom: 4px; color: rgba(255,255,255,.7); font-size: .75rem; }
    input[type=text], input[type=password] { width: 100%; height: 40px; padding: 8px 12px; border: 1px solid rgba(255,255,255,.23); border-radius: 4px;
      background: transparent; color: #fff; font: inherit; font-size: 1rem; outline: none; }
    input[type=text]:hover, input[type=password]:hover { border-color: #fff; }
    input[type=text]:focus, input[type=password]:focus { border-color: #fff; box-shadow: 0 0 0 1px #fff; }
    input[readonly] { color: rgba(255,255,255,.85); }
    .row { display: flex; align-items: center; gap: 8px; }
    .row > input { flex: 1; min-width: 0; }
    /* Same switch as CCFOLIA's dialogs: 58x38 hit area, 34x14 track, 20px thumb; off = light grey thumb, on = blue thumb + 50% blue track, 150ms. */
    .switch { position: relative; display: inline-flex; flex: none; cursor: pointer; user-select: none; }
    .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
    .sw { position: relative; display: inline-flex; width: 58px; height: 38px; padding: 12px; overflow: hidden; }
    .track { width: 34px; height: 14px; border-radius: 7px; background-color: #fff; opacity: .3;
      transition: opacity .15s cubic-bezier(.4,0,.2,1), background-color .15s cubic-bezier(.4,0,.2,1); }
    .base { position: absolute; top: 0; left: 0; width: 38px; height: 38px; padding: 9px; color: #e0e0e0;
      transition: left .15s cubic-bezier(.4,0,.2,1), transform .15s cubic-bezier(.4,0,.2,1), color .15s cubic-bezier(.4,0,.2,1); }
    .thumb { display: block; width: 20px; height: 20px; border-radius: 50%; background-color: currentColor;
      box-shadow: 0 2px 1px -1px rgba(0,0,0,.2), 0 1px 1px 0 rgba(0,0,0,.14), 0 1px 3px 0 rgba(0,0,0,.12); }
    .switch input:checked + .sw .base { transform: translateX(20px); color: #2196f3; }
    .switch input:checked + .sw .track { background-color: #2196f3; opacity: .5; }
    .switch input:focus-visible + .sw { outline: 2px solid #fff; outline-offset: -4px; border-radius: 19px; }
    hr { border: 0; border-top: 1px solid rgba(255,255,255,.12); margin: 20px 0 0; }
    h3 { margin: 16px 0 4px; font-size: 1rem; font-weight: 500; }
    button { font: inherit; font-size: .875rem; font-weight: 500; letter-spacing: .02857em; min-width: 64px; height: 36px; padding: 6px 12px; border: 0; border-radius: 4px;
      background: transparent; color: #fff; cursor: pointer; transition: background .15s; }
    button:hover { background: rgba(255,255,255,.08); }
    button:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
    button:disabled { color: rgba(255,255,255,.3); cursor: default; background: transparent; }
    button.contained { background: #eee; color: #111; font-weight: 700; border-radius: 0; padding: 6px 16px; box-shadow: 0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12); }
    button.contained:hover { background: #fff; }
    button.danger { color: #f44336; }
    button.danger:hover { background: rgba(244,67,54,.08); }
    button.stop { background: #d32f2f; color: #fff; font-weight: 700; border-radius: 0; }
    button.stop:hover { background: #b71c1c; }
    button.icon { min-width: 0; width: 36px; padding: 0; border-radius: 50%; font-size: 1.25rem; line-height: 1; }
    .participants { margin-top: 4px; }
    .participant { display: flex; align-items: center; gap: 4px; min-height: 48px; border-top: 1px solid rgba(255,255,255,.12); }
    .participant .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .participant .state { color: rgba(255,255,255,.7); font-size: .875rem; margin-right: 4px; }
    footer { display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(0,0,0,.4); }
    footer .spacer, header .spacer { flex: 1; }
    .toast { min-height: 1.25rem; margin-top: 12px; font-size: .875rem; color: #a5d6a7; }
    .toast.error { color: #f44336; }
    @media (max-width: 480px) { .paper { width: calc(100vw - 32px); } header, .body { padding-left: 16px; padding-right: 16px; } }
  `;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("style", { text: css }));

  // The modal shows the room this tab is in (each CCFOLIA room has its own invite URL), not whichever room connected last.
  const currentRoom = () => location.pathname.match(/^\/rooms\/([^/?#]+)/i)?.[1] || "";
  let roomId = currentRoom();
  let invites = {};
  // An invite URL is only meaningful for the relay it was created on. After the relay address changes (or the old server is gone) the
  // stored URL still points at the old host, so it is hidden until the room reconnects and the bridge stores a fresh one.
  const inviteFor = id => {
    const value = invites[id] || "";
    try { return value && new URL(value).origin === relayOrigin(url.value) ? value : ""; } catch (_) { return ""; }
  };
  let timer = 0;
  const closeModal = () => {
    clearInterval(timer);
    chrome.storage.onChanged?.removeListener(onStorageChanged);
    document.removeEventListener("keydown", onKey, true);
    host.remove();
  };
  host.__capybaraClose = closeModal;

  const enabled = el("input", { type: "checkbox", id: "enabled", "aria-label": "웹 공유 사용" });
  const r20 = el("input", { type: "checkbox", id: "r20", "aria-label": "롤20 채팅 받기" });
  r20.addEventListener("change", () => {
    if (r20.checked && !roomId) { r20.checked = false; say("코코포리아 룸 화면에서 켜주세요.", true); return; }
    // direction is fixed to "in" for now (Roll20 -> CCFOLIA); the field is kept so a reverse link can reuse the same setting.
    if (r20.checked) chrome.storage.local.set({ r20Link: { roomId, channel: "main", direction: "in" } });
    else chrome.storage.local.remove("r20Link");
  });
  const url = el("input", { type: "text", id: "url", autocomplete: "off", spellcheck: "false" });
  const token = el("input", { type: "password", id: "token", autocomplete: "off" });
  const invite = el("input", { type: "text", id: "invite", readonly: "", placeholder: "코코포리아 룸 연결 후 생성됩니다." });
  const socketLine = el("p", { class: "muted", id: "socket" });
  const roomLine = el("p", { class: "muted", id: "room" });
  const participants = el("div", { class: "participants", id: "participants", "aria-live": "polite" });
  const toast = el("div", { class: "toast", id: "toast", role: "status" });
  const say = (text, error = false) => { toast.textContent = text; toast.classList.toggle("error", error); };

  const adminFetch = (path, options = {}) => {
    const origin = relayOrigin(url.value);
    if (!origin || !token.value.trim()) throw new Error("릴레이 주소와 GM 토큰을 확인해주세요.");
    return fetch(origin + path, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.value.trim()}`, ...options.headers } });
  };
  const errorOf = async (response, fallback) => (await response.json().catch(() => ({}))).error || `${fallback} (${response.status})`;

  const renderParticipants = items => {
    participants.replaceChildren();
    if (!items.length) { participants.append(el("p", { class: "muted", text: "참가 요청 없음" })); return; }
    for (const item of items) {
      const act = (label, decision, danger = false) => el("button", { type: "button", class: danger ? "danger" : "", "data-decision": decision, "data-id": item.id, text: label });
      participants.append(el("div", { class: "participant" },
        el("span", { class: "name", text: item.displayName }),
        el("span", { class: "state", text: STATUS_LABEL[item.status] || item.status }),
        item.status === "pending" || item.status === "approved" ? el("button", { type: "button", "data-rename": item.id, "data-name": item.displayName, text: "이름 변경" }) : null,
        item.status === "pending" ? [act("승인", "approve"), act("거절", "reject", true)] : null,
        item.status === "approved" ? act("접근 취소", "revoke", true) : null));
    }
  };
  async function refreshParticipants() {
    if (!roomId) { roomLine.textContent = "코코포리아 룸 화면에서 열면 그 룸의 초대 URL이 표시됩니다."; participants.replaceChildren(); return; }
    roomLine.textContent = `룸: ${roomId}`;
    try {
      const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/participants`);
      if (!response.ok) throw new Error(await errorOf(response, "조회 실패"));
      renderParticipants((await response.json()).participants || []);
    } catch (error) { participants.replaceChildren(el("p", { class: "muted", text: error.message })); }
  }
  const renderSocket = info => {
    if (!roomId || !info || info.roomId !== roomId) { socketLine.textContent = "실시간 연결: 아직 연결 시도 없음 — 룸 탭을 새로고침하세요."; return; }
    const ago = Math.max(0, Math.round((Date.now() - (info.at || 0)) / 1000));
    const text = {
      open: "연결됨 (메시지가 즉시 전달됩니다)",
      connecting: "연결 중…",
      off: "공유 중지됨",
      unsupported: "이 환경은 웹소켓을 지원하지 않아 폴링으로 동작합니다",
      closed: `끊김 (코드 ${info.code ?? "?"}${info.reason ? `, ${info.reason}` : ""}) — 폴링으로 동작 중이며 자동으로 재연결을 시도합니다`
    }[info.state] || String(info.state);
    socketLine.textContent = `실시간 연결: ${text} · ${ago}초 전`;
  };
  const loadSocket = () => chrome.storage.local.get(["relaySocket"], value => renderSocket(value.relaySocket));
  const onStorageChanged = (changes, area) => {
    if (area !== "local") return;
    if (changes.relaySocket) renderSocket(changes.relaySocket.newValue);
    if (changes.relayInvites) { invites = changes.relayInvites.newValue || {}; invite.value = inviteFor(roomId); }
  };
  chrome.storage.onChanged?.addListener(onStorageChanged);

  const save = el("button", { type: "button", class: "contained", id: "save", text: "저장" });
  save.addEventListener("click", async () => {
    const origin = relayOrigin(url.value);
    if (!origin) { say("HTTPS 또는 로컬 릴레이 주소만 사용할 수 있습니다.", true); return; }
    await chrome.storage.local.set({ relayEnabled: enabled.checked, relayUrl: origin, relayGmToken: token.value.trim() });
    url.value = origin;
    invite.value = inviteFor(roomId);
    say("저장했습니다. 룸 탭을 새로고침하면 적용됩니다.");
  });
  const copy = el("button", { type: "button", id: "copy", text: "복사" });
  copy.addEventListener("click", async () => {
    if (!invite.value) { say("아직 만들어진 초대 URL이 없습니다.", true); return; }
    try { await navigator.clipboard.writeText(invite.value); say("초대 URL을 복사했습니다."); }
    catch (_) { invite.select(); say("복사하지 못했습니다. 선택된 주소를 직접 복사하세요.", true); }
  });
  const stop = el("button", { type: "button", class: "danger stop", id: "stop", text: "공유 중지" });
  stop.addEventListener("click", async () => {
    if (!roomId) { say("공유 중인 룸이 없습니다.", true); return; }
    if (!confirm("공유를 중지하면 모든 참여자의 접근이 취소되고, 채팅 기록·참가 목록·초대 링크가 삭제됩니다. 계속할까요?")) return;
    try {
      const stoppedRoomId = roomId;
      const response = await adminFetch("/api/share/stop", { method: "POST", body: JSON.stringify({ roomId: stoppedRoomId }) });
      if (!response.ok) throw new Error(await errorOf(response, "중지 실패"));
      const { relayInvites } = await chrome.storage.local.get(["relayInvites"]);
      const rest = { ...(relayInvites || {}) }; delete rest[stoppedRoomId];
      await chrome.storage.local.remove(["relayInviteUrl", "relayLastRoomId"]);
      await chrome.storage.local.set({ relayInvites: rest, relayStop: { roomId: stoppedRoomId, at: Date.now() } });
      invites = rest; invite.value = "";
      say("공유를 중지했습니다. 룸 탭을 새로고침하면 새 초대 URL로 다시 시작됩니다.");
      await refreshParticipants();
    } catch (error) { say(error.message, true); }
  });
  participants.addEventListener("click", async event => {
    const rename = event.target.closest?.("button[data-rename]");
    if (rename && roomId) {
      const next = (prompt("참여자 표시 이름", rename.dataset.name) || "").trim();
      if (!next || next === rename.dataset.name) return;
      rename.disabled = true;
      try {
        const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(rename.dataset.rename)}/rename`, { method: "POST", body: JSON.stringify({ displayName: next }) });
        if (!response.ok) throw new Error(await errorOf(response, "이름 변경 실패"));
        say("표시 이름을 바꿨습니다.");
      } catch (error) { say(error.message, true); }
      await refreshParticipants();
      return;
    }
    const button = event.target.closest?.("button[data-decision]");
    if (!button || !roomId) return;
    button.disabled = true;
    try {
      const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(button.dataset.id)}/decision`, { method: "POST", body: JSON.stringify({ decision: button.dataset.decision }) });
      if (!response.ok) throw new Error(await errorOf(response, "처리 실패"));
    } catch (error) { say(error.message, true); }
    await refreshParticipants();
  });

  const close = el("button", { type: "button", id: "close", text: "닫기" });
  close.addEventListener("click", closeModal);
  const x = el("button", { type: "button", class: "icon", id: "x", "aria-label": "닫기", text: "✕" });
  x.addEventListener("click", closeModal);

  const paper = el("div", { class: "paper", role: "dialog", "aria-modal": "true", "aria-labelledby": "title" },
    el("header", {}, el("h2", { id: "title", text: "웹 공유" }),
      el("label", { class: "switch", title: "웹 공유 사용" }, enabled, el("span", { class: "sw" }, el("span", { class: "track" }), el("span", { class: "base" }, el("span", { class: "thumb" })))),
      el("span", { class: "spacer" }), x),
    el("div", { class: "body" },
      el("div", { class: "field" }, el("label", { for: "url", text: "릴레이 주소" }), url),
      el("div", { class: "field" }, el("label", { for: "token", text: "GM 토큰" }), token),
      el("div", { class: "field" }, el("label", { for: "invite", text: "참여자 초대 URL" }), el("div", { class: "row" }, invite, copy)),
      el("div", { class: "field row" }, el("label", { for: "r20", text: "롤20 채팅 받기 (이 룸으로)" }),
        el("label", { class: "switch", title: "롤20 채팅 받기" }, r20, el("span", { class: "sw" }, el("span", { class: "track" }), el("span", { class: "base" }, el("span", { class: "thumb" }))))),
      toast,
      el("hr"),
      el("h3", { text: "참가 승인" }), roomLine, socketLine, participants),
    el("footer", {}, stop, el("span", { class: "spacer" }), save, close));
  const backdrop = el("div", { class: "backdrop" }, paper);
  backdrop.addEventListener("mousedown", event => { if (event.target === backdrop) closeModal(); });
  shadow.append(backdrop);
  // The labels live in the same shadow root as their inputs, so for/id pairing works.
  const onKey = event => {
    if (event.key === "Escape") { event.stopPropagation(); closeModal(); }
    // Keep typing inside the dialog from reaching CCFOLIA's global shortcuts.
    else if (host.matches(":focus-within") || shadow.activeElement) event.stopPropagation();
  };
  document.addEventListener("keydown", onKey, true);
  document.documentElement.append(host);

  chrome.storage.local.get(["relayEnabled", "relayUrl", "relayGmToken", "relayInvites", "r20Link"], value => {
    r20.checked = !!value.r20Link && value.r20Link.roomId === roomId;
    enabled.checked = value.relayEnabled === true;
    url.value = value.relayUrl || "http://127.0.0.1:8787";
    token.value = value.relayGmToken || "";
    invites = value.relayInvites || {};
    invite.value = inviteFor(roomId);
    refreshParticipants();
    loadSocket();
    (enabled.checked ? close : enabled).focus?.();
  });
  timer = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(timer); return; }
    const room = currentRoom();
    if (room !== roomId) { roomId = room; invite.value = inviteFor(roomId); }
    refreshParticipants(); loadSocket();
  }, 3000);
})();
