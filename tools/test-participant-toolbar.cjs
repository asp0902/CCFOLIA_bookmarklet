// Participant page toolbar: only the ordinary player's controls, character list -> sheet dialog -> speaker, click on a piece opens the sheet, chat panel collapse is remembered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const img = 'https://storage.ccfolia-cdn.net/a.png';
  const setup = () => page.evaluate(img => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderState({ roomTitle: '테스트룸', gmOnline: true, messages: [], channels: [], scene: { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [],
      characters: [{ id: 'c1', name: '알리스', x: 48, y: 24, z: 1, angle: 0, width: 4, height: 4, iconUrl: img, status: [{ label: 'HP', value: 7, max: 10 }], params: [{ label: 'STR', value: '60' }], memo: '메모 첫 줄\n둘째 줄', externalUrl: 'https://example.com/sheet' }] } });
  }, img);
  await setup();
  // only the ordinary player's controls
  assert.deepEqual(await page.locator('#room > header button:visible').evaluateAll(b => b.map(x => x.id)), ['room-menu-btn', 'char-list-open', 'account-btn']);
  assert.equal(await page.locator('#room-title').textContent(), '테스트룸');
  assert.equal(await page.locator('#gm-state').getAttribute('data-online'), '1');
  // character list -> sheet -> speaker
  await page.click('#char-list-open');
  assert.match(await page.locator('.char-row').innerText(), /알리스[\s\S]*HP 7\/10/);
  await page.click('.char-row');
  const sheet = await page.locator('.dlg').innerText();
  assert(sheet.includes('STR') && sheet.includes('60') && sheet.includes('메모 첫 줄\n둘째 줄') && sheet.includes('참고 URL'), 'sheet shows params, memo and link');
  assert.equal(await page.locator('.dlg a').getAttribute('href'), 'https://example.com/sheet');
  await page.click('text=이 캐릭터로 발언');
  assert.equal(await page.locator('#speaker').inputValue(), 'c1');
  assert.equal(await page.locator('.dlg').count(), 0);
  // a click (not a drag) on the piece opens the sheet too
  const b = await page.locator('img[data-id="c1"]').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  assert.equal(await page.locator('.dlg h2').textContent(), '알리스');
  await page.keyboard.press('Escape');
  // account menu and chat collapse
  await page.click('#account-btn');
  assert.deepEqual(await page.locator('.menu-item').allTextContents(), ['BGM 음소거', '룸에서 나가기']);
  await page.keyboard.press('Escape');
  await page.click('#chat-close');
  assert(await page.locator('#room').evaluate(r => r.classList.contains('chat-collapsed')));
  assert.equal(await page.locator('#chat-open').isVisible(), true);
  await page.reload(); await setup();
  assert(await page.locator('#room').evaluate(r => r.classList.contains('chat-collapsed')), 'collapse is remembered');
  await page.click('#chat-open');
  assert.equal(await page.locator('#room').evaluate(r => r.classList.contains('chat-collapsed')), false);
  await browser.close();
  console.log('participant toolbar PASS');
})().catch(error => { console.error(error); process.exit(1); });
