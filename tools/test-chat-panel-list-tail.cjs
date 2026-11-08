const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The space under the last message: the real panel script next to a fake native chat list. A value is taken only after it was measured the same three times in a row (the native list at the bottom),
// it is saved, and after a reload the panel starts with the saved value instead of a guess; outliers (0 or over 30 px) are ignored.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const NATIVE = `<style>#nat{position:fixed;top:0;right:0;width:340px;height:600px}#sc{height:600px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px;border-bottom:1px solid #444}h6{margin:0;height:20px}p{margin:0}</style>
  <div id="nat" class="MuiDrawer-paper"><div id="sc"><ul class="MuiList-root" id="nlist" style="margin:0;padding:0 0 TAILpx"></ul></div></div><div id="root"></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    let tail = 9;
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: NATIVE.replace('TAIL', String(tail)) }));
    const setup = async () => {
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(() => {
        const list = document.getElementById('nlist');
        for (let i = 0; i < 40; i += 1) { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); }
        const sc = document.getElementById('sc'); sc.scrollTop = sc.scrollHeight;
        const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: 1700000000, nanoseconds: 0 } } };
        const state = { entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      });
    };
    const tailVar = () => page.evaluate(() => document.querySelector('.ccf-scp-panel')?.style.getPropertyValue('--scp-list-tail') || '');
    const saved = () => page.evaluate(() => localStorage.getItem('ccf-scp-list-tail:v1'));
    await setup();
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(700);
    assert.equal(await saved(), null, 'nothing is saved after one or two measurements');
    await page.waitForTimeout(2200); // three equal measurements (the layout runs every 500 ms)
    assert.equal(await tailVar(), '9px', 'the stable measurement is taken: ' + await tailVar());
    assert.deepEqual(JSON.parse(await saved()), { tail: 9 }, 'and saved');
    // after a reload the saved value is used at once (the native list is not at the bottom yet, so nothing can be measured)
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => {
      const list = document.getElementById('nlist');
      for (let i = 0; i < 40; i += 1) { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); }
      document.getElementById('sc').scrollTop = 0; // the original is scrolled to the top: no measurement possible
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: 1700000000, nanoseconds: 0 } } };
      const state = { entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(600);
    assert.equal(await tailVar(), '9px', 'the saved value is used right after the reload: ' + await tailVar());
    // an outlier is not taken: a native list with 0 px under the last line while the saved value stays
    tail = 0;
    await page.goto('https://ccfolia.test/rooms/test'); // route now serves tail 0
    await page.evaluate(() => {
      const list = document.getElementById('nlist');
      for (let i = 0; i < 40; i += 1) { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); }
      const sc = document.getElementById('sc'); sc.scrollTop = sc.scrollHeight;
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: 1700000000, nanoseconds: 0 } } };
      const state = { entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(3000);
    assert.equal(await tailVar(), '9px', 'a 0 px outlier is ignored, the saved value stays: ' + await tailVar());
    console.log('chat panel list tail PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
