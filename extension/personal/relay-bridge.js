(() => {
  "use strict";
  const HANDOUT_SOURCE = "capybara-public-handout-relay-v1";
  const ROOM_SOURCE = "capybara-player-room-relay-v1";
  const clean = (value, max) => String(value || "").replace(/\u0000/g, "").slice(0, max);
  const roomId = location.pathname.match(/^\/rooms\/([^/?#]+)/i)?.[1] || "";
  const sentMessages = new Set();
  let config = null;
  let pollTimer = 0;
  const relayOrigin = value => { try { const url = new URL(String(value || "").trim()); return url.origin === "http://127.0.0.1:8787" || url.protocol === "https:" ? url.origin : ""; } catch (_) { return ""; } };
  const loadConfig = async () => {
    const value = await chrome.storage.local.get(["relayUrl", "relayGmToken", "relayEnabled", "relayDeliveredCommandIds"]);
    return { enabled: value.relayEnabled === true, origin: relayOrigin(value.relayUrl || "http://127.0.0.1:8787"), token: clean(value.relayGmToken, 500).trim(), delivered: new Set(Array.isArray(value.relayDeliveredCommandIds) ? value.relayDeliveredCommandIds : []) };
  };
  const adminFetch = async (path, options = {}) => {
    config ||= await loadConfig();
    if (!config.enabled || !config.origin || !config.token) throw new Error("참여자 룸 설정이 완료되지 않았습니다.");
    return fetch(config.origin + path, { ...options, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.token}`, ...options.headers } });
  };
  const post = async (path, body) => {
    const response = await adminFetch(path, { method: "POST", body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `릴레이 오류 (${response.status})`);
    return result;
  };
  const rememberDelivered = async id => {
    config.delivered.add(id);
    const ids = [...config.delivered].slice(-500);
    config.delivered = new Set(ids);
    await chrome.storage.local.set({ relayDeliveredCommandIds: ids });
  };
  const ack = (id, status, error = "") => post(`/api/admin/rooms/${encodeURIComponent(roomId)}/commands/${encodeURIComponent(id)}/ack`, { status, error });
  async function connect(roomTitle = "") {
    if (!roomId) return;
    const result = await post("/api/connect", { roomId, roomTitle, capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
    await chrome.storage.local.set({ relayLastRoomId: roomId, relayInviteUrl: result.inviteUrl || "" });
    clearInterval(pollTimer);
    pollTimer = setInterval(pollCommands, 1500);
    pollCommands();
  }
  async function pollCommands() {
    try {
      const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/commands`);
      if (!response.ok) return;
      for (const command of (await response.json()).commands || []) {
        if (command.type !== "chat.send") continue;
        if (config.delivered.has(command.id)) await ack(command.id, "delivered");
        else window.postMessage({ source: ROOM_SOURCE, direction: "bridge", action: "command", roomId, command }, location.origin);
      }
    } catch (_) {}
  }
  window.addEventListener("message", async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin) return;
    if (request?.source === HANDOUT_SOURCE && request?.direction === "request") {
      const requestId = clean(request.requestId, 100);
      const action = request.action === "stop" ? "stop" : request.action === "share" ? "share" : "";
      if (!requestId || !action || !roomId || !navigator.userActivation?.isActive) return;
      try {
        const body = action === "share" ? { roomId, handout: { id: clean(request.handout?.id, 200), title: clean(request.handout?.title, 500), bodyText: clean(request.handout?.bodyText, 50_000) } } : { roomId };
        const result = await post(`/api/share${action === "stop" ? "/stop" : ""}`, body);
        window.postMessage({ source: HANDOUT_SOURCE, direction: "response", requestId, ok: true, action, inviteUrl: result.inviteUrl || "" }, location.origin);
      } catch (error) {
        window.postMessage({ source: HANDOUT_SOURCE, direction: "response", requestId, ok: false, action, error: error?.message || "릴레이 연결 실패" }, location.origin);
      }
      return;
    }
    if (request?.source !== ROOM_SOURCE || request?.direction !== "page" || request.roomId !== roomId) return;
    try {
      config ||= await loadConfig();
      if (!config.enabled) return;
      if (request.action === "ready") await connect(clean(request.roomTitle, 200));
      if (request.action === "snapshot") {
        for (const message of Array.isArray(request.messages) ? request.messages : []) {
          const id = clean(message.id, 160);
          if (!id || sentMessages.has(id)) continue;
          sentMessages.add(id);
          await post(`/api/admin/rooms/${encodeURIComponent(roomId)}/messages`, { id, author: clean(message.author, 80), text: clean(message.text, 4000), createdAt: clean(message.createdAt, 40) });
        }
      }
      if (request.action === "commandResult") {
        const id = clean(request.commandId, 100);
        if (!id) return;
        if (request.status === "delivered") await rememberDelivered(id);
        await ack(id, request.status === "delivered" ? "delivered" : "failed", clean(request.error, 300));
      }
    } catch (error) { console.warn("[Capybara player relay]", error); }
  });
})();
