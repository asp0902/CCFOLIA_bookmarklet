// Scene field settings: the grid display and grid size reach the participant (size clamped).
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
assert.equal((await scene({ fieldWidth: 20, fieldHeight: 10, displayGrid: true, gridSize: 2 })).response.status < 300, true);
let current = await field(); assert.equal(current.displayGrid, true); assert.equal(current.gridSize, 2);
await scene({ fieldWidth: 20, fieldHeight: 10, displayGrid: "yes", gridSize: 999 });
current = await field(); assert.equal(current.displayGrid, false, 'only a real true turns it on'); assert.equal(current.gridSize, 50, 'clamped');
await scene({ fieldWidth: 20, fieldHeight: 10, gridSize: -3 });
assert.equal((await field()).gridSize, 1);
await scene({ fieldWidth: 20, fieldHeight: 10, screen: { scale: 0.8, x: 30.4, y: -12 } });
current = await field(); assert.deepEqual(current.screen, { scale: 0.8, x: 30, y: -12 }, "the GM's own view is the participant's starting view");
await scene({ fieldWidth: 20, fieldHeight: 10, screen: { scale: 9, x: "a" } });
assert.deepEqual((await field()).screen, { scale: 2, x: 0, y: 0 }, "clamped to CCFOLIA's 0.2..2");
await scene({ fieldWidth: 20, fieldHeight: 10 });
assert.deepEqual((await field()).screen, { scale: 1, x: 0, y: 0 }, "default scale 1");
// decks and dice symbols: only the back of a deck (CDN) and its card count; a hidden die carries no value
await scene({ fieldWidth: 20, fieldHeight: 10, decks: [{ id: "d1", x: 1, y: 2, z: 0, width: 6, height: 8, count: 54, coverUrl: "https://storage.ccfolia-cdn.net/back.png", items: { c: { imageUrl: "https://storage.ccfolia-cdn.net/front.png" } } }, { id: "d2", coverUrl: "https://evil.test/b.png" }], diceSymbols: [{ id: "a", x: -1, y: -1, width: 2, height: 2, faces: 6, value: 4 }, { id: "b", faces: 20, value: 17, closed: true }] });
current = await field();
assert.deepEqual(current.decks, [{ id: "d1", x: 1, y: 2, z: 0, layer: 1, width: 6, height: 8, count: 54, coverUrl: "https://storage.ccfolia-cdn.net/back.png" }]);
assert(!JSON.stringify(current).includes("front.png"), "no card face reaches the participant");
assert.deepEqual(current.diceSymbols.map(d => [d.id, d.closed, d.value]), [["a", false, 4], ["b", true, 0]]);
// the default card back (a path on CCFOLIA's own site) is accepted as a path only
await scene({ fieldWidth: 20, fieldHeight: 10, decks: [{ id: "d1", coverUrl: "/images/trump/z01.png", count: 54 }, { id: "d2", coverUrl: "/images/../etc.png" }, { id: "d3", coverUrl: "https://evil.test/z.png" }] });
assert.deepEqual((await field()).decks.map(d => [d.id, d.coverUrl]), [["d1", "/images/trump/z01.png"]]);
console.log("scene field PASS");
