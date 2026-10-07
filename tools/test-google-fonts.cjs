const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// A font-family used by a Roll20 macro is loaded from Google Fonts: listed fonts with their weights, unknown Latin names as a best guess
// (retrying without weights if that request fails), never system/generic fonts.
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-roll20-css-bridge.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    const links = () => page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href).filter(h => h.includes('fonts.googleapis.com')));
    const use = family => page.evaluate(font => window.__CCF_ENSURE_GOOGLE_FONTS__(font), family);
    await use("'Hahmlet', serif");
    assert.deepEqual(await links(), ['https://fonts.googleapis.com/css2?family=Hahmlet:wght@400;700&display=swap']);
    await use('Arial, Helvetica, sans-serif'); await use('"맑은 고딕"');
    assert.equal((await links()).length, 1, 'system, generic and non-Latin names add no request');
    await use("'Playfair Display'");
    assert((await links()).includes('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap'), 'an unlisted Latin name is tried');
    await use("'Playfair Display'");
    assert.equal((await links()).length, 2, 'each font is requested once');
    await page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet]')].find(l => l.href.includes('Playfair')).dispatchEvent(new Event('error')));
    assert((await links()).includes('https://fonts.googleapis.com/css2?family=Playfair+Display&display=swap'), 'retried without weights after a failure');
    console.log('google fonts: listed, guessed and skipped families PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
