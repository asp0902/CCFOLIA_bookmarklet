// format-sync 0.1.115 + character-sheet 0.5.40: a dice command sent by a sheet button (the chat box is marked data-ccf-sheet-command while the sheet clicks send) keeps the
// narration / kept format as "command + space + envelope{command:true}" - BCDice reads what follows the space as a comment (measured in ChW_QP77I: "1D6 <invisible>" rolled
// "(1D6) ＞ 5"). The same command typed by hand still goes out raw, and a "/" command from the sheet too. The renderer draws the command plus CCFOLIA's roll result after the envelope.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const sheet = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const decode = (text) => { const a = text.indexOf('⁣⁣⁣'), b = text.indexOf('⁢⁢⁢', a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } let b64 = ''; for (let i = 0; i + 8 <= bits.length; i += 8) b64 += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); };
(async () => {
  assert.match(sheet, /editor\.setAttribute\("data-ccf-sheet-command", "1"\);\s*try \{ submitButton\?\.click\(\); \} finally \{ editor\.removeAttribute\("data-ccf-sheet-command"\); \}/, 'the sheet marks the box while it clicks send');
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
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const send = (text, fromSheet) => page.evaluate(([t, fromSheet]) => { window.__sent.length = 0; const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); if (fromSheet) ta.setAttribute('data-ccf-sheet-command', '1'); try { document.querySelector('#composer button[type=submit]').click(); } finally { ta.removeAttribute('data-ccf-sheet-command'); } return new Promise((r) => setTimeout(() => r(window.__sent.slice()), 120)); }, [text, fromSheet]);
    // from the sheet: narration kept after a space
    let sent = await send('2D6>=5 [회피]', true);
    assert.equal(sent.length, 1);
    assert(sent[0].startsWith('2D6>=5 [회피] ⁣'), 'command, a space, then the envelope: ' + JSON.stringify(sent[0].slice(0, 16)));
    const env = decode(sent[0]);
    assert.deepEqual([env.text, env.command, env.blockStyle.narration], ['2D6>=5 [회피]', true, true]);
    // typed by hand: raw as before; a "/" command from the sheet: raw too
    assert.deepEqual(await send('2D6>=5 [회피]', false), ['2D6>=5 [회피]'], 'typed by hand: raw');
    assert.deepEqual(await send('/roll-table\n괴담 장면표\n1D3\n1 a\n2 b\n3 c', true), ['/roll-table\n괴담 장면표\n1D3\n1 a\n2 b\n3 c'], 'a / command stays raw');
    // the message CCFOLIA shows: the text (with the envelope) followed by the roll result -> drawn as command + result
    await page.evaluate((text) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">서술자</h6><p class="MuiListItemText-secondary"></p></div>'; li.querySelector('p').append(document.createTextNode(text), document.createTextNode(' (2D6>=5) ＞ 8 ＞ 성공')); document.getElementById('chatlist').appendChild(li); }, sent[0]);
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => { const p = document.querySelector('#chatlist p'); const o = p.querySelector('.ccf-render-overlay'); return { overlay: o ? o.textContent.replace(/\s+/g, ' ').trim() : null, visible: p.innerText.replace(/\s+/g, ' ').trim() }; });
    assert.equal(shown.overlay, '2D6>=5 [회피] (2D6>=5) ＞ 8 ＞ 성공', 'command and result drawn: ' + JSON.stringify(shown));
    assert.deepEqual(errors, []);
    console.log('sheet command format PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
