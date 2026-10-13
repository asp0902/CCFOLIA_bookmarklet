// Roll20 game screen: the back-tick key in the chat input opens the speaker list and the character is not typed. The browser's own picker (showPicker) does not show up on a real keyboard press, so the
// page's own small list is always used: arrow keys, Enter, Esc, a click; the speaker is the select#speakingas whose change Roll20 saves (a native change event); focus and cursor stay in the input.
// The list goes under the input, or above it when the input sits at the bottom of the screen (as Roll20's does).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'roll20-reader.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const start = async atBottom => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.route('https://app.roll20.net/editor/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>var campaign_id = 22089717;</script><div id="textchat"><div class="content"></div></div>
      <div id="textchat-input" style="${atBottom ? 'position:fixed;left:500px;bottom:0;width:330px' : ''}"><textarea class="ui-autocomplete-input"></textarea><div class="clear"></div><div><div><label>화자:</label><select id="speakingas" class="selectize"><option value="player|-">카피바라 (GM)</option><option value="character|1">사문혁</option><option value="character|2">하문혁</option></select></div><button id="chatSendBtn" class="btn">전송</button></div></div>
      <script>window.saved = []; window.pickerCalls = 0; document.querySelector('#speakingas').addEventListener('change', () => window.saved.push(document.querySelector('#speakingas').value));
      HTMLSelectElement.prototype.showPicker = function () { window.pickerCalls += 1; };</script>` }));
    await page.goto('https://app.roll20.net/editor/');
    await page.evaluate(() => { window.chrome = { runtime: { id: 'x', sendMessage: async () => {} }, storage: { local: { get: async () => ({ r20AvOff: false }) } } }; });
    await page.evaluate(code);
    return page;
  };
  const press = (page, init) => page.evaluate(init => { const area = document.querySelector('#textchat-input textarea'); const event = new KeyboardEvent('keydown', { code: 'Backquote', key: '`', bubbles: true, cancelable: true, ...init }); area.dispatchEvent(event); return event.defaultPrevented; }, init);
  const where = page => page.evaluate(() => ({ active: document.activeElement?.id || document.activeElement?.tagName, sel: [document.querySelector('#textchat-input textarea').selectionStart, document.querySelector('#textchat-input textarea').selectionEnd], value: document.querySelector('#textchat-input textarea').value, saved: window.saved, picker: window.pickerCalls, list: !!document.getElementById('capybara-r20-speakers') }));

  let page = await start(false);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.capybaraR20Tick), '1', 'the handler marks itself');
  await page.fill('#textchat-input textarea', 'abc'); await page.evaluate(() => { const a = document.querySelector('#textchat-input textarea'); a.focus(); a.setSelectionRange(1, 2); });
  assert.equal(await press(page, {}), true, 'the key is taken');
  let state = await where(page);
  assert.deepEqual([state.list, state.picker, state.active, state.value], [true, 0, 'TEXTAREA', 'abc'], 'the list appears; the browser picker is not used; the focus stays in the input; nothing typed');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#capybara-r20-speakers li')].map(li => [li.textContent, li.getAttribute('aria-selected')])), [['카피바라 (GM)', 'true'], ['사문혁', 'false'], ['하문혁', 'false']], 'the current speaker is marked');
  const geometry = await page.evaluate(() => { const list = document.getElementById('capybara-r20-speakers').getBoundingClientRect(), area = document.querySelector('#textchat-input textarea').getBoundingClientRect(); return { below: list.top >= area.bottom }; });
  assert.equal(geometry.below, true, 'under the input when there is room');
  // arrow keys and Enter (the keys do not reach the input: Enter would send)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  state = await where(page);
  assert.deepEqual([state.saved, state.list, state.active, state.sel, state.value], [['character|1'], false, 'TEXTAREA', [1, 2], 'abc'], 'Enter chooses; Roll20 got the change; the cursor is where it was');
  // a second press of the key closes it, Esc closes it, a click elsewhere closes it; none of them change the speaker
  await press(page, {}); await press(page, {});
  assert.equal((await where(page)).list, false, 'the key again closes');
  await press(page, {}); await page.keyboard.press('Escape');
  assert.equal((await where(page)).list, false, 'Esc closes');
  await press(page, {}); await page.mouse.click(5, 5);
  state = await where(page);
  assert.deepEqual([state.list, state.saved.length], [false, 1], 'a click elsewhere closes it');
  // a click on an entry
  await press(page, {}); await page.dispatchEvent('#capybara-r20-speakers li:nth-child(3)', 'mousedown');
  assert.deepEqual((await where(page)).saved, ['character|1', 'character|2']);
  // keys that are not a plain back-tick are left alone
  for (const init of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { code: 'Digit1', key: '1' }]) assert.equal(await press(page, init), false, JSON.stringify(init));
  assert.equal((await where(page)).list, false);
  // a real composition (a word being typed) keeps its keys; the IME's own flag on the first key does not count, and the character it would insert is stopped
  await page.evaluate(() => document.querySelector('#textchat-input textarea').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  assert.equal(await press(page, {}), false, 'composing: left alone');
  await page.evaluate(() => document.querySelector('#textchat-input textarea').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  assert.equal(await press(page, { key: 'Process', keyCode: 229, isComposing: true }), true, 'the IME flag alone does not stop it');
  assert.equal(await page.evaluate(() => { const event = new InputEvent('beforeinput', { data: '`', inputType: 'insertText', bubbles: true, cancelable: true }); document.querySelector('#textchat-input textarea').dispatchEvent(event); return event.defaultPrevented; }), true, 'the letter the IME would type is stopped');
  await page.close();

  // the chat input at the bottom of the screen (Roll20's is): the list goes above it
  page = await start(true);
  await press(page, {});
  const placed = await page.evaluate(() => { const list = document.getElementById('capybara-r20-speakers').getBoundingClientRect(), area = document.querySelector('#textchat-input textarea').getBoundingClientRect(); return { above: list.bottom <= area.top + 1, inside: list.top >= 0 && list.bottom <= window.innerHeight }; });
  assert.deepEqual(placed, { above: true, inside: true });
  await browser.close();
  console.log('roll20 speaker tick PASS');
})().catch(error => { console.error(error); process.exit(1); });
