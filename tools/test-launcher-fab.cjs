// loader 0.3.251: the capybara button is the size and shape of ccfolia's board menu button (the pencil, MUI Fab large: 56×56 round, elevation 6 shadow,
// read from the page; 56px when it is not there). With no saved position it sits right left of the pencil button, centres level, 24px apart
// (the gap between ccfolia's buttons, measured: zoom-out → pencil; nothing of ccfolia sits left of the pencil).
// It follows the pencil while unsaved (the drawer moves it). A saved position (after a drag) wins and is kept on screen with the larger size;
// no pencil button → the old default corner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const loader = fs.readFileSync(path.join(__dirname, '../src/capybara-toolkit-loader.js'), 'utf8');
const FAB = '<button class="MuiFab-root MuiFab-circular MuiFab-sizeLarge" aria-label="盤面のメニュー" style="position:fixed;right:391px;bottom:16px;width:56px;height:56px;border-radius:50%;border:0;box-shadow:rgba(0, 0, 0, 0.2) 0px 3px 5px -1px, rgba(0, 0, 0, 0.14) 0px 6px 10px 0px, rgba(0, 0, 0, 0.12) 0px 1px 18px 0px"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 17.25V21h3.75L17.81 9.94"/></svg></button>';
const DRAWER = '<div class="MuiDrawer-paper" style="position:fixed;right:0;top:0;width:376px;height:100%;background:#333"></div>';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1300, height: 884 } });
    let body = FAB + DRAWER;
    await context.route('https://ccfolia.com/**', (route) => (/\.js(\?|$)/.test(route.request().url()) ? route.fulfill({ contentType: 'text/javascript', body: '' }) : route.fulfill({ contentType: 'text/html', body: `<body style="margin:0"><div id="root"></div>${body}</body>` })));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const open = async () => { await page.goto('https://ccfolia.com/rooms/test'); await page.addScriptTag({ content: loader }); };
    const button = () => page.evaluate(() => { const fab = document.getElementById('capybara-toolkit-root').shadowRoot.querySelector('.fab'); const r = fab.getBoundingClientRect(), c = getComputedStyle(fab); return { x: r.left, y: r.top, w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, radius: c.borderRadius, shadow: c.boxShadow }; });
    const pencil = () => page.evaluate(() => { const r = document.querySelector('.MuiFab-root').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    // 1) no saved position: beside the pencil, same size, same centre height; no room on the right (drawer) → left side
    await open(); await page.waitForTimeout(1200);
    let b = await button(), f = await pencil();
    assert.deepEqual([b.w, b.h], [56, 56], 'same size as the pencil button');
    assert.equal(b.radius, '50%'); assert.equal(b.shadow, 'rgba(0, 0, 0, 0.2) 0px 3px 5px -1px, rgba(0, 0, 0, 0.14) 0px 6px 10px 0px, rgba(0, 0, 0, 0.12) 0px 1px 18px 0px', 'the pencil button shadow');
    assert.equal(b.y + b.h / 2, f.y + f.h / 2, 'centres level');
    assert.equal(f.x - (b.x + b.w), 24, `24px left of the pencil, the gap between ccfolia's buttons (${JSON.stringify([b, f])})`);
    // the drawer closes: the pencil moves to the right edge, the button follows (still no room on the right: 16px)
    await page.evaluate(() => { document.querySelector('.MuiDrawer-paper').style.display = 'none'; document.querySelector('.MuiFab-root').style.right = '16px'; });
    await page.waitForTimeout(800);
    b = await button(); f = await pencil();
    assert.equal(f.x - (b.x + b.w), 24, 'follows the pencil');
    // 2) dragged → saved → kept after a reload (the pencil no longer moves it)
    const start = await button();
    await page.mouse.move(start.x + 28, start.y + 28); await page.mouse.down(); await page.mouse.move(start.x - 200, start.y - 300, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
    const dragged = await button();
    await open(); await page.waitForTimeout(1500);
    const kept = await button();
    assert.ok(Math.abs(kept.x - dragged.x) <= 1 && Math.abs(kept.y - dragged.y) <= 1, `saved position wins (${[kept.x, kept.y]} vs ${[dragged.x, dragged.y]}, rounding 1px)`);
    // 3) no pencil button (home page): the old default corner (right 16, bottom 16), 56px
    body = '';
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('capybara-toolkit'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await open(); await page.waitForTimeout(6000);
    b = await button();
    assert.deepEqual([b.w, Math.round(b.right), Math.round(b.bottom)], [56, 16, 16], 'default corner ' + JSON.stringify(b));
    assert.deepEqual(errors, []);
    console.log('launcher fab PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
