const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../legacy/ccfolia-log-package.user.js"), "utf8");
const sandbox = { console, INVIS_START: "<payload>", INVIS_END: "</payload>", decodeInvisibleToJson: value => value };
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
vm.runInNewContext(extract("  function extractEnvelope(", "  function decodeInvisibleToJson("), sandbox);
const wrap = (text, visible, prefix = false) => {
  const payload = `<payload>${JSON.stringify({ text })}</payload>`;
  return prefix ? payload + visible : visible + payload;
};
for (const prefix of [false, true]) {
  assert.equal(sandbox.extractEnvelope(wrap("Message @label", "Message", prefix)).envelope.text, "Message");
  assert.equal(sandbox.extractEnvelope(wrap("Message @label", "Message @label", prefix)).envelope.text, "Message @label");
  assert.equal(sandbox.extractEnvelope(wrap("mail@example.com", "mail@example.com", prefix)).envelope.text, "mail@example.com");
  assert.equal(sandbox.extractEnvelope(wrap("Message @label", "Different", prefix)).envelope.text, "Message @label");
  assert.equal(sandbox.extractEnvelope(wrap("Message", "Message", prefix)).visibleText, "Message");
}
vm.runInNewContext(extract("  function cleanupStyle(", "  function findLogMessageElements("), sandbox);
const style = sandbox.cleanupStyle({ bold: true, italic: true, extraCss: { fontStyle: "normal" }, borderRadius: "99px", padding: "8px 28px" });
assert.equal(style.borderRadius, "99px");
assert.equal(style.fontStyle, "normal");
const element = { style: {} };
sandbox.applyInlineStyle(element, style);
assert.equal(element.style.borderRadius, "99px");
assert.equal(element.style.fontStyle, "normal");
vm.runInNewContext(extract("  function applyTistoryInlineStyle(", "  function cloneStyleWithoutKeys("), sandbox);
sandbox.applyTistoryInlineStyle(element, style, new Map());
assert.equal(element.style.borderRadius, "99px");
assert.equal(element.style.fontStyle, "normal");
console.log("Macro style and standing suffix tests passed");
