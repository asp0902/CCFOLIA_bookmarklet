// theme 0.2.61: the colour code boxes of the character colour palette accept typing inside a CCFOLIA dialog: the dialog's focus trap does not pull focus out of the
// picker popup, and the box is not rewritten while typing (3 and 6 digit hex, RGB, HSL, paste, Enter). The popup has no outline, only a popover shadow.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const P = '#ccf-character-color-popover';
const html = `<!doctype html><meta charset=utf-8><body style="background:#222;color:#fff"><div class="MuiDialog-root" role="presentation"><div id="dlg" class="MuiPaper-root MuiDialog-paper" role="dialog" tabindex="-1" style="position:fixed;left:40px;top:40px;width:320px;background:#333"><div style="padding: 15px 9px 9px 15px"><div style="position: relative"><span>#</span><input id="rc-editable-input-1" value="C2C2C2"></div></div></div></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    // MUI's FocusTrap: focus that lands outside the dialog is sent back to it
    await page.evaluate(() => document.addEventListener('focusin', () => { const d = document.getElementById('dlg'); if (!d.contains(document.activeElement)) d.focus(); }));
    await page.addScriptTag({ content: source });
    await page.waitForSelector('.ccf-character-color-picker', { timeout: 8000 });
    const native = () => page.inputValue('#rc-editable-input-1');
    const openPicker = async () => { await page.locator('.ccf-character-color-picker').first().click(); await page.waitForSelector(`${P}.open`); };
    const code = page.locator(`${P} .ccf-character-color-popover-hex`);
    const preview = () => page.locator(`${P} .ccf-character-color-popover-preview`).evaluate((n) => getComputedStyle(n).backgroundColor);
    const retype = async (text) => { await code.click(); await page.keyboard.press('Control+A'); await page.keyboard.type(text, { delay: 15 }); await page.waitForTimeout(60); };
    await openPicker();
    // outline gone, a shadow stays
    const look = await page.locator(P).evaluate((n) => { const c = getComputedStyle(n); return { border: c.borderTopWidth, shadow: c.boxShadow !== 'none' }; });
    assert.deepEqual(look, { border: '0px', shadow: true }, 'no outline, shadow only');
    await retype('12ab9f');
    assert.equal(await code.evaluate((n) => document.activeElement === n), true, 'focus stays in the code box');
    assert.equal((await code.inputValue()).toLowerCase(), '12ab9f', 'six digits typed one by one are not rewritten');
    assert.equal(await preview(), 'rgb(18, 171, 159)');
    // 0.2.67: choosing only previews — the character colour changes on [확인] (like the format colour picker)
    const before = (await native()).toLowerCase();
    assert.notEqual(before.replace('#', ''), '12ab9f', 'not applied while choosing');
    const sv = await page.locator(`${P} .ccf-character-color-popover-sv`).boundingBox();
    await page.mouse.move(sv.x + 5, sv.y + 5); await page.mouse.down(); await page.mouse.move(sv.x + sv.width / 2, sv.y + sv.height / 2); await page.mouse.up();
    assert.equal((await native()).toLowerCase(), before, 'area drag: character colour unchanged');
    // Esc = cancel (the original colour), outside click = cancel
    await page.keyboard.press('Escape'); await page.waitForTimeout(80);
    assert.equal(await page.locator(`${P}.open`).count(), 0); assert.equal((await native()).toLowerCase(), before, 'Esc keeps the original');
    await openPicker(); await retype('445566'); await page.mouse.click(5, 5); await page.waitForTimeout(80);
    assert.equal(await page.locator(`${P}.open`).count(), 0); assert.equal((await native()).toLowerCase(), before, 'outside click keeps the original');
    // [확인] applies and closes
    await openPicker(); await retype('12ab9f');
    assert.equal(await page.locator(`${P} .ccf-character-color-popover-ok`).textContent(), '확인');
    await page.locator(`${P} .ccf-character-color-popover-ok`).click(); await page.waitForTimeout(80);
    assert.equal(await page.locator(`${P}.open`).count(), 0, 'OK closes');
    assert.equal((await native()).toLowerCase().replace('#', ''), '12ab9f', 'OK: the colour reaches CCFOLIA');
    await openPicker();
    await retype('f80');
    assert.equal(await code.inputValue(), 'f80', 'three digits stay as typed'); assert.equal(await preview(), 'rgb(255, 136, 0)');
    await code.click(); await page.keyboard.press('Control+A');
    await page.evaluate(() => navigator.clipboard.writeText('#336699')); await page.keyboard.press('Control+V'); await page.waitForTimeout(60);
    assert.equal(await preview(), 'rgb(51, 102, 153)', 'paste');
    // RGB and HSL modes
    await page.locator(`${P} .ccf-character-color-popover-mode`).click();
    assert.equal(await code.inputValue(), '51, 102, 153', 'mode change shows the colour in the new format');
    await retype('10, 20, 30');
    assert.equal(await code.inputValue(), '10, 20, 30'); assert.equal(await preview(), 'rgb(10, 20, 30)');
    await page.locator(`${P} .ccf-character-color-popover-mode`).click();
    await retype('120, 100%, 50%');
    assert.equal(await code.inputValue(), '120, 100%, 50%'); assert.equal(await preview(), 'rgb(0, 255, 0)');
    await page.locator(`${P} .ccf-character-color-popover-mode`).click();
    await retype('abcdef'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    assert.equal(await page.locator(`${P}.open`).count(), 0, 'Enter applies and closes');
    assert.equal((await native()).toLowerCase().replace('#', ''), 'abcdef');
    // the code box of the palette itself
    const proxy = page.locator('.ccf-character-color-proxy-input');
    await proxy.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('1a2b3c', { delay: 15 }); await page.waitForTimeout(60);
    assert.equal((await proxy.inputValue()).toLowerCase(), '1a2b3c', 'palette box: typing is not rewritten');
    await page.keyboard.press('Enter'); await page.waitForTimeout(60);
    assert.equal((await native()).toLowerCase().replace('#', ''), '1a2b3c');
    assert.deepEqual(errors, []);
    console.log('character color picker PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
