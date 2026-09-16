const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
const start = source.indexOf('  function mountIcon()');
const end = source.indexOf('  function buildToolbarIcon()', start);
let existing = { isConnected: true, remove() { existing = null; } };
let anchor = null;
let inserted = 0;
const context = {
  ICON_MARKER: 'data-ccf-handout-icon', isActive: () => true,
  document: { querySelectorAll: () => existing?.floating === false ? [] : existing ? [existing] : [], querySelector: () => existing },
  findCharacterToolbarButton: () => anchor, findTopAppBar: () => null, findCharPanelH6: () => null,
  buildToolbarIcon: () => ({ isConnected: true, floating: false }),
  console: { info() {} }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
context.mountIcon();
assert.equal(existing, null, 'remove stale floating button without creating another');
anchor = { parentElement: { insertBefore(icon) { inserted++; existing = icon; } } };
context.mountIcon();
context.mountIcon();
assert.equal(inserted, 1, 'mount toolbar button once when its anchor appears');
assert(!source.includes('mountFloatingIcon('));
console.log('PASS: no floating fallback; stale button removed; toolbar mounts once');
