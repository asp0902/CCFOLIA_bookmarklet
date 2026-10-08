// Participant log export: every tab this page holds becomes a file (HTML with the chat formatting, or plain text), downloaded from the room menu.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const START = '⁣⁣⁣', END = '⁢⁢⁢', MAP = ['​', '‌', '‍', '⁠'];
const encode = obj => {
  const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0');
  let out = START; for (let i = 0; i < bits.length; i += 2) out += MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)];
  return out + END;
};
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const bold = '굵은 글' + encode({ v: 1, text: '굵은 글', formatRuns: [{ start: 0, end: 2, style: { bold: true } }], alignRuns: [], blockStyle: {} });
  await page.evaluate(bold => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    current = { roomTitle: '테스트/룸', gmOnline: true, channels: [{ id: 'main', label: '메인' }, { id: 'info', label: '정보' }, { id: 'other', label: '잡담' }], messages: [
      { id: '1', author: 'GM', text: '안녕하세요', channel: 'main', createdAt: '2026-10-08T01:02:00Z', color: '#ff8800' },
      { id: '2', author: 'A', text: bold, channel: 'main', createdAt: '2026-10-08T01:03:00Z' },
      { id: '3', author: 'B', text: '1d6', channel: 'main', createdAt: '2026-10-08T01:04:00Z', roll: { result: '(1D6) ＞ 4', success: false } },
      { id: '4', author: 'GM', text: '정보 탭 글', channel: 'info', createdAt: '2026-10-08T01:05:00Z' }] };
    renderState(current);
  }, bold);
  // the built texts
  const text = await page.evaluate(() => buildLogText());
  assert(text.includes('# 메인') && text.includes('# 정보'), 'tabs with messages are listed');
  assert(!text.includes('# 잡담'), 'an empty tab is left out');
  assert(text.includes('GM: 안녕하세요') && text.includes('A: 굵은 글') && text.includes('B: 1d6 (1D6) ＞ 4'), 'author, text (envelope removed) and dice result');
  assert(!/[⁢⁣]/.test(text), 'no envelope characters in the text file');
  const html = await page.evaluate(() => buildLogHtml());
  assert(html.startsWith('<!doctype html>') && html.includes('<h2>메인</h2>') && html.includes('<h2>정보</h2>') && !html.includes('<h2>잡담</h2>'));
  assert(/<span[^>]*font-weight: ?700[^>]*>굵은/.test(html), 'the chat formatting is rendered in the HTML file');
  assert(html.includes('color: rgb(255, 136, 0)') || html.includes('color:#ff8800') || html.includes('rgb(255, 136, 0)'), 'the name colour is kept');
  assert(html.includes('(1D6) ＞ 4'), 'the dice result is in the HTML');
  // downloading from the room menu
  const downloadOf = async label => {
    await page.click('#room-menu-btn');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`.menu-item:has-text("${label}")`)]);
    return { name: download.suggestedFilename(), body: fs.readFileSync(await download.path(), 'utf8') };
  };
  const htmlFile = await downloadOf('로그 내보내기 (HTML)');
  assert.match(htmlFile.name, /^테스트_룸-log-\d{8}-\d{4}\.html$/, 'file name: room title (unsafe characters replaced), date and time');
  assert(htmlFile.body.includes('<h2>메인</h2>'));
  const txtFile = await downloadOf('로그 내보내기 (텍스트)');
  assert.match(txtFile.name, /-log-\d{8}-\d{4}\.txt$/);
  assert(txtFile.body.includes('# 정보'));
  await browser.close();
  console.log('participant log export PASS');
})().catch(error => { console.error(error); process.exit(1); });
