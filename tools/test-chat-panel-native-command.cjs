// chat-panel 0.5.38: commands typed in an added panel (dice, secret dice, a multi-line /roll-table, a system table) go out through CCFOLIA's own chat box - the panel writes
// to Firestore directly and cannot run BCDice / roll-table, so they came out as plain text. The original box is switched to the panel's tab for the send and put back.
// Plain text still goes the panel's own way (Firestore write).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const TABLE = '/roll-table\n괴담 장면표\n1D3\n1 첫째\n2 둘째\n3 셋째';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const writes = [];
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div><form id="native" style="position:fixed;left:10px;bottom:10px"><input name="name"><textarea name="text"></textarea><button type="submit">전송</button></form></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && /:runQuery/.test(req.url())) return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ document: { name: 'projects/p/databases/(default)/documents/rooms/test/messages/t1', fields: { channel: { stringValue: 'main' }, text: { stringValue: '직전' }, name: { stringValue: '눈깅이' }, color: { stringValue: '#cce5df' }, from: { stringValue: 'u1' }, type: { stringValue: 'text' }, createdAt: { timestampValue: new Date().toISOString() }, updatedAt: { timestampValue: new Date().toISOString() } } } }]) });
      writes.push(JSON.parse(req.postData() || '{}').fields?.text?.stringValue);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'projects/p/databases/(default)/documents/rooms/test/messages/new1' }) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = reject; }; req.onerror = reject; });
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000) - 5, nanoseconds: 0 } }, n1: { name: '눈깅이', text: '잡담', channel: 'other', createdAt: { seconds: Math.floor(Date.now() / 1000) - 4, nanoseconds: 0 } } };
      const state = { app: { state: { roomId: 'test', roomChatTab: 'main', roomChatName: '오리지널 화자', roomChatId: 'c-orig' } }, entities: { roomMessages: { entities, ids: ['n0', 'n1'], idsGroupBy: { main: ['n0'], other: ['n1'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      window.__state = state; window.__nativeSent = [];
      const store = { getState: () => state, dispatch(action) { if (action?.type === 'app/state/seted') state.app = { ...state.app, state: action.payload }; }, subscribe: () => () => {} };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
      // CCFOLIA's form: on submit it sends the box's text with the app state's tab / speaker and empties the box
      document.getElementById('native').addEventListener('submit', (e) => { e.preventDefault(); const ta = e.target.querySelector('textarea'); window.__nativeSent.push({ text: ta.value, tab: state.app.state.roomChatTab, name: state.app.state.roomChatName }); ta.value = ''; });
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(400);
    // the panel on the 잡담 (other) tab
    await page.evaluate(() => { const tabs = [...document.querySelectorAll('.ccf-scp-tab')]; (tabs.find((t) => /잡담|other/i.test(t.textContent)) || tabs[tabs.length - 1])?.click(); });
    await page.waitForTimeout(200);
    const panelTab = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.olderDiag().currentChannel);
    assert.equal(panelTab, 'other', 'the panel is on another tab than the original');
    const send = async (text) => { await page.locator('.ccf-scp-input').first().fill(text); await page.evaluate(() => document.querySelector('.ccf-scp-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))); await page.waitForTimeout(500); };
    for (const cmd of ['1D6', 'S2D6>=5 [소각]', TABLE, 'ST']) {
      const before = await page.evaluate(() => window.__nativeSent.length), w = writes.length;
      await send(cmd);
      const sent = await page.evaluate(() => window.__nativeSent.slice(-1)[0]);
      assert.equal(await page.evaluate(() => window.__nativeSent.length), before + 1, `${cmd}: sent once through the original box`);
      assert.equal(sent.text, cmd, `${cmd}: as it is`);
      assert.equal(writes.length, w, `${cmd}: no direct Firestore write`);
      assert.equal(sent.tab, panelTab, `${cmd}: on the panel's tab`);
      const app = await page.evaluate(() => window.__state.app.state);
      assert.deepEqual([app.roomChatTab, app.roomChatName, app.roomChatId], ['main', '오리지널 화자', 'c-orig'], `${cmd}: the original tab / speaker are put back`);
    }
    // plain text: the panel's own Firestore write
    const w = writes.length;
    await send('그냥 말');
    assert.equal(writes.length, w + 1, 'plain text is written by the panel');
    assert.deepEqual(errors, []);
    console.log('chat panel native command PASS', JSON.stringify({ panelTab }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
