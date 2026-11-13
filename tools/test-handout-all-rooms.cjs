// handout 0.1.129: the GM list has a scope "이 룸 / 전체 룸"; 전체 룸 groups this browser's rooms (current room first, room title, count), search runs across rooms,
// another room's handout can be viewed and copied here (permissions / folder empty, the original untouched); loader listRoomData lists a feature's rooms.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const here = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'a1', title: '지금 룸 지도', description: '', gmNotes: '', permissions: {}, order: 1 }] };
      const other = { roomTitle: '두 번째 룸', myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'b1', title: '다른 룸 편지', description: '비밀 편지 내용', gmNotes: '숨은 뜻', permissions: { 눈깅: { view: true } }, folderId: 'f9', order: 3 }, { id: 'b2', title: '다른 룸 지도', description: '', gmNotes: '', permissions: {}, order: 4 }] };
      const rows = [{ featureId: 'ccf-handout', roomKey: 'test', value: here, updatedAt: '2026-11-13T01:00:00Z' }, { featureId: 'ccf-handout', roomKey: 'R2room', value: other, updatedAt: '2026-11-12T01:00:00Z' }, { featureId: 'other-feature', roomKey: 'R3', value: {}, updatedAt: '' }];
      window.__saved = null;
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value: here }), setRoomData: async (f, k, v) => { window.__saved = JSON.parse(JSON.stringify(v)); }, listRoomData: async (f) => rows.filter((r) => r.featureId === f) } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const s = (js, arg) => page.evaluate(([js, arg]) => new Function('s', 'arg', js)(document.querySelector('#ccfolia-handout-root').shadowRoot, arg), [js, arg]);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    assert.equal(await s(`return [...s.querySelectorAll('.scope-btn')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')).join(',');`), '이 룸:true,전체 룸:false');
    await s(`s.querySelector('.scope-btn[data-scope="all"]').click();`); await page.waitForTimeout(300);
    const groups = () => s(`return [...s.querySelectorAll('.room-group')].map((g) => ({ room: g.dataset.room, name: g.querySelector('.room-name').textContent, meta: g.querySelector('.room-meta').textContent, items: [...g.querySelectorAll('.room-item-title')].map((t) => t.textContent) }));`);
    let g = await groups();
    assert.deepEqual(g.map((x) => [x.room, x.name, x.items]), [['test', '룸 test', ['지금 룸 지도']], ['R2room', '두 번째 룸', ['다른 룸 편지', '다른 룸 지도']]], 'current room first, titles: ' + JSON.stringify(g));
    assert.match(g[0].meta, /현재 룸/);
    // search across rooms
    await s(`s.querySelector('[data-action="search-open"]')?.click();`); await page.waitForTimeout(100);
    await page.locator('#ccfolia-handout-root').locator('input[data-list-search]').fill('편지'); await page.waitForTimeout(300);
    g = await groups();
    assert.deepEqual(g.map((x) => x.items), [['다른 룸 편지']], 'search: ' + JSON.stringify(g));
    // view another room's handout
    await s(`s.querySelector('[data-action="room-view"][data-id="b1"]').click();`); await page.waitForTimeout(300);
    const view = await page.evaluate(() => { const r = document.querySelector('[data-ccf-handout-show="1"]').shadowRoot; return { body: r.querySelector('.rendered').textContent, secret: !!r.querySelector('.secret-block') }; });
    assert.deepEqual(view, { body: '비밀 편지 내용', secret: true });
    await page.evaluate(() => document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((h) => h.remove()));
    // copy it here
    await s(`s.querySelector('[data-action="room-copy"][data-id="b1"]').click();`); await page.waitForTimeout(400);
    const saved = await page.evaluate(() => window.__saved.handouts);
    const copy = saved.find((h) => h.title === '다른 룸 편지');
    assert(copy && copy.id !== 'b1', 'a new id');
    assert.deepEqual([copy.permissions, copy.folderId, copy.description, copy.gmNotes], [{}, '', '비밀 편지 내용', '숨은 뜻'], 'content kept, permissions / folder empty');
    assert.equal(saved.length, 2, 'the current room now has 2');
    assert.equal(await page.evaluate(() => typeof window.__CAPYBARA_TOOLKIT__.storage.listRoomData), 'function');
    assert.deepEqual(errors, []);
    console.log('handout all rooms PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
