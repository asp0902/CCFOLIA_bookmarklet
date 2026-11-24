// Playroom button tooltips, values measured on CCFOLIA 1.37.6: which buttons have one, its text, 14px from the button (dice and range select above), 100ms delay, gone on leaving; none for touch or a narrow page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
const STATE = { roomTitle: 'r', gmOnline: true, capabilities: { chatRead: true, chatWrite: true }, channels: [{ id: 'main', label: '메인' }], messages: [], scene: { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media: { url: 'https://storage.ccfolia-cdn.net/a.mp3', name: '곡', volume: 0.5, repeat: false }, sound: null, effects: [] } };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.Audio = class { play() { return Promise.resolve(); } pause() {} removeAttribute() {} }; window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); if (u.pathname.endsWith('/status')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'approved', displayName: 'P' }) }); if (u.pathname.endsWith('/state')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(STATE) }); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    await page.waitForFunction(() => document.getElementById('bgm-slot1').classList.contains('is-on'));
    await page.evaluate(() => { document.getElementById('help-btn').hidden = false; });
    const tip = () => page.evaluate(() => { const n = document.querySelector('.piece-tip'); return n.hidden ? null : n.textContent; });
    const away = async () => { await page.mouse.move(600, 500); await page.waitForTimeout(20); };
    const hover = async (selector) => { await away(); await page.locator(selector).first().hover({ force: true }); await page.waitForTimeout(170); };
    const cases = [['#char-list-open', '내 캐릭터 목록'], ['#bgm-stop', 'BGMを停止する'], ['#bgm-slot1', '곡\nvol:0.5 loop:off'], ['#bgm-slot2', 'NOTITLE\nvol:0 loop:on'], ['#chat-gear', '채팅 메뉴'], ['#speaker-btn', '캐릭터 선택'], ['#pal-btn', '채팅 팔레트'], ['#color-btn', '캐릭터 색상 변경'], ['#help-btn', '채팅 커맨드에 대해']];
    for (const [selector, text] of cases) {
      await hover(selector); assert.equal(await tip(), text, selector);
      const gap = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(), t = document.querySelector('.piece-tip').getBoundingClientRect(); return [Math.round(parseFloat(document.querySelector('.piece-tip').style.top) - b.bottom), t.right <= innerWidth + 0.5]; }, selector);
      assert.deepEqual(gap, [14, true], `${selector}: under it, inside the window`);
      assert.equal(await page.locator(selector).getAttribute('title'), null, `${selector}: no browser tooltip on top`);
    }
    for (const [selector, text] of [['button[aria-label="D20"]', 'D20'], ['.select-tool', 'Ctrl + ドラッグ']]) {
      await hover(selector); assert.equal(await tip(), text);
      assert.equal(await page.evaluate((s) => { const n = document.querySelector('.piece-tip'); return Math.round(document.querySelector(s).getBoundingClientRect().top - (parseFloat(n.style.top) + n.offsetHeight)); }, selector), 14, `${selector}: above it`);
    }
    await page.evaluate(() => { const b = document.createElement('button'); b.id = 'penguin'; b.setAttribute('aria-label', 'GM 도구'); b.style.cssText = 'position:fixed;left:300px;top:200px;width:40px;height:40px;z-index:9999'; document.body.append(b); });
    await hover('#penguin'); assert.equal(await tip(), 'GM 도구', 'the penguin of the mirrored top bar');
    await page.evaluate(() => document.getElementById('penguin').remove());
    for (const [selector, text] of [['#chat-form .fmt-row button', 'Bold'], ['#chat-form .fmt-color', 'Text color'], ['#chat-form .fmt-size', 'Font size'], ['#chat-form .fmt-group-btn', '꾸미기']]) { await hover(selector); assert.equal(await tip(), text, selector); assert.equal(await page.locator(selector).first().getAttribute('title'), null, `${selector}: no browser tooltip`); }
    for (const selector of ['#bgm-mute', '#chat-close', '.pen-fab', '#account-btn']) { await hover(selector); assert.equal(await tip(), null, `${selector}: none on CCFOLIA`); }
    assert.deepEqual(await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.piece-tip')); return [c.backgroundColor, c.color, c.fontSize, c.fontWeight, c.lineHeight, c.padding, c.borderRadius, c.whiteSpace, c.maxWidth]; }), ['rgb(22, 22, 22)', 'rgb(255, 255, 255)', '12px', '500', 'normal', '4px 8px', '4px', 'pre-wrap', '300px']);
    // 100ms first, gone on leaving
    await away(); await page.waitForTimeout(900);
    await page.locator('#char-list-open').hover(); await page.waitForTimeout(30); assert.equal(await tip(), null, 'not before 100ms');
    await page.waitForTimeout(120); assert.equal(await tip(), '내 캐릭터 목록');
    if (process.env.TOOLTIP_SHOT) { await page.waitForTimeout(260); await page.screenshot({ path: process.env.TOOLTIP_SHOT, clip: { x: 1000, y: 0, width: 440, height: 130 } }); }
    await away(); assert.equal(await tip(), null, 'gone');
    // touch, narrow page
    await page.evaluate(() => document.querySelector('#bgm-stop').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true, pointerType: 'touch' })));
    await page.waitForTimeout(150); assert.equal(await tip(), null, 'touch');
    await page.setViewportSize({ width: 700, height: 800 });
    await page.evaluate(() => document.querySelector('#chat-gear').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true, pointerType: 'mouse' })));
    await page.waitForTimeout(150); assert.equal(await tip(), null, 'narrow');
    assert.match(fs.readFileSync(path.join(dir, 'participant.js'), 'utf8'), /button\.disabled = true; button\.classList\.add\("Mui-disabled"\); button\.style\.pointerEvents = "auto"/, 'a disabled [GM] button still takes the hover');
    assert.deepEqual(errors, []);
    console.log('participant tooltips PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
