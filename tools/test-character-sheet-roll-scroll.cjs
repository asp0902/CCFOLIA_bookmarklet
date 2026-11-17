const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// character-sheet: a roll from the sheet keeps the sheet where it was (the scroll of its body and the window position).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
const room = (insane) => `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">
  ${insane ? '<span class="MuiTypography-caption">인세인</span>' : '<span class="MuiTypography-caption">다른 시스템</span>'}
  <div id="root"></div><div id="toolbar"><button aria-label="내 캐릭터">내 캐릭터</button></div>
  <form id="chat" style="margin:8px"><textarea id="chatbox" style="width:300px"></textarea><button type="submit">전송</button></form>
  <div class="MuiDialog-root" role="dialog" id="charlist" style="position:fixed;right:20px;top:120px;width:360px;background:#333">
    <h2>내 캐릭터 목록</h2>
    <ul id="rows">
      <li class="MuiListItem-root" id="row1" style="display:flex;gap:6px"><div class="MuiListItemText-root" style="flex:1"><h6 class="MuiListItemText-primary">연갈</h6></div><button aria-label="토큰을 화면에서 삭제" class="MuiIconButton-root del">삭</button></li>
      <li class="MuiListItem-root" id="row2" style="display:flex;gap:6px"><div class="MuiListItemText-root" style="flex:1"><h6 class="MuiListItemText-primary">브릿지</h6></div><button aria-label="토큰을 화면에서 삭제" class="MuiIconButton-root del">삭</button></li>
    </ul></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async (insane, viewport = { width: 1300, height: 900 }) => {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: room(insane) }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => {
        window.__sent = []; window.__rowClicks = 0;
        document.getElementById('chat').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.getElementById('chatbox').value); });
        document.getElementById('rows').addEventListener('click', () => { window.__rowClicks += 1; });
        const state = { entities: { roomCharacters: { entities: {} } } };
        document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } };
      });
      await page.addScriptTag({ content: source });
      return page;
    };
    const R = '#ccf-character-sheet-root';

    const page = await open(true);
    await page.waitForSelector('#row1 [data-ccf-character-sheet-row-button]');
    await page.locator('#row1 [data-ccf-character-sheet-row-button]').click();
    await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
    const where = () => page.evaluate(() => { const d = document.querySelector('#ccf-character-sheet-root .ccf-cs-dialog'), m = d.querySelector('main'); return { scroll: Math.round(m.scrollTop), top: Math.round(d.getBoundingClientRect().top), page: Math.round(document.scrollingElement.scrollTop) }; });
    const out = [];
    for (const sel of ['button[data-roll]', 'button[data-ability-roll]', 'footer button[data-command]', 'footer button[data-action="fear-roll"]']) {
      await page.evaluate(() => { const m = document.querySelector('#ccf-character-sheet-root .ccf-cs-dialog main'); m.scrollTop = Math.min(300, m.scrollHeight - m.clientHeight); });
      const before = await where();
      const btn = page.locator(`${R} ${sel}`).last();
      if (!(await btn.count())) { out.push([sel, 'none']); continue; }
      await btn.evaluate((b) => b.scrollIntoView({ block: 'nearest' }));
      const mid = await where();
      await btn.click();
      await page.waitForTimeout(700);
      const after = await where();
      out.push([sel, mid, after]);
      assert.deepEqual(after, mid, `${sel}: the sheet stays where it was (${JSON.stringify({ before, mid, after })})`);
    }
    // 0.5.44: the window header never stays off-screen (it was found above the screen after a roll): drag it low, shrink the view, roll -> the header is back in view
    { const h = await page.locator(R + ' .ccf-cs-dialog > header').boundingBox(); await page.mouse.move(h.x + 60, h.y + 20); await page.mouse.down(); await page.mouse.move(h.x + 60, 860, { steps: 5 }); await page.mouse.up(); }
    await page.setViewportSize({ width: 1300, height: 500 });
    await page.waitForTimeout(200);
    await page.locator(`${R} footer button[data-command]`).first().evaluate((b) => b.click());
    await page.waitForTimeout(800);
    const head = await page.locator(R + ' .ccf-cs-dialog > header').boundingBox();
    assert(head.y >= 0 && head.y <= 500 - 40, 'header in view: ' + JSON.stringify(head));
    assert.deepEqual(page.__errors, []);
    console.log('character sheet roll keeps scroll PASS', JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
