// format-sync 0.1.160: the narration look stays on the narration row. findNarrationMessageItem climbed from a narration row without an avatar up to the list,
// which holds other rows' avatars, and marked the whole list as narration: in the extra panel every message (also other speakers' plain ones) lost its name and
// avatar and was centred (seen on the real test room page: UL.ccf-scp-list[data-ccf-narration="1"]). The walk now stops at the message row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (obj) => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
const ICON = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><input name="name" value="나"><textarea name="text" rows="3"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    const narration = '자 여기에서' + encode({ v: 1, text: '자 여기에서', formatRuns: [], alignRuns: [], blockStyle: { narration: true } });
    await page.evaluate(([icon, narration]) => {
      const row = (name, text, withAvatar) => `<div class="MuiListItem-root MuiListItem-gutters">${withAvatar ? `<div class="MuiListItemAvatar-root"><div class="MuiAvatar-root"><img src="${icon}"></div></div>` : ''}<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}<span class="MuiTypography-caption"> - 오늘</span></h6><p class="MuiListItemText-secondary"></p></div></div>`;
      document.body.insertAdjacentHTML('afterbegin', `<div class="ccf-scp-panel" style="width:550px"><ul class="ccf-scp-list">${row('레아 몬트', '', true)}${row('나레이터', '', false)}${row('레아 몬트', '', true)}</ul></div>`);
      const ps = document.querySelectorAll('.ccf-scp-list p');
      ps[0].textContent = '넹'; ps[1].textContent = narration; ps[2].textContent = '55입니당';
    }, [ICON, narration]);
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => document.querySelector('.ccf-scp-list .ccf-render-root[data-ccf-narration="1"]'), null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.ccf-scp-list > .MuiListItem-root')];
      return {
        list: document.querySelector('.ccf-scp-list').getAttribute('data-ccf-narration'),
        rows: rows.map((r) => ({ narration: r.getAttribute('data-ccf-narration'), headShown: getComputedStyle(r.querySelector('h6')).display !== 'none' && r.querySelector('h6').getBoundingClientRect().height > 0, align: getComputedStyle(r.querySelector('p')).textAlign }))
      };
    });
    assert.equal(state.list, null, 'the list itself is never a narration row');
    assert.equal(state.rows[1].narration, '1', 'the narration row is');
    for (const i of [0, 2]) { assert.equal(state.rows[i].narration, null, `plain row ${i}`); assert.equal(state.rows[i].headShown, true, `plain row ${i} keeps its name`); assert.notEqual(state.rows[i].align, 'center', `plain row ${i} not centred`); }
    assert.deepEqual(errors, []);
    console.log('panel narration scope PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
