const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// #119: the added chat panel clones the native composer's palette / colour / help icons. They were picked by position, so an
// extra button in the native name bar shifted every icon by one (list, colour and help ended up on the wrong buttons) and the
// native colour icon's inline character colour hid the panel's own tint.
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const start = source.indexOf('  function captureNativeSpeakerIcons(');
const end = source.indexOf('  // 입력창 커서 위치에 텍스트를 넣는다');
assert(start >= 0 && end > start, 'icon helpers not found');
const helpers = source.slice(start, end).replace('#${PANEL_ID}', '#panel');
const svg = (d, style = '') => `<svg viewBox="0 0 24 24" ${style ? `style="${style}"` : ''}><path d="${d}"/></svg>`;
const LIST = 'M19 5v14H5V5h14m1.1-2H3.9', PALETTE = 'M12 3c-4.97 0-9 4.03-9 9', HELP = 'M12 2C6.48 2 2 6.48 2 12', FACE = 'M9 11.75c-.69 0-1.25.56-';

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    for (const extraFirst of [false, true]) {
      await page.setContent(`<form><div class="bar"><input>${extraFirst ? `<button>${svg(FACE)}</button>` : ''}<button>${svg(LIST)}</button><button>${svg(PALETTE, 'color: rgb(98, 131, 133);')}</button><button aria-label="채팅 커맨드에 대해">${svg(HELP)}</button></div></form><div id="panel"></div>`);
      const result = await page.evaluate(code => {
        const run = new Function(`${code}; return { captureNativeSpeakerIcons, cloneNativeIcon };`);
        const { captureNativeSpeakerIcons, cloneNativeIcon } = run();
        const icons = captureNativeSpeakerIcons();
        const d = svgEl => svgEl?.querySelector('path').getAttribute('d');
        return { palette: d(icons.palette), color: d(icons.color), help: d(icons.help), cloneColor: cloneNativeIcon(icons.color).style.color };
      }, helpers);
      assert.deepEqual(result, { palette: LIST, color: PALETTE, help: HELP, cloneColor: '' }, `icons mapped by shape (extra native button first: ${extraFirst})`);
    }
    console.log('chat panel speaker icons follow the native order regardless of extra buttons PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
