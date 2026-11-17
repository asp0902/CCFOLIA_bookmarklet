// format-sync 0.1.124: message font - the format bar's 글꼴 select puts a font id (style.fontId, from the allow list) on the selection; the envelope carries the id,
// a receiver draws it with that Google font (and loads it); an unknown id is dropped (default font).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const decode = (text) => { const a = text.indexOf('⁣⁣⁣'), b = text.indexOf('⁢⁢⁢', a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } let b64 = ''; for (let i = 0; i + 8 <= bits.length; i += 8) b64 += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="chatlist" style="width:500px"></ul><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><input name="name" value="서술자"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__sent = [];
      document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.querySelector('#composer textarea').value); });
       // the speaker is a narrator: narration is on
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const send = (text, fromSheet) => page.evaluate(([t, fromSheet]) => { window.__sent.length = 0; const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); if (fromSheet) ta.setAttribute('data-ccf-sheet-command', '1'); try { document.querySelector('#composer button[type=submit]').click(); } finally { ta.removeAttribute('data-ccf-sheet-command'); } return new Promise((r) => setTimeout(() => r(window.__sent.slice()), 120)); }, [text, fromSheet]);
    await page.evaluate(() => { window.__fontsAsked = []; window.__CCF_ENSURE_GOOGLE_FONTS__ = (f) => window.__fontsAsked.push(f); });
    const options = await page.locator('.ccf-inline-toolbar [data-inline-font] option').allTextContents();
    assert(options.includes('Nanum Myeongjo') && options[0] === '글꼴', 'the font select: ' + options.slice(0, 4));
    // type, select a word, pick a font
    await page.evaluate(() => { const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '명조 글자'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); ta.setSelectionRange(0, 2); document.dispatchEvent(new Event('selectionchange')); });
    await page.locator('.ccf-inline-toolbar').first().dispatchEvent('pointerdown');
    await page.locator('.ccf-inline-toolbar [data-inline-font]').first().selectOption('nanum-myeongjo');
    await page.waitForTimeout(200);
    const sent = await send('명조 글자', false);
    const env = decode(sent[0]);
    assert(env && env.formatRuns.some((r) => r.start === 0 && r.end === 2 && r.style.fontId === 'nanum-myeongjo'), 'the envelope carries the font id: ' + JSON.stringify(env && env.formatRuns));
    // a receiver draws it (and asks for the font); an unknown id is dropped
    const enc = (v) => { const b64 = Buffer.from(JSON.stringify(v), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
    const msg = (text, runs) => text + enc({ v: 1, text, formatRuns: runs, alignRuns: [], blockStyle: {} });
    await page.evaluate(([a, b]) => { for (const [id, t] of [['f1', a], ['f2', b]]) { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">누군가</h6><p class="MuiListItemText-secondary" id="' + id + '"></p></div>'; li.querySelector('p').append(document.createTextNode(t)); document.getElementById('chatlist').appendChild(li); } },
      [msg('명조 글자', [{ start: 0, end: 2, style: { fontId: 'nanum-myeongjo' } }]), msg('이상한 글자', [{ start: 0, end: 2, style: { fontId: 'http://evil/x.woff' } }])]);
    await page.waitForTimeout(700);
    const fam = (id) => page.evaluate((id) => [...document.querySelectorAll(`#${id} .ccf-render-overlay *`)].map((e) => e.style.fontFamily).filter(Boolean), id);
    assert.deepEqual(await fam('f1'), ['"Nanum Myeongjo", sans-serif']);
    assert.deepEqual(await fam('f2'), [], 'unknown id: default font');
    assert((await page.evaluate(() => window.__fontsAsked)).includes('Nanum Myeongjo'), 'the font is loaded');
    assert.deepEqual(errors, []);
    console.log('message font PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
