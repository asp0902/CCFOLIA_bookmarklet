// toolkit-presence 0.0.24: the GM tools window ("도구" for players: the same window) can be resized like the handout show window:
// four edges (width only / height only) + four corners; min 400x320, max 92vw x 88vh; the opposite edge stays put; never off screen;
// the size is kept (browser) and comes back when reopened; a double click on an edge = default size; the tab content follows the width.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const src = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-toolkit-presence.user.js'), 'utf8');
const html = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif"><header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button><button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button></header><div id="root"></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: src });
    await page.evaluate(() => window.__CCF_TOOLKIT_MENU__.register({ id: 'probe', order: 1, label: '시험', visible: () => true, onClick() {}, mount: (c) => { c.innerHTML = '<div id="probe-body" style="position:absolute;inset:0">본문</div>'; }, unmount() {} }));
    await page.evaluate(() => window.__CCF_TOOLKIT_MENU__.openTool('probe'));
    const win = page.locator('#ccf-gm-tools .ccf-gt-window');
    await win.waitFor();
    const box = () => win.boundingBox();
    const b0 = await box();
    assert.equal(Math.round(b0.width), 640, 'default width');
    assert.equal(await page.locator('#ccf-gm-tools .ccf-gt-rz').count(), 8, 'four edges + four corners');
    const drag = async (d, dx, dy) => { const g = await page.locator(`#ccf-gm-tools .ccf-gt-rz[data-rz="${d}"]`).boundingBox(); const x = g.x + g.width / 2, y = g.y + g.height / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(50); return box(); };
    // east edge: wider, the west edge stays, height unchanged
    let b = await drag('e', 100, 0);
    assert(Math.abs(b.width - 740) <= 2 && Math.abs(b.x - b0.x) <= 2 && Math.abs(b.height - b0.height) <= 1, 'east edge: ' + JSON.stringify({ b0, b }));
    // south edge: shorter, the top stays, width unchanged
    const b1 = b; b = await drag('s', 0, -200);
    assert(Math.abs(b.height - (b1.height - 200)) <= 2 && Math.abs(b.y - b1.y) <= 2 && Math.abs(b.width - b1.width) <= 1, 'south edge: ' + JSON.stringify({ b1, b }));
    // the tab content follows the window
    const content = await page.locator('#probe-body').boundingBox();
    assert(Math.abs(content.width - b.width) <= 2, 'tab content follows the width: ' + JSON.stringify({ content, b }));
    // north-west corner: both, the south-east corner stays
    const b2 = b; b = await drag('nw', -60, -20);
    assert(Math.abs(b.x + b.width - (b2.x + b2.width)) <= 2 && Math.abs(b.y + b.height - (b2.y + b2.height)) <= 2 && b.width > b2.width && b.height > b2.height, 'corner: ' + JSON.stringify({ b2, b }));
    // limits: min 400x320, max 92vw x 88vh, never off screen
    b = await drag('e', -2000, 0); assert(Math.abs(b.width - 400) <= 1, 'min width ' + b.width);
    b = await drag('s', 0, -2000); assert(Math.abs(b.height - 320) <= 1, 'min height ' + b.height);
    b = await drag('se', 3000, 3000);
    assert(b.width <= 1200 * 0.92 + 1 && b.height <= 900 * 0.88 + 1, 'max ' + JSON.stringify(b));
    assert(b.x >= -1 && b.y >= -1 && b.x + b.width <= 1201 && b.y + b.height <= 901, 'inside the screen ' + JSON.stringify(b));
    // kept: close and reopen -> the same size
    const kept = b;
    await page.locator('#ccf-gm-tools .ccf-gt-close').click();
    await page.evaluate(() => window.__CCF_TOOLKIT_MENU__.openTool('probe'));
    await win.waitFor();
    b = await box();
    assert(Math.abs(b.width - kept.width) <= 1 && Math.abs(b.height - kept.height) <= 1, 'size kept after reopening ' + JSON.stringify({ kept, b }));
    // double click on an edge: default size
    await page.locator('#ccf-gm-tools .ccf-gt-rz[data-rz="e"]').dblclick();
    b = await box();
    assert.equal(Math.round(b.width), 640, 'default width again');
    assert.equal(await page.evaluate(() => localStorage.getItem('ccf-gm-tools-size-v1')), null, 'saved size cleared');
    assert.deepEqual(errors, []);
    console.log('gm tools resize PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
