// format-sync 0.1.142: the viewer's auto presets are drawn on messages without them (others' and own plain messages), never stored;
// the sender's formatting wins; dice / commands stay plain; a preset with its dot off and the '받은 메시지에도 자동 적용' switch turn it off.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const MAP = ['​', '‌', '‍', '⁠'];
const enc = (v) => { let bits = ''; for (const ch of Buffer.from(JSON.stringify(v), 'utf8').toString('base64')) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += MAP[parseInt(bits.slice(i, i + 2), 2)]; return out + '⁢⁢⁢'; };
const row = (id, text) => `<li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary">화자</h6><p id="${id}" class="MuiTypography-root MuiTypography-body2 MuiListItemText-secondary">${text}</p></div></li>`;
const sent = enc({ v: 1, text: '드와이프 와 드와이프', formatRuns: [{ start: 0, end: 4, style: { color: '#00ff00' } }], alignRuns: [], blockStyle: {} });
const html = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div id="root"></div><div role="log"><ul id="list">${row('plain', '어제 드와이프가 왔다')}${row('none', '관계없는 글')}${row('off', '꺼진이름 등장')}${row('dice', '2D6>=5 [드와이프] (2D6>=5) ＞ 8[3,5] ＞ 8 ＞ 성공')}${row('env', sent + '드와이프 와 드와이프')}</ul></div><form id="composer"><textarea name="text"></textarea><button type="submit">전송</button></form></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-format-style-presets-shared-migrated-1117', '1');
      localStorage.setItem('ccf-format-style-presets-v1', JSON.stringify([{ name: '드와이프', style: { color: '#ff0000' } }, { name: '꺼진이름', style: { color: '#0000ff' }, auto: false }]));
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => document.querySelector('#plain .ccf-render-overlay'), null, { timeout: 8000 });
    await page.waitForTimeout(700);
    const colored = (id, rgb) => page.evaluate(([id, rgb]) => { const o = document.querySelector(`#${id} .ccf-render-overlay`); if (!o) return null; return [...o.querySelectorAll('*')].filter((n) => n.children.length === 0 && getComputedStyle(n).color === rgb).map((n) => n.textContent); }, [id, rgb]);
    assert.deepEqual(await colored('plain', 'rgb(255, 0, 0)'), ['드와이프'], 'plain message: the preset');
    assert.equal(await page.locator('#plain .ccf-original-hidden').textContent(), '어제 드와이프가 왔다', 'the stored text is untouched');
    for (const id of ['none', 'off', 'dice']) assert.equal(await page.locator(`#${id} .ccf-render-overlay`).count(), 0, id + ' stays plain');
    assert.deepEqual(await colored('env', 'rgb(0, 255, 0)'), ['드와이프'], 'sender format kept');
    assert.deepEqual(await colored('env', 'rgb(255, 0, 0)'), ['드와이프'], 'only the unformatted occurrence gets the preset');
    // no render loop
    const mutations = await page.evaluate(async () => { let n = 0; const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(document.getElementById('list'), { subtree: true, childList: true, attributes: true, characterData: true }); await new Promise((r) => setTimeout(r, 1200)); mo.disconnect(); return n; });
    assert.equal(mutations, 0, 'stable: no re-render loop');
    // a recycled row: new text, the overlay follows; text without a preset name releases it
    await page.evaluate(() => { document.querySelector('#plain .ccf-original-hidden').firstChild.nodeValue = '오늘 드와이프 등장'; });
    await page.waitForFunction(() => document.querySelector('#plain .ccf-render-overlay')?.textContent === '오늘 드와이프 등장', null, { timeout: 3000 });
    await page.evaluate(() => { document.querySelector('#plain .ccf-original-hidden').firstChild.nodeValue = '평범한 글'; });
    await page.waitForFunction(() => !document.querySelector('#plain .ccf-render-overlay') && document.querySelector('#plain').textContent === '평범한 글', null, { timeout: 3000 });
    await page.evaluate(() => { document.querySelector('#plain').firstChild.nodeValue = '다시 드와이프'; });
    await page.waitForFunction(() => document.querySelector('#plain .ccf-render-overlay')?.textContent === '다시 드와이프', null, { timeout: 3000 });
    // the switch in the Sv window
    await page.evaluate(() => document.querySelector('[data-inline-command="style-clipboard"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForSelector('[data-style-received]', { state: 'attached' });
    assert.equal(await page.locator('[data-style-received]').isChecked(), true, 'on by default');
    await page.locator('[data-style-received]').evaluate((c) => c.click());
    await page.waitForFunction(() => !document.querySelector('#plain .ccf-render-overlay'), null, { timeout: 3000 });
    await page.waitForTimeout(200);
    assert.deepEqual(await colored('env', 'rgb(255, 0, 0)'), [], 'switch off: the sender format only');
    assert.deepEqual(await colored('env', 'rgb(0, 255, 0)'), ['드와이프']);
    await page.locator('[data-style-received]').evaluate((c) => c.click());
    await page.waitForFunction(() => document.querySelector('#plain .ccf-render-overlay'), null, { timeout: 3000 });
    assert.deepEqual(errors, []);
    console.log('format received presets PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
