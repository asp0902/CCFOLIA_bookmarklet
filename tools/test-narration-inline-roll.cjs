const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// #123: in narration the text is italic, but a Roll20 [[dice]] result box must stay upright.
const read = name => fs.readFileSync(path.join(__dirname, '..', 'legacy', name), 'utf8');
const bridge = read('ccfolia-roll20-css-bridge.user.js'), formatSync = read('ccfolia-format-sync.user.js');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = value => {
  let bits = '';
  for (const char of Buffer.from(JSON.stringify(value), 'utf8').toString('base64')) bits += char.charCodeAt(0).toString(2).padStart(8, '0');
  let out = '⁣⁣⁣';
  for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)];
  return out + '⁢⁢⁢';
};

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const open = async () => {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      return page;
    };
    const first = await open();
    await first.addScriptTag({ content: bridge.replace('installDebugApi({ renderMacroHtml })', 'installDebugApi({ renderMacroHtml, preparePayloadForSend, extractEnvelope })') });
    const envelope = await first.evaluate(() => {
      const editor = document.createElement('textarea'); document.body.append(editor); editor.value = '그날 [[1d6]] 만큼 잃었다.';
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__; api.preparePayloadForSend(editor);
      return api.extractEnvelope(editor.value).envelope;
    });
    envelope.blockStyle = { narration: true };
    const page = await open();
    await page.setContent('<div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul><li class="MuiListItem-root"><div class="MuiListItemText-root"><p id="p0" class="MuiListItemText-secondary"></p></div></li></ul></div></div>');
    await page.evaluate(text => { document.getElementById('p0').textContent = text; }, encode(envelope) + envelope.text);
    await page.addScriptTag({ content: formatSync });
    await page.addScriptTag({ content: bridge });
    await page.waitForFunction(() => document.querySelector('#p0 .ccr20-inline-roll'), null, { timeout: 5000 });
    const styles = await page.evaluate(() => ({
      roll: getComputedStyle(document.querySelector('#p0 .ccr20-inline-roll')).fontStyle,
      text: getComputedStyle(document.querySelector('#p0 .ccr20-frag')).fontStyle
    }));
    assert.equal(styles.roll, 'normal', 'dice result is not italic');
    assert.equal(styles.text, 'italic', 'surrounding narration text stays italic');
    console.log('narration [[dice]] result upright, narration text italic PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
