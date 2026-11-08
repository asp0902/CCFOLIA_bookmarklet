const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Step 3 of the several panels, with the real script: the gear menu (detach/fix, close), a floating window (moved by the header, resized by its edges, kept inside the screen, frontmost when clicked),
// the docked panels close up around it, the floating state is saved and comes back after a reload, an overfull row detaches its leftmost panel, and the panels share one store subscription.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 2000, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    const load = async () => {
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(() => {
        window.__subscribes = 0;
        const state = { entities: { roomMessages: { entities: {}, ids: [], idsGroupBy: { main: [] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
        const store = { getState: () => state, dispatch() {}, subscribe: () => { window.__subscribes += 1; return () => {}; } };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
      });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(300);
    };
    const panels = () => page.evaluate(() => [...document.querySelectorAll('.ccf-scp-panel')].map((el) => { const r = el.getBoundingClientRect(); return { id: el.id, floating: el.classList.contains('is-floating'), right: el.style.right, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), z: el.style.zIndex }; }));
    await load();
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(700);
    let st = await panels(); assert.equal(st.length, 3); assert.deepEqual(st.map((p) => p.right), ['0px', '340px', '680px']);
    assert.equal(await page.evaluate(() => window.__subscribes), 1, 'one store subscription for all panels');
    assert.equal(await page.locator('.ccf-scp-close').count(), 3, 'every panel has the gear button (class kept)');
    // the gear menu of the middle panel: detach
    await page.locator('#ccf-chat-panel-2 .ccf-scp-gear').click();
    const items = await page.locator('.ccf-scp-menu-item').allInnerTexts();
    assert.deepEqual(items, ['분리', '이 채팅 패널 닫기']);
    await page.locator('.ccf-scp-menu-item', { hasText: '분리' }).click();
    await page.waitForTimeout(700);
    st = await panels();
    const byId = Object.fromEntries(st.map((p) => [p.id, p]));
    assert.equal(byId['ccf-chat-panel-2'].floating, true, 'detached'); assert.ok(Math.abs(byId['ccf-chat-panel-2'].w - 340) <= 4, 'same size as before: ' + byId['ccf-chat-panel-2'].w);
    assert.equal(byId['ccf-second-chat-panel'].right, '0px'); assert.equal(byId['ccf-chat-panel-3'].right, '340px', 'the others close up around it');
    // drag the floating window by its header
    const before = byId['ccf-chat-panel-2'];
    const bar = await page.locator('#ccf-chat-panel-2 .ccf-scp-bar').boundingBox();
    await page.mouse.move(bar.x + 60, bar.y + 20); await page.mouse.down(); await page.mouse.move(bar.x + 260, bar.y + 120, { steps: 5 }); await page.mouse.up();
    const moved = (await panels()).find((p) => p.id === 'ccf-chat-panel-2');
    assert.ok(Math.abs(moved.left - (before.left + 200)) <= 2, 'dragged sideways: ' + JSON.stringify({ before, moved }));
    assert.ok(moved.top >= 0 && moved.top + moved.h <= 900 + 4 || moved.h > 900, 'the window as tall as the screen has no room to move up or down: ' + JSON.stringify(moved));
    // it cannot leave the screen
    await page.mouse.move(moved.left + 60, moved.top + 20); await page.mouse.down(); await page.mouse.move(-500, -500, { steps: 4 }); await page.mouse.up();
    const clamped = (await panels()).find((p) => p.id === 'ccf-chat-panel-2');
    assert.ok(clamped.left >= 0 && clamped.top >= 0, 'kept inside: ' + JSON.stringify(clamped));
    // resize from the south-east corner, with the minimum size
    const box = await page.locator('#ccf-chat-panel-2').boundingBox();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1); await page.mouse.down(); await page.mouse.move(box.x + box.width + 119, box.y + box.height + 79, { steps: 4 }); await page.mouse.up();
    let r1 = (await panels()).find((p) => p.id === 'ccf-chat-panel-2');
    assert.ok(Math.abs(r1.w - 460) <= 2 && r1.h <= 900, 'wider by 120, no taller than the screen: ' + JSON.stringify(r1));
    const box2 = await page.locator('#ccf-chat-panel-2').boundingBox();
    await page.mouse.move(box2.x + box2.width - 1, box2.y + box2.height - 1); await page.mouse.down(); await page.mouse.move(box2.x - 1000, box2.y - 1000, { steps: 4 }); await page.mouse.up();
    r1 = (await panels()).find((p) => p.id === 'ccf-chat-panel-2');
    assert.ok(r1.w >= 300 && r1.h >= 360 && r1.w <= 302 && r1.h <= 362, 'minimum size 300x360: ' + JSON.stringify(r1));
    // clicking a floating window brings it to the front
    await page.evaluate(() => window.__ccfScpHost.instances.get(3).setFloating(true)); await page.waitForTimeout(500);
    const z3 = Number((await panels()).find((p) => p.id === 'ccf-chat-panel-3').z);
    const box3 = await page.locator('#ccf-chat-panel-2').boundingBox();
    await page.mouse.click(box3.x + 40, box3.y + box3.height - 40);
    const z2 = Number((await panels()).find((p) => p.id === 'ccf-chat-panel-2').z);
    assert.ok(z2 > z3 && z2 < 1300, 'the clicked window is in front and below the MUI dialogs: ' + JSON.stringify({ z2, z3 }));
    // reload: floating windows come back where they were
    const saved = await panels();
    await load(); await page.waitForTimeout(800);
    const after = await panels();
    const f2 = after.find((p) => p.id === 'ccf-chat-panel-2'), s2 = saved.find((p) => p.id === 'ccf-chat-panel-2');
    assert.ok(f2 && f2.floating && Math.abs(f2.left - s2.left) <= 2 && Math.abs(f2.w - s2.w) <= 2, 'restored floating: ' + JSON.stringify({ f2, s2 }));
    // fix it again from the menu: it joins the row at the leftmost place
    await page.locator('#ccf-chat-panel-2 .ccf-scp-gear').click();
    assert.deepEqual(await page.locator('.ccf-scp-menu-item').allInnerTexts(), ['고정', '이 채팅 패널 닫기']);
    await page.locator('.ccf-scp-menu-item', { hasText: '고정' }).click(); await page.waitForTimeout(700);
    const fixed = await panels();
    assert.equal(fixed.find((p) => p.id === 'ccf-chat-panel-2').floating, false);
    assert.equal(fixed.find((p) => p.id === 'ccf-chat-panel-2').right, '340px', 'back in the row: panel 3 is still floating, so panel 2 is next to the original after 1');
    // close from the menu
    await page.locator('#ccf-chat-panel-2 .ccf-scp-gear').click(); await page.locator('.ccf-scp-menu-item', { hasText: '이 채팅 패널 닫기' }).click(); await page.waitForTimeout(400);
    assert.ok(!(await panels()).some((p) => p.id === 'ccf-chat-panel-2'), 'closed');
    // a full row detaches its leftmost panel instead of refusing
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.evaluate(() => { for (const h of window.__ccfScpHost.instances.values()) if (h.index > 1) h.close(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(500);
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(600);
    const crowded = await panels();
    assert.ok(crowded.length >= 2, 'both panels are open: ' + JSON.stringify(crowded));
    assert.ok(crowded.some((p) => p.floating), 'one of them was detached to make room: ' + JSON.stringify(crowded));
    assert.deepEqual(errors, [], 'no page errors');
    console.log('chat panel floating PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
