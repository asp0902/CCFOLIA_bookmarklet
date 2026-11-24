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
// 0.3.119 (scroll jitter, option A): a row's shape never depends on the row after it. Only the divider colour may use the marks that do (leader / last).
const nextDependent = css.split("\n").filter((rule) => /prose-cont-(leader|last|wrap-last)/.test(rule));
assert.ok(nextDependent.length >= 1);
for (const rule of nextDependent) assert.match(rule.trim(), /^[^{]*\+ \.MuiDivider-root \{ border-color: transparent !important; background: transparent !important; \}$/, rule);
assert.ok(css.includes('[data-ccf-prose-cont-k="p"].MuiListItem-root.MuiListItem-root.MuiListItem-root { padding-bottom: 5px !important; border-bottom: 0 !important; }'));
assert.ok(css.includes('[data-ccf-prose-cont-k="n"].MuiListItem-root.MuiListItem-root.MuiListItem-root { padding-bottom: 6px !important; border-bottom: 0 !important; }'));
assert.ok(css.includes('[data-ccf-prose-cont-gap="9"]:not(.MuiListItem-root) { padding-top: 9px !important; }') && css.includes('[data-ccf-prose-cont-gap="10"]:not(.MuiListItem-root) { padding-top: 10px !important; }'));
assert.ok(!css.includes("data-ccf-prose-cont-msg"));
assert.ok(!css.includes("data-ccf-prose-cont-speaker-start"));
console.log("roll20 prose native-layout checks passed");
