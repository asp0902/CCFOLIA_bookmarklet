// Roll20 game screen: the back-tick key in the chat input opens the speaker list (select#speakingas) and the character is not typed. The fake page has the measured markup and Roll20's change handler
// (it reads the select and saves). The browser's picker (showPicker) is a stub; when it is refused a small list under the input does the job (arrow keys, Enter, Esc). Focus and cursor go back to the input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'roll20-reader.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const start = async pickerWorks => {
    const page = await browser.newPage();
    await page.route('https://app.roll20.net/editor/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>var campaign_id = 22089717;</script><div id="textchat"><div class="content"></div></div>
      <div id="textchat-input"><textarea class="ui-autocomplete-input"></textarea><div class="clear"></div><div><div><label>화자:</label><select id="speakingas" class="selectize"><option value="player|-">카피바라 (GM)</option><option value="character|1">사문혁</option><option value="character|2">하문혁</option></select></div><button id="chatSendBtn" class="btn">전송</button></div></div>
      <script>window.saved = []; window.pickerCalls = 0; document.querySelector('#speakingas').addEventListener('change', () => window.saved.push(document.querySelector('#speakingas').value));
      HTMLSelectElement.prototype.showPicker = function () { window.pickerCalls += 1; if (!${pickerWorks}) throw new DOMException('refused', 'NotAllowedError'); };</script>` }));
    await page.goto('https://app.roll20.net/editor/');
    await page.evaluate(() => { window.chrome = { runtime: { id: 'x', sendMessage: async () => {} }, storage: { local: { get: async () => ({ r20AvOff: false }) } } }; });
    await page.evaluate(code);
    return page;
  };
  const press = (page, init) => page.evaluate(init => { const area = document.querySelector('#textchat-input textarea'); const event = new KeyboardEvent('keydown', { code: 'Backquote', key: '`', bubbles: true, cancelable: true, ...init }); area.dispatchEvent(event); return event.defaultPrevented; }, init);
  const where = page => page.evaluate(() => ({ active: document.activeElement?.id || document.activeElement?.tagName, sel: [document.querySelector('#textchat-input textarea').selectionStart, document.querySelector('#textchat-input textarea').selectionEnd], value: document.querySelector('#textchat-input textarea').value, saved: window.saved, picker: window.pickerCalls, list: !!document.getElementById('capybara-r20-speakers') }));

  // the browser's picker: ` opens it (the character is not typed), a choice sends a change event and the focus comes back with the cursor where it was
  let page = await start(true);
  await page.fill('#textchat-input textarea', '안녕하세요'); await page.evaluate(() => { const a = document.querySelector('#textchat-input textarea'); a.focus(); a.setSelectionRange(2, 4); });
  assert.equal(await press(page, {}), true, 'the key is taken');
  let state = await where(page);
  assert.deepEqual([state.active, state.picker, state.value, state.list], ['speakingas', 1, '안녕하세요', false], 'the speaker select has the focus and its picker is open; nothing typed');
  await page.evaluate(() => { const s = document.querySelector('#speakingas'); s.selectedIndex = 2; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  state = await where(page);
  assert.deepEqual([state.active, state.sel, state.saved], ['TEXTAREA', [2, 4], ['character|2']], 'Roll20 got the change; the input has the focus and the cursor again');
  // Esc on the select: back to the input as well
  await press(page, {}); await page.evaluate(() => document.querySelector('#speakingas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await page.waitForTimeout(100);
  assert.equal((await where(page)).active, 'TEXTAREA');
  // keys that are not a plain back-tick, and composition, are left alone
  for (const init of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { code: 'Digit1', key: '1' }]) assert.equal(await press(page, init), false, JSON.stringify(init));
  // a real composition (a word being typed) keeps its keys; the IME's own flag on the first key does not count, and the character it would insert is stopped
  await page.evaluate(() => document.querySelector('#textchat-input textarea').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  assert.equal(await press(page, {}), false, 'composing: left alone');
  await page.evaluate(() => document.querySelector('#textchat-input textarea').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  assert.equal(await press(page, { key: 'Process', keyCode: 229, isComposing: true }), true, 'the IME flag alone does not stop it');
  assert.equal(await page.evaluate(() => { const event = new InputEvent('beforeinput', { data: '`', inputType: 'insertText', bubbles: true, cancelable: true }); document.querySelector('#textchat-input textarea').dispatchEvent(event); return event.defaultPrevented; }), true, 'the letter the IME would type is stopped');
  assert.equal((await where(page)).picker, 3);
  // a Korean IME reports another key but the same code
  assert.equal(await press(page, { key: 'Process', keyCode: 229 }), true, 'the code decides, not the character');
  await page.close();

  // the picker refused: the small list under the input (current speaker marked), arrow keys, Enter
  page = await start(false);
  await page.fill('#textchat-input textarea', 'abc'); await page.evaluate(() => { const a = document.querySelector('#textchat-input textarea'); a.focus(); a.setSelectionRange(1, 1); });
  await press(page, {});
  assert.equal((await where(page)).list, true, 'the list appears');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#capybara-r20-speakers li')].map(li => [li.textContent, li.getAttribute('aria-selected')])), [['카피바라 (GM)', 'true'], ['사문혁', 'false'], ['하문혁', 'false']]);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  state = await where(page);
  assert.deepEqual([state.saved, state.active, state.sel, state.list, state.value], [['character|1'], 'TEXTAREA', [1, 1], false, 'abc'], 'Enter chooses, the list goes, the cursor is back');
  // Esc closes without a change
  await press(page, {}); await page.keyboard.press('Escape');
  state = await where(page);
  assert.deepEqual([state.saved.length, state.list, state.active], [1, false, 'TEXTAREA']);
  // a click on an entry
  await press(page, {}); await page.dispatchEvent('#capybara-r20-speakers li:nth-child(3)', 'mousedown');
  assert.deepEqual((await where(page)).saved, ['character|1', 'character|2']);
  await browser.close();
  console.log('roll20 speaker tick PASS');
})().catch(error => { console.error(error); process.exit(1); });
