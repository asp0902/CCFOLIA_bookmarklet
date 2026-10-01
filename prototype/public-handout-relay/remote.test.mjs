import assert from "node:assert/strict";
import test from "node:test";

const base = process.env.RELAY_BASE_URL;
const gmToken = process.env.RELAY_GM_TOKEN;
if (!base || !gmToken) throw new Error("RELAY_BASE_URL and RELAY_GM_TOKEN are required");
const roomId = `test-${Date.now().toString(36)}`;
const cookieOf = response => response.headers.get("set-cookie").split(";")[0];
const post = (path, body, auth = "") => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
const get = (path, cookie = "", auth = "") => fetch(base + path, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } });

test("deployed relay approval and individual revocation", async () => {
  const shared = await post("/api/share", { roomId, handout: { id: "public", title: "외부 테스트", bodyText: "비민감 공개 내용" } }, gmToken);
  assert.equal(shared.status, 200);
  const invite = new URL((await shared.json()).inviteUrl);
  assert.equal(invite.origin, new URL(base).origin);
  const inviteToken = new URLSearchParams(invite.hash.slice(1)).get("token");
  const joinA = await post("/api/join", { roomId, token: inviteToken, displayName: "A" });
  const joinB = await post("/api/join", { roomId, token: inviteToken, displayName: "B" });
  const cookieA = cookieOf(joinA); const cookieB = cookieOf(joinB);
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieA)).status, 403);
  const list = (await (await get(`/api/admin/rooms/${roomId}/participants`, "", gmToken)).json()).participants;
  for (const member of list) assert.equal((await post(`/api/admin/rooms/${roomId}/participants/${member.id}/decision`, { decision: "approve" }, gmToken)).status, 200);
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieA)).status, 200);
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieB)).status, 200);
  assert.equal((await post(`/api/admin/rooms/${roomId}/participants/${list[0].id}/decision`, { decision: "revoke" }, gmToken)).status, 200);
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieA)).status, 403);
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieB)).status, 200);
  const again = await post("/api/join", { roomId, token: inviteToken, displayName: "A" });
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieOf(again))).status, 403);
  assert.equal((await post("/api/share/stop", { roomId }, gmToken)).status, 200);
  assert.equal((await get(`/api/rooms/${roomId}/handout`, cookieB)).status, 404);
});
