const encoder = new TextEncoder();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const token = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const text = (value, max) => typeof value === "string" ? value.replace(/\u0000/g, "").slice(0, max) : "";
const bearer = request => /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "")?.[1] || "";
const safeEqual = async (left, right) => {
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(String(left))), crypto.subtle.digest("SHA-256", encoder.encode(String(right)))]);
  const aa = new Uint8Array(a); const bb = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < aa.length; index++) difference |= aa[index] ^ bb[index];
  return difference === 0;
};
const cookie = request => Object.fromEntries((request.headers.get("Cookie") || "").split(";").map(value => value.trim().split("=")).filter(value => value.length === 2));
const roomFromPath = pathname => {
  const match = pathname.match(/^\/api\/(?:admin\/)?rooms\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
};
const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive"
};

export class RoomRelay {
  constructor(state) {
    this.state = state;
    this.data = null;
    this.clients = new Map();
    this.rates = new Map();
  }
  async room() {
    if (!this.data) this.data = await this.state.storage.get("room") || null;
    return this.data;
  }
  async save(room) {
    this.data = room;
    await this.state.storage.put("room", room);
  }
  limited(request, join = false) {
    const now = Date.now();
    const key = `${request.headers.get("X-Client-IP") || "unknown"}:${join ? "join" : "request"}`;
    const current = this.rates.get(key);
    const rate = !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 0 } : current;
    rate.count += 1; this.rates.set(key, rate);
    return rate.count > (join ? 10 : 120);
  }
  send(memberId, event, data = {}) {
    const line = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    this.clients.get(memberId)?.forEach(client => client.writer.write(line).catch(() => this.removeClient(memberId, client)));
  }
  close(memberId, event) {
    const writers = this.clients.get(memberId);
    if (!writers) return;
    const line = encoder.encode(`event: ${event}\ndata: {}\n\n`);
    writers.forEach(client => { clearInterval(client.heartbeat); client.writer.write(line).then(() => client.writer.close()).catch(() => {}); });
    this.clients.delete(memberId);
  }
  removeClient(memberId, client) {
    const writers = this.clients.get(memberId);
    clearInterval(client.heartbeat);
    writers?.delete(client);
    if (!writers?.size) this.clients.delete(memberId);
  }
  access(request, room) {
    const sessionId = cookie(request).capybara_session || "";
    const participantId = room.sessions?.[sessionId];
    const member = participantId ? room.participants?.[participantId] : null;
    return member?.sessionId === sessionId ? member : null;
  }
  normalize(room) {
    if (!room) return room;
    room.handout ||= {};
    room.participants ||= {};
    room.sessions ||= {};
    room.messages ||= [];
    room.commands ||= [];
    room.seenMessageIds ||= {};
    room.capabilities ||= { chatRead: true, chatWrite: true, publicHandout: true };
    return room;
  }
  appendMessage(room, message) {
    if (!message.id || room.seenMessageIds[message.id]) return false;
    room.seenMessageIds[message.id] = Date.now();
    room.messages.push(message);
    if (room.messages.length > 300) room.messages.splice(0, room.messages.length - 300);
    const keep = new Set(room.messages.map(item => item.id));
    Object.keys(room.seenMessageIds).forEach(id => { if (!keep.has(id)) delete room.seenMessageIds[id]; });
    return true;
  }
  async fetch(request) {
    if (this.limited(request, new URL(request.url).pathname === "/api/join")) return json({ error: "요청이 너무 많습니다." }, 429);
    const url = new URL(request.url);
    let room = this.normalize(await this.room());
    if (request.method === "POST" && url.pathname === "/api/connect") {
      const body = await request.json();
      if (Object.keys(body).some(key => !["roomId", "roomTitle", "capabilities"].includes(key))) return json({ error: "허용되지 않은 필드" }, 400);
      if (!room?.active) room = this.normalize({ active: true, inviteToken: token() });
      room.active = true;
      room.roomTitle = text(body.roomTitle, 200).trim();
      room.capabilities = {
        chatRead: body.capabilities?.chatRead !== false,
        chatWrite: body.capabilities?.chatWrite !== false,
        publicHandout: body.capabilities?.publicHandout !== false,
      };
      room.gmHeartbeatAt = Date.now();
      await this.save(room);
      return json({ inviteUrl: `${request.headers.get("X-Public-Origin")}/#room=${encodeURIComponent(body.roomId)}&token=${encodeURIComponent(room.inviteToken)}` });
    }
    if (request.method === "POST" && url.pathname === "/api/share") {
      const body = await request.json();
      if (Object.keys(body).some(key => !["roomId", "handout"].includes(key))) return json({ error: "허용되지 않은 필드" }, 400);
      if (Object.keys(body.handout || {}).some(key => !["id", "title", "bodyText"].includes(key))) return json({ error: "공개 필드만 전송할 수 있습니다." }, 400);
      const handout = { id: text(body.handout?.id, 200), title: text(body.handout?.title, 500), bodyText: text(body.handout?.bodyText, 50_000), updatedAt: new Date().toISOString() };
      if (!handout.id) return json({ error: "handout.id가 필요합니다." }, 400);
      if (!room?.active) room = this.normalize({ active: true, inviteToken: token() });
      room.active = true; room.handout = handout;
      await this.save(room);
      Object.values(room.participants).forEach(member => { if (member.status === "approved") this.send(member.id, "handout", handout); });
      return json({ inviteUrl: `${request.headers.get("X-Public-Origin")}/#room=${encodeURIComponent(body.roomId)}&token=${encodeURIComponent(room.inviteToken)}` });
    }
    if (request.method === "POST" && url.pathname === "/api/share/stop") {
      if (room) {
        room.active = false;
        Object.values(room.participants || {}).forEach(member => { member.status = "revoked"; this.close(member.id, "revoked"); });
        room.inviteToken = "";
        room.handout = {};
        room.participants = {};
        room.sessions = {};
        room.messages = [];
        room.commands = [];
        room.seenMessageIds = {};
        await this.save(room);
      }
      return json({ stopped: true });
    }
    if (!room?.active) return json({ error: "공유 중인 룸이 없습니다." }, 404);
    if (request.method === "GET" && /^\/api\/admin\/rooms\/[^/]+\/participants$/.test(url.pathname)) {
      return json({ participants: Object.values(room.participants).map(({ id, displayName, status, requestedAt }) => ({ id, displayName, status, requestedAt })) });
    }
    if (request.method === "GET" && /^\/api\/admin\/rooms\/[^/]+\/commands$/.test(url.pathname)) {
      room.gmHeartbeatAt = Date.now();
      await this.save(room);
      return json({ commands: room.commands.filter(command => command.status === "pending").slice(0, 50) });
    }
    const commandAckMatch = url.pathname.match(/^\/api\/admin\/rooms\/[^/]+\/commands\/([^/]+)\/ack$/);
    if (request.method === "POST" && commandAckMatch) {
      const command = room.commands.find(item => item.id === decodeURIComponent(commandAckMatch[1]));
      const body = await request.json();
      if (!command || !["delivered", "failed"].includes(body.status)) return json({ error: "명령 또는 상태가 올바르지 않습니다." }, 400);
      command.status = body.status;
      command.acknowledgedAt = new Date().toISOString();
      command.error = text(body.error, 300);
      if (body.status === "delivered") this.appendMessage(room, {
        id: `external:${command.participantId}:${command.clientMessageId}`,
        author: command.displayName,
        text: command.text,
        origin: "external",
        createdAt: command.createdAt,
      });
      await this.save(room);
      return json({ id: command.id, status: command.status });
    }
    if (request.method === "POST" && /^\/api\/admin\/rooms\/[^/]+\/messages$/.test(url.pathname)) {
      const body = await request.json();
      if (Object.keys(body).some(key => !["id", "author", "text", "createdAt"].includes(key))) return json({ error: "허용되지 않은 필드" }, 400);
      const message = {
        id: text(body.id, 160).trim(),
        author: text(body.author, 80).trim() || "CCFOLIA",
        text: text(body.text, 4_000).trim(),
        origin: "ccfolia",
        createdAt: text(body.createdAt, 40) || new Date().toISOString(),
      };
      if (!message.id || !message.text) return json({ error: "메시지 ID와 본문이 필요합니다." }, 400);
      const added = this.appendMessage(room, message);
      room.gmHeartbeatAt = Date.now();
      if (added) await this.save(room);
      return json({ accepted: true, duplicate: !added });
    }
    const decisionMatch = url.pathname.match(/^\/api\/admin\/rooms\/[^/]+\/participants\/([^/]+)\/decision$/);
    if (request.method === "POST" && decisionMatch) {
      const member = room.participants[decodeURIComponent(decisionMatch[1])];
      const decision = (await request.json()).decision;
      if (!member) return json({ error: "참가 요청을 찾을 수 없습니다." }, 404);
      if (decision === "approve" && member.status === "pending") member.status = "approved";
      else if (decision === "reject" && member.status === "pending") { member.status = "rejected"; this.close(member.id, "rejected"); }
      else if (decision === "revoke" && member.status === "approved") { member.status = "revoked"; this.close(member.id, "revoked"); }
      else return json({ error: "현재 상태에서 처리할 수 없습니다." }, 409);
      await this.save(room);
      return json({ id: member.id, status: member.status });
    }
    if (request.method === "POST" && url.pathname === "/api/join") {
      const body = await request.json();
      const displayName = text(body.displayName, 40).trim();
      if (!await safeEqual(body.token || "", room.inviteToken)) return json({ error: "승인되지 않았거나 종료된 공유입니다." }, 403);
      if (!displayName) return json({ error: "표시 이름을 입력해주세요." }, 400);
      const id = token(); const sessionId = token();
      room.participants[id] = { id, displayName, status: "pending", requestedAt: new Date().toISOString(), sessionId };
      room.sessions[sessionId] = id;
      await this.save(room);
      return json({ status: "pending" }, 202, { "Set-Cookie": `capybara_session=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/` });
    }
    const member = this.access(request, room);
    if (!member) return json({ error: "접근 권한이 없습니다." }, 403);
    if (request.method === "GET" && /\/status$/.test(url.pathname)) return json({ status: member.status, displayName: member.displayName });
    if (member.status !== "approved") return json({ error: "GM 승인이 필요합니다." }, 403);
    if (request.method === "GET" && /\/state$/.test(url.pathname)) return json({
      roomTitle: room.roomTitle || "플레이 룸",
      capabilities: room.capabilities,
      gmOnline: Date.now() - Number(room.gmHeartbeatAt || 0) < 15_000,
      messages: room.capabilities.chatRead ? room.messages : [],
      handout: room.capabilities.publicHandout ? room.handout : {},
    });
    if (request.method === "POST" && /\/messages$/.test(url.pathname)) {
      if (!room.capabilities.chatWrite) return json({ error: "GM이 외부 채팅 전송을 허용하지 않았습니다." }, 403);
      const body = await request.json();
      if (Object.keys(body).some(key => !["clientMessageId", "text"].includes(key))) return json({ error: "허용되지 않은 필드" }, 400);
      const clientMessageId = text(body.clientMessageId, 100).trim();
      const messageText = text(body.text, 2_000).trim();
      if (!clientMessageId || !messageText) return json({ error: "메시지 ID와 본문이 필요합니다." }, 400);
      const existing = room.commands.find(command => command.participantId === member.id && command.clientMessageId === clientMessageId);
      if (existing) return json({ accepted: true, commandId: existing.id, duplicate: true }, 202);
      const command = { id: token(), type: "chat.send", participantId: member.id, displayName: member.displayName, clientMessageId, text: messageText, status: "pending", createdAt: new Date().toISOString() };
      room.commands.push(command);
      if (room.commands.length > 300) room.commands.splice(0, room.commands.length - 300);
      await this.save(room);
      return json({ accepted: true, commandId: command.id }, 202);
    }
    if (request.method === "GET" && /\/handout$/.test(url.pathname)) return json(room.handout);
    if (request.method === "GET" && /\/events$/.test(url.pathname)) {
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      if (!this.clients.has(member.id)) this.clients.set(member.id, new Set());
      const client = { writer, heartbeat: setInterval(() => writer.write(encoder.encode(`event: heartbeat\ndata: {"at":${Date.now()}}\n\n`)).catch(() => this.removeClient(member.id, client)), 10_000) };
      this.clients.get(member.id).add(client);
      writer.write(encoder.encode(`event: handout\ndata: ${JSON.stringify(room.handout)}\n\n`));
      request.signal.addEventListener("abort", () => { this.removeClient(member.id, client); writer.close().catch(() => {}); });
      return new Response(stream.readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive" } });
    }
    return json({ error: "not found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      Object.entries(securityHeaders).forEach(([key, value]) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    }
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = origin === url.origin || /^https:\/\/(?:[a-z0-9-]+\.)*ccfolia\.com$/i.test(origin) || origin.startsWith("chrome-extension://") ? origin : "";
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return json({ error: "허용되지 않은 출처" }, 403);
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Max-Age": "600" } });
    }
    if (origin && !allowedOrigin) return json({ error: "허용되지 않은 출처" }, 403);
    const gmRoute = url.pathname === "/api/connect" || url.pathname === "/api/share" || url.pathname === "/api/share/stop" || url.pathname.startsWith("/api/admin/");
    if (gmRoute && !await safeEqual(bearer(request), env.GM_TOKEN || "")) return json({ error: "GM 인증 실패" }, 401);
    let roomId = roomFromPath(url.pathname);
    if (!roomId && request.method === "POST") {
      try { roomId = text((await request.clone().json()).roomId, 200).trim(); } catch (_) {}
    }
    if (!roomId) return json({ error: "roomId가 필요합니다." }, 400);
    const headers = new Headers(request.headers);
    headers.delete("Authorization"); headers.delete("X-Capybara-GM"); headers.delete("X-Client-IP"); headers.delete("X-Public-Origin");
    headers.set("X-Capybara-GM", gmRoute ? "1" : "0");
    headers.set("X-Client-IP", request.headers.get("CF-Connecting-IP") || "unknown");
    headers.set("X-Public-Origin", url.origin);
    const response = await env.ROOMS.getByName(roomId).fetch(new Request(request, { headers }));
    const outputHeaders = new Headers(response.headers);
    Object.entries(securityHeaders).forEach(([key, value]) => outputHeaders.set(key, value));
    if (allowedOrigin) outputHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
    return new Response(response.body, { status: response.status, headers: outputHeaders });
  }
};
