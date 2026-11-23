// Playroom map, rules read from CCFOLIA 1.37.6: the grid and outline shrink with the zoom (CCFOLIA draws them inside a scaled container);
// a panel's memo is a tooltip and its click action runs (message from the current speaker and tab, link after a question); a turned card keeps both hidden.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..'), dir = path.join(root, 'prototype', 'public-handout-relay', 'public');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert(i >= 0 && j > i, a); return s.slice(i, j); };
const panel = fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const views = vm.runInNewContext(`${between(panel, '  function relayClickAction', '  // 카드 덱(entities.roomDecks')}; ({ relayItemView })`);
const url = (v) => v || '', num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const open = views.relayItemView({ _id: 'a', imageUrl: 'i', memo: '메모', clickAction: { type: 'message', text: '1d6' } }, url, num);
assert.equal(open.memo, '메모'); assert.equal(open.action.text, '1d6');
const closed = views.relayItemView({ _id: 'b', closed: true, coverImageUrl: 'c', imageUrl: 'face', memo: '비밀', clickAction: { type: 'message', text: 'x' } }, url, num);
assert.equal('memo' in closed, false, 'a turned card sends no memo'); assert.equal('action' in closed, false, 'nor its action');
assert.equal(views.relayItemView({ _id: 'h', imageUrl: 'i', visible: false, memo: '숨김' }, url, num), null, 'a hidden panel is not sent');
assert.equal(views.relayItemView({ _id: 'j', imageUrl: 'i', clickAction: { type: 'link', url: 'javascript:alert(1)' } }, url, num).action, null, 'no javascript: link');
const worker = fs.readFileSync(path.join(root, 'prototype/public-handout-relay/cloudflare/worker.mjs'), 'utf8').replace(/\r\n/g, '\n');
const cleanPieceInfo = vm.runInNewContext(`${between(worker, 'const cleanPieceInfo', 'export class')}; cleanPieceInfo`);
assert.equal(cleanPieceInfo({ action: { type: 'link', url: 'javascript:alert(1)' } }).action, undefined, 'the relay refuses it too');
assert.equal(cleanPieceInfo({ action: { type: 'link', url: 'https://example.test/a' } }).action.url, 'https://example.test/a');
const CDN = 'https://storage.ccfolia-cdn.net/p.png';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], posts = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => { const r = route.request(), u = new URL(r.url()); if (u.hostname === 'storage.ccfolia-cdn.net') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>' }); if (u.hostname !== 'relay.test') return route.abort(); if (r.method() === 'POST' && u.pathname.endsWith('/messages')) { posts.push(r.postDataJSON()); return route.fulfill({ contentType: 'application/json', body: '{}' }); } const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.addInitScript(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'id-' + Math.random().toString(16).slice(2); }); // http test address
    await page.goto('http://relay.test/#room=x');
    const scene = (extra = {}) => ({ fieldWidth: 20, fieldHeight: 10, fieldObjectFit: 'fill', displayGrid: true, gridSize: 1, items: [], markers: [], characters: [], media: null, sound: null, ...extra });
    await page.evaluate((s) => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; localStorage.removeItem('capybara-screen-scale'); renderScene(s); }, scene());
    const grid = async (zoom) => page.evaluate((zoom) => { view.zoom = zoom; renderScene(); const f = [...document.querySelectorAll('#scene-field > div')].find((n) => n.style.outlineStyle === 'solid'), g = f.querySelector('div'); return { line: g.style.backgroundImage.match(/\) ([\d.]+)px/)[1], outline: f.style.outlineWidth, left: g.style.left, transform: g.style.transform }; }, zoom);
    assert.deepEqual(await grid(1), { line: '1', outline: '4px', left: '-1px', transform: 'scale(1)' }, 'zoom 1');
    assert.deepEqual(await grid(0.5), { line: '1.8', outline: '2px', left: '-0.5px', transform: 'scale(0.5)' }, 'zoom .5: a 1.8px line in a scaled layer, as CCFOLIA');
    assert.deepEqual(await grid(0.25), { line: '2.6', outline: '1px', left: '-0.25px', transform: 'scale(0.25)' }, 'zoom .25: a 2.6px line in a scaled layer');
    await page.evaluate(() => { view.zoom = 1; });
    // tooltip under the panel, click sends the message as it is
    const items = [{ id: 'p', x: -2, y: -2, z: 1, angle: 0, width: 4, height: 4, imageUrl: CDN, locked: true, memo: '패널 메모', action: { type: 'message', text: '1d100 판정' } }, { id: 'l', x: 4, y: -2, z: 1, angle: 0, width: 2, height: 2, imageUrl: CDN, action: { type: 'link', url: 'https://example.test/a' } }];
    const markers = [{ id: 'mk', x: -8, y: -2, z: 1, angle: 0, width: 2, height: 2, imageUrl: CDN, memo: '마커 글' }];
    await page.evaluate((s) => renderScene(s), scene({ items, markers }));
    const p = page.locator('img[data-id="p"]');
    await p.hover();
    assert.equal(await page.locator('.piece-tip').textContent(), '패널 메모'); assert.equal(await page.locator('.piece-tip').isVisible(), true);
    const place = await page.evaluate(() => { const t = document.querySelector('.piece-tip').getBoundingClientRect(), b = document.querySelector('img[data-id="p"]').getBoundingClientRect(); return [Math.round(t.top - b.bottom), Math.abs((t.left + t.right) / 2 - (b.left + b.right) / 2) <= 1]; });
    assert.deepEqual(place, [14, true]);
    assert.deepEqual(await page.locator('.piece-tip').evaluate((n) => { const c = getComputedStyle(n); return [c.backgroundColor, c.fontSize, c.fontWeight, c.whiteSpace, c.boxShadow !== 'none']; }), ['rgb(22, 22, 22)', '12px', '500', 'pre-wrap', true], "CCFOLIA's tooltip look");
    assert.equal(await p.evaluate((n) => getComputedStyle(n).cursor), 'pointer');
    await page.evaluate(() => { chatInput.value = '쓰던 글'; }).catch(() => {});
    await p.click(); await page.waitForTimeout(80);
    assert.equal(posts.length, 1); assert.equal(posts[0].text, '1d100 판정', 'sent exactly');
    assert.equal(posts[0].channel, await page.evaluate(() => activeChannel));
    await p.click(); await page.waitForTimeout(40); assert.equal(posts.length, 1, 'a double click sends once (350ms, as CCFOLIA)');
    await page.mouse.move(5, 5); assert.equal(await page.locator('.piece-tip').isVisible(), false, 'tooltip leaves with the pointer');
    await page.locator('img[data-id="mk"]').hover(); assert.equal(await page.locator('.piece-tip').textContent(), '마커 글', 'marker text');
    // link: asks first; refused = stays
    await page.waitForTimeout(360);
    const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.locator('img[data-id="l"]').click(); await page.waitForTimeout(60);
    assert.equal(dialogs.length, 1); assert.match(dialogs[0], /https:\/\/example\.test\/a/); assert.equal(page.context().pages().length, 1);
    assert.deepEqual(errors, []);
    console.log('participant grid and panels PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
