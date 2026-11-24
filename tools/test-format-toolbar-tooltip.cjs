// The format bar's tooltips are CCFOLIA's (MUI values measured on 1.37.6), not the browser's title: 100ms, 14px from the control, kept in the window; the title leaves, aria-label stays; keyboard focus shows it too.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;top:200px;width:520px"><input name="name" value="a"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const tip = () => page.evaluate(() => document.querySelector('.ccf-fmt-tip:not([data-leaving])')?.textContent ?? null);
    const bold = page.locator('[data-inline-command="bold"]').first();
    await bold.hover(); await page.waitForTimeout(30); assert.equal(await tip(), null, 'not before 100ms');
    await page.waitForTimeout(340); assert.equal(await tip(), 'Bold');
    assert.deepEqual(await bold.evaluate((n) => [n.getAttribute('title'), n.getAttribute('aria-label')]), [null, 'Bold'], 'no second, browser tooltip');
    assert.deepEqual(await page.evaluate(() => { const n = document.querySelector('.ccf-fmt-tip'), c = getComputedStyle(n), b = document.querySelector('[data-inline-command="bold"]').getBoundingClientRect(), r = n.getBoundingClientRect(); return [c.backgroundColor, c.color, c.fontSize, c.fontWeight, c.lineHeight, c.padding, c.borderRadius, c.whiteSpace, c.maxWidth, Math.round(r.top - b.bottom), Math.abs((r.left + r.right) / 2 - (b.left + b.right) / 2) <= 1]; }), ['rgb(22, 22, 22)', 'rgb(255, 255, 255)', '12px', '500', 'normal', '4px 8px', '4px', 'pre-wrap', '300px', 14, true]);
    for (const [selector, text] of [['[data-inline-command="italic"]', 'Italic'], ['.ccf-inline-size-input', null], ['.ccf-color-tool', 'Text color']]) {
      await page.locator(selector).first().hover({ force: true }); await page.waitForTimeout(150);
      const shown = await tip(); assert(text ? shown === text : !!shown, `${selector}: ${shown}`);
    }
    await page.mouse.move(700, 600); await page.waitForTimeout(20); assert.equal(await tip(), null, 'gone on leaving');
    await page.waitForTimeout(260); assert.equal(await page.locator('.ccf-fmt-tip').count(), 0, 'the fading copy is removed');
    // keyboard focus
    await page.locator('[data-inline-command="underline"]').first().evaluate((n) => n.setAttribute('tabindex', '0'));
    await page.locator('[data-inline-command="strike"]').first().evaluate((n) => n.setAttribute('tabindex', '0'));
    await page.locator('[data-inline-command="underline"]').first().focus(); await page.keyboard.press('Tab'); await page.waitForTimeout(170);
    assert.equal(await page.evaluate(() => document.activeElement.matches(':focus-visible')), true);
    assert.equal(await tip(), await page.evaluate(() => document.activeElement.dataset.ccfTip));
    assert.deepEqual(errors, []);
    console.log('format toolbar tooltip PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
