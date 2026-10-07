const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// A Roll20 macro whose box-shadow spreads outside its box (thick colour band) must not be clipped by the message
// containers: they clip horizontally only (overflow-x: clip) and stay visible vertically.
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
      const page = await browser.newPage({ viewport: { width: 360, height: 260 } });
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
    for (const [label, withBridge] of [['format-sync only', false], ['format-sync + bridge', true]]) {
      const page = await open();
      await page.setContent('<style>body{background:#1b1b1b;margin:0}.MuiListItem-root{display:block;padding:30px 24px}.MuiListItemText-secondary{margin:0}</style><div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul style="list-style:none;margin:0;padding:0"><li class="MuiListItem-root"><div class="MuiListItemText-root"><p id="p0" class="MuiListItemText-secondary"></p></div></li></ul></div></div>');
      await page.evaluate(text => { document.getElementById('p0').textContent = text; }, encode(envelope) + envelope.text);
      await page.addScriptTag({ content: formatSync });
      if (withBridge) await page.addScriptTag({ content: bridge });
      await page.waitForFunction(() => document.querySelector('#p0 [class*="frag"]'), null, { timeout: 5000 });
      await page.waitForTimeout(500);
      const clipped = await page.evaluate(() => {
        const out = [];
        for (let el = document.querySelector('#p0 [class*="frag"]').parentElement; el && el !== document.body; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (style.overflowY !== 'visible' || style.overflowX !== 'visible') out.push(`${el.className || el.tagName}: overflow ${style.overflowX}/${style.overflowY}`);
        }
        return out;
      });
      assert.deepEqual(clipped, [], `${label}: nothing clips the shadow (vertically or horizontally)`);
      // The colour band (0 8px 0 15px) must sit inside its own message (so it cannot cover dividers or neighbours) with the text centred.
      const geometry = await page.evaluate(() => {
        const frag = document.querySelector('#p0 [class*="frag"]');
        const rect = frag.getBoundingClientRect(), host = document.querySelector('.MuiListItem-root').getBoundingClientRect(), padding = 30;
        const spread = 15;
        return { bandTop: rect.top - spread - (host.top + padding), bandBottom: rect.bottom + spread - (host.top + padding), hostHeight: host.height - 2 * padding, boxHeight: rect.height, textCentre: (rect.top + rect.bottom) / 2, bandCentre: (rect.top - spread + rect.bottom + spread) / 2 };
      });
      assert.equal(geometry.textCentre, geometry.bandCentre, `${label}: text centred in the band`);
      assert.equal(geometry.bandTop, 0, `${label}: band starts at the message content top (it fills its own space)`);
      assert.equal(geometry.bandBottom, geometry.boxHeight + 30, `${label}: band ends at the message content bottom`);
      assert.equal(geometry.hostHeight, geometry.boxHeight + 30, `${label}: the band is part of the message height (does not overlap neighbours)`);
    }
    console.log('macro box-shadow spread is not clipped vertically (format-sync alone and with bridge) PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
