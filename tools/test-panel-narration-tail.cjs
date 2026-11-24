// chat-panel 0.5.72: the panel no longer forces the regular row padding (8px) inline on every row; it goes through a CSS variable and a rule
// that leaves narration rows to the format CSS (group edges 16px, inside 6px). The last row of a narration group gets 16px below, like the original
// (measured on the real test room: was 8.7px under the last narration line vs 16px in the original; now 16.7).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const panel = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
assert.doesNotMatch(panel, /row\.style\.setProperty\("padding-bottom"/, 'no inline row padding');
assert.match(panel, /\.MuiListItem-root\[data-ccf-msg-id\]:not\(\[data-ccf-prose-cont-leader="1"\]\):not\(:has\(\.ccf-render-root\[data-ccf-narration="1"\]\)\) \{ padding-bottom: var\(--scp-row-pad-b, 8px\) !important; \}/);
assert.match(panel, /\.MuiListItem-root\[data-ccf-msg-id\]\[data-ccf-prose-cont="1"\]:not\(:has\(\+ \[data-ccf-prose-cont="1"\]\)\):has\(\.ccf-render-root\[data-ccf-narration="1"\]\) \{ padding-bottom: 16px !important; \}/);
assert.equal((panel.match(/setProperty\("--scp-row-pad-b"/g) || []).length, 2, 'the variable is set where the inline padding was');
console.log('panel narration tail PASS');
