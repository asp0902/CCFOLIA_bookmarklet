// A participant's own handouts: the list the relay gives them, a popup for what is new, the dot on the header button, formatted bodies (no inline style in the markup, CSP), the secret part set apart.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const violations = [];
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  let items = [{ id: 'h1', title: '지도', html: '<p style="color:#ff0000">공개 <b>본문</b></p><a href="https://example.com/x">링크</a>', secretHtml: '<p>비밀 본문</p>', folder: '1막', order: 1, updatedAt: 't1' }, { id: 'h2', title: '공지', html: '<p>모두에게</p>', secretHtml: '', folder: '', order: 0, updatedAt: 't1' }];
  const csp = "default-src 'self'; script-src 'self' https://www.youtube.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https://storage.ccfolia-cdn.net data:; connect-src 'self'";
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/my-handouts')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items }) });
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ headers: f === 'index.html' ? { 'Content-Security-Policy': csp } : {}, body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderState({ roomTitle: 't', gmOnline: true, messages: [], channels: [], scene: { fieldWidth: 40, fieldHeight: 20, items: [], characters: [] } }); });
  // the first load does not pop anything up by itself (new ones come with the GM's share signal): the header button shows them with a dot; the signal opens the shared one
  await page.waitForFunction(() => !document.getElementById('handout-open').hidden, null, { timeout: 10000 });
  assert.equal(await page.locator('.dlg').count(), 0, 'no popup from the list alone');
  assert.equal(await page.evaluate(() => document.getElementById('handout-open').classList.contains('has-new')), true);
  await page.evaluate(() => window.handleRelayMessage ? 0 : 0);
  await page.evaluate(() => popupHandout('h1'));
  await page.waitForSelector('.dlg h2', { timeout: 10000 });
  await page.evaluate(() => popupHandout('h1'));
  assert.equal(await page.locator('.dlg').count(), 1, 'the signal twice does not stack a second dialog');
  assert.equal(await page.locator('.dlg h2').textContent(), '지도');
  assert.equal(await page.locator('.dlg .handout-body b').first().textContent(), '본문');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dlg .handout-body p')).color), 'rgb(255, 0, 0)', 'style applied through the CSSOM');
  assert.equal(await page.locator('.dlg .handout-secret').innerText().then(t => /비밀 본문/.test(t)), true, 'the secret part is set apart');
  assert.equal(await page.locator('.dlg .handout-secret h3').textContent(), '비밀', 'the secret part is headed with just 비밀');
  assert.equal(await page.getAttribute('.dlg a', 'target'), '_blank');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.dlg'));
  assert.equal(await page.evaluate(() => document.getElementById('handout-open').hidden), false);
  assert.equal(await page.evaluate(() => document.getElementById('handout-open').classList.contains('has-new')), true, 'h2 was not opened yet');
  // the list groups by folder, marks new ones, opens one
  await page.evaluate(() => document.getElementById('handout-open').click());
  assert.deepEqual(await page.locator('.dlg .handout-row .handout-title').allTextContents(), ['공지', '지도']);
  assert.equal(await page.locator('.dlg .handout-folder').textContent(), '1막');
  assert.equal(await page.locator('.dlg .handout-dot').count(), 1, 'only the unopened one has a dot');
  await page.click('.dlg .handout-row:has-text("공지")');
  await page.waitForSelector('.dlg h2:text("공지")');
  assert.equal(await page.locator('.dlg .handout-secret').count(), 0, 'no secret part for this one');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('handout-open').classList.contains('has-new')), false);
  // a changed handout pushed by the relay pops up again, an unchanged one does not
  await page.evaluate(() => applyMyHandouts([{ id: 'h1', title: '지도', html: '<p>바뀜</p>', secretHtml: '', folder: '1막', order: 1, updatedAt: 't2' }, { id: 'h2', title: '공지', html: '<p>모두에게</p>', secretHtml: '', folder: '', order: 0, updatedAt: 't1' }], true));
  await page.waitForSelector('.dlg h2:text("지도")');
  assert.match(await page.locator('.dlg .handout-body').first().innerText(), /바뀜/);
  assert.equal(await page.locator('.dlg .handout-secret').count(), 0, 'the secret part is gone when the permission is');
  await page.keyboard.press('Escape');
  await page.evaluate(() => applyMyHandouts([{ id: 'h2', title: '공지', html: '<p>모두에게</p>', secretHtml: '', folder: '', order: 0, updatedAt: 't1' }], true));
  assert.equal(await page.locator('.dlg').count(), 0, 'nothing new: no popup');
  // nothing left: the button goes away (no legacy handout)
  await page.evaluate(() => applyMyHandouts([], true));
  assert.equal(await page.evaluate(() => document.getElementById('handout-open').hidden), true);
  // the shared public handout pops up when new or changed, not again after every reload
  await page.evaluate(() => syncHandoutPopup({ id: 'p1', title: '공개', bodyText: 'x', updatedAt: 't1' }));
  assert.equal(await page.evaluate(() => document.getElementById('handout').classList.contains('open')), true);
  await page.reload();
  await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; syncHandoutPopup({ id: 'p1', title: '공개', bodyText: 'x', updatedAt: 't1' }); });
  assert.equal(await page.evaluate(() => document.getElementById('handout').classList.contains('open')), false, 'seen before: no popup after a reload');
  await page.evaluate(() => syncHandoutPopup({ id: 'p1', title: '공개', bodyText: 'y', updatedAt: 't2' }));
  assert.equal(await page.evaluate(() => document.getElementById('handout').classList.contains('open')), true, 'changed: pops up again');
  assert.deepEqual(violations, [], 'no CSP violations');
  // a newcomer (approved at 10:00) is not met with what was shared before: those are in the list with a dot, only what is shared or changed afterwards pops up
  await page.evaluate(() => { approvedAt = '2026-10-13T10:00:00.000Z'; localStorage.clear(); applyMyHandouts([], true); });
  await page.evaluate(() => applyMyHandouts([{ id: 'o1', title: '먼저 공유', html: '<p>a</p>', secretHtml: '', folder: '', order: 0, updatedAt: '2026-10-13T09:00:00.000Z' }], true));
  assert.equal(await page.locator('.dlg').count(), 0, 'shared before they came in: no popup');
  assert.equal(await page.evaluate(() => document.getElementById('handout-open').classList.contains('has-new')), true, 'but it is unread in the list');
  const item = (id, title, at) => ({ id, title, html: '<p>' + id + '</p>', secretHtml: '', folder: '', order: 0, updatedAt: at });
  await page.evaluate(([a, b]) => applyMyHandouts([a, b], true), [item('o1', '먼저 공유', '2026-10-13T09:00:00.000Z'), item('o2', '나중 공유', '2026-10-13T11:00:00.000Z')]);
  assert.equal(await page.locator('.dlg').count(), 0, 'a new one in the list does not pop by itself: the GM share signal does');
  await page.evaluate(([a, b]) => applyMyHandouts([a, b], true), [item('o1', '먼저 공유', '2026-10-13T09:30:00.000Z'), item('o2', '나중 공유', '2026-10-13T12:00:00.000Z')]);
  await page.waitForSelector('.dlg h2:text("나중 공유")');
  assert.equal(await page.locator('.dlg').count(), 1, 'only the one changed after the approval pops up (the other changed before it)');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { syncHandoutPopup({}); localStorage.removeItem('capybara-handout-legacy-shown'); syncHandoutPopup({ id: 'p9', title: '이전', bodyText: 'x', updatedAt: '2026-10-13T08:00:00.000Z' }); });
  assert.equal(await page.evaluate(() => document.getElementById('handout').classList.contains('open')), false, 'the shared handout from before: no popup');
  await page.evaluate(() => { localStorage.removeItem('capybara-handout-legacy-shown'); syncHandoutPopup({ id: 'p9', title: '이전', bodyText: 'y', updatedAt: '2026-10-13T12:00:00.000Z' }); });
  assert.equal(await page.evaluate(() => document.getElementById('handout').classList.contains('open')), true, 'changed after they came in: popup');
  await browser.close();
  console.log('participant handouts PASS');
})().catch(error => { console.error(error); process.exit(1); });
