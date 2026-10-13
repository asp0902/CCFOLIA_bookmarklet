// A participant asks for a dice symbol: checks, the command the GM receives, the ledger, the rate limit and the GM switch.
import assert from "node:assert/strict";
import { RoomRelay } from "./worker.mjs";
const storage = new Map();
const relay = new RoomRelay({ storage: { get: async key => storage.get(key) ?? null, put: async (key, value) => { storage.set(key, value); } }, getWebSockets: () => [] });
const call = async (path, { body, cookie, gm = false, method = body ? "POST" : "GET" } = {}) => {
  const response = await relay.fetch(new Request(`https://relay.test${path}`, { method, headers: { "Content-Type": "application/json", "X-Capybara-GM": gm ? "1" : "0", "X-Public-Origin": "https://relay.test", "X-Client-IP": "1.1.1.1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  return { response, json: await response.clone().json().catch(() => ({})), text: await response.clone().text() };
};
const room = "R1";
const connected = await call("/api/connect", { gm: true, body: { roomId: room, roomTitle: "t", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });
const token = connected.json.inviteUrl.split("/").pop();
const joined = await call("/api/join", { body: { roomId: room, token, displayName: "참가자" } });
const cookie = joined.response.headers.get("set-cookie").split(";")[0];
const participant = (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json.participants[0];
await call(`/api/admin/rooms/${room}/participants/${participant.id}/decision`, { gm: true, body: { decision: "approve" } });
const scene = body => call(`/api/admin/rooms/${room}/scene`, { gm: true, body });
const field = async () => (await call(`/api/rooms/${room}/state`, { cookie })).json.scene;

const createCall = body => call(`/api/rooms/${room}/objects/create`, { cookie, body });
// stage 1 makes dice symbols only
assert.equal((await createCall({ kind: "character" })).response.status, 400);
assert.equal((await createCall({ kind: "dice", faces: 1 })).response.status, 400, "faces out of range");
assert.equal((await createCall({ kind: "dice", x: 5000 })).response.status, 400, "position out of range");
let made = await createCall({ kind: "dice", x: 3, y: -2, faces: 20 });
assert.equal(made.response.status, 202);
const pending = (await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands.find(c => c.id === made.json.commandId);
assert.deepEqual([pending.type, pending.kind, pending.x, pending.y, pending.faces], ["object.create", "dice", 3, -2, 20]);
// the GM's page reports the id of the new document: its maker is remembered
const ack = await call(`/api/admin/rooms/${room}/commands/${made.json.commandId}/ack`, { gm: true, body: { status: "delivered", objectId: "doc123" } });
assert.equal(ack.response.status, 200);
// 10 a minute per participant
for (let i = 0; i < 9; i += 1) assert.equal((await createCall({ kind: "dice" })).response.status, 202);
assert.equal((await createCall({ kind: "dice" })).response.status, 429, "rate limit");
// the GM switch
await call("/api/connect", { gm: true, body: { roomId: room, roomTitle: "t", capabilities: { chatRead: true, chatWrite: true, publicHandout: true, participantCreate: false } } });
assert.equal((await createCall({ kind: "dice" })).response.status, 403, "creation switched off by the GM");
console.log("object create PASS");
