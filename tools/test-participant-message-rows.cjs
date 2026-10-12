// Participant message rows: a message from the same speaker as the one above is merged (no avatar/header), an edited message ends with [편집 완료], time is #757575.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderState({ roomTitle: 't', gmOnline: true, channels: [{ id: 'main', label: '메인' }], messages: [
      { id: '1', author: 'A', text: '첫', channel: 'main', createdAt: '2026-10-08T01:00:00Z' },
      { id: '2', author: 'A', text: '같은 화자', channel: 'main', createdAt: '2026-10-08T03:00:00Z', edited: true },
      { id: '3', author: 'B', text: '다른 화자', channel: 'main', createdAt: '2026-10-08T03:01:00Z' },
      { id: '4', author: 'A', text: '다시 A', channel: 'main', createdAt: '2026-10-08T03:02:00Z' }] });
  });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#messages li')].map(li => ({ merged: li.classList.contains('merged'), head: getComputedStyle(li.querySelector('h6')).display, edited: li.querySelector('.msg-edited')?.textContent || '' })));
  assert.deepEqual(rows.map(r => r.merged), [false, true, false, false], 'only a run of the same speaker is merged');
  assert.equal(rows[1].head, 'none'); assert.equal(rows[0].head, 'block');
  assert.equal(rows[1].edited, ' [편집 완료]'); assert.equal(rows[0].edited, '');
  const color = await page.evaluate(() => getComputedStyle(document.querySelector('#messages .msg-time')).color + '|' + getComputedStyle(document.querySelector('.msg-edited')).color);
  assert.equal(color, 'rgb(117, 117, 117)|rgb(117, 117, 117)');
  // time like CCFOLIA (date-fns formatRelative, Japanese): today / yesterday / weekday of the last days / date only
  const times = await page.evaluate(() => { const now = new Date(2026, 9, 12, 12, 0); const at = (day, h, m) => new Date(2026, 9, day, h, m).toISOString(); return [messageTime(at(12, 9, 5), now), messageTime(at(11, 23, 10), now), messageTime(at(7, 20, 14), now), messageTime(at(6, 20, 14), now), messageTime(at(5, 20, 14), now), messageTime(at(2, 11, 34), now)]; });
  assert.deepEqual(times, ['今日 9:05', '昨日 23:10', '先週 水曜日 20:14', '先週 火曜日 20:14', '2026/10/05', '2026/10/02']);
  // an envelope may stand before the visible text (Roll20 header rows); a stale envelope (edited text) shows the visible text plain
  const START = '⁣⁣⁣', END = '⁢⁢⁢', MAP = ['​', '‌', '‍', '⁠'];
  const encode = obj => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = START; for (let i = 0; i < bits.length; i += 2) out += MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + END; };
  const env = encode({ v: 1, text: '내용', formatRuns: [{ start: 0, end: 2, style: { bold: true, backgroundColor: 'rgb(155, 207, 196)' } }], alignRuns: [], blockStyle: {} });
  const decoded = await page.evaluate(([front, stale]) => { const a = document.createElement('p'), b = document.createElement('p'); renderRich(a, front); renderRich(b, stale); return { frontBg: a.querySelector('span')?.style.backgroundColor, frontText: a.textContent, staleText: b.textContent, staleSpan: !!b.querySelector('span') }; }, [env + '내용', '바뀐 글' + env]);
  assert.equal(decoded.frontText, '내용'); assert.equal(decoded.frontBg, 'rgb(155, 207, 196)', 'envelope in front of the text still formats it');
  assert.equal(decoded.staleText, '바뀐 글'); assert.equal(decoded.staleSpan, false, 'an envelope that no longer matches the text is not applied');
  await browser.close();
  console.log('participant message rows PASS');
})().catch(error => { console.error(error); process.exit(1); });
