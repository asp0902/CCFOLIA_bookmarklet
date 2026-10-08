(() => {
  "use strict";
  const HANDOUT_SOURCE = "capybara-public-handout-relay-v1";
  const ROOM_SOURCE = "capybara-player-room-relay-v1";
  const clean = (value, max) => String(value || "").replace(/\u0000/g, "").slice(0, max);
  // CCFOLIA is a single-page app: the room changes without a page load (home -> room, room -> room). The room id is read from the URL
  // every time it is needed, and a watcher below re-connects when it changes, so each room gets its own relay room and invite URL.
  const readRoomId = () => location.pathname.match(/^\/rooms\/([^/?#]+)/i)?.[1] || "";
  let roomId = readRoomId();
  const sentMessages = new Set();
  let lastChannelKey = "";
  let lastScene = null; // latest room scene from the page, sent again after (re)connecting
  let lastBgm = null; // latest YouTube BGM signal from the page, sent again after (re)connecting
  let config = null;
  let pollTimer = 0;
  let socket = null;
  let socketOpen = false;
  let socketRetries = 0;
  let socketRetryTimer = 0;
  let socketPingTimer = 0;
  let snapshotChain = Promise.resolve();
  let lastWarnAt = 0;
  const inFlight = new Set();
  // Shown on the options page so the GM can see whether the push socket is up (otherwise only slow polling runs).
  const setSocketStatus = (state, detail = {}) => { try { Promise.resolve(chrome.storage.local.set({ relaySocket: { state, roomId, at: Date.now(), ...detail } })).catch(() => {}); } catch (_) {} };
  const warn = error => { const now = Date.now(); if (now - lastWarnAt > 10_000) { lastWarnAt = now; console.warn("[Capybara player relay]", error); } };
  const b64url = value => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  let connectedTitle = null;
  let stopped = false;
  let connectChain = Promise.resolve();
  // Invite URLs are kept per room (relayInvites); relayInviteUrl / relayLastRoomId mirror the room this tab is in.
  async function rememberInvite(id, inviteUrl) {
    const { relayInvites } = await chrome.storage.local.get(["relayInvites"]);
    await chrome.storage.local.set({ relayInvites: { ...(relayInvites || {}), [id]: inviteUrl }, relayLastRoomId: id, relayInviteUrl: inviteUrl });
  }
  async function forgetInvite(id) {
    const { relayInvites } = await chrome.storage.local.get(["relayInvites"]);
    if (relayInvites && id in relayInvites) { const rest = { ...relayInvites }; delete rest[id]; await chrome.storage.local.set({ relayInvites: rest }); }
    await chrome.storage.local.remove("relayInviteUrl");
  }
  async function doConnect(roomTitle) {
    const id = roomId;
    if (!id || stopped) return;
    if (pollTimer && connectedTitle === roomTitle) return;
    const result = await post("/api/connect", { roomId: id, roomTitle, capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
    if (id !== roomId) return; // the tab moved to another room while connecting; that room connects on its own
    connectedTitle = roomTitle;
    await rememberInvite(id, result.inviteUrl || "");
    if (lastScene) post(`/api/admin/rooms/${encodeURIComponent(id)}/scene`, lastScene).catch(() => {});
    if (lastBgm) post(`/api/admin/rooms/${encodeURIComponent(id)}/bgm`, lastBgm).catch(() => {});
    startPolling();
    pollCommands();
    openSocket();
  }
  // Commands arrive over the push socket; polling stays as a slow safety net (fast while the socket is down).
  const startPolling = () => { clearInterval(pollTimer); pollTimer = setInterval(pollCommands, socketOpen ? 10_000 : 1500); };
  const connect = (roomTitle = "") => { const run = connectChain.catch(() => {}).then(() => doConnect(roomTitle)); connectChain = run; return run; };
  async function disconnect() {
    stopped = true; connectedTitle = null;
    clearInterval(pollTimer); pollTimer = 0;
    clearTimeout(socketRetryTimer); clearInterval(socketPingTimer);
    const old = socket; socket = null; socketOpen = false;
    if (old) { try { old.close(); } catch (_) {} }
    setSocketStatus("off");
    await forgetInvite(roomId);
  }
  // Drop everything that belongs to the previous room (socket, polling, queued commands, delivered-message memory).
  function resetConnection() {
    stopped = false; connectedTitle = null;
    clearInterval(pollTimer); pollTimer = 0;
    clearTimeout(socketRetryTimer); clearInterval(socketPingTimer);
    const old = socket; socket = null; socketOpen = false; socketRetries = 0;
    if (old) { try { old.close(); } catch (_) {} }
    inFlight.clear(); sentMessages.clear(); lastBgm = null; lastScene = null; lastChannelKey = ""; snapshotChain = Promise.resolve();
  }
  function dropSocket(own, event) {
    if (socket !== own) return; // replaced or closed on purpose
    socket = null; socketOpen = false;
    setSocketStatus("closed", { code: event?.code ?? 0, reason: String(event?.reason || "").slice(0, 80) });
    clearInterval(socketPingTimer);
    try { own.close(); } catch (_) {}
    if (pollTimer) startPolling();
    if (!stopped) { socketRetries = Math.min(socketRetries + 1, 6); socketRetryTimer = setTimeout(openSocket, Math.min(1000 * 2 ** (socketRetries - 1), 30_000)); }
  }
  function openSocket() {
    if (socket || stopped || !pollTimer || !config?.origin || !config.token) return;
    if (typeof WebSocket !== "function") { setSocketStatus("unsupported"); return; }
    let own;
    // Browsers cannot set an Authorization header on a WebSocket; the token travels as a subprotocol.
    try { own = socket = new WebSocket(`${config.origin.replace(/^http/, "ws")}/api/admin/rooms/${encodeURIComponent(roomId)}/ws`, ["capybara-gm", b64url(config.token)]); } catch (error) { socket = null; setSocketStatus("closed", { code: 0, reason: String(error?.message || error).slice(0, 80) }); return; }
    setSocketStatus("connecting");
    let lastSeen = Date.now();
    own.onopen = () => {
      if (socket !== own) return;
      socketOpen = true; socketRetries = 0; lastSeen = Date.now();
      setSocketStatus("open");
      clearInterval(socketPingTimer);
      socketPingTimer = setInterval(() => {
        if (Date.now() - lastSeen > 55_000) return dropSocket(own, { code: 4000, reason: "no pong" }); // the connection is dead
        try { own.send("ping"); } catch (_) {}
      }, 20_000);
      startPolling();
      pollCommands(); // pick up anything queued while the socket was down
    };
    own.onmessage = event => {
      if (socket !== own) return;
      lastSeen = Date.now();
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type === "command") handleCommand(message.command).catch(warn);
      else if (message.type === "closed") disconnect().catch(() => {});
    };
    own.onclose = event => dropSocket(own, event);
    own.onerror = () => {};
  }
  async function handleCommand(command) {
    if (!["chat.send", "piece.move"].includes(command?.type) || !command.id) return;
    if (inFlight.has(command.id)) return; // already handed to the page; its result will acknowledge it
    if (config.delivered.has(command.id)) { await ack(command.id, "delivered"); return; }
    inFlight.add(command.id);
    await rememberDelivered(command.id);
    window.postMessage({ source: ROOM_SOURCE, direction: "bridge", action: "command", roomId, command }, location.origin);
  }
  async function pollCommands() {
    try {
      const response = await adminFetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/commands`);
      if (!response.ok) return;
      for (const command of (await response.json()).commands || []) await handleCommand(command);
    } catch (_) {}
  }
  // The options page stops sharing from another page; it signals this tab through storage.
  chrome.storage.onChanged?.addListener((changes, area) => { if (area === "local" && changes.relayStop?.newValue?.roomId === roomId) disconnect().catch(() => {}); });
  const autoStart = async () => {
    try { config ||= await loadConfig(); if (config.enabled && config.origin && config.token && roomId) await connect(connectedTitle ?? ""); }
    catch (error) { warn(error); if (!stopped) setTimeout(autoStart, 15000); }
  };
  autoStart();
  // Follow in-app navigation between rooms.
  const routeTimer = setInterval(() => {
    if (!chrome.runtime?.id) { clearInterval(routeTimer); stopped = true; resetConnection(); return; } // orphaned after an extension reload
    const next = readRoomId();
    if (next === roomId) return;
    roomId = next;
    resetConnection();
    setSocketStatus("off");
    if (roomId) autoStart();
  }, 1000);
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
        if (action === "stop") await disconnect();
        window.postMessage({ source: HANDOUT_SOURCE, direction: "response", requestId, ok: true, action, inviteUrl: result.inviteUrl || "" }, location.origin);
      } catch (error) {
        window.postMessage({ source: HANDOUT_SOURCE, direction: "response", requestId, ok: false, action, error: error?.message || "릴레이 연결 실패" }, location.origin);
      }
      return;
    }
    if (request?.source !== ROOM_SOURCE || request?.direction !== "page" || !roomId || request.roomId !== roomId) return;
    try {
      config ||= await loadConfig();
      if (!config.enabled) return;
      if (request.action === "ready" || request.action === "title") {
        const title = clean(request.roomTitle, 200);
        if (request.action === "ready" || title) await connect(title || connectedTitle || "");
      }
      if (request.action === "scene") {
        lastScene = request.scene && typeof request.scene === "object" ? request.scene : null;
        if (lastScene) await post(`/api/admin/rooms/${encodeURIComponent(roomId)}/scene`, lastScene);
      }
      if (request.action === "bgm") {
        const bgm = request.bgm || {};
        lastBgm = { state: bgm.state === "playing" ? "playing" : "stopped", videoId: clean(bgm.videoId, 20), title: clean(bgm.title, 200), loop: bgm.loop !== false };
        await post(`/api/admin/rooms/${encodeURIComponent(roomId)}/bgm`, lastBgm);
      }
      if (request.action === "snapshot") {
        const messages = Array.isArray(request.messages) ? request.messages : [];
        const channels = Array.isArray(request.channels) ? request.channels.slice(0, 12).map(item => ({ id: clean(item.id, 100), label: clean(item.label, 20) })).filter(item => item.id) : [];
        const dicebot = /^BCDice@[\w.\-]+$/.test(clean(request.dicebot, 40)) ? clean(request.dicebot, 40) : "";
        const channelKey = JSON.stringify({ channels, dicebot });
        if ((channels.length || dicebot) && channelKey !== lastChannelKey) {
          lastChannelKey = channelKey;
          post(`/api/admin/rooms/${encodeURIComponent(roomId)}/channels`, { channels, dicebot }).catch(() => { lastChannelKey = ""; });
        }
        const run = snapshotChain.catch(() => {}).then(async () => {
          for (const message of messages) {
            const id = clean(message.id, 160);
            if (!id || sentMessages.has(id)) continue;
            sentMessages.add(id);
            try { await post(`/api/admin/rooms/${encodeURIComponent(roomId)}/messages`, { id, author: clean(message.author, 80), text: clean(message.text, 4000), createdAt: clean(message.createdAt, 40), channel: clean(message.channel, 100), color: clean(message.color, 20), icon: clean(message.icon, 600) }); }
            catch (error) { sentMessages.delete(id); throw error; }
          }
        });
        snapshotChain = run;
        await run;
      }
      if (request.action === "commandResult") {
        const id = clean(request.commandId, 100);
        if (!id) return;
        inFlight.delete(id);
        if (request.status === "delivered") await rememberDelivered(id);
        await ack(id, request.status === "delivered" ? "delivered" : "failed", clean(request.error, 300));
      }
    } catch (error) { warn(error); }
  });
})();
