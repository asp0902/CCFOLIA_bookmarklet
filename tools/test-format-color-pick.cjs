const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// format-sync 0.1.118: a format bar's color box opens the toolkit picker instead of the browser one:
// choosing only previews, [확인] applies (input + change on the box) and closes, outside / Esc cancels; confirmed colors are kept (latest first, no duplicates, 12), click = choose, right-click / × = delete.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><div class="ccf-scp-fmt" style="position:fixed;left:40px;top:300px"><input type="color" id="target" value="#ffffff"></div><input type="color" id="other" style="position:fixed;left:400px;top:300px"></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => { window.__events = []; const t = document.getElementById('target'); t.addEventListener('input', () => __events.push('input:' + t.value)); t.addEventListener('change', () => __events.push('change:' + t.value)); });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(500);
    const pop = () => page.locator('#ccf-color-pick');
    const choose = (hex) => pop().locator('input[type=color]').evaluate((i, v) => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, hex);
    // click -> our picker (the browser one is cancelled)
    const prevented = await page.evaluate(() => { let p = null; document.addEventListener('click', (e) => { p = e.defaultPrevented; }, { once: true }); document.getElementById('target').click(); return p; });
    assert.equal(prevented, true, 'the browser picker is not opened');
    assert.equal(await pop().count(), 1);
    // choosing only previews
    await choose('#ff0000');
    assert.equal(await page.inputValue('#target'), '#ffffff', 'not applied while choosing');
    assert.equal(await pop().locator('.pv').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(255, 0, 0)', 'preview');
    // Esc cancels
    await page.keyboard.press('Escape');
    assert.equal(await pop().count(), 0); assert.equal(await page.inputValue('#target'), '#ffffff'); assert.deepEqual(await page.evaluate(() => __events), []);
    // confirm applies + is remembered
    await page.click('#target'); await choose('#ff0000'); await pop().locator('[data-ok]').click();
    assert.equal(await pop().count(), 0); assert.equal(await page.inputValue('#target'), '#ff0000');
    assert.deepEqual(await page.evaluate(() => __events), ['input:#ff0000', 'change:#ff0000'], 'the box gets input + change');
    await page.click('#target'); await pop().locator('.hex').fill('#00ff00'); await pop().locator('[data-ok]').click();
    await page.click('#target'); await choose('#ff0000'); await pop().locator('[data-ok]').click();
    await page.click('#target');
    assert.deepEqual(await pop().locator('.sw').evaluateAll((s) => s.map((e) => e.dataset.c)), ['#ff0000', '#00ff00'], 'latest first, no duplicates');
    // click a saved color = choose it (still only a preview)
    await pop().locator('.sw[data-c="#00ff00"]').click();
    assert.equal(await pop().locator('.hex').inputValue(), '#00ff00'); assert.equal(await page.inputValue('#target'), '#ff0000');
    // right-click deletes, × deletes
    await pop().locator('.sw[data-c="#00ff00"]').click({ button: 'right' });
    assert.deepEqual(await pop().locator('.sw').evaluateAll((s) => s.map((e) => e.dataset.c)), ['#ff0000']);
    await pop().locator('.sw[data-c="#ff0000"]').hover(); await pop().locator('[data-del="#ff0000"]').click();
    assert.equal(await pop().locator('.sw').count(), 0);
    // outside click cancels
    await page.mouse.click(900, 650);
    assert.equal(await pop().count(), 0); assert.equal(await page.inputValue('#target'), '#ff0000');
    // a color box outside the format bars is left alone
    await page.evaluate(() => document.getElementById('other').click());
    assert.equal(await pop().count(), 0);
    // 12 at most
    await page.evaluate(() => localStorage.setItem('ccf-format-recent-colors-v1', JSON.stringify(Array.from({ length: 15 }, (_, i) => '#0000' + String(i).padStart(2, '0')))));
    await page.click('#target'); assert.equal(await pop().locator('.sw').count(), 12);
    assert.deepEqual(errors, []);
    console.log('format color pick PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
