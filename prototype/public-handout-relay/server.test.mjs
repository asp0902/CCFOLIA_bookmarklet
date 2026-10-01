import assert from "node:assert/strict";
import test from "node:test";
import { createRelay } from "./server.mjs";

const cookieOf = response => response.headers.get("set-cookie").split(";")[0];
const eventReader = response => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return async expected => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`SSE ${expected} timeout`)), 2_000))
      ]);
      if (done) throw new Error(`SSE ended before ${expected}`);
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop();
      for (const block of blocks) {
        const event = /^event: (.+)$/m.exec(block)?.[1];
        if (event === expected) return JSON.parse(/^data: (.+)$/m.exec(block)?.[1] || "{}");
      }
    }
    throw new Error(`SSE ${expected} timeout`);
  };
};

test("GM approval separates participant sessions and revocation", async t => {
  const gmToken = "test-gm-token";
  const { server } = createRelay({ gmToken, publicOrigin: "http://127.0.0.1" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, auth = "", cookie = "") => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path, cookie = "", auth = "") => fetch(base + path, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } });
  const decide = (participantId, decision) => post(`/api/admin/rooms/r1/participants/${participantId}/decision`, { decision }, gmToken);

  const preflight = await fetch(base + "/api/share", { method: "OPTIONS", headers: { Origin: "https://ccfolia.com" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://ccfolia.com");
  assert.equal((await fetch(base + "/api/share", { method: "OPTIONS", headers: { Origin: "https://example.org" } })).status, 403);
  assert.equal((await post("/api/share", { roomId: "r1", handout: { id: "h1" } })).status, 401);
  assert.equal((await post("/api/share", { roomId: "r1", handout: { id: "h1", title: "공개", bodyText: "내용", gmNotes: "비밀" } }, gmToken)).status, 400);

  const shared = await post("/api/share", { roomId: "r1", handout: { id: "h1", title: "공개", bodyText: "내용" } }, gmToken);
  const invite = new URL((await shared.json()).inviteUrl);
  const inviteToken = new URLSearchParams(invite.hash.slice(1)).get("token");
  assert.ok(inviteToken);
  assert.equal((await post("/api/join", { roomId: "r1", token: "wrong", displayName: "X" })).status, 403);

  const joinedA = await post("/api/join", { roomId: "r1", token: inviteToken, displayName: "참가자 A" });
  const joinedB = await post("/api/join", { roomId: "r1", token: inviteToken, displayName: "참가자 B" });
  assert.equal(joinedA.status, 202); assert.equal(joinedB.status, 202);
  const cookieA = cookieOf(joinedA); const cookieB = cookieOf(joinedB);
  assert.notEqual(cookieA, cookieB);
  assert.equal((await get("/api/rooms/r1/handout", cookieA)).status, 403);
  assert.deepEqual(await (await get("/api/rooms/r1/status", cookieA)).json(), { status: "pending", displayName: "참가자 A" });
  assert.equal((await get("/api/rooms/r1/handout", cookieA, gmToken)).status, 403);
  assert.equal((await get("/api/admin/rooms/r1/participants", cookieA)).status, 401);

  const admin = await get("/api/admin/rooms/r1/participants", "", gmToken);
  const list = (await admin.json()).participants;
  assert.deepEqual(list.map(({ displayName, status }) => ({ displayName, status })), [{ displayName: "참가자 A", status: "pending" }, { displayName: "참가자 B", status: "pending" }]);
  const idA = list[0].id; const idB = list[1].id;
  assert.equal((await decide(idA, "approve")).status, 200);
  assert.equal((await decide(idB, "approve")).status, 200);

  const currentA = await get("/api/rooms/r1/handout", cookieA);
  const currentBody = await currentA.json();
  assert.deepEqual({ ...currentBody, updatedAt: "" }, { id: "h1", title: "공개", bodyText: "내용", updatedAt: "" });
  const streamA = eventReader(await get("/api/rooms/r1/events", cookieA));
  const streamB = eventReader(await get("/api/rooms/r1/events", cookieB));
  assert.equal((await streamA("handout")).title, "공개");
  assert.equal((await streamB("handout")).title, "공개");

  const updated = await post("/api/share", { roomId: "r1", handout: { id: "h1", title: "갱신", bodyText: "새 내용" } }, gmToken);
  assert.equal(new URLSearchParams(new URL((await updated.json()).inviteUrl).hash.slice(1)).get("token"), inviteToken);
  assert.equal((await streamA("handout")).title, "갱신");
  assert.equal((await streamB("handout")).bodyText, "새 내용");

  assert.equal((await decide(idA, "revoke")).status, 200);
  await streamA("revoked");
  assert.equal((await get("/api/rooms/r1/handout", cookieA)).status, 403);
  assert.equal((await get("/api/rooms/r1/events", cookieA)).status, 403);
  assert.equal((await get("/api/rooms/r1/handout", cookieB)).status, 200);

  const rejoined = await post("/api/join", { roomId: "r1", token: inviteToken, displayName: "참가자 A" });
  const cookieAgain = cookieOf(rejoined);
  assert.equal((await get("/api/rooms/r1/handout", cookieAgain)).status, 403);
  const updatedList = (await (await get("/api/admin/rooms/r1/participants", "", gmToken)).json()).participants;
  const pendingAgain = updatedList.find(item => item.displayName === "참가자 A" && item.status === "pending");
  assert.ok(pendingAgain);
  assert.equal((await decide(pendingAgain.id, "reject")).status, 200);
  assert.deepEqual(await (await get("/api/rooms/r1/status", cookieAgain)).json(), { status: "rejected", displayName: "참가자 A" });
  assert.equal((await get("/api/rooms/other/handout", cookieB)).status, 403);

  assert.equal((await post("/api/share/stop", { roomId: "r1" }, gmToken)).status, 200);
  await streamB("revoked");
  assert.equal((await get("/api/rooms/r1/handout", cookieB)).status, 403);
  assert.equal((await get("/api/rooms/r1/status", cookieB)).status, 403);
});
