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
  await browser.close();
  console.log('participant message rows PASS');
})().catch(error => { console.error(error); process.exit(1); });
