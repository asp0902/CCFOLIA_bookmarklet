// chat-panel 0.5.44: the added panel shows messages in the store's order (the original chat's order), not re-sorted by createdAt seconds:
// A1 A2 B1 A3 B2 where A3's timestamp says it came before B1 (same second / a client clock ahead) stays A1 A2 / B1 / A3 / B2 like the original.
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
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => {
      const t = Math.floor(Date.now() / 1000) - 60;
      const m = (name, text, s) => ({ name, text, channel: 'main', createdAt: { seconds: t + s, nanoseconds: 0 } });
      // store order (as CCFOLIA keeps it): A1 A2 B1 A3 B2; A3's seconds are earlier than B1's
      const entities = { a1: m('덱스터', 'A1', 0), a2: m('덱스터', 'A2', 1), b1: m('에르네스토', 'B1', 10), a3: m('덱스터', 'A3', 9), b2: m('에르네스토', 'B2', 20) };
      const ids = ['a1', 'a2', 'b1', 'a3', 'b2'];
      const state = { entities: { roomMessages: { entities, ids, idsGroupBy: { main: ids } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source }); await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open()); await page.waitForTimeout(500);
    const order = await page.evaluate(() => [...document.querySelectorAll('#ccf-second-chat-panel [data-ccf-msg-id]')].map((r) => r.getAttribute('data-ccf-msg-id')));
    assert.deepEqual(order, ['a1', 'a2', 'b1', 'a3', 'b2'], 'the store order: ' + JSON.stringify(order));
    assert.deepEqual(errors, []);
    console.log('chat panel order PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
