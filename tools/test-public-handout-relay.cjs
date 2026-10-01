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
assert.match(bridge, /command\.type !== "chat\.send"/);
assert.match(bridge, /relayDeliveredCommandIds/);
console.log("public handout relay boundary: PASS");
