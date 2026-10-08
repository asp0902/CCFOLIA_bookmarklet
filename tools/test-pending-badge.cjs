// Extension icon badge: the number of waiting join requests from relay-bridge, blue; 0 clears it; an error mark stays; only room tabs may set it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'background.js'), 'utf8');
const badge = {}, color = {}, title = {};
const L = { message: [], click: [] };
const chrome = {
  action: { onClicked: { addListener: fn => L.click.push(fn) }, setBadgeText: async ({ tabId, text }) => { badge[tabId] = text; }, getBadgeText: async ({ tabId }) => badge[tabId] || '',
    setBadgeBackgroundColor: async ({ tabId, color: c }) => { color[tabId] = c; }, setTitle: async ({ tabId, title: t }) => { title[tabId] = t; } },
  runtime: { onMessage: { addListener: fn => L.message.push(fn) } },
  scripting: { executeScript: async () => [] }, tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} }, onCreated: { addListener() {} }, query: async () => [], sendMessage: async () => {} },
  storage: { session: { get: async () => ({}), set: async () => {} } }
};
vm.runInNewContext(source, { chrome, URL, console, Object, Promise, String, Number, JSON, Math, Error, RegExp });
const room = { tab: { id: 5, url: 'https://ccfolia.com/rooms/R1' } };
const send = async (count, sender = room) => { L.message.forEach(fn => fn({ type: 'relay-pending', count }, sender)); await new Promise(r => setTimeout(r, 30)); };
(async () => {
  await send(2);
  assert.deepEqual([badge[5], color[5], title[5]], ['2', '#1976d2', '참가 승인 요청 2건']);
  await send(1000); assert.equal(badge[5], '99', 'capped at 99');
  await send(0); assert.deepEqual([badge[5], title[5]], ['', '웹 공유 설정 (코코포리아에서 사용)'], 'zero clears it');
  badge[5] = '!'; title[5] = '실행 실패';
  await send(3); assert.deepEqual([badge[5], title[5]], ['!', '실행 실패'], 'an error mark has priority');
  await send(0); assert.equal(badge[5], '!', 'and is not cleared by a zero');
  badge[6] = ''; await send(4, { tab: { id: 6, url: 'https://example.com/' } }); assert.equal(badge[6], '', 'only room tabs may set it');
  await send(2, {}); assert.equal(badge[6], '', 'no tab, no badge');
  // opening the settings keeps the number (it only clears an error mark)
  badge[5] = '2'; await L.click[0]({ id: 5, url: 'https://ccfolia.com/rooms/R1' }); assert.equal(badge[5], '2', 'the number survives opening the settings');
  badge[5] = '!'; await L.click[0]({ id: 5, url: 'https://ccfolia.com/rooms/R1' }); assert.equal(badge[5], '', 'an error mark is cleared by opening the settings');
  console.log('pending badge PASS');
})().catch(error => { console.error(error); process.exit(1); });
