const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../legacy/ccfolia-chat-notifier.user.js"), "utf8");
class HTMLInputElement {
  dataset = {};
  value = "0";
  style = { setProperty: (name, value) => { this[name] = value; } };
}
const range = new HTMLInputElement();
const start = source.indexOf("  function updateCcfBgmProgressBar(");
const end = source.indexOf("  function readCcfBgmPlaybackTime(", start);
const sandbox = {
  HTMLInputElement, Date,
  ccfBgmProgressRoot: { querySelector: selector => selector === ".ccf-bgm-progress-input" ? range : null },
  readCcfBgmPlaybackTime: () => ({ total: 100, now: 40 }),
  ccfBgmLoopNudgeAt: 0, ccfBgmLoopNudgeFromTotal: 0, ccfBgmActiveLoop: false
};
vm.runInNewContext(source.slice(start, end), sandbox);
sandbox.updateCcfBgmProgressBar();
assert.equal(range.value, "400");
assert.equal(range["--ccf-bgm-progress"], "40%");
range.dataset.ccfDragging = "1";
range.value = "600";
sandbox.updateCcfBgmProgressBar();
assert.equal(range.value, "600");
assert.match(source, /div:has\(> \[data-ccf-bgm-panel="1"\]\) \{\s*border-top: 0 !important;/);
console.log("BGM progress styling tests passed");
