const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// A message sent with the divider toggle inside a run of one speaker: the line is drawn in the row (top border) and the text below it keeps the same distance as the text under the divider of any
// other message (the padding-top of a plain row), while the bridge's rule for the continued rows sets padding-top: 0. The real CSS of both scripts on a page with real-like rows.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sync = read('legacy/ccfolia-format-sync.user.js'), bridge = read('legacy/ccfolia-roll20-css-bridge.user.js');
const grab = (text, start, end) => { const a = text.indexOf(start); assert(a >= 0, start); return text.slice(a, text.indexOf(end, a)); };
// the break rules of format-sync (all rules that mention data-ccf-break) and the bridge's continued-row rules
const syncCss = [...sync.matchAll(/\n\s{6}\.MuiListItem-root[^\n{]*data-ccf-break[^{]*\{[^}]*\}/g)].map((m) => m[0]).join('\n');
assert.ok(syncCss.includes('data-ccf-break'), 'the break rule exists');
const contRules = [...bridge.matchAll(/`(\.MuiListItem-root\[\$\{CONT_ATTR\}="1"\][^`]*)`/g)].map((m) => m[1].replace(/\$\{CONT_ATTR\}/g, 'data-ccf-prose-cont').replace(/\$\{LAST\}/g, 'data-ccf-prose-cont-last').replace(/\$\{LEADER\}/g, 'data-ccf-prose-cont-leader').replace(/\$\{WRAP\}/g, 'data-ccf-prose-cont-wrap')).filter((r) => !r.includes('${'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    // order as in the page: the bridge's rules come with its style, the break rule with format-sync's style; both orders are checked
    for (const order of ['bridge-first', 'sync-first']) {
      const css = `.MuiListItem-root{display:block;padding:8px 16px;margin:0}h6{margin:0}p{margin:0;line-height:20px}`;
      const a = contRules.join('\n'), b = syncCss.replace(/^\s*\/\*.*\*\/\s*$/gm, '');
      await page.setContent(`<style>${css}</style><style>${order === 'bridge-first' ? a + b : b + a}</style>
        <ul style="list-style:none;margin:0;padding:0"><li class="MuiListItem-root" id="r1"><h6 class="MuiListItemText-primary">A</h6><p>첫 줄</p></li>
        <li class="MuiListItem-root" data-ccf-prose-cont="1" id="r2"><div class="ccf-render-root" data-ccf-break="1"><p id="t2">구분선 아래 글자</p></div></li>
        <li class="MuiListItem-root" id="plain"><div><p id="tp">일반 메시지 글자</p></div></li></ul>`);
      const m = await page.evaluate(() => { const px = (v) => parseFloat(v); const r2 = getComputedStyle(document.getElementById('r2')), p = getComputedStyle(document.getElementById('plain')); return { borderTop: px(r2.borderTopWidth), padTop: px(r2.paddingTop), marginTop: px(r2.marginTop), plainPadTop: px(p.paddingTop) }; });
      assert.equal(m.borderTop, 1, order + ': the row keeps the 1px top edge');
      const line = await page.evaluate(() => { const r = document.getElementById('r2'), rr = r.getBoundingClientRect(), cs = getComputedStyle(r, '::before'); return { w: parseFloat(cs.width), rowW: rr.width, left: parseFloat(cs.left), h: parseFloat(cs.height), bg: cs.backgroundColor }; });
      assert.ok(Math.abs(line.w - (line.rowW - 32)) <= 1 && line.left === 16 && line.h === 1 && /255, 255, 255/.test(line.bg), order + ': the line is inset 16px on both sides like the divider between messages: ' + JSON.stringify(line));
      assert.equal(m.padTop, 16, order + ': the text under the line keeps 16px from it (the bridge cont rule would give 0): ' + JSON.stringify(m));
      assert.ok(m.marginTop >= 8, order + ': space above the line: ' + JSON.stringify(m));
    }
    console.log('break divider spacing PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
