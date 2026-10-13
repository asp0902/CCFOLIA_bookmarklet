// Handouts per person: the GM's tool sends one list per participant; each gets only their own, the secret part only where the tool put it, nothing runs.
import assert from "node:assert/strict";
import { RoomRelay } from "./worker.mjs";
const storage = new Map();
const pushed = [];
const relay = new RoomRelay({ storage: { get: async key => storage.get(key) ?? null, put: async (key, value) => { storage.set(key, value); }, delete: async key => { storage.delete(key); } }, getWebSockets: () => [] });
relay.push = (tag, message) => pushed.push([tag, message]);
const call = async (path, { body, cookie, gm = false, method = body ? "POST" : "GET" } = {}) => {
  const response = await relay.fetch(new Request(`https://relay.test${path}`, { method, headers: { "Content-Type": "application/json", "X-Capybara-GM": gm ? "1" : "0", "X-Public-Origin": "https://relay.test", "X-Client-IP": "1.1.1.1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  return { response, json: await response.clone().json().catch(() => ({})) };
};
const room = "R2";
const connected = await call("/api/connect", { gm: true, body: { roomId: room, roomTitle: "t", capabilities: { chatRead: true, chatWrite: true, publicHandout: true } } });
const token = connected.json.inviteUrl.split("/").pop();
const people = [];
for (const name of ["앨리스", "밥"]) {
  const joined = await call("/api/join", { body: { roomId: room, token, displayName: name } });
  people.push({ name, cookie: joined.response.headers.get("set-cookie").split(";")[0] });
}
const list = (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json.participants;
for (const p of list) { await call(`/api/admin/rooms/${room}/participants/${p.id}/decision`, { gm: true, body: { decision: "approve" } }); people.find(x => x.name === p.displayName).id = p.id; }
const [alice, bob] = people;
// recipients: the options the tool offers, and a participant's choice
assert.equal((await call(`/api/admin/rooms/${room}/recipients`, { gm: true, body: { options: [{ key: "acct-1", label: "앨리스(PL)" }, { key: "", label: "빈 키" }] } })).json.count, 1);
assert.equal((await call(`/api/admin/rooms/${room}/participants/${alice.id}/recipient`, { gm: true, body: { key: "acct-1" } })).json.recipientKey, "acct-1");
const seen = (await call(`/api/admin/rooms/${room}/participants`, { gm: true })).json;
assert.deepEqual(seen.recipients, [{ key: "acct-1", label: "앨리스(PL)" }]); assert.equal(seen.participants.find(p => p.id === alice.id).recipientKey, "acct-1");
// the GM's tool sends the lists: Alice may read the secret part of h1, Bob only sees h2
const lists = { [alice.id]: [{ id: "h1", title: "비밀 지도", html: "<p>공개 <b>본문</b></p><script>x</script>", secretHtml: "<p>비밀</p>", updatedAt: "t1" }], [bob.id]: [{ id: "h2", title: "공지", html: "<p>모두에게</p>", secretHtml: "" }] };
const sent = await call(`/api/admin/rooms/${room}/handouts`, { gm: true, body: { lists } });
assert.equal(sent.json.changed, 2);
assert.deepEqual(pushed.filter(([, m]) => m.type === "handouts").map(([tag]) => tag).sort(), [`p:${alice.id}`, `p:${bob.id}`].sort(), "each person is told separately");
const mineA = (await call(`/api/rooms/${room}/my-handouts`, { cookie: alice.cookie })).json.items, mineB = (await call(`/api/rooms/${room}/my-handouts`, { cookie: bob.cookie })).json.items;
assert.deepEqual(mineA.map(i => i.id), ["h1"]); assert.deepEqual(mineB.map(i => i.id), ["h2"]);
assert.equal(mineA[0].secretHtml, "<p>비밀</p>"); assert.equal(mineB[0].secretHtml, "");
assert(!JSON.stringify(mineB).includes("비밀") && !JSON.stringify(mineB).includes("h1"), "nothing of Alice's reaches Bob");
assert(!mineA[0].html.includes("script"), "cleaned");
assert.equal((await call(`/api/rooms/${room}/my-handouts`)).response.status >= 400, true, "not for strangers");
// an unchanged list is not sent again; a removed handout empties the list
pushed.length = 0;
assert.equal((await call(`/api/admin/rooms/${room}/handouts`, { gm: true, body: { lists } })).json.changed, 0);
assert.equal((await call(`/api/admin/rooms/${room}/handouts`, { gm: true, body: { lists: { [alice.id]: [] } } })).json.changed, 2, "Bob's list is gone too (the GM no longer shares it)");
assert.deepEqual((await call(`/api/rooms/${room}/my-handouts`, { cookie: bob.cookie })).json.items, []);
// a revoked participant has nothing stored
await call(`/api/admin/rooms/${room}/handouts`, { gm: true, body: { lists } });
await call(`/api/admin/rooms/${room}/participants/${bob.id}/decision`, { gm: true, body: { decision: "revoke" } });
await call(`/api/admin/rooms/${room}/handouts`, { gm: true, body: { lists } });
assert.equal(storage.has(`handouts:${bob.id}`), false);
console.log("handouts per person PASS");
