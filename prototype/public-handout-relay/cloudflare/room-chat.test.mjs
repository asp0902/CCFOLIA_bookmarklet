import assert from "node:assert/strict";

const base = process.env.RELAY_BASE_URL || "http://127.0.0.1:8790";
const gmToken = process.env.RELAY_GM_TOKEN || "test-gm-token";
const roomId = `chat-${Date.now().toString(36)}`;
const request = (path, { body, cookie, auth = false, method = body ? "POST" : "GET" } = {}) => fetch(base + path, {
  method,
  headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: `Bearer ${gmToken}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const connected = await request("/api/connect", { auth: true, body: { roomId, roomTitle: "통합 검사", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });
assert.equal(connected.status, 200);
const inviteToken = new URLSearchParams(new URL((await connected.json()).inviteUrl).hash.slice(1)).get("token");
const joined = await request("/api/join", { body: { roomId, token: inviteToken, displayName: "참가자" } });
assert.equal(joined.status, 202);
const cookie = joined.headers.get("set-cookie").split(";")[0];
const participant = (await (await request(`/api/admin/rooms/${roomId}/participants`, { auth: true })).json()).participants[0];
await request(`/api/admin/rooms/${roomId}/participants/${participant.id}/decision`, { auth: true, body: { decision: "approve" } });

await request(`/api/admin/rooms/${roomId}/messages`, { auth: true, body: { id: "ccf-1", author: "GM", text: "CCFOLIA에서 옴", createdAt: new Date().toISOString() } });
let state = await (await request(`/api/rooms/${roomId}/state`, { cookie })).json();
assert.equal(state.messages.at(-1).text, "CCFOLIA에서 옴");

const outbound = await request(`/api/rooms/${roomId}/messages`, { cookie, body: { clientMessageId: "client-1", text: "참여자 발언" } });
assert.equal(outbound.status, 202);
const commands = await (await request(`/api/admin/rooms/${roomId}/commands`, { auth: true })).json();
assert.equal(commands.commands.length, 1);
assert.equal(commands.commands[0].displayName, "참가자");
await request(`/api/admin/rooms/${roomId}/commands/${commands.commands[0].id}/ack`, { auth: true, body: { status: "delivered" } });
state = await (await request(`/api/rooms/${roomId}/state`, { cookie })).json();
assert.equal(state.messages.at(-1).origin, "external");
assert.equal(state.messages.at(-1).text, "참여자 발언");
assert.equal((await (await request(`/api/admin/rooms/${roomId}/commands`, { auth: true })).json()).commands.length, 0);
await request("/api/share/stop", { auth: true, body: { roomId } });
console.log("player room chat relay: PASS");
