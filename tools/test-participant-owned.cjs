// After a reload the person's own dice are theirs again: the first /mine request may fail or come late, it is asked for again and the dice become selectable (no redraw lost).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  let mineCalls = 0;
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/mine')) { mineCalls += 1; return mineCalls <= 2 ? route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }) : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ member: 'abc', characters: [], owned: ['d1'] }) }); }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderState({ roomTitle: 't', gmOnline: true, messages: [], channels: [], scene: { fieldWidth: 40, fieldHeight: 20, items: [], markers: [], characters: [], diceSymbols: [{ id: 'd1', x: 0, y: 0, width: 2, height: 2, faces: 6, value: 3, closed: false }] } });
  });
  assert.equal(await page.locator('.scene-die.mine').count(), 0, 'before the list arrives nothing is known');
  await page.waitForFunction(() => document.querySelectorAll('.scene-die.mine').length === 1, null, { timeout: 15000 });
  assert(mineCalls >= 3, 'asked again after the failures');
  const info = await page.evaluate(() => JSON.parse(window.playroomDiag()).mineInfo);
  assert.equal(info.owned, 1); assert.equal(info.member, 'abc');
  await browser.close();
  console.log('participant owned PASS');
})().catch(error => { console.error(error); process.exit(1); });
