const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// While the format renderer rebuilds a narration row (the text paragraph emptied, then the render root created) the bridge keeps the last known judgement: the group flags of the neighbours never change.
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
      const rows = [add('A', '하나'), add('A', '둘'), add('A', '바라바라', true), add('A', '다시 말'), add('A', '또 말'), add('B', '다른 사람')];
      await new Promise((r) => setTimeout(r, 500));
      const flags = () => rows.map((li) => ['data-ccf-prose-cont', 'data-ccf-prose-cont-leader', 'data-ccf-prose-cont-last'].map((a) => li.hasAttribute(a) ? 1 : 0).join('')).join('|');
      const before = flags();
      const changes = [];
      const mo = new MutationObserver((list2) => { for (const m of list2) if (m.type === 'attributes' && /^data-ccf-prose-cont/.test(m.attributeName) && !/wrap/.test(m.attributeName)) changes.push(m.attributeName); });
      for (const li of rows) mo.observe(li, { attributes: true });
      // the renderer's middle state of the narration row: paragraph emptied (original text kept aside), then the render root created
      const nr = rows[2], p = nr.querySelector('p');
      const original = p.innerHTML;
      p.innerHTML = '';
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
      const emptied = flags();
      p.innerHTML = '<span class="ccf-original-hidden">' + original + '</span>';
      p.classList.add('ccf-render-root'); p.setAttribute('data-ccf-narration', '1');
      await new Promise((r) => setTimeout(r, 300));
      const after = flags();
      mo.disconnect();
      return { before, emptied, after, changes };
    });
    assert.deepEqual(errors, [], 'no errors: ' + errors.join('; '));
    assert.equal(result.emptied, result.before, 'the emptied paragraph did not change the groups: ' + JSON.stringify(result));
    assert.equal(result.after, result.before, 'the rendered row keeps the same groups: ' + JSON.stringify(result));
    assert.deepEqual(result.changes, [], 'no group flag changed at all during the render: ' + JSON.stringify(result));
    console.log('bridge render middle state PASS', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
