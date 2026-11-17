// handout 0.1.135: the status lines (sync/role, Firebase, room/count) show only on the settings tab; moving from the GM tools' settings section to the 핸드아웃 tab left them under the list (drawn before the tab was corrected).
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
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const strip = () => page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-room-strip]'); return { lines: s.querySelectorAll('.room-info').length, shown: getComputedStyle(s).display !== 'none' }; });
    const menu = await page.evaluate(() => !!window.__CCF_TOOLKIT_MENU__?.items?.get('handout-settings'));
    assert.equal(menu, true, 'the GM tools items are registered');
    await page.evaluate(() => { const a = document.createElement('div'); a.id = 'gt-settings'; document.body.appendChild(a); window.__CCF_TOOLKIT_MENU__.items.get('handout-settings').mount(a); });
    await page.waitForTimeout(400);
    assert.deepEqual(await strip(), { lines: 3, shown: true }, 'settings section: the three lines');
    await page.evaluate(() => { window.__CCF_TOOLKIT_MENU__.items.get('handout-settings').unmount(); const b = document.createElement('div'); b.id = 'gt-handout'; b.style.cssText = 'position:relative;height:500px'; document.body.appendChild(b); window.__CCF_TOOLKIT_MENU__.items.get('handout').mount(b); });
    await page.waitForTimeout(400);
    assert.deepEqual(await strip(), { lines: 0, shown: false }, 'the 핸드아웃 tab: no status lines');
    assert.deepEqual(errors, []);
    console.log('handout status lines only in settings PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
