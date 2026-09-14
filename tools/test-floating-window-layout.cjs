const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
const start = source.indexOf('  function installStyle()');
const install = source.slice(start, source.indexOf('\n  }', start) + 4);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent('<input id="chat" aria-label="Chat"><button id="room-action">Room action</button><div id="ccf-character-sheet-root"><section class="ccf-cs-dialog is-editor" role="dialog" aria-modal="false"><header>Sheet</header><main><input aria-label="Sheet field"></main><footer><button id="sheet-action">Sheet action</button></footer></section></div>');
    await page.evaluate(install => {
      const ROOT_ID = 'ccf-character-sheet-root', STYLE_ID = 'sheet-style', ICON_ATTR = 'data-icon', DIALOG_BUTTON_ATTR = 'data-dialog-button';
      eval(install + '\ninstallStyle();');
      document.querySelector('#room-action').onclick = () => document.body.dataset.roomClicked = '1';
      document.querySelector('#sheet-action').onclick = () => document.body.dataset.sheetClicked = '1';
    }, install);
    await page.getByLabel('Chat', { exact: true }).fill('Message while sheet is open');
    await page.locator('#room-action').click();
    await page.getByLabel('Sheet field').fill('Editable');
    await page.locator('#sheet-action').click();
    assert.equal(await page.locator('#chat').inputValue(), 'Message while sheet is open');
    assert.equal(await page.locator('body').getAttribute('data-room-clicked'), '1');
    assert.equal(await page.locator('body').getAttribute('data-sheet-clicked'), '1');
    const desktop = await page.locator('.ccf-cs-dialog').boundingBox();
    assert.equal(desktop.width, 500);
    assert.equal(desktop.height, 600);
    await page.setViewportSize({ width: 390, height: 640 });
    const mobile = await page.locator('.ccf-cs-dialog').boundingBox();
    assert.equal(mobile.width, 370);
    assert.equal(mobile.height, 600);
    assert(mobile.x >= 0 && mobile.y >= 0 && mobile.x + mobile.width <= 390 && mobile.y + mobile.height <= 640);
    assert(!source.includes('class="ccf-cs-backdrop"'));
    console.log('Floating window: background input, both click surfaces, desktop/mobile sizes passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
