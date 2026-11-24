// Participant format toolbar: Nr / () toggles and colour / size tools produce the markers the GM side parses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const sent = [];
  await page.addInitScript(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'id-' + Math.random().toString(16).slice(2); });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/messages')) { sent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  page.on('pageerror', e => console.log('pageerror', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 150)); });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderState({ roomTitle: 'r', gmOnline: true, messages: [], channels: [{ id: 'main', label: '메인' }] }); });
  assert.equal(await page.locator('.fmt-row2 button[aria-label="나레이션"]').count(), 1); // 2026-11-24: the Aa / ⋯ items are a second row
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.fmt-row2 button')].map((b) => b.getAttribute('aria-label'))), ['루비', '툴팁', '블러', '코드', '나레이션', '회색괄호']);
  assert.equal(await page.locator('.fmt-group[data-group="deco"], .fmt-group[data-group="extra"]').count(), 0);
  // 2026-11-24: two quick cut-in buttons sit right before the send button, all three 38px wide
  assert.deepEqual(await page.evaluate(() => [...document.querySelector('.dice-row').children].slice(-3).map((n) => [n.classList.contains('quick-cutin') ? 'quick' : n.type, Math.round(n.getBoundingClientRect().width)])), [['quick', 38], ['quick', 38], ['submit', 38]]);
  assert.equal(await page.evaluate(() => new Set([...document.querySelector('.fmt-row').children].map((c) => Math.round(c.getBoundingClientRect().top))).size), 1);
  assert.equal(await page.locator('.fmt-color input[type=color]').count(), 2);
  // alignment buttons act as one group (left active first), like the toolkit toolbar
  const pressed = async () => page.evaluate(() => [...document.querySelectorAll('.fmt-row button[aria-label$=" 정렬"]')].map(b => b.getAttribute('aria-pressed')).join());
  assert.equal(await pressed(), 'true,false,false'); await page.click('.fmt-row button[aria-label="가운데 정렬"]'); assert.equal(await pressed(), 'false,true,false');
  // 2026-11-23: the letters show their format, the colour chips have the toolkit's 1px edge, the font menu wraps a selection in {f:id|..|}
  assert.deepEqual(await page.evaluate(() => ['굵게', '기울임', '밑줄', '취소선'].map((n) => { const b = document.querySelector(`.fmt-row button[aria-label="${n}"]`).firstElementChild, c = getComputedStyle(b); return [b.tagName, c.fontWeight, c.fontStyle, c.textDecorationLine]; })), [['B', '700', 'normal', 'none'], ['I', '400', 'italic', 'none'], ['U', '400', 'normal', 'underline'], ['S', '400', 'normal', 'line-through']]);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fmt-color'), '::before').boxShadow), 'rgb(128, 128, 128) 0px 0px 0px 1px inset');
  await page.fill('#chat-input', '글꼴 글자'); await page.evaluate(() => document.getElementById('chat-input').setSelectionRange(0, 2));
  await page.click('.fmt-group[data-group="font"] .fmt-group-btn');
  assert.equal(await page.locator('.fmt-font-menu [data-font-id]').count(), 38, 'the toolkit font list');
  await page.click('.fmt-font-menu [data-font-id="gowun-batang"]');
  assert.equal(await page.inputValue('#chat-input'), '{f:gowun-batang|글꼴|} 글자'); assert.equal(await page.locator('.fmt-font-menu').isVisible(), false);
  await page.fill('#chat-input', '');
  // a status bar without a maximum has no fill (CCFOLIA shows only the dim track for HP 0/0)
  const fill = await page.evaluate(() => { renderScene({ fieldWidth: 20, fieldHeight: 10, items: [], markers: [], characters: [{ id: 'c', name: 'A', x: 0, y: 0, z: 0, angle: 0, width: 4, height: 4, iconUrl: 'https://storage.ccfolia-cdn.net/a.png', status: [{ label: 'HP', value: 0, max: 0 }, { label: 'MP', value: 5, max: 10 }] }] }); return [...document.querySelectorAll('.st-fill')].map(f => f.style.width).join(); });
  assert.equal(fill, '0%,50%');
  // colour on a selection, size on Enter
  await page.fill('#chat-input', '빨강 글자');
  await page.evaluate(() => { const i = document.getElementById('chat-input'); i.setSelectionRange(0, 2); });
  await page.evaluate(() => { const c = document.querySelector('.fmt-color input'); c.value = '#ff0000'; c.dispatchEvent(new Event('change')); });
  assert.equal(await page.inputValue('#chat-input'), '{c:#ff0000|빨강|} 글자');
  await page.fill('#chat-input', '크게'); await page.evaluate(() => document.getElementById('chat-input').setSelectionRange(0, 2));
  await page.fill('.fmt-size', '30'); await page.press('.fmt-size', 'Enter');
  assert.equal(await page.inputValue('#chat-input'), '{s:30|크게|}');
  // toggles are applied when sending
  await page.click('.fmt-row2 button[aria-label="나레이션"]'); // 회색괄호 is on by default (0.1.168)
  assert.equal(await page.getAttribute('.fmt-row2 button[aria-label="나레이션"]', 'aria-pressed'), 'true');
  await page.fill('#chat-input', '문을 연다 (조용히)'); await page.press('#chat-input', 'Enter'); await page.waitForTimeout(500);
  assert.equal(sent[0].text, '{n:1|문을 연다 {c:#878787|(조용히)|}|}');
  await page.click('.fmt-row2 button[aria-label="나레이션"]');
  // a quick cut-in button: nothing chosen -> the chooser (known cut-ins + free text); chosen -> sent as it is from the current speaker and tab, the typed text stays
  await page.evaluate(() => { sceneData = { ...(sceneData || {}), cutinNames: ['@버튼'] }; });
  await page.click('.quick-cutin[data-quick="0"]');
  await page.click('.menu-item:has-text("@버튼")');
  await page.fill('#chat-input', '쓰던 글');
  await page.click('.quick-cutin[data-quick="0"]'); await page.waitForTimeout(400);
  assert.equal(sent.at(-1).text, '@버튼'); assert.equal(await page.inputValue('#chat-input'), '쓰던 글');
  assert.match(await page.getAttribute('.quick-cutin[data-quick="0"]', 'aria-label'), /버튼 컷인 보내기: @버튼/);
  // the warning button: several cut-ins; two -> a click offers both; one -> sent at once
  await page.evaluate(() => { localStorage.setItem('capybara-quick-cutin-v1:x', JSON.stringify([{ text: '@버튼' }, { text: '옛 경고' }])); });
  await page.click('.quick-cutin[data-quick="1"]', { button: 'right' }); await page.click('.menu-item:has-text("컷인 추가")');
  await page.click('.menu-item:has-text("@버튼")'); await page.waitForTimeout(100); await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  await page.click('.quick-cutin[data-quick="1"]');
  assert.deepEqual(await page.locator('.menu-item').allTextContents(), ['옛 경고', '@버튼']);
  await page.click('.menu-item:has-text("@버튼")'); await page.waitForTimeout(400);
  assert.equal(sent.at(-1).text, '@버튼');
  await browser.close();
  console.log('participant format toolbar PASS');
})().catch(error => { console.error(error); process.exit(1); });
