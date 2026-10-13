// The GM takes a participant whose access was revoked (or request refused) out of the list: DELETE /api/admin/rooms/:id/participants/:pid. An approved or waiting one is refused (revoke / refuse first);
// the session stops working, the handout list and the ledger of what the person made go, the waiting count is untouched.
import assert from "node:assert/strict";
import { RoomRelay } from "./worker.mjs";
const storage = new Map();
const relay = new RoomRelay({ storage: { get: async key => storage.get(key) ?? null, put: async (key, value) => { storage.set(key, value); }, delete: async key => { storage.delete(key); } }, getWebSockets: () => [] });
const call = async (path, { body, cookie, gm = false, method = body ? "POST" : "GET" } = {}) => {
  const response = await relay.fetch(new Request(`https://relay.test${path}`, { method, headers: { "Content-Type": "application/json", "X-Capybara-GM": gm ? "1" : "0", "X-Public-Origin": "https://relay.test", "X-Client-IP": "1.1.1.1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  return { response, json: await response.clone().json().catch(() => ({})) };
};
const room = "R1";
const connected = await call("/api/connect", { gm: true, body: { roomId: room, roomTitle: "t", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });
const token = connected.json.inviteUrl.split("/").pop();
const list = async () => (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json.participants;
const join = async name => { const joined = await call("/api/join", { body: { roomId: room, token, displayName: name } }); const id = (await list()).find(item => item.displayName === name && !joinedIds.has(item.id)).id; joinedIds.add(id); return { cookie: joined.response.headers.get("set-cookie").split(";")[0], id }; };
const joinedIds = new Set();
const people = [await join("가"), await join("나"), await join("다"), await join("라")];
const [revoked, refused, approved, waiting] = people;
const decide = (person, decision) => call(`/api/admin/rooms/${room}/participants/${person.id}/decision`, { gm: true, body: { decision } });
await decide(revoked, "approve"); await decide(revoked, "revoke");
await decide(refused, "reject");
await decide(approved, "approve");
const remove = person => call(`/api/admin/rooms/${room}/participants/${person.id}`, { gm: true, method: "DELETE" });
// what the revoked one had: a handout list and an object in the ledger (the ledger is written when the GM's page reports a delivered create)
await call(`/api/admin/rooms/${room}/participants/${approved.id}/decision`, { gm: true, body: { decision: "approve" } });
storage.set(`handouts:${revoked.id}`, [{ id: "h1" }]);
relay.data = null;
const data = await relay.state.storage.get("room"); data.created = { objA: revoked.id, objB: approved.id }; data.createdAt = { objA: 1, objB: 1 }; data.createLog = { [revoked.id]: [1] }; storage.set("room", data); relay.data = null;
const pendingBefore = (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json.participants.filter(item => item.status === "pending").length;
assert.equal(pendingBefore, 1);
// approved and waiting ones cannot be deleted; an unknown one is not found (the GM check itself is the relay front door's, like every /api/admin/ route)
assert.equal((await remove(approved)).response.status, 409, "approved: revoke first");
assert.equal((await remove(waiting)).response.status, 409, "waiting: decide first");
assert.equal((await call(`/api/admin/rooms/${room}/participants/nobody`, { gm: true, method: "DELETE" })).response.status, 404);
// revoked and refused ones go
assert.deepEqual((await remove(revoked)).json, { id: revoked.id, deleted: true });
assert.equal((await remove(refused)).response.status, 200);
const left = await list();
assert.deepEqual(left.map(item => item.id).sort(), [approved.id, waiting.id].sort(), "the others stay");
assert.equal(left.filter(item => item.status === "pending").length, pendingBefore, "the waiting count is not touched");
// the session of the deleted one no longer works, their handout list and ledger entries are gone, the other's stay
assert.equal((await call(`/api/rooms/${room}/status`, { cookie: revoked.cookie })).response.status >= 400, true, "the session is invalid");
assert.equal(storage.has(`handouts:${revoked.id}`), false);
const after = storage.get("room");
assert.deepEqual([after.created.objA, after.created.objB, after.createLog?.[revoked.id]], [undefined, approved.id, undefined], "the ledger of the deleted one goes, the other's stays");
// a deleted person can ask again as a new one
const again = await join("가");
assert.notEqual(again.id, revoked.id);
console.log("participant remove PASS");
