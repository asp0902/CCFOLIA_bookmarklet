// handout 0.1.139 + extension drive-bridge: with the extension's Drive mark (html data-capybara-drive=1) the GM's originals are downloaded on entering the room
// (new / newer from Drive merged, received copies untouched) and uploaded 5s after a save (a deleted one listed as deletedIds); a failure leaves local data alone.
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
      document.documentElement.dataset.capybaraPlayerRelay = '1';
      document.documentElement.dataset.capybaraDrive = '1'; localStorage.setItem('ccf-handout:drive-first-done', '1'); // 0.1.141: past the first-connection choice
      window.__driveCalls = [];
      window.addEventListener('message', (e) => { const d = e.data; if (!d || d.source !== 'capybara-drive' || d.direction !== 'page') return; window.__driveCalls.push({ op: d.op, ids: (d.handouts || []).map((h) => h.id), deleted: d.deletedIds || [], remoteSent: (d.handouts || []).some((h) => h._remote) });
        const result = d.op === 'download' ? { handouts: [...d.handouts, { id: 'd1', title: 'Drive 에서 온 지도', description: '', gmNotes: '', permissions: {}, order: 5, updatedAt: '2026-11-17T10:00:00Z' }], added: ['d1'], updated: [], conflicts: [] } : { changed: 1 };
        window.postMessage({ source: 'capybara-drive', direction: 'bridge', id: d.id, ok: true, result }, location.origin); });
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const s = (js) => page.evaluate((js) => new Function('s', js)(document.querySelector('#ccfolia-handout-root').shadowRoot), js);
    await page.waitForTimeout(800);
    const calls = () => page.evaluate(() => window.__driveCalls);
    let c = await calls();
    assert.equal(c[0]?.op, 'download', 'downloaded on entering the room: ' + JSON.stringify(c));
    assert.deepEqual(c[0].ids, ['h1'], 'only the originals are sent');
    assert.deepEqual(await s(`return [...s.querySelectorAll('.card[data-id]')].map((x) => x.dataset.id).sort();`), ['d1', 'h1'], 'the Drive one is merged into the list');
    // delete h1 (confirm) -> 5s later an upload with h1 in deletedIds
    page.once('dialog', (d) => d.accept());
    await s(`s.querySelector('.card[data-id="h1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 60, clientY: 80 })); s.querySelector('.card-menu [data-action="delete-handout"]').click();`);
    await page.waitForTimeout(6000);
    c = await calls();
    const up = c.filter((x) => x.op === 'upload').pop();
    assert(up, 'uploaded after a save: ' + JSON.stringify(c));
    assert.deepEqual([up.ids, up.deleted, up.remoteSent], [['d1'], ['h1'], false], 'the deleted one goes to the trash list');
    assert.deepEqual(errors, []);
    console.log('handout drive sync hooks PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
