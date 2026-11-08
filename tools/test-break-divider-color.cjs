const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The divider line of a break row is drawn with a border (one device pixel at any zoom) in the colour read from a real message row of the page (--ccf-divider-color).
const sync = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const fn = sync.slice(sync.indexOf('  let dividerColorAt = 0;'), sync.indexOf('  function normalizeRuns(runs, textLength) {'));
assert.ok(fn.includes('function refreshDividerColor'), 'the colour reader exists');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<style>.MuiListItem-root{display:block;border-bottom:1px solid rgba(255,255,255,0.0823);padding:8px 16px}</style><ul><li class="MuiListItem-root"><h6>A</h6></li><li class="MuiListItem-root"><div class="ccf-render-root" data-ccf-break="1">x</div></li></ul>' }));
    await page.goto('https://ccfolia.test/rooms/test');
    const out = await page.evaluate((code) => { (0, eval)(code + '\nwindow.__r = refreshDividerColor;'); window.__r(); return { v: document.documentElement.style.getPropertyValue('--ccf-divider-color'), dpr: devicePixelRatio, bw: getComputedStyle(document.querySelector('li')).borderBottomWidth }; }, fn);
    assert.match(out.v, /rgba\(255, 255, 255, 0\.08/); assert.equal(out.dpr, 1.5);
    console.log('break divider colour PASS', JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
