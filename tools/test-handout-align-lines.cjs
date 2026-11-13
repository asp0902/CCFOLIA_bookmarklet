// handout: alignment / H1 / quote / Sv applied to the whole text keep every text line (typed div lines, <br> lines, newline characters, <p>, mixed, a span with newlines),
// with format-sync on the page as in a real room. (Reported: "alignment removes all line breaks" - not reproduced; kept as a regression check.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', handouts: [], folders: [], plDeleted: {}, plDeletedMigrated: true, plList: [{ name: '눈깅', id: '', role: 'player', aliases: [], image: '' }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async (f, k, v) => { window.__saved = JSON.parse(JSON.stringify(v)); } } };
    });
    for (const f of ['ccfolia-format-sync']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../legacy/' + f + '.user.js'), 'utf8') });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const sh = (sel) => page.locator('#ccfolia-handout-root').locator(sel);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="new-handout"]').click()); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="add-handout-choice"]').click()); await page.waitForTimeout(300);
    await sh('[data-field="title"]').fill('바깥 상황');
    const ed = sh('.rich-editor[data-field="description"]');
    const get = () => page.evaluate(() => { const e = document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.rich-editor[data-field="description"]'); return [e.innerText.split('\n').filter((l) => l.trim()).length, e.innerHTML.slice(0, 260)]; });
    const cases = { br: '줄0<br>줄1<br>줄2<br>줄3<br>줄4', nl: '줄0\n줄1\n줄2\n줄3\n줄4', p: '<p>줄0</p><p>줄1</p><p>줄2</p>', mixed: '<div>줄0<br>줄1</div><div>줄2</div>', spanNl: '<span style="color:red">줄0\n줄1\n줄2</span>' };
    for (const [label, html] of Object.entries(cases)) for (const cmd of ['align-center', 'align-right', 'h1', 'quote', 'sv']) {
      await page.evaluate((h) => { document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.rich-editor[data-field="description"]').innerHTML = h; }, html);
      await ed.click(); await page.keyboard.press('Control+a');
      const b = await get();
      if (cmd === 'sv') { await page.evaluate(() => localStorage.setItem('ccf-format-style-presets-v1:test', JSON.stringify([{ name: 'x', style: { bold: true }, align: 'center' }]))); await sh('[data-format-cmd="sv"]').click(); await page.waitForTimeout(100); await sh('.sv-menu [data-sv-preset="0"]').click(); }
      else await sh(`[data-format-cmd="${cmd}"]`).click();
      await page.waitForTimeout(120);
      const a = await get();
      assert.equal(a[0], b[0], `${label} + ${cmd}: the text lines are kept (${a[1]})`);
    }
    assert.deepEqual(errors, []);
    console.log('handout align lines PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
