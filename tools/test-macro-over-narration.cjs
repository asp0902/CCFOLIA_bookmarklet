const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// A Roll20 CSS macro sent while the narrator is speaking keeps its own look: bold, font-family, borders, shadow,
// normal font-style and left alignment — whether format-sync alone or format-sync + the bridge renders it.
const read = name => fs.readFileSync(path.join(__dirname, '..', 'legacy', name), 'utf8');
const bridge = read('ccfolia-roll20-css-bridge.user.js'), formatSync = read('ccfolia-format-sync.user.js');
const MACRO = `[Title](#" style="font-family: 'Nanum Myeongjo'; color: #252525; font-weight: bold; padding: 8px 12px 4px; background: #fff; border: 2px solid #252525; border-bottom: none; box-shadow: 2px 2px 0px #252525; display: block;)[Body](#" style="color: #252525; font-weight: normal; padding: 4px 12px 8px; background: #fff; display: block;)`;
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
    const envelope = await first.evaluate(text => {
      const editor = document.createElement('textarea'); document.body.append(editor); editor.value = text;
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__; api.preparePayloadForSend(editor);
      return api.extractEnvelope(editor.value).envelope;
    }, MACRO);
    assert.equal(envelope.roll20Macro, true);
    envelope.blockStyle = { narration: true };            // the narrator is speaking
    assert.deepEqual(envelope.alignRuns, [], 'macro keeps no forced center alignment');
    const sent = encode(envelope) + envelope.text;

    for (const [label, withBridge] of [['format-sync only', false], ['format-sync + bridge', true]]) {
      const page = await open();
      await page.setContent('<div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul><li class="MuiListItem-root"><div class="MuiListItemText-root"><p id="p0" class="MuiListItemText-secondary"></p></div></li></ul></div></div>');
      await page.evaluate(text => { document.getElementById('p0').textContent = text; }, sent);
      await page.addScriptTag({ content: formatSync });
      if (withBridge) await page.addScriptTag({ content: bridge });
      await page.waitForFunction(() => document.getElementById('p0').classList.contains('ccf-render-root'), null, { timeout: 5000 });
      await page.waitForTimeout(500);
      const [title, body] = await page.evaluate(() => [...document.querySelectorAll('#p0 span')].filter(s => /frag/.test(s.className)).map(s => {
        const c = getComputedStyle(s);
        return { fontWeight: c.fontWeight, fontStyle: c.fontStyle, fontFamily: c.fontFamily, border: c.borderTopWidth, shadow: c.boxShadow !== 'none', align: c.textAlign };
      }));
      assert.equal(title.fontWeight, '700', `${label}: bold`);
      assert.equal(title.fontFamily, '"Nanum Myeongjo"', `${label}: font-family`);
      assert.equal(title.border, '2px', `${label}: border`);
      assert(title.shadow, `${label}: box-shadow`);
      assert.equal(title.fontStyle, 'normal', `${label}: not italic`);
      assert.equal(title.align, 'left', `${label}: left aligned`);
      assert.equal(body.fontWeight, '400', `${label}: body normal weight`);
    }
    console.log('macro over narration: bold, font, border, shadow, normal style, left align (format-sync alone and with bridge) PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
