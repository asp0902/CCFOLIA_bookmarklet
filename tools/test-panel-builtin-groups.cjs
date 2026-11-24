// chat-panel 0.5.66 / format-sync 0.1.158 / roll20 bridge: the extra panel's built-in rows (drawn without CCFOLIA's row template, e.g. while the original chat is closed)
// carry the group mark like the template rows, so no divider is drawn inside a same-speaker group; a cut-in picture in a row is never taken for an avatar
// (that hid the whole body of a narration row and folded it to 1px). Checked on the real test room page: 0 lines inside groups, 0 folded rows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const panel = read('legacy/ccfolia-chat-panel.user.js');
assert.match(panel, /row\.className = "ccf-scp-row" \+ \(isCont \? " is-cont" : ""\);\r?\n\s*if \(isCont\) row\.setAttribute\("data-ccf-prose-cont", "1"\);/, 'built-in grouped rows carry the group mark');
assert.match(read('legacy/ccfolia-format-sync.user.js'), /if \(messageEl\.contains\(node\) \|\| node\.closest\("\.ccf-cutin-chat-image"\)\) return;/, 'format-sync: a cut-in picture is not an avatar');
assert.match(read('legacy/ccfolia-roll20-css-bridge.user.js'), /messageEl\.contains\(node\) \|\| node\.closest\("\.ccf-cutin-chat-image"\)\) return;/, 'roll20 bridge: a cut-in picture is not an avatar');
console.log('panel built-in groups PASS');
