"use strict";
const params = new URLSearchParams(location.hash.slice(1));
const roomId = params.get("room") || "";
const inviteToken = params.get("token") || "";
const consent = document.getElementById("consent");
// Remember the display name on this browser so a returning participant does not retype it.
const NAME_KEY = "capybara-display-name";
try { const saved = localStorage.getItem(NAME_KEY); if (saved) document.getElementById("display-name").value = saved; } catch (_) {}
const room = document.getElementById("room");
const gateStatus = document.getElementById("gate-status");
const POLL_MS = 1500;
const LIVE_POLL_MS = 10000;
const MAX_MESSAGES = 300;
let mode = "";
let timer = 0;
let socket = null;
let socketOpen = false;
let socketRetries = 0;
let retryTimer = 0;
let pingTimer = 0;
let pushSeq = 0;
let current = { messages: [], handout: {} };
let rendered = false;
const setGate = (message, state = "") => { gateStatus.textContent = message; gateStatus.dataset.state = state; };
const clearTimers = () => {
  clearTimeout(timer); timer = 0;
  clearTimeout(retryTimer); retryTimer = 0;
  clearInterval(pingTimer); pingTimer = 0;
  const old = socket; socket = null; socketOpen = false;
  if (old) { try { old.close(); } catch (_) {} }
};
const stop = message => { clearTimers(); mode = ""; gateStatus.hidden = false; setGate(message, "error"); room.inert = true; room.setAttribute("aria-hidden", "true"); };
const transient = response => response.status === 429 || response.status >= 500;
// GM's YouTube BGM: a plain embed (no API script needed). Started from a user gesture (the join click), so autoplay with sound is allowed.
const bgmBox = document.getElementById("bgm");
let bgmKey = "", bgmMuted = false, bgmLast = null;
function playBgm(bgm) {
  bgmLast = bgm || { state: "stopped" };
  const wanted = !bgmMuted && bgmLast.state === "playing" && /^[A-Za-z0-9_-]{11}$/.test(bgmLast.videoId || "") ? `${bgmLast.videoId}:${bgmLast.startedAt}` : "";
  bgmBox.hidden = bgmLast.state !== "playing";
  document.getElementById("bgm-title").textContent = bgmLast.title || "BGM";
  document.getElementById("bgm-toggle").textContent = bgmMuted ? "BGM 켜기" : "BGM 끄기";
  if (wanted === bgmKey) return;
  bgmKey = wanted;
  document.getElementById("bgm-frame").replaceChildren();
  if (!wanted) return;
  const frame = document.createElement("iframe");
  const id = bgmLast.videoId;
  frame.src = `https://www.youtube.com/embed/${id}?autoplay=1&controls=0&rel=0${bgmLast.loop !== false ? `&loop=1&playlist=${id}` : ""}`;
  frame.allow = "autoplay; encrypted-media";
  frame.title = "BGM";
  document.getElementById("bgm-frame").append(frame);
}
document.getElementById("bgm-toggle").addEventListener("click", () => { bgmMuted = !bgmMuted; playBgm(bgmLast); });
const renderState = data => {
  if (data.bgm) playBgm(data.bgm);
  document.getElementById("room-title").textContent = data.roomTitle || "플레이 룸";
  document.getElementById("gm-state").textContent = data.gmOnline ? "GM 연결됨" : "GM 연결 지연";
  document.getElementById("status").textContent = data.gmOnline ? "동기화 중" : "새 메시지 전송을 기다리는 중";
  const list = document.getElementById("messages");
  const stickToBottom = !rendered || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(...(data.messages || []).map(message => {
    const item = document.createElement("li");
    const author = document.createElement("strong"); author.textContent = message.author || "이름 없음";
    const body = document.createElement("p"); body.textContent = message.text || "";
    item.append(author, body); return item;
  }));
  if (stickToBottom) list.scrollTop = list.scrollHeight;
  rendered = true;
  const handout = data.handout || {};
  document.getElementById("handout").hidden = !handout.id;
  document.getElementById("title").textContent = handout.title || "";
  document.getElementById("body").textContent = handout.bodyText || "";
  document.getElementById("updated").textContent = handout.updatedAt ? `갱신 ${new Date(handout.updatedAt).toLocaleString()}` : "";
};
// Next tick: fast polling until the push socket is up, then only a slow safety-net poll.
const schedule = () => {
  clearTimeout(timer); timer = 0;
  if (!mode) return;
  timer = setTimeout(async () => {
    try { await (mode === "live" ? refresh() : checkStatus()); } catch (_) { if (mode === "pending") setGate("상태 확인 지연", "error"); }
    schedule();
  }, mode === "live" && socketOpen ? LIVE_POLL_MS : POLL_MS);
};
async function refresh() {
  const seen = pushSeq;
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/state`);
  if (response.status === 403) return verifyAccess();
  if (transient(response)) return;
  if (!response.ok) return stop("접근이 취소되었거나 룸이 종료되었습니다.");
  const next = await response.json();
  if (pushSeq !== seen) {
    // Something was pushed while this request was in flight: never drop it.
    const known = new Set((next.messages || []).map(message => message.id));
    next.messages = [...(next.messages || []), ...current.messages.filter(message => !known.has(message.id))].slice(-MAX_MESSAGES);
    if ((current.handout?.updatedAt || "") > (next.handout?.updatedAt || "")) next.handout = current.handout;
  }
  current = next;
  renderState(current);
}
async function verifyAccess() {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`);
  if (transient(response)) return;
  if (!response.ok) return stop("접근이 취소되었습니다.");
  const data = await response.json();
  if (data.status !== "approved") stop(data.status === "rejected" ? "GM이 참가 요청을 거절했습니다." : "접근이 취소되었습니다.");
}
function onPush(event) {
  let message;
  try { message = JSON.parse(event.data); } catch (_) { return; }
  pushSeq++;
  if (message.type === "message" && message.message?.id) {
    if (current.messages.some(item => item.id === message.message.id)) return;
    current.messages = [...current.messages, message.message].slice(-MAX_MESSAGES);
    renderState(current);
  } else if (message.type === "bgm") {
    playBgm(message.bgm);
  } else if (message.type === "handout") {
    current.handout = message.handout || {};
    renderState(current);
  } else if (message.type === "meta") {
    current = { ...current, roomTitle: message.roomTitle ?? current.roomTitle, gmOnline: message.gmOnline ?? current.gmOnline };
    renderState(current);
  } else if (message.type === "closed") {
    stop(message.reason === "stopped" ? "요청이 만료되었거나 룸이 종료되었습니다." : "접근이 취소되었습니다.");
  }
}
function dropSocket(own) {
  if (socket !== own) return; // replaced or stopped on purpose
  socket = null; socketOpen = false;
  clearInterval(pingTimer); pingTimer = 0;
  try { own.close(); } catch (_) {}
  schedule(); // back to fast polling until the socket is re-established
  if (mode === "live") { socketRetries = Math.min(socketRetries + 1, 6); retryTimer = setTimeout(connectSocket, Math.min(1000 * 2 ** (socketRetries - 1), 15000)); }
}
function connectSocket() {
  if (socket || mode !== "live" || typeof WebSocket !== "function") return;
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws`;
  let own;
  try { own = socket = new WebSocket(url); } catch (_) { socket = null; return; }
  let lastSeen = Date.now();
  own.onopen = () => {
    if (socket !== own) return;
    socketOpen = true; socketRetries = 0; lastSeen = Date.now();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (Date.now() - lastSeen > 55000) return dropSocket(own); // no pong: the connection is dead
      try { own.send("ping"); } catch (_) {}
    }, 20000);
    refresh().catch(() => {}); // catch up on anything missed while the socket was down
    schedule();
  };
  own.onmessage = event => { if (socket !== own) return; lastSeen = Date.now(); onPush(event); };
  own.onclose = () => dropSocket(own);
  own.onerror = () => {};
}
const wake = () => { if (mode !== "live") return; refresh().catch(() => {}); if (!socket) { clearTimeout(retryTimer); connectSocket(); } };
window.addEventListener("online", wake);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
async function checkStatus() {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`);
  if (transient(response)) return;
  if (!response.ok) return stop("요청이 만료되었거나 룸이 종료되었습니다.");
  const data = await response.json();
  if (data.status === "approved") {
    consent.hidden = true; gateStatus.hidden = true; room.inert = false; room.removeAttribute("aria-hidden");
    if (mode !== "live") { mode = "live"; await refresh(); connectSocket(); }
  } else if (data.status === "pending") setGate("GM 승인 대기 중", "pending");
  else stop(data.status === "rejected" ? "GM이 참가 요청을 거절했습니다." : "접근이 취소되었습니다.");
}
async function join() {
  const displayName = document.getElementById("display-name").value.trim();
  if (!roomId || !inviteToken) return setGate("초대 링크가 올바르지 않습니다.", "error");
  if (!displayName) return setGate("희망자 이름을 입력해주세요.", "error");
  const response = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, token: inviteToken, displayName }) });
  if (!response.ok) return setGate("승인되지 않았거나 종료된 초대입니다.", "error");
  try { localStorage.setItem(NAME_KEY, displayName); } catch (_) {}
  history.replaceState(null, "", `${location.pathname}#room=${encodeURIComponent(roomId)}`);
  consent.hidden = true; setGate("GM 승인 대기 중", "pending");
  mode = "pending"; schedule();
}
document.getElementById("cancel").addEventListener("click", () => { location.href = `https://ccfolia.com/rooms/${encodeURIComponent(roomId)}`; });
document.getElementById("join").addEventListener("click", () => join().catch(() => setGate("연결할 수 없습니다.", "error")));
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendStatus = document.getElementById("send-status");
let sendStatusTimer = 0;
const showSendStatus = (message, ms = 0) => {
  clearTimeout(sendStatusTimer);
  sendStatus.textContent = message;
  if (ms) sendStatusTimer = setTimeout(() => { sendStatus.textContent = ""; }, ms);
};
chatForm.addEventListener("submit", async event => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = ""; // clear right away so a quick second Enter cannot send the same text twice
  const clientMessageId = crypto.randomUUID();
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId, text }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "전송 실패");
    showSendStatus("GM 브리지 전달 대기", 2500);
  } catch (error) {
    chatInput.value = chatInput.value ? `${text}\n${chatInput.value}` : text; // give the text back instead of losing it
    showSendStatus(error?.message || "전송 실패");
  }
});
// Enter sends, Shift+Enter inserts a newline. Enter that confirms an IME composition (Korean/Japanese) must not send.
chatInput.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  chatForm.requestSubmit();
});
if (roomId && !inviteToken) { consent.hidden = true; mode = "pending"; checkStatus().catch(() => {}).finally(schedule); }
