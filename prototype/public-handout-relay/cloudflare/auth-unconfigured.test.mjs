import assert from "node:assert/strict";
import http from "node:http";

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
// The refusal must be readable by the page: without the CORS header the browser reports a bare "Failed to fetch" instead of "GM 인증 실패".
// (Node's fetch drops the Origin header, so this one goes through node:http.)
const withOrigin = (origin) => new Promise((resolve, reject) => {
  const url = new URL(base + "/api/connect");
  const req = http.request(url, { method: "POST", headers: { Origin: origin, Authorization: "Bearer wrong", "Content-Type": "application/json" } }, res => { res.resume(); res.on("end", () => resolve(res)); });
  req.on("error", reject); req.end(JSON.stringify({ roomId: "x" }));
});
for (const origin of ["https://ccfolia.com", "chrome-extension://abcdefghijklmnop"]) {
  const response = await withOrigin(origin);
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["access-control-allow-origin"], origin, `401 for ${origin} carries the CORS header`);
}
console.log("relay: GM routes are refused when GM_TOKEN is not configured PASS");
