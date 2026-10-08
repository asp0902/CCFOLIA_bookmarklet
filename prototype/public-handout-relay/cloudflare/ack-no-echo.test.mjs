import assert from "node:assert/strict";
import { RoomRelay } from "./worker.mjs";

// In-process relay with a fake storage: join, approve, send as a participant, acknowledge as the GM.
let stored = null;
const relay = new RoomRelay({ storage: { get: async () => stored, put: async (_key, value) => { stored = value; } }, getWebSockets: () => [] });
const call = async (path, { body, cookie, gm = false, method = body ? "POST" : "GET" } = {}) => {
  const response = await relay.fetch(new Request(`https://relay.test${path}`, { method, headers: { "Content-Type": "application/json", "X-Capybara-GM": gm ? "1" : "0", "X-Public-Origin": "https://relay.test", "X-Client-IP": "1.1.1.1", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { response, json: await response.clone().json().catch(() => ({})) };
};
const room = "R1";
const connected = await call("/api/connect", { gm: true, body: { roomId: room, roomTitle: "t", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });
const token = connected.json.inviteUrl.split("/").pop();
const joined = await call("/api/join", { body: { roomId: room, token, displayName: "참가자" } });
const cookie = joined.response.headers.get("set-cookie").split(";")[0];
const participant = (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json.participants[0];
await call(`/api/admin/rooms/${room}/participants/${participant.id}/decision`, { gm: true, body: { decision: "approve" } });
const sent = await call(`/api/rooms/${room}/messages`, { cookie, body: { clientMessageId: "c1", text: "내 메시지" } });
assert.equal(sent.response.status, 202);
const commands = (await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands;
assert.equal(commands.length, 1);
const ack = await call(`/api/admin/rooms/${room}/commands/${commands[0].id}/ack`, { gm: true, body: { status: "delivered" } });
assert.equal(ack.json.status, "delivered");
assert.equal(stored.messages.length, 0, "a delivered command adds no copy of the message (the GM's real message arrives with the snapshot)");
// the real message from the GM snapshot is the only one the participant sees
await call(`/api/admin/rooms/${room}/messages`, { gm: true, body: { id: "real-1", author: "참가자", text: "내 메시지", createdAt: new Date().toISOString(), channel: "main" } });
const state = (await call(`/api/rooms/${room}/state`, { cookie })).json;
assert.deepEqual(state.messages.map(m => m.text), ["내 메시지"], "exactly one");
console.log("ack no echo: PASS");
