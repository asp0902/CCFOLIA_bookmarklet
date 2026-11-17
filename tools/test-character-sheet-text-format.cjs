const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// character-sheet 0.5.42: text fields (memo, ability detail, inline memo) take the chat panel's format syntax.
// Focus shows a small bar (B/I/U/S/color) that wraps the selection; when focus leaves, the field shows formatted; clicking it edits the raw text. The saved value is the raw text.
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
    await page.addScriptTag({ content: source });
    await page.locator('[data-ccf-character-sheet-dialog-button]').click();
    const memo = page.locator('#ccf-character-sheet-root textarea[data-field="memo"]');
    await memo.waitFor({ timeout: 5000 });
    // focus -> bar; select "메모", B -> **메모**
    await memo.click();
    await memo.evaluate((t) => t.setSelectionRange(0, 2));
    const bar = page.locator('#ccf-character-sheet-root .ccf-cs-fmt-bar');
    assert.equal(await bar.count(), 1, 'the bar shows on focus');
    await bar.locator('[data-fmt="0"]').click();
    assert.equal(await memo.inputValue(), '**메모** 내용');
    // color on "내용"
    await memo.evaluate((t) => { const i = t.value.indexOf('내용'); t.setSelectionRange(i, i + 2); });
    await bar.locator('input[type="color"]').evaluate((c) => { c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); c.value = '#00ff00'; c.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await memo.inputValue(), '**메모** {c:#00ff00|내용|}');
    // focus leaves -> formatted view, raw hidden, bar gone
    await page.mouse.click(1280, 880); // outside the sheet
    await page.waitForTimeout(50);
    const look = await page.evaluate(() => { const v = document.querySelector('#ccf-character-sheet-root .ccf-cs-fmt-view'); return v && { text: v.textContent, bold: getComputedStyle(v.querySelector('span')).fontWeight, color: getComputedStyle(v.querySelectorAll('span')[1]).color, rawHidden: getComputedStyle(document.querySelector('#ccf-character-sheet-root textarea[data-field="memo"]')).display === 'none', bar: document.querySelectorAll('.ccf-cs-fmt-bar').length }; });
    assert.deepEqual(look, { text: '메모 내용', bold: '700', color: 'rgb(0, 255, 0)', rawHidden: true, bar: 0 });
    // click the view -> raw text editable again
    await page.locator('#ccf-character-sheet-root .ccf-cs-fmt-view').click();
    assert.equal(await memo.evaluate((t) => document.activeElement === t && getComputedStyle(t).display !== 'none'), true, 'raw text is back and focused');
    // saved raw (re-render keeps it)
    await page.mouse.click(1280, 880); // outside the sheet
    await page.waitForTimeout(600);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    assert.equal(await memo.inputValue(), '**메모** {c:#00ff00|내용|}');
    // plain text: no view
    await page.locator('#ccf-character-sheet-root .ccf-cs-fmt-view').click();
    await memo.evaluate((t) => { t.value = '그냥 글'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.mouse.click(1280, 880); // outside the sheet
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-fmt-view').count(), 0, 'plain text stays a plain field');
    assert.deepEqual(errors, []);
    console.log('character sheet text format PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
