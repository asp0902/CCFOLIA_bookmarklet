// roll20-css-bridge 0.3.112: the space under the last chat message. CCFOLIA's list (TanStack Virtual) adds every row height rounded to an integer
// (70.66 -> 71); the native "space under the last line" is that rounding summed (0.34px per row, from the 0.67px divider at 1.5x zoom).
// The same-speaker grouping hid the dividers between grouped rows (display:none) -> integer row heights -> the space vanished (~16px -> ~2px).
// Now those dividers are only transparent: every row keeps the native fractional part, so the space equals the native one (<= 1px), with
// grouping on / off, a narration row last, a hidden message last, a roll card last.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bridge = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const AV = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const row = (i, name, text, extra = '') => `<div data-index="${i}"><div class="MuiListItem-root MuiListItem-gutters" style="display:flex;padding:8px 16px;position:relative"${extra}><div class="MuiListItemAvatar-root" style="min-width:56px"><img src="${AV}" width="40" height="40"></div><div class="MuiListItemText-root" style="margin:6px 0"><h6 class="MuiTypography-root MuiListItemText-primary" style="margin:0;font-size:14px;line-height:20px">${name}<span class="MuiTypography-caption"> - 오늘 20:31</span></h6><p class="MuiListItemText-secondary" style="margin:0;font-size:14px;line-height:20px">${text}</p></div></div><hr class="MuiDivider-root MuiDivider-middle" style="margin:0 16px;border:0;height:0.6667px;background:rgba(255,255,255,.12);flex-shrink:0"></div>`;
const lists = {
  plain: (n) => Array.from({ length: n }, (_, i) => row(i, i % 2 ? '에르네스토' : '덱스터', '말 ' + i)).join(''),
  grouped: (n) => Array.from({ length: n }, (_, i) => row(i, i < n / 2 ? '덱스터' : '에르네스토', '말 ' + i)).join(''),
  narrationLast: (n) => Array.from({ length: n }, (_, i) => row(i, '에르네스토', i === n - 1 ? '나레이션 끝' : '말 ' + i, i === n - 1 ? ' data-ccf-narration="1"' : '')).join(''),
  hiddenLast: (n) => Array.from({ length: n }, (_, i) => row(i, '에르네스토', '말 ' + i, i === n - 1 ? ' data-ccf-hidden-row="1"' : '')).join(''),
  cardLast: (n) => Array.from({ length: n }, (_, i) => row(i, '에르네스토', i === n - 1 ? 'CC<=50 (1D100<=50) > 23 > 성공' : '말 ' + i)).join('')
};
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    // what the virtual list adds: sum of rounded row heights minus the drawn content = the space under the last line
    const tail = async (kind, withBridge) => {
      const context = await browser.newContext({ viewport: { width: 500, height: 800 }, deviceScaleFactor: 1.5 });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => process.env.DBG && console.log('PAGE', m.text()));
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body style="margin:0;background:#282828;color:#fff;font:14px sans-serif"><div id="root"></div><ul class="MuiList-root" role="log" style="margin:0;padding:0;height:600px;overflow:auto;width:420px"><div style="position:relative"><div style="position:absolute;top:0;left:0;width:100%">${lists[kind](40)}</div></div></ul></body>` }));
      await page.goto('https://ccfolia.com/rooms/test');
      if (withBridge) { await page.addScriptTag({ content: bridge }); await page.waitForTimeout(1500); }
      const r = await page.evaluate(() => { const ws = [...document.querySelectorAll('[data-index]')]; const hs = ws.map((w) => w.getBoundingClientRect().height); console.log(hs.slice(0, 3).join(','), getComputedStyle(document.querySelector('hr')).borderBottomWidth, document.querySelector('hr').getBoundingClientRect().height, devicePixelRatio); return { rounded: hs.reduce((a, h) => a + Math.round(h), 0), drawn: hs.reduce((a, h) => a + h, 0), grouped: document.querySelectorAll('[data-ccf-prose-cont="1"]').length }; });
      await context.close();
      assert.deepEqual(errors, [], kind);
      return { tail: Math.round((r.rounded - r.drawn) * 100) / 100, grouped: r.grouped };
    };
    for (const kind of Object.keys(lists)) {
      const native = await tail(kind, false), ext = await tail(kind, true);
      console.log(kind, JSON.stringify({ native, ext }));
      if (kind === 'grouped') assert(ext.grouped > 0, 'grouping is on in this case');
      assert(Math.abs(native.tail - ext.tail) <= 1, `${kind}: the space under the last line equals the native one (<= 1px): ${JSON.stringify({ native, ext })}`);
    }
    console.log('prose last gap PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
