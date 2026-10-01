import assert from "node:assert/strict";

// Run against `wrangler dev --port 8790 --var GM_TOKEN:test-gm-token` (RELAY_BASE_URL / RELAY_GM_TOKEN override).
const base = process.env.RELAY_BASE_URL || "http://127.0.0.1:8790";
const gmToken = process.env.RELAY_GM_TOKEN || "test-gm-token";
const wsBase = base.replace(/^http/, "ws");
const roomId = `ws-${Date.now().toString(36)}`;
const b64url = value => Buffer.from(value, "utf8").toString("base64url");
const request = (path, { body, cookie, auth = false, method = body ? "POST" : "GET" } = {}) => fetch(base + path, {
  method,
  headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: `Bearer ${gmToken}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function openSocket(path, { protocols, headers } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsBase + path, { protocols, headers });
    const events = [];
    const wrapper = {
      socket, events, closed: null,
      waitFor(predicate, ms = 3000) {
        return new Promise((done, fail) => {
          const started = Date.now();
          const timer = setInterval(() => {
            const found = events.find(predicate);
            if (found) { clearInterval(timer); done({ event: found, ms: Date.now() - started }); }
            else if (Date.now() - started > ms) { clearInterval(timer); fail(new Error(`timeout waiting for event; got ${JSON.stringify(events)}`)); }
          }, 5);
        });
      },
      close() { try { socket.close(); } catch (_) {} },
    };
    socket.addEventListener("message", event => { try { events.push(JSON.parse(event.data)); } catch (_) { events.push({ raw: String(event.data) }); } });
    socket.addEventListener("close", event => { wrapper.closed = { code: event.code, reason: event.reason }; });
    socket.addEventListener("open", () => resolve(wrapper));
    socket.addEventListener("error", () => reject(new Error("socket failed to open")));
  });
}
const refused = async (path, options) => { try { (await openSocket(path, options)).close(); return false; } catch (_) { return true; } };
const adminWs = `/api/admin/rooms/${roomId}/ws`;
const playerWs = `/api/rooms/${roomId}/ws`;
const sockets = [];
const track = socket => { sockets.push(socket); return socket; };

try {
  // The participant page itself must carry the security headers (static assets bypass the worker unless routed through it).
  const page = await fetch(base + "/");
  const csp = page.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'self'") && csp.includes(`connect-src 'self' ${wsBase}`), `page CSP allows its own websocket origin: ${csp}`);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert((await page.text()).includes("participant.js"), "page still served");

  const connect = await request("/api/connect", { auth: true, body: { roomId, roomTitle: "소켓 검사", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });
  const inviteToken = new URLSearchParams((await connect.json()).inviteUrl.split("#")[1]).get("token");

  // GM socket: token only via subprotocol; wrong/missing token is refused; protocol is echoed without the token.
  assert(await refused(adminWs), "GM socket without token refused");
  assert(await refused(adminWs, { protocols: ["capybara-gm", b64url("wrong-token")] }), "GM socket with wrong token refused");
  assert(await refused(adminWs, { protocols: ["capybara-gm", "not valid!"] }), "malformed token refused");
  assert(await refused(adminWs, { protocols: ["capybara-gm", b64url(gmToken)], headers: { Origin: "https://evil.example" } }), "foreign Origin refused");
  const gm = track(await openSocket(adminWs, { protocols: ["capybara-gm", b64url(gmToken)], headers: { Origin: "https://ccfolia.com" } }));
  assert.equal(gm.socket.protocol, "capybara-gm");
  await gm.waitFor(event => event.type === "hello");

  // Keep-alive ping is answered.
  gm.socket.send("ping");
  await gm.waitFor(event => event.raw === "pong");

  // Anything other than the keep-alive ping is rejected (protects against message floods).
  const noisy = track(await openSocket(adminWs, { protocols: ["capybara-gm", b64url(gmToken)] }));
  await noisy.waitFor(event => event.type === "hello");
  noisy.socket.send("not a ping");
  for (let waited = 0; noisy.socket.readyState < 2 && waited < 2000; waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
  assert(noisy.socket.readyState >= 2, "unexpected client message closes the socket");

  // Participant: pending / cookie-less sockets are refused, approved ones open.
  const join = await request("/api/join", { body: { roomId, token: inviteToken, displayName: "소켓 참가자" } });
  const cookie = `capybara_session=${/capybara_session=([^;]+)/.exec(join.headers.get("set-cookie"))[1]}`;
  assert(await refused(playerWs, { headers: { Cookie: cookie } }), "pending participant refused");
  const list = await (await request(`/api/admin/rooms/${roomId}/participants`, { auth: true })).json();
  const participantId = list.participants[0].id;
  await request(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { auth: true, body: { decision: "approve" } });
  assert(await refused(playerWs), "approved but cookie-less refused");
  const player = track(await openSocket(playerWs, { headers: { Cookie: cookie } }));
  await player.waitFor(event => event.type === "hello");

  // GM chat message -> participant, pushed.
  await request(`/api/admin/rooms/${roomId}/messages`, { auth: true, body: { id: "m1", author: "GM", text: "푸시 메시지", createdAt: new Date().toISOString() } });
  const pushed = await player.waitFor(event => event.type === "message" && event.message.id === "m1", 1000);
  assert.equal(pushed.event.message.text, "푸시 메시지");
  const gmToPlayerMs = pushed.ms;

  // Participant chat -> GM command, pushed.
  const send = await request(`/api/rooms/${roomId}/messages`, { cookie, body: { clientMessageId: "c1", text: "참가자 발언" } });
  assert.equal(send.status, 202);
  const command = (await gm.waitFor(event => event.type === "command" && event.command.clientMessageId === "c1", 1000)).event.command;
  assert.equal(command.text, "참가자 발언");

  // Acknowledged delivery shows up for participants as their own message.
  await request(`/api/admin/rooms/${roomId}/commands/${command.id}/ack`, { auth: true, body: { status: "delivered" } });
  await player.waitFor(event => event.type === "message" && event.message.origin === "external" && event.message.text === "참가자 발언", 1000);

  // Handout and metadata pushes.
  await request("/api/share", { auth: true, body: { roomId, handout: { id: "h1", title: "핸드아웃", bodyText: "본문" } } });
  await player.waitFor(event => event.type === "handout" && event.handout.title === "핸드아웃", 1000);
  await request("/api/connect", { auth: true, body: { roomId, roomTitle: "새 제목" } });
  await player.waitFor(event => event.type === "meta" && event.roomTitle === "새 제목" && event.gmOnline === true, 1000);

  // Capability off -> no chat push.
  await request("/api/connect", { auth: true, body: { roomId, roomTitle: "새 제목", capabilities: { chatRead: false, chatWrite: true, publicHandout: true } } });
  const before = player.events.length;
  await request(`/api/admin/rooms/${roomId}/messages`, { auth: true, body: { id: "m-hidden", author: "GM", text: "숨김", createdAt: new Date().toISOString() } });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert(!player.events.slice(before).some(event => event.type === "message"), "chatRead=false pushes nothing");
  await request("/api/connect", { auth: true, body: { roomId, roomTitle: "새 제목", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });

  // Revoke closes only that participant's socket (4001).
  await request(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { auth: true, body: { decision: "revoke" } });
  await player.waitFor(event => event.type === "closed" && event.reason === "revoked", 1000);
  for (let waited = 0; player.socket.readyState < 2 && waited < 2000; waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
  assert(player.socket.readyState >= 2, "revoked socket is closing (the close code is checked in the browser test; Node's client does not finish the handshake)");
  assert(await refused(playerWs, { headers: { Cookie: cookie } }), "revoked participant cannot reconnect");
  assert.equal(gm.socket.readyState, 1, "GM socket survives a participant revoke");

  // Share stop closes the GM socket (4003) and the room refuses new sockets.
  await request("/api/share/stop", { auth: true, body: { roomId } });
  await gm.waitFor(event => event.type === "closed" && event.reason === "stopped", 1000);
  for (let waited = 0; gm.socket.readyState < 2 && waited < 2000; waited += 25) await new Promise(resolve => setTimeout(resolve, 25));
  assert(gm.socket.readyState >= 2, "share stop closes the GM socket");
  assert(await refused(adminWs, { protocols: ["capybara-gm", b64url(gmToken)] }), "no GM socket on an inactive room");

  console.log(`websocket push: auth, origin, ping, GM→participant ${gmToPlayerMs}ms, participant→GM, ack echo, handout/meta, capability, revoke and stop notices + close PASS`);
} finally {
  sockets.forEach(socket => socket.close());
  await request("/api/share/stop", { auth: true, body: { roomId } }).catch(() => {});
  setTimeout(() => process.exit(process.exitCode || 0), 100);
}
