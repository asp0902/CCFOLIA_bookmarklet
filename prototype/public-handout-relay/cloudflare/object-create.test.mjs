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
// kinds: dice symbols and characters
assert.equal((await createCall({ kind: "deck" })).response.status, 400);
assert.equal((await createCall({ kind: "dice", faces: 1 })).response.status, 400, "faces out of range");
assert.equal((await createCall({ kind: "dice", x: 5000 })).response.status, 400, "position out of range");
let made = await createCall({ kind: "dice", x: 3, y: -2, faces: 20 });
assert.equal(made.response.status, 202);
const pending = (await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands.find(c => c.id === made.json.commandId);
assert.deepEqual([pending.type, pending.kind, pending.x, pending.y, pending.faces], ["object.create", "dice", 3, -2, 20]);
// the GM's page reports the id of the new document: its maker is remembered
const ack = await call(`/api/admin/rooms/${room}/commands/${made.json.commandId}/ack`, { gm: true, body: { status: "delivered", objectId: "doc123" } });
assert.equal(ack.response.status, 200);
// characters: create with the editor's fields only, then only the maker may change, place, duplicate or delete
const op = (name, body) => call(`/api/rooms/${room}/objects/${name}`, { cookie, body });
const commandsNow = async () => (await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands;
const madeChar = await op("create", { kind: "character", fields: { name: "알리스", size: 3, owner: "evil", secret: true, memo: "m" } });
assert.equal(madeChar.response.status, 202);
const charCommand = (await commandsNow()).find(c => c.id === madeChar.json.commandId);
assert.deepEqual(charCommand.fields, { name: "알리스", width: 3, height: 3, memo: "m" }, "only the editor's fields reach the GM");
assert.equal((await op("update", { kind: "character", id: "c1", fields: { name: "x" } })).response.status, 404, "a character that is not in the room");
await scene({ fieldWidth: 20, fieldHeight: 10, characterDocs: [{ id: "c1", name: "알리스" }, { id: "c2", name: "복제" }, { id: "gm-char", name: "GM의 캐릭터" }] });
const claimed = await op("claim", { kind: "character", id: "gm-char" });
assert.equal(claimed.response.status, 200, "taking ownership of a character of the room");
assert((await call(`/api/rooms/${room}/mine`, { cookie })).json.owned.includes("gm-char"));
assert.equal((await call(`/api/rooms/${room}/character-doc?id=gm-char`, { cookie })).json.character.name, "GM의 캐릭터", "any character's editor fields");
assert.equal((await op("claim", { kind: "character", id: "nowhere" })).response.status, 404);
await call(`/api/admin/rooms/${room}/commands/${madeChar.json.commandId}/ack`, { gm: true, body: { status: "delivered", objectId: "c1" } });
assert.equal((await op("update", { kind: "character", id: "c1", fields: {} })).response.status, 400, "nothing to change");
const upd = await op("update", { kind: "character", id: "c1", fields: { name: "새 이름", status: [{ label: "HP", value: 5, max: 10 }], secret: true } });
assert.equal(upd.response.status, 202);
assert.deepEqual((await commandsNow()).find(c => c.id === upd.json.commandId).fields, { name: "새 이름", status: [{ label: "HP", value: 5, max: 10 }] });
const placed = await op("place", { kind: "character", id: "c1", x: 12, y: -4 });
assert.deepEqual((await commandsNow()).find(c => c.id === placed.json.commandId).fields, { x: 12, y: -4 });
const dup = await op("duplicate", { kind: "character", id: "c1" });
assert.equal(dup.response.status, 202);
await call(`/api/admin/rooms/${room}/commands/${dup.json.commandId}/ack`, { gm: true, body: { status: "delivered", objectId: "c2" } });
// the characters made by this participant come back with the editor's fields (reported by the GM's page with the scene)
await scene({ fieldWidth: 20, fieldHeight: 10, characterDocs: [{ id: "c1", name: "새 이름", memo: "m", width: 3, status: [{ label: "HP", value: 5, max: 10 }], owner: "gm", secret: true }, { id: "c2", name: "복제" }, { id: "gm-char", name: "GM의 캐릭터" }] });
const mine = (await call(`/api/rooms/${room}/mine`, { cookie })).json.characters;
assert.deepEqual(mine.map(c => c.id).sort(), ["c1", "c2", "gm-char"], "their own characters and the one they took");
assert(!("owner" in mine[0]) && !("secret" in mine[0]));
assert.equal((await call(`/api/rooms/${room}/mine`)).response.status >= 400, true, "not for strangers");
// delete: the GM's page confirms, then the id leaves the ledger
const del = await op("delete", { kind: "character", id: "c2" });
assert.equal(del.response.status, 202);
await call(`/api/admin/rooms/${room}/commands/${del.json.commandId}/ack`, { gm: true, body: { status: "delivered" } });
await scene({ fieldWidth: 20, fieldHeight: 10, characterDocs: [{ id: "c1", name: "알리스" }, { id: "gm-char", name: "GM의 캐릭터" }] });
assert.equal((await op("update", { kind: "character", id: "c2", fields: { name: "y" } })).response.status, 404, "deleted characters are gone from the room");
assert.equal((await op("create", { kind: "dice", id: "c1" })).response.status, 202); // (counts as one create)
// two GM tabs: the one that claims a command first runs it, the other is told no; the same tab may claim again; a claim does not outlive a minute
const claimCall = (id, by) => call(`/api/admin/rooms/${room}/commands/${id}/claim`, { gm: true, body: { by } });
const raced = await op("update", { kind: "character", id: "c1", fields: { name: "z" } });
assert.equal((await claimCall(raced.json.commandId, "tab-a")).json.claimed, true);
assert.equal((await claimCall(raced.json.commandId, "tab-b")).json.claimed, false, "the other tab skips it");
assert.equal((await claimCall(raced.json.commandId, "tab-a")).json.claimed, true, "the claiming tab again");
assert.equal((await claimCall("nope", "tab-a")).json.claimed, false);
await call(`/api/admin/rooms/${room}/commands/${raced.json.commandId}/ack`, { gm: true, body: { status: "delivered" } });
assert.equal((await claimCall(raced.json.commandId, "tab-b")).json.claimed, false, "an answered command is not claimed again");
// a dice symbol moves only for the participant who made it (ledger); /mine lists everything they made
await call(`/api/admin/rooms/${room}/commands/${made.json.commandId}/ack`, { gm: true, body: { status: "delivered", objectId: "doc123" } });
assert((await call(`/api/rooms/${room}/mine`, { cookie })).json.owned.includes("doc123"));
relay.data = null; // the room object restarts: the ledger comes back from storage
assert((await call(`/api/rooms/${room}/mine`, { cookie })).json.owned.includes("doc123"), "the ledger survives a restart");
const moveDie = id => call(`/api/rooms/${room}/pieces/move`, { cookie, body: { kind: "dice", id, x: 3, y: 4 } });
assert.equal((await moveDie("doc123")).response.status, 202, "their own die");
assert.equal((await moveDie("somebody-elses")).response.status, 403, "not theirs");
// rolling and deleting one's own die (the GM page picks the number); somebody else's die: refused
const roll = await op("update", { kind: "dice", id: "doc123" });
assert.equal(roll.response.status, 202); assert.equal((await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands.find(c => c.id === roll.json.commandId)?.roll, true);
const setDie = await op("update", { kind: "dice", id: "doc123", fields: { faces: 8, value: 5, closed: true, owner: "x" } });
assert.equal(setDie.response.status, 202); assert.deepEqual((await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands.find(c => c.id === setDie.json.commandId)?.fields, { faces: 8, value: 5, closed: true }, "kind, value and hidden only");
const rolled = await op("update", { kind: "dice", id: "doc123", fields: { value: 4 }, roll: true });
assert.equal((await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands.find(c => c.id === rolled.json.commandId)?.rollMessage, true, "a roll is also said in the chat");
assert.equal((await op("update", { kind: "dice", id: "doc123", fields: { faces: 7 } })).response.status, 400, "only the native kinds");
assert.equal((await op("update", { kind: "dice", id: "doc123", fields: { faces: 6, value: 9 } })).response.status, 400, "value within the faces");
assert.equal((await op("update", { kind: "dice", id: "somebody-elses" })).response.status, 403, "not their die to roll");
assert.equal((await op("delete", { kind: "dice", id: "somebody-elses" })).response.status, 403, "not their die to delete");
assert.equal((await op("delete", { kind: "dice", id: "doc123" })).response.status, 202);
const stow = await op("place", { kind: "character", id: "c1", stow: true });
assert.equal(stow.response.status, 202); assert.equal((await call(`/api/admin/rooms/${room}/commands`, { gm: true })).json.commands.find(c => c.id === stow.json.commandId)?.stow, true, "put away");
assert.equal((await call(`/api/rooms/${room}/pieces/move`, { cookie, body: { kind: "deck", id: "d", x: 1, y: 1 } })).response.status, 400, "decks are not movable");
// the participant can read what became of their own request (and only theirs)
const statusOf = id => call(`/api/rooms/${room}/commands/${id}/result`, { cookie });
assert.deepEqual((await statusOf(upd.json.commandId)).json, { status: "pending", error: "" });
await call(`/api/admin/rooms/${room}/commands/${upd.json.commandId}/ack`, { gm: true, body: { status: "failed", error: "이 룸은 참여자가 오브젝트를 만들 수 없습니다." } });
assert.deepEqual((await statusOf(upd.json.commandId)).json, { status: "failed", error: "이 룸은 참여자가 오브젝트를 만들 수 없습니다." });
assert.equal((await statusOf("nope")).response.status, 404);
// 10 a minute per participant
for (let i = 0; i < 6; i += 1) assert.equal((await createCall({ kind: "dice" })).response.status, 202);
assert.equal((await createCall({ kind: "dice" })).response.status, 429, "rate limit");
// the GM switch
await call("/api/connect", { gm: true, body: { roomId: room, roomTitle: "t", capabilities: { chatRead: true, chatWrite: true, publicHandout: true, participantCreate: false } } });
assert.equal((await createCall({ kind: "dice" })).response.status, 403, "creation switched off by the GM");
console.log("object create PASS");
