// handout 0.1.132: one share button per card: "공유" when not shared, "공유 중단" (lit, blue) when shared; pressing it toggles (the two old handlers).
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
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const btn = () => page.evaluate(() => [...document.querySelector('#ccfolia-handout-root').shadowRoot.querySelectorAll('.card [data-action^="web-"]')].map((b) => [b.dataset.action, b.title, b.getAttribute('aria-pressed'), getComputedStyle(b).color]));
    let b = await btn();
    assert.deepEqual(b.map((x) => x.slice(0, 3)), [['web-share-handout', '공유', 'false']], 'one button, not shared: ' + JSON.stringify(b));
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.card [data-action="web-share-handout"]').click());
    await page.waitForTimeout(400);
    b = await btn();
    assert.deepEqual(b.map((x) => x.slice(0, 3)), [['web-stop-sharing', '공유 중단', 'true']], 'shared: the same place shows 공유 중단: ' + JSON.stringify(b));
    assert.equal(b[0][3], 'rgb(33, 150, 243)', 'lit');
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.card [data-action="web-stop-sharing"]').click());
    await page.waitForTimeout(300);
    assert.deepEqual((await btn()).map((x) => x.slice(0, 3)), [['web-share-handout', '공유', 'false']], 'stopped');
    console.log('handout share toggle PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
