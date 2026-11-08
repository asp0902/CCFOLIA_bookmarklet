const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The real loader: __CCF_TOOLKIT_VERSIONS__() / __CAPYBARA_TOOLKIT__.diag() tell the loader version, how each script was fetched (network or the IndexedDB fallback), the versions the scripts registered, and the script tags.
const loader = fs.readFileSync(path.join(__dirname, '../src/capybara-toolkit-loader.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route('https://ccfolia.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => localStorage.setItem('ccf-suite-registry-v1', JSON.stringify({ scripts: { 'ccf-format-sync': { version: '0.1.88', lastSeenAt: '2026-11-08T00:00:00Z', lastSeenUrl: 'https://ccfolia.com/rooms/test' } } })));
    await page.addScriptTag({ content: loader });
    await page.waitForTimeout(500);
    const d = await page.evaluate(() => window.__CCF_TOOLKIT_VERSIONS__());
    assert.match(d.loader.version, /^\d+\.\d+\.\d+$/); assert.ok(d.loader.buildId);
    assert.equal(d.registry['ccf-format-sync'].version, '0.1.88');
    assert.ok(Array.isArray(d.loadLog) && Array.isArray(d.scriptTags));
    assert.deepEqual(await page.evaluate(() => typeof window.__CAPYBARA_TOOLKIT__.diag), 'function');
    console.log('toolkit diag PASS', JSON.stringify(d.loader));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
