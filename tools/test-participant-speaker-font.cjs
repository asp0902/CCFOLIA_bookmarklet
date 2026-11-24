// Playroom fonts per speaker (the toolkit's #637 rule): the narration row while narration is on, else the current name's row; a font picked by hand wins; set from the 가 menu.
// The GM side reads a command wrapped in markers as a command (it is sent raw and rolled).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..'), dir = path.join(root, 'prototype', 'public-handout-relay', 'public');
const panel = fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-panel.user.js'), 'utf8');
assert.match(panel, /const bareText = meta \? "" : parseFormatMarkers\(stripEnvelopes\(text\)\)\.text;/);
assert.match(panel, /isChatCommandText\(bareText\) \|\| endsWithCutin\(bareText\)/);
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderState({ roomTitle: 'r', gmOnline: true, messages: [], channels: [{ id: 'main', label: '메인' }] }); });
    // set from the 가 menu
    await page.click('.fmt-group[data-group="font"] .fmt-group-btn');
    await page.click('.fmt-font-menu .fmt-speaker-fonts');
    await page.fill('.sf-add input', '아델리'); await page.press('.sf-add input', 'Enter');
    await page.selectOption('.sf-row:has(.sf-name:text-is("아델리")) select', 'gowun-batang');
    await page.selectOption('.sf-row:has(.sf-name:text-is("나레이션")) select', 'nanum-myeongjo');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('capybara-speaker-fonts-v1')).sort((a, b) => a.name.localeCompare(b.name))), [{ name: '', fontId: 'nanum-myeongjo' }, { name: '아델리', fontId: 'gowun-batang' }].sort((a, b) => a.name.localeCompare(b.name)));
    await page.keyboard.press('Escape');
    const out = await page.evaluate(() => { const name = document.getElementById('chat-name'); name.value = '아델리'; const a = outgoingText('안녕'); const b = outgoingText('{f:noto-serif-kr|직접|} 고름'); fmtState.narration = true; const c = outgoingText('바람이 분다'); fmtState.narration = false; name.value = '다른 사람'; const d = outgoingText('그대로'); return [a, b, c, d]; });
    assert.deepEqual(out, ['{f:gowun-batang|안녕|}', '{f:noto-serif-kr|직접|} 고름', '{n:1|{f:nanum-myeongjo|바람이 분다|}|}', '그대로']);
    assert.deepEqual(errors, []);
    console.log('participant speaker font PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
