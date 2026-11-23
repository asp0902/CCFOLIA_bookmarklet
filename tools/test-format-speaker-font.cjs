// format-sync 0.1.145: fonts per speaker. Sending puts the narration / character font on the parts without a chosen font (commands excluded);
// messages without a font get it only when drawn, under the '받은 메시지에도 자동 적용' switch; an empty table changes nothing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const MAP = ['​', '‌', '‍', '⁠'], START = '⁣⁣⁣', END = '⁢⁢⁢';
const enc = (v) => { let bits = ''; for (const ch of Buffer.from(JSON.stringify(v), 'utf8').toString('base64')) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = START; for (let i = 0; i < bits.length; i += 2) out += MAP[parseInt(bits.slice(i, i + 2), 2)]; return out + END; };
const dec = (text) => { const a = text.indexOf(START), b = text.indexOf(END, a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } let s = ''; for (let i = 0; i + 8 <= bits.length; i += 8) s += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(s, 'base64').toString('utf8')); };
const row = (id, who, text) => `<li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary">${who}<span> - 오늘 12:00</span></h6><p id="${id}" class="MuiTypography-root MuiTypography-body2 MuiListItemText-secondary">${text}</p></div></li>`;
const envNarr = enc({ v: 1, text: '봉투 나레이션', formatRuns: [], alignRuns: [], blockStyle: { narration: true } });
const html = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div id="root"></div><div role="log"><ul id="list">${row('narr', '서술자', '평문 나레이션')}${row('char', '앨리스', '앨리스 대사')}${row('other', '밥', '밥 대사')}${row('dice', '앨리스', '1D100 ＞ 50')}${row('env', '밥', envNarr + '봉투 나레이션')}</ul></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><input name="name" value="서술자"><textarea name="text" rows="3"></textarea><button type="submit">전송</button></form></body>`;
const FONT = 'nanum-myeongjo', OTHER = 'nanum-gothic';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const errors = [];
  const boot = async (store) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate((store) => {
      localStorage.clear(); localStorage.setItem('ccf-format-style-presets-shared-migrated-1117', '1');
      for (const [k, v] of Object.entries(store)) localStorage.setItem(k, JSON.stringify(v));
      window.__sent = []; document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.querySelector('#composer textarea').value); });
      window.__CCF_ENSURE_GOOGLE_FONTS__ = () => {};
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    }, store);
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    await page.waitForTimeout(2200); // the bridge re-read
    return page;
  };
  const send = async (page, text, name = '서술자') => dec((await page.evaluate(([t, name]) => { window.__sent.length = 0; const set = (n, v, p) => { Object.getOwnPropertyDescriptor(p, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('#composer input[name=name]'), name, HTMLInputElement.prototype); const ta = document.querySelector('#composer textarea'); set(ta, t, HTMLTextAreaElement.prototype); document.querySelector('#composer button[type=submit]').click(); return new Promise((r) => setTimeout(() => { const sent = window.__sent.slice(); set(ta, '', HTMLTextAreaElement.prototype); r(sent); }, 120)); }, [text, name]))[0] || ''); // CCFOLIA empties the box after a send
  const fontOf = (page, id) => page.evaluate((id) => { const o = document.querySelector(`#${id} .ccf-render-overlay`); if (!o) return null; return [...o.querySelectorAll('*')].filter((n) => n.children.length === 0).map((n) => n.style.fontFamily).join('|'); }, id);
  const fontRuns = (env) => (env?.formatRuns || []).filter((r) => r.style?.fontId).map((r) => [r.start, r.end, r.style.fontId]);
  const NARR = { 'ccf-format-narrators-v1:test': ['서술자'] };
  try {
    // sending
    let page = await boot({ ...NARR, 'ccf-format-speaker-fonts-v1': [{ name: '', fontId: FONT }] });
    assert.deepEqual(fontRuns(await send(page, '나레이션 글')), [[0, 6, FONT]], 'narration font in the envelope');
    assert.equal(await send(page, '1D100'), null, 'a command stays plain');
    await page.close();
    // a chosen font wins; only the rest gets the speaker font
    page = await boot({ ...NARR, 'ccf-format-speaker-fonts-v1': [{ name: '', fontId: FONT }] });
    await page.evaluate(() => { const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '직접 글꼴'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); ta.setSelectionRange(0, 2); document.dispatchEvent(new Event('selectionchange')); });
    await page.locator('.ccf-inline-toolbar').first().dispatchEvent('pointerdown');
    await page.locator('.ccf-inline-toolbar [data-inline-font-btn]').first().click();
    await page.locator(`.ccf-inline-toolbar [data-inline-font-pick="${OTHER}"]`).first().click();
    const chosen = dec((await page.evaluate(() => { window.__sent.length = 0; document.querySelector('#composer button[type=submit]').click(); return new Promise((r) => setTimeout(() => r(window.__sent.slice()), 120)); }))[0]);
    assert.deepEqual(fontRuns(chosen), [[0, 2, OTHER], [2, 5, FONT]], 'the chosen font first, the speaker font on the rest');
    await page.close();
    // narration off: no narration font; character rows only for that character
    page = await boot({ 'ccf-format-speaker-fonts-v1': [{ name: '', fontId: FONT }, { name: '앨리스', fontId: OTHER }] });
    assert.equal(await send(page, '평범한 글'), null, 'narration off: nothing');
    assert.deepEqual(fontRuns(await send(page, '앨리스 글', '앨리스')), [[0, 5, OTHER]], 'the character row');
    assert.equal(await send(page, '밥 글', '밥'), null, 'another character: nothing');
    await page.close();
    // received: drawn only, narrator / character rows, dice excluded, the switch clears it
    page = await boot({ ...NARR, 'ccf-format-speaker-fonts-v1': [{ name: '', fontId: FONT }], 'ccf-format-speaker-fonts-v1:test': [{ name: '앨리스', fontId: OTHER }] });
    await page.waitForFunction(() => document.querySelector('#narr .ccf-render-overlay') && document.querySelector('#char .ccf-render-overlay'), null, { timeout: 5000 });
    assert.match(await fontOf(page, 'narr'), /Nanum Myeongjo/, 'plain narrator message');
    assert.match(await fontOf(page, 'env'), /Nanum Myeongjo/, 'narration envelope without a font');
    assert.match(await fontOf(page, 'char'), /Nanum Gothic/, 'room-only character row');
    assert.equal(await page.locator('#other .ccf-render-overlay').count(), 0, 'other speaker untouched');
    assert.equal(await page.locator('#dice .ccf-render-overlay').count(), 0, 'dice untouched');
    assert.equal(await page.locator('#narr .ccf-original-hidden').textContent(), '평문 나레이션', 'the stored text is untouched');
    const mutations = await page.evaluate(async () => { let n = 0; const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(document.getElementById('list'), { subtree: true, childList: true, attributes: true, characterData: true }); await new Promise((r) => setTimeout(r, 1200)); mo.disconnect(); return n; });
    assert.equal(mutations, 0, 'no re-render loop');
    // the Sv window: narration row on top, a change is saved and redrawn; the received switch clears it
    await page.evaluate(() => document.querySelector('[data-inline-command="style-clipboard"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForSelector('[data-speaker-fonts]', { state: 'attached' });
    assert.equal(await page.locator('[data-speaker-font-row]').first().getAttribute('data-narration'), '1', 'narration row first');
    assert.equal(await page.locator('[data-speaker-font-row]').count(), 2);
    await page.locator('[data-speaker-font-row][data-narration] select').evaluate((s, v) => { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, OTHER);
    await page.waitForFunction(() => [...document.querySelectorAll('#narr .ccf-render-overlay *')].some((n) => /Nanum Gothic/.test(n.style.fontFamily)), null, { timeout: 3000 });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-speaker-fonts-v1'))), [{ name: '', fontId: OTHER }], 'shared row saved');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-speaker-fonts-v1:test'))), [{ name: '앨리스', fontId: OTHER }], 'room row stays in the room');
    await page.locator('[data-style-received]').evaluate((c) => c.click());
    await page.waitForFunction(() => !document.querySelector('#narr .ccf-render-overlay') && !document.querySelector('#char .ccf-render-overlay'), null, { timeout: 3000 });
    assert.equal(await fontOf(page, 'env') === null || !/Nanum/.test(await fontOf(page, 'env')), true, 'switch off: the envelope has no viewer font');
    await page.close();
    // an empty table: nothing drawn, no changes while idle
    page = await boot(NARR);
    assert.equal(await page.locator('#narr .ccf-render-overlay, #char .ccf-render-overlay').count(), 0, 'empty table');
    const idle = await page.evaluate(async () => { let n = 0; const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(document.getElementById('list'), { subtree: true, childList: true, attributes: true, characterData: true }); await new Promise((r) => setTimeout(r, 1000)); mo.disconnect(); return n; });
    assert.equal(idle, 0, 'idle DOM changes');
    await page.close();
    assert.deepEqual(errors, []);
    console.log('format speaker font PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
