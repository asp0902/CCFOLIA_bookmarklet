const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The bridge groups consecutive messages of one speaker (data-ccf-prose-cont on the continued rows): plain runs, a narration line (envelope only, no render mark) splitting a run, the extra panel left alone.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const prose = source.slice(source.indexOf('// ===== Prose Mode'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.setContent(`<style>#chat{height:400px;width:320px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px 16px}h6{margin:0;height:20px}p{margin:0}</style>
      <div id="chat"><ul class="MuiList-root" id="list"></ul></div><div class="ccf-scp-panel" id="panel"><div id="plist"></div></div>`);
    await page.addScriptTag({ content: prose });
    const result = await page.evaluate(async () => {
      const START = '\u2063\u2063\u2063';
      const enc = (obj) => { const b = btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); let bits = ''; for (const ch of b) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); const map = ['\u200B', '\u200C', '\u200D', '\u2060']; let out = START; for (let i = 0; i < bits.length; i += 2) out += map[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '\u2062\u2062\u2062'; };
      const list = document.querySelector('#list');
      const add = (author, text, narration) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">${author}</h6><p class="MuiListItemText-secondary"></p>`; li.querySelector('p').textContent = narration ? text + enc({ v: 1, text, formatRuns: [], alignRuns: [], blockStyle: { narration: true } }) : text; list.append(li); return li; };
      const rows = [add('A', '하나'), add('A', '둘'), add('A', '바라바라', true), add('A', '다시 말'), add('B', '다른 사람')];
      // a row inside the extra panel must not be grouped
      const pli = document.createElement('li'); pli.className = 'MuiListItem-root'; pli.innerHTML = '<h6 class="MuiListItemText-primary">A</h6><p class="MuiListItemText-secondary">패널</p>'; document.querySelector('#plist').append(pli);
      await new Promise((r) => setTimeout(r, 600));
      return { cont: rows.map((li) => li.getAttribute('data-ccf-prose-cont') === '1'), panel: pli.hasAttribute('data-ccf-prose-cont') };
    });
    assert.deepEqual(errors, [], 'no errors: ' + errors.join('; '));
    assert.deepEqual(result.cont, [false, true, false, false, false], 'row 2 continues row 1; the narration line and the plain line after it start new runs: ' + JSON.stringify(result));
    assert.equal(result.panel, false);
    console.log('bridge group runs PASS', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
