const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Regression checks for the participant page against a local `wrangler dev` worker.
//   RELAY_BASE_URL (default http://127.0.0.1:8790), RELAY_GM_TOKEN (default test-gm-token),
//   PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE
(async () => {
  const base = process.env.RELAY_BASE_URL || 'http://127.0.0.1:8790';
  const token = process.env.RELAY_GM_TOKEN || 'test-gm-token';
  const roomId = `res-${Date.now().toString(36)}`;
  const admin = (url, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const post = (url, body) => admin(url, { method: 'POST', body: JSON.stringify(body) });
  const connect = await post('/api/connect', { roomId, roomTitle: '복원력 검사', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
  const inviteUrl = (await connect.json()).inviteUrl;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // Polling-only fallback: the push socket is not available (blocked network, old proxy, ...).
  await page.addInitScript(() => { delete window.WebSocket; });
  try {
    await page.goto(inviteUrl);
    await page.getByLabel('표시 이름').fill('복원력 참가자');
    await page.getByLabel(/정보 처리/).check();
    await page.getByRole('button', { name: '참가 요청' }).click();
    await page.getByText('GM 승인 대기 중').waitFor();
    const participantId = (await (await admin(`/api/admin/rooms/${roomId}/participants`)).json()).participants[0].id;
    await post(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'approve' });
    await post(`/api/admin/rooms/${roomId}/messages`, { id: 'm1', author: 'GM', text: '첫 메시지', createdAt: new Date().toISOString() });
    await page.getByText('첫 메시지').waitFor();

    // Transient server errors (429 / 5xx) must not blank the page.
    let failing = 0;
    await page.route(`**/api/rooms/${roomId}/state`, route => {
      if (failing > 0) { failing--; return route.fulfill({ status: failing % 2 ? 429 : 503, contentType: 'application/json', body: '{"error":"temporary"}' }); }
      return route.continue();
    });
    failing = 4;
    await page.waitForTimeout(7000);
    assert.equal(failing, 0, 'failures were actually served');
    assert.equal(await page.locator('#room').isVisible(), true, 'room stays visible after transient errors');
    await post(`/api/admin/rooms/${roomId}/messages`, { id: 'm2', author: 'GM', text: '복구 후 메시지', createdAt: new Date().toISOString() });
    await page.getByText('복구 후 메시지').waitFor({ timeout: 8000 });

    // GM traffic from the same IP must not exhaust the participant's rate limit.
    for (let batch = 0; batch < 8; batch++) {
      await Promise.all(Array.from({ length: 40 }, () => admin(`/api/admin/rooms/${roomId}/commands`).then(response => response.arrayBuffer())));
    }
    const stateStatus = await page.evaluate(url => fetch(url).then(response => response.status), `/api/rooms/${roomId}/state`);
    assert.equal(stateStatus, 200, 'participant not rate limited by GM polling');

    // Revoking access must be visible on the page (previously 403 was swallowed).
    await post(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'revoke' });
    await page.getByText('접근이 취소되었습니다.').waitFor({ timeout: 8000 });
    assert.equal(await page.locator('#room').isVisible(), false);
    assert.equal(await page.locator('#gate-status').isVisible(), true, 'error message is visible, not a blank page');
    console.log('participant resilience (polling fallback): transient errors, GM rate-limit isolation, revoke display PASS');
  } finally {
    await post('/api/share/stop', { roomId });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
