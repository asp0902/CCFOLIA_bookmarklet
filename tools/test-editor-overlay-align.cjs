// format-sync 0.1.133: the formatted preview layer over an input is drawn glyph for glyph where the input's own text is
// (same computed font / letter-spacing / line-height / padding / wrapping, and the input's zoom from the theme "screen font scale").
// The input's own text is invisible while the layer shows (also in the message edit dialog, whose reset styles force the text colour inline),
// and a whole-message alignment is applied to the input too, so the caret sits where the layer's glyphs are.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_START = '⁣⁣⁣', INVIS_END = '⁢⁢⁢', INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (value) => { const b64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64'); let bits = ''; for (const c of b64) bits += c.charCodeAt(0).toString(2).padStart(8, '0'); let out = INVIS_START; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + INVIS_END; };
const TEXT = '“설마 그 가방 안에 증거인멸을 위해 쳐죽일 무기 같은 게 들어있는 건 아니겠죠?” 끝';
// glyph positions: the layer's text vs a hidden copy of the input placed in the same parent with the same class and computed style (what the input draws)
const compare = () => {
  const ta = document.querySelector('textarea[name="text"]:not([data-probe])');
  const ov = [...document.querySelectorAll('.ccf-editor-preview-layer')].find((o) => getComputedStyle(o).display !== 'none');
  if (!ov) return { error: 'no layer' };
  const cs = getComputedStyle(ta);
  const m = document.createElement('div');
  m.className = ta.className.replace('ccf-editor-preview-source', '');
  for (const p of cs) { if (p === 'zoom' || p === 'color' || p === '-webkit-text-fill-color') continue; try { m.style.setProperty(p, cs.getPropertyValue(p)); } catch (_) {} }
  Object.assign(m.style, { position: 'absolute', left: ta.offsetLeft + 'px', top: ta.offsetTop + 'px', width: cs.width, height: cs.height, visibility: 'hidden', overflow: 'hidden', whiteSpace: 'pre-wrap' });
  m.textContent = ta.value.replace(/[⁣⁢​‌‍⁠]/g, '');
  ta.parentElement.appendChild(m);
  const pos = (root) => { const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.parentElement.closest('.ccf-preview-empty')) continue; for (let k = 0; k < n.data.length; k++) { if (/[⁣⁢​‌‍⁠]/.test(n.data[k])) continue; const rg = document.createRange(); rg.setStart(n, k); rg.setEnd(n, k + 1); const b = rg.getBoundingClientRect(); if (b.width || b.height) out.push([n.data[k], b.left, b.top]); } } return out; };
  const a = pos(m), b = pos(ov);
  m.remove();
  const n = Math.min(a.length, b.length) - 1; // the last glyph may be bold (wider)
  let dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { dx = Math.max(dx, Math.abs(a[i][1] - b[i][1])); dy = Math.max(dy, Math.abs(a[i][2] - b[i][2])); }
  const tcs = getComputedStyle(ta);
  return { count: [a.length, b.length], dx: +dx.toFixed(2), dy: +dy.toFixed(2), fill: tcs.webkitTextFillColor, align: tcs.textAlign };
};
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    // 1) the room's input (CCFOLIA metrics: Roboto 16px / 23px, letter-spacing 0.15008px), with the theme's spacing 2px and scale 1.1 (zoom) too
    for (const theme of process.env.ONLY_DIALOG ? [] : ['', '.MuiInputBase-input { letter-spacing: 2px !important; }', '.MuiInputBase-input { zoom: 1.1; letter-spacing: 2px !important; }']) {
      const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><style>${theme}</style><body style="background:#2b2b2b;color:#fff;margin:0"><div id="root"></div><ul id="chatlist" style="width:500px"></ul><form id="composer" style="position:fixed;left:20px;bottom:20px;width:380px"><input name="name" value="서술자"><div class="MuiInputBase-root" style="position:relative"><textarea name="text" class="MuiInputBase-input" rows="4" style="width:100%;box-sizing:border-box;border:0;padding:0;background:transparent;color:#fff;font:16px/23px Roboto, Helvetica, Arial, sans-serif;letter-spacing:0.15008px;resize:none"></textarea></div><button type="submit">전송</button></form></body>` }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => { const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } }; document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } }; });
      await page.addScriptTag({ content: source });
      await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
      await page.evaluate((text) => { const ta = document.querySelector('textarea[name="text"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); ta.setSelectionRange(text.length - 1, text.length); document.dispatchEvent(new Event('selectionchange')); }, TEXT);
      await page.waitForTimeout(200);
      await page.locator('.ccf-inline-toolbar [data-inline-command="bold"]').first().click();
      await page.waitForTimeout(500);
      const r = await page.evaluate(compare);
      console.log('input', theme || 'plain', JSON.stringify(r));
      assert(r.dx <= 1 && r.dy <= 1, `glyphs of the layer sit on the input's (${theme || 'plain'}): ${JSON.stringify(r)}`);
      assert.equal(r.fill, 'rgba(0, 0, 0, 0)', 'the input text is invisible under the layer');
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2) the message edit dialog: centred message with a bold part
    {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const value = '핸드아웃: 가방 공개' + encode({ v: 1, text: '핸드아웃: 가방 공개', formatRuns: [{ start: 0, end: 8, style: { bold: true } }], alignRuns: [{ start: 0, end: 1, align: 'center' }], blockStyle: {} });
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;margin:0"><div id="root"></div></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => { const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } }; document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } }; });
      await page.addScriptTag({ content: source });
      await page.evaluate((value) => {
        const d = document.createElement('div');
        d.className = 'MuiDialog-root MuiModal-root'; d.setAttribute('role', 'presentation');
        d.innerHTML = `<div class="MuiDialog-container" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center"><div class="MuiPaper-root MuiDialog-paper" role="dialog" style="width:444px;background:#424242"><form><div class="MuiDialogContent-root" style="padding:8px 24px"><div class="MuiFormControl-root" style="width:100%"><label class="MuiInputLabel-root">메시지 편집</label><div class="MuiInputBase-root MuiFilledInput-root" style="position:relative;padding:25px 12px 8px"><textarea name="text" class="MuiInputBase-input MuiFilledInput-input" rows="3" style="width:100%;box-sizing:border-box;border:0;padding:0;background:transparent;color:#fff;font:16px/23px Roboto, Helvetica, Arial, sans-serif;letter-spacing:0.15008px;resize:none"></textarea></div></div></div><div class="MuiDialogActions-root"><button type="submit">저장</button></div></form></div></div>`;
        document.body.appendChild(d);
        const ta = d.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, value); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
      }, value);
      await page.waitForSelector('[data-ccf-edit-dialog="1"] .ccf-inline-toolbar', { timeout: 6000 });
      await page.waitForTimeout(800);
      const r = await page.evaluate(compare);
      console.log('edit dialog', JSON.stringify(r));
      if (process.env.CAPTURE) { const box = await page.locator('.MuiDialog-paper').boundingBox(); await page.screenshot({ path: process.env.CAPTURE, clip: box }); }
      assert.equal(r.fill, 'rgba(0, 0, 0, 0)', 'the input text is invisible under the layer (edit dialog): ' + JSON.stringify(r));
      assert.equal(r.align, 'center', 'the whole-message alignment is on the input too');
      assert(r.dx <= 1 && r.dy <= 1, 'glyphs of the layer sit on the input (edit dialog): ' + JSON.stringify(r));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('editor overlay align PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
