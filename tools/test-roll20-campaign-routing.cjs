// Background routing of Roll20 lines: the campaign number is remembered from the tab's campaign page address (details -> editor), inherited by a tab opened from it, and dropped with the tab.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'background.js'), 'utf8');
const session = {}, local = { r20Links: { 22089717: { roomId: 'R1', channel: 'main', direction: 'in' } } };
const sent = [];
const L = { message: [], updated: [], created: [], removed: [] };
const store = bag => ({ get: async keys => Object.fromEntries(keys.map(k => [k, bag[k]])), set: async obj => Object.assign(bag, obj) });
const chrome = {
  action: { onClicked: { addListener() {} } },
  runtime: { onMessage: { addListener: fn => L.message.push(fn) } },
  tabs: { query: async ({ url }) => url.includes('/rooms/R1') ? [{ id: 100 }] : [], sendMessage: async (tabId, payload) => { sent.push({ tabId, payload }); },
    onUpdated: { addListener: fn => L.updated.push(fn) }, onCreated: { addListener: fn => L.created.push(fn) }, onRemoved: { addListener: fn => L.removed.push(fn) } },
  storage: { session: store(session), local: store(local) }
};
vm.runInNewContext(source, { chrome, URL, console, Object, Promise, String, Number, JSON, RegExp });
const wait = () => new Promise(r => setTimeout(r, 30));
const r20 = id => ({ tab: { id, url: 'https://app.roll20.net/editor/?viewas=' } });
const line = { id: 'm1', name: 'A', text: 'hi', kind: 'general', source: 'roll20' };
const say = async tabId => { sent.length = 0; L.message.forEach(fn => fn({ type: 'r20-message', message: { ...line } }, r20(tabId))); await wait(); return sent.slice(); };
(async () => {
  // a tab that never visited a campaign page: dropped
  assert.equal((await say(7)).length, 0, 'no number -> nothing is forwarded');
  // campaign page, then the game: forwarded to the linked room tab
  L.updated.forEach(fn => fn(7, { url: 'https://app.roll20.net/campaigns/details/22089717/my-game' })); await wait();
  L.updated.forEach(fn => fn(7, { url: 'https://app.roll20.net/editor/?viewas=' })); await wait(); // later urls without a number do not erase it
  let out = await say(7);
  assert.equal(out.length, 1); assert.equal(out[0].tabId, 100); assert.equal(out[0].payload.message.text, 'hi'); assert.equal(out[0].payload.message.channel, 'main');
  // a number nobody linked to a room: dropped
  L.updated.forEach(fn => fn(9, { url: 'https://app.roll20.net/campaigns/details/555/other' })); await wait();
  assert.equal((await say(9)).length, 0, 'unlinked campaign is dropped');
  // a new tab opened from tab 7 inherits the number
  L.created.forEach(fn => fn({ id: 11, openerTabId: 7 })); await wait();
  assert.equal((await say(11)).length, 1, 'opener inheritance');
  // setcampaign address also counts
  L.updated.forEach(fn => fn(12, { url: 'https://app.roll20.net/editor/setcampaign/22089717' })); await wait();
  assert.equal((await say(12)).length, 1, 'setcampaign address');
  // closing a tab forgets it
  L.removed.forEach(fn => fn(7)); await wait();
  assert.equal((await say(7)).length, 0, 'closed tab forgotten');
  assert.equal(JSON.stringify(Object.keys(session.r20TabCampaign).sort()), JSON.stringify(['11', '12', '9']));
  console.log('roll20 campaign routing PASS');
})().catch(error => { console.error(error); process.exit(1); });
