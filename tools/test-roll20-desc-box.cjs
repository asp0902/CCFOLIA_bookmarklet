// The "/desc" box next to the send button of the Roll20 game screen: when ticked, every line that is not empty and does not start with "/" gets "/desc " just before Roll20 takes the text
// (Enter and the send button, seen first; Shift+Enter, IME composition and an open autocomplete are left alone); unticked changes nothing; the ticked state is remembered per campaign.
// The fake page copies the measured Roll20 markup (#textchat-input > textarea, #speakingas, #chatSendBtn) and its handlers: Enter (no Shift) triggers a click on the button, which reads the textarea.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'roll20-reader.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.route('https://app.roll20.net/editor/', route => route.fulfill({ contentType: 'text/html', body: `<script>var campaign_id = 22089717;</script><div id="textchat"><div class="content"></div></div>
    <div id="textchat-input"><textarea class="ui-autocomplete-input"></textarea><div class="clear"></div><div><div><label>화자:</label><select id="speakingas"><option>카피바라 (GM)</option></select></div><button id="chatSendBtn" class="btn">전송</button></div></div>
    <script>
      window.sent = [];
      // Roll20: Enter without Shift clicks the send button (jQuery trigger: handlers first, then the native click); the click reads the text and clears the box
      document.querySelector('#textchat-input textarea').addEventListener('keydown', e => { if (e.which === 13) { if (e.shiftKey) return; document.querySelector('#chatSendBtn').click(); e.preventDefault(); } });
      document.querySelector('#chatSendBtn').addEventListener('click', () => { const a = document.querySelector('#textchat-input textarea'); window.sent.push(a.value.trim()); a.value = ''; });
    </script>` }));
  const start = async () => {
    await page.goto('https://app.roll20.net/editor/');
    await page.evaluate(() => { window.chrome = { runtime: { id: 'x', sendMessage: async () => {} } }; });
    await page.evaluate(code);
    await page.waitForSelector('#capybara-r20-desc input', { timeout: 5000 });
  };
  await start();
  const type = async text => { await page.fill('#textchat-input textarea', text); await page.focus('#textchat-input textarea'); };
  const sentLast = async () => (await page.evaluate(() => window.sent)).at(-1);
  // the box sits next to the send button, with the page's own look
  const look = await page.evaluate(() => { const box = document.getElementById('capybara-r20-desc'), send = document.getElementById('chatSendBtn'); return { after: send.nextElementSibling === box, text: box.textContent }; });
  assert.deepEqual(look, { after: true, text: '/desc' });
  // unticked: nothing changes
  await type('안녕\n둘째'); await page.keyboard.press('Enter');
  assert.equal(await sentLast(), '안녕\n둘째', 'unticked: unchanged');
  // ticked: lines get /desc, empty lines and commands stay
  await page.check('#capybara-r20-desc input');
  await type('안녕\n\n/w gm 비밀\n  둘째 줄\n/desc 이미 명령'); await page.keyboard.press('Enter');
  assert.equal(await sentLast(), '/desc 안녕\n\n/w gm 비밀\n/desc 둘째 줄\n/desc 이미 명령', 'Enter: /desc in front of plain lines only');
  // the send button gives the same
  await type('버튼으로\n보냄'); await page.click('#chatSendBtn');
  assert.equal(await sentLast(), '/desc 버튼으로\n/desc 보냄', 'the send button');
  // pressed twice (Enter turns into a click): never "/desc /desc"
  assert(!(await page.evaluate(() => window.sent)).some(text => text.includes('/desc /desc')));
  // Shift+Enter is a new line, not a send: nothing is changed
  await type('줄바꿈'); await page.keyboard.press('Shift+Enter');
  assert.equal(await page.inputValue('#textchat-input textarea'), '줄바꿈\n', 'Shift+Enter leaves the text alone');
  // IME composition: Enter belongs to the composition
  await page.evaluate(() => { const a = document.querySelector('#textchat-input textarea'); a.value = '조합 중'; a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })); });
  assert.equal(await page.inputValue('#textchat-input textarea'), '조합 중', 'composing: unchanged');
  // remembered per campaign
  await start();
  assert.equal(await page.isChecked('#capybara-r20-desc input'), true, 'the ticked state comes back');
  await page.uncheck('#capybara-r20-desc input');
  await start();
  assert.equal(await page.isChecked('#capybara-r20-desc input'), false);
  await type('다시 끔'); await page.keyboard.press('Enter');
  assert.equal(await sentLast(), '다시 끔');
  await browser.close();
  console.log('roll20 desc box PASS');
})().catch(error => { console.error(error); process.exit(1); });
