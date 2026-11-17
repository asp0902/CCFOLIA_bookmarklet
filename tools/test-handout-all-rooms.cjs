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
      const third = { roomTitle: '가 세 번째 룸', myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'c1', title: '셋째 룸 쪽지', description: '쪽지', gmNotes: '', permissions: {}, order: 1 }] }; window.__third = third;
      const rows = [{ featureId: 'ccf-handout', roomKey: 'R3room', value: third, updatedAt: '2026-11-10T01:00:00Z' }, { featureId: 'ccf-handout', roomKey: 'test', value: here, updatedAt: '2026-11-13T01:00:00Z' }, { featureId: 'ccf-handout', roomKey: 'R2room', value: other, updatedAt: '2026-11-12T01:00:00Z' }, { featureId: 'other-feature', roomKey: 'R3', value: {}, updatedAt: '' }];
      window.__saved = null;
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async (f, k) => ({ value: k === 'R2room' ? other : k === 'R3room' ? third : here }), setRoomData: async (f, k, v) => { const c = JSON.parse(JSON.stringify(v)); if (k === 'test') window.__saved = c; (window.__savedBy ||= {})[k] = c; if (k === 'R2room') { other.handouts = c.handouts; } if (k === 'R3room') { third.handouts = c.handouts; } }, listRoomData: async (f) => rows.filter((r) => r.featureId === f) } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const s = (js, arg) => page.evaluate(([js, arg]) => new Function('s', 'arg', js)(document.querySelector('#ccfolia-handout-root').shadowRoot, arg), [js, arg]);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    assert.equal(await s(`return [...s.querySelectorAll('.scope-btn')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')).join(',');`), '전체:false,현재:true');
    await s(`s.querySelector('.scope-btn[data-scope="all"]').click();`); await page.waitForTimeout(300);
    const groups = () => s(`return [...s.querySelectorAll('.room-group')].map((g) => ({ room: g.dataset.room, name: g.querySelector('.room-name').textContent, meta: g.querySelector('.room-meta').textContent, items: [...g.querySelectorAll('.room-item-title')].map((t) => t.textContent) }));`);
    let g = await groups();
    assert.deepEqual(g.map((x) => [x.room, x.name, x.items]), [['test', '룸 test', ['지금 룸 지도']], ['R2room', '두 번째 룸', ['다른 룸 편지', '다른 룸 지도']], ['R3room', '가 세 번째 룸', ['셋째 룸 쪽지']]], 'current room first, then recent: ' + JSON.stringify(g));
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
    // ---- 0.1.137 (2차): sort / filter / right-click menu: copy & move to another room, delete, edit another room's handout
    await s(`s.querySelector('[data-action="search-close"]')?.click();`); await page.waitForTimeout(150);
    const pick = (sel, v) => s(`const e = s.querySelector('${sel}'); e.value = arg; e.dispatchEvent(new Event('change', { bubbles: true }));`, v);
    await pick('select[data-all-sort]', 'name'); await page.waitForTimeout(150);
    assert.deepEqual((await groups()).map((x) => x.room), ['test', 'R3room', 'R2room'], 'by room name (current room stays first)');
    await pick('select[data-all-filter]', 'R2room'); await page.waitForTimeout(150);
    assert.deepEqual((await groups()).map((x) => x.room), ['R2room'], 'one room');
    await pick('select[data-all-filter]', ''); await page.waitForTimeout(150);
    const menuOf = async (room, id) => { await s(`const it = s.querySelector('.room-item[data-room="${room}"][data-id="${id}"]'); const r = it.getBoundingClientRect(); it.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 5 }));`); return s(`return [...s.querySelectorAll('.card-menu [role=menuitem]')].map((b) => b.textContent);`); };
    assert.deepEqual(await menuOf('R2room', 'b2'), ['보기', '편집', '이 룸으로 복사', '다른 룸으로 복사…', '다른 룸으로 이동…', '삭제']);
    // copy b2 to the third room: a new copy there, the original stays
    await s(`s.querySelector('.card-menu [data-action="room-pick-copy"]').click();`); await page.waitForTimeout(100);
    assert.deepEqual(await s(`return [...s.querySelectorAll('.card-menu [role=menuitem]')].map((b) => b.textContent).sort();`), ['가 세 번째 룸', '룸 test'], 'target rooms (not the source)');
    await s(`s.querySelector('.card-menu [data-action="room-copy-to"][data-target="R3room"]').click();`); await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.__third.handouts.map((h) => [h.title, h.id === 'b2', JSON.stringify(h.permissions)])), [['셋째 룸 쪽지', false, '{}'], ['다른 룸 지도', false, '{}']]);
    assert(await page.evaluate(() => window.__savedBy.R2room === undefined), 'the source room is untouched');
    // move b1 to the third room (confirm): the copy there, the original gone from R2room
    page.once('dialog', (d) => d.accept());
    await menuOf('R2room', 'b1');
    await s(`s.querySelector('.card-menu [data-action="room-pick-move"]').click();`); await page.waitForTimeout(100);
    await s(`s.querySelector('.card-menu [data-action="room-move-to"][data-target="R3room"]').click();`); await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.__savedBy.R2room.handouts.map((h) => h.id)), ['b2'], 'moved out of R2room');
    assert(await page.evaluate(() => window.__third.handouts.some((h) => h.title === '다른 룸 편지')), 'moved into R3room');
    // delete c1 in the third room (confirm)
    page.once('dialog', (d) => d.accept());
    await page.waitForTimeout(300);
    await menuOf('R3room', 'c1');
    await s(`s.querySelector('.card-menu [data-action="room-delete"]').click();`); await page.waitForTimeout(400);
    assert(await page.evaluate(() => !window.__third.handouts.some((h) => h.id === 'c1')), 'deleted');
    // edit b2 in R2room from here: title saved into that room, permissions untouched
    await page.waitForTimeout(300);
    await menuOf('R2room', 'b2');
    await s(`s.querySelector('.card-menu [data-action="room-edit"]').click();`); await page.waitForTimeout(400);
    await page.locator('#ccfolia-handout-root').locator('[data-field="title"]').fill('다른 룸 지도 고침');
    await s(`s.querySelector('[data-action="save-handout"]').click();`); await page.waitForTimeout(500);
    const r2 = await page.evaluate(() => window.__savedBy.R2room.handouts.find((h) => h.id === 'b2'));
    assert.equal(r2.title, '다른 룸 지도 고침', 'saved into the other room');
    assert.equal(await page.evaluate(() => window.__saved.handouts.some((h) => h.title === '다른 룸 지도 고침')), false, 'not into the current room');
    assert.deepEqual(errors, []);
    console.log('handout all rooms PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
