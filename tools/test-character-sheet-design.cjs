const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// character-sheet 0.5.43: 설정 > 시트 디자인 (font / body size / text color / accent / window background opacity), saved with the room settings; 기본값으로 = the current look.
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
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.open());
    const R = '#ccf-character-sheet-root';
    await page.locator(R + ' [data-action="panel-settings"]').click();
    const look = () => page.evaluate(() => { const d = document.querySelector('#ccf-character-sheet-root .ccf-cs-dialog'), c = getComputedStyle(d), i = getComputedStyle(d.querySelector('input[data-design="font"]')); return { font: c.fontFamily.split(',')[0].replace(/["']/g, ''), color: c.color, accent: c.accentColor, bg: c.backgroundColor, inputSize: i.fontSize, inputColor: i.color }; });
    const before = await look();
    assert.deepEqual({ ...before, font: undefined }, { font: undefined, color: 'rgb(238, 238, 238)', accent: 'rgb(33, 150, 243)', bg: 'rgba(44, 44, 44, 0.87)', inputSize: '16px', inputColor: 'rgb(255, 255, 255)' }, 'default = the current look: ' + JSON.stringify(before));
    const set = (key, value) => page.locator(`${R} [data-design="${key}"]`).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    await set('font', 'serif'); await set('size', '20'); await set('color', '#ffeb3b'); await set('accent', '#ff5252'); await set('bg', '50');
    assert.deepEqual(await look(), { font: 'serif', color: 'rgb(255, 235, 59)', accent: 'rgb(255, 82, 82)', bg: 'rgba(44, 44, 44, 0.5)', inputSize: '20px', inputColor: 'rgb(255, 235, 59)' });
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().design), { font: 'serif', size: 20, color: '#ffeb3b', accent: '#ff5252', bg: 50 }, 'saved');
    // survives a re-render (list tab and back)
    await page.locator(R + ' [data-action="panel-list"]').click(); await page.locator(R + ' [data-action="panel-settings"]').click();
    assert.equal((await look()).accent, 'rgb(255, 82, 82)');
    await page.locator(R + ' [data-action="design-reset"]').click();
    assert.deepEqual(await look(), before, 'reset to the current look');
    assert.deepEqual(errors, []);
    console.log('character sheet design PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
