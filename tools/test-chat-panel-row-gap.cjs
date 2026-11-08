const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Row gap: the space under the last text of a plain message down to its divider is measured in the original and the panel's rows get the difference. Also: a deleted tab (messages only) is not shown.
// (copy of the direct tail test) Direct comparison: the distance "last line -> start of the tab row" is measured in the original (list at the bottom, three equal measurements) and in the panel; the panel's list padding is
// corrected by the difference, wherever the extra space comes from. The real script, a fake original that has the real structure: rows are div.MuiListItem-root in a div list (not ul/li),
// with a 6 px gap between the list and the tab row. PANEL_SOURCE=<file> runs another version of the script (to see that an old one fails).
const sourcePath = process.env.PANEL_SOURCE || path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const NATIVE = `<style>#nat{position:fixed;top:0;right:0;width:340px;height:640px}#sc{height:600px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px;border-bottom:1px solid #444}h6{margin:0;height:20px}p{margin:0}
  .MuiTabs-root{margin-top:6px;height:34px;background:#222}.MuiListItemText-root{margin-bottom:10px}.ccf-scp-panel .MuiListItemText-root{margin-bottom:2px !important}</style>
  <div id="nat" class="MuiDrawer-paper"><div id="sc"><div class="MuiList-root" id="nlist" style="margin:0;padding:0 0 9px"></div></div><div class="MuiTabs-root"><div class="MuiTabs-flexContainer" role="tablist"><button role="tab">메인</button><button role="tab">정보</button><button role="tab">잡담</button></div></div></div><div id="root"></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: NATIVE }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => {
      const list = document.getElementById('nlist');
      for (let i = 0; i < 40; i += 1) { const row = document.createElement('div'); row.className = 'MuiListItem-root'; row.innerHTML = `<div class="MuiListItemAvatar-root"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="40" height="40"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">줄 ${i}</p></div>`; list.append(row); }
      const sc = document.getElementById('sc'); sc.scrollTop = sc.scrollHeight;
      const entities = { g1: { name: '눈깅이', text: '지운 탭의 글', channel: 'gone', createdAt: { seconds: 1600000000, nanoseconds: 0 } } }, ids = [];
      for (let i = 0; i < 60; i += 1) { entities['n' + i] = { name: '눈깅이', text: '메시지 ' + i, channel: 'main', createdAt: { seconds: 1700000000 + i, nanoseconds: 0 } }; ids.push('n' + i); }
      const state = { entities: { roomMessages: { entities, ids, idsGroupBy: { main: ids, gone: ['g1'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(6000);
    const diag = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.tailDiag());
    const gaps = await page.evaluate(() => { const gap = (li) => { const p = li.querySelector('p.MuiListItemText-secondary'); return Math.round((li.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom) * 100) / 100; }; const nat = document.querySelectorAll('#nlist .MuiListItem-root'); const pan = [...document.querySelectorAll('#ccf-second-chat-panel [data-ccf-msg-id]')]; return { native: gap(nat[nat.length - 1]), panel: gap(pan[pan.length - 1]) }; });
    assert.ok(diag.rowGap && diag.rowGap.adopts >= 1 && diag.rowGap.adopts <= 3, 'the row gap was corrected: ' + JSON.stringify(diag.rowGap));
    assert.ok(Math.abs(gaps.native - gaps.panel) <= 1, 'under the text the panel row has the original distance: ' + JSON.stringify({ gaps, rowGap: diag.rowGap }));
    const tabs = await page.evaluate(() => [...document.querySelectorAll('#ccf-second-chat-panel .ccf-scp-tab')].map((t) => t.textContent.trim()));
    assert.ok(!tabs.some((t) => /gone/.test(t)), 'the deleted tab is not listed: ' + JSON.stringify(tabs));
    console.log('chat panel row gap PASS', JSON.stringify({ gaps, tabs, extra: diag.rowGap.extra }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
