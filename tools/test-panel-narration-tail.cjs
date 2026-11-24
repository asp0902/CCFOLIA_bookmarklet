// chat-panel 0.5.74: the panel rows use fixed spacing equal to the original (roll20 bridge 0.3.119), not values sampled from the original rows.
// Every row keeps a 1px slot under it (the original's divider slot). Inside a group: 5px (plain) / 6px (narration). A group end with a row after it: 14 / 16 + the line.
// The last row: 5 / 6, no line, and no list padding (the original keeps only the inner value under its last row).
// Measured on the real test room against the original: within groups 6/7, between groups 29/31, tail 5.8 (plain) / 6.8 (narration), all equal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const panel = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const css = (rule) => assert.ok(panel.includes(rule), rule);
css('#${PANEL_ID} .ccf-scp-list { padding: 0 !important; }');
css('#${PANEL_ID} .MuiListItem-root[data-ccf-msg-id] { padding-bottom: 5px !important; }');
css('#${PANEL_ID} .MuiListItem-root[data-ccf-msg-id]:has(.ccf-render-root[data-ccf-narration="1"]) { padding-bottom: 6px !important; }');
css('#${PANEL_ID} .MuiListItem-root[data-ccf-msg-id][data-ccf-scp-end] { padding-bottom: 14px !important; }');
css('#${PANEL_ID} .MuiListItem-root[data-ccf-msg-id][data-ccf-scp-end]:has(.ccf-render-root[data-ccf-narration="1"]) { padding-bottom: 16px !important; }');
assert.doesNotMatch(panel, /padding-bottom: var\(--scp-row-pad-b/, 'no sampled row padding');
// the markers: every row has the 1px slot, only a group end with a row after it draws the line
const markers = panel.slice(panel.indexOf('  function applyRowMarkers(rows) {'), panel.indexOf('  // 새로고침 직후 코코포리아 저장소는'));
assert.match(markers, /const end = !!next && !nextIsCont;/);
assert.match(markers, /row\.toggleAttribute\("data-ccf-scp-end", end\);/);
assert.match(markers, /row\.style\.setProperty\("border-bottom", "1px solid transparent", "important"\);\n\s*row\.style\.removeProperty\("padding-bottom"\);\n\s*if \(end\) \{/);
console.log('panel narration tail PASS');
