(() => {
  "use strict";
  const SOURCE = "capybara-player-room-relay-v1";
  const roomId = location.pathname.match(/^\/rooms\/([^/?#]+)/i)?.[1] || "";
  if (!roomId || window.top !== window) return;

  const clean = (value, max) => String(value || "").replace(/\u0000/g, "").slice(0, max);
  const emit = payload => window.postMessage({ source: SOURCE, direction: "page", roomId, ...payload }, location.origin);
  const ownText = element => clean([...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(""), 200).trim();
  const resolveRoomTitle = () => {
    const heading = [...document.querySelectorAll('h6.MuiTypography-subtitle2, h6[class*="MuiTypography-subtitle2"]')].find(element => element.offsetParent !== null && ownText(element));
    if (heading) return ownText(heading);
    const title = clean(document.title, 200).trim();
    return /^CCFOLIA\b/i.test(title) ? "" : title;
  };
  const snapshot = () => {
    const api = window.__CCF_SECOND_CHAT_PANEL__;
    if (typeof api?.relayMessages !== "function") return;
    const messages = api.relayMessages().slice(-100).map(message => ({
      id: clean(message.id, 160),
      author: clean(message.name, 80) || "CCFOLIA",
      text: clean(message.roll || message.text, 4000),
      createdAt: message.at ? new Date(message.at).toISOString() : new Date().toISOString(),
    })).filter(message => message.id && message.text);
    emit({ action: "snapshot", messages });
  };

  window.addEventListener("message", async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.source !== SOURCE || request?.direction !== "bridge") return;
    if (request.action !== "command" || request.command?.type !== "chat.send" || request.roomId !== roomId) return;
    const commandId = clean(request.command.id, 100);
    try {
      const api = window.__CCF_SECOND_CHAT_PANEL__;
      if (typeof api?.relaySend !== "function") throw new Error("채팅 전송 기능이 아직 준비되지 않았습니다.");
      await api.relaySend(clean(request.command.displayName, 40), clean(request.command.text, 2000));
      emit({ action: "commandResult", commandId, status: "delivered" });
    } catch (error) {
      emit({ action: "commandResult", commandId, status: "failed", error: clean(error?.message || "전송 실패", 300) });
    }
  });

  let lastTitle = resolveRoomTitle();
  emit({ action: "ready", roomTitle: lastTitle });
  snapshot();
  setInterval(() => {
    const title = resolveRoomTitle();
    if (title && title !== lastTitle) { lastTitle = title; emit({ action: "title", roomTitle: title }); }
    snapshot();
  }, 1200);
})();
