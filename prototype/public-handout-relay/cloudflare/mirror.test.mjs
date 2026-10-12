// Native mirroring on the Worker side: the GM posts CSS and templates, they are re-checked and stored, participants get them by hash.
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
const post = body => call(`/api/admin/rooms/${room}/mirror`, { gm: true, body });
assert.equal((await post({ css: "x".repeat(900_001) })).response.status, 400);
assert.equal((await post({ templates: { "bad name": "<div></div>" } })).response.status, 400);
const ok = await post({ css: "@import url(a.css); .a{background:url(http://evil/x.png)}", templates: { row: '<div onclick="x()" data-cm-slot="body"><script>1</script>t</div>' }, fontLinks: ["https://fonts.googleapis.com/css2?family=Roboto", "https://evil.test/x.css"] });
assert.equal(ok.response.status, 200);
// participants get the cleaned CSS as a file and the templates by hash
const css = await call(`/api/rooms/${room}/mirror.css`, { cookie });
assert.match(css.response.headers.get("content-type"), /^text\/css/);
assert.equal(css.text, " .a{background:none}", "the CSS is cleaned again on the server");
const templates = (await call(`/api/rooms/${room}/mirror.json`, { cookie })).json.templates;
assert.equal(templates.row, '<div data-cm-slot="body">t</div>', "the template is cleaned again on the server");
const state = (await call(`/api/rooms/${room}/state`, { cookie })).json;
assert.equal(state.mirror.cssHash, ok.json.cssHash); assert.equal(state.mirror.tplHash, ok.json.tplHash);
assert.deepEqual(state.mirror.fontLinks, ["https://fonts.googleapis.com/css2?family=Roboto"]);
// a template-only update keeps the stored CSS
await post({ templates: { row: "<div></div>" } });
assert.equal((await call(`/api/rooms/${room}/mirror.css`, { cookie })).text, " .a{background:none}");
// not reachable without approval / as a stranger
assert.equal((await call(`/api/rooms/${room}/mirror.css`)).response.status >= 400, true);
console.log("mirror worker PASS");
