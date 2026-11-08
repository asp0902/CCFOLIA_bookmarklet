const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The narrator character list shows a round icon left of each name: the picture the character selection list had, the first letter without a picture, an empty circle for an orphan entry.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  function buildNarratorIconMarkup('), b = source.indexOf('  function buildInlineNarratorListMarkup(', a);
const e1 = source.indexOf('  function escapeHtml('), e2 = source.indexOf('  function getInlineNarratorPopoverState(', e1);
assert(a >= 0 && b > a && e1 >= 0 && e2 > e1);
const ctx = vm.createContext({ Array, String, Map });
vm.runInContext(`const ccfSelectableIconByName = new Map([["눈깅이", "https://example.com/a.png?x=1&y=2"]]);\n${source.slice(a, b)}\n${source.slice(e1, e2)}\nthis.api = { buildNarratorIconMarkup, map: ccfSelectableIconByName };`, ctx);
const { buildNarratorIconMarkup: icon } = ctx.api;
assert.match(icon('눈깅이', false), /<img src="https:\/\/example\.com\/a\.png\?x=1&amp;y=2"/);
assert.match(icon('카피바라', false), />카<\/span>$/, 'first letter without a picture');
assert.equal(icon('없는이', true), '<span class="ccf-narrator-icon" aria-hidden="true"></span>', 'orphan: empty circle');
assert.match(icon('<b>x', false), />&lt;<\/span>$/, 'escaped');
// the list markup puts the icon between the check mark and the name; the icons are read from the selection list; the theme has its own style
assert.match(source, /ccf-narrator-check" aria-hidden="true">\$\{isActive \? "✓" : ""\}<\/span>\$\{buildNarratorIconMarkup\(name, isOrphan\)\}<span class="ccf-narrator-name">/);
assert.match(source, /ccfSelectableIconByName\.set\(raw, icon\)/);
assert.match(source, /html\[data-ccf-theme-active="1"\] \.ccf-inline-toolbar \.ccf-narrator-item \.ccf-narrator-icon/);
console.log('narrator icons PASS');
