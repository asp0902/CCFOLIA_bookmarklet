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
for (const value of [undefined, "transparent", "invalid", "black", "white"]) {
  const expected = value === "black" || value === "white" ? value : "transparent";
  assert(sandbox.buildRenderedMessageHtml({ roll20Macro: true, roll20Background: value }).includes(`data-ccr20-macro-background="${expected}"`));
}
const bridge = fs.readFileSync(path.join(root, "legacy", "ccfolia-roll20-css-bridge.user.js"), "utf8");
const backgroundStart = bridge.indexOf("  function normalizeMacroBackground(");
const backgroundEnd = bridge.indexOf("\n\n  function injectStyles(", backgroundStart);
const backgroundSandbox = {};
vm.runInNewContext(bridge.slice(backgroundStart, backgroundEnd), backgroundSandbox);
assert.strictEqual(backgroundSandbox.normalizeMacroBackground(undefined), "transparent");
assert.strictEqual(backgroundSandbox.normalizeMacroBackground("black"), "black");
assert.strictEqual(backgroundSandbox.normalizeMacroBackground("white"), "white");
assert.match(bridge, /let macroBackground = "transparent"/);
assert.match(bridge, /option value="transparent"/);
assert.match(editor, /\.ccf-render-root\.ccf-roll20-bubble\[data-ccr20-macro-background="black"\]/);
assert.match(editor, /overflow-wrap: anywhere/);
assert.match(editor, /\.ccf-tistory-roll20 \{/);
assert.match(editor, /\.ccf-tistory-log \.ccf-render-root\.ccf-roll20-bubble\[data-ccr20-macro-background="black"\]/);

const tistoryStart = editor.indexOf("  function buildEditorTistoryHtml(");
const tistoryEnd = editor.indexOf("\n\n  function exportEditorHtml(", tistoryStart);
assert(tistoryStart >= 0 && tistoryEnd > tistoryStart, "buildEditorTistoryHtml not found");
const tistorySandbox = {
  state: { mergeSameSpeaker: false, systemSpeaker: "" },
  buildTistoryAssetMaps: () => ({ byRenderUrl: new Map() }),
  getSelectedTabEntries: () => [{
    sender: "speaker",
    bodyHtml: '<div class="ccf-render-root ccf-roll20-bubble" data-ccr20-macro-background="black">message</div>'
  }],
  rewriteEntryHtml: (html) => html,
  resolveAvatarUrl: () => "avatar.png",
  normalizeCssColorForHtml: (color) => color,
  formatEntryTimestamp: () => "2026. 09. 14. 17:30:00",
  escapeHtml: (value) => String(value),
  escapeAttr: (value) => String(value)
};
vm.runInNewContext(editor.slice(tistoryStart, tistoryEnd), tistorySandbox);
const tistoryHtml = tistorySandbox.buildEditorTistoryHtml({ payload: { assets: [] } });
assert.match(tistoryHtml, /class="ccf-tistory-text ccf-tistory-roll20"/);
assert.match(tistoryHtml, /grid-template-columns: 48px minmax\(0, 1fr\)/);
assert.match(tistoryHtml, /background: #000 !important/);
assert.match(tistoryHtml, /border-radius: 0/);
for (const html of [editor, tistoryHtml]) {
  assert.match(html, /\.ccf-roll20-bubble > \.ccf-line:first-child \.ccf-image,/);
  assert.match(html, /\.ccf-roll20-bubble > \.ccf-line:last-child \.ccf-image \{\s*width: 100%;\s*max-width: 100%;/);
  assert.match(html, /\.ccf-roll20-bubble \.ccf-image \{ max-width: min\(100%, 360px\); \}/);
}
assert.match(tistoryHtml, /ccf-tistory-timestamp/);
assert.match(tistoryHtml, /2026\. 09\. 14\. 17:30:00/);

const avatarStart = editor.indexOf("  function resolveAvatarUrl(");
const avatarEnd = editor.indexOf("\n\n  function buildTistoryAssetMaps(", avatarStart);
const avatarSandbox = { DEFAULT_AVATAR_URL: "data:image/png;base64,test" };
vm.runInNewContext(editor.slice(avatarStart, avatarEnd), avatarSandbox);
assert.strictEqual(avatarSandbox.resolveAvatarUrl({}, { bySource: new Map() }), avatarSandbox.DEFAULT_AVATAR_URL);
assert.strictEqual(avatarSandbox.resolveAvatarUrl({ avatarSource: "https://example.com/avatar.png" }, { bySource: new Map() }), "https://example.com/avatar.png");
const timeStart = editor.indexOf("  function formatEntryTimestamp(");
const timeEnd = editor.indexOf("\n\n  function showEmpty(", timeStart);
const timeSandbox = {};
vm.runInNewContext(editor.slice(timeStart, timeEnd), timeSandbox);
assert.match(timeSandbox.formatEntryTimestamp("2026-09-14T08:30:00Z"), /2026/);
assert.strictEqual(timeSandbox.formatEntryTimestamp(""), "");

const marker = "  const CAPYBARA_LOG_EDITOR_HTML = ";
const edgeImages = [{ style: {} }, { style: {} }];
const rewriteStart = editor.indexOf("  function rewriteEntryHtml(");
const rewriteEnd = editor.indexOf("\n\n  function resolveAvatarUrl(", rewriteStart);
const rewriteSandbox = { document: { createElement: () => ({ content: {
  querySelectorAll: selector => selector.includes(".ccf-line:first-child") ? edgeImages : []
} }) } };
vm.runInNewContext(editor.slice(rewriteStart, rewriteEnd), rewriteSandbox);
rewriteSandbox.rewriteEntryHtml("macro", new Map());
for (const img of edgeImages) {
  assert.strictEqual(img.style.width, "100%");
  assert.strictEqual(img.style.maxWidth, "100%");
  assert.strictEqual(img.style.height, "auto");
}
const allTabs = { addEventListener(_event, callback) { this.change = callback; } };
const tabInputs = ["main", "info"].map(value => ({ value, checked: true, addEventListener(_event, callback) { this.change = callback; } }));
const tabState = { selectedTabIds: new Set(["main", "info"]) };
let renders = 0;
const tabsStart = editor.indexOf('    const allTabsCheckbox = document.getElementById("output-tabs-all");');
const tabsEnd = editor.indexOf('    const systemSpeakerSelect =', tabsStart);
assert(tabsStart >= 0 && tabsEnd > tabsStart);
vm.runInNewContext(editor.slice(tabsStart, tabsEnd), {
  document: { getElementById: () => allTabs },
  els: { main: { querySelectorAll: selector => selector.endsWith(":checked") ? tabInputs.filter(input => input.checked) : tabInputs } },
  state: tabState, tabIds: ["main", "info"], room: {}, assetMaps: {},
  renderSelectedTabEntries: () => { renders += 1; }
});
assert.strictEqual(allTabs.checked, true);
allTabs.checked = false;
allTabs.change();
assert.strictEqual(tabState.selectedTabIds.size, 0);
assert(tabInputs.every(input => !input.checked));
tabInputs[0].checked = true;
tabInputs[0].change();
assert.strictEqual(allTabs.indeterminate, true);
assert.strictEqual(allTabs.checked, false);
allTabs.checked = true;
allTabs.change();
assert.strictEqual(tabState.selectedTabIds.size, 2);
assert(tabInputs.every(input => input.checked));
assert.strictEqual(allTabs.indeterminate, false);
assert.strictEqual(renders, 3);
const embeddedStart = source.indexOf(marker);
const embeddedEnd = source.lastIndexOf("\n})();");
assert(embeddedStart >= 0 && embeddedEnd > embeddedStart, "embedded editor not found");
const embedded = vm.runInNewContext(source.slice(embeddedStart + marker.length, embeddedEnd - 1));
assert.strictEqual(embedded, editor, "embedded editor is stale");

console.log("log package render tests passed");
