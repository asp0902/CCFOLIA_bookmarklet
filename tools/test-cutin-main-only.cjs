const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.setContent(`<div id="stage" style="position:relative;width:500px;height:400px">
      <div id="native-effect" style="position:absolute;inset:0;overflow:hidden;background:rgba(0,0,0,.5)"><img id="native-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:100px;height:100px"></div></div>
      <div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><textarea></textarea>
      <div role="log"><img id="chat-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" width="100" height="100"></div></div>`);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('[data-ccf-cutin-chat-mirror]').count(), 0, 'never duplicate native cut-ins into chat');
    assert(await page.locator('#native-image').isVisible(), 'main cut-in stays visible');
    assert(await page.locator('#chat-image').isVisible(), 'inline chat image stays visible');
    console.log('PASS: main cut-in and inline image preserved; no chat cut-in overlay');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
