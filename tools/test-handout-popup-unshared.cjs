// handout 0.1.144: the '팝업' button inside a handout that is not shared shares it first (permission table, the share toggle turns on) and then sends the popup;
// with nobody in the permission table it sends nothing and says why. An empty secret part (tags / spaces / nbsp / empty lines only) shows no '🔒 비밀 내용' box;
// a picture counts as content. The scope bar starts at the list rows' text line; list rows are 2px shorter at the bottom.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
const H = (id, title, permissions, gmNotes) => ({ id, title, description: '<p>공개</p>', gmNotes, image: '', permissions, folderId: '', updatedAt: 1 });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://www.gstatic.com/**', (r) => r.abort());
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    const handouts = [
      H('h1', '받을 사람 있음', { 눈깅: { view: true } }, '<p>비밀 글</p>'),
      H('h2', '받을 사람 없음', {}, ''),
      H('h3', '빈 비밀', { 눈깅: { view: true, secret: true } }, '<p><br></p><p>&nbsp;</p>  '),
      H('h4', '그림 비밀', { 눈깅: { view: true, secret: true } }, '<p><img src="https://example.test/a.png"></p>')
    ];
    await page.evaluate((handouts) => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', handouts, folders: [], plDeleted: {}, plDeletedMigrated: true, plList: [{ name: '눈깅', id: '', role: 'player', aliases: [], image: '' }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    }, handouts);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(400);
    const S = (fn, arg) => page.evaluate(([fn, arg]) => new Function('s', 'arg', fn)(document.querySelector('#ccfolia-handout-root').shadowRoot, arg), [fn.toString().replace(/^[^{]*\{|\}$/g, ''), arg]);
    const toast = () => page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.toast')?.textContent || '');
    const shared = () => page.evaluate(() => JSON.parse(localStorage.getItem('ccf-handout:web-shared:test') || '[]'));
    const openDetail = async (id) => { await page.evaluate((id) => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; (s.querySelector(`[data-action="detail-handout"][data-id="${id}"]`) || s.querySelector(`.card[data-id="${id}"] .title`) || s.querySelector(`.card[data-id="${id}"]`)).click(); }, id); await page.waitForTimeout(300); };
    // the editor's permission table: the 팝업 button of a player row on a handout that is not shared -> shared first, then the popup (and a result line)
    const act = (action, id) => page.evaluate(([action, id]) => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; const b = document.createElement('button'); b.dataset.action = action; b.dataset.id = id; (s.querySelector('.body') || s).appendChild(b); b.click(); b.remove(); }, [action, id]);
    await act('edit-handout', 'h1'); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="row-popup"][data-key="눈깅"]').click());
    await page.waitForTimeout(600);
    assert.deepEqual(await shared(), ['h1'], 'shared first (the share toggle is on)');
    // a handout nobody may see: nothing is shared
    await act('edit-handout', 'h2'); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="row-popup"][data-key="눈깅"]').click());
    await page.waitForTimeout(300);
    assert.match(await toast(), /저장된 권한이 없습니다/, 'no permission: the reason');
    assert.deepEqual(await shared(), ['h1'], 'h2 not shared');
    // the view window: an empty secret part has no box, a picture is content
    const secretBox = async (id) => { await page.evaluate((id) => window.__CCF_HANDOUT_DEBUG__.showById?.(id), id); return page.evaluate((id) => { const fromApi = !!window.__CCF_HANDOUT_DEBUG__.showById; return fromApi; }, id); };
    const viewHead = async (id) => {
      await page.evaluate(() => document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((n) => n.remove()));
      await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('.tab[data-tab="list"]')?.click(); });
      await page.waitForTimeout(150);
      await page.evaluate((id) => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector(`[data-action="view-handout"][data-id="${id}"]`).click(); }, id);
      await page.waitForTimeout(300);
      return page.evaluate(() => { const h = document.querySelector('[data-ccf-handout-show="1"]'); return h ? !!h.shadowRoot.querySelector('.secret-head') : null; });
    };
    assert.equal(await viewHead('h3'), false, 'tags / nbsp / empty lines only: no secret box');
    assert.equal(await viewHead('h4'), true, 'a picture: the secret box shows');
    assert.equal(await viewHead('h1'), true, 'text: the secret box shows');
    // 0.1.145 the view window folded and moved near the bottom, then unfolded: pulled up so it stays on screen (top >= 8)
    const fit = await page.evaluate(async () => {
      const host = document.querySelector('[data-ccf-handout-show="1"]'); const head = host.shadowRoot.querySelector('.show-head');
      const dbl = () => head.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      dbl(); await new Promise((r) => setTimeout(r, 50));
      host.style.top = `${innerHeight - 60}px`;
      dbl(); await new Promise((r) => setTimeout(r, 50));
      const r = host.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
    });
    assert(fit.top >= 8 && fit.bottom <= fit.vh, 'unfolded view window on screen ' + JSON.stringify(fit));
    // list rows: bottom padding 10px (was 12); the scope bar indent = the rows' text start
    await page.evaluate(() => document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((n) => n.remove()));
    const geo = await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; const card = s.querySelector('.card'), bar = s.querySelector('.scope-bar'), btn = bar?.querySelector('.scope-btn'); return { pad: getComputedStyle(card).paddingBottom, barLeft: btn ? Math.round(btn.getBoundingClientRect().left) : null, rowLeft: Math.round(card.getBoundingClientRect().left + parseFloat(getComputedStyle(card).paddingLeft)) }; });
    assert.equal(geo.pad, '10px', 'rows 2px shorter at the bottom');
    if (geo.barLeft !== null) assert(Math.abs(geo.barLeft - geo.rowLeft) <= 2, 'the 전체 button starts at the rows text line ' + JSON.stringify(geo));
    assert.deepEqual(errors.filter((e) => !/gstatic|Failed to fetch|dynamically imported/.test(e)), []);
    console.log('handout popup unshared PASS', JSON.stringify(geo));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
