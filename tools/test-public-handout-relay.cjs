const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const handout = fs.readFileSync(path.join(root, "legacy", "ccfolia-handout.user.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "extension", "personal", "relay-bridge.js"), "utf8");

assert.match(handout, /data-action="web-share-handout"/);
assert.match(handout, /canManageHandout\(handout\)/);
assert.match(handout, /bodyText:\s*publicHandoutText/);
assert.doesNotMatch(handout.match(/function requestPublicRelay[\s\S]*?\n  }/)?.[0] || "", /gmNotes|permissions|owner|image/);
assert.match(bridge, /chrome\.storage\.local\.get/);
assert.match(bridge, /Authorization.*Bearer/);
assert.doesNotMatch(bridge.match(/const body = action[\s\S]*?\n        const result/)?.[0] || "", /gmNotes|permissions|owner|image/);
assert.match(bridge, /command\?\.type !== "chat\.send"/);
assert.match(bridge, /relayDeliveredCommandIds/);
// The share/stop buttons and requests exist only when the extension marked the page.
assert.equal((handout.match(/manageable && hasPlayerRelay\(\) \? `<button class="card-icon-btn" data-action="web-(?:share-handout|stop-sharing)"/g) || []).length, 2);
assert.match(handout.match(/function requestPublicRelay[^\n]*\n[^\n]*/)?.[0] || "", /!hasPlayerRelay\(\)/);
assert.match(handout, /const hasPlayerRelay = \(\) => document\.documentElement\.dataset\.capybaraPlayerRelay === "1"/);
{
  const vm = require("node:vm");
  const page = fs.readFileSync(path.join(root, "extension", "personal", "relay-page.js"), "utf8");
  const run = pathname => {
    const documentElement = { dataset: {} };
    const sandbox = { console, URL, Node: { TEXT_NODE: 3 }, setInterval() {}, document: { documentElement, title: "", querySelectorAll: () => [] }, location: { pathname, origin: "https://ccfolia.com" }, addEventListener() {}, postMessage() {} };
    sandbox.window = sandbox; sandbox.window.top = sandbox;
    vm.createContext(sandbox);
    vm.runInContext("window.top = window;", sandbox);
    vm.runInContext(page, sandbox);
    return documentElement.dataset.capybaraPlayerRelay;
  };
  assert.equal(run("/rooms/abc"), "1");
  assert.equal(run("/home"), undefined);
}
console.log("public handout relay boundary: PASS");
