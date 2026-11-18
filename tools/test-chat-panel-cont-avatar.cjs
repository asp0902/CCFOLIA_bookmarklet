// chat-panel 0.5.50: the added panel's consecutive rows follow the same setting as the original chat: same name but another standing picture (icon) starts a new group
// (ccf-prose-split-avatar, default on); merging off (ccf-prose-merge=off) groups nothing.
//
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const writes = [];
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && /:runQuery/.test(req.url())) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (req.method() !== 'GET') writes.push(req.postData());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'projects/p/databases/(default)/documents/rooms/test/messages/new1' }) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async (IMG) => {
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'firebase:authUser:A:[DEFAULT]', value: { uid: 'u', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); });
      const t = Math.floor(Date.now() / 1000); const entities = { n0: { name: '눈깅이', iconUrl: 'https://example.test/a.png', text: '하나', channel: 'main', createdAt: { seconds: t - 30, nanoseconds: 0 } }, n1: { name: '눈깅이', iconUrl: 'https://example.test/a.png', text: '둘', channel: 'main', createdAt: { seconds: t - 20, nanoseconds: 0 } }, n2: { name: '눈깅이', iconUrl: 'https://example.test/b.png', text: '셋', channel: 'main', createdAt: { seconds: t - 10, nanoseconds: 0 } } };
      const state = { entities: { roomMessages: { entities, ids: ['n0', 'n1', 'n2'], idsGroupBy: { main: ['n0', 'n1', 'n2'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      // stand-in for format-sync's paste handler: an image file was pasted and uploaded
      let n = 0;
      window.__CCF_FORMAT_SYNC_IMAGE_PASTE__ = { handle: (event, insert) => { event.preventDefault(); n += 1; insert(n === 1 ? IMG : 'ccf-firestore-image://abc' + n, '스크린샷' + n); return true; }, preview: async (url) => (/^ccf-firestore-image:/.test(url) ? IMG : '') }; // 0.5.43: a stored picture's token resolves to a real thumbnail
    }, IMG);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    const cont = async (prefs) => {
      await page.evaluate((prefs) => { window.__CCF_SECOND_CHAT_PANEL__.close(); for (const [k, v] of Object.entries(prefs)) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } window.__CCF_SECOND_CHAT_PANEL__.open(); }, prefs);
      await page.waitForTimeout(600);
      return page.evaluate(() => [...document.querySelectorAll('#ccf-second-chat-panel [data-ccf-msg-id]')].map((r) => Number(r.classList.contains('is-cont') || r.hasAttribute('data-ccf-cont'))).join(''));
    };
    assert.equal(await cont({}), '010', 'default: the other standing picture starts a new group');
    assert.equal(await cont({ 'ccf-prose-split-avatar': 'off' }), '011', 'split off: same name merges');
    assert.equal(await cont({ 'ccf-prose-merge': 'off', 'ccf-prose-split-avatar': null }), '000', 'merging off');
    assert.deepEqual(errors, []);
    console.log('chat panel continuation by standing PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
