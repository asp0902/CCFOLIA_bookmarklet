// Participant field, as CCFOLIA's app code draws it: offset by trunc(size/2) cells, background image then foreground image (fieldObjectFit), default grid + outline without images, grid overlay with displayGrid.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const img = n => `https://storage.ccfolia-cdn.net/${n}.png`;
  const field = async scene => page.evaluate(scene => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderScene({ items: [], markers: [], characters: [], fieldObjectFit: 'fill', ...scene });
    const f = document.querySelector('#scene-field > div'), cs = getComputedStyle(f), r = f.getBoundingClientRect(), stage = document.getElementById('scene-field').getBoundingClientRect();
    return { unit: view.unit, left: Math.round((r.left - stage.left - stage.width / 2) * 100) / 100, top: Math.round((r.top - stage.top - stage.height / 2) * 100) / 100, w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100,
      z: cs.zIndex, bgImage: cs.backgroundImage.slice(0, 40), outline: cs.outlineStyle + ' ' + cs.outlineWidth, imgs: [...f.querySelectorAll('img')].map(i => i.getAttribute('src') + '|' + i.style.objectFit), kids: f.children.length,
      grid: f.querySelector('div') ? f.querySelector('div').style.backgroundSize : '' };
  }, scene);
  // no image: default grid + outline; an odd size starts trunc(size/2) cells from the centre, not half a cell
  const empty = await field({ fieldWidth: 25, fieldHeight: 15 });
  assert(empty.bgImage.startsWith('linear-gradient'), 'default grid'); assert.equal(empty.outline, 'solid 4px'); assert.equal(empty.kids, 0);
  const near = (x, y) => assert(Math.abs(x - y) < 0.05, `${x} vs ${y}`);
  near(empty.left, -12 * empty.unit); near(empty.top, -7 * empty.unit); near(empty.w, 25 * empty.unit);
  // background then foreground inside the field, no default grid, no outline
  const both = await field({ fieldWidth: 20, fieldHeight: 10, fieldObjectFit: 'contain', backgroundUrl: img('bg'), foregroundUrl: img('fg') });
  assert.deepEqual(both.imgs, [img('bg') + '|contain', img('fg') + '|contain'], 'background image first, foreground image over it');
  assert.equal(both.bgImage, 'none'); assert.equal(both.outline.startsWith('none') || both.outline.includes('0px'), true); assert.equal(both.z, '1', 'below the pieces');
  // foreground only still shows
  assert.deepEqual((await field({ fieldWidth: 20, fieldHeight: 10, foregroundUrl: img('fg') })).imgs, [img('fg') + '|fill']);
  // display grid: an overlay every gridSize cells; the default grid is not drawn on the field itself
  const grid = await field({ fieldWidth: 20, fieldHeight: 10, displayGrid: true, gridSize: 2 });
  assert.equal(grid.bgImage, 'none'); assert.equal(grid.kids, 1); assert.equal(grid.grid, `${grid.unit * 2}px ${grid.unit * 2}px`);
  // a character carries its name under the token (centred, 8 native px above the token's bottom edge), a marker or item does not
  const label = await page.evaluate(img => {
    renderScene({ fieldWidth: 20, fieldHeight: 10, items: [{ id: 'i', x: 0, y: 0, z: 1, angle: 0, width: 2, height: 2, imageUrl: img }], markers: [], characters: [{ id: 'c', name: '드와이프', x: 48, y: 24, z: 0, angle: 0, width: 4, height: 4, iconUrl: img, status: [] }] });
    const token = document.querySelector('img[data-id="c"]').getBoundingClientRect(), name = document.querySelector('[data-label="c"]'), r = name.getBoundingClientRect(), cs = getComputedStyle(name);
    return { text: name.textContent, dx: r.left + r.width / 2 - (token.left + token.width / 2), dy: r.top - (token.bottom - 8 * view.unit / 24), size: cs.fontSize, weight: cs.fontWeight, color: cs.color, labels: document.querySelectorAll('[data-label]').length, shadows: cs.textShadow.split('rgb(').length - 1, unit: view.unit };
  }, img('a'));
  assert.equal(label.text, '드와이프'); assert(Math.abs(label.dx) < 1, `centred ${label.dx}`); assert(Math.abs(label.dy) < 1, `8px up ${label.dy}`);
  assert.equal(label.weight, '700'); assert.equal(label.color, 'rgb(0, 0, 0)'); assert.equal(label.shadows, 8, 'outline in eight directions'); assert.equal(label.labels, 1);
  assert(Math.abs(parseFloat(label.size) - 12 * label.unit / 24) < 0.05, 'scales with the zoom');
  // CCFOLIA's own view: a cell is 24px times the scale (no fit-to-window); the GM's scale and position are the first view only, taken once
  const view0 = await page.evaluate(() => { const room = { fieldWidth: 50, fieldHeight: 30, items: [], markers: [], characters: [] };
    view.zoom = 1; view.x = 0; view.y = 0; view.fromGm = false; view.touched = false;
    renderScene({ ...room, screen: { scale: 0.8, x: 30, y: -12 } }); const first = { zoom: view.zoom, unit: view.unit, x: view.x, y: view.y };
    view.x = 5; renderScene({ ...room, screen: { scale: 1.5, x: 99, y: 99 } }); return { first, afterUpdate: { zoom: view.zoom, x: view.x } }; });
  assert(Math.abs(view0.first.unit - 19.2) < 1e-9); delete view0.first.unit; assert.deepEqual(view0.first, { zoom: 0.8, x: 30, y: -12 }); assert.deepEqual(view0.afterUpdate, { zoom: 0.8, x: 5 }, "later scene updates do not move the participant's own view");
  await browser.close();
  console.log('participant field PASS');
})().catch(error => { console.error(error); process.exit(1); });
