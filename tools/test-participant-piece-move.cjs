// Participant page: dragging a movable piece sends one pieces/move command in the piece's own unit; locked pieces pan instead.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const sent = [], statusSent = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/status/set')) { statusSent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); }
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
      characters: [{ id: 'c1', name: 'A', x: 48, y: 24, z: 2, angle: 0, width: 4, height: 4, iconUrl: img, status: [{ label: 'HP', value: 7, max: 10 }] }] });
  }, img);
  const drag = async (sel, dx, dy) => {
    const b = await page.locator(sel).boundingBox();
    const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + dx / 2, sy + dy / 2); await page.mouse.move(sx + dx, sy + dy); await page.mouse.up(); await page.waitForTimeout(200);
  };
  const unit = await page.evaluate(() => view.unit);
  await drag('img[data-id="i1"]', unit * 3, unit * 2);
  await drag('img[data-id="c1"]', unit * 2, 0);
  assert.equal(await page.locator('img[data-id="i2"][data-locked="1"]').count(), 1, 'locked piece is marked and cannot be dragged');
  await page.waitForTimeout(300);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { kind: 'item', id: 'i1', x: 3, y: 2 });
  assert.deepEqual(sent[1], { kind: 'character', id: 'c1', x: 96, y: 24 }); // characters: px at zoom 1, 24px = 1 cell
  // speaker select lists the character; clicking a status bar sends status.set
  assert.deepEqual(await page.locator('#speaker option').allTextContents(), ['내 이름', 'A']);
  page.on('dialog', d => d.accept('9'));
  await page.locator('#scene-status .st-bar').click();
  await page.waitForTimeout(200);
  assert.deepEqual(statusSent, [{ characterId: 'c1', index: 0, value: 9 }]);
  // markers and flipped cards are drawn and cannot be moved
  await page.evaluate(img => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill',
    items: [{ id: 'k1', closed: true, locked: true, x: 2, y: 2, z: 1, angle: 0, width: 4, height: 4, imageUrl: img }],
    markers: [{ id: 'mk1', x: 6, y: 2, z: 1, angle: 0, width: 3, height: 3, imageUrl: img }], characters: [] }), img);
  const drawn = await page.evaluate(() => [...document.querySelectorAll('#scene-field img')].map(i => ({ id: i.dataset.id || '', locked: i.dataset.locked || '', w: Math.round(parseFloat(i.style.width)) })));
  assert.equal(drawn.length, 2, 'the marker and the flipped card are both drawn');
  assert(drawn.some(d => d.id === 'k1' && d.locked === '1'), 'a flipped card is locked');
  assert(drawn.some(d => d.id === '' && d.locked === ''), 'a marker has no id and no drag handle');
  const before = sent.length;
  const flippedBox = await page.locator('img[data-id="k1"]').boundingBox();
  await page.mouse.move(flippedBox.x + 10, flippedBox.y + 10); await page.mouse.down(); await page.mouse.move(flippedBox.x + 60, flippedBox.y + 40); await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(sent.length, before, 'dragging a flipped card sends no move');
  // layers: a character (stored z 0) is above an item and a marker (stored z 1), like in CCFOLIA (character 100 + z, others z)
  await page.evaluate(img => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill',
    items: [{ id: 'it', x: 0, y: 0, z: 1, angle: 0, width: 4, height: 4, imageUrl: img }],
    markers: [{ id: 'mk', x: 0, y: 0, z: 1, angle: 0, width: 4, height: 4, imageUrl: img }],
    characters: [{ id: 'ch', name: 'A', x: 0, y: 0, z: 0, angle: 0, width: 4, height: 4, iconUrl: img, status: [] }] }), img);
  const order = await page.evaluate(() => [...document.querySelectorAll('#scene-field img')].map(i => ({ id: i.dataset.id || 'marker', z: Number(i.style.zIndex) })).sort((a, b) => a.z - b.z).map(x => x.id));
  assert.deepEqual(order, ['it', 'marker', 'ch'], 'item, then marker, then the character on top');
  await browser.close();
  console.log('participant piece move PASS');
})().catch(error => { console.error(error); process.exit(1); });
