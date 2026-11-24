// The install page: the drag button's address is bookmarklet.js character for character, a click on the page does not run it, the copy button copies the same code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = path.join(__dirname, '..');
const PAGES = 'https://asp0902.github.io/CCFOLIA_bookmarklet/';
const code = fs.readFileSync(path.join(repo, 'bookmarklet.js'), 'utf8').trim();
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext(); await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://asp0902.github.io' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route(PAGES + '**', (route) => { const file = path.join(repo, decodeURIComponent(new URL(route.request().url()).pathname.replace('/CCFOLIA_bookmarklet/', '')).replace(/\/$/, '/index.html')); if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' }); route.fulfill({ contentType: file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', body: fs.readFileSync(file) }); });
    await page.goto(PAGES + 'install/');
    await page.waitForFunction(() => document.getElementById('bookmarklet').getAttribute('href') !== '#');
    assert.equal(await page.getAttribute('#bookmarklet', 'href'), code, 'the button is bookmarklet.js itself');
    assert.equal(await page.textContent('#bookmarklet'), '카피바라 4세');
    await page.click('#bookmarklet');
    assert.equal(await page.evaluate(() => !!window.__CAPYBARA_TOOLKIT__ || !!document.getElementById('capybara-toolkit-bookmarklet-status')), false, 'a click on the page does not run it');
    await page.click('#copy'); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code, 'the copy button copies the same code');
    const text = await page.textContent('main');
    for (const words of ['Ctrl', '북마크바', 'javascript:', '크롬', '확장 프로그램']) assert(text.includes(words), words);
    assert.equal(/ChW_|qKh4|Ch5CA|FNxxq|token|@gmail/i.test(fs.readFileSync(path.join(repo, 'install/index.html'), 'utf8')), false, 'no room address or personal data');
    assert.deepEqual(errors, []);
    console.log('install page PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
