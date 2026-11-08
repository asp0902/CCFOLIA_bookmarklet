const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// A YouTube link typed or sent in a chat input (the native textarea[name="text"], the extra room chat panel) is never taken for a BGM address: the BGM URL hooks leave those inputs alone.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  function isCcfChatMessageInput('), b = source.indexOf('  function handleCcfBgmUrlKeydown(', a);
assert(a >= 0 && b > a);
class El { constructor(closestMap = {}, attrs = {}) { this.closestMap = closestMap; this.attrs = attrs; } closest(sel) { return this.closestMap[sel] || null; } getAttribute(n) { return this.attrs[n] ?? null; } }
class HTMLElement extends El {} class HTMLTextAreaElement extends HTMLElement {}
const ctx = vm.createContext({ HTMLElement, HTMLTextAreaElement });
vm.runInContext(`${source.slice(a, b)}\nthis.fn = isCcfChatMessageInput;`, ctx);
const fn = ctx.fn;
assert.equal(fn(new HTMLTextAreaElement({ '.ccf-scp-panel': {} })), true, 'extra panel input');
assert.equal(fn(new HTMLTextAreaElement({}, { name: 'text' })), true, 'native chat textarea');
assert.equal(fn(new HTMLTextAreaElement({ '.MuiDialog-root, [role="dialog"]': {} }, { name: 'text' })), false, 'a dialog textarea can be the BGM address');
assert.equal(fn(new HTMLElement({}, {})), false, 'other input');
// the four BGM URL entry points call the check first
for (const name of ['handleCcfBgmUrlKeydown', 'shouldBlockCcfYoutubeUrlInput', 'getCcfBgmUrlInputContext']) {
  const i = source.indexOf(`  function ${name}(`); assert(i >= 0, name);
  assert.match(source.slice(i, i + 1200), /isCcfChatMessageInput\(/, name);
}
const j = source.indexOf('  function handleCcfBgmUrlSubmit('); assert.match(source.slice(j, j + 900), /isCcfChatMessageInput\(candidate\)/);
console.log('chat url not intercepted PASS');
