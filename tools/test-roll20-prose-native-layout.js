const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "legacy", "ccfolia-roll20-css-bridge.user.js"), "utf8");
const prose = source.slice(source.indexOf("// ===== Prose Mode"));
const styles = [];
class Element {}
class HTMLElement extends Element {}

vm.runInNewContext(prose, {
  window: {},
  document: {
    head: { appendChild: (style) => styles.push(style) },
    documentElement: {},
    createElement: () => ({ dataset: {}, textContent: "" }),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  },
  console: { info() {} },
  Element,
  HTMLElement,
  Node: { TEXT_NODE: 3 },
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame() {},
  setTimeout: () => 1,
  clearTimeout() {},
  getComputedStyle: () => ({ overflowY: "visible" })
});

const css = styles[0]?.textContent || "";
assert.ok(css.includes('[data-ccf-prose-cont-leader="1"] { padding-bottom: 6px !important; border-bottom: 0 !important; }'));
assert.ok(css.includes('[data-ccf-prose-cont="1"]:not([data-ccf-prose-cont-last="1"]) { border-bottom: 0 !important; }'));
assert.ok(!css.includes("data-ccf-prose-cont-msg"));
assert.ok(!css.includes("data-ccf-prose-cont-speaker-start"));

console.log("roll20 prose native-layout checks passed");
