// chat-panel 0.5.39: on the GM screen a hidden message folds to its name/time line plus one line "숨긴 메시지 · 펼치기" (original chat and the added panel);
// the line opens / closes it (dimmed when open); shown again -> back to normal. The hover buttons (eye + CCFOLIA's reply group) sit on the name/time line:
// the group's vertical centre = the name line's centre (+-2px), also on a long message.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const envelope = (obj) => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
const LONG = '/roll-table\n괴담 장면표\n1D3\n1 첫째 줄이 꽤 길다\n2 둘째\n3 셋째';
const HIDDEN = LONG + envelope({ v: 1, text: LONG, formatRuns: [], alignRuns: [], blockStyle: { hidden: true } });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="background:#222;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="native" style="width:600px;list-style:none;padding:0"></ul></body>' }));
    await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate((hidden) => {
      const now = Math.floor(Date.now() / 1000);
      const entities = { m1: { name: '서술자', text: hidden, channel: 'main', createdAt: { seconds: now - 9, nanoseconds: 0 } }, m2: { name: '서술자', text: '보이는 말', channel: 'main', createdAt: { seconds: now - 5, nanoseconds: 0 } } };
      const state = { app: { state: { roomId: 'test' }, user: { uid: 'u1' } }, entities: { roomMessages: { entities, ids: ['m1', 'm2'], idsGroupBy: { main: ['m1', 'm2'] } }, roomCharacters: { entities: {} }, rooms: { entities: { test: { owner: 'u1' } } } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      // CCFOLIA's own row: name line, text, and the reply group absolutely placed at top 12px
      const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.style.cssText = 'position:relative;padding:8px 16px';
      li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary" style="margin:0;font-size:14px;line-height:20px">서술자 - 22:01</h6><p class="MuiListItemText-secondary" style="margin:0;white-space:pre-wrap"></p></div><div class="native-group" style="position:absolute;top:12px;right:16px;display:flex"><button class="reply" style="width:30px;height:30px">↩</button></div>';
      li.querySelector('p').textContent = hidden;
      document.getElementById('native').appendChild(li);
    }, HIDDEN);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(2500); // GM check (1.5s) + decoration
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open()); await page.waitForTimeout(600);
    const look = (sel) => page.evaluate((sel) => { const row = document.querySelector(sel); const p = row.querySelector('p.MuiListItemText-secondary, .ccf-scp-text'); const fold = row.querySelector('.ccf-hidden-fold'); return { hiddenRow: row.getAttribute('data-ccf-hidden-row'), body: getComputedStyle(p).display, fold: fold && getComputedStyle(fold).display !== 'none' ? fold.textContent : null }; }, sel);
    for (const [label, sel] of [['original', '#native li'], ['panel', '#ccf-second-chat-panel [data-ccf-msg-id="m1"]']]) {
      let l = await look(sel);
      assert.deepEqual(l, { hiddenRow: '1', body: 'none', fold: '숨긴 메시지 · 펼치기' }, label + ': folded to one line: ' + JSON.stringify(l));
      await page.locator(sel + ' .ccf-hidden-fold').click();
      l = await look(sel);
      assert.equal(l.body !== 'none', true, label + ': opened'); assert.equal(l.fold, '숨긴 메시지 · 접기');
      await page.locator(sel + ' .ccf-hidden-fold').click();
      assert.equal((await look(sel)).body, 'none', label + ': closed again');
    }
    // hover: the reply group (with the eye in it) on the name line
    await page.locator('#native li').hover(); await page.waitForTimeout(150);
    const pos = await page.evaluate(() => { const li = document.querySelector('#native li'); const h = li.querySelector('h6').getBoundingClientRect(); const eye = li.querySelector('.ccf-hide-btn'); const g = eye.parentElement.getBoundingClientRect(); return { head: h.top + h.height / 2, group: g.top + g.height / 2, inline: eye.classList.contains('ccf-hide-inline') }; });
    assert.equal(pos.inline, true, 'the eye sits in the native group');
    assert(Math.abs(pos.head - pos.group) <= 2, 'group centre = name line centre: ' + JSON.stringify(pos));
    // the added panel's rows have the divider button too (GM), left of the eye
    const panelButtons = await page.evaluate(() => [...document.querySelectorAll('#ccf-second-chat-panel [data-ccf-msg-id="m2"] button')].map((b) => b.className.split(' ')[0]));
    assert.deepEqual(panelButtons.filter((c) => /ccf-(break|hide)-btn/.test(c)), ['ccf-break-btn', 'ccf-hide-btn'], 'panel: divider + eye: ' + JSON.stringify(panelButtons));
    // shown again: back to normal
    await page.evaluate(() => { const root = document.getElementById('root'); const st = root['__reactContainer$t'].stateNode.current.memoizedProps.store.getState(); st.entities.roomMessages.entities.m1 = { ...st.entities.roomMessages.entities.m1, text: '/roll-table 다시' }; document.querySelector('#native li p').textContent = '/roll-table 다시'; });
    await page.waitForTimeout(2000);
    const back = await page.evaluate(() => { const li = document.querySelector('#native li'); return { hiddenRow: li.getAttribute('data-ccf-hidden-row'), fold: !!li.querySelector('.ccf-hidden-fold'), body: getComputedStyle(li.querySelector('p')).display }; });
    assert.deepEqual(back, { hiddenRow: null, fold: false, body: 'block' }, 'shown again: normal row');
    assert.deepEqual(errors, []);
    console.log('hidden fold PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
