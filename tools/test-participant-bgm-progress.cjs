// Playroom BGM bar: the progress line shows while a file BGM really plays (as on CCFOLIA), follows it, seeks it, and leaves when it ends; a short sound alone keeps it hidden.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
const scene = (media, sound = null) => ({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media, sound, effects: [] });
const file = (name, repeat = false) => ({ url: `https://storage.ccfolia-cdn.net/${name}.mp3`, name, volume: 1, repeat });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.__audios = []; window.Audio = class { constructor() { window.__audios.push(this); this.paused = true; this.ended = false; this.duration = NaN; this.currentTime = 0; this.volume = 1; } play() { this.paused = false; this.onplay?.(); return Promise.resolve(); } pause() { this.paused = true; this.onpause?.(); } removeAttribute() {} }; window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; if (!crypto.randomUUID) crypto.randomUUID = () => 'x'; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    const hidden = () => page.evaluate(() => document.querySelector('#bgm-bar .bgm-row2').hidden);
    const set = (s) => page.evaluate((v) => syncRoomAudio(v), s);
    const tick = (slot, props) => page.evaluate(([slot, p]) => { const a = roomAudio[slot].el; Object.assign(a, p); a.ondurationchange?.(); a.ontimeupdate?.(); }, [slot, props]);
    await set(scene(null));
    assert.equal(await hidden(), true, 'nothing plays');
    await set(scene(file('a')));
    await tick('media', { duration: 100, currentTime: 40 });
    assert.equal(await hidden(), false, 'BGM01 file: shown');
    assert.deepEqual(await page.evaluate(() => [document.getElementById('bgm-cur').textContent, document.getElementById('bgm-dur').textContent, document.getElementById('bgm-seek').value]), ['00:40', '01:40', '400']);
    // the bar's places and sizes, measured on CCFOLIA + toolkit, from the right edge of BGM02: [left, width, height]
    const box = await page.evaluate(() => { const end = document.getElementById('bgm-slot2').getBoundingClientRect().right, top = document.getElementById('bgm-slot2').getBoundingClientRect().top, read = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left - end), Math.round(r.width), Math.round(r.height)]; }, cur = document.getElementById('bgm-cur'), c = getComputedStyle(cur), seek = document.getElementById('bgm-seek'); return { mute: read('bgm-mute'), stop: read('bgm-stop'), slot1: read('bgm-slot1'), vol: read('bgm-vol'), cur: read('bgm-cur'), seek: read('bgm-seek'), dur: read('bgm-dur'), rowGap: Math.round(cur.getBoundingClientRect().top - top), look: [c.fontSize, c.opacity, c.color], track: getComputedStyle(seek, '::-webkit-slider-runnable-track').height }; });
    assert.deepEqual(box, { mute: [-188, 30, 30], stop: [-158, 30, 30], slot1: [-128, 64, 31], vol: [-282, 92, 12], cur: [-276, 34, 16], seek: [-241, 198, 4], dur: [-42, 34, 16], rowGap: 40, look: ['10px', '0.82', 'rgba(255, 255, 255, 0.88)'], track: '4px' });
    assert.match(fs.readFileSync(path.join(dir, 'style.css'), 'utf8'), /#bgm-seek::-webkit-slider-thumb\{width:16px;height:16px;margin-top:-6px\}/);
    if (process.env.BGM_SHOT) { await page.evaluate(() => { const r = document.getElementById('room'); r.inert = false; document.getElementById('gate').style.display = 'none'; r.removeAttribute('aria-hidden'); }); await page.waitForTimeout(100); const b = await page.locator('#bgm-bar').boundingBox(); await page.screenshot({ path: process.env.BGM_SHOT, clip: { x: b.x, y: 0, width: b.width, height: 150 } }); }
    await page.evaluate(() => { const s = document.getElementById('bgm-seek'); s.value = '500'; s.dispatchEvent(new Event('change')); });
    assert.equal(await page.evaluate(() => roomAudio.media.el.currentTime), 50, 'seek moves the file');
    await page.evaluate(() => { const a = roomAudio.media.el; a.ended = true; a.paused = true; a.onended?.(); });
    assert.equal(await hidden(), true, 'ended: hidden');
    await set(scene(null)); await set(scene(null, file('b', true)));
    await tick('sound', { duration: 3, currentTime: 1 });
    assert.equal(await hidden(), false, 'BGM02 looping: shown');
    await set(scene(null));
    assert.equal(await hidden(), true, 'stopped by the GM: hidden');
    await set(scene(null, file('c')));
    await tick('sound', { duration: 2, currentTime: 1 });
    assert.equal(await hidden(), true, 'a short sound alone: hidden');
    assert.deepEqual(errors, []);
    console.log('participant bgm progress PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
