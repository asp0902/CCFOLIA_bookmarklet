import assert from "node:assert/strict";

// Run against `wrangler dev --port 8791` started WITHOUT --var GM_TOKEN (RELAY_BASE_URL overrides): a Worker without a GM token must
// refuse every GM route instead of treating an empty bearer as valid.
const base = process.env.RELAY_BASE_URL || "http://127.0.0.1:8791";
const call = (path, init = {}) => fetch(base + path, { headers: { "Content-Type": "application/json", ...init.headers }, ...init });
for (const [path, init] of [
  ["/api/connect", { method: "POST", body: JSON.stringify({ roomId: "x" }) }],
  ["/api/share/stop", { method: "POST", body: JSON.stringify({ roomId: "x" }) }],
  ["/api/admin/rooms/x/participants", {}],
  ["/api/admin/rooms/x/participants", { headers: { Authorization: "Bearer " } }],
  ["/api/admin/rooms/x/participants", { headers: { Authorization: "Bearer anything" } }],
]) {
  const response = await call(path, init);
  assert.equal(response.status, 401, `${path} must be refused without a configured GM token (got ${response.status})`);
}
console.log("relay: GM routes are refused when GM_TOKEN is not configured PASS");
