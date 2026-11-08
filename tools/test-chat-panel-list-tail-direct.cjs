const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Direct comparison: the distance "last line -> start of the tab row" is measured in the original (list at the bottom, three equal measurements) and in the panel; the panel's list padding is
// corrected by the difference, wherever the extra space comes from. The real script, a fake original with a 6 px gap between its list and its tab row.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const NATIVE = `<style>#nat{position:fixed;top:0;right:0;width:340px;height:640px}#sc{height:600px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px;border-bottom:1px solid #444}h6{margin:0;height:20px}p{margin:0}
  .MuiTabs-root{margin-top:6px;height:34px;background:#222}</style>
  <div id="nat" class="MuiDrawer-paper"><div id="sc"><ul class="MuiList-root" id="nlist" style="margin:0;padding:0 0 9px"></ul></div><div class="MuiTabs-root"><div class="MuiTabs-flexContainer" role="tablist"><button role="tab">메인</button><button role="tab">정보</button><button role="tab">잡담</button></div></div></div><div id="root"></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: NATIVE }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => {
      const list = document.getElementById('nlist');
      for (let i = 0; i < 40; i += 1) { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); }
      const sc = document.getElementById('sc'); sc.scrollTop = sc.scrollHeight;
      const entities = {}, ids = [];
      for (let i = 0; i < 60; i += 1) { entities['n' + i] = { name: '눈깅이', text: '메시지 ' + i, channel: 'main', createdAt: { seconds: 1700000000 + i, nanoseconds: 0 } }; ids.push('n' + i); }
      const state = { entities: { roomMessages: { entities, ids, idsGroupBy: { main: ids } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    // measured three times (every 500 ms), then the panel is adjusted (three equal differences, another ~1.5 s)
    await page.waitForTimeout(6000);
    const diag = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.tailDiag());
    const nativeToTabs = await page.evaluate(() => { const li = [...document.querySelectorAll('#nlist li')].pop(); return Math.round((document.querySelector('.MuiTabs-root').getBoundingClientRect().top - li.getBoundingClientRect().bottom) * 100) / 100; });
    assert.ok(Math.abs(diag.nativeToTabs - nativeToTabs) < 1, 'the original value was measured: ' + JSON.stringify({ diag, nativeToTabs }));
    assert.ok(Math.abs(diag.panelLastToTabs - nativeToTabs) <= 1, 'the panel distance equals the original one: ' + JSON.stringify({ diag, nativeToTabs }));
    console.log('chat panel list tail direct PASS', JSON.stringify({ nativeToTabs, panelLastToTabs: diag.panelLastToTabs, adjust: diag.panelAdjust, tail: diag.nativeTail }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
