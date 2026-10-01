"use strict";
const params = new URLSearchParams(location.hash.slice(1));
const roomId = params.get("room") || "";
const inviteToken = params.get("token") || "";
const consent = document.getElementById("consent");
const room = document.getElementById("room");
const gateStatus = document.getElementById("gate-status");
let pollTimer = 0;
const setGate = (message, state = "") => { gateStatus.textContent = message; gateStatus.dataset.state = state; };
const stop = message => { clearInterval(pollTimer); setGate(message, "error"); room.hidden = true; };
const renderState = data => {
  document.getElementById("room-title").textContent = data.roomTitle || "플레이 룸";
  document.getElementById("gm-state").textContent = data.gmOnline ? "GM 연결됨" : "GM 연결 지연";
  document.getElementById("status").textContent = data.gmOnline ? "동기화 중" : "새 메시지 전송을 기다리는 중";
  const list = document.getElementById("messages");
  list.replaceChildren(...(data.messages || []).map(message => {
    const item = document.createElement("li");
    const author = document.createElement("strong"); author.textContent = message.author || "이름 없음";
    const body = document.createElement("p"); body.textContent = message.text || "";
    item.append(author, body); return item;
  }));
  list.scrollTop = list.scrollHeight;
  const handout = data.handout || {};
  document.getElementById("handout").hidden = !handout.id;
  document.getElementById("title").textContent = handout.title || "";
  document.getElementById("body").textContent = handout.bodyText || "";
  document.getElementById("updated").textContent = handout.updatedAt ? `갱신 ${new Date(handout.updatedAt).toLocaleString()}` : "";
};
async function refresh() {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/state`);
  if (response.status === 403) return;
  if (!response.ok) return stop("접근이 취소되었거나 룸이 종료되었습니다.");
  renderState(await response.json());
}
async function checkStatus() {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`);
  if (!response.ok) return stop("요청이 만료되었거나 룸이 종료되었습니다.");
  const data = await response.json();
  if (data.status === "approved") {
    consent.hidden = true; gateStatus.hidden = true; room.hidden = false;
    await refresh();
    if (!pollTimer) pollTimer = setInterval(() => refresh().catch(() => {}), 1500);
  } else if (data.status === "pending") setGate("GM 승인 대기 중", "pending");
  else stop(data.status === "rejected" ? "GM이 참가 요청을 거절했습니다." : "접근이 취소되었습니다.");
}
async function join() {
  const displayName = document.getElementById("display-name").value.trim();
  if (!roomId || !inviteToken) return setGate("초대 링크가 올바르지 않습니다.", "error");
  if (!displayName) return setGate("표시 이름을 입력해주세요.", "error");
  if (!document.getElementById("agree").checked) return setGate("정보 처리 안내에 동의해주세요.", "error");
  const response = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, token: inviteToken, displayName }) });
  if (!response.ok) return setGate("승인되지 않았거나 종료된 초대입니다.", "error");
  history.replaceState(null, "", `${location.pathname}#room=${encodeURIComponent(roomId)}`);
  consent.hidden = true; setGate("GM 승인 대기 중", "pending");
  pollTimer = setInterval(() => checkStatus().catch(() => setGate("상태 확인 지연", "error")), 1500);
}
document.getElementById("join").addEventListener("click", () => join().catch(() => setGate("연결할 수 없습니다.", "error")));
document.getElementById("chat-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  const clientMessageId = crypto.randomUUID();
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId, text }) });
  const status = document.getElementById("send-status");
  if (!response.ok) { status.textContent = (await response.json().catch(() => ({}))).error || "전송 실패"; return; }
  input.value = ""; status.textContent = "GM 브리지 전달 대기";
  setTimeout(() => { status.textContent = ""; }, 2500);
});
if (roomId && !inviteToken) { consent.hidden = true; checkStatus(); pollTimer = setInterval(() => checkStatus().catch(() => {}), 1500); }
