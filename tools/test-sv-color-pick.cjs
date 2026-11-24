// format-sync 0.1.161: the colour picker (#ccf-color-pick, on body) belongs to the window that opened it. Picking a font / background colour in the format preset
// window (Sv) closed the Sv window: the document mousedown took the picker for an outside click (seen on the real test room page). Real mouse / keyboard events:
// Sv open -> colour field -> picker; typing a code and OK keep Sv open and set the colour; Esc closes only the picker; a real outside click still closes both.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><div id="away" style="position:fixed;left:0;top:0;width:200px;height:200px"></div><form id="composer" style="position:fixed;left:300px;bottom:20px;width:500px"><input name="name" value="나"><div style="display:flex"><button type="submit" style="margin-left:auto">전송</button></div><textarea name="text" rows="3" style="width:100%"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => { const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } }; document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } }; });
    await page.addScriptTag({ content: source });
    const bar = page.locator('.ccf-inline-toolbar').first();
    await bar.waitFor({ state: 'attached', timeout: 8000 });
    const sv = page.locator('.ccf-inline-popover.open');
    const svOpen = () => sv.count().then((n) => n > 0);
    const pick = page.locator('#ccf-color-pick');
    await bar.locator('[data-inline-command="style-clipboard"]').click();
    await sv.waitFor({ timeout: 3000 });
    const fields = sv.locator('input[type="color"]');
    assert.equal(await fields.count(), 2, 'font and background colour fields');
    for (const [i, code] of [[0, '#ff3366'], [1, '#123456']]) {
      await fields.nth(i).click();
      await pick.waitFor({ timeout: 2000 });
      assert.equal(await svOpen(), true, `field ${i}: Sv stays when the picker opens`);
      await pick.locator('.hex').click({ clickCount: 3 });
      await page.keyboard.type(code);
      assert.equal(await svOpen(), true, `field ${i}: Sv stays while typing in the picker`);
      await pick.locator('[data-ok]').click();
      assert.equal(await pick.count(), 0, 'OK closes the picker');
      assert.equal(await svOpen(), true, `field ${i}: Sv stays after OK`);
      assert.equal(await fields.nth(i).inputValue(), code, `field ${i}: colour set`);
    }
    // Esc in the picker closes only the picker
    await fields.nth(0).click(); await pick.waitFor({ timeout: 2000 });
    await pick.locator('.hex').click(); await page.keyboard.press('Escape');
    assert.equal(await pick.count(), 0); assert.equal(await svOpen(), true, 'Esc: Sv stays');
    // a real outside click still closes the Sv window
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);
    assert.equal(await svOpen(), false, 'outside click closes Sv');
    assert.deepEqual(errors, []);
    console.log('sv color pick PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
