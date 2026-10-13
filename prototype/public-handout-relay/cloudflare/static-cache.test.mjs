// Page files are revalidated on every load, so a new release is never hidden by an old cached copy.
import assert from "node:assert/strict";
import worker from "./worker.mjs";
const env = { ASSETS: { fetch: async request => new Response(request.url.endsWith(".html") || request.url.endsWith("/") ? "<html></html>" : "console.log(1)", { headers: { "Content-Type": request.url.endsWith(".js") ? "text/javascript" : "text/html", "Cache-Control": "public, max-age=14400" } }) } };
for (const path of ["/participant.js", "/mirror.js", "/style.css", "/index.html"]) {
  const response = await worker.fetch(new Request(`https://relay.test${path}`), env);
  assert.equal(response.headers.get("Cache-Control"), "no-cache", path);
}
console.log("static cache PASS");
