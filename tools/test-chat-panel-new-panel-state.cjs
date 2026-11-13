// chat-panel 0.5.36: a panel the user ADDS starts from the original chat as it is at that moment: the selected tab (app state roomChatTab) - not the tab an earlier panel
// of the same number remembered - and, when the original's format bar has 유지 on, its kept formatting (alignment, text / background colour, size, () grey, narration).
// A panel restored after a reload keeps its own last tab. An empty tab shows an empty list (no "no messages yet" notice).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const BODY = `<body><div id="root"></div>
  <div class="ccf-inline-toolbar" style="position:fixed;bottom:0;left:0">
    <button class="ccf-toggle" data-inline-command="bold">B</button>
    <button class="ccf-toggle" data-inline-command="align" data-align="left">L</button><button class="ccf-toggle active" data-inline-command="align" data-align="center">C</button><button class="ccf-toggle" data-inline-command="align" data-align="right">R</button>
    <input type="color" value="#ff0000" data-inline-color="color"><input type="color" value="#010101" data-inline-color="backgroundColor"><input class="ccf-inline-size-input" value="20">
    <button class="ccf-toggle active" data-inline-command="narration">Nr</button><button class="ccf-toggle" data-inline-command="paren-gray">()</button><button class="ccf-toggle active" data-inline-command="keep">유지</button>
  </div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 2000, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: BODY }));
    await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    const load = async () => {
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(() => new Promise((resolve, reject) => { const req = indexedDB.open("firebaseLocalStorageDb", 1); req.onupgradeneeded = () => req.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" }); req.onsuccess = () => { const tx = req.result.transaction("firebaseLocalStorage", "readwrite"); tx.objectStore("firebaseLocalStorage").put({ fbase_key: "firebase:authUser:A:[DEFAULT]", value: { uid: "u", stsTokenManager: { accessToken: "tok", expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); }));
      await page.evaluate(() => {
        const now = Math.floor(Date.now() / 1000);
        const entities = { m1: { name: '앨리스', text: '메인 글', channel: 'main', createdAt: { seconds: now - 9, nanoseconds: 0 } }, m2: { name: '앨리스', text: '정보 글', channel: 'info', createdAt: { seconds: now - 8, nanoseconds: 0 } } };
        const state = { app: { state: { roomId: 'r1', roomChatTab: 'info' }, user: { uid: 'u' } }, entities: { roomMessages: { entities, ids: ['m1', 'm2'], idsGroupBy: { main: ['m1'], info: ['m2'] } }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner: 'x' } } } } };
        window.__state = state;
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      });
      await page.addScriptTag({ content: source }); await page.waitForTimeout(300);
    };
    await page.goto('https://ccfolia.test/rooms/test');
    // an earlier panel no. 2 remembered 잡담 (other)
    await page.evaluate(() => localStorage.setItem('ccf-second-chat-panel:v1:p2', JSON.stringify({ channel: 'other' })));
    await load();
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(300);
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(400);
    const look = (id) => page.evaluate((id) => { const p = document.getElementById(id); return { tab: p.querySelector('.ccf-scp-tab.is-active, .ccf-scp-tab[aria-selected="true"]')?.textContent.trim(), rows: [...p.querySelectorAll('[data-ccf-msg-id]')].map((r) => r.getAttribute('data-ccf-msg-id')), center: !!p.querySelector('.ccf-scp-fmt-align.is-active[title*="가운데"], .ccf-scp-fmt-align.is-active:nth-of-type(2)'), keep: p.querySelector('.ccf-scp-fmt-btn.is-active')?.textContent || '', nr: p.querySelector('.ccf-scp-fmt-nr')?.classList.contains('is-active'), size: p.querySelector('.ccf-scp-fmt input[type="text"], .ccf-scp-fmt input[inputmode], .ccf-scp-fmt input:not([type="color"])')?.value, empty: p.querySelector('.ccf-scp-empty')?.textContent || '' }; }, id);
    const p2 = await look('ccf-chat-panel-2');
    console.log('new panel', JSON.stringify(p2));
    assert.equal(p2.tab, '정보', 'the added panel opens on the original\'s tab (정보), not the remembered 잡담');
    assert.deepEqual(p2.rows, ['m2']);
    assert.equal(p2.nr, true, 'narration kept from the original (유지)');
    assert.equal(p2.size, '20', 'size kept');
    const fmt = await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-scp-fmt-saved') || 'null'));
    // switching the tab in that panel changes only that panel
    await page.evaluate(() => { const t = [...document.querySelectorAll('#ccf-chat-panel-2 .ccf-scp-tab')].find((b) => b.textContent.trim() === '메인'); t.click(); });
    await page.waitForTimeout(200);
    assert.equal((await look('ccf-chat-panel-2')).tab, '메인'); assert.equal((await look('ccf-second-chat-panel')).tab, '정보', 'the other added panel keeps its tab');
    // an empty tab: no notice
    await page.evaluate(() => { const t = [...document.querySelectorAll('#ccf-second-chat-panel .ccf-scp-tab')].find((b) => b.textContent.trim() === '잡담'); t?.click(); });
    await page.waitForTimeout(200);
    assert.equal((await look('ccf-second-chat-panel')).empty, '', 'empty tab: no notice');
    // reload: restored panels keep their own last tab (panel 2 is on 메인 now even though the original is on 정보)
    await load(); await page.waitForTimeout(400);
    assert.equal((await look('ccf-chat-panel-2')).tab, '메인', 'restored, not reset');
    assert.deepEqual(errors, []);
    console.log('chat panel new panel state PASS', JSON.stringify(fmt));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
