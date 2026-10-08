// Participant chat input: editable name and colour travel with the message, speaker list by button / backtick / arrow keys, palette inserts, format buttons insert markers, dice buttons.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const sent = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/messages') && route.request().method() === 'POST') { sent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'id-' + Math.random().toString(16).slice(2); }); // the fake origin is not a secure context
  await page.goto('http://relay.test/#room=x');
  const img = 'https://storage.ccfolia-cdn.net/a.png';
  await page.evaluate(img => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderState({ roomTitle: 'r', gmOnline: true, messages: [], channels: [], scene: { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [
      { id: 'c1', name: '알리스', x: 0, y: 0, z: 1, angle: 0, width: 4, height: 4, iconUrl: img, status: [], commands: '1d20+3 공격\nCC<=60 탐색' },
      { id: 'c2', name: '밥', x: 100, y: 0, z: 1, angle: 0, width: 4, height: 4, iconUrl: img, status: [], commands: '' }] } });
  }, img);
  const input = page.locator('#chat-input');
  // dice row: native icons, send button at its end
  assert.equal(await page.locator('.dice-row button[aria-label^="D"]').count(), 7);
  assert.equal(await page.locator('.dice-row button[type=submit]').isVisible(), true);
  await page.click('button[aria-label="D6"]');
  assert.equal(await input.inputValue(), '1d6');
  // format buttons wrap the selection in markers
  await input.fill('abc'); await input.evaluate(e => e.setSelectionRange(0, 3));
  await page.click('button[aria-label="Bold"]');
  assert.equal(await input.inputValue(), '**abc**');
  await input.fill('x'); await input.evaluate(e => e.setSelectionRange(0, 1));
  await page.click('button[aria-label="Align center"]');
  assert.equal(await input.inputValue(), '{a:center|x|}');
  // palette is disabled without a speaker that has commands
  assert.equal(await page.locator('#pal-btn').isDisabled(), true);
  // backtick opens the speaker list; arrow keys + Enter pick; the button shows the character
  await input.fill(''); await input.focus(); await page.keyboard.press('`');
  assert.equal(await input.inputValue(), '', 'backtick is not typed');
  assert.deepEqual(await page.locator('.menu-item').allTextContents(), ['내 이름', '알리스', '밥']);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#speaker').inputValue(), 'c1');
  assert.equal(await page.locator('#speaker-img').isVisible(), true);
  // palette lists the chosen character's commands and inserts one
  assert.equal(await page.locator('#pal-btn').isDisabled(), false);
  await page.click('#pal-btn');
  assert.deepEqual(await page.locator('.menu-item').allTextContents(), ['1d20+3 공격', 'CC<=60 탐색']);
  await page.click('text=CC<=60 탐색');
  assert.equal(await input.inputValue(), 'CC<=60 탐색');
  // name and colour are sent with the message
  await page.fill('#chat-name', '나의 이름');
  await page.evaluate(() => { const c = document.getElementById('color-input'); c.value = '#ff8800'; c.dispatchEvent(new Event('input')); });
  await input.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, '나의 이름'); assert.equal(sent[0].color, '#ff8800'); assert.equal(sent[0].characterId, 'c1'); assert.equal(sent[0].text, 'CC<=60 탐색');
  await browser.close();
  console.log('participant chat input PASS');
})().catch(error => { console.error(error); process.exit(1); });
