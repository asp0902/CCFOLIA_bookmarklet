// Log package: when there is no official log (a player's room menu has no "log output"), the chat panel's store reader builds the tab groups.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-log-package.user.js'), 'utf8');
const start = source.indexOf('  async function collectPanelPackageTabGroups()');
const end = source.indexOf('  function collectRuntimePackageTabGroups(');
assert(start >= 0 && end > start, 'collectPanelPackageTabGroups not found');
const calls = [];
const messages = [
  { id: 'm1', name: 'A', text: '안녕', at: 1000, color: '#fff', icon: '', channel: 'main' },
  { id: 'm2', name: 'B', text: '1d6', roll: '(1D6) ＞ 4', at: 2000, color: '', icon: '', channel: 'main' },
  { id: 'm3', name: 'A', text: '정보 글', at: 3000, color: '', icon: '', channel: 'info' }
];
const sandbox = {
  window: { __CCF_SECOND_CHAT_PANEL__: { relayLoadAllMessages: async () => messages, relayChannels: () => [{ id: 'main', label: '메인' }, { id: 'info', label: '정보' }] } },
  createRuntimeTabContext: tab => ({ id: tab.id, key: tab.key, name: tab.name, order: tab.order }),
  buildRuntimeEntryFromMessage: (value, tab, ctx) => { calls.push({ value, tab: tab.name, ctx }); return { id: value.id, sender: value.name, text: value.text, channel: value.channel }; }
};
vm.runInNewContext(`${source.slice(start, end)}; this.run = collectPanelPackageTabGroups;`, sandbox);
(async () => {
  const groups = JSON.parse(JSON.stringify(await sandbox.run()));
  assert.equal(groups.length, 2, 'two tabs');
  assert.deepEqual(groups.map(g => [g.name, g.entries.length]), [['메인', 2], ['정보', 1]]);
  assert.equal(groups.reduce((n, g) => n + g.entries.length, 0), 3, 'three entries');
  assert.deepEqual(groups[0].entries.map(e => e.index), [1, 2]);
  assert.equal(calls[1].value.text, '1d6 (1D6) ＞ 4', 'the dice result is part of the text');
  assert(calls.every(c => c.ctx.inMessageList), 'treated as a message list');
  // without the chat panel (or without messages) nothing is produced, the old paths stay in charge
  sandbox.window.__CCF_SECOND_CHAT_PANEL__ = undefined;
  assert.equal((await sandbox.run()).length, 0);
  sandbox.window.__CCF_SECOND_CHAT_PANEL__ = { relayLoadAllMessages: async () => [] };
  assert.equal((await sandbox.run()).length, 0);
  console.log('log package panel source PASS');
})().catch(error => { console.error(error); process.exit(1); });
