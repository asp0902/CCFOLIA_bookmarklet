// Participant page: CCFOLIA's own BGM file and sound effect play in two <audio> elements (room volume x the bar slider, mute and stop apply to both).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // a recording stand-in for Audio (no real media here)
  await page.addInitScript(() => {
    window.__audios = [];
    window.Audio = class { constructor() { this.src = ''; this.volume = 1; this.muted = false; this.loop = false; this.paused = true; this.plays = 0; window.__audios.push(this); }
      play() { this.paused = false; this.plays += 1; return window.__block ? Promise.reject(new Error('blocked')) : Promise.resolve(); }
      pause() { this.paused = true; } removeAttribute(name) { if (name === 'src') this.src = ''; } };
  });
  await page.goto('http://relay.test/#room=x');
  const A = 'https://storage.ccfolia-cdn.net/a.mp3', B = 'https://storage.ccfolia-cdn.net/b.mp3', S = 'https://storage.ccfolia-cdn.net/s.mp3';
  const scene = (media, sound) => ({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media, sound });
  const state = () => page.evaluate(() => window.__audios.map(a => ({ src: a.src, volume: a.volume, muted: a.muted, loop: a.loop, paused: a.paused })));
  await page.evaluate(([A, S]) => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: { url: A, name: '전투 BGM', volume: 0.5, repeat: true }, sound: { url: S, name: '바람', volume: 1, repeat: false } }); }, [A, S]);
  let st = await state();
  assert.deepEqual(st, [{ src: A, volume: 0.5, muted: false, loop: true, paused: false }, { src: S, volume: 1, muted: false, loop: false, paused: false }]);
  assert.equal(await page.locator('#bgm-bar').isVisible(), true, 'the bar shows for room audio');
  assert.equal(await page.locator('#bgm-name').textContent(), '전투 BGM');
  // the slider scales the room volume; mute applies to both
  await page.locator('#bgm-vol').evaluate(e => { e.value = 50; e.dispatchEvent(new Event('input')); });
  st = await state(); assert.deepEqual(st.map(a => a.volume), [0.25, 0.5]);
  await page.click('#bgm-mute'); st = await state(); assert.deepEqual(st.map(a => a.muted), [true, true]);
  await page.click('#bgm-mute');
  // a changed address replaces the source and starts again; none stops it
  await page.evaluate(([B, S]) => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: { url: B, name: 'x', volume: 1, repeat: true }, sound: { url: S, name: '바람', volume: 1, repeat: false } }), [B, S]);
  st = await state(); assert.equal(st[0].src, B); assert.equal(st[0].paused, false);
  assert.equal(await page.evaluate(() => window.__audios[1].plays), 1, 'an unchanged sound is not restarted');
  await page.evaluate(([S]) => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: null, sound: { url: S, name: '바람', volume: 1, repeat: false } }), [S]);
  st = await state(); assert.deepEqual([st[0].src, st[0].paused], ['', true], 'no media -> stopped');
  // stop silences the room audio until a different file arrives
  await page.click('#bgm-stop'); st = await state(); assert.deepEqual([st[1].src, st[1].paused], ['', true]);
  await page.evaluate(([A, S]) => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: { url: A, name: 'n', volume: 1, repeat: true }, sound: { url: S, name: '바람', volume: 1, repeat: false } }), [A, S]);
  st = await state(); assert.equal(st[0].src, A, 'a new file plays'); assert.equal(st[1].src, '', 'the stopped sound stays stopped');
  // autoplay blocked -> one play button
  await page.evaluate(() => { window.__block = true; });
  await page.evaluate(([B]) => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: { url: B, name: 'n', volume: 1, repeat: true }, sound: null }), [B]);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#bgm-play').isVisible(), true, 'blocked autoplay shows a play button');
  await browser.close();
  console.log('participant room audio PASS');
})().catch(error => { console.error(error); process.exit(1); });
