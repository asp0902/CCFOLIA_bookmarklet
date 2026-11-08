const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// When fetching the older messages of another tab fails, the empty tab says why (not just "no messages"), and choosing the tab again tries again.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    let calls = 0; let failing = true;
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      calls += 1;
      if (failing) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
      const doc = { document: { name: 'projects/p/databases/(default)/documents/rooms/test/messages/i1', fields: { channel: { stringValue: 'info' }, text: { stringValue: '재시도 뒤 보이는 메시지' }, name: { stringValue: '눈깅이' }, createdAt: { timestampValue: new Date(Date.now() - 3600000).toISOString() }, type: { stringValue: 'text' } } } };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([doc]) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = reject; }; req.onerror = reject; });
      const now = Date.now(); const entities = {}; const main = [];
      for (let i = 0; i < 2; i += 1) { const id = 'n' + i; entities[id] = { name: '눈깅이', text: '메인 ' + i, channel: 'main', createdAt: { seconds: Math.floor((now - (3 - i) * 1000) / 1000), nanoseconds: 0 } }; main.push(id); }
      const state = { entities: { roomMessages: { entities, ids: main, idsGroupBy: { main } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(300);
    const pick = (re) => page.evaluate((src) => { const tab = [...document.querySelectorAll('.ccf-scp-tab')].find((t) => new RegExp(src, 'i').test(t.textContent)); tab.click(); }, re.source);
    const listText = () => page.evaluate(() => document.querySelector('.ccf-scp-list')?.innerText || '');
    await pick(/정보|info/); await page.waitForTimeout(2500);
    let text = await listText();
    assert.match(text, /불러오지 못했습니다: 이전 대화를 읽지 못했습니다 \(403\)/, 'the reason is shown: ' + text);
    failing = false; await pick(/잡담|other/); await page.waitForTimeout(300); await pick(/정보|info/); await page.waitForTimeout(2500);
    text = await listText();
    assert.match(text, /재시도 뒤 보이는 메시지/, 'choosing the tab again tries again: ' + JSON.stringify({ text, calls }));
    console.log('chat panel other tab error PASS', JSON.stringify({ calls }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
