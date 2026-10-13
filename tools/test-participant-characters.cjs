// Characters a participant makes: the + of "내 캐릭터 목록" asks for one, the editor ("캐릭터 편집") saves what is typed, and 복제 / 화면에 추가 / 삭제 are requests for that character only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('dialog', dialog => dialog.accept());
  const posts = [];
  let mine = [];
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/mine')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ characters: mine }) });
    const op = u.pathname.match(/\/objects\/(\w+)$/);
    if (op && route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData());
      posts.push([op[1], body]);
      if (op[1] === 'create') mine = [...mine, { id: 'c1', name: '', memo: '', initiative: 0, externalUrl: '', x: 0, y: 0, width: 4, active: false, status: [{ label: 'HP', value: 0, max: 0 }], params: [{ label: '', value: '' }], commands: '' }];
      if (op[1] === 'delete') mine = mine.filter(c => c.id !== body.id);
      return route.fulfill({ status: 202, contentType: 'application/json', body: '{"accepted":true}' });
    }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderState({ roomTitle: 't', gmOnline: true, messages: [], channels: [], scene: { fieldWidth: 40, fieldHeight: 20, items: [], characters: [] } }); });
  await page.evaluate(() => document.getElementById('char-list-open').click());
  assert.match(await page.locator('#char-window').innerText(), /아직 만든 캐릭터가 없습니다/);
  // + asks for a character with no fields; when it shows up in the list the editor opens
  await page.click('#char-window .cw-btn[aria-label="캐릭터 만들기"]');
  await page.waitForSelector('.dlg h2:text("캐릭터 편집")', { timeout: 15000 });
  assert.deepEqual(posts[0], ['create', { kind: 'character', fields: {} }]);
  // typing saves after a pause: the editor's fields only
  await page.fill('.ce-body input[placeholder="이름"]', '알리스');
  await page.fill('.ce-body textarea[placeholder="캐릭터 메모"]', '용감함');
  await page.waitForFunction(() => document.querySelector('.ce-status')?.textContent === '저장했습니다.', null, { timeout: 5000 });
  const update = posts.find(([op]) => op === 'update')[1];
  assert.equal(update.id, 'c1'); assert.equal(update.fields.name, '알리스'); assert.equal(update.fields.memo, '용감함');
  assert.deepEqual(Object.keys(update.fields).sort(), ['commands', 'externalUrl', 'initiative', 'memo', 'name', 'params', 'size', 'status', 'x', 'y']);
  assert.deepEqual(update.fields.status, [{ label: 'HP', value: 0, max: 0 }]);
  // status rows can be added and removed with + and -
  await page.click('.ce-sec-head button[aria-label="스테이터스 추가"]');
  assert.equal(await page.locator('.ce-body .ce-rows').first().locator('.ce-row3').count(), 2);
  await page.click('.ce-sec-head button[aria-label="스테이터스 줄이기"]');
  assert.equal(await page.locator('.ce-body .ce-rows').first().locator('.ce-row3').count(), 1);
  // put on the screen / duplicate: requests for this character, with the typed position
  await page.fill('.ce-body .ce-row3 input[type=number] >> nth=1', '12');
  await page.click('button:text("화면에 추가")');
  await page.waitForFunction(() => document.querySelector('.ce-status')?.textContent === '화면에 추가했습니다.');
  assert.deepEqual(posts.filter(([op]) => op === 'place').pop(), ['place', { kind: 'character', id: 'c1', x: 12, y: 0 }]);
  await page.click('button:text("복제")');
  assert.deepEqual(posts.filter(([op]) => op === 'duplicate').pop(), ['duplicate', { kind: 'character', id: 'c1' }]);
  // delete asks first, then asks the relay
  await page.click('button:text("삭제")');
  await page.waitForFunction(() => !document.querySelector('.dlg'));
  assert.deepEqual(posts.filter(([op]) => op === 'delete').pop(), ['delete', { kind: 'character', id: 'c1' }]);
  await browser.close();
  console.log('participant characters PASS');
})().catch(error => { console.error(error); process.exit(1); });
