// Relayed sends (participant / Roll20) reuse the room's template: two sends -> one runQuery; the GM panel's own send always reads fresh; a failed relayed send retries once with a fresh template.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  let templateCache = null;');
const b = source.indexOf('  async function sendMessageOnce(');
assert(a >= 0 && b > a, 'cache code not found');
let queries = 0, failNext = 0, sends = [];
const box = { Date, currentChannel: 'main', ctxRoom: 'R1',
  getAuthContext: async () => ({ roomId: box.ctxRoom }), fetchTemplateFields: async () => { queries += 1; return { n: queries }; },
  sendMessageOnce: async (text, channel, speaker, meta) => { if (failNext > 0) { failNext -= 1; throw new Error('boom'); } sends.push(text); return 'ok'; }, Error };
// sendMessageOnce is replaced by a stub that also exercises the template lookup like the real one
box.sendMessageOnce = async (text, channel, speaker, meta) => { const ctx = await box.getAuthContext(); await box.templateFor(ctx, !!(speaker || meta)); if (failNext > 0) { failNext -= 1; throw new Error('boom'); } sends.push(text); return 'ok'; };
vm.runInNewContext(`${source.slice(a, b)}; this.templateFor = templateFor; this.sendMessage = sendMessage;`, box);
(async () => {
  await box.sendMessage('a', 'main', { name: 'x' }, { source: 'roll20' });
  await box.sendMessage('b', 'main', { name: 'x' }, { source: 'roll20' });
  assert.equal(queries, 1, 'two relayed sends read the template once');
  box.ctxRoom = 'R2'; await box.sendMessage('c', 'main', { name: 'x' }, { source: 'roll20' });
  assert.equal(queries, 2, 'another room reads its own');
  await box.sendMessage('d'); await box.sendMessage('e');
  assert.equal(queries, 4, "the GM panel's own sends read the template every time");
  queries = 0; box.ctxRoom = 'R1';
  await box.sendMessage('f', 'main', { name: 'x' }, { source: 'roll20' }); // fills the cache (1 query)
  failNext = 1; await box.sendMessage('g', 'main', { name: 'x' }, { source: 'roll20' });
  assert.equal(sends.at(-1), 'g', 'a failed relayed send is retried once');
  assert.equal(queries, 2, 'with a fresh template after the failure');
  failNext = 2; await assert.rejects(box.sendMessage('h', 'main', { name: 'x' }, { source: 'roll20' }), /boom/, 'a second failure is reported');
  console.log('chat panel template cache PASS');
})().catch(error => { console.error(error); process.exit(1); });
