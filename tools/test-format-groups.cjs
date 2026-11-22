// format-sync 0.1.126: Rb/Tip/Bl/</> live in the "Aa▾" menu and Nr/구분선/유지/Sv in the "⋯" menu (the #548 floating MUI menu). The items are the real buttons:
// same handlers and state; an item that is on is checked, the group button looks active when any item inside is on; a click on an item closes the menu;
// windows opened from an item (ruby / Sv) sit under the group button; outside click / Esc close; order B I U S / align / colors / size / 가▾ / Aa▾ / ⋯, one line from 420px, never overflowing.
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
    // 0.1.132 order: B I U S / align ×3 / colors / size / 가▾ / Aa▾ / ⋯ ; natural wrap: one line from 420px, two lines below, never overflowing
    const order = await bar.evaluate((t) => [...t.children].filter((c) => c.offsetParent && c.getBoundingClientRect().width > 0).map((c) => c.getAttribute('data-inline-command') || c.getAttribute('data-inline-group') || (c.matches('[data-inline-size]') ? 'size' : c.matches('.ccf-color-tool') ? 'color' : c.className)));
    assert.deepEqual(order, ['bold', 'italic', 'underline', 'strike', 'align', 'align', 'align', 'color', 'color', 'size', 'font', 'deco', 'extra'], 'order');
    const lines = async (w) => { await page.evaluate((w) => { document.getElementById('composer').style.width = w + 'px'; }, w); await page.waitForTimeout(50); return bar.evaluate((t) => ({ rows: new Set([...t.children].filter((c) => c.offsetParent && c.getBoundingClientRect().width > 0).map((c) => Math.round(c.getBoundingClientRect().top))).size, overflow: t.scrollWidth > t.clientWidth + 1 })); };
    for (const w of [280, 340, 376, 407]) assert.deepEqual(await lines(w), { rows: 2, overflow: false }, 'two lines at ' + w);
    for (const w of [408, 560]) assert.deepEqual(await lines(w), { rows: 1, overflow: false }, 'one line at ' + w);
    await lines(300);

    assert.deepEqual(await bar.locator('[data-inline-group="deco"] > [data-inline-group-toggle], [data-inline-group="extra"] > [data-inline-group-toggle]').allTextContents(), ['Aa', '⋯']);
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
    // 0.1.128: () (parentheses gray) is the last item of ⋯; no () button left on the bar; on -> checked + ⋯ active; off -> idle
    assert.deepEqual(await group('extra').locator('[role=menuitem]').evaluateAll((l) => l.map((b) => b.getAttribute('data-inline-command'))), ['narration', 'break', 'keep', 'style-clipboard', 'paren-gray']);
    assert.equal(await bar.evaluate((t) => [...t.querySelectorAll('[data-inline-command="paren-gray"]')].filter((b) => !b.closest('.ccf-inline-group-menu')).length), 0, 'no () on the bar');
    await page.locator('#composer textarea').click();
    await group('extra').locator('[data-inline-group-toggle]').click(); await group('extra').locator('[data-inline-command="paren-gray"]').click();
    assert.equal(await isOpen('extra'), false);
    assert.equal(await bar.locator('[data-inline-command="paren-gray"]').evaluate((b) => b.classList.contains('active') && b.getAttribute('aria-pressed') === 'true'), true, '() on');
    assert.notEqual(await group('extra').locator('[data-inline-group-toggle]').evaluate((b) => getComputedStyle(b).backgroundColor), idleBg, '⋯ active with ()');
    await group('extra').locator('[data-inline-group-toggle]').click();
    assert.equal(await group('extra').locator('[data-inline-command="paren-gray"]').evaluate((b) => getComputedStyle(b, '::after').content), '"✓"');
    await group('extra').locator('[data-inline-command="paren-gray"]').click();
    assert.equal(await group('extra').locator('[data-inline-group-toggle]').evaluate((b) => getComputedStyle(b).backgroundColor), idleBg, '() off: idle');
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
