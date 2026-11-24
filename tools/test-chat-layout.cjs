const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// theme-switcher 0.2.45 (theme 4단계): the dice buttons (D4~D100) can be hidden (theme popup 채팅 section, default off); a grip on the chat drawer's left edge sets its width,
// kept in the browser, a double-click goes back to the default. 0.2.69: the input height grip is removed (user decision): no grip; a height saved before is cleared, not applied.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/chat grips failed|tryInit threw/.test(m.text())) errors.push(m.text()); }); // 0.2.46: no TDZ error at start-up
    const dice = ['D4', 'D6', 'D8', 'D10', 'D12', 'D20', 'D100'].map((d) => `<button type="button" aria-label="${d}">${d}</button>`).join('');
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><body style="margin:0;background:#222;color:#fff"><div style="display:flex;height:100vh"><main style="flex:1">map</main>
      <div class="MuiDrawer-root MuiDrawer-docked" style="width:376px;flex:0 0 auto"><div class="MuiDrawer-paper" style="position:fixed;right:0;top:0;bottom:0;width:376px;background:#333">
      <form style="position:absolute;bottom:0;left:0;right:0"><div class="dicebar">${dice}<button type="submit">전송</button></div>
      <div class="MuiInputBase-root"><textarea name="text" class="MuiInputBase-input MuiInputBase-inputMultiline" style="width:100%;height:auto;min-height:0;box-sizing:border-box" rows="1"></textarea></div></form></div></div></div></body>` }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => localStorage.setItem('ccf-chat-input-height', '300')); // saved by an older version
    await page.addScriptTag({ content: source });
    await page.waitForSelector('.ccf-chat-grip', { state: 'attached', timeout: 6000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.ccf-input-grip').count(), 0, 'no input height grip');
    assert.equal(await page.evaluate(() => localStorage.getItem('ccf-chat-input-height')), null, 'the old saved height is cleared');
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-ccf-input-h')), false, 'and not applied');
    await page.waitForSelector('.ccf-chat-grip', { state: 'attached' });
    const look = () => page.evaluate(() => ({ dice: [...document.querySelectorAll('form button[aria-label^="D"]')].filter((b) => getComputedStyle(b).display !== 'none').length, send: getComputedStyle(document.querySelector('button[type=submit]')).display !== 'none', inputH: Math.round(document.querySelector('textarea').getBoundingClientRect().height), chatW: Math.round(document.querySelector('.MuiDrawer-paper').getBoundingClientRect().width) }));
    const base = await look();
    assert.equal(base.dice, 7, 'default: the dice buttons are there'); assert.equal(base.chatW, 376);
    // hide the dice row from the theme popup
    await page.locator('#ccf-theme-switcher-panel [data-layout-pref="ccf-hide-dice-row"]').evaluate((b) => { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); });
    let now = await look();
    assert.deepEqual([now.dice, now.send], [0, true], 'dice hidden, the send button stays');
    const drag = async (sel, dx, dy) => { const b = await page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2); await page.mouse.move(x + dx, y + dy); await page.mouse.up(); };
    // drag the chat's left edge left by 100px
    await drag('.ccf-chat-grip', -100, 0);
    now = await look();
    assert.equal(now.chatW, 476, 'chat wider by 100');
    // kept after a reload
    await page.reload(); await page.addScriptTag({ content: source }); await page.waitForSelector('.ccf-chat-grip', { state: 'attached' }); await page.waitForTimeout(200);
    now = await look();
    assert.deepEqual([now.dice, now.chatW], [0, 476], 'kept');
    // double-click = default
    await page.locator('.ccf-chat-grip').dblclick();
    now = await look();
    assert.deepEqual([now.chatW, now.inputH], [376, base.inputH], 'back to the default (the input keeps its own height)');
    assert.deepEqual(errors, []);
    console.log('chat layout PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
