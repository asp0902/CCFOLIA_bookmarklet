const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Participant page in push mode against a local `wrangler dev` worker (see participant-resilience.test.cjs).
(async () => {
  const base = process.env.RELAY_BASE_URL || 'http://127.0.0.1:8790';
  const token = process.env.RELAY_GM_TOKEN || 'test-gm-token';
  const roomId = `push-${Date.now().toString(36)}`;
  const admin = (url, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const post = (url, body) => admin(url, { method: 'POST', body: JSON.stringify(body) });
  const connect = await post('/api/connect', { roomId, roomTitle: '푸시 검사', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
  const inviteUrl = (await connect.json()).inviteUrl;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const waitText = async (text, ms = 3000) => { const started = Date.now(); await page.getByText(text).first().waitFor({ timeout: ms }); return Date.now() - started; };
  const sockets = [];
  page.on('websocket', socket => sockets.push(socket.url()));
  const cspErrors = [];
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text()); });
  try {
    await page.goto(inviteUrl);
    await page.getByLabel('희망자 이름').fill('푸시 참가자');
    await page.getByRole('button', { name: '동의' }).click();
    await page.getByText('GM 승인 대기 중').waitFor();
    const participantId = (await (await admin(`/api/admin/rooms/${roomId}/participants`)).json()).participants[0].id;
    await post(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'approve' });
    await page.getByRole('heading', { name: '채팅' }).waitFor();
    await page.waitForFunction(() => socketOpen === true, null, { timeout: 5000 });
    assert(sockets.some(url => url.endsWith(`/api/rooms/${roomId}/ws`)), 'participant page opened the push socket');

    // With the socket up, polling is only a 10s safety net: anything faster than that was pushed.
    const sent = Date.now();
    await post(`/api/admin/rooms/${roomId}/messages`, { id: 'p1', author: 'GM', text: '즉시 도착', createdAt: new Date().toISOString() });
    const pushedMs = await waitText('즉시 도착', 1500);
    assert(pushedMs < 1000, `pushed message appeared in ${pushedMs}ms`);

    // Handout and room-title pushes.
    await post('/api/share', { roomId, handout: { id: 'h1', title: '푸시 핸드아웃', bodyText: '본문 내용' } });
    await waitText('푸시 핸드아웃', 1500);
    await post('/api/connect', { roomId, roomTitle: '바뀐 룸 이름' });
    await waitText('바뀐 룸 이름', 1500);

    // Dropped socket: reconnects and catches up on messages sent while it was down.
    await page.evaluate(() => dropSocket(socket));
    await post(`/api/admin/rooms/${roomId}/messages`, { id: 'p2', author: 'GM', text: '끊긴 동안 온 메시지', createdAt: new Date().toISOString() });
    await waitText('끊긴 동안 온 메시지', 5000);
    await page.waitForFunction(() => socketOpen === true, null, { timeout: 6000 });

    // Own chat send still works and the echo comes back through the push path.
    await page.locator('#chat-input').fill('참가자 발언');
    await page.getByRole('button', { name: '전송' }).click();
    const command = (await (await admin(`/api/admin/rooms/${roomId}/commands`)).json()).commands[0];
    assert.equal(command.text, '참가자 발언');
    await post(`/api/admin/rooms/${roomId}/commands/${command.id}/ack`, { status: 'delivered' });
    await waitText('참가자 발언', 1500);

    // Revoke is shown immediately (pushed notice), not after the 10s poll.
    const revokedAt = Date.now();
    await post(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'revoke' });
    await page.getByText('접근이 취소되었습니다.').waitFor({ timeout: 1500 });
    assert(Date.now() - revokedAt < 1500);
    assert.equal(await page.locator('#room').isVisible(), false);
    assert.equal(await page.locator('#gate-status').isVisible(), true);
    assert.deepEqual(cspErrors, [], 'the page works under its own Content-Security-Policy');
    console.log(`participant push: socket opened, message pushed in ${pushedMs}ms, handout/title/reconnect catch-up/echo, immediate revoke PASS`);
  } finally {
    await post('/api/share/stop', { roomId });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
