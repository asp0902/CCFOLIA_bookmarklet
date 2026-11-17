// handout 0.1.134: the view popup resizes from its edges too (right/left = width only, bottom/top = height only), and the size is kept for the next opening.
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
      const value = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'h1', title: '지도', description: '<div>'+'본문 줄<br>'.repeat(40)+'</div>', gmNotes: '', permissions: {}, order: 1 }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const open = async () => { await page.evaluate(() => { document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((h) => h.remove()); document.querySelector('#ccfolia-handout-root').style.display = ''; document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="view-handout"][data-id="h1"]').click(); document.querySelector('#ccfolia-handout-root').style.display = 'none'; }); await page.waitForTimeout(300); }; // the list window sits above the popup; hidden so the edges are reachable
    const size = () => page.evaluate(() => { const p = document.querySelector('[data-ccf-handout-show="1"]').shadowRoot.querySelector('.show-paper').getBoundingClientRect(); return [Math.round(p.width), Math.round(p.height)]; });
    const grip = (d) => page.evaluate((d) => { const r = document.querySelector('[data-ccf-handout-show="1"]').shadowRoot.querySelector(`[data-rz="${d}"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, d);
    const drag = async (d, dx, dy) => { const [x, y] = await grip(d); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2); await page.mouse.move(x + dx, y + dy); await page.mouse.up(); };
    await open();
    const [w0, h0] = await size();
    await drag('e', 120, 0);
    let [w1, h1] = await size();
    assert.equal(w1, w0 + 120, 'right edge: width grows'); assert.equal(h1, h0, 'height unchanged');
    await drag('s', 0, -60);
    let [w2, h2] = await size();
    assert.equal(w2, w1, 'bottom edge: width unchanged'); assert.equal(h2, h1 - 60, 'height shrinks');
    await drag('e', -2000, 0);
    assert.equal((await size())[0], 240, 'minimum width');
    await drag('e', 100, 0);
    const kept = await size();
    await open();
    assert.deepEqual(await size(), kept, 'kept on reopening');
    assert.deepEqual(errors, []);
    console.log('handout popup edge resize PASS', JSON.stringify({ w0, h0, kept }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
