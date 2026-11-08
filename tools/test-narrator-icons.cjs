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
const markupLine = source.split('\n').find((l) => l.includes('buildNarratorIconMarkup(name, isOrphan)}<span class=')) || '';
const posIcon = markupLine.indexOf('buildNarratorIconMarkup(name, isOrphan)}'), posName = markupLine.indexOf('ccf-narrator-name'), posCheck = markupLine.indexOf('ccf-narrator-check'), posTag = markupLine.indexOf('${suffix}');
assert.ok(posIcon > 0 && posIcon < posName && posName < posCheck && posCheck < posTag, 'icon first (no empty check column), the check mark after the name and before the tag');
assert.equal(markupLine.indexOf('ccf-narrator-check'), markupLine.lastIndexOf('ccf-narrator-check'), 'one check span, after the name');
assert.match(source, /ccfSelectableIconByName\.set\(raw, icon\)/);
assert.match(source, /html\[data-ccf-theme-active="1"\] \.ccf-inline-toolbar \.ccf-narrator-item \.ccf-narrator-icon/);
// the polish of the narrator window: title +1px, padding +1px, the close button has no background (only on hover)
assert.match(source, /\.ccf-inline-popover\.ccf-inline-narrator-popover \{\n\s+padding: 11px;/);
assert.match(source, /\.ccf-inline-narrator-popover \.ccf-inline-popover-title \{\n\s+font-size: 13px;/);
assert.match(source, /\.ccf-inline-narrator-popover \[data-inline-popover-action="cancel"\] \{\n\s+background: transparent;/);
assert.match(source, /html\[data-ccf-theme-active="1"\] \.ccf-inline-toolbar \.ccf-inline-narrator-popover \[data-inline-popover-action="cancel"\] \{\n\s+background: transparent;/);
assert.doesNotMatch(source, /class="ccf-narrator-check" aria-hidden="true">\$\{isActive \? "✓" : ""\}<\/span>\$\{buildNarratorIconMarkup/);
console.log('narrator icons PASS');
