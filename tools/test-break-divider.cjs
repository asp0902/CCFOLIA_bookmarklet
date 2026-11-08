const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// A divider inside a run of the same speaker: the envelope's blockStyle carries breakBefore, both panels have the toggle, it goes off after one send, the renderers mark the message
// (data-ccf-break) and the row draws the line inside itself (top border) so the row height depends on the message only.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const sync = read('legacy/ccfolia-format-sync.user.js'), panel = read('legacy/ccfolia-chat-panel.user.js'), participant = read('prototype/public-handout-relay/public/participant.js');
// cleanupBlockStyle keeps breakBefore, in both copies of the file
const parts = sync.split('  function cleanupBlockStyle(style) {').slice(1);
assert.equal(parts.length, 2);
for (const part of parts) {
  const body = 'function cleanupBlockStyle(style) {' + part.slice(0, part.indexOf('\n  }\n') + 4);
  const fn = vm.runInNewContext(`(${body.replace(/^function cleanupBlockStyle/, 'function')})`);
  assert.equal(fn({ breakBefore: true }).breakBefore, true); assert.equal(fn({ breakBefore: 'yes' }).breakBefore, undefined);
  assert.equal(fn({ narration: true, breakBefore: true, align: 'center' }).align, 'center');
}
// the original toolbar: the button after Nr, the toggle, the reset after a send
assert.match(sync, /data-inline-command="narration"[^\n]*Nr<\/button>\n\s+<button type="button" class="ccf-toggle" data-inline-command="break"/);
assert.match(sync, /if \(command === "break"\) \{[\s\S]*?breakBefore: true/);
assert.match(sync, /\[data-inline-command="break"\]'\)\.forEach\(\(btn\) => \{ btn\.classList\.remove\("active"\)/);
assert.match(sync, /!blockStyle\.narration && !blockStyle\.breakBefore && sendText === rawText\) return true;/);
// rendering: the marker on the render root and the line drawn inside the row
assert.match(sync, /if \(breakBefore\) el\.setAttribute\("data-ccf-break", "1"\);/);
assert.match(sync, /\.MuiListItem-root:has\(\.ccf-render-root\[data-ccf-break="1"\]\),\s+\.ccf-scp-row:has\(\.ccf-render-root\[data-ccf-break="1"\]\) \{\s+border-top: 1px solid transparent !important;/);
assert.match(sync, /data-ccf-break="1"\]\)::before \{[^}]*left: 16px;[^}]*right: 16px;/);
// the extra panel: toggle, payload, one send only, nothing for a dice command or a relayed message
assert.match(panel, /const breakHere = breakNext && !meta;/);
assert.match(panel, /if \(breakNext\) \{ breakNext = false; breakBtnEl\?\.classList\.remove\("is-active"\); \}/);
assert.match(panel, /\.\.\.\(breakHere \? \{ breakBefore: true \} : \{\}\)/);
assert.match(panel, /!\(!meta && looksLikeDiceCommand\(cleanText\)\) && \(meta \|\| breakHere/);
// the play room
assert.match(participant, /const breakBefore = env\.blockStyle\?\.breakBefore === true;/);
assert.match(participant, /container\.dataset\.ccfBreak = "1"/);
console.log('break divider PASS');
// the line of the toggle sits in the middle of the button: the icon is a block centred in a flex button (original) / a block with auto margins (extra panel)
assert.match(panel, /ccf-scp-fmt-btn svg \{ display: block; margin: auto; \}/);
assert.match(sync, /\[data-inline-command="break"\] \{\n\s+display: inline-flex;\n\s+align-items: center;/);
assert.match(sync, /d="M2 7\.5h12v1H2z"/);
console.log('break icon centred PASS');
