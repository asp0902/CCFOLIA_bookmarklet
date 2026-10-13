// "Open it now": the relay signals only the approved participants whose own list holds the handout (the GM's tool put it there only for those who may read it).
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
const ids = new Set();
const join = async name => { await call("/api/join", { body: { roomId: room, token, displayName: name } }); const list = (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json.participants; const id = list.find(item => item.displayName === name && !ids.has(item.id)).id; ids.add(id); return id; };
const [a, b, c, d] = [await join("가"), await join("나"), await join("다"), await join("라")];
for (const id of [a, b, c]) await call(`/api/admin/rooms/${room}/participants/${id}/decision`, { gm: true, body: { decision: "approve" } });
// the GM's tool has synced the lists: a and c hold h1, b holds something else, d is still waiting
const lists = { [a]: [{ id: "h1", title: "x", html: "<p>x</p>", secretHtml: "", folder: "", order: 0, updatedAt: "t" }], [b]: [{ id: "h2", title: "y", html: "<p>y</p>", secretHtml: "", folder: "", order: 0, updatedAt: "t" }], [c]: [{ id: "h1", title: "x", html: "<p>x</p>", secretHtml: "", folder: "", order: 0, updatedAt: "t" }] };
assert.equal((await call(`/api/admin/rooms/${room}/handouts`, { gm: true, body: { lists } })).response.status, 200);
const pushed = []; relay.push = (tag, data) => pushed.push([tag, data]);
const result = await call(`/api/admin/rooms/${room}/handout-popup`, { gm: true, body: { id: "h1" } });
assert.deepEqual(result.json, { accepted: true, count: 2 });
assert.deepEqual(pushed.filter(([, data]) => data.type === "handout-popup").map(([tag, data]) => [tag, data.id]).sort(), [[`p:${a}`, "h1"], [`p:${c}`, "h1"]].sort(), "only the two who hold it");
assert.equal((await call(`/api/admin/rooms/${room}/handout-popup`, { gm: true, body: { id: "nothing" } })).json.count, 0);
console.log("handout popup PASS");
