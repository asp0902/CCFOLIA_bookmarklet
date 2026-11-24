// The "open in another window" chat window (/rooms/{id}/chat): the chat fills the window. theme 0.2.68 does not apply the chat width saved in the main
// window there (a 585px window with a 555px saved width left a 30px band on the left, measured) and adds no width handle; the loader hides the capybara button there.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const theme = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, '../src/capybara-toolkit-loader.js'), 'utf8');
assert(loader.includes(String.raw`if (/^\/rooms\/[^/]+\/chat\/?$/.test(location.pathname)) root.style.display = "none";`), 'loader hides the button in /chat');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const run = async (url) => {
      const page = await browser.newPage({ viewport: { width: 585, height: 800 } });
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="margin:0;background:#222"><div id="root"></div><div class="MuiDrawer-root MuiDrawer-docked" style="display:flex;justify-content:flex-end"><div class="MuiDrawer-paper" style="width:100%;height:700px;position:relative"><ul role="log"></ul><form><textarea name="text" class="MuiInputBase-inputMultiline"></textarea></form></div></div></body>' }));
      await page.goto(url);
      await page.evaluate(() => localStorage.setItem('ccf-chat-width', '555'));
      await page.addScriptTag({ content: theme });
      await page.waitForTimeout(1500);
      const out = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-ccf-chat-w'), left: Math.round(document.querySelector('.MuiDrawer-paper').getBoundingClientRect().left), grip: !!document.querySelector('.ccf-chat-grip') }));
      await page.close(); return out;
    };
    const chat = await run('https://ccfolia.com/rooms/test/chat');
    assert.deepEqual({ attr: chat.attr, left: chat.left, grip: chat.grip }, { attr: false, left: 0, grip: false }, '/chat window: full width, no handle ' + JSON.stringify(chat));
    const room = await run('https://ccfolia.com/rooms/test');
    assert.equal(room.attr, true, 'main room window still uses the saved width');
    console.log('chat window fit PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
