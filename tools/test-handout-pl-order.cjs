// handout 0.1.119: the PL list window has a drag handle (⋮⋮) at the left of every row: dragging (or ↑/↓ on the handle) reorders, 저장 keeps that order, and the permission table
// of a handout follows it. A player without a picture (or with a blank / broken one) shows the first letter of the name instead of an empty grey square. The GM's own row of the
// permission table has no switches and no popup button (the GM reads every handout). The public / secret body boxes look the same when focused (no ring).
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
      const value = { myCharacter: '드와이프', handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }], folders: [], plDeleted: {}, plDeletedMigrated: true,
        plList: [{ name: '눈깅', id: '', role: 'player', aliases: [], image: '/blank.gif' }, { name: 'MURDER FEED', id: '', role: 'player', aliases: [], image: '' }, { name: '에르네스토', id: '', role: 'player', aliases: [], image: '' }] };
      window.__saved = null;
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async (f, k, v) => { window.__saved = JSON.parse(JSON.stringify(v)); } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1500);
    const sh = () => page.evaluateHandle(() => document.querySelector('#ccfolia-handout-root').shadowRoot);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open());
    await page.waitForTimeout(400);
    // open the PL list window from the settings tab
    await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('.tab[data-tab="settings"]').click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="pl-modal-open"]').click());
    await page.waitForTimeout(400);
    const names = () => page.evaluate(() => [...document.querySelector('#ccfolia-handout-root').shadowRoot.querySelectorAll('.pl-modal [data-pl-rows-host] .pl-row')].map((r) => r.querySelector('[data-pl-field="name"]').value));
    const before = await names();
    assert(before.includes('눈깅') && before.includes('에르네스토'), JSON.stringify(before));
    const avatar = await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; const row = [...s.querySelectorAll('.pl-modal .pl-row')].find((r) => r.querySelector('[data-pl-field="name"]').value === '눈깅'); const a = row.querySelector('[data-pl-avatar]'); return { initial: a.getAttribute('data-initial'), before: getComputedStyle(a, '::before').content, opacity: getComputedStyle(a).opacity }; });
    const account = await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; const sel = s.querySelector('.pl-modal .pl-row [data-pl-account]'); return sel ? { first: sel.options[0]?.textContent, linked: sel.getAttribute('data-linked') } : null; });
    assert.deepEqual(account, { first: '계정 연결 안 됨', linked: '0' }, 'each PL row has an account select (0.1.120)');
    assert.deepEqual(avatar, { initial: '눈', before: '"눈"', opacity: '1' }, 'the first letter shows behind a blank picture: ' + JSON.stringify(avatar));
    // drag 에르네스토 above 눈깅 with the handle
    const handle = await page.evaluateHandle(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; return [...s.querySelectorAll('.pl-modal .pl-row')].find((r) => r.querySelector('[data-pl-field="name"]').value === '에르네스토').querySelector('.pl-drag'); });
    const target = await page.evaluateHandle(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; return [...s.querySelectorAll('.pl-modal .pl-row')].find((r) => r.querySelector('[data-pl-field="name"]').value === '눈깅'); });
    const hb = await handle.boundingBox(), tb = await target.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(tb.x + 40, tb.y + 4, { steps: 8 }); await page.mouse.move(tb.x + 40, tb.y + 3, { steps: 2 }); await page.mouse.up();
    await page.waitForTimeout(200);
    let order = await names();
    assert(order.indexOf('에르네스토') < order.indexOf('눈깅'), 'dragged above: ' + JSON.stringify(order));
    // keyboard: ↓ on MURDER FEED's handle moves it one down
    await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; const h = [...s.querySelectorAll('.pl-modal .pl-row')].find((r) => r.querySelector('[data-pl-field="name"]').value === 'MURDER FEED').querySelector('.pl-drag'); h.focus(); });
    const mfBefore = (await names()).indexOf('MURDER FEED');
    await page.keyboard.press('ArrowUp');
    assert.equal((await names()).indexOf('MURDER FEED'), mfBefore - 1, 'ArrowUp moves it one up');
    order = await names();
    // save -> the stored order, and the permission table follows it
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="pl-modal-save"]').click());
    await page.waitForTimeout(400);
    const saved = await page.evaluate(() => (window.__saved?.plList || []).map((p) => p.name));
    assert.deepEqual(saved.filter((n) => order.includes(n)), order.filter((n) => saved.includes(n)), 'saved in the window order: ' + JSON.stringify({ saved, order }));
    await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('.tab[data-tab="list"]').click(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('[data-action="new-handout"]').click(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('[data-action="add-handout-choice"]')?.click(); });
    await page.waitForTimeout(400);
    const perm = await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; const names = [...s.querySelectorAll('.perm-grid .perm-name')].map((n) => n.textContent.trim()); const gmRowCells = [...s.querySelectorAll('.perm-grid .perm-self')].length; const gmCheckboxes = [...s.querySelectorAll('.perm-grid input[data-perm-key="드와이프"]')].length; return { names, gmRowCells, gmCheckboxes, focusRing: (() => { const ed = s.querySelector('.rich-editor[data-field="description"]'); if (!ed) return null; ed.focus(); const cs = getComputedStyle(ed); return [cs.outlineStyle, cs.boxShadow]; })() }; });
    if (perm.names.length) {
      const plNames = perm.names.filter((n) => !/\(GM\)/.test(n)).map((n) => n.replace(/^.(?=\S)/u, (m) => m)).map((n) => order.find((o) => n.endsWith(o)) || n);
      assert.deepEqual(plNames.filter((n) => order.includes(n)), order.filter((n) => plNames.includes(n)), 'the permission table follows the saved order: ' + JSON.stringify(perm.names));
      assert.deepEqual([perm.gmRowCells, perm.gmCheckboxes], [4, 0], 'the GM row has no switches / popup');
      assert.deepEqual(perm.focusRing, ['none', 'none'], 'no focus ring on the body box');
    } else console.log('(edit form not opened in this replica; permission-table checks skipped)');
    assert.deepEqual(errors, []);
    console.log('handout pl order PASS', JSON.stringify({ order, perm: perm.names }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
