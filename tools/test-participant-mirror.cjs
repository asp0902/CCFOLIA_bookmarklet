// Participant side of native mirroring: templates + CSS from the relay are drawn in a shadow root; data goes in as text; unsafe parts never arrive; without a mirror the built-in rows stay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const violations = [];
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  const templates = {
    chatShell: '<ul class="MuiList-root"><div data-cm-slot="rows"></div></ul>',
    chatHeader: '<header class="hd"><div class="bar"><button class="cl" data-cm-slot="close"></button><h6 class="ttl">룸 채팅</h6><button class="mn" data-cm-slot="menu"></button></div></header>',
    chatTabsShell: '<header class="th"><div class="tl" role="tablist" data-cm-slot="tabs"></div></header>',
    chatTabOn: '<button class="tab on" role="tab" aria-selected="true" data-cm-slot="label2"><span class="lb" data-cm-slot="label"><span class="bd"></span></span></button>',
    chatTabIdle: '<button class="tab idle" role="button"><span class="lb" data-cm-slot="label"><span class="bd"></span></span></button>',
    chatTabUnread: '<button class="tab unread" role="button"><span class="lb" data-cm-slot="label"><span class="bd"></span></span></button>',
    topBar: '<header class="MuiAppBar-positionFixed tb" style="position:fixed"><button class="mn" data-cm-slot="menu" aria-label="룸 메뉴"><h6 data-cm-slot="title"><span data-cm-slot="subtitle"></span></h6></button><button class="ch" data-cm-slot="chars" aria-label="내 캐릭터 목록"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></button><button class="ac" data-cm-slot="account"><div><img data-cm-slot="avatar"></div></button><button class="co" data-cm-slot="chatOpen"></button></header>',
    chatRow: '<div class="wrap"><div class="MuiListItem-root row" style="display:flex;padding:8px"><div class="av"><img class="MuiAvatar-img" data-cm-slot="icon"></div><div class="tx"><h6 class="nm" data-cm-slot="name" style="color:red"><span class="tm" data-cm-slot="time"></span></h6><p class="bd" data-cm-slot="body"></p></div></div><hr class="dv"></div>'
  };
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/mirror.json')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ templates }) });
    if (u.pathname.endsWith('/mirror.css')) return route.fulfill({ contentType: 'text/css', body: '.row .nm{font-weight:700}.tm{color:rgb(117,117,117)}.dv{display:none}' });
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src https://storage.ccfolia-cdn.net data:" } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const messages = [
    { id: '1', author: '<b>A</b>', text: '안녕', channel: 'main', createdAt: '2026-10-08T01:00:00Z', icon: 'https://storage.ccfolia-cdn.net/a.png', color: '#ff8800' },
    { id: '2', author: 'B', text: '판정', channel: 'main', createdAt: '2026-10-08T01:01:00Z', edited: true, roll: { result: '(1D100) ＞ 3' }, icon: 'https://evil.test/x.png' }];
  const state = mirror => ({ roomTitle: 't', gmOnline: true, channels: [{ id: 'main', label: '메인' }], messages, mirror });
  await page.evaluate(s => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderState(s); }, state(undefined));
  // before the mirror arrives: built-in rows
  assert.equal(await page.locator('#messages li').count(), 2);
  assert.equal(await page.evaluate(() => document.getElementById('messages').hidden), false);
  // the mirror arrives
  const info = { cssHash: 'h1', tplHash: 't1', fontLinks: ['https://fonts.googleapis.com/css2?family=Roboto', 'https://evil.test/x.css'] };
  await page.evaluate(s => renderState(s), state(info));
  await page.waitForFunction(() => cmMirror.has('chatShell') && cmMirror.has('chatHeader'));
  await page.evaluate(s => renderState(s), state({ ...info, fontLinks: [] }));
  const result = await page.evaluate(() => {
    const shadow = document.getElementById('messages-host').shadowRoot;
    const rows = [...shadow.querySelectorAll('.row')];
    const cs = el => getComputedStyle(el);
    return {
      hiddenOld: document.getElementById('messages').hidden, n: rows.length,
      names: rows.map(r => r.querySelector('.nm').firstChild.textContent), nameHtml: rows[0].querySelector('.nm').innerHTML,
      colors: rows.map(r => cs(r.querySelector('.nm')).color), bold: cs(rows[0].querySelector('.nm')).fontWeight,
      time: rows[0].querySelector('.tm').textContent.startsWith(' - '), display: cs(rows[0]).display,
      icons: rows.map(r => r.querySelector('img').getAttribute('src')), body2: rows[1].querySelector('.bd').textContent,
      edited: !!rows[1].querySelector('.msg-edited'), dividerHidden: cs(shadow.querySelector('.dv')).display,
      fonts: [...document.head.querySelectorAll('link')].map(l => l.href), leaked: !!document.querySelector('.MuiList-root')
    };
  });
  assert.equal(result.hiddenOld, true); assert.equal(result.n, 2);
  assert.deepEqual(result.names, ['<b>A</b>', 'B'], 'names are text, never markup');
  assert(!result.nameHtml.includes('<b>'), 'no element is created from data');
  assert.equal(result.colors[0], 'rgb(255, 136, 0)', 'the sender colour is applied from the message');
  assert.equal(result.bold, '700', 'the mirrored CSS applies inside the shadow root');
  assert.equal(result.display, 'flex', 'template inline style applied through the CSSOM');
  assert.equal(result.icons[0], 'https://storage.ccfolia-cdn.net/a.png'); assert(result.icons[1].startsWith('data:image/gif'), 'a message without a (CDN) icon gets a blank image, never the foreign address and no broken-image frame');
  assert(result.body2.includes('판정') && result.body2.includes('(1D100) ＞ 3') && result.edited);
  assert.equal(result.dividerHidden, 'none');
  assert(result.fonts.includes('https://fonts.googleapis.com/css2?family=Roboto') && !result.fonts.some(href => href.includes('evil.test')), 'only Google Fonts links');
  assert.equal(result.leaked, false, 'the mirror does not leak into the page DOM');
  // header and tabs
  const chrome = await page.evaluate(() => {
    const head = document.getElementById('chat-head-host').shadowRoot, tabs = document.getElementById('chat-tabs-host').shadowRoot;
    return { oldTitleHidden: document.querySelector('.chat > h2').hidden, title: head.querySelector('.ttl').textContent, tabsOld: document.getElementById('chat-tabs').hidden,
      tabs: [...tabs.querySelectorAll('.tab')].map(t => t.className + ':' + t.querySelector('.lb').firstChild.textContent) };
  });
  assert.equal(chrome.oldTitleHidden, true); assert.equal(chrome.title, '룸 채팅'); assert.equal(chrome.tabsOld, true);
  assert.deepEqual(chrome.tabs, ['tab on:메인']);
  // the menu button of the mirrored header opens the log menu; the close button closes the chat
  await page.evaluate(() => document.getElementById('chat-head-host').shadowRoot.querySelector('.mn').click());
  assert.equal(await page.locator('.menu-item').count(), 2, 'chat menu opened from the mirrored button');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('chat-head-host').shadowRoot.querySelector('.cl').click());
  assert.equal(await page.evaluate(() => document.getElementById('room').classList.contains('chat-collapsed')), true, 'close button works');
  // top bar
  const top = await page.evaluate(() => {
    const root = document.getElementById('top-host').shadowRoot;
    const bar = root.querySelector('header');
    return { legacyHidden: document.querySelector('#room > header').hidden, position: getComputedStyle(bar).position, title: root.querySelector('h6').firstChild.textContent,
      buttons: [...root.querySelectorAll('button')].map(b => b.className + (b.hidden ? '(hidden)' : '')), letter: root.querySelector('.ac span').textContent, hasImg: !!root.querySelector('img') };
  });
  assert.equal(top.legacyHidden, true); assert.equal(top.position, 'relative', 'a fixed AppBar is laid out in flow inside the page');
  assert.equal(top.title, 't'); assert.deepEqual(top.buttons, ['mn', 'ch', 'ch(hidden)', 'ac', 'co(hidden)'], 'handout copy added after the characters button, hidden without a handout; chat-open follows the built-in state');
  assert.equal(top.hasImg, false, 'the participant avatar is a letter');
  await page.evaluate(() => document.getElementById('top-host').shadowRoot.querySelector('.ch').click());
  assert.equal(await page.locator('.dlg').count(), 1, 'the character list button opens the built-in dialog');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('top-host').shadowRoot.querySelector('.mn').click());
  assert(await page.locator('.menu-item').count() >= 1, 'the room menu opens from the mirrored button');
  await page.keyboard.press('Escape');
  assert.deepEqual(violations.filter(v => !/fonts\.googleapis|evil\.test\/x\.png/.test(v)), [], 'no CSP violations');
  await browser.close();
  console.log('participant mirror PASS');
})().catch(error => { console.error(error); process.exit(1); });
