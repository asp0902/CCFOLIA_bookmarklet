// Roll20 / participant relay: whispers to the GM never leave the GM's browser; secret dice are sent without text or result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const start = source.indexOf('  function pick(obj, keys)');
const end = source.indexOf('  function readMessages(channel)');
assert(start >= 0 && end > start, 'helpers not found');
const { toPanelMessage, relayView } = new Function(`${source.slice(start, end)}; return { toPanelMessage, relayView };`)();
const view = (id, msg) => relayView(toPanelMessage(id, { name: 'A', ...msg }), 'main');
assert.equal(view('w', { text: 'psst', to: 'someone' }), null, 'whisper dropped');
assert.equal(view('w2', { text: 'psst', to: ['x'] }), null, 'whisper (list) dropped');
assert.equal(view('p', { text: 'hello', to: '' }).text, 'hello', 'public message kept');
const secret = view('s', { text: '1d100 secret', extend: { roll: { result: '1D100 > 42', secret: true, success: true } } });
assert.equal(secret.text, '시크릿 다이스');
assert.equal(secret.roll, '');
assert.deepEqual(secret.rollInfo, { secret: true });
const pub = view('r', { text: '1d20', extend: { roll: { result: '1D20 > 5', success: true } } });
assert.equal(pub.rollInfo.success, true);
assert.equal(pub.roll, '1D20 > 5');
// the GM's own panel still sees everything
assert.equal(toPanelMessage('w', { text: 'psst', to: 'someone' }).text, 'psst');
console.log('chat-panel relay privacy PASS');
