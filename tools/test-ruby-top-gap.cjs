const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 루비 줄은 루비 글자 높이만큼만 더 높아지고(줄 padding 이 겹쳐 쌓이지 않는다), 메시지 첫 줄의 루비가 행 위로 잘리지 않는다.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const INVIS_START = '⁣⁣⁣', INVIS_END = '⁢⁢⁢', INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (value) => {
  const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  let bits = '';
  for (const char of base64) bits += char.charCodeAt(0).toString(2).padStart(8, '0');
  let out = INVIS_START;
  for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)];
  return out + INVIS_END;
};
const message = (text, formatRuns = []) => text + encode({ text, formatRuns, alignRuns: [], blockStyle: {} });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    const ruby = (text, rubyText) => message(text, [{ start: 0, end: text.length, style: { rubyText } }]);
    const rubyOn2nd = message('첫 줄\n둘째 줄 글자', [{ start: 4, end: 8, style: { rubyText: '루비' } }]);
    const items = [
      ['plain', '평범한 한 줄'],
      ['ruby', ruby('평범한 한 줄', 'ruby')],
      ['plain2', '첫 줄\n둘째 줄 글자'],
      ['ruby2', rubyOn2nd],
    ];
    await page.setContent(`<style>html,body{margin:0}body{background:#282828;color:#fff;font:16px/1.5 sans-serif}
      #list{margin:0;padding:0;list-style:none;width:360px}.MuiListItem-root{padding:8px 16px;display:block;border-top:1px solid #333}.MuiListItemText-secondary{margin:0;overflow:hidden;white-space:pre-wrap}</style>
      <ul id="list">${items.map(([id, text], i) => `<li class="MuiListItem-root" id="row-${id}"><div class="MuiListItemText-root"><p class="MuiListItemText-secondary" id="p-${id}">${text}</p></div></li>`).join('')}</ul>`);
    await page.addScriptTag({ content: source });
    await page.addScriptTag({ content: bridge });
    await page.waitForFunction(() => document.querySelectorAll('.ccf-ruby-frag').length >= 2, null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const h = (id) => document.getElementById(id).getBoundingClientRect().height;
      const frag = document.querySelector('#p-ruby .ccf-ruby-frag');
      const before = getComputedStyle(frag, '::before');
      const rubyPx = parseFloat(before.fontSize);
      const row = document.getElementById('row-ruby').getBoundingClientRect(), fr = frag.getBoundingClientRect();
      const pOverflow = getComputedStyle(document.getElementById('p-ruby')).overflow;
      return { plain: h('row-plain'), ruby: h('row-ruby'), plain2: h('row-plain2'), ruby2: h('row-ruby2'), rubyPx, fragTopInRow: fr.top - row.top, pOverflow, lineHeight: parseFloat(getComputedStyle(frag).lineHeight) };
    });
    console.log('ruby top gap', JSON.stringify(m));
    const extra1 = m.ruby - m.plain, extra2 = m.ruby2 - m.plain2;
    assert(extra1 <= m.rubyPx + 3, `a first-line ruby adds at most the ruby text height (${m.rubyPx}px): +${extra1}px`);
    assert(extra2 <= m.rubyPx + 3, `a ruby on a later line adds at most the ruby text height: +${extra2}px`);
    assert(extra1 >= m.rubyPx - 4, `…but still leaves room for the ruby text: +${extra1}px`);
    assert(m.fragTopInRow >= 0, 'the first-line ruby is not above its row (not cut off)');
    console.log('ruby top gap PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
