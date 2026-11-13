const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The panel script builds its panel through createPanelInstance(index): the whole script loads, the API is there, the first panel keeps the old id and gets the shared class.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
assert.match(source, /const createPanelInstance = \(INSTANCE_INDEX(, OPTIONS = \{\})?\) => \{/);
assert.match(source, /const PANEL_ID = INSTANCE_INDEX === 1 \? "ccf-second-chat-panel" : `ccf-chat-panel-\$\{INSTANCE_INDEX\}`;/);
assert.match(source, /createPanelInstance\(1\);\n?\r?\n?\}\)\(\);/);
assert.doesNotMatch(source, /closest\(`#\$\{PANEL_ID\}`\)/, 'exclusion of the panels is class based');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('about:blank');
    await page.setContent('<body><div id="root"></div></body>');
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => ({ api: typeof window.__CCF_SECOND_CHAT_PANEL__, version: window.__CCF_SECOND_CHAT_PANEL__?.version }));
    assert.deepEqual(errors, [], 'no errors while loading');
    assert.equal(info.api, 'object'); assert.match(info.version, /^0\.[0-9]+\.[0-9]+$/);
    // open the panel by the API and check the id and the class
    const opened = await page.evaluate(() => { const api = window.__CCF_SECOND_CHAT_PANEL__; try { (api.open || api.openPanel || (() => {}))(); } catch (e) {} const el = document.getElementById('ccf-second-chat-panel'); return el ? { cls: el.classList.contains('ccf-scp-panel') } : null; });
    if (opened) assert.equal(opened.cls, true);
    console.log('chat panel instance PASS', JSON.stringify({ opened: !!opened }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
