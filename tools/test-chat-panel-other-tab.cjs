const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The real panel script on a page with a fake CCFOLIA store (React container + redux-like store that holds only the main tab), a firebase auth record in IndexedDB and a fake Firestore REST:
// choosing another tab must fetch that tab's older messages and show them (no stub inside the script).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const queries = [];
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      queries.push(route.request().url());
      const doc = (id, channel, text, ms) => ({ document: { name: `projects/p/databases/(default)/documents/rooms/test/messages/${id}`, fields: { channel: { stringValue: channel }, text: { stringValue: text }, name: { stringValue: '눈깅이' }, createdAt: { timestampValue: new Date(ms).toISOString() }, type: { stringValue: 'text' } } } });
      const base = Date.now() - 3600000;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([doc('i1', 'info', '정보 탭 첫 메시지', base), doc('i2', 'info', '정보 탭 둘째 메시지', base + 1000), doc('m0', 'main', '오래된 메인', base - 5000)]) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      // a firebase auth record the panel can read
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('firebaseLocalStorageDb', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true });
        req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = reject; };
        req.onerror = reject;
      });
      // a store like CCFOLIA's: only recent main messages
      const now = Date.now();
      const entities = {}; const main = [];
      for (let i = 0; i < 3; i += 1) { const id = 'n' + i; entities[id] = { name: '눈깅이', text: '메인 ' + i, channel: 'main', createdAt: { seconds: Math.floor((now - (3 - i) * 1000) / 1000), nanoseconds: 0 }, color: '#888' }; main.push(id); }
      const state = { entities: { roomMessages: { entities, ids: main, idsGroupBy: { main } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      const store = { getState: () => state, dispatch() {}, subscribe: () => () => {} };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(500);
    const listText = () => page.evaluate(() => document.querySelector('.ccf-scp-list')?.innerText || '');
    assert.match(await listText(), /메인 0/, 'the main tab shows the store messages');
    // choose the info tab in the panel
    await page.evaluate(() => { const tab = [...document.querySelectorAll('.ccf-scp-tab')].find((t) => /정보|info/i.test(t.textContent)); tab.click(); });
    await page.waitForTimeout(2500);
    const text = await listText();
    assert.match(text, /정보 탭 첫 메시지/, 'the info tab shows its older messages: ' + JSON.stringify({ text, queries: queries.length }));
    assert.ok(queries.length >= 1, 'it asked Firestore');
    // the diagnosis API reports the state
    const diag = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.olderDiag());
    assert.equal(diag.currentChannel, 'info'); assert.ok(diag.olderTotal >= 2 && diag.olderByChannel.info === 2, JSON.stringify(diag)); assert.deepEqual(diag.storeChannels, { main: 3 });
    assert.deepEqual(errors, [], 'no page errors');
    console.log('chat panel other tab PASS', JSON.stringify({ queries: queries.length }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
