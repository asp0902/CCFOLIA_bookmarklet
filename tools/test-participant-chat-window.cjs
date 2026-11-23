// '다른 창으로 보기': the gear opens the same page with chat=1 in its own 380x640 window and closes the chat panel here (as CCFOLIA's /rooms/{id}/chat): the styled chat alone, no map, no second sound.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
const STATE = { roomTitle: 'r', gmOnline: true, capabilities: { chatRead: true, chatWrite: true }, channels: [{ id: 'main', label: '메인' }, { id: 'info', label: '정보' }], messages: [{ id: 'm', author: 'A', text: '말', channel: 'main', createdAt: '2026-11-23T00:00:00.000Z' }], scene: { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: { url: 'https://storage.ccfolia-cdn.net/a.mp3', name: 'b', volume: 1, repeat: true }, sound: null, effects: [] } };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    await context.addInitScript(() => { const open = window.open; window.open = function (...args) { window.__openArgs = args; return open.apply(this, args); }; window.__audios = []; window.Audio = class { constructor() { window.__audios.push(this); this.src = ''; } play() { return Promise.resolve(); } pause() {} removeAttribute() {} }; window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await context.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); if (u.pathname.endsWith('/status')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'approved', displayName: 'P' }) }); if (u.pathname.endsWith('/state')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(STATE) }); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://relay.test/#room=x');
    await page.waitForSelector('#messages li, #messages-host', { state: 'attached' });
    await page.click('#chat-gear');
    const [win] = await Promise.all([context.waitForEvent('page'), page.click('.menu-item:has-text("다른 창으로 보기")')]);
    win.on('pageerror', (e) => errors.push(e.message));
    await win.waitForLoadState(); await win.setViewportSize({ width: 380, height: 640 });
    assert.match(await page.evaluate(() => window.__openArgs[2]), /^resizable,scrollbars,status,width=380,height=640,left=530,top=130$/);
    assert.equal(await page.evaluate(() => document.getElementById('room').classList.contains('chat-collapsed')), true, 'the chat panel here closes');
    assert.match(win.url(), /#room=x&chat=1$/);
    await win.waitForFunction(() => document.getElementById('messages')?.textContent.includes('말'));
    const look = await win.evaluate(() => { const c = document.querySelector('.chat').getBoundingClientRect(), form = document.getElementById('chat-form').getBoundingClientRect(), list = document.getElementById('messages').getBoundingClientRect(), btn = document.getElementById('chat-gear').getBoundingClientRect(), svg = document.querySelector('#chat-close svg')?.getBoundingClientRect(); return { chat: [c.x, c.y, c.width, c.height], stage: getComputedStyle(document.querySelector('.stage')).display, top: getComputedStyle(document.querySelector('#room>header')).display, formInside: form.bottom <= innerHeight + 1 && form.height > 80, listH: list.height > 120, noSideScroll: document.documentElement.scrollWidth <= innerWidth, gear: btn.width <= 48, svg: !svg || svg.width <= 32, audios: window.__audios.length }; });
    assert.deepEqual(look, { chat: [0, 0, 380, 640], stage: 'none', top: 'none', formInside: true, listH: true, noSideScroll: true, gear: true, svg: true, audios: 0 });
    // a wide window keeps the chat alone
    await win.setViewportSize({ width: 1000, height: 700 });
    assert.deepEqual(await win.evaluate(() => { const c = document.querySelector('.chat').getBoundingClientRect(); return [c.width, c.height]; }), [1000, 700]);
    await win.setViewportSize({ width: 380, height: 640 });
    await win.screenshot({ path: process.env.CHAT_WINDOW_SHOT || require('node:path').join(require('node:os').tmpdir(), 'chat-window-380.png') });
    // the input works there, and its own gear entry is off
    await win.fill('#chat-input', '입력'); assert.equal(await win.inputValue('#chat-input'), '입력');
    await win.click('#chat-gear');
    assert.equal(await win.locator('.menu-item:has-text("다른 창으로 보기")').isDisabled(), true);
    await win.keyboard.press('Escape');
    // >| closes this window; the main page's panel stays closed until its own button opens it
    await Promise.all([win.waitForEvent('close'), win.click('#chat-close')]);
    assert.equal(await page.evaluate(() => document.getElementById('room').classList.contains('chat-collapsed')), true);
    await page.click('#chat-open');
    assert.equal(await page.evaluate(() => document.getElementById('room').classList.contains('chat-collapsed')), false, 'its button brings the panel back');
    assert.equal(await page.evaluate(() => window.__audios.length), 1, 'the main window keeps the sound');
    assert.deepEqual(errors, []);
    console.log('participant chat window PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
