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
    const name = cs('#chat-name'); out.name = { h: Math.round(name.r.height), bg: name.s.backgroundColor, bb: name.s.borderBottomWidth, family: name.s.fontFamily.split(',')[0] };
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
  assert.deepEqual(m.name, { h: 32, bg: 'rgba(0, 0, 0, 0)', bb: '1px', family: 'Roboto' }, 'name input: 32px, no filled box, underline, Roboto');
  assert.deepEqual(m.pal, [34, 34, '50%'], 'icon button 34x34 round'); assert.deepEqual(m.face, [40, 32]);
  assert.deepEqual(m.send, { size: [64, 31], font: 'Roboto', px: '13px', weight: '700', pad: '4px 5px', radius: '4px' }, 'send button');
  assert.deepEqual(m.input, { h: 92, font: 'Roboto', px: '16px' }, 'message box 92px'); assert.deepEqual(m.foot, { font: 'Roboto', px: '12px', color: 'rgb(100, 100, 100)' });
  assert.deepEqual(m.avatar, [40, 40, '0px']); assert.deepEqual(m.time, { px: '12px', color: 'rgb(117, 117, 117)' }); assert.deepEqual(m.body, { px: '14px', lh: '20.02px' }); assert.equal(m.row.font, 'Roboto');
  console.log('playroom metrics PASS', JSON.stringify(m));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
