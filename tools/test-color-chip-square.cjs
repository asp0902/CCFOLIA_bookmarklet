const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// The text color / background color chips of the format row are the same fixed square in both panels: a 30x30 button that does not shrink, a 16x16 chip centered by ::before, the color input a transparent cover.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const panel = read('legacy/ccfolia-chat-panel.user.js'), sync = read('legacy/ccfolia-format-sync.user.js');
const rule = (text, selector) => { const i = text.indexOf(selector + ' {'); assert(i >= 0, selector); return text.slice(i, text.indexOf('}', i + selector.length)); };
const pb = rule(panel, '#${PANEL_ID} .ccf-scp-fmt-color'), pc = rule(panel, '#${PANEL_ID} .ccf-scp-fmt-color::before'), pi = rule(panel, '#${PANEL_ID} .ccf-scp-fmt-color input');
const sb = rule(sync, '.ccf-inline-toolbar .ccf-color-tool'), sc = rule(sync, '.ccf-color-tool::before');
assert.match(pb, /width: 30px; height: 30px/); assert.match(pb, /flex: 0 0 30px/); assert.match(pc, /width: 16px; height: 16px/); assert.match(pi, /opacity: 0/);
assert.match(sb, /flex: 0 0 30px/); assert.match(sb, /aspect-ratio: 1 \/ 1/); assert.match(sc, /width: 16px/); assert.match(sc, /height: 16px/);
assert.match(panel, /--ccf-chip-color/);
console.log('color chip square PASS');
// the chip has the same visible border on both colors, the size box and the keep button have the same width, the format buttons have no outline and no gap
assert.match(pc, /box-shadow: inset 0 0 0 1px #808080/); assert.match(sc, /box-shadow: inset 0 0 0 1px #808080/);
assert.match(pc, /box-sizing: border-box/); assert.match(sc, /box-sizing: border-box/);
assert.match(rule(panel, '#${PANEL_ID} .ccf-scp-fmt-size'), /width: 44px/); assert.match(rule(panel, '#${PANEL_ID} .ccf-scp-fmt-keep'), /width: 44px/);
const sk = rule(sync, '.ccf-inline-toolbar .ccf-inline-size-input,\n      .ccf-inline-toolbar .ccf-keep-toggle'); assert.match(sk, /width: 44px/);
assert.match(rule(panel, '#${PANEL_ID} .ccf-scp-fmt'), /gap: 0/); assert.match(rule(panel, '#${PANEL_ID} .ccf-scp-fmt-btn'), /border: 0/);
assert.match(rule(sync, '.ccf-inline-toolbar'), /column-gap: 0/); assert.match(sync, /border-width: 0 !important/);
console.log('format row follow-up PASS');
// third round: the bar is #282828 with only a top line, no divider between the buttons, the size box shows the current font size like the original
assert.match(rule(panel, '#${PANEL_ID} .ccf-scp-fmt'), /background: #282828/);
assert.match(panel, /border-top: 1px solid rgba\(255,255,255,\.12\); border-bottom: 0/);
assert.match(sync, /\.ccf-inline-toolbar \.ccf-inline-divider \{ display: none !important; \}/);
assert.match(sync, /border-width: 1px 0 0 0 !important/); assert.match(sync, /background: #282828;\n        color: #fff;\n        box-shadow: none;/);
assert.match(panel, /sizeInput\.placeholder = !fmtState\.size && current > 0 \? String\(current\) : "크기"/);
assert.doesNotMatch(panel, /ccf-scp-fmt-color\.is-set \{ background/);
console.log('format row third round PASS');
// fourth round: B/I/U/S show their glyph styles, the divider is hidden in the base rule too, a vertical line sits on the panel edge, the size box is refilled after the panel is attached
assert.match(panel, /\{ B: "b", I: "i", U: "u", S: "s" \}\[label\]/);
assert.match(sync, /\.ccf-inline-divider \{\n        display: none !important;/);
assert.match(panel, /border-right: 1px solid rgba\(255,255,255,\.12\)/);
assert.match(panel, /\[300, 1200\]\.forEach/);
console.log('format row fourth round PASS');
