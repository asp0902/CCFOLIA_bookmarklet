const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The gear of the panel header: white (the copied native icon keeps fill = currentColor), and its menu looks like the original menu: when the user opens a native MUI menu the panel reads its
// real computed look (paper colour + overlay image, shadow, radius, list padding, item height/padding/font/colour) and the panel's own menu is drawn with exactly those values.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
assert.match(source, /copy\.setAttribute\("fill", "currentColor"\)/);
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<style>
      .MuiPopover-paper{position:fixed;top:60px;left:300px;width:261px;background:rgb(40,40,40);background-image:linear-gradient(rgba(255,255,255,0.092),rgba(255,255,255,0.092));box-shadow:0 5px 5px -3px rgba(1,2,3,.2);border-radius:6px;min-width:200px;color:rgb(250,250,250)}
      ul[role=menu]{margin:0;list-style:none;padding:7px 0}
      .MuiMenuItem-root{min-height:44px;padding:5px 15px;font:15px/1.4 Roboto,sans-serif;display:flex;align-items:center;color:rgb(240,240,240)}
      .nsvg{fill:currentColor}
    </style><div id="root"></div>
    <button aria-expanded="true" style="position:fixed;top:700px;left:10px;width:24px;height:64px"><svg class="nsvg" viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z"/></svg></button>
    <button aria-expanded="true" aria-haspopup="menu" style="position:fixed;top:8px;left:540px;width:48px;height:48px;padding:12px;box-sizing:border-box"><svg class="nsvg" viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z"/></svg></button>
    <div class="MuiPopover-paper"><ul role="menu" class="MuiMenu-list"><li role="menuitem" class="MuiMenuItem-root">네이티브 항목</li></ul></div>` }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => {
      const state = { entities: { roomMessages: { entities: {}, ids: [], idsGroupBy: { main: [] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(1600); // the menu watcher runs every second
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-scp-menu-style:v1') || 'null'));
    assert.ok(saved, 'the native menu look was read and saved');
    assert.equal(saved.paper.backgroundColor, 'rgb(40, 40, 40)'); assert.match(saved.paper.backgroundImage, /linear-gradient/); assert.equal(saved.paper.borderRadius, '6px');
    assert.equal(saved.item.minHeight, '44px'); assert.equal(saved.item.paddingLeft, '15px'); assert.equal(saved.list.paddingTop, '7px');
    assert.ok(saved.anchor && Math.abs(saved.anchor.dTop) < 100, 'the paper position relative to the opening button icon was saved');
    const diag = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.menuStyleDiag()); assert.ok(diag.saved && diag.lastCapture && diag.lastCapture.accepted, JSON.stringify(diag));
    // the panel's menu uses the values
    await page.locator('#ccf-second-chat-panel .ccf-scp-gear').click();
    const ours = await page.evaluate(() => { const m = document.querySelector('.ccf-scp-menu'), i = m.querySelector('.ccf-scp-menu-item'), pc = getComputedStyle(m), ic = getComputedStyle(i); return { bg: pc.backgroundColor, img: pc.backgroundImage.slice(0, 20), radius: pc.borderRadius, shadow: pc.boxShadow, padTop: pc.paddingTop, itemH: ic.minHeight, itemPadL: ic.paddingLeft, itemFont: ic.fontSize, itemColor: ic.color }; });
    assert.equal(ours.bg, 'rgb(40, 40, 40)'); assert.match(ours.img, /linear-gradient/); assert.equal(ours.radius, '6px'); assert.match(ours.shadow, /rgba\(1, 2, 3/); assert.equal(ours.padTop, '7px');
    assert.equal(ours.itemH, '44px'); assert.equal(ours.itemPadL, '15px'); assert.equal(ours.itemFont, '15px'); assert.equal(ours.itemColor, 'rgb(240, 240, 240)');
    // placed like the original: paper top = icon top + dTop, paper right = icon right - dRight; opens from the top-right with a scale+opacity transition
    const pos = await page.evaluate(() => { const m = document.querySelector('.ccf-scp-menu'), g = document.querySelector('.ccf-scp-gear svg').getBoundingClientRect(), r = m.getBoundingClientRect(); return { top: r.top, right: r.right, gTop: g.top, gRight: g.right, tr: getComputedStyle(m).transitionProperty, to: m.style.transformOrigin }; });
    assert.ok(Math.abs(pos.top - (pos.gTop + saved.anchor.dTop)) <= 1.5, JSON.stringify(pos));
    assert.ok(Math.abs(pos.right - (pos.gRight - saved.anchor.dRight)) <= 1.5 || pos.right >= 1600 - 8, JSON.stringify(pos));
    assert.match(pos.tr, /opacity/); assert.match(pos.tr, /transform/); assert.ok(pos.to);
    // the gear icon: white, not black (an svg without its own fill takes the button colour)
    const fill = await page.evaluate(() => { const g = document.querySelector('.ccf-scp-gear'); g.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z"/></svg>'; return { fill: getComputedStyle(g.querySelector('path')).fill, color: getComputedStyle(g).color }; });
    assert.equal(fill.fill, fill.color, 'the icon takes the button colour: ' + JSON.stringify(fill));
    assert.notEqual(fill.fill, 'rgb(0, 0, 0)');
    console.log('chat panel gear look PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
