const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
// hand-drawn Adelie penguin head (+ a little neck), facing right: silhouette in currentColor, the white eye ring is a hole (evenodd) with the pupil circle (ring radius / 1.9, same centre) filled again, short beak wedge.
const HEAD = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3.5 22.5C2.6 16 3 9.5 8 5.6C12.2 2.4 17.6 4.2 18.6 8.9L22.6 10.6L22.6 12.1L18.3 13.2C17.9 15.4 16.7 17.4 15.2 19C14.6 20.3 14.6 21.6 15.3 22.5ZM13.6 9.6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0ZM13.6 9.6m-1.58 0a1.58 1.58 0 1 0 3.16 0a1.58 1.58 0 1 0-3.16 0Z"/></svg>';
module.exports = { HEAD };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 520, height: 150 }, deviceScaleFactor: 3 });
  const other = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const other2 = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>';
  const row = (svg, size, label) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:${size + 16}px;height:${size + 16}px;display:grid;place-items:center;border-radius:50%;color:#fff">${svg.replace(/width="24" height="24"/, `width="${size}" height="${size}"`)}</div><small style="font:10px sans-serif;color:#aaa">${label}</small></div>`;
  await page.setContent(`<body style="margin:0;background:#212121;color:#fff;padding:12px"><div style="display:flex;gap:20px;align-items:flex-end">${row(other, 24, 'person 24')}${row(HEAD, 24, 'head 24')}${row(other2, 24, 'layers 24')}${row(other, 48, 'person 48')}${row(HEAD, 48, 'head 48')}${row(other2, 48, 'layers 48')}</div></body>`);
  await page.screenshot({ path: process.argv[2] || 'penguin-head-24-48.png' });
  await browser.close();
})();
