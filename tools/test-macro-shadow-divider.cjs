const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// A macro's box-shadow spread may extend past its message, but it must be painted *under* the message divider and the
// following messages (native message items are `position: relative`, which lifts them above the following divider).
const read = name => fs.readFileSync(path.join(__dirname, '..', 'legacy', name), 'utf8');
const bridge = read('ccfolia-roll20-css-bridge.user.js'), formatSync = read('ccfolia-format-sync.user.js');
const MACRO = `[내용](#" style="color: #ffffff; background-color:#9BCFC4; font-weight:bold; text-align:center; display:block; padding:2px; box-shadow: 0px 8px 0px 15px #9BCFC4;)`;
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
      const page = await browser.newPage({ viewport: { width: 360, height: 300 } });
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      return page;
    };
    const first = await open();
    await first.addScriptTag({ content: bridge.replace('installDebugApi({ renderMacroHtml })', 'installDebugApi({ renderMacroHtml, preparePayloadForSend, extractEnvelope })') });
    const envelope = await first.evaluate(text => {
      const editor = document.createElement('textarea'); document.body.append(editor); editor.value = text;
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__; api.preparePayloadForSend(editor);
      return api.extractEnvelope(editor.value).envelope;
    }, MACRO);
    const page = await open();
    await page.setContent('<style>body{background:#303030;color:#fff;font:14px sans-serif;margin:0}.MuiListItem-root{display:block;padding:8px 24px;position:relative}.MuiListItemText-secondary{margin:6px 0}hr{border:0;border-top:3px solid #ff0000;margin:0}</style><div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul style="list-style:none;margin:0;padding:0"><li class="MuiListItem-root"><div class="MuiListItemText-root"><p id="p0" class="MuiListItemText-secondary"></p></div></li><hr class="MuiDivider-root" id="divider"><li class="MuiListItem-root"><div class="MuiListItemText-root"><p class="MuiListItemText-secondary">다음 메시지</p></div></li></ul></div></div>');
    await page.evaluate(text => { document.getElementById('p0').textContent = text; }, encode(envelope) + envelope.text);
    await page.addScriptTag({ content: formatSync });
    await page.addScriptTag({ content: bridge });
    await page.waitForFunction(() => document.querySelector('#p0 .ccr20-line'), null, { timeout: 5000 });
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => Math.round(document.getElementById('divider').getBoundingClientRect().top + 1));
    const shot = (await page.screenshot()).toString('base64');
    const pixel = await (await open()).evaluate(async ({ b64, y }) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(180, y, 1, 1).data].slice(0, 3);
    }, { b64: shot, y });
    assert.deepEqual(pixel, [255, 0, 0], 'the divider stays visible over the macro shadow');
    console.log('macro box-shadow is painted under the message divider PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
