(() => {
  "use strict";
  const SOURCE = "capybara-player-room-relay-v1";
  // The room can change without a page load (single-page app), so it is re-read from the URL by the loop below.
  const readRoomId = () => location.pathname.match(/^\/rooms\/([^/?#]+)/i)?.[1] || "";
  let roomId = readRoomId();
  if (window.top !== window) return;
  document.documentElement.dataset.capybaraPlayerRelay = "1";

  const clean = (value, max) => String(value || "").replace(/\u0000/g, "").slice(0, max);
  const emit = payload => window.postMessage({ source: SOURCE, direction: "page", roomId, ...payload }, location.origin);
  const ownText = element => clean([...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(""), 200).trim();
  const resolveRoomTitle = () => {
    const heading = [...document.querySelectorAll('h6.MuiTypography-subtitle2, h6[class*="MuiTypography-subtitle2"]')].find(element => element.offsetParent !== null && ownText(element));
    if (heading) return ownText(heading);
    const title = clean(document.title, 200).trim();
    return /^CCFOLIA\b/i.test(title) ? "" : title;
  };
  // YouTube BGM: the toolkit announces play/stop; the last signal is re-sent whenever the room (re)connects.
  let lastBgm = null;
  window.addEventListener("capybara-bgm-signal", event => {
    const d = event.detail || {};
    lastBgm = { state: d.state === "playing" ? "playing" : "stopped", videoId: clean(d.videoId, 20), title: clean(d.title, 200), loop: d.loop !== false };
    if (roomId) emit({ action: "bgm", bgm: lastBgm });
  });
  // "Dicebot engine : BCDice@x.y.z" in CCFOLIA's chat footer; the participant page shows the same version.
  const readDicebot = () => {
    const link = [...document.querySelectorAll('a[href*="bcdice"]')].find(a => /BCDice@[\w.\-]+/.test(a.textContent));
    return link ? clean(link.textContent.trim(), 40) : "";
  };
  let lastSceneKey = "", sceneTimer = 0, sceneUnsub = null;
  const sendScene = () => {
    if (!roomId) return;
    const api = window.__CCF_SECOND_CHAT_PANEL__;
    const scene = typeof api?.relayScene === "function" ? api.relayScene() : null;
    if (!scene) return;
    // the GM's own zoom/pan (scene.screen) is only the participant's starting view: it must not make a scene update of its own while the GM pans
    const key = JSON.stringify({ ...scene, screen: undefined });
    if (key === lastSceneKey) return;
    lastSceneKey = key;
    emit({ action: "scene", scene });
  };
  const scheduleScene = () => { if (!sceneTimer) sceneTimer = setTimeout(() => { sceneTimer = 0; sendScene(); }, 250); };
  let lastHealthKey = "";
  // Native mirroring: CCFOLIA's own CSS and DOM shapes for the participant page. Only parts whose hash changed are sent, and everything is sent again every 5 minutes (a reconnected relay starts empty).
  let mirrorKnown = {}, mirrorRoom = "", mirrorAt = 0;
  const sendMirror = async () => {
    if (!roomId) return;
    const api = window.__CCF_SECOND_CHAT_PANEL__;
    if (typeof api?.relayMirror !== "function") return;
    try {
      const resend = mirrorRoom !== roomId || Date.now() - mirrorAt > 300000;
      try { await api.relayAssetLoad?.(); await api.relayHelpProbe?.(); } catch (_) {}
      const result = api.relayMirror(resend ? {} : mirrorKnown);
      if (!resend && !result.css && !result.templates && !result.help && !result.assets) return;
      mirrorRoom = roomId; mirrorAt = resend ? Date.now() : mirrorAt; mirrorKnown = { cssHash: result.cssHash, tplHash: result.tplHash, helpHash: result.helpHash, assetsHash: result.assetsHash };
      emit({ action: "mirror", css: result.css, templates: result.templates, help: result.help, assets: result.assets, fontLinks: result.fontLinks });
    } catch (_) { /* a failed mirror must never stop the chat relay */ }
  };
  const snapshot = () => {
    if (!roomId) return;
    const api = window.__CCF_SECOND_CHAT_PANEL__;
    if (typeof api?.relayMessages !== "function") return;
    const all = api.relayMessages();
    if (!all) return; // the store is not ready yet: an empty list here would look like "everything was deleted"
    const messages = [].concat(...[...new Set(all.map(message => message.channel))].map(channel => all.filter(message => message.channel === channel).slice(-100))).map(message => ({
      id: clean(message.id, 160),
      author: clean(message.name === "이름 없음" ? "noname" : message.name, 80) || "CCFOLIA",
      text: clean(message.text || message.roll, 4000),
      createdAt: message.at ? new Date(message.at).toISOString() : new Date().toISOString(),
      channel: clean(message.channel, 100) || "main",
      color: /^#[0-9a-f]{3,8}$/i.test(message.color || "") ? message.color : "",
      // an icon uploaded long ago has a firebasestorage address; CCFOLIA itself shows it through the CDN (same prefix replacement)
      icon: (icon => /^https:\/\/storage\.ccfolia-cdn\.net\/[\w\-./%~+=?&]{1,500}$/.test(icon) ? icon : "")(String(message.icon || "").replace("https://firebasestorage.googleapis.com/v0/b/ccfolia-160aa.appspot.com/o", "https://storage.ccfolia-cdn.net")),
      edited: !!message.edited,
      roll: message.rollInfo && (message.roll || message.rollInfo.secret) ? { result: clean(message.roll, 400), success: !!message.rollInfo.success, failure: !!message.rollInfo.failure, critical: !!message.rollInfo.critical, fumble: !!message.rollInfo.fumble, secret: !!message.rollInfo.secret } : undefined,
    })).filter(message => message.id && message.text);
    const channels = typeof api.relayChannels === "function" ? api.relayChannels().slice(0, 12).map(item => ({ id: clean(item.id, 100), label: clean(item.label, 20) })).filter(item => item.id) : [];
    // What the GM still has, per tab, so the relay can drop messages that were deleted in CCFOLIA (only newer than the oldest one sent).
    const present = {};
    for (const id of new Set([...channels.map(item => item.id), ...messages.map(message => message.channel)])) {
      const own = messages.filter(message => message.channel === id);
      present[id] = { ids: own.map(message => message.id), since: own.map(message => message.createdAt).sort()[0] || null };
    }
    // Structure check of CCFOLIA's store: once when sharing connects and again whenever the CCFOLIA version or the result changes.
    let health;
    try {
      const result = typeof api.relayHealth === "function" ? api.relayHealth() : null;
      if (result) {
        const key = JSON.stringify([roomId, result.ok, result.ccfoliaVersion, result.missing]);
        if (key !== lastHealthKey) {
          lastHealthKey = key; health = result;
          if (!result.ok) showToastOnce("[capybara health]", key, `코코포리아 업데이트로 일부 공유 기능이 동작하지 않을 수 있습니다: ${result.missing.slice(0, 3).join(", ")}`);
        }
      }
    } catch (_) { /* a failed check must never stop the chat relay */ }
    emit({ action: "snapshot", messages, channels, dicebot: readDicebot(), present, health });
  };

  // A failed Roll20 line used to vanish silently: log it and show one short toast per distinct reason.
  const warned = new Set();
  const warnOnce = reason => showToastOnce("[capybara roll20]", reason, `롤20 채팅을 보내지 못했습니다: ${reason}`);
  const showToastOnce = (tag, key, text) => {
    console.warn(tag, key);
    if (warned.has(key)) return;
    warned.add(key);
    const note = document.createElement("div");
    note.textContent = text;
    note.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;padding:8px 16px;border-radius:4px;background:rgba(44,44,44,.95);color:#fff;font:14px sans-serif;box-shadow:0 3px 5px rgba(0,0,0,.3)";
    document.documentElement.append(note);
    setTimeout(() => note.remove(), 6000);
  };

  window.addEventListener("message", async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.source !== SOURCE || request?.direction !== "bridge") return;
    if (request.action === "external" && request.roomId === roomId) {
      const m = request.message || {};
      try { await window.__CCF_SECOND_CHAT_PANEL__?.relaySend?.(clean(m.name, 40) || "롤20", clean(m.text, 2000), clean(m.channel, 100), "", { source: "roll20", sourceId: clean(m.id, 160) }, undefined, /^https:\/\/\S{1,490}$/.test(String(m.avatar || "")) ? String(m.avatar) : ""); }
      catch (error) { warnOnce(clean(error?.message || "전송 실패", 200)); }
      return;
    }
    if (request.action !== "command" || !["chat.send", "piece.move", "status.set"].includes(request.command?.type) || /^object\.(create|update|delete|duplicate|place)$/.test(String(request.command?.type)) || request.roomId !== roomId) return;
    const commandId = clean(request.command.id, 100);
    try {
      const api = window.__CCF_SECOND_CHAT_PANEL__;
      if (/^object\./.test(request.command.type)) {
        if (typeof api?.relayObject !== "function") throw new Error("오브젝트 기능이 아직 준비되지 않았습니다.");
        const objectId = await api.relayObject({ type: clean(request.command.type, 30), kind: clean(request.command.kind, 20), targetId: clean(request.command.targetId, 100), fields: request.command.fields && typeof request.command.fields === "object" ? JSON.parse(JSON.stringify(request.command.fields).slice(0, 20000)) : {}, x: Number(request.command.x), y: Number(request.command.y), faces: Number(request.command.faces) });
        emit({ action: "commandResult", commandId, status: "delivered", objectId: clean(objectId, 100) });
        return;
      }
      if (request.command.type === "status.set") {
        if (typeof api?.relaySetStatus !== "function") throw new Error("상태값 변경 기능이 아직 준비되지 않았습니다.");
        await api.relaySetStatus(clean(request.command.characterId, 100), Number(request.command.index), Number(request.command.value));
        emit({ action: "commandResult", commandId, status: "delivered" });
        return;
      }
      if (request.command.type === "piece.move") {
        if (typeof api?.relayMovePiece !== "function") throw new Error("말 이동 기능이 아직 준비되지 않았습니다.");
        const { kind, pieceId, x, y } = request.command;
        await api.relayMovePiece(kind, clean(pieceId, 100), Number(x), Number(y));
        emit({ action: "commandResult", commandId, status: "delivered" });
        return;
      }
      if (typeof api?.relaySend !== "function") throw new Error("채팅 전송 기능이 아직 준비되지 않았습니다.");
      await api.relaySend(clean(request.command.name, 40) || clean(request.command.displayName, 40), clean(request.command.text, 2000), clean(request.command.channel, 100), clean(request.command.characterId, 100), undefined, /^#[0-9a-f]{6}$/i.test(request.command.color || "") ? request.command.color : "");
      emit({ action: "commandResult", commandId, status: "delivered" });
    } catch (error) {
      emit({ action: "commandResult", commandId, status: "failed", error: clean(error?.message || "전송 실패", 300) });
    }
  });

  // Event-driven: re-read the chat as soon as CCFOLIA's message store changes. Polling remains as a slow safety net.
  let unsubscribe = null;
  let snapshotTimer = 0;
  let ticks = 0;
  const scheduleSnapshot = () => {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => { snapshotTimer = 0; snapshot(); }, 40);
  };
  const trySceneSubscribe = () => {
    if (sceneUnsub) return;
    const api = window.__CCF_SECOND_CHAT_PANEL__;
    if (typeof api?.relaySceneSubscribe !== "function") return;
    try { sceneUnsub = api.relaySceneSubscribe(scheduleScene) || null; } catch (_) { sceneUnsub = null; }
  };
  const trySubscribe = () => {
    if (unsubscribe) return;
    const api = window.__CCF_SECOND_CHAT_PANEL__;
    if (typeof api?.relaySubscribe !== "function") return;
    try { unsubscribe = api.relaySubscribe(scheduleSnapshot) || null; } catch (_) { unsubscribe = null; }
  };
  let lastTitle = roomId ? resolveRoomTitle() : "";
  if (roomId) emit({ action: "ready", roomTitle: lastTitle });
  trySubscribe();
  snapshot();
  setInterval(() => {
    const nextRoom = readRoomId();
    if (nextRoom !== roomId) {
      roomId = nextRoom; lastTitle = "";
      lastBgm = null; lastSceneKey = "";
      if (roomId) { emit({ action: "ready", roomTitle: resolveRoomTitle() }); snapshot(); }
    }
    if (!roomId) return;
    const title = resolveRoomTitle();
    if (title && title !== lastTitle) { lastTitle = title; emit({ action: "title", roomTitle: title }); }
    trySubscribe();
    trySceneSubscribe();
    if (!sceneUnsub || ticks % 5 === 0) sendScene();
    if (!unsubscribe || ++ticks % 5 === 0) snapshot();
    if (ticks % 12 === 1 || mirrorRoom !== roomId) sendMirror();
  }, 1200);
})();
