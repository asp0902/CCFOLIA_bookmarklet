// 플레이룸: 내 캐릭터가 없어도 BGM 막대는 항상, GM의 공개 캐릭터는 상태 패널 행 1 + 토큰 1로 보이고, secret 만 GM 쪽 필터에서 빠진다(invisible 은 코코포리아에서도 토큰을 그린다: "発言時キャラクターを表示しない").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const draw = (characters) => page.evaluate((characters) => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderState({ roomTitle: 'r', gmOnline: true, channels: [], messages: [], scene: { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters } });
  }, characters);
  // (a) no characters, no BGM: the bar is there, named BGM, volume and mute work
  await draw([]); await page.waitForTimeout(200);
  assert.equal(await page.locator('#bgm-bar').isVisible(), true, 'bar visible without any BGM');
  assert.equal(await page.locator('#bgm-name').textContent(), 'BGM');
  await page.locator('#bgm-vol').evaluate((e) => { e.value = 30; e.dispatchEvent(new Event('input')); });
  assert.equal(await page.locator('#bgm-vol').inputValue(), '30');
  await page.click('#bgm-mute');
  // the progress line (row 2) shows only while a YouTube BGM plays; the first line stays where it is
  const row1Top = () => page.evaluate(() => Math.round(document.querySelector('.bgm-row1').getBoundingClientRect().top));
  const row2Shown = () => page.evaluate(() => getComputedStyle(document.querySelector('.bgm-row2')).display !== 'none');
  const top0 = await row1Top(); assert.equal(await row2Shown(), false, 'no BGM: no progress line');
  await page.evaluate(() => playBgm({ state: 'playing', videoId: 'dQw4w9WgXcQ', startedAt: 1, title: '곡' }));
  assert.equal(await row2Shown(), true, 'playing: progress line'); assert.equal(await row1Top(), top0, 'the first line does not move');
  await page.evaluate(() => playBgm({ state: 'stopped' }));
  assert.equal(await row2Shown(), false, 'stopped: hidden again'); assert.equal(await row1Top(), top0);
  // (b) one public GM character (not mine): one status row, one token
  const gm = { id: 'g1', name: 'GM말', iconUrl: 'https://storage.ccfolia-cdn.net/g.png', x: 48, y: 48, z: 1, angle: 0, width: 4, height: 4, status: [{ label: 'HP', value: 3, max: 6 }], params: [], initiative: 0, hideStatus: false, color: '' };
  await draw([gm]); await page.waitForTimeout(200);
  assert.equal(await page.locator('#scene-status .st-char').count(), 1, 'status panel row');
  assert.equal(await page.locator('[data-kind="character"]').count(), 1, 'token');
  // (c) GM side: secret is dropped, invisible alone is not
  const src = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
  assert.match(src, /\.filter\(\(c\) => c && !c\.secret && c\.active !== false && url\(c\.iconUrl\)\)/, 'scene characters: secret out, invisible stays');
  console.log('playroom default elements PASS');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
