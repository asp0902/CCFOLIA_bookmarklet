const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Several chat panels: "add" opens a new one each time (styled by its own style tag), they stack to the left in the order they were opened, closing one keeps the others,
// the list of open panels is saved and the other panels come back after a reload.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 2000, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.test/rooms/test');
    const load = async () => { await page.goto('https://ccfolia.test/rooms/test'); await page.addScriptTag({ content: source }); await page.waitForTimeout(250); };
    await load();
    const state = () => page.evaluate(() => ({
      panels: [...document.querySelectorAll('.ccf-scp-panel')].map((el) => ({ id: el.id, title: el.querySelector('.ccf-scp-title')?.textContent || '', right: el.style.right, styled: getComputedStyle(el).position === 'fixed' })),
      styles: [...document.querySelectorAll('style[id^="ccf-scp-style"]')].map((el) => el.id)
    }));
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(200);
    let st = await state(); assert.equal(st.panels.length, 1); assert.equal(st.panels[0].id, 'ccf-second-chat-panel');
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(250);
    st = await state();
    assert.equal(st.panels.length, 3, JSON.stringify(st)); assert.deepEqual(st.panels.map((p) => p.id), ['ccf-second-chat-panel', 'ccf-chat-panel-2', 'ccf-chat-panel-3']);
    assert.ok(st.panels.every((p) => p.styled), 'every panel is styled'); assert.deepEqual(st.styles, ['ccf-scp-style', 'ccf-scp-style-2', 'ccf-scp-style-3']);
    assert.deepEqual(st.panels.map((p) => p.right), ['0px', '340px', '680px'], 'stacked to the left in the opening order');
    // close the middle one: the others stay, the third moves in
    await page.evaluate(() => window.__ccfScpHost.instances.get(2).close()); await page.waitForTimeout(700);
    st = await state(); assert.deepEqual(st.panels.map((p) => p.id), ['ccf-second-chat-panel', 'ccf-chat-panel-3']); assert.deepEqual(st.panels.map((p) => p.right), ['0px', '340px']);
    // "add" reopens the closed one first
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(250);
    st = await state(); assert.equal(st.panels.length, 3);
    // the saved list and a reload
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-scp-instances:v1')));
    assert.deepEqual(saved.open, [1, 2, 3]);
    await load(); await page.waitForTimeout(300);
    st = await state(); assert.deepEqual(st.panels.map((p) => p.id).sort(), ['ccf-chat-panel-2', 'ccf-chat-panel-3', 'ccf-second-chat-panel'], 'the other panels come back');
    // not too many for a narrow window
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => { for (const h of [...window.__ccfScpHost.instances.values()]) if (h.index > 1) h.close(); });
    await page.evaluate(() => window.__ccfScpHost.addPanel()); await page.waitForTimeout(200);
    st = await state(); assert.ok(st.panels.length <= 2, 'a narrow window does not take more panels than it can show');
    assert.deepEqual(errors, [], 'no errors');
    console.log('chat panel multi PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
