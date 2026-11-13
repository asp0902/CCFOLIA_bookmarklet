// format-sync: the Sv (서식 저장) button of the format bar looks active (.active like the other format buttons) while at least one style preset of this room is auto-applied
// (its red dot on), off as soon as none is; right after a reload; per room (presets are stored per room). Real format-sync + a copied chat input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const BODY = '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><textarea name="text" rows="2" style="width:100%"></textarea><button type="submit">전송</button></form></body>';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await context.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: BODY }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const load = async (room) => { await page.goto(`https://ccfolia.com/rooms/${room}`); await page.addScriptTag({ content: source }); await page.locator('.ccf-inline-toolbar [data-inline-command="style-clipboard"]').first().waitFor({ state: 'attached', timeout: 8000 }); await page.waitForTimeout(300); };
    const sv = () => page.evaluate(() => { const b = document.querySelector('.ccf-inline-toolbar [data-inline-command="style-clipboard"]'); const active = document.querySelector('.ccf-inline-toolbar [data-inline-command="bold"]'); return { on: b.classList.contains('active'), bg: getComputedStyle(b).backgroundColor }; });
    await page.goto('https://ccfolia.com/rooms/r1');
    await page.evaluate(() => {
      localStorage.setItem('ccf-format-style-presets-v1:r1', JSON.stringify([{ name: '빨강', style: { color: '#ff0000' }, auto: false, savedAt: 1 }, { name: '굵게', style: { bold: true }, auto: false, savedAt: 2 }]));
      localStorage.setItem('ccf-format-style-presets-v1:r2', JSON.stringify([{ name: '파랑', style: { color: '#0000ff' }, savedAt: 3 }]));
    });
    await load('r1');
    const off = await sv();
    assert.equal(off.on, false, 'no preset auto-applied: Sv off');
    // turn one preset's red dot on in the preset popover -> Sv active at once
    await page.evaluate(() => document.querySelector('[data-inline-command="style-clipboard"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForSelector('.ccf-inline-popover.open [data-inline-style-action="auto"]');
    await page.locator('.ccf-inline-popover.open [data-inline-style-action="auto"]').first().dispatchEvent('click');
    const on = await sv();
    assert.equal(on.on, true, 'one preset on: Sv active');
    // the active look is the one of the other active format buttons
    const ref = await page.evaluate(() => { const b = document.querySelector('.ccf-inline-toolbar [data-inline-command="bold"]'); b.classList.add('active'); const bg = getComputedStyle(b).backgroundColor; b.classList.remove('active'); return bg; });
    assert.equal(on.bg, ref, 'same look as an active format button');
    // reload: still active
    await load('r1'); assert.equal((await sv()).on, true, 'after a reload');
    // all off -> Sv off at once
    await page.evaluate(() => document.querySelector('[data-inline-command="style-clipboard"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForSelector('.ccf-inline-popover.open [data-inline-style-action="auto"][data-on="1"]');
    for (const dot of await page.locator('.ccf-inline-popover.open [data-inline-style-action="auto"][data-on="1"]').all()) await dot.dispatchEvent('click');
    assert.equal((await sv()).on, false, 'all off: Sv off');
    // another room: its own presets (one auto-applied by default) -> active there
    await load('r2'); assert.equal((await sv()).on, true, 'room r2 has an auto-applied preset');
    await load('r1'); assert.equal((await sv()).on, false, 'back in r1: off');
    assert.deepEqual(errors, []);
    console.log('sv active PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
