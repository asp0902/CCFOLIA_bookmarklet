// format-sync 0.1.150: the Aa / ⋯ menus are gone: their nine buttons are a second row of the bar (same order, same handlers and state); the font menu (가) stays.
// Two quick cut-in buttons take their place next to the send button ([button][warning][send], equal width): each sends the text chosen for it from the current speaker and tab,
// keeps what was typed, and opens its chooser (room cut-ins + free text, saved per room) when nothing is chosen or on right-click.
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
      window.__sent = [];
      document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); const t = document.querySelector('#composer textarea'); window.__sent.push(t.value); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ''); });
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: ['e1', 'e2'], entities: { e1: { name: '@버튼' }, e2: { name: '경보' } } } } };
      window.__state = state;
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    const bar = page.locator('.ccf-inline-toolbar').first();
    await bar.waitFor({ state: 'attached', timeout: 8000 });
    // the bar: first row as before, the nine former menu items on the second row, in the menus' order; no Aa / ⋯
    const rows = await bar.evaluate((t) => { const shown = [...t.children].filter((c) => c.offsetParent && c.getBoundingClientRect().width > 0 && !c.classList.contains('ccf-quick-cutins') && !c.classList.contains('ccf-inline-row-break')); const tops = [...new Set(shown.map((c) => Math.round(c.getBoundingClientRect().top)))].sort((a, b) => a - b); return tops.map((top) => shown.filter((c) => Math.round(c.getBoundingClientRect().top) === top).map((c) => c.getAttribute('data-inline-command') || c.getAttribute('data-inline-group') || (c.matches('[data-inline-size]') ? 'size' : c.matches('.ccf-color-tool') ? 'color' : c.className))); });
    const flat = rows.flat();
    assert.deepEqual(flat, ['bold', 'italic', 'underline', 'strike', 'align', 'align', 'align', 'color', 'color', 'size', 'font', 'ruby', 'tooltip', 'blur', 'code', 'narration', 'break', 'keep', 'style-clipboard', 'paren-gray'], 'order');
    assert(flat.indexOf('ruby') > 0 && rows.findIndex((r) => r.includes('ruby')) > rows.findIndex((r) => r.includes('font')), 'the former menu items start a new row ' + JSON.stringify(rows));
    assert.equal(await page.locator('[data-inline-group="deco"], [data-inline-group="extra"]').count(), 0, 'no Aa / ⋯');
    assert.equal(/placeInlineGroupsInDiceRow|ccf-groups-in-dice-row|ccf-gi-key/.test(source), false, 'the group placement code is gone');
    for (const w of [340, 300, 280]) { await page.evaluate((w) => { document.getElementById('composer').style.width = w + 'px'; }, w); await page.waitForTimeout(60); assert.equal(await bar.evaluate((t) => t.scrollWidth <= t.clientWidth + 1), true, 'no sideways overflow at ' + w); }
    await page.evaluate(() => { document.getElementById('composer').style.width = '300px'; }); await page.waitForTimeout(120);
    // the second-row buttons work as the menu items did
    await bar.locator('[data-inline-command="break"]').click();
    assert.equal(await bar.locator('[data-inline-command="break"]').evaluate((b) => b.classList.contains('active')), true, 'break on');
    await bar.locator('[data-inline-command="break"]').click();
    await page.locator('#composer textarea').click(); await bar.locator('[data-inline-command="paren-gray"]').click();
    // 0.1.168: 회색괄호 is on by default, so the first click turns it off
    assert.equal(await bar.locator('[data-inline-command="paren-gray"]').evaluate((b) => !b.classList.contains('active') && b.getAttribute('aria-pressed') === 'false'), true, '() off');
    await bar.locator('[data-inline-command="paren-gray"]').click();
    await page.locator('#composer textarea').click(); await bar.locator('[data-inline-command="style-clipboard"]').click(); await page.waitForTimeout(200);
    assert((await bar.locator('.ccf-inline-popover.open').boundingBox())?.width > 0, 'Sv window opens'); await page.keyboard.press('Escape'); await page.mouse.click(700, 100);
    // [button][warning][send]: equal (≤1px), right before send, same height, clear of the dice
    const three = () => page.evaluate(() => { const r = (el) => el.getBoundingClientRect(); const q = [...document.querySelectorAll('.ccf-quick-cutin')].map(r), s = r(document.querySelector('#composer button[type="submit"]')), die = r(document.querySelector('#composer button[aria-label="D4"]')); return { w: [...q.map((x) => x.width), s.width], h: [...q.map((x) => x.height), s.height], gaps: [Math.round(s.left - q[1].right), Math.round(q[1].left - q[0].right)], clear: q[0].left >= die.right }; });
    const equal = (v) => Math.max(...v) - Math.min(...v) <= 1;
    await page.waitForTimeout(80); const t3 = await three();
    assert(equal(t3.w) && equal(t3.h) && t3.gaps.every((g) => g === 2) && t3.clear, 'equal buttons next to send ' + JSON.stringify(t3));
    // nothing chosen: a click opens the chooser (room cut-ins + free text); choose "@버튼"
    const quick = page.locator('.ccf-quick-cutin[data-quick="0"]');
    assert.match(await quick.getAttribute('data-ccf-tip'), /정해지지 않음/);
    await quick.click();
    assert.deepEqual(await page.locator('.ccf-quick-menu [role=menuitem]').allTextContents(), ['@버튼', '경보']);
    await page.locator('.ccf-quick-menu [role=menuitem]', { hasText: '@버튼' }).click();
    assert.equal(await page.locator('.ccf-quick-menu').count(), 0, 'the chooser closes');
    assert.match(await quick.getAttribute('data-ccf-tip'), /버튼 컷인: @버튼/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-quick-cutin-v1:test'))[0]), { text: '@버튼', fromList: true }, 'saved for this room');
    // a click sends it once; what was typed stays
    await page.locator('#composer textarea').fill('쓰던 글');
    await quick.click(); await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.__sent), ['@버튼']);
    assert.equal(await page.locator('#composer textarea').inputValue(), '쓰던 글', 'the typed text is kept');
    // right-click on the warning button: free text
    await page.locator('.ccf-quick-cutin[data-quick="1"]').click({ button: 'right' });
    await page.locator('.ccf-quick-menu input').fill('주의하세요'); await page.locator('.ccf-quick-menu input').press('Enter');
    assert.match(await page.locator('.ccf-quick-cutin[data-quick="1"]').getAttribute('data-ccf-tip'), /경고 컷인: 주의하세요/);
    // the warning button holds several: add '@버튼' from the list (the chooser stays open for more), then a click offers both and sends the pick once
    await page.locator('.ccf-quick-menu [role=menuitem]', { hasText: '@버튼' }).click();
    assert.equal(await page.locator('.ccf-quick-menu').count(), 1, 'still open to add more');
    await page.keyboard.press('Escape'); await page.mouse.click(700, 100);
    const warn = page.locator('.ccf-quick-cutin[data-quick="1"]');
    assert.match(await warn.getAttribute('data-ccf-tip'), /경고 컷인 2개: 주의하세요, @버튼/);
    await warn.click();
    assert.deepEqual(await page.locator('.ccf-quick-menu [role=menuitem]').allTextContents(), ['주의하세요', '@버튼']);
    await page.locator('.ccf-quick-menu [role=menuitem]', { hasText: '@버튼' }).click(); await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.__sent), ['@버튼', '@버튼'], 'the pick is sent once');
    // right click: remove one; with one left a click sends at once
    await warn.click({ button: 'right' });
    await page.locator('.ccf-quick-menu button[aria-label="주의하세요 지우기"]').click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-quick-cutin-v1:test'))[1].map((v) => v.text)), ['@버튼']);
    await page.keyboard.press('Escape'); await page.mouse.click(700, 100);
    await warn.click(); await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.__sent), ['@버튼', '@버튼', '@버튼'], 'one left: sent without a menu');
    assert.equal(await page.locator('.ccf-quick-menu').count(), 0);
    // an old saved single value reads as a one-item list
    await page.evaluate(() => localStorage.setItem('ccf-quick-cutin-v1:test', JSON.stringify([{ text: '@버튼', fromList: true }, { text: '옛 경고', fromList: false }])));
    await warn.hover(); assert.match(await page.evaluate(() => { const b = document.querySelector('.ccf-quick-cutin[data-quick="1"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return b.dataset.ccfTip; }), /경고 컷인: 옛 경고/);
    await page.waitForTimeout(400); assert.equal((await page.evaluate(() => window.__sent)).at(-1), '옛 경고');
    // a chosen cut-in removed from the room: dimmed, a click opens the chooser instead of sending
    await page.evaluate(() => { const fx = window.__state.entities.roomEffects; window.__state.entities.roomEffects = { ids: ['e2'], entities: { e2: fx.entities.e2 } }; });
    await quick.click(); await page.waitForTimeout(150);
    assert.equal(await quick.evaluate((b) => b.classList.contains('ccf-quick-gone')), true, 'dimmed');
    assert.equal(await page.locator('.ccf-quick-menu').count(), 1, 'chooser instead of sending'); assert.equal((await page.evaluate(() => window.__sent)).length, 4, 'nothing more sent');
    assert.deepEqual(errors, []);
    console.log('format groups PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
