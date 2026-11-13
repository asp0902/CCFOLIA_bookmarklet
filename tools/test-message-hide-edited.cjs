// chat-panel 0.5.33: an edited message can be hidden too. CCFOLIA shows " [編集済]" after the text of an edited message, so the old pairing (row text == stored text) found no message
// and the eye button was missing. The row's message id is read from CCFOLIA's own message-row component (its React props carry messageId); text pairing stays the fallback.
// Also: messages sent by the extra panel use the CCFOLIA account ([DEFAULT]) even when the handout tool's anonymous account (ccf-handout) comes first in the auth store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(process.env.PANEL_SOURCE || path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const patches = [];
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body style="background:#222;color:#fff"><div id="root"></div><ul id="native" style="position:fixed;right:0;top:0;width:360px;margin:0;padding:0"></ul></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH') { patches.push({ url: req.url(), auth: req.headers().authorization, body: JSON.parse(req.postData()) }); return route.fulfill({ contentType: 'application/json', body: '{}' }); }
      return route.fulfill({ contentType: 'application/json', body: '[]' });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      // the handout tool's anonymous account is stored first, CCFOLIA's account second (key order in the real store depends on the browser)
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); const st = tx.objectStore('firebaseLocalStorage'); st.put({ fbase_key: 'firebase:authUser:AIzaA:ccf-handout', value: { uid: 'anon', stsTokenManager: { accessToken: 'handout-token', expirationTime: Date.now() + 3600000 } } }); st.put({ fbase_key: 'firebase:authUser:AIzaB:[DEFAULT]', value: { uid: 'gm', stsTokenManager: { accessToken: 'ccfolia-token', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); });
      const now = Math.floor(Date.now() / 1000);
      const entities = { m1: { name: '눈깅이', text: '보통 말', channel: 'main', createdAt: { seconds: now - 20, nanoseconds: 0 } }, m2: { name: '눈깅이', text: '고친 말', edited: true, channel: 'main', createdAt: { seconds: now - 10, nanoseconds: 0 } } };
      const state = { app: { user: { uid: 'gm' }, state: { roomId: 'r1' } }, entities: { roomMessages: { entities, ids: ['m1', 'm2'], idsGroupBy: { main: ['m1', 'm2'] } }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner: 'gm' } } } } };
      window.__state = state;
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      // CCFOLIA's rows: the row component receives { messageId }; an edited message shows " [編集済]" after its text
      const ul = document.getElementById('native');
      for (const [id, edited] of [['m1', false], ['m2', true]]) {
        const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.style.cssText = 'position:relative;display:flex;padding:8px 16px';
        li.innerHTML = `<div class="MuiListItemAvatar-root"><img width="40" height="40"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">${entities[id].text}${edited ? '<span class="MuiTypography-caption">&nbsp;[編集済]</span>' : ''}</p></div>`;
        li['__reactFiber$test'] = { memoizedProps: { className: 'x' }, return: { memoizedProps: { children: [] }, return: { memoizedProps: { messageId: id } } } };
        ul.append(li);
      }
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(3500); // the GM check runs every 1.5 s until known
    const eyes = await page.evaluate(() => [...document.querySelectorAll('#native li')].map((li) => li.querySelector('.ccf-hide-btn')?.dataset.id || ''));
    assert.deepEqual(eyes, ['m1', 'm2'], 'both native rows have an eye button, the edited one too: ' + JSON.stringify(eyes));
    // hide the edited message: the PATCH goes to m2 with the CCFOLIA account's token
    await page.evaluate(() => document.querySelector('#native li:nth-child(2) .ccf-hide-btn').click());
    await page.waitForTimeout(800);
    assert.equal(patches.length, 1, 'one write');
    assert.match(patches[0].url, /\/messages\/m2\?/, 'the edited message is the one written');
    assert.equal(patches[0].auth, 'Bearer ccfolia-token', 'written with the CCFOLIA account, not the handout tool\'s anonymous one');
    // the store now has the hidden text (as Firestore sends it back) -> the button turns to "다시 보이기" on the same row
    await page.evaluate((text) => { window.__state.entities.roomMessages.entities.m2.text = text; }, patches[0].body.fields.text.stringValue);
    await page.evaluate(() => { const p = document.querySelector('#native li:nth-child(2) p'); p.firstChild.nodeValue = window.__state.entities.roomMessages.entities.m2.text; });
    await page.waitForFunction(() => document.querySelector('#native li:nth-child(2) .ccf-hide-btn')?.getAttribute('aria-label') === '다시 보이기', null, { timeout: 6000 });
    assert.deepEqual(errors, []);
    console.log('message hide edited PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
