// format-sync adds its toolbar and dialog reset only to the chat message edit dialog, not to other settings dialogs that also have a textarea[name="text"] memo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
  await page.goto('https://ccfolia.com/rooms/test');
  const editor = '<textarea name="text" rows="2"></textarea><textarea aria-hidden="true" tabindex="-1" style="visibility:hidden;position:absolute"></textarea>';
  const dialog = (id, fields) => `<div id="${id}" role="dialog" class="MuiPaper-root MuiDialog-paper" style="background-color:rgb(1, 2, 3);width:500px"><form><div class="MuiDialogContent-root">${fields}${editor}</div><div class="MuiDialogActions-root"><button class="MuiButton-root" type="submit">저장</button></div></form></div>`;
  // the chat message edit dialog (measured: only the memo textarea) and a marker panel settings dialog (width / height / overlap priority inputs besides the memo)
  await page.setContent('<body style="background:#282828;color:#fff"></body>');
  await page.addScriptTag({ content: source });
  // dialogs open after the page script has started, like in real use
  await page.evaluate(html => document.body.insertAdjacentHTML('beforeend', html), `${dialog('edit', '')}${dialog('marker', '<input name="width" type="number" value="4"><input name="height" type="number" value="4"><input name="z" type="number" value="0">')}`);
  await page.waitForFunction(() => document.getElementById('edit').getAttribute('data-ccf-edit-dialog') === '1', null, { timeout: 5000 });
  const probe = id => page.evaluate(target => { const d = document.getElementById(target); return { toolbar: !!d.querySelector('[data-ccf-dialog-toolbar]'), marked: d.getAttribute('data-ccf-edit-dialog'), background: d.style.backgroundColor, width: d.style.width }; }, id);
  const edit = await probe('edit'), marker = await probe('marker');
  assert.equal(edit.marked, '1', 'the message edit dialog is marked for the toolbar and the reset');
  assert.notEqual(edit.background, 'rgb(1, 2, 3)', 'and its background is overridden');
  assert.deepEqual(marker, { toolbar: false, marked: null, background: 'rgb(1, 2, 3)', width: '500px' }, 'the marker dialog is untouched (toolbar, attribute and inline styles)');
  // a dialog that stops looking like the edit dialog goes back to native: attribute and toolbar gone, own inline styles restored
  await page.evaluate(() => { document.querySelector('#edit .MuiDialogContent-root').insertAdjacentHTML('afterbegin', '<input name="width" type="number">'); });
  await page.waitForFunction(() => !document.getElementById('edit').hasAttribute('data-ccf-edit-dialog'), null, { timeout: 5000 });
  const back = await probe('edit');
  assert.deepEqual(back, { toolbar: false, marked: null, background: 'rgb(1, 2, 3)', width: '500px' }, 'restored to its own inline styles');
  await browser.close();
  console.log('format-sync dialog scope PASS');
})().catch(error => { console.error(error); process.exit(1); });
