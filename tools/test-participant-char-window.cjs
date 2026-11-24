// '내 캐릭터 목록' window, values measured on CCFOLIA 1.37.6: centred 320x280, square corners, one see-through surface, 24px line icons in 34px buttons, nothing written in an empty list; a row as in its capture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1.5 });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname === 'storage.ccfolia-cdn.net') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="teal"/></svg>' }); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; openCharacterWindow(); });
    const look = await page.evaluate(() => { const w = document.getElementById('char-window'), r = w.getBoundingClientRect(), c = getComputedStyle(w), [add, x] = w.querySelectorAll('.cw-btn'), box = (n) => { const b = n.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }; return { win: [r.x, r.y, r.width, r.height], radius: c.borderRadius, bg: c.backgroundColor, headBg: getComputedStyle(w.querySelector('.cw-head')).backgroundColor, title: box(w.querySelector('h6'))[0], add: box(add), x: box(x), addSvg: [add.querySelector('svg')?.getBoundingClientRect().width, add.querySelector('path')?.getAttribute('d')], xSvg: x.querySelector('svg')?.getBoundingClientRect().width, text: w.innerText.trim() }; });
    assert.deepEqual(look, { win: [352, 244, 320, 280], radius: '0px', bg: 'rgba(44, 44, 44, 0.87)', headBg: 'rgba(0, 0, 0, 0)', title: 376, add: [579, 251, 34, 34], x: [617, 251, 34, 34], addSvg: [24, 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z'], xSvg: 24, text: '내 캐릭터 목록' });
    await page.evaluate(() => { sceneData = { characters: [{ id: 'c1', iconUrl: 'https://storage.ccfolia-cdn.net/a.png' }] }; myCharacters = [{ id: 'c1', name: '아델리', memo: '', active: false }]; document.getElementById('char-window').dispatchEvent(new Event('cm-refresh')); });
    const row = await page.evaluate(() => { const w = document.getElementById('char-window').getBoundingClientRect(), n = document.querySelector('.cw-row'), a = n.querySelector('.cw-avatar').getBoundingClientRect(), b = n.querySelector('.char-text b'), s = n.querySelector('.char-text small'), p = n.querySelector('.cw-place').getBoundingClientRect(); return { avatar: [a.x - w.x, a.width, a.height, Math.round(a.y + a.height / 2 - w.y)], img: !!n.querySelector('.cw-avatar img'), text: Math.round(b.getBoundingClientRect().x - w.x), name: [getComputedStyle(b).fontSize, getComputedStyle(b).color], memo: [s.textContent, getComputedStyle(s).fontSize, getComputedStyle(s).color], place: Math.round(p.x + p.width / 2 - w.x) }; });
    assert.deepEqual(row, { avatar: [16, 40, 40, 95], img: true, text: 72, name: ['14px', 'rgb(255, 255, 255)'], memo: ['NO TEXT', '14px', 'rgba(255, 255, 255, 0.7)'], place: 281 });
    if (process.env.CHAR_WINDOW_SHOT) await page.screenshot({ path: process.env.CHAR_WINDOW_SHOT, clip: { x: 340, y: 232, width: 344, height: 304 } });
    assert.deepEqual(errors, []);
    console.log('participant char window PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
