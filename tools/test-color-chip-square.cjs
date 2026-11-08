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
