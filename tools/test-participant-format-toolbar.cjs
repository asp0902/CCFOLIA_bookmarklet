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
  assert.equal(await page.locator('.fmt-row button[aria-label="Narration"]').count(), 1);
  assert.equal(await page.locator('.fmt-color input[type=color]').count(), 2);
  // colour on a selection, size on Enter
  await page.fill('#chat-input', '빨강 글자');
  await page.evaluate(() => { const i = document.getElementById('chat-input'); i.setSelectionRange(0, 2); });
  await page.evaluate(() => { const c = document.querySelector('.fmt-color input'); c.value = '#ff0000'; c.dispatchEvent(new Event('change')); });
  assert.equal(await page.inputValue('#chat-input'), '{c:#ff0000|빨강|} 글자');
  await page.fill('#chat-input', '크게'); await page.evaluate(() => document.getElementById('chat-input').setSelectionRange(0, 2));
  await page.fill('.fmt-size', '30'); await page.press('.fmt-size', 'Enter');
  assert.equal(await page.inputValue('#chat-input'), '{s:30|크게|}');
  // toggles are applied when sending
  await page.click('.fmt-row button[aria-label="Narration"]'); await page.click('.fmt-row button[aria-label="Parentheses gray"]');
  assert.equal(await page.getAttribute('.fmt-row button[aria-label="Narration"]', 'aria-pressed'), 'true');
  await page.fill('#chat-input', '문을 연다 (조용히)'); await page.press('#chat-input', 'Enter'); await page.waitForTimeout(500);
  assert.equal(sent[0].text, '{n:1|문을 연다 {c:#9e9e9e|(조용히)|}|}');
  await browser.close();
  console.log('participant format toolbar PASS');
})().catch(error => { console.error(error); process.exit(1); });
