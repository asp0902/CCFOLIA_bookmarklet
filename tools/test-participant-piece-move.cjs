// Participant page: dragging a movable piece sends one pieces/move command in the piece's own unit; locked pieces pan instead.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const sent = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/pieces/move')) { sent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const img = 'https://storage.ccfolia-cdn.net/a.png';
  await page.evaluate(img => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [{ id: 'i1', x: 0, y: 0, z: 1, angle: 0, width: 2, height: 2, imageUrl: img }, { id: 'i2', locked: true, x: 5, y: 5, z: 1, angle: 0, width: 2, height: 2, imageUrl: img }],
      characters: [{ id: 'c1', name: 'A', x: 48, y: 24, z: 2, angle: 0, width: 4, height: 4, iconUrl: img, status: [] }] });
  }, img);
  const drag = async (sel, dx, dy) => {
    const b = await page.locator(sel).boundingBox();
    const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + dx / 2, sy + dy / 2); await page.mouse.move(sx + dx, sy + dy); await page.mouse.up(); await page.waitForTimeout(200);
  };
  const unit = await page.evaluate(() => view.unit);
  await drag('img[data-id="i1"]', unit * 3, unit * 2);
  await drag('img[data-id="c1"]', unit * 2, 0);
  assert.equal(await page.locator('img[data-id="i2"]').count(), 0, 'locked piece is not draggable');
  await page.waitForTimeout(300);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { kind: 'item', id: 'i1', x: 3, y: 2 });
  assert.deepEqual(sent[1], { kind: 'character', id: 'c1', x: 96, y: 24 }); // characters: px at zoom 1, 24px = 1 cell
  await browser.close();
  console.log('participant piece move PASS');
})().catch(error => { console.error(error); process.exit(1); });
