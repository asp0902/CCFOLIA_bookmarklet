// theme 0.2.71 per-room theme: shared (the old key) + this room's override (same key + ":{room id}" = { on, values }) behind the '이 룸에만 적용' switch.
// Room A on + Unsung Duet sheet theme → room B (moved without a reload) keeps the shared theme; back in A the room theme is there again;
// switching A off applies the shared theme and keeps A's values (on again restores them); the shared-only screen font follows every room.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const KEY = 'ccf-theme-switcher-settings-v1';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="margin:0;background:#222"><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/A');
    await page.evaluate((KEY) => localStorage.setItem(KEY, JSON.stringify({ mode: 'default', selectedSheetTheme: 'none', unsungDuetEnabled: true })), KEY);
    await page.addScriptTag({ content: source });
    await page.waitForSelector('#ccf-theme-switcher-panel [data-theme-room-only]', { state: 'attached', timeout: 8000 });
    const dicebot = () => page.evaluate(() => document.documentElement.getAttribute('data-ccf-dicebot') || '');
    const ui = () => page.evaluate(() => { const p = document.getElementById('ccf-theme-switcher-panel'); return { on: p.querySelector('[data-theme-room-only]').checked, badge: !p.querySelector('.ccf-theme-room-badge').hidden }; });
    const set = (sel, value) => page.evaluate(([sel, value]) => { const el = document.querySelector('#ccf-theme-switcher-panel ' + sel); if (el.type === 'checkbox') el.checked = value; else el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, value]);
    const go = async (room) => { await page.evaluate((room) => history.pushState({}, '', '/rooms/' + room), room); await page.waitForTimeout(1300); };
    assert.equal(await dicebot(), '', 'start: shared, no sheet theme');
    // room A: only here → Unsung Duet
    await set('[data-theme-room-only]', true);
    await set('#ccf-theme-switcher-sheet-theme-select-panel', 'unsung-duet');
    assert.equal(await dicebot(), 'unsung-duet');
    assert.deepEqual(await ui(), { on: true, badge: true }, "the switch and the '이 룸' badge");
    assert.equal(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY)).selectedSheetTheme, 'none', 'the shared theme is untouched');
    assert.equal(JSON.parse(await page.evaluate((k) => localStorage.getItem(k + ':A'), KEY)).values.selectedSheetTheme, 'unsung-duet', 'stored for room A');
    // room B (no reload): the shared theme
    await go('B');
    assert.equal(await dicebot(), '', 'room B: shared');
    assert.deepEqual(await ui(), { on: false, badge: false });
    // back in room A: its own theme again
    await go('A');
    assert.equal(await dicebot(), 'unsung-duet', 'room A: kept');
    // A off → shared applied, A's values kept; on again → restored
    await set('[data-theme-room-only]', false);
    assert.equal(await dicebot(), '', 'off: shared');
    const keptA = JSON.parse(await page.evaluate((k) => localStorage.getItem(k + ':A'), KEY));
    assert.deepEqual([keptA.on, keptA.values.selectedSheetTheme], [false, 'unsung-duet'], 'kept while off');
    await set('[data-theme-room-only]', true);
    assert.equal(await dicebot(), 'unsung-duet', 'on again: restored');
    // the home page uses the shared theme, the switch is off there
    await page.evaluate(() => history.pushState({}, '', '/home')); await page.waitForTimeout(1300);
    assert.equal(await dicebot(), '', 'home: shared');
    assert.deepEqual(errors, []);
    console.log('room theme PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
