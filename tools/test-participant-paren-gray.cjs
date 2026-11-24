// Playroom 회색괄호 (as format-sync 0.1.168): on by default (saved when turned off), tooltip 회색괄호; while on, drawn messages show (…) grey,
// a dice row and a sender colour are left alone; turning it off ungreys the rows on screen; outgoing text gets the same grey.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (obj) => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
const colored = '빨강 (내 색)' + encode({ v: 1, text: '빨강 (내 색)', formatRuns: [{ start: 3, end: 8, style: { color: '#ff0000' } }], alignRuns: [], blockStyle: {} });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    await page.evaluate(() => { const r = document.getElementById('room'); r.inert = false; r.removeAttribute('aria-hidden'); const g = document.getElementById('gate'); if (g) g.style.display = 'none'; });
    const draw = () => page.evaluate((colored) => renderState({ messages: [
      { id: 'a', author: '남', text: '안녕 (작게) 끝', channel: 'main', createdAt: Date.now() },
      { id: 'b', author: '남', text: 'CC<=45', roll: { result: '(1D100<=45) ＞ 37' }, channel: 'main', createdAt: Date.now() },
      { id: 'c', author: '나', text: colored, channel: 'main', createdAt: Date.now() }
    ] }), colored);
    await draw();
    const grey = () => page.evaluate(() => [...document.querySelectorAll('#messages .paren-gray')].map((s) => s.textContent));
    const btn = page.locator('button[aria-label="회색괄호"]').first();
    assert.equal(await btn.getAttribute('aria-pressed'), 'true', 'on by default');
    assert.equal(await btn.getAttribute('title'), '회색괄호');
    assert.deepEqual(await grey(), ['(작게)'], 'plain row grey; dice row and sender colour untouched');
    assert.equal(await page.evaluate(() => outgoingText('가 (나)')).then((t) => t), '가 {c:#878787|(나)|}', 'outgoing text greyed the same');
    await btn.click();
    assert.equal(await btn.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await grey(), [], 'off: ungreyed');
    assert.equal(await page.evaluate(() => localStorage.getItem('capybara-paren-gray-v1')), '0');
    await page.reload(); await page.evaluate(() => { const r = document.getElementById('room'); r.inert = false; }); await draw();
    assert.equal(await page.locator('button[aria-label="회색괄호"]').first().getAttribute('aria-pressed'), 'false', 'off kept after reload');
    assert.deepEqual(await grey(), []);
    assert.deepEqual(errors, []);
    console.log('participant paren gray PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
