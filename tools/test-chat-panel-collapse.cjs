// chat-panel 0.5.36: a double click on the title bar folds the panel to the bar (list / tabs / input / format bar hidden) and unfolds it again; not on the gear;
// remembered per panel across a reload; a new message while folded puts a dot on the title.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    const load = async () => {
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(() => {
        const now = Math.floor(Date.now() / 1000);
        const entities = { m1: { name: '앨리스', text: '하나', channel: 'main', createdAt: { seconds: now - 9, nanoseconds: 0 } } };
        const listeners = new Set();
        const state = { entities: { roomMessages: { entities, ids: ['m1'], idsGroupBy: { main: ['m1'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
        window.__add = (id, text) => { state.entities.roomMessages = { ...state.entities.roomMessages, entities: { ...state.entities.roomMessages.entities, [id]: { name: '앨리스', text, channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } } }, ids: [...state.entities.roomMessages.ids, id], idsGroupBy: { main: [...state.entities.roomMessages.idsGroupBy.main, id] } }; listeners.forEach((fn) => fn()); };
        window.__del = (id) => { const ids = state.entities.roomMessages.ids.filter((x) => x !== id); state.entities.roomMessages = { ...state.entities.roomMessages, ids, idsGroupBy: { main: state.entities.roomMessages.idsGroupBy.main.filter((x) => x !== id) } }; listeners.forEach((fn) => fn()); };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } } } } };
      });
      await page.addScriptTag({ content: source }); await page.waitForTimeout(300);
    };
    await load();
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open()); await page.waitForTimeout(400);
    const box = () => page.evaluate(() => { const p = document.getElementById('ccf-second-chat-panel'), bar = p.querySelector('.ccf-scp-bar'); return { h: Math.round(p.getBoundingClientRect().height), bar: Math.round(bar.getBoundingClientRect().height), list: getComputedStyle(p.querySelector('.ccf-scp-list')).display, folded: p.hasAttribute('data-collapsed'), unread: p.hasAttribute('data-unread') }; });
    const open = await box();
    assert(open.h > 300 && open.list !== 'none', JSON.stringify(open));
    await page.locator('#ccf-second-chat-panel .ccf-scp-title').dblclick();
    let st = await box();
    assert.deepEqual([st.folded, st.list, Math.abs(st.h - st.bar) <= 1], [true, 'none', true], 'folded to the title bar: ' + JSON.stringify(st));
    // a new message while folded: a dot on the title
    await page.evaluate(() => window.__add('m2', '둘')); await page.waitForTimeout(300);
    assert.equal((await box()).unread, true, 'dot for a new message');
    // the gear does not fold / unfold
    await page.locator('#ccf-second-chat-panel .ccf-scp-gear').dispatchEvent('dblclick');
    assert.equal((await box()).folded, true, 'a double click on the gear is ignored');
    // reload: still folded
    await load(); await page.waitForTimeout(300);
    st = await box(); assert.equal(st.folded, true, 'remembered across a reload');
    await page.locator('#ccf-second-chat-panel .ccf-scp-title').dblclick(); await page.waitForTimeout(200);
    st = await box(); assert.deepEqual([st.folded, st.unread, st.list !== 'none', st.h > 300], [false, false, true, true], 'unfolded to the full height: ' + JSON.stringify(st));
    // 0.5.37: unfolding keeps the scroll — at the bottom (also with messages that came while folded) stays at the bottom, otherwise the same position
    for (let i = 3; i < 60; i += 1) await page.evaluate((i) => window.__add('m' + i, '줄 ' + i), i);
    await page.waitForTimeout(400);
    const list = () => page.evaluate(() => { const l = document.querySelector('#ccf-second-chat-panel .ccf-scp-list'); return { top: Math.round(l.scrollTop), gap: Math.round(l.scrollHeight - l.scrollTop - l.clientHeight) }; });
    await page.evaluate(() => { const l = document.querySelector('#ccf-second-chat-panel .ccf-scp-list'); l.scrollTop = l.scrollHeight; }); await page.waitForTimeout(200);
    const title = page.locator('#ccf-second-chat-panel .ccf-scp-title');
    await title.dblclick(); await page.evaluate(() => window.__add('m60', '접힌 동안')); await page.waitForTimeout(300);
    await title.dblclick(); await page.waitForTimeout(300);
    let l = await list();
    assert(l.gap <= 3 && l.top > 0, 'at the bottom before -> at the bottom after, new message included: ' + JSON.stringify(l));
    await page.evaluate(() => { const l = document.querySelector('#ccf-second-chat-panel .ccf-scp-list'); l.scrollTop = Math.round(l.scrollHeight / 2); l.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(300);
    const mid = await list();
    assert(mid.gap > 100, 'scrolled up: ' + JSON.stringify(mid));
    // while folded the list is drawn again from scratch (a message removed): unfolding still returns to the same place
    await title.dblclick(); await page.waitForTimeout(200);
    await page.evaluate(() => window.__del('m60')); await page.waitForTimeout(300);
    await title.dblclick(); await page.waitForTimeout(300);
    l = await list();
    assert(Math.abs(l.top - mid.top) <= 2, 'same position after unfolding: ' + JSON.stringify({ mid, l }));
    // a folded list has height 0 and always looks "short": it must not load older messages then (that piled history above and the list jumped up on unfolding)
    assert.match(source, /function fillIfShort\(\) \{\s*if \(!listEl \|\| collapsed \|\|/);
    assert.doesNotMatch(source, /safeLayout\(\); restoreScroll\(\);/, 'restoreScroll is local to the list drawing (ReferenceError)');
    assert.deepEqual(errors, []);
    console.log('chat panel collapse PASS', JSON.stringify({ open: open.h, folded: st.bar }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
