// 펭귄 머리 자르기 아이콘을 툴바 아이콘 옆에 24·48px 로 찍는다: node tools/render-penguin-face-crop.cjs docs/img/penguin-face-crop-24-48.png
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const src = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-toolkit-presence.user.js'), 'utf8');
const HEAD = src.match(/const PENGUIN_SVG = '(<svg.*?<\/svg>)'/)[1];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 560, height: 150 }, deviceScaleFactor: 3 });
  const person = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  const layers = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>';
  const cell = (svg, size, label) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><div style="width:${size + 16}px;height:${size + 16}px;display:grid;place-items:center;color:#fff">${svg.replace('width="24" height="24"', `width="${size}" height="${size}"`)}</div><small style="font:10px sans-serif;color:#aaa">${label}</small></div>`;
  await page.setContent(`<body style="margin:0;background:#212121;padding:12px"><div style="display:flex;gap:20px;align-items:flex-end">${cell(person, 24, 'person 24')}${cell(HEAD, 24, 'penguin 24')}${cell(layers, 24, 'layers 24')}${cell(person, 48, 'person 48')}${cell(HEAD, 48, 'penguin 48')}${cell(layers, 48, 'layers 48')}</div></body>`);
  await page.screenshot({ path: process.argv[2] || 'penguin-face-crop-24-48.png' });
  await browser.close();
})();
