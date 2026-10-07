const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Enter-to-send behaviour of the participant chat box. Runs against a local `wrangler dev` worker.
(async () => {
  const base = process.env.RELAY_BASE_URL || 'http://127.0.0.1:8790';
  const token = process.env.RELAY_GM_TOKEN || 'test-gm-token';
  const roomId = `enter-${Date.now().toString(36)}`;
  const admin = (url, options = {}) => fetch(base + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers } });
  const post = (url, body) => admin(url, { method: 'POST', body: JSON.stringify(body) });
  const commands = async () => (await (await admin(`/api/admin/rooms/${roomId}/commands`)).json()).commands;
  const connect = await post('/api/connect', { roomId, roomTitle: 'Enter 검사', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
  const inviteUrl = (await connect.json()).inviteUrl;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const input = page.locator('#chat-input');
  try {
    await page.goto(inviteUrl);
    await page.getByLabel('희망자 이름').fill('엔터 참가자');
    await page.getByRole('button', { name: '동의' }).click();
    await page.getByText('GM 승인 대기 중').waitFor();
    const participantId = (await (await admin(`/api/admin/rooms/${roomId}/participants`)).json()).participants[0].id;
    await post(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'approve' });
    await page.getByRole('heading', { name: '채팅' }).waitFor();
    assert.equal(await input.getAttribute('placeholder'), '메시지를 입력', 'placeholder matches the original CCFOLIA wording');
    assert.match(await input.getAttribute('title'), /Enter.*Shift\+Enter/, 'the key hint stays available as a tooltip');

    // Enter sends and clears the box immediately.
    await input.fill('엔터로 보냄');
    await input.press('Enter');
    assert.equal(await input.inputValue(), '', 'box cleared right away');
    for (let waited = 0; (await commands()).length < 1 && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    let pending = await commands();
    assert.deepEqual(pending.map(command => command.text), ['엔터로 보냄']);

    // Shift+Enter is a newline and does not send; the final Enter sends the multi-line text once.
    await input.click();
    await page.keyboard.type('첫 줄');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('둘째 줄');
    assert.equal(await input.inputValue(), '첫 줄\n둘째 줄');
    assert.equal((await commands()).length, 1, 'Shift+Enter does not send');
    await page.keyboard.press('Enter');
    for (let waited = 0; (await commands()).length < 2 && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    pending = await commands();
    assert.equal(pending[1].text, '첫 줄\n둘째 줄');

    // Enter while an IME composition is active (confirming Korean text) must not send and must not be swallowed.
    await input.fill('한글 조합 중');
    const composing = await input.evaluate(element => { const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }); element.dispatchEvent(event); return { prevented: event.defaultPrevented }; });
    const legacy229 = await input.evaluate(element => { const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }); element.dispatchEvent(event); return { prevented: event.defaultPrevented }; });
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(composing.prevented, false);
    assert.equal(legacy229.prevented, false);
    assert.equal((await commands()).length, 2, 'composition Enter does not send');
    assert.equal(await input.inputValue(), '한글 조합 중');

    // Two quick Enters send once; empty / whitespace-only Enter sends nothing.
    await input.fill('빠른 두 번');
    await Promise.all([input.press('Enter'), input.press('Enter')]);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal((await commands()).filter(command => command.text === '빠른 두 번').length, 1, 'no duplicate on double Enter');
    const before = (await commands()).length;
    await input.fill('   ');
    await input.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal((await commands()).length, before, 'blank message is not sent');

    // A failed send gives the text back and shows the error.
    await page.route(`**/api/rooms/${roomId}/messages`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"일시적 오류"}' }));
    await input.fill('실패할 글');
    await input.press('Enter');
    await page.getByText('일시적 오류').waitFor({ timeout: 3000 });
    assert.equal(await input.inputValue(), '실패할 글', 'text restored after a failed send');
    await page.unroute(`**/api/rooms/${roomId}/messages`);
    await input.press('Enter');
    for (let waited = 0; !(await commands()).some(command => command.text === '실패할 글') && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    assert((await commands()).some(command => command.text === '실패할 글'), 'retry with Enter works');

    // The send button still works.
    await input.fill('버튼으로 보냄');
    await page.getByRole('button', { name: '전송' }).click();
    for (let waited = 0; !(await commands()).some(command => command.text === '버튼으로 보냄') && waited < 2000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    assert((await commands()).some(command => command.text === '버튼으로 보냄'));
    console.log('participant enter-to-send: Enter sends, Shift+Enter newline, IME-safe, no double send, failure restores text, button works PASS');
  } finally {
    await post('/api/share/stop', { roomId });
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
