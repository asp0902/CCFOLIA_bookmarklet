const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The real handout script on a room page: after the delayed mount attempts (200/600/1500/3000 ms) there is no ReferenceError ("active is not defined") on the page.
// HANDOUT_SOURCE=<file> runs another version (an old one fails).
const sourcePath = process.env.HANDOUT_SOURCE || path.join(__dirname, '../legacy/ccfolia-handout.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(3600);
    const referenceErrors = errors.filter((e) => /ReferenceError|is not defined/.test(e));
    if (process.env.HANDOUT_SOURCE) { console.log('errors:', JSON.stringify(referenceErrors)); return; }
    assert.deepEqual(referenceErrors, [], 'no ReferenceError after the delayed mounts: ' + referenceErrors.join(' | '));
    console.log('handout no reference error PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
