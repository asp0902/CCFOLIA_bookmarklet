const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The real panel script, a fake store and a slow fake Firestore (300 ms per request): typing reads the template of the message in the background, so sending does not wait for that read;
// the input is emptied at once and put back when the write fails; with localStorage.ccfScpTiming = "1" the steps are logged.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const log = []; page.on('console', (m) => { if (/ccf-scp-timing/.test(m.text())) log.push(m.text()); });
    const calls = []; let failWrite = false;
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const req = route.request(); const kind = req.method() === 'POST' && /:runQuery/.test(req.url()) ? 'query' : 'write';
      calls.push({ kind, at: Date.now() });
      await new Promise((r) => setTimeout(r, 300));
      if (kind === 'query') return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ document: { name: 'projects/p/databases/(default)/documents/rooms/test/messages/t1', fields: { channel: { stringValue: 'main' }, text: { stringValue: '직전 메시지' }, name: { stringValue: '눈깅이' }, color: { stringValue: '#cce5df' }, from: { stringValue: 'u1' }, type: { stringValue: 'text' }, createdAt: { timestampValue: new Date().toISOString() }, updatedAt: { timestampValue: new Date().toISOString() } } } }]) });
      if (failWrite) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'projects/p/databases/(default)/documents/rooms/test/messages/new1' }) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      localStorage.setItem('ccfScpTiming', '1');
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = reject; }; req.onerror = reject; });
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000) - 5, nanoseconds: 0 } } };
      const state = { entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(400);
    const input = page.locator('.ccf-scp-input');
    await input.click(); await input.fill('안녕하세요');
    await page.waitForTimeout(700); // the template is read while typing
    const queriesBefore = calls.filter((c) => c.kind === 'query').length;
    assert.ok(queriesBefore >= 1, 'the template was read in the background');
    const t0 = Date.now();
    await page.evaluate(() => document.querySelector('.ccf-scp-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await page.waitForTimeout(40);
    assert.equal(await input.inputValue(), '', 'the input is emptied at once');
    await page.waitForTimeout(900);
    const write = calls.find((c) => c.kind === 'write');
    assert.ok(write, 'the message was written');
    assert.equal(calls.filter((c) => c.kind === 'query').length, queriesBefore, 'sending did not read the template again');
    assert.ok(write.at - t0 < 200, 'the write started without waiting for a template read: ' + (write.at - t0) + ' ms');
    await page.waitForTimeout(8500); // the fake store never shows the new message: the log is written at the 8 s timeout
    assert.ok(log.length >= 1 && /auth:\d+ms/.test(log[0]) && /write-response:\d+ms/.test(log[0]), 'timing logged: ' + JSON.stringify(log));
    // a failing write puts the text back
    failWrite = true;
    await input.fill('실패할 메시지'); await page.waitForTimeout(100);
    await page.evaluate(() => document.querySelector('.ccf-scp-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await page.waitForTimeout(1500);
    assert.equal(await input.inputValue(), '실패할 메시지', 'the text comes back when sending fails');
    console.log('chat panel send latency PASS', JSON.stringify({ writeAfterMs: write.at - t0, log: log[0] }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
