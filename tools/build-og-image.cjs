// Builds prototype/public-handout-relay/public/og-image.png (the link-preview card, 1200x630) from the extension icon.
//   PLAYWRIGHT_MODULE=... CHROMIUM_EXECUTABLE=... node tools/build-og-image.cjs
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const icon = fs.readFileSync(path.join(root, 'extension/personal/icon.png')).toString('base64');
const out = path.join(root, 'prototype/public-handout-relay/public/og-image.png');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    // Dark card with the (inverted, white) capybara silhouette centered, like the original room preview's logo on dark.
    await page.setContent(`<style>html,body{margin:0;width:1200px;height:630px;background:#1a1a1a;display:flex;align-items:center;justify-content:center}
      img{height:420px;filter:invert(1);opacity:.96}</style><img src="data:image/png;base64,${icon}">`);
    await page.screenshot({ path: out, type: 'png' });
  } finally { await browser.close(); }
  console.log(`wrote ${path.relative(root, out)} (${fs.statSync(out).size} bytes)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
