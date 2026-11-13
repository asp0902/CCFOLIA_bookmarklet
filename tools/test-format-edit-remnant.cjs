// format-sync 0.1.112: editing a formatted message must not leave the old formatted text on screen.
// CCFOLIA's edit updates the text node of the message (characterData) or, when the text becomes empty, only removes it (no added node, no text change) -
// that last case was not seen and the overlay with the old text stayed. Also: edited to plain text, edited to another formatted text, the " [編集済]" tail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(process.env.FS_SOURCE || path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_START = '⁣⁣⁣', INVIS_END = '⁢⁢⁢', INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (value) => { const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64'); let bits = ''; for (const c of base64) bits += c.charCodeAt(0).toString(2).padStart(8, '0'); let out = INVIS_START; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + INVIS_END; };
const message = (text, formatRuns = []) => text + encode({ text, formatRuns, alignRuns: [], blockStyle: {} });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const run = async (label, edit, expected) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.setContent(`<style>body{background:#282828;color:#fff;font:16px sans-serif}.MuiListItem-root{padding:8px 16px;display:flex}</style>
        <div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul id="list" style="list-style:none;margin:0;padding:0">
        <li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">눈깅이</h6><p id="p0" class="MuiListItemText-secondary"></p></div></li>
        <li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">눈깅이</h6><p id="p1" class="MuiListItemText-secondary">다음 메시지</p></div></li></ul></div></div>`);
      await page.evaluate((text) => { document.getElementById('p0').textContent = text; }, message('굵은 옛 글', [{ start: 0, end: 2, style: { bold: true } }]));
      await page.addScriptTag({ content: source });
      await page.waitForFunction(() => document.getElementById('p0').classList.contains('ccf-render-root') && document.getElementById('p0').innerText.trim() === '굵은 옛 글', null, { timeout: 5000 });
      // React owns the text node; after the first render it lives in the hidden wrapper
      await page.evaluate(edit.fn, edit.arg);
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => { const p = document.getElementById('p0'); return { shown: p.innerText.replace(/\s+/g, ' ').trim(), overlays: p.querySelectorAll('.ccf-render-overlay').length, bold: !!p.querySelector('.ccf-render-overlay b, .ccf-render-overlay strong, .ccf-render-overlay [style*="font-weight"]') }; });
      assert.equal(state.shown, expected.shown, `${label}: shown text (${JSON.stringify(state)})`);
      assert.equal(state.overlays, expected.overlays, `${label}: overlays`);
      assert.deepEqual(errors, [], label);
      await page.close();
    };
    const node = 'const p = document.getElementById("p0"); const n = p.querySelector(":scope > .ccf-original-hidden")?.firstChild || p.firstChild;';
    // edited to empty: React removes the text node only (and CCFOLIA adds the edited tail)
    await run('emptied', { fn: new Function(`${node} n.parentNode.removeChild(n);`), arg: null }, { shown: '', overlays: 0 });
    await run('emptied + tail', { fn: new Function(`${node} n.parentNode.removeChild(n); const s = document.createElement("span"); s.className = "MuiTypography-caption"; s.textContent = " [編集済]"; p.appendChild(s);`), arg: null }, { shown: '[編集済]', overlays: 0 });
    // edited to plain text (no envelope)
    await run('plain', { fn: new Function('t', `${node} n.nodeValue = t;`), arg: '그냥 고친 글' }, { shown: '그냥 고친 글', overlays: 0 });
    // edited to another formatted text
    await run('reformatted', { fn: new Function('t', `${node} n.nodeValue = t;`), arg: message('새 서식 글', [{ start: 0, end: 1, style: { italic: true } }]) }, { shown: '새 서식 글', overlays: 1 });
    console.log('format edit remnant PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
