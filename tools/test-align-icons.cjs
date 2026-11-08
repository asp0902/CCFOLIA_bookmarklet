const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// The three text alignment buttons use the Material (MUI) FormatAlignLeft / Center / Right icons (viewBox 24, 18px) in the original toolbar, the extra panel and the play room.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const sync = read('legacy/ccfolia-format-sync.user.js'), panel = read('legacy/ccfolia-chat-panel.user.js'), participant = read('prototype/public-handout-relay/public/participant.js');
const D = {
  left: 'M15 15H3v2h12v-2zm0-8H3v2h12V7zM3 13h18v-2H3v2zm0 8h18v-2H3v2zM3 3v2h18V3H3z',
  center: 'M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z',
  right: 'M3 21h18v-2H3v2zm6-4h12v-2H9v2zm-6-4h18v-2H3v2zm6-4h12V7H9v2zM3 3v2h18V3H3z'
};
for (const [name, d] of Object.entries(D)) {
  assert.equal(sync.split(`<path fill="currentColor" d="${d}"/>`).length - 1, 2, `${name}: toolbar and dialog in format-sync`);
  assert.equal(panel.split(`"${d}"`).length - 1, 1, `${name}: extra panel`);
  assert.equal(participant.split(`"${d}"`).length - 1, 1, `${name}: play room`);
}
assert.equal((sync.match(/<svg viewBox="0 0 24 24" aria-hidden="true">\s*<path fill="currentColor" d="M(?:15 15H3|7 15v2|3 21h18)/g) || []).length, 6);
assert.doesNotMatch(sync, /d="M2 3h12v1H2z/);
assert.match(sync, /\.ccf-inline-toolbar \.ccf-align-toggle svg \{\n\s+width: 18px;\n\s+height: 18px;/);
assert.match(panel, /svgIcon = \(d, box = 16\)/); assert.match(panel, /mkBtn\(svgIcon\(d, 24\)/);
assert.match(participant, /setAttribute\("viewBox", "0 0 24 24"\); svg\.setAttribute\("width", "18"\)/);
console.log('align icons PASS');
