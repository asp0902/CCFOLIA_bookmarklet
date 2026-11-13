// handout 0.1.126: the public and secret boxes always share one height whichever box changes (typing in either, or a change that sends no input event: another tool,
// paste, formatting), up to 360px, then each scrolls inside.
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
      const value = { myCharacter: '드와이프', handouts: [], folders: [], plDeleted: {}, plDeletedMigrated: true, plList: [{ name: '눈깅', id: '', role: 'player', aliases: [], image: '' }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async (f, k, v) => { window.__saved = JSON.parse(JSON.stringify(v)); } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const sh = (sel) => page.locator('#ccfolia-handout-root').locator(sel);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="new-handout"]').click()); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="add-handout-choice"]').click()); await page.waitForTimeout(300);
    await sh('[data-field="title"]').fill('바깥 상황');
    const hs = () => page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; return [...s.querySelectorAll('.handout-edit-cols .rich-editor')].map((e) => ({ h: Math.round(e.getBoundingClientRect().height), scroll: e.scrollHeight > e.clientHeight + 1 })); });
    const typeIn = async (field, n) => { await sh(`.rich-editor[data-field="${field}"]`).click(); for (let i = 0; i < n; i += 1) { await page.keyboard.type(`${field} ${i}`); await page.keyboard.press('Enter'); } await page.waitForTimeout(150); };
    await typeIn('description', 6);
    let h = await hs();
    assert(h[0].h === h[1].h && h[0].h > 140 && !h[0].scroll, 'public 6 lines: both grow together: ' + JSON.stringify(h));
    await typeIn('description', 14);
    h = await hs();
    assert.deepEqual([h[0].h, h[1].h], [360, 360], 'max 360: ' + JSON.stringify(h)); assert.equal(h[0].scroll, true, 'scrolls inside');
    // the secret box the same way: clear the public box first (no input event: as when another tool changes it)
    await page.evaluate(() => { document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.rich-editor[data-field="description"]').innerHTML = '<div>한 줄</div>'; });
    await page.waitForTimeout(150);
    h = await hs();
    assert.deepEqual([h[0].h, h[1].h], [140, 140], 'shrinks back without an input event: ' + JSON.stringify(h));
    await typeIn('gmNotes', 22);
    h = await hs();
    assert.deepEqual([h[0].h, h[1].h], [360, 360], 'secret 22 lines: both 360: ' + JSON.stringify(h)); assert.equal(h[1].scroll, true);
    assert.deepEqual(errors, []);
    console.log('handout editor heights PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
