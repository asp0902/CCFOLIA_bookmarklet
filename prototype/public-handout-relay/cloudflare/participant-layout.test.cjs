const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// The participant page must fit the window on desktop (no page-level vertical scrollbar; the chat list and the
// session area scroll inside their own boxes). Runs against a local `wrangler dev` worker.
(async () => {
  const base = process.env.RELAY_BASE_URL || 'http://127.0.0.1:8790';
  const token = process.env.RELAY_GM_TOKEN || 'test-gm-token';
  const roomId = `layout-${Date.now().toString(36)}`;
  const admin = (url, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const post = (url, body) => admin(url, { method: 'POST', body: JSON.stringify(body) });
  const connect = await post('/api/connect', { roomId, roomTitle: '레이아웃 검사', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
  const inviteUrl = (await connect.json()).inviteUrl;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const metrics = () => page.evaluate(() => {
    const box = selector => { const element = document.querySelector(selector); const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, scrollable: element.scrollHeight > element.clientHeight + 1 }; };
    return {
      pageScroll: document.documentElement.scrollHeight - window.innerHeight,
      pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      innerHeight: window.innerHeight,
      messages: box('#messages'), input: box('#chat-input'), send: box('#chat-form button'), stage: box('.stage'),
    };
  });
  try {
    await page.goto(inviteUrl);
    await page.getByLabel('표시 이름').fill('레이아웃 참가자');
    await page.getByLabel(/정보 처리/).check();
    await page.getByRole('button', { name: '참가 요청' }).click();
    await page.getByText('GM 승인 대기 중').waitFor();
    const participantId = (await (await admin(`/api/admin/rooms/${roomId}/participants`)).json()).participants[0].id;
    await post(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'approve' });
    await page.getByRole('heading', { name: '채팅' }).waitFor();

    // Plenty of chat and a long public handout so that both areas overflow their boxes.
    for (let index = 1; index <= 60; index++) {
      await post(`/api/admin/rooms/${roomId}/messages`, { id: `m${index}`, author: '-', text: index % 7 === 0 ? `긴 메시지 ${index} ${'가나다라마바사 '.repeat(25)}` : `메시지 ${index}`, createdAt: new Date().toISOString() });
    }
    await post('/api/share', { roomId, handout: { id: 'h1', title: '긴 핸드아웃', bodyText: Array.from({ length: 80 }, (_, line) => `핸드아웃 본문 ${line + 1}줄`).join('\n') } });
    await page.getByText('메시지 60').waitFor();
    await page.getByText('긴 핸드아웃').waitFor();

    const sizes = [[1280, 800], [1366, 768], [1024, 600], [920, 900], [1840, 1000], [1840, 1830], [721, 700]];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(100);
      const m = await metrics();
      const label = `${width}x${height}`;
      assert(m.pageScroll <= 1, `${label}: no page-level vertical scrollbar (extra ${m.pageScroll}px)`);
      assert(m.pageScrollX <= 0, `${label}: no horizontal overflow`);
      assert(m.messages.scrollable, `${label}: the chat list scrolls inside its own box`);
      assert(m.stage.scrollable, `${label}: the long handout scrolls inside the session area`);
      assert(m.input.bottom <= m.innerHeight + 1 && m.send.bottom <= m.innerHeight + 1, `${label}: message input stays visible`);
      assert(m.messages.bottom <= m.input.top + 1, `${label}: chat list ends above the input`);
    }

    // The chat keeps following new messages while the user is at the bottom, and does not jump when reading history.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => { const list = document.getElementById('messages'); return list.scrollHeight - list.scrollTop - list.clientHeight < 5; });
    await page.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
    await post(`/api/admin/rooms/${roomId}/messages`, { id: 'late', author: '-', text: '읽는 중에 도착', createdAt: new Date().toISOString() });
    await page.waitForFunction(() => [...document.querySelectorAll('#messages li')].some(item => item.textContent.includes('읽는 중에 도착')), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('messages').scrollTop), 0, 'history position is kept while reading');

    // Mobile keeps the stacked layout (page scroll is expected there) without horizontal overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    const mobile = await metrics();
    assert(mobile.pageScrollX <= 0, 'mobile: no horizontal overflow');
    console.log(`participant layout: ${sizes.length} desktop sizes fit the window (chat/session scroll internally), mobile stacked PASS`);
  } finally {
    await post('/api/share/stop', { roomId });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
