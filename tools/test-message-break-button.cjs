// chat-panel 0.5.34: a divider is put above a message (and taken away again) with one click on the message's hover button (GM, like the eye button), left of the eye button.
// It is saved in the message itself (envelope blockStyle.breakBefore, the same data the composer's "—" writes), so every screen that draws messages shows it (format-sync draws
// data-ccf-break). The "—" of CCFOLIA's message edit dialog is hidden (format-sync 0.1.112). Real chat-panel + format-sync, fake store and Firestore.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const panel = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const sync = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async (owner) => {
      const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      const patches = []; page.__patches = patches;
      await context.route('https://ccfolia.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body style="background:#222;color:#fff"><div id="root"></div><div class="MuiDrawer-paper" style="position:fixed;right:0;top:0;width:360px"><div role="log"><ul id="native" style="margin:0;padding:0;list-style:none"></ul></div></div></body>' }));
      await context.route('https://firestore.googleapis.com/**', async (route) => {
        const req = route.request();
        if (req.method() === 'PATCH') { patches.push({ url: req.url(), body: JSON.parse(req.postData()) }); return route.fulfill({ contentType: 'application/json', body: '{}' }); }
        return route.fulfill({ contentType: 'application/json', body: '[]' });
      });
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(async (owner) => {
        await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'firebase:authUser:AIzaB:[DEFAULT]', value: { uid: 'gm', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); });
        const now = Math.floor(Date.now() / 1000);
        const entities = { m1: { name: '눈깅이', text: '첫 말', channel: 'main', createdAt: { seconds: now - 20, nanoseconds: 0 } }, m2: { name: '눈깅이', text: '둘째 말', channel: 'main', createdAt: { seconds: now - 10, nanoseconds: 0 } } };
        const state = { app: { user: { uid: 'gm' }, state: { roomId: 'r1' } }, entities: { roomMessages: { entities, ids: ['m1', 'm2'], idsGroupBy: { main: ['m1', 'm2'] } }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner } } } } };
        window.__state = state;
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
        const ul = document.getElementById('native');
        for (const id of ['m1', 'm2']) {
          const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.style.cssText = 'position:relative;display:flex;padding:8px 16px';
          li.innerHTML = `<div class="MuiListItemAvatar-root"><img width="40" height="40"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">${entities[id].text}</p></div>`;
          li['__reactFiber$test'] = { memoizedProps: {}, return: { memoizedProps: { messageId: id } } };
          ul.append(li);
        }
      }, owner);
      await page.addScriptTag({ content: sync });
      await page.addScriptTag({ content: panel });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
      await page.waitForTimeout(3500);
      return page;
    };
    // GM
    const page = await open('gm');
    const row = '#native li:nth-child(2)';
    const look = await page.evaluate((sel) => { const li = document.querySelector(sel); const brk = li.querySelector('.ccf-break-btn'), eye = li.querySelector('.ccf-hide-btn'); return { brk: !!brk, label: brk?.getAttribute('aria-label'), id: brk?.dataset.id, path: brk?.querySelector('path')?.getAttribute('d') }; }, row);
    assert.deepEqual(look, { brk: true, label: '위에 구분선', id: 'm2', path: 'M4 11h16v2H4z' }, JSON.stringify(look));
    // left of the eye button when shown (hover)
    await page.locator(row).hover(); await page.waitForTimeout(200);
    const pos = await page.evaluate((sel) => { const li = document.querySelector(sel); const b = li.querySelector('.ccf-break-btn').getBoundingClientRect(), e = li.querySelector('.ccf-hide-btn').getBoundingClientRect(); return { left: b.right <= e.left + 1, sameRow: Math.abs((b.top + b.bottom) / 2 - (e.top + e.bottom) / 2) < 2, shown: b.width > 0 }; }, row);
    assert.deepEqual(pos, { left: true, sameRow: true, shown: true }, 'the divider button is left of the eye button');
    // click -> the message is written with breakBefore in its envelope
    await page.evaluate((sel) => document.querySelector(`${sel} .ccf-break-btn`).click(), row);
    await page.waitForTimeout(700);
    assert.equal(page.__patches.length, 1); assert.match(page.__patches[0].url, /\/messages\/m2\?/);
    const written = page.__patches[0].body.fields.text.stringValue;
    // Firestore sends it back: store + the row's text (React) -> format-sync draws the divider, the button says "구분선 빼기"
    await page.evaluate((text) => { window.__state.entities.roomMessages.entities.m2.text = text; const p = document.querySelector('#native li:nth-child(2) p'); p.firstChild.nodeValue = text; }, written);
    await page.waitForFunction((sel) => document.querySelector(`${sel} .ccf-render-root[data-ccf-break="1"]`) && document.querySelector(`${sel} .ccf-break-btn`)?.getAttribute('aria-label') === '구분선 빼기', row, { timeout: 6000 });
    assert.equal(await page.evaluate((sel) => document.querySelector(`${sel} p`).innerText.trim(), row), '둘째 말', 'the visible text is unchanged');
    // click again -> the flag is removed (the envelope had nothing else, so the plain text is written back)
    await page.evaluate((sel) => document.querySelector(`${sel} .ccf-break-btn`).click(), row);
    await page.waitForTimeout(700);
    assert.equal(page.__patches.length, 2); assert.equal(page.__patches[1].body.fields.text.stringValue, '둘째 말', 'divider removed');
    assert.deepEqual(page.__errors, []);
    // not the GM: no divider button
    const other = await open('someone-else');
    assert.equal(await other.locator('.ccf-break-btn').count(), 0, 'no divider button for a non-GM');
    console.log('message break button PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
