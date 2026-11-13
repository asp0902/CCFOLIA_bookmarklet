// character-sheet 0.5.39: each row of the GM tools 사이코로픽션 list has a 36px square picture left of the name: the sheet image, else the linked CCFOLIA character's icon,
// else (or when the picture breaks) the first letter on a grey square.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const legacy = path.join(__dirname, '../legacy/');
const src = (name) => fs.readFileSync(legacy + `ccfolia-${name}.user.js`, 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const body = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif"><span class="MuiTypography-caption">인세인</span><header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button><button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button></header><div id="root"></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body }));
    await page.route('https://example.test/**', (r) => (r.request().url().includes('broken') ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ contentType: 'image/png', body: PNG })));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01'); localStorage.setItem('ccf-handout:greeted:test', '1');
      const sheets = [
        { id: 's1', name: '아오이', player: '앨리스', image: 'https://example.test/sheet.png' },
        { id: 's2', name: '렌', player: '밥', image: '' },
        { id: 's3', name: '하루', player: '', image: '' },
        { id: 's4', name: '키리', player: '', image: 'https://example.test/broken.png' }
      ];
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async (feature) => ({ value: /sheet/i.test(feature) ? { sheets, selectedId: '' } : { myCharacter: '', handouts: [], folders: [], plList: [] } }), setRoomData: async () => {} } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => ({ entities: { roomCharacters: { entities: { c1: { name: '렌', iconUrl: 'https://example.test/icon.png' } } } } }), dispatch() {}, subscribe: () => () => {} } } } } };
    });
    for (const n of ['handout', 'character-sheet', 'toolkit-presence']) await page.addScriptTag({ content: src(n) });
    await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached' }); await page.waitForTimeout(600);
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    await page.waitForSelector('#ccf-gm-tools #ccf-sheet-tab [data-tab-open]');
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#ccf-sheet-tab [data-tab-open]')].map((b) => { const a = b.querySelector('[data-tab-avatar]'); const r = a.getBoundingClientRect(); const img = a.querySelector('img'); return { name: b.querySelector('strong').textContent, img: img ? img.getAttribute('src').replace('https://example.test/', '') : null, letter: a.firstChild?.nodeType === 3 ? a.firstChild.textContent : '', size: [Math.round(r.width), Math.round(r.height)], leftOfName: r.right <= b.querySelector('strong').getBoundingClientRect().left }; }));
    assert.deepEqual(rows, [
      { name: '아오이', img: 'sheet.png', letter: '아', size: [36, 36], leftOfName: true },
      { name: '렌', img: 'icon.png', letter: '렌', size: [36, 36], leftOfName: true },
      { name: '하루', img: null, letter: '하', size: [36, 36], leftOfName: true },
      { name: '키리', img: null, letter: '키', size: [36, 36], leftOfName: true }
    ], 'sheet image / character icon / first letter / broken -> first letter: ' + JSON.stringify(rows));
    await page.locator('#ccf-gm-tools .ccf-gt-window').screenshot({ path: process.env.SHOT || path.join(require('node:os').tmpdir(), 'sheet-tab-avatar.png') });
    assert.deepEqual(errors, []);
    console.log('character sheet tab avatar PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
