// character-sheet 0.5.50: the GM's duplicate clean-up. Same character + same content -> the latest edit stays, the others go (deleted mark on the shared side);
// the secret/mission of a removed copy moves to the kept one when the kept one has none; a copy whose secret differs stays; a copy with other content stays (listed only).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const base = { name: '에르네스토', player: '에르네스토', memo: '같은 메모', skills: [] };
    const seed = { version: 1, selectedId: 'e1', permissions: {}, scene: { cycle: 1, number: 0 }, sceneTables: [], sheets: [
      { ...base, id: 'e1', updatedAt: 100, secret: '진짜 비밀', mission: '' },
      { ...base, id: 'e2', updatedAt: 300, secret: '', mission: '' },
      { ...base, id: 'e3', updatedAt: 200, secret: '', mission: '' },
      { ...base, id: 'e4', updatedAt: 50, secret: '다른 비밀', mission: '' },
      { ...base, id: 'e5', updatedAt: 400, memo: '다른 내용' },
      { ...base, id: 'd1', name: '덱스터', player: '덱스터', updatedAt: 10 }
    ] };
    await page.addInitScript((seed) => { localStorage.setItem('ccf-character-sheet:test', JSON.stringify(seed)); window.__CCF_HANDOUT_FB__ = { state: () => null, isGm: () => true }; window.confirm = (t) => { window.__asked = t; return true; }; }, seed);
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body><span class="MuiTypography-caption">인세인</span><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => window.__CCF_CHARACTER_SHEET_DEBUG__?.data().sheets.length === 6, null, { timeout: 8000 });
    await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.dedupe());
    const sheets = await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets.map((s) => [s.id, s.secret || '']));
    // e2 (latest of the same content e1/e2/e3) stays and takes e1's secret; e4's secret differs from that -> stays; e5 other content -> stays; d1 alone
    assert.deepEqual(sheets.sort(), [['d1', ''], ['e2', '진짜 비밀'], ['e4', '다른 비밀'], ['e5', '']].sort());
    const asked = await page.evaluate(() => window.__asked);
    assert.match(asked, /남김: '에르네스토'/); assert.match(asked, /2개 지움/); assert.match(asked, /내용이 다른 시트/);
    assert.deepEqual(errors, []);
    console.log('character sheet dedupe PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
