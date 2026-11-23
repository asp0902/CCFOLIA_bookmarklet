// 플레이룸 입력 영역·글꼴·채팅 행이 코코포리아 실측값과 같은지(docs/playroom-vs-ccfolia-1112.md A1~A3): 화자 줄 32px 밑줄 입력 + 34x34 원형 아이콘 버튼, 전송 64x31 Roboto 13px 700 padding 4px 5px,
// 입력칸 92px Roboto 16px, 하단 문구 Roboto 12px rgb(100,100,100), 채팅 행 아바타 40px 사각 + 이름 14px 700 + 시각 12px rgb(117,117,117) + 본문 14px/20.02px.
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
  await page.addInitScript(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'id-' + Math.random().toString(16).slice(2); });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    const now = Date.now();
    renderState({ roomTitle: 'r', gmOnline: true, channels: [], scene: { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [] },
      messages: [{ id: 'm1', name: '카피', text: '첫 말', color: '#fff', channel: 'main', createdAt: now - 60000 }, { id: 'm2', name: '다른이', text: '두번째 말', color: '#fff', channel: 'main', createdAt: now - 30000 }] });
  });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const cs = (sel) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el), r = el.getBoundingClientRect(); return { s, r }; };
    const out = {};
    const name = cs('#chat-name'); out.name = { x: Math.round(name.r.left), w: Math.round(name.r.width), h: Math.round(name.r.height), bg: name.s.backgroundColor, bb: name.s.borderBottomWidth, lh: name.s.lineHeight, ls: name.s.letterSpacing, family: name.s.fontFamily.split(',')[0] };
    const d4 = cs('.dice-row button[aria-label="D4"]'); out.d4 = [Math.round(d4.r.left), Math.round(d4.r.width), d4.s.padding];
    const footText = cs('.dice-footer span'); out.footY = Math.round(footText.r.top); out.footLs = footText.s.letterSpacing;
    out.scroll = cs('#messages').s.overflowY;
    out.slots = [...document.querySelectorAll('.bgm-slot')].map((n) => [n.textContent, Math.round(n.getBoundingClientRect().left), Math.round(n.getBoundingClientRect().width)]);
    out.vol = Math.round(cs('#bgm-vol').r.left);
    const pal = cs('#pal-btn'); out.pal = [Math.round(pal.r.width), Math.round(pal.r.height), pal.s.borderRadius];
    const face = cs('#speaker-btn'); out.face = [Math.round(face.r.width), Math.round(face.r.height)];
    const send = cs('.dice-row button[type=submit]'); out.send = { size: [Math.round(send.r.width), Math.round(send.r.height)], font: send.s.fontFamily.split(',')[0], px: send.s.fontSize, weight: send.s.fontWeight, pad: send.s.padding, radius: send.s.borderRadius };
    const input = cs('#chat-input'); out.input = { h: Math.round(input.r.height), font: input.s.fontFamily.split(',')[0], px: input.s.fontSize };
    const foot = cs('.dice-footer span'); out.foot = { font: foot.s.fontFamily.split(',')[0], px: foot.s.fontSize, color: foot.s.color };
    const av = cs('#messages .avatar'); out.avatar = [Math.round(av.r.width), Math.round(av.r.height), av.s.borderRadius];
    const time = cs('#messages .msg-time'); out.time = { px: time.s.fontSize, color: time.s.color };
    const body = cs('#messages p'); out.body = { px: body.s.fontSize, lh: body.s.lineHeight };
    const li = cs('#messages li'); out.row = { font: li.s.fontFamily.split(',')[0] };
    return out;
  });
  // measured on ccfolia.com 1.37.6, 1440x900 (docs/playroom-vs-ccfolia-1123.md)
  assert.deepEqual(m.name, { x: 1113, w: 205, h: 40, bg: 'rgba(0, 0, 0, 0.2)', bb: '0px', lh: '23px', ls: '0.15008px', family: 'Roboto' }, 'name: filled 205x40 box, no underline');
  assert.deepEqual(m.d4, [1077, 30, '3px'], 'dice row start'); assert.equal(m.scroll, 'scroll'); assert.equal(m.footLs, '0.39996px');
  assert(Math.abs(m.footY - 874) <= 1, 'Dicebot line y ' + m.footY);
  assert.deepEqual(m.slots, [['BGM01', 929, 64], ['BGM02', 993, 64]], 'BGM slots'); assert.equal(m.vol, 781, 'volume slider');
  assert.deepEqual(m.pal, [34, 34, '50%'], 'icon button 34x34 round'); assert.deepEqual(m.face, [40, 40]);
  assert.deepEqual(m.send, { size: [64, 31], font: 'Roboto', px: '13px', weight: '700', pad: '4px 5px', radius: '4px' }, 'send button');
  assert.deepEqual(m.input, { h: 92, font: 'Roboto', px: '16px' }, 'message box 92px'); assert.deepEqual(m.foot, { font: 'Roboto', px: '12px', color: 'rgb(100, 100, 100)' });
  assert.deepEqual(m.avatar, [40, 40, '0px']); assert.deepEqual(m.time, { px: '12px', color: 'rgb(117, 117, 117)' }); assert.deepEqual(m.body, { px: '14px', lh: '20.02px' }); assert.equal(m.row.font, 'Roboto');
  // narrow window: the chat covers the screen, the input and send stay on screen; >| folds it back to the map
  await page.setViewportSize({ width: 471, height: 863 }); await page.waitForTimeout(200);
  const narrow = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const c = r('.chat'), i = r('#chat-input'), s = r('.dice-row button[type=submit]'); return { chat: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)], head: Math.round(r('.chat h2').height), inputBottom: Math.round(i.bottom), sendRight: Math.round(s.right), list: Math.round(r('#messages').height) }; });
  assert.deepEqual(narrow.chat, [0, 0, 471, 863]); assert.equal(narrow.head, 56); assert(narrow.inputBottom <= 863 - 30 && narrow.sendRight <= 471 && narrow.list > 300, 'narrow ' + JSON.stringify(narrow));
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#bgm-bar')).visibility), 'hidden', 'nothing of the map shows through the chat');
  await page.click('#chat-close'); assert.equal(await page.locator('.chat').isVisible(), false); assert.equal(await page.locator('#scene').isVisible(), true);
  await page.click('#chat-open'); assert.equal(await page.locator('.chat').isVisible(), true);
  console.log('playroom metrics PASS', JSON.stringify(m));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
