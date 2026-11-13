// chat-panel 0.5.36: an image pasted into the extra panel's input no longer shows its raw token ({i:address|name|}) in the box: the box gets one 🖼 character
// (with an invisible tag character, so caret / selection / Backspace treat it as one), a thumbnail with × shows above the box, and the sent text carries the token
// exactly as before (the same image message as from the original box). The format-sync paste handler is a stand-in here (it uploads in the real page).
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
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000) - 5, nanoseconds: 0 } } };
      const state = { entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      // stand-in for format-sync's paste handler: an image file was pasted and uploaded
      let n = 0;
      window.__CCF_FORMAT_SYNC_IMAGE_PASTE__ = { handle: (event, insert) => { event.preventDefault(); n += 1; insert(n === 1 ? IMG : 'ccf-firestore-image://abc' + n, '스크린샷' + n); return true; } };
    }, IMG);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(400);
    const input = page.locator('#ccf-second-chat-panel .ccf-scp-input');
    const paste = () => input.evaluate((el) => el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
    const look = () => page.evaluate(() => { const ta = document.querySelector('#ccf-second-chat-panel .ccf-scp-input'); return { value: ta.value, graphemes: [...new Intl.Segmenter().segment(ta.value)].length, chips: [...document.querySelectorAll('#ccf-second-chat-panel .ccf-scp-image-chip')].map((c) => (c.querySelector('img') ? 'img' : c.textContent.replace('×', '').trim())) }; });
    await input.click(); await input.fill('앞 '); await paste(); await page.keyboard.type(' 뒤');
    let st = await look();
    assert(!/\{i:|data:image|ccf-firestore/.test(st.value), 'no raw token in the box: ' + JSON.stringify(st.value));
    assert.equal(st.graphemes, 5, 'the marker is one character: ' + st.graphemes);
    assert.deepEqual(st.chips, ['img'], 'a thumbnail above the box');
    // Backspace over the marker removes the whole image
    await page.keyboard.press('End'); for (let i = 0; i < 2; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    st = await look();
    assert.equal(st.value, '앞 ', 'one Backspace removed the whole image marker'); assert.deepEqual(st.chips, [], 'its thumbnail is gone');
    // paste again (a stored image) and send: the sent text carries the token as before
    await paste(); await page.keyboard.type(' 끝');
    st = await look(); assert.deepEqual(st.chips, ['🖼 스크린샷2']);
    await page.locator('#ccf-second-chat-panel .ccf-scp-send').dispatchEvent('click');
    await page.waitForTimeout(800);
    const sent = writes.map((w) => { try { return JSON.parse(w).fields?.text?.stringValue; } catch (_) { return null; } }).filter(Boolean);
    assert.equal(sent.length, 1, JSON.stringify(writes).slice(0, 300));
    assert.match(sent[0], /^앞 /); assert.match(sent[0], / 끝/);
    assert(!/\u{1F5BC}/u.test(sent[0].replace(/[​-‍⁠-⁣]/g, '')), 'no marker in the sent text');
    assert.match(sent[0], /ccf-firestore-image:\/\/abc2|스크린샷2/, 'the image token (or its run) is in the sent message');
    assert.deepEqual((await look()).chips, [], 'the strip is cleared after sending');
    assert.deepEqual(errors, []);
    console.log('chat panel image marker PASS', JSON.stringify(sent[0].replace(/[​-‍⁠-⁣]/g, '').slice(0, 60)));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
