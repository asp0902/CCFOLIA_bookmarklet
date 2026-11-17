const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// character-sheet 0.5.46: clicking an item's name shows its description under the cell (only items with a description); again / elsewhere closes it; the use button is unchanged.
//
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const source = read('legacy/ccfolia-character-sheet.user.js');
const panel = read('legacy/ccfolia-chat-panel.user.js');
const parser = panel.slice(panel.indexOf('const CCF_MD_MARKERS'), panel.indexOf('// 크툴루(CoC 7판)'));
assert.match(panel, /window\.__CCF_FORMAT_MARKERS__ = \{ parse: parseFormatMarkers \}/, 'the chat panel exports its parser');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff">
      <span class="MuiTypography-caption">인세인</span><div id="root"></div>
      <div class="MuiDialog-root" role="dialog" style="position:fixed;left:20px;top:200px;width:560px">
        <div class="MuiAppBar-root"><div class="MuiToolbar-root"><h6 class="MuiTypography-h6">캐릭터 편집</h6><button class="MuiIconButton-root" aria-label="닫기">X</button></div></div>
        <div><input name="name" value="연갈"><textarea name="memo">메모 내용</textarea></div></div></body>` }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate((parser) => {
      const state = { entities: { roomCharacters: { entities: { c1: { name: '연갈', owner: 'me' } } } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } };
      window.__CCF_FORMAT_MARKERS__ = { parse: new Function(`${parser}\nreturn parseFormatMarkers;`)() };
    }, parser);
    await page.evaluate(() => new Promise((resolve) => { const open = indexedDB.open('firebaseLocalStorageDb'); open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); open.onsuccess = () => { const tx = open.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'k', value: { uid: 'me' } }); tx.oncomplete = () => resolve(); }; }));
    await page.evaluate(() => localStorage.setItem('ccf-character-sheet:test', JSON.stringify({ version: 1, selectedId: 's1', sheets: [{ id: 's1', name: '연갈', items: { 부적: 1, 진통제: 2 } }], permissions: {}, scene: { cycle: 1, number: 0 }, sceneTables: [] })));
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.open());
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-sheet-row, #ccf-character-sheet-root .ccf-cs-dialog.is-editor', { timeout: 6000 });
    if (await page.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').count()) await page.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').first().click();
    const R = '#ccf-character-sheet-root';
    await page.waitForSelector(R + ' .ccf-cs-item-cell', { state: 'attached' });
    assert.deepEqual(await page.locator(R + ' [data-item-desc]').evaluateAll((e) => e.map((x) => x.dataset.itemDesc)), ['부적'], 'only items with a description are clickable names');
    await page.locator(R + ' [data-item-desc="부적"]').click();
    const desc = R + ' .ccf-cs-item-desc';
    assert.match(await page.locator(desc).textContent(), /자신 이외의 누군가가/);
    const focused = await page.evaluate(() => document.activeElement?.dataset?.item || null);
    assert.equal(focused, null, 'the number box did not take the focus');
    await page.locator(R + ' [data-item-desc="부적"]').click();
    assert.equal(await page.locator(desc).count(), 0, 'again closes');
    await page.locator(R + ' [data-item-desc="부적"]').click();
    await page.locator(R + ' header h2').click();
    assert.equal(await page.locator(desc).count(), 0, 'elsewhere closes');
    assert.deepEqual(errors, []);
    console.log('character sheet item description PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
