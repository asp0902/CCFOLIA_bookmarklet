// handout 0.1.133: the row keeps only the share toggle; 편집/복제/삭제 moved to the row's right-click menu (GM, same look as the Sv menu); double-click on the row = 편집; 삭제 keeps its confirm.
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
    const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      document.documentElement.dataset.capybaraPlayerRelay = '1';
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const s = (js) => page.evaluate((js) => new Function('s', js)(document.querySelector('#ccfolia-handout-root').shadowRoot), js);
    assert.deepEqual(await s(`return [...s.querySelectorAll('.card[data-id="h1"] button[data-action]')].map((b) => b.dataset.action);`), ['view-handout', 'web-share-handout'], 'the row keeps the title and the share toggle only');
    const open = `s.querySelector('.card[data-id="h1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 60, clientY: 80 }));`;
    assert.deepEqual(await s(`${open} return [...s.querySelectorAll('.card-menu [role=menuitem]')].map((b) => b.textContent);`), ['편집', '복제', '삭제'], 'menu items in order');
    // 삭제: the old confirm (dismissed -> nothing removed), the menu closes
    await s(`s.querySelector('.card-menu [data-action="delete-handout"]').click();`); await page.waitForTimeout(200);
    assert.equal(dialogs.length, 1, 'the delete confirm shows'); assert.equal(await s(`return s.querySelectorAll('.card-menu').length;`), 0, 'menu closed');
    assert.equal(await s(`return s.querySelectorAll('.card[data-id="h1"]').length;`), 1, 'kept (cancelled)');
    // 복제
    await s(`${open} s.querySelector('.card-menu [data-action="duplicate-handout"]').click();`); await page.waitForTimeout(400);
    assert.equal(await s(`return s.querySelectorAll('.card[data-id]').length;`), 2, 'duplicated');
    // 편집 / double-click
    await s(`${open} s.querySelector('.card-menu [data-action="edit-handout"]').click();`); await page.waitForTimeout(300);
    assert.equal(await s(`return !!s.querySelector('[data-action="save-handout"]');`), true, 'editor opened from the menu');
    await s(`s.querySelector('.tab[data-tab="list"]').click();`); await page.waitForTimeout(200);
    await s(`s.querySelector('.card[data-id="h1"] .head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));`); await page.waitForTimeout(300);
    assert.equal(await s(`return !!s.querySelector('[data-action="save-handout"]');`), true, 'double-click opens the editor');
    assert.deepEqual(errors, []);
    console.log('handout row menu PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
