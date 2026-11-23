// Cut-ins in the playroom (rules read from CCFOLIA 1.37.6): a raised playTime plays them; picture over a dark layer until a click or the sound's end; no picture = the name at the top right.
// The GM page sends only effects that were played, the relay keeps CDN addresses only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..'), dir = path.join(root, 'prototype', 'public-handout-relay', 'public');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert(i >= 0 && j > i, a); return s.slice(i, j); };
const panel = fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-panel.user.js'), 'utf8');
const relayEffectViews = vm.runInNewContext(`(${between(panel, 'function relayEffectViews', '// 다이스 심볼(entities.roomDices:').trim()})`);
const worker = fs.readFileSync(path.join(root, 'prototype/public-handout-relay/cloudflare/worker.mjs'), 'utf8');
const cleanSceneEffects = vm.runInNewContext(`${between(worker, 'const cleanSceneEffects', 'export class').trim()}; cleanSceneEffects`);
const CDN = 'https://storage.ccfolia-cdn.net/';
const url = (v) => (typeof v === 'string' && v.startsWith(CDN) ? v : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const T = 1_800_000_000_000;
const views = Array.from(relayEffectViews({ a: { _id: 'a', name: '미재생', imageUrl: CDN + 'secret.png', createdAt: T, playTime: T }, b: { _id: 'b', name: '재생', imageUrl: CDN + 'b.png', soundUrl: 'https://evil.test/x.mp3', soundVolume: 0.5, createdAt: T, playTime: T + 5000 } }, url, num));
assert.deepEqual(views.map((v) => v.id), ['b'], 'a never played cut-in is not sent');
assert.equal(views[0].soundUrl, '', 'CDN addresses only');
const clean = Array.from(cleanSceneEffects([{ id: 'x', name: 'n', imageUrl: 'javascript:alert(1)', soundUrl: CDN + 's.mp3', volume: 9, playTime: T }, { id: 'y', playTime: 'bad' }]));
assert.equal(clean.length, 1); assert.equal(clean[0].imageUrl, ''); assert.equal(clean[0].volume, 1); assert.equal(clean[0].playTime, T, 'the clock is not clamped');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname === 'storage.ccfolia-cdn.net') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await page.addInitScript(() => { window.__audios = []; window.Audio = class { constructor(src = '') { this.src = src; this.volume = 1; this.muted = false; this.plays = 0; this.paused = true; window.__audios.push(this); } play() { this.plays += 1; this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } removeAttribute() {} }; });
    await page.goto('http://relay.test/#room=x');
    const scene = (effects) => page.evaluate((effects) => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: null, sound: null, effects }); }, effects);
    const both = (playTime) => ({ id: 'both', name: '@둘다', imageUrl: CDN + 'i.png', soundUrl: CDN + 's.mp3', volume: 0.5, playTime });
    await scene([both(T)]);
    assert.equal(await page.locator('.cutin-layer').count(), 0, 'what was played before opening does not play');
    await scene([both(T)]);
    assert.equal(await page.locator('.cutin-layer').count(), 0, 'an unrelated scene update does not replay it');
    // picture + sound: the measured layout; ends with the sound
    await scene([both(T + 1000)]);
    assert.equal(await page.locator('.cutin-layer').count(), 1);
    const look = await page.evaluate(() => { const l = document.querySelector('.cutin-layer'), b = document.querySelector('.cutin-box').getBoundingClientRect(); return { bg: getComputedStyle(l).backgroundColor, w: Math.round(b.width), h: Math.round(b.height), cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2), fit: getComputedStyle(document.querySelector('.cutin-box img')).objectFit }; });
    assert.deepEqual(look, { bg: 'rgba(0, 0, 0, 0.4)', w: 480, h: 480, cx: 720, cy: 450, fit: 'contain' });
    assert.deepEqual(await page.evaluate(() => { const a = window.__audios.at(-1); return [a.src.endsWith('s.mp3'), a.volume, a.plays]; }), [true, 0.5, 1]);
    await page.evaluate(() => window.__audios.at(-1).onended());
    assert.equal(await page.locator('.cutin-layer').count(), 0, 'closed by the end of its sound');
    // a click closes it and stops the sound
    await scene([both(T + 2000)]);
    await page.click('.cutin-layer', { position: { x: 5, y: 5 } });
    assert.equal(await page.locator('.cutin-layer').count(), 0);
    assert.equal(await page.evaluate(() => window.__audios.at(-1).paused), true, 'sound stopped');
    // picture only stays until a click; sound only shows the name at the top right
    await scene([{ ...both(T + 3000), soundUrl: '' }]);
    assert.equal(await page.locator('.cutin-layer').count(), 1); const count = await page.evaluate(() => window.__audios.length);
    assert.equal(count, await page.evaluate(() => window.__audios.length), 'no audio for a picture only'); await page.click('.cutin-layer', { position: { x: 5, y: 5 } });
    await scene([{ ...both(T + 4000), imageUrl: '' }]);
    assert.equal(await page.locator('.cutin-snack').textContent(), '@둘다×');
    assert.deepEqual(await page.locator('.cutin-snack').evaluate((n) => { const r = n.getBoundingClientRect(); return [Math.round(innerWidth - r.right), Math.round(r.top)]; }), [24, 24]);
    await page.click('.cutin-snack button'); assert.equal(await page.locator('.cutin-snack').count(), 0);
    assert.deepEqual(errors, []);
    console.log('participant cutin PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
