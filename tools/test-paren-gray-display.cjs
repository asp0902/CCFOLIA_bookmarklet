// format-sync 0.1.168 회색괄호: on by default (new key), saved when turned off. While on, every message on screen (earlier ones, other people's) shows its
// parenthesised parts grey at display time (stored text unchanged); a dice/command row is left alone; a colour the sender gave inside the parentheses wins.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (obj) => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="list" role="log" style="width:500px"></ul><form id="composer" style="position:fixed;left:520px;bottom:20px;width:400px"><input name="name" value="나"><div style="display:flex"><button type="submit" style="margin-left:auto">전송</button></div><textarea name="text" rows="3" style="width:100%"></textarea></form></body>' }));
    const colored = '빨강 (내 색)' + encode({ v: 1, text: '빨강 (내 색)', formatRuns: [{ start: 3, end: 8, style: { color: '#ff0000' } }], alignRuns: [], blockStyle: {} });
    const setup = async () => {
      await page.evaluate((colored) => {
        const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
        document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
        const row = (id, name, text, roll) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}<span class="MuiTypography-caption"> - 오늘</span></h6><p id="${id}" class="MuiTypography-root MuiTypography-body2 MuiListItemText-secondary"></p></div>`; const p = li.querySelector('p'); p.textContent = text; if (roll) { const s = document.createElement('span'); s.className = 'MuiTypography-root MuiTypography-body2'; s.textContent = roll; p.append(s); } document.getElementById('list').append(li); };
        row('plain', '남', '안녕 (작게 말함) 끝');
        row('roll', '남', 'CC<=45 민첩성', ' (1D100<=45) ＞ 37');
        row('cmd', '남', '1D100 (판정)');
        row('mine', '나', colored);
      }, colored);
      await page.addScriptTag({ content: source });
      await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
      await page.waitForTimeout(1200);
    };
    const grey = (id) => page.evaluate((id) => [...document.querySelectorAll(`#${id} .ccf-render-overlay *`)].filter((e) => e.style.color === 'rgb(135, 135, 135)').map((e) => e.textContent).join('|'), id);
    const red = (id) => page.evaluate((id) => [...document.querySelectorAll(`#${id} .ccf-render-overlay *`)].filter((e) => e.style.color === 'rgb(255, 0, 0)').map((e) => e.textContent).join('|'), id);
    await page.goto('https://ccfolia.com/rooms/test');
    await setup();
    const btn = page.locator('[data-inline-command="paren-gray"]').first();
    assert.equal(await btn.getAttribute('aria-pressed'), 'true', 'on by default');
    assert.equal(await btn.getAttribute('title'), '회색괄호'); assert.equal(await btn.getAttribute('aria-label'), '회색괄호');
    assert.equal(await grey('plain'), '(작게 말함)', 'an earlier plain message: the parentheses grey');
    assert.equal(await page.evaluate(() => document.querySelector('#roll .ccf-render-overlay')), null, 'a dice result row is left alone');
    assert.equal(await grey('cmd'), '', 'a command row is left alone');
    assert.equal(await red('mine'), '(내 색)', 'the sender colour wins'); assert.equal(await grey('mine'), '');
    // off: back to normal, saved
    await btn.click(); await page.waitForTimeout(800);
    assert.equal(await btn.getAttribute('aria-pressed'), 'false');
    assert.equal(await grey('plain'), '', 'off: no grey');
    assert.equal(await page.evaluate(() => localStorage.getItem('ccf-format-paren-gray-v2')), '0');
    await page.reload(); await setup();
    assert.equal(await page.locator('[data-inline-command="paren-gray"]').first().getAttribute('aria-pressed'), 'false', 'off kept after reload');
    assert.equal(await grey('plain'), '');
    assert.deepEqual(errors, []);
    console.log('paren gray display PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
