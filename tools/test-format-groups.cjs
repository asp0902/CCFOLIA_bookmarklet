// format-sync 0.1.126: Rb/Tip/Bl/</> live in the "Aa▾" menu and Nr/구분선/유지/Sv in the "⋯" menu (the #548 floating MUI menu). The items are the real buttons:
// same handlers and state; an item that is on is checked, the group button looks active when any item inside is on; a click on an item closes the menu;
// windows opened from an item (ruby / Sv) sit under the group button; outside click / Esc close; the first row fits one line at a narrow width.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="chatlist" style="width:500px"></ul><form id="composer" style="position:fixed;left:20px;bottom:20px;width:300px"><input name="name" value="서술자"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    const bar = page.locator('.ccf-inline-toolbar').first();
    await bar.waitFor({ state: 'attached', timeout: 8000 });
    const group = (name) => bar.locator(`[data-inline-group="${name}"]`);
    const isOpen = (name) => group(name).evaluate((g) => g.getAttribute('data-open') === '1' && getComputedStyle(g.querySelector('.ccf-inline-group-menu')).display !== 'none');
    // closed: the items are not shown; the first row (B I U S Aa▾ ⋯) is one line at 300px
    assert.equal(await bar.locator('[data-inline-command="ruby"]').isVisible(), false);
    const tops = await bar.evaluate((t) => ['bold', 'italic', 'underline', 'strike'].map((c) => t.querySelector(`[data-inline-command="${c}"]`)).concat([...t.querySelectorAll('[data-inline-group="deco"] > [data-inline-group-toggle], [data-inline-group="extra"] > [data-inline-group-toggle]')]).map((b) => Math.round(b.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, 'first row on one line: ' + tops);
    assert.deepEqual(await bar.locator('[data-inline-group="deco"] > [data-inline-group-toggle], [data-inline-group="extra"] > [data-inline-group-toggle]').allTextContents(), ['Aa▾', '⋯']);
    // open Aa▾: the four items, inside the viewport; outside click closes; Esc closes
    await group('deco').locator('[data-inline-group-toggle]').click();
    assert.equal(await isOpen('deco'), true);
    assert.deepEqual(await group('deco').locator('[role=menuitem]').evaluateAll((l) => l.map((b) => b.getAttribute('data-inline-command'))), ['ruby', 'tooltip', 'blur', 'code']);
    const box = await group('deco').locator('.ccf-inline-group-menu').boundingBox();
    assert(box.y >= 0 && box.y + box.height <= 700 && box.x >= 0 && box.x + box.width <= 900, 'menu inside the viewport ' + JSON.stringify(box));
    await page.mouse.click(700, 100);
    assert.equal(await isOpen('deco'), false, 'outside click closes');
    await group('deco').locator('[data-inline-group-toggle]').click(); await page.keyboard.press('Escape');
    assert.equal(await isOpen('deco'), false, 'Esc closes');
    // ⋯ → 구분선: toggles on, the menu closes, the group button looks active, the item is checked
    const idleBg = await group('extra').locator('[data-inline-group-toggle]').evaluate((b) => getComputedStyle(b).backgroundColor);
    await group('extra').locator('[data-inline-group-toggle]').click();
    await group('extra').locator('[data-inline-command="break"]').click();
    assert.equal(await isOpen('extra'), false, 'an item click closes the menu');
    assert.equal(await bar.locator('[data-inline-command="break"]').evaluate((b) => b.classList.contains('active')), true, 'break on');
    assert.notEqual(await group('extra').locator('[data-inline-group-toggle]').evaluate((b) => getComputedStyle(b).backgroundColor), idleBg, 'group button active');
    await group('extra').locator('[data-inline-group-toggle]').click();
    assert.equal(await group('extra').locator('[data-inline-command="break"]').evaluate((b) => getComputedStyle(b, '::after').content), '"✓"', 'checked item');
    // 유지 through the menu: same state as before (keep on)
    await group('extra').locator('[data-inline-command="keep"]').click();
    assert.equal(await bar.locator('[data-inline-command="keep"]').evaluate((b) => b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true'), true, 'keep on');
    // 구분선 off again; keep still makes the group active
    await group('extra').locator('[data-inline-group-toggle]').click(); await group('extra').locator('[data-inline-command="break"]').click();
    assert.notEqual(await group('extra').locator('[data-inline-group-toggle]').evaluate((b) => getComputedStyle(b).backgroundColor), idleBg, 'still active (keep)');
    await group('extra').locator('[data-inline-group-toggle]').click(); await group('extra').locator('[data-inline-command="keep"]').click();
    assert.equal(await group('extra').locator('[data-inline-group-toggle]').evaluate((b) => getComputedStyle(b).backgroundColor), idleBg, 'nothing on: idle');
    // Sv opens the preset window under the group button
    await page.locator('#composer textarea').click();
    await group('extra').locator('[data-inline-group-toggle]').click(); await group('extra').locator('[data-inline-command="style-clipboard"]').click();
    await page.waitForTimeout(200);
    const anchor = await group('extra').locator('[data-inline-group-toggle]').boundingBox();
    const sv = await bar.locator('.ccf-inline-popover.open').boundingBox();
    assert(sv && sv.width > 0, 'Sv window open');
    assert(Math.abs(sv.y - (anchor.y + anchor.height + 6)) <= 2 || Math.abs(sv.y + sv.height - (anchor.y - 6)) <= 2, 'Sv window next to the group button ' + JSON.stringify({ sv, anchor }));
    await page.keyboard.press('Escape'); await page.mouse.click(700, 100);
    // Rb opens the ruby box (not at the top-left corner)
    await page.locator('#composer textarea').fill('글자'); await page.locator('#composer textarea').evaluate((t) => t.setSelectionRange(0, 2));
    await group('deco').locator('[data-inline-group-toggle]').click(); await group('deco').locator('[data-inline-command="ruby"]').click();
    await page.waitForTimeout(200);
    const rb = await bar.locator('.ccf-inline-popover.open').boundingBox();
    assert(rb && rb.y > 100, 'ruby box positioned by the group button ' + JSON.stringify(rb));
    assert.deepEqual(errors, []);
    console.log('format groups PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
