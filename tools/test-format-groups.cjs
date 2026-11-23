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
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="chatlist" style="width:500px"></ul><form id="composer" style="position:fixed;left:20px;bottom:20px;width:300px"><input name="name" value="서술자"><div style="display:flex;align-items:center"><button type="button" aria-label="D4" style="width:36px;height:36px">D4</button><button type="submit" style="margin-left:auto;height:31px">전송</button></div><textarea name="text" rows="3" style="width:100%"></textarea></form></body>' }));
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
    // 0.1.138 Aa·⋯ left the bar (fixed next to the send button of the dice row): the bar is B I U S / align ×3 / colors / size / 가▾
    assert.deepEqual(order, ['bold', 'italic', 'underline', 'strike', 'align', 'align', 'align', 'color', 'color', 'size', 'font'], 'order');
    const lines = async (w) => { await page.evaluate((w) => { document.getElementById('composer').style.width = w + 'px'; }, w); await page.waitForTimeout(50); return bar.evaluate((t) => ({ rows: new Set([...t.children].filter((c) => c.offsetParent && c.getBoundingClientRect().width > 0).map((c) => Math.round(c.getBoundingClientRect().top))).size, overflow: t.scrollWidth > t.clientWidth + 1 })); };
    const rowsAt = {}; for (const w of [280, 300, 320, 340, 360, 376, 408]) rowsAt[w] = (await lines(w)).rows;
    console.log('rows by width', JSON.stringify(rowsAt));
    for (const w of [360, 376, 408]) assert.deepEqual(await lines(w), { rows: 1, overflow: false }, 'one line at ' + w);
    for (const w of [280, 340]) assert.deepEqual(await lines(w), { rows: 2, overflow: false }, 'two lines at ' + w);
    await lines(300);
    // Aa ⋯ [전송]: right of ⋯ = send left - 4, Aa right before ⋯, same vertical centre as the send button
    const slot = await page.evaluate(() => { const r = (el) => el.getBoundingClientRect(); const s = r(document.querySelector('#composer button[type="submit"]')), e = r(document.querySelector('[data-inline-group="extra"]')), d = r(document.querySelector('[data-inline-group="deco"]')); return { send: [s.left, s.top + s.height / 2], extra: [e.left, e.right, e.top + e.height / 2], deco: [d.left, d.right, d.top + d.height / 2] }; });
    assert(Math.abs(slot.extra[1] - (slot.send[0] - 2)) <= 1 && Math.abs(slot.deco[1] - (slot.extra[0] - 2)) <= 1, 'Aa ⋯ right before the send button ' + JSON.stringify(slot));
    // 0.1.143 [Aa][⋯][전송] are equal (≤1px), same height; a narrow row shrinks them together, never over the dice, also with a long send label
    const three = () => page.evaluate(() => { const r = (el) => el.getBoundingClientRect(); const send = document.querySelector('#composer button[type="submit"]'), list = [r(document.querySelector('[data-inline-group="deco"] > button')), r(document.querySelector('[data-inline-group="extra"] > button')), r(send)], die = r(document.querySelector('#composer button[aria-label="D4"]')); return { w: list.map((x) => x.width), h: list.map((x) => x.height), top: list.map((x) => x.top), clearOfDice: list[0].left >= die.right, oneLine: send.scrollWidth <= send.clientWidth + 1 }; });
    const equal = (v) => Math.max(...v) - Math.min(...v) <= 1;
    await page.waitForTimeout(80); let t3 = await three();
    assert(equal(t3.w) && equal(t3.h) && equal(t3.top) && t3.clearOfDice, 'equal buttons ' + JSON.stringify(t3));
    await page.evaluate(() => { document.querySelector('#composer button[type="submit"]').textContent = 'Send'; document.getElementById('composer').style.width = '150px'; }); await page.waitForTimeout(120); t3 = await three();
    assert(equal(t3.w) && t3.w[0] >= 24 && t3.clearOfDice && t3.oneLine, 'narrow row, Send label ' + JSON.stringify(t3));
    await page.evaluate(() => { document.querySelector('#composer button[type="submit"]').textContent = '전송'; document.getElementById('composer').style.width = '300px'; }); await page.waitForTimeout(120);
    assert(Math.abs(slot.extra[2] - slot.send[1]) <= 1 && Math.abs(slot.deco[2] - slot.send[1]) <= 1, 'same vertical centre ' + JSON.stringify(slot));
    // 0.1.140 inside a moved (transformed) container — like the extra panel sliding in — the buttons still end up next to the send button, also after the move ends
    await page.evaluate(() => { const f = document.getElementById('composer'); f.style.transition = 'transform .2s'; f.style.transform = 'translateX(60px)'; });
    await page.waitForTimeout(500);
    const slot2 = await page.evaluate(() => { const r = (el) => el.getBoundingClientRect(); const s = r(document.querySelector('#composer button[type="submit"]')), e = r(document.querySelector('[data-inline-group="extra"]')); return { send: s.left, extra: e.right }; });
    assert(Math.abs(slot2.extra - (slot2.send - 2)) <= 1, 'still next to the send button after a transform move ' + JSON.stringify(slot2));
    await page.evaluate(() => { const f = document.getElementById('composer'); f.style.transition = ''; f.style.transform = ''; }); await page.waitForTimeout(200);

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
