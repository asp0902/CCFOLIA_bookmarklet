import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const json = (res, status, value, headers = {}) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", ...headers });
  res.end(body);
};
const token = () => crypto.randomBytes(32).toString("base64url");
const text = (value, max) => typeof value === "string" ? value.replace(/\u0000/g, "").slice(0, max) : "";
const bearer = req => /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "")?.[1] || "";
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const cookies = req => Object.fromEntries(String(req.headers.cookie || "").split(";").map(v => v.trim().split("=")).filter(v => v.length === 2));
const readJson = req => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 60_000) req.destroy(new Error("request too large"));
  });
  req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (_) { reject(new Error("invalid json")); } });
  req.on("error", reject);
});

export function createRelay({ gmToken = token(), publicOrigin = "http://127.0.0.1:8787" } = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const sse = (client, event, data = {}) => client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const closeParticipant = (member, event) => {
    member.clients.forEach(client => { sse(client, event); client.end(); });
    member.clients.clear();
  };
  const closeRoom = room => {
    room.participants.forEach(member => {
      member.status = "revoked";
      closeParticipant(member, "revoked");
      sessions.delete(member.sessionId);
    });
  };
  const participant = (req, roomId) => {
    const session = sessions.get(cookies(req).capybara_session || "");
    const room = rooms.get(roomId);
    const member = session?.roomId === roomId ? room?.participants.get(session.participantId) : null;
    return room?.active && member?.sessionId === session?.id ? { room, member } : null;
  };
  const requireGm = req => safeEqual(bearer(req), gmToken);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", publicOrigin);
    const origin = String(req.headers.origin || "");
    const allowedOrigin = /^https:\/\/(?:[a-z0-9-]+\.)*ccfolia\.com$/i.test(origin) || origin.startsWith("chrome-extension://") ? origin : "";
    if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    try {
      if (req.method === "OPTIONS") {
        if (!allowedOrigin) return json(res, 403, { error: "허용되지 않은 출처" });
        res.writeHead(204, { "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Max-Age": "600" });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/api/share") {
        if (!requireGm(req)) return json(res, 401, { error: "GM 인증 실패" });
        const body = await readJson(req);
        if (Object.keys(body).some(key => !["roomId", "handout"].includes(key))) return json(res, 400, { error: "허용되지 않은 필드" });
        if (Object.keys(body.handout || {}).some(key => !["id", "title", "bodyText"].includes(key))) return json(res, 400, { error: "공개 필드만 전송할 수 있습니다." });
        const roomId = text(body.roomId, 200).trim();
        const handout = { id: text(body.handout?.id, 200), title: text(body.handout?.title, 500), bodyText: text(body.handout?.bodyText, 50_000), updatedAt: new Date().toISOString() };
        if (!roomId || !handout.id) return json(res, 400, { error: "roomId와 handout.id가 필요합니다." });
        let room = rooms.get(roomId);
        if (!room) room = { active: true, inviteToken: token(), handout, participants: new Map() };
        room.active = true; room.handout = handout; rooms.set(roomId, room);
        room.participants.forEach(member => {
          if (member.status === "approved") member.clients.forEach(client => sse(client, "handout", handout));
        });
        return json(res, 200, { inviteUrl: `${publicOrigin}/#room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(room.inviteToken)}` });
      }
      if (req.method === "POST" && url.pathname === "/api/share/stop") {
        if (!requireGm(req)) return json(res, 401, { error: "GM 인증 실패" });
        const roomId = text((await readJson(req)).roomId, 200).trim();
        const room = rooms.get(roomId);
        if (room) { room.active = false; closeRoom(room); rooms.delete(roomId); }
        return json(res, 200, { stopped: true });
      }
      const adminList = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/participants$/);
      if (req.method === "GET" && adminList) {
        if (!requireGm(req)) return json(res, 401, { error: "GM 인증 실패" });
        const room = rooms.get(decodeURIComponent(adminList[1]));
        if (!room?.active) return json(res, 404, { error: "공유 중인 룸이 없습니다." });
        return json(res, 200, { participants: Array.from(room.participants.values(), member => ({ id: member.id, displayName: member.displayName, status: member.status, requestedAt: member.requestedAt })) });
      }
      const adminDecision = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/participants\/([^/]+)\/decision$/);
      if (req.method === "POST" && adminDecision) {
        if (!requireGm(req)) return json(res, 401, { error: "GM 인증 실패" });
        const room = rooms.get(decodeURIComponent(adminDecision[1]));
        const member = room?.participants.get(decodeURIComponent(adminDecision[2]));
        const decision = (await readJson(req)).decision;
        if (!room?.active || !member) return json(res, 404, { error: "참가 요청을 찾을 수 없습니다." });
        if (decision === "approve" && member.status === "pending") member.status = "approved";
        else if (decision === "reject" && member.status === "pending") { member.status = "rejected"; closeParticipant(member, "rejected"); }
        else if (decision === "revoke" && member.status === "approved") { member.status = "revoked"; closeParticipant(member, "revoked"); }
        else return json(res, 409, { error: "현재 상태에서 처리할 수 없습니다." });
        return json(res, 200, { id: member.id, status: member.status });
      }
      if (req.method === "POST" && url.pathname === "/api/join") {
        const body = await readJson(req);
        const roomId = text(body.roomId, 200).trim();
        const displayName = text(body.displayName, 40).trim();
        const room = rooms.get(roomId);
        if (!room?.active || !safeEqual(body.token || "", room.inviteToken)) return json(res, 403, { error: "승인되지 않았거나 종료된 공유입니다." });
        if (!displayName) return json(res, 400, { error: "표시 이름을 입력해주세요." });
        const id = token();
        const sessionId = token();
        const member = { id, displayName, status: "pending", requestedAt: new Date().toISOString(), sessionId, clients: new Set() };
        room.participants.set(id, member);
        sessions.set(sessionId, { id: sessionId, roomId, participantId: id });
        return json(res, 202, { status: "pending" }, { "Set-Cookie": `capybara_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/` });
      }
      const participantStatus = url.pathname.match(/^\/api\/rooms\/([^/]+)\/status$/);
      if (req.method === "GET" && participantStatus) {
        const access = participant(req, decodeURIComponent(participantStatus[1]));
        if (!access) return json(res, 403, { error: "접근 권한이 없습니다." });
        return json(res, 200, { status: access.member.status, displayName: access.member.displayName });
      }
      const current = url.pathname.match(/^\/api\/rooms\/([^/]+)\/handout$/);
      if (req.method === "GET" && current) {
        const access = participant(req, decodeURIComponent(current[1]));
        if (!access || access.member.status !== "approved") return json(res, 403, { error: "GM 승인이 필요합니다." });
        return json(res, 200, access.room.handout);
      }
      const events = url.pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
      if (req.method === "GET" && events) {
        const access = participant(req, decodeURIComponent(events[1]));
        if (!access || access.member.status !== "approved") return json(res, 403, { error: "GM 승인이 필요합니다." });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive" });
        access.member.clients.add(res); sse(res, "handout", access.room.handout);
        const heartbeat = setInterval(() => sse(res, "heartbeat", { at: Date.now() }), 10_000);
        req.on("close", () => { clearInterval(heartbeat); access.member.clients.delete(res); });
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/participant.js" || url.pathname === "/style.css")) {
        const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
        let body = fs.readFileSync(path.join(root, "public", file));
        if (file === "index.html") body = Buffer.from(body.toString("utf8").replaceAll("__PUBLIC_ORIGIN__", publicOrigin));
        res.writeHead(200, { "Content-Type": types[path.extname(file)], "Content-Length": body.length, "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
        return res.end(body);
      }
      json(res, 404, { error: "not found" });
    } catch (error) {
      json(res, error.message === "request too large" ? 413 : 400, { error: error.message || "bad request" });
    }
  });
  return { server, gmToken, rooms, sessions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const relay = createRelay({ gmToken: process.env.CAPYBARA_GM_TOKEN || token(), publicOrigin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}` });
  relay.server.listen(port, "127.0.0.1", () => {
    console.log(`Participant relay: http://127.0.0.1:${port}`);
    console.log(`GM token: ${relay.gmToken}`);
  });
}
