// chat-panel 0.5.42: the space under the last message is there from the first drawing: the last adopted correction (--scp-list-adjust) is saved with the tail and
// used at once after a reload (it started again from 0 and grew only after several equal measurements -> the space came late); a new message keeps it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    const load = async () => {
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(() => {
        const now = Math.floor(Date.now() / 1000);
        const entities = { m1: { name: '앨리스', text: '하나', channel: 'main', createdAt: { seconds: now - 9, nanoseconds: 0 } } };
        const listeners = new Set();
        const state = { entities: { roomMessages: { entities, ids: ['m1'], idsGroupBy: { main: ['m1'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
        window.__add = (id, text) => { state.entities.roomMessages = { ...state.entities.roomMessages, entities: { ...state.entities.roomMessages.entities, [id]: { name: '앨리스', text, channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } } }, ids: [...state.entities.roomMessages.ids, id], idsGroupBy: { main: [...state.entities.roomMessages.idsGroupBy.main, id] } }; listeners.forEach((fn) => fn()); };
        window.__del = (id) => { const ids = state.entities.roomMessages.ids.filter((x) => x !== id); state.entities.roomMessages = { ...state.entities.roomMessages, ids, idsGroupBy: { main: state.entities.roomMessages.idsGroupBy.main.filter((x) => x !== id) } }; listeners.forEach((fn) => fn()); };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } } } } };
      });
      await page.addScriptTag({ content: source }); await page.waitForTimeout(300);
    };
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => localStorage.setItem('ccf-scp-list-tail:v1', JSON.stringify({ tail: 10, toTabs: 20, adjust: 6 })));
    await load();
    for (let i = 3; i < 30; i += 1) await page.evaluate((i) => window.__add('m' + i, '줄 ' + i), i);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    const pad = () => page.evaluate(() => getComputedStyle(document.querySelector('#ccf-second-chat-panel .ccf-scp-list')).paddingBottom);
    assert.equal(await pad(), '16px', 'first drawing: saved tail 10 + saved correction 6');
    await page.evaluate(() => window.__add('new1', '새 메시지'));
    assert.equal(await pad(), '16px', 'a new message keeps it');
    assert.deepEqual(errors, []);
    console.log('chat panel tail saved PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
