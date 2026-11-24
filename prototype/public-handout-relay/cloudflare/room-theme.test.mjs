// The GM's room theme (theme-switcher 0.2.72): only colours (#rrggbb), alpha 0-100, blur 0-30 and a known sheet theme pass; participants get it in the state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const post = body => call(`/api/admin/rooms/${room}/theme`, { gm: true, body });
assert.equal((await post({ theme: { bg: "#111111", appbar: "#222222", paper: "#333333", border: "#444444", text: "#FFFFFF", inputBg: "#000000", accent: "url(x)", uiText: "#abcdef", alpha: 150, blur: -3, evil: "x" }, sheet: "unsung-duet" })).response.status, 200);
let state = (await call(`/api/rooms/${room}/state`, { cookie })).json;
assert.deepEqual(state.theme, { theme: { bg: "#111111", appbar: "#222222", paper: "#333333", border: "#444444", text: "#ffffff", inputBg: "#000000", accent: "", uiText: "#abcdef", scrollbar: "", alpha: 100, blur: 0 }, sheet: "unsung-duet" });
// a broken base colour = no theme (the participant keeps the normal look); an unknown sheet theme is dropped
await post({ theme: { bg: "red", appbar: "#222222", paper: "#333333", border: "#444444", text: "#ffffff", inputBg: "#000000" }, sheet: "<script>" });
state = (await call(`/api/rooms/${room}/state`, { cookie })).json;
assert.deepEqual(state.theme, { theme: null, sheet: "" });
// (who may post it: every /api/admin/* route needs the GM token at the Worker entrance — tested with the other GM routes)
console.log("room theme PASS");
