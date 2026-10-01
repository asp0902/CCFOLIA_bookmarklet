"use strict";
const enabled = document.getElementById("enabled");
const url = document.getElementById("url");
const token = document.getElementById("token");
const status = document.getElementById("status");
const room = document.getElementById("room");
const participants = document.getElementById("participants");
const invite = document.getElementById("invite");
let roomId = "";
const relayOrigin = value => {
  try {
    const parsed = new URL(value);
    return parsed.origin === "http://127.0.0.1:8787" || parsed.protocol === "https:" ? parsed.origin : "";
  } catch (_) { return ""; }
};
const adminFetch = (path, options = {}) => {
  const origin = relayOrigin(url.value.trim());
  if (!origin || !token.value.trim()) throw new Error("릴레이 주소와 GM 토큰을 확인해주세요.");
  return fetch(origin + path, { ...options, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token.value.trim()}`, ...options.headers } });
};
const actionButton = (label, decision, id) => {
  const button = document.createElement("button");
  button.type = "button"; button.textContent = label; button.dataset.decision = decision; button.dataset.id = id;
  return button;
};
function renderParticipants(items) {
  participants.replaceChildren();
  if (!items.length) { participants.textContent = "참가 요청 없음"; return; }
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "participant";
    const name = document.createElement("span");
    name.textContent = `${item.displayName} · ${item.status}`;
    row.append(name);
    if (item.status === "pending") row.append(actionButton("승인", "approve", item.id), actionButton("거절", "reject", item.id));
    if (item.status === "approved") row.append(actionButton("접근 취소", "revoke", item.id));
    participants.append(row);
  });
}
const socketLine = document.getElementById("socket");
function renderSocket(info) {
  if (!roomId || !info || info.roomId !== roomId) { socketLine.textContent = "실시간 연결(웹소켓): 아직 연결 시도 없음 — 룸 탭을 새로고침하세요."; return; }
  const ago = Math.max(0, Math.round((Date.now() - (info.at || 0)) / 1000));
  const text = {
    open: "연결됨 (메시지가 즉시 전달됩니다)",
    connecting: "연결 중…",
    off: "공유 중지됨",
    unsupported: "이 환경은 웹소켓을 지원하지 않아 폴링으로 동작합니다",
    closed: `끊김 (코드 ${info.code ?? "?"}${info.reason ? `, ${info.reason}` : ""}) — 폴링으로 동작 중이며 자동으로 재연결을 시도합니다`
  }[info.state] || String(info.state);
  socketLine.textContent = `실시간 연결(웹소켓): ${text} · ${ago}초 전`;
}
const loadSocketStatus = () => chrome.storage.local.get(["relaySocket"], value => renderSocket(value.relaySocket));
chrome.storage.onChanged?.addListener((changes, area) => { if (area === "local" && changes.relaySocket) renderSocket(changes.relaySocket.newValue); });
async function refreshParticipants() {
  if (!roomId) { room.textContent = "공유한 룸 없음"; participants.replaceChildren(); return; }
  room.textContent = `룸: ${roomId}`;
  try {
    const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/participants`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `조회 실패 (${response.status})`);
    renderParticipants((await response.json()).participants || []);
  } catch (error) {
    participants.textContent = error.message;
  }
}
chrome.storage.local.get(["relayEnabled", "relayUrl", "relayGmToken", "relayLastRoomId", "relayInviteUrl"], value => {
  enabled.checked = value.relayEnabled === true;
  url.value = value.relayUrl || "http://127.0.0.1:8787";
  token.value = value.relayGmToken || "";
  roomId = value.relayLastRoomId || "";
  invite.value = value.relayInviteUrl || "";
  refreshParticipants();
  loadSocketStatus();
});
document.getElementById("save").addEventListener("click", async () => {
  const origin = relayOrigin(url.value.trim());
  if (!origin) { status.textContent = "HTTPS 또는 로컬 릴레이 주소만 사용할 수 있습니다."; return; }
  await chrome.storage.local.set({ relayEnabled: enabled.checked, relayUrl: origin, relayGmToken: token.value.trim() });
  url.value = origin;
  status.textContent = "저장됨";
  setTimeout(() => { status.textContent = ""; }, 1500);
});
document.getElementById("refresh").addEventListener("click", refreshParticipants);
const stopStatus = document.getElementById("stop-status");
document.getElementById("stop").addEventListener("click", async () => {
  if (!roomId) { stopStatus.textContent = "공유 중인 룸이 없습니다."; return; }
  if (!confirm("공유를 중지하면 모든 참여자의 접근이 취소되고, 채팅 기록·참가 목록·초대 링크가 삭제됩니다. 계속할까요?")) return;
  try {
    const stoppedRoomId = roomId;
    const response = await adminFetch("/api/share/stop", { method: "POST", body: JSON.stringify({ roomId: stoppedRoomId }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `중지 실패 (${response.status})`);
    await chrome.storage.local.remove(["relayInviteUrl", "relayLastRoomId"]);
    await chrome.storage.local.set({ relayStop: { roomId: stoppedRoomId, at: Date.now() } });
    roomId = ""; invite.value = "";
    stopStatus.textContent = "공유를 중지했습니다. 룸 탭을 새로고침하면 새 초대 URL로 다시 시작됩니다.";
    await refreshParticipants();
  } catch (error) {
    stopStatus.textContent = error.message;
  }
});
participants.addEventListener("click", async event => {
  const button = event.target.closest("button[data-decision]");
  if (!button || !roomId) return;
  button.disabled = true;
  try {
    const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/participants/${encodeURIComponent(button.dataset.id)}/decision`, { method: "POST", body: JSON.stringify({ decision: button.dataset.decision }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "처리 실패");
  } catch (error) {
    status.textContent = error.message;
  }
  await refreshParticipants();
});
setInterval(() => { refreshParticipants(); loadSocketStatus(); }, 3000);
