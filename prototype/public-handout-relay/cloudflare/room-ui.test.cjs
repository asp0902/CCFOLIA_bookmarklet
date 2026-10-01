const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const base = process.env.RELAY_BASE_URL || 'http://127.0.0.1:8790';
  const token = process.env.RELAY_GM_TOKEN || 'test-gm-token';
  const roomId = `ui-${Date.now().toString(36)}`;
  const admin = (url, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const connect = await admin('/api/connect', { method: 'POST', body: JSON.stringify({ roomId, roomTitle: '플레이 룸 UI 검사', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } }) });
  const inviteUrl = (await connect.json()).inviteUrl;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const output = path.join(__dirname, '.artifacts'); fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto(inviteUrl);
    await page.getByLabel('표시 이름').fill('UI 참가자');
    await page.getByLabel(/정보 처리/).check();
    await page.getByRole('button', { name: '참가 요청' }).click();
    const list = await (await admin(`/api/admin/rooms/${roomId}/participants`)).json();
    await admin(`/api/admin/rooms/${roomId}/participants/${list.participants[0].id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) });
    await admin(`/api/admin/rooms/${roomId}/messages`, { method: 'POST', body: JSON.stringify({ id: 'ui-message', author: 'GM', text: '플레이 룸 연결 완료', createdAt: new Date().toISOString() }) });
    await page.getByRole('heading', { name: '채팅' }).waitFor();
    await page.getByText('플레이 룸 연결 완료').waitFor();
    assert.equal(await page.locator('iframe').count(), 0);
    await page.screenshot({ path: path.join(output, 'player-room-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'player-room-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    console.log('player room UI: PASS');
  } finally {
    await admin('/api/share/stop', { method: 'POST', body: JSON.stringify({ roomId }) });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
