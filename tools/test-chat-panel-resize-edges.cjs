const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// A detached (floating) chat panel is resized from its left and right edges (a 10px handle, 6px of it inside the panel), the cursor changes on the handles, the minimum width holds, the new width is saved
// and comes back after a reload. The real script; the mouse is used like a user would (grab 2px inside the edge, and 2px outside it).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1800, height: 900 } });
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    const load = async () => {
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(() => {
        const entities = {}, ids = [];
        for (let i = 0; i < 40; i += 1) { entities['m' + i] = { name: '눈깅이', text: '긴 줄 ' + i, channel: 'main', createdAt: { seconds: 1700000000 + i, nanoseconds: 0 } }; ids.push('m' + i); }
        const state = { entities: { roomMessages: { entities, ids, idsGroupBy: { main: ids } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(300);
    };
    const rect = () => page.evaluate(() => { const r = document.querySelector('#ccf-second-chat-panel').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), top: Math.round(r.top), h: Math.round(r.height) }; });
    await load();
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__ccfScpHost.instances.get(1).setFloating(true));
    await page.waitForTimeout(600);
    // move it away from the screen edge first (by its header) so that widening has room on both sides
    const bar = await page.locator('#ccf-second-chat-panel .ccf-scp-bar').boundingBox();
    await page.mouse.move(bar.x + 60, bar.y + 20); await page.mouse.down(); await page.mouse.move(bar.x - 600, bar.y + 20, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const r0 = await rect();
    // the handles exist, are on top at their spot and show the resize cursor
    const probe = await page.evaluate(() => { const out = {}; for (const dir of ['e', 'w']) { const g = document.querySelector('#ccf-second-chat-panel .ccf-scp-rz-' + dir); const gr = g.getBoundingClientRect(); const x = dir === 'e' ? gr.left + gr.width - 2 : gr.left + 2, y = gr.top + gr.height / 2; const top = document.elementFromPoint(x, y); out[dir] = { w: Math.round(gr.width), onTop: top === g, cursor: getComputedStyle(g).cursor }; } return out; });
    assert.deepEqual(probe, { e: { w: 10, onTop: true, cursor: 'ew-resize' }, w: { w: 10, onTop: true, cursor: 'ew-resize' } }, 'handles: ' + JSON.stringify(probe));
    const mid = r0.top + Math.round(r0.h / 2);
    // right edge, grabbed 2px INSIDE the panel, pulled 120px to the right
    await page.mouse.move(r0.right - 2, mid); await page.mouse.down(); await page.mouse.move(r0.right + 118, mid, { steps: 6 }); await page.mouse.up();
    const r1 = await rect();
    assert.ok(Math.abs(r1.w - (r0.w + 120)) <= 2 && r1.left === r0.left, 'right edge from the inside: ' + JSON.stringify({ r0, r1 }));
    // left edge, grabbed 2px OUTSIDE the panel, pulled 80px to the left
    await page.mouse.move(r1.left - 2, mid); await page.mouse.down(); await page.mouse.move(r1.left - 82, mid, { steps: 6 }); await page.mouse.up();
    const r2 = await rect();
    assert.ok(Math.abs(r2.w - (r1.w + 80)) <= 2 && Math.abs(r2.right - r1.right) <= 2, 'left edge from the outside: ' + JSON.stringify({ r1, r2 }));
    // over the list (scrollbar side) the drag still resizes; and the list does not scroll by it
    const scrollBefore = await page.evaluate(() => document.querySelector('#ccf-second-chat-panel .ccf-scp-list').scrollTop);
    await page.mouse.move(r2.right - 1, mid + 60); await page.mouse.down(); await page.mouse.move(r2.right - 41, mid + 60, { steps: 5 }); await page.mouse.up();
    const r3 = await rect();
    assert.ok(Math.abs(r3.w - (r2.w - 40)) <= 2, 'narrower by 40 from the right edge: ' + JSON.stringify({ r2, r3 }));
    assert.equal(await page.evaluate(() => document.querySelector('#ccf-second-chat-panel .ccf-scp-list').scrollTop), scrollBefore, 'the list did not scroll');
    // minimum width
    await page.mouse.move(r3.left + 2, mid); await page.mouse.down(); await page.mouse.move(r3.right + 400, mid, { steps: 6 }); await page.mouse.up();
    const r4 = await rect();
    assert.ok(r4.w >= 300 && r4.w <= 302, 'minimum width 300: ' + JSON.stringify(r4));
    // widen again, then reload: saved
    await page.mouse.move(r4.right - 2, mid); await page.mouse.down(); await page.mouse.move(r4.right + 148, mid, { steps: 6 }); await page.mouse.up();
    const r5 = await rect();
    assert.ok(Math.abs(r5.w - (r4.w + 150)) <= 2, 'widened: ' + JSON.stringify({ r4, r5 }));
    await load(); await page.waitForTimeout(900);
    const r6 = await rect();
    assert.ok(Math.abs(r6.w - r5.w) <= 2 && Math.abs(r6.left - r5.left) <= 2, 'the width comes back after a reload: ' + JSON.stringify({ r5, r6 }));
    console.log('chat panel resize edges PASS', JSON.stringify({ r0: r0.w, r1: r1.w, r2: r2.w, r3: r3.w, r4: r4.w, r5: r5.w, r6: r6.w }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
