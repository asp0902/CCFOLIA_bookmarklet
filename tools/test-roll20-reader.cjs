// Roll20 reader: history on screen at load is ignored; new lines are sent once with the speaker carried over; whispers are dropped; rolls become one line.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'roll20-reader.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.setContent('<script>var campaign_id = 22089717;</script><div id="textchat"><div class="content"><div class="message general" data-messageid="old"><span class="by">GM:</span>history</div></div></div>');
  await page.evaluate(() => { window.sent = []; window.chrome = { runtime: { id: 'x', sendMessage: async m => { window.sent.push(m); } } }; });
  await page.evaluate(code);
  await page.waitForTimeout(3300);
  await page.evaluate(() => {
    const add = html => document.querySelector('#textchat .content').insertAdjacentHTML('beforeend', html);
    add('<div class="message general" data-messageid="m1"><span class="tstamp">10:00</span><span class="by">Alice:</span>안녕하세요</div>');
    add('<div class="message general" data-messageid="m2">이어서 말함</div>');
    add('<div class="message rollresult" data-messageid="m3"><span class="by">Bob:</span><div class="formula">rolling 1d20+3</div><div class="formula formattedformula">...</div><div class="rolled">17</div></div>');
    add('<div class="message general private" data-messageid="m4"><span class="by">Alice:</span>비밀</div>');
    add('<div class="message system" data-messageid="m5">시스템</div>');
  });
  await page.waitForTimeout(1300);
  const sent = (await page.evaluate(() => window.sent)).map(m => m.message);
  assert.deepEqual(sent.map(m => [m.id, m.name, m.text, m.kind, m.source, m.campaignId]), [
    ['m1', 'Alice', '안녕하세요', 'general', 'roll20', '22089717'],
    ['m2', 'Alice', '이어서 말함', 'general', 'roll20', '22089717'],
    ['m3', 'Bob', '1d20+3 → 17', 'rollresult', 'roll20', '22089717'],
  ]);
  await page.waitForTimeout(1300);
  assert.equal((await page.evaluate(() => window.sent)).length, 3, 'nothing is sent twice');
  await browser.close();
  console.log('roll20 reader PASS');
})().catch(error => { console.error(error); process.exit(1); });
