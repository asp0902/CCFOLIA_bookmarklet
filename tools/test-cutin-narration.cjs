// format-sync 0.1.119: a message ending with a cut-in name (CCFOLIA plays the cut-in only when the text ENDS with its name) keeps the narration / format:
// text + envelope + cut-in name (it was sent raw, so the narration was lost). The renderer shows the text before the envelope: narration look, the @name hidden.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const sheet = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const decode = (text) => { const a = text.indexOf('⁣⁣⁣'), b = text.indexOf('⁢⁢⁢', a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } let b64 = ''; for (let i = 0; i + 8 <= bits.length; i += 8) b64 += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); };
(async () => {
  assert.match(sheet, /editor\.setAttribute\("data-ccf-sheet-command", "1"\);[\s\S]{0,300}try \{ submitButton\?\.click\(\); \} finally \{ editor\.removeAttribute\("data-ccf-sheet-command"\);/, 'the sheet marks the box while it clicks send');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="chatlist" style="width:500px"></ul><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><input name="name" value="서술자"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__sent = [];
      document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.querySelector('#composer textarea').value); });
      localStorage.setItem('ccf-format-narrators-v1:test', JSON.stringify(['서술자'])); // the speaker is a narrator: narration is on
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: ['e1'], entities: { e1: { name: '@컷인' }, e2: { name: '@그림컷인', imageUrl: 'data:image/gif;base64,R0lGODlhAgABAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAEAAAIChFEAOw==' } }, ids: ['e1', 'e2'] } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const send = (text, fromSheet) => page.evaluate(([t, fromSheet]) => { window.__sent.length = 0; const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); if (fromSheet) ta.setAttribute('data-ccf-sheet-command', '1'); try { document.querySelector('#composer button[type=submit]').click(); } finally { ta.removeAttribute('data-ccf-sheet-command'); } return new Promise((r) => setTimeout(() => r(window.__sent.slice()), 120)); }, [text, fromSheet]);
    let sent = await send('글 @컷인', false);
    assert.equal(sent.length, 1);
    assert(sent[0].startsWith('글 ⁣') && sent[0].endsWith('@컷인'), 'text, envelope, then the cut-in name at the end: ' + JSON.stringify(sent[0].slice(0, 6) + '…' + sent[0].slice(-4)));
    const env = decode(sent[0]);
    assert.deepEqual([env.text, env.blockStyle.narration], ['글 ', true]);
    // CCFOLIA's rule: the text ends with the name
    assert.equal(sent[0].lastIndexOf('@컷인') + '@컷인'.length, sent[0].length);
    // 0.1.135: a cut-in name alone with narration on: envelope + the name (the envelope's text is the name), still ending with the name
    const only = await send('@컷인', false);
    assert(only[0].startsWith('⁣') && only[0].endsWith('@컷인') && only[0] !== '@컷인', 'envelope then the name: ' + JSON.stringify(only[0].slice(-4)));
    assert.deepEqual([decode(only[0]).text, decode(only[0]).blockStyle.narration], ['@컷인', true]);
    const onlyPic = await send('@그림컷인', false);
    const bodyPic = await send('본문 @그림컷인', false);
    // a dice command is still raw
    assert.deepEqual(await send('2D6>=5', false), ['2D6>=5']);
    // the message as shown: narration look, the @name not shown
    await page.evaluate((text) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">서술자</h6><p class="MuiListItemText-secondary"></p></div>'; li.querySelector('p').append(document.createTextNode(text)); document.getElementById('chatlist').appendChild(li); }, sent[0]);
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => { const p = document.querySelector('#chatlist p'); const o = p.querySelector('.ccf-render-overlay'); return { narration: p.getAttribute('data-ccf-narration'), overlay: o ? o.textContent.trim() : null, visible: p.innerText.trim() }; });
    assert.equal(shown.narration, '1', 'narration look: ' + JSON.stringify(shown));
    assert.equal(shown.overlay, '글'); assert(!/@컷인/.test(shown.visible), 'the @name is hidden: ' + JSON.stringify(shown));
    // rows of a cut-in name alone: narration look; no picture -> "@컷인" shows; a picture -> the picture only (text hidden), inside the narration row
    const addRow = (id, text) => page.evaluate(([id, text]) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">서술자<span class="MuiTypography-caption"> - 오늘</span></h6><p id="${id}" class="MuiListItemText-secondary"></p></div>`; li.querySelector('p').append(document.createTextNode(text)); document.getElementById('chatlist').appendChild(li); }, [id, text]);
    await addRow('only', only[0]); await addRow('onlypic', onlyPic[0]); await addRow('bodypic', bodyPic[0]);
    await page.waitForFunction(() => document.getElementById('onlypic').getAttribute('data-ccf-cutin-hide') === '1', null, { timeout: 4000 });
    const rows = await page.evaluate(() => ['only', 'onlypic'].map((id) => { const p = document.getElementById(id); return { narration: p.getAttribute('data-ccf-narration'), visible: p.innerText.trim(), hide: p.getAttribute('data-ccf-cutin-hide'), img: !!p.querySelector('.ccf-cutin-chat-image img') }; }));
    assert.deepEqual(rows[0], { narration: '1', visible: '@컷인', hide: null, img: false }, 'no picture: the name shows in a narration row ' + JSON.stringify(rows));
    assert.equal(rows[1].narration, '1'); assert.equal(rows[1].hide, '1'); assert.equal(rows[1].img, true);
    // text + envelope + name in a drawn narration row: the picture is added, the text stays, the @name stays hidden
    await page.waitForSelector('#bodypic .ccf-cutin-chat-image img', { state: 'attached', timeout: 3000 });
    const body = await page.evaluate(() => { const p = document.getElementById('bodypic'); return { hide: p.getAttribute('data-ccf-cutin-hide'), visible: p.innerText.trim() }; });
    assert.deepEqual(body, { hide: null, visible: '본문' });
    // narration off and nothing else: raw as before
    await page.evaluate(() => localStorage.setItem('ccf-format-narrators-v1:test', '[]'));
    assert.deepEqual(await send('@컷인', false), ['@컷인']);
    assert.deepEqual(errors, []);
    console.log('cutin narration PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
