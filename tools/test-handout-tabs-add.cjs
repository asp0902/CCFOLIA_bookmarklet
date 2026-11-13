// handout 0.1.125, in the GM tools window: '+' sits at the right end of the tab row next to the search button ([검색][+], same size, same top), the row above it is gone,
// the open search field does not overlap '+', and '+' stays on the other tabs. The editor's alignment buttons are icons (format_align_*), not triangles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const legacy = path.join(__dirname, '../legacy/');
const src = (name) => fs.readFileSync(legacy + `ccfolia-${name}.user.js`, 'utf8');
const body = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif"><span class="MuiTypography-caption">인세인</span><header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button><button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button></header><div id="root"></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => { localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01'); localStorage.setItem('ccf-handout:greeted:test', '1'); const value = { myCharacter: '', handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }], folders: [], plList: [] }; window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } }; });
    for (const n of ['handout', 'character-sheet', 'toolkit-presence']) await page.addScriptTag({ content: src(n) });
    await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached' }); await page.waitForTimeout(600);
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    await page.waitForSelector('#ccf-gm-tools .ccf-gt-window');
    await page.locator('#ccf-gm-tools .ccf-gt-tab', { hasText: '핸드아웃' }).dispatchEvent('click');
    await page.waitForTimeout(600);
    const measure = () => page.evaluate(() => {
      const s = document.querySelector('#ccfolia-handout-root').shadowRoot;
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) } : null; };
      const add = s.querySelector('.tabs [data-action="new-handout"]'), search = s.querySelector('.tabs [data-action="search-open"]') || s.querySelector('.tabs .list-search-field');
      return { add: box(add), search: box(search), header: box(s.querySelector('header')), tabs: box(s.querySelector('.tabs')), headerAdd: !!s.querySelector('header [data-action="new-handout"]'), addColor: add && getComputedStyle(add).color, searchColor: search && getComputedStyle(search).color };
    });
    let m = await measure();
    assert(m.add && m.search, 'both buttons: ' + JSON.stringify(m));
    assert.equal(m.headerAdd, false, 'no + in the header');
    assert.equal(m.header, null, 'the row above the tabs is gone: ' + JSON.stringify(m.header));
    assert.equal(m.add.top, m.search.top, 'same top');
    assert.deepEqual([m.add.w, m.add.h, m.search.w, m.search.h], [30, 30, 30, 30], 'same size');
    assert(m.search.right <= m.add.left, '[검색][+] order');
    assert.equal(m.addColor, m.searchColor, 'same colour');
    // open the search field: no overlap, '+' still on the row
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.tabs [data-action="search-open"]').click());
    await page.waitForTimeout(200);
    m = await measure();
    assert(m.search.right <= m.add.left && m.add.top === m.tabs.top + Math.round((m.tabs.h - 30) / 2) || Math.abs(m.add.top - m.search.top) <= 4, 'open search: no overlap: ' + JSON.stringify(m));
    assert(m.search.right <= m.add.left, 'no overlap: ' + JSON.stringify(m));
    // the settings tab: '+' stays, the search is not there
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.tab[data-tab="settings"]')?.click());
    await page.waitForTimeout(200);
    m = await measure();
    // (the GM tools window shows settings in its own tab; when the handout settings tab is not on this row, the list tab is still active)
    assert(m.add, '+ stays');
    // the editor's alignment buttons are icons
    const icons = await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('.tab[data-tab="list"]')?.click(); s.querySelector('[data-action="new-handout"]').click(); s.querySelector('[data-action="add-handout-choice"]')?.click(); return new Promise((r) => setTimeout(() => r(['align-left', 'align-center', 'align-right'].map((c) => { const b = s.querySelector(`[data-format-cmd="${c}"]`); return b ? [!!b.querySelector('svg path'), b.textContent.trim(), b.title] : null; })), 300)); });
    assert.deepEqual(icons, [[true, '', '왼쪽 정렬'], [true, '', '가운데 정렬'], [true, '', '오른쪽 정렬']], 'icons: ' + JSON.stringify(icons));
    await page.locator('#ccf-gm-tools .ccf-gt-window').screenshot({ path: process.env.SHOT || path.join(require('node:os').tmpdir(), 'handout-tabs-add.png') });
    assert.deepEqual(errors, []);
    console.log('handout tabs add PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
