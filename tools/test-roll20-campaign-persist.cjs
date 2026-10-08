// Roll20 reader: the campaign page stores its number in the tab's sessionStorage (and reads no chat); the game screen of the same tab sends it with each line.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'roll20-reader.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const html = '<div id="textchat"><div class="content"></div></div>';
  await page.route('https://app.roll20.net/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  const inject = () => page.evaluate(code => { window.sent = []; window.chrome = { runtime: { id: 'x', sendMessage: async m => { window.sent.push(m); } } }; (0, eval)(code); }, code);
  // 1) campaign page: remembered, nothing is read (a chat line on this page would not be sent)
  await page.goto('https://app.roll20.net/campaigns/details/22089717/my-game');
  await page.evaluate(() => document.querySelector('#textchat .content').insertAdjacentHTML('beforeend', '<div class="message general" data-messageid="x1"><span class="by">A:</span>x</div>'));
  await inject();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('capybaraR20Campaign')), '22089717');
  await page.waitForTimeout(3600);
  assert.equal((await page.evaluate(() => window.sent)).length, 0, 'the campaign page reads no chat');
  // 2) game screen of the same tab: no number in the page, the stored one is sent (also after a script reload)
  await page.goto('https://app.roll20.net/editor/?viewas=');
  await inject();
  await page.waitForTimeout(3300);
  await page.evaluate(() => document.querySelector('#textchat .content').insertAdjacentHTML('beforeend', '<div class="message general" data-messageid="m1"><span class="by">Alice:</span>안녕</div>'));
  await page.waitForTimeout(1300);
  const sent = await page.evaluate(() => window.sent);
  assert.equal(sent.length, 1); assert.equal(sent[0].message.campaignId, '22089717');
  // 3) a tab that never saw a campaign page: empty
  const other = await browser.newPage();
  await other.route('https://app.roll20.net/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await other.goto('https://app.roll20.net/editor/?viewas=');
  await other.evaluate(code => { window.sent = []; window.chrome = { runtime: { id: 'x', sendMessage: async m => { window.sent.push(m); } } }; (0, eval)(code); }, code);
  await other.waitForTimeout(3300);
  await other.evaluate(() => document.querySelector('#textchat .content').insertAdjacentHTML('beforeend', '<div class="message general" data-messageid="m2"><span class="by">Bob:</span>hi</div>'));
  await other.waitForTimeout(1300);
  assert.equal((await other.evaluate(() => window.sent))[0].message.campaignId || '', '', 'other tabs do not share the number');
  await browser.close();
  console.log('roll20 campaign persist PASS');
})().catch(error => { console.error(error); process.exit(1); });
