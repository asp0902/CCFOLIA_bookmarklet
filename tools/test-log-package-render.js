const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "legacy", "ccfolia-log-package.user.js"), "utf8");
const editor = fs.readFileSync(path.join(root, "log editor", "index.html"), "utf8");
const start = source.indexOf("  function buildRenderedMessageHtml(");
const end = source.indexOf("\n\n  function clamp(", start);
assert(start >= 0 && end > start, "buildRenderedMessageHtml not found");

const sandbox = {
  document: {
    createElement() {
      const node = { className: "", dataset: {}, innerHTML: "" };
      node.classList = {
        add(name) {
          node.className += ` ${name}`;
        }
      };
      Object.defineProperty(node, "outerHTML", {
        get() {
          const background = node.dataset.ccr20MacroBackground;
          const attr = background ? ` data-ccr20-macro-background="${background}"` : "";
          return `<div class="${node.className}"${attr}>${node.innerHTML}</div>`;
        }
      });
      return node;
    }
  },
  getEffectiveAlignRuns: () => [],
  renderStyledText: (node) => {
    node.innerHTML = "<span>message</span>";
  }
};
vm.runInNewContext(source.slice(start, end), sandbox);

const plain = sandbox.buildRenderedMessageHtml({});
const macro = sandbox.buildRenderedMessageHtml({ roll20Macro: true, roll20Background: "white" });
assert.strictEqual(plain, "<span>message</span>");
assert.match(macro, /class="ccf-render-root ccf-roll20-bubble"/);
assert.match(macro, /data-ccr20-macro-background="white"/);
assert.match(editor, /\.ccf-render-root\.ccf-roll20-bubble\[data-ccr20-macro-background="black"\]/);
assert.match(editor, /overflow-wrap: anywhere/);

const marker = "  const CAPYBARA_LOG_EDITOR_HTML = ";
const embeddedStart = source.indexOf(marker);
const embeddedEnd = source.lastIndexOf("\n})();");
assert(embeddedStart >= 0 && embeddedEnd > embeddedStart, "embedded editor not found");
const embedded = vm.runInNewContext(source.slice(embeddedStart + marker.length, embeddedEnd - 1));
assert.strictEqual(embedded, editor, "embedded editor is stale");

console.log("log package render tests passed");
