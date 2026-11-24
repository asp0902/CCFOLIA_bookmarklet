// Playroom format bar: the colour boxes open the same picker as the GM page (format-sync 0.1.164) instead of the browser chooser (no OK button):
// square boxes, one preview, colour area + hue bar, choosing only previews, [확인] wraps the selection in the colour marker, Esc / outside cancels, recent colours kept.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    await page.evaluate(() => { const r = document.getElementById('room'); r.inert = false; r.removeAttribute('aria-hidden'); const g = document.getElementById('gate'); if (g) g.style.display = 'none'; });
    const box = page.locator('.fmt-color input[type=color]').first();
    await box.waitFor({ state: 'attached' });
    await page.evaluate(() => { const i = document.getElementById('chat-input'); i.value = '빨강 글'; i.setSelectionRange(0, 2); });
    const prevented = await box.evaluate((i) => { let p = null; document.addEventListener('click', (e) => { p = e.defaultPrevented; }, { once: true }); i.click(); return p; });
    assert.equal(prevented, true, 'the browser chooser is not opened');
    const pop = page.locator('#color-pick');
    assert.equal(await pop.count(), 1);
    assert.equal(await pop.locator('input[type=color]').count(), 0);
    const sq = await pop.locator('.cp-cur').evaluate((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    assert.equal(sq[0], sq[1], 'square ' + sq);
    assert.equal(await pop.evaluate((e) => [...e.querySelectorAll('*')].every((c) => c.getBoundingClientRect().right <= e.getBoundingClientRect().right + 0.5)), true, 'nothing sticks out');
    const sv = await pop.locator('.cp-sv').boundingBox();
    await page.mouse.move(sv.x + sv.width - 2, sv.y + 2); await page.mouse.down(); await page.mouse.move(sv.x + sv.width / 2, sv.y + sv.height / 2); await page.mouse.up();
    assert.equal(await pop.count(), 1, 'stays while dragging');
    assert.equal(await page.inputValue('#chat-input'), '빨강 글', 'not applied while choosing');
    await pop.locator('.cp-hex').fill('#ff0000');
    await pop.locator('[data-ok]').click();
    assert.equal(await pop.count(), 0);
    assert.equal(await page.inputValue('#chat-input'), '{c:#ff0000|빨강|} 글', 'OK wraps the selection');
    // recent colour, Esc cancels
    await box.click();
    assert.deepEqual(await page.locator('#color-pick .cp-sw').evaluateAll((s) => s.map((e) => e.dataset.c)), ['#ff0000']);
    const sw = await page.locator('#color-pick .cp-sw').first().evaluate((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    assert.equal(sw[0], sw[1]);
    await page.keyboard.press('Escape'); assert.equal(await pop.count(), 0);
    // the theme panel's colour fields are left alone
    assert.match(fs.readFileSync(path.join(dir, 'participant.js'), 'utf8'), /t\.type !== "color" \|\| !t\.closest\("\.fmt-color"\)/);
    assert.deepEqual(errors, []);
    console.log('participant color pick PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
