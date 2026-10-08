import assert from "node:assert/strict";
import worker, { newInviteToken, inviteUrl, shortInviteLocation } from "./worker.mjs";

const token = newInviteToken();
assert.match(token, /^[A-Za-z0-9_-]{12}$/, "invite token is 12 base64url characters");
assert.notEqual(token, newInviteToken(), "tokens differ");
const url = inviteUrl("https://relay.example", "ChW_QP77I", token);
assert.equal(url, `https://relay.example/j/ChW_QP77I/${token}`);
assert(url.length < 70, "short enough");

// the short address redirects to the page that reads #room=..&token=..
assert.equal(shortInviteLocation(`/j/ChW_QP77I/${token}`), `/#room=ChW_QP77I&token=${token}`);
assert.equal(shortInviteLocation("/j/ChW_QP77I/" + "x".repeat(43)), `/#room=ChW_QP77I&token=${"x".repeat(43)}`, "old long tokens still work");
for (const bad of ["/j/", "/j/room", "/j/room/tok/en", "/j/ro om/tok", "/j/room/tok%20x", "/j/room/" + "t".repeat(101)]) assert.equal(shortInviteLocation(bad), "/", bad);

// through the real fetch handler: 302 with no-referrer, no lookup
const response = await worker.fetch(new Request(`https://relay.example/j/ChW_QP77I/${token}`), {});
assert.equal(response.status, 302);
assert.equal(response.headers.get("Location"), `/#room=ChW_QP77I&token=${token}`);
assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
assert.equal((await worker.fetch(new Request("https://relay.example/j/bad"), {})).headers.get("Location"), "/");
console.log("short invite link: PASS");
