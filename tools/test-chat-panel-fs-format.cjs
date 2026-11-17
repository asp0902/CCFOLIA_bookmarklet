// chat-panel 0.5.47 + format-sync 0.1.120: the added panel's input uses the original format machinery (format-sync's inline toolbar, runs, in-box preview, send envelope):
// B on a selection shows bold in the box without markup and sends a bold run; "# 제목" becomes a heading like the original; a command still goes out raw (and through the original box);
// the panel's own format row is hidden once attached.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const panel = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const sync = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const decode = (text) => { const a = text.indexOf('⁣⁣⁣'), b = text.indexOf('⁢⁢⁢', a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } let b64 = ''; for (let i = 0; i + 8 <= bits.length; i += 8) b64 += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const writes = [];
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="background:#222;color:#fff"><div id="root"></div><textarea name="text" style="font-family:Roboto, Helvetica, Arial, sans-serif;font-size:16px;line-height:23px;letter-spacing:0.15px;font-weight:400"></textarea></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && /:runQuery/.test(req.url())) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (req.method() !== 'GET') writes.push(req.postData());
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'projects/p/databases/(default)/documents/rooms/test/messages/new1' }) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'firebase:authUser:A:[DEFAULT]', value: { uid: 'u', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); });
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000) - 5, nanoseconds: 0 } } };
      const state = { app: { state: { roomId: 'test' } }, entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} }, roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: sync });
    await page.addScriptTag({ content: panel });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForFunction(() => document.querySelector('#ccf-second-chat-panel.is-fs'), null, { timeout: 5000 });
    const P = '#ccf-second-chat-panel';
    const ui = await page.evaluate((P) => ({ toolbar: !!document.querySelector(P + ' .ccf-inline-toolbar [data-inline-command="bold"]'), ownRow: getComputedStyle(document.querySelector(P + ' .ccf-scp-fmt')).display }), P);
    assert.deepEqual(ui, { toolbar: true, ownRow: 'none' }, 'the original toolbar in the panel, its own row hidden');
    const input = page.locator(P + ' .ccf-scp-input');
    // chat-panel 0.5.48: the input's font = the original input's computed font (family, size, line height, letter spacing, weight), and the in-box preview follows it
    await page.waitForTimeout(300);
    const fontOf = (sel) => page.evaluate((sel) => { const c = getComputedStyle(document.querySelector(sel)); return [c.fontFamily, c.fontSize, c.lineHeight, c.letterSpacing, c.fontWeight]; }, sel);
    assert.deepEqual(await fontOf(P + ' .ccf-scp-input'), await fontOf('body > textarea[name="text"]'), 'same font as the original input');
    const sent = () => writes.map((w) => { try { return JSON.parse(w).fields?.text?.stringValue; } catch (_) { return null; } }).filter(Boolean);
    const send = async () => { const n = sent().length; await page.locator(P + ' .ccf-scp-send').dispatchEvent('click'); await page.waitForFunction((n) => true, n); await page.waitForTimeout(700); return sent().slice(n); };
    // B on a selection: no markup in the box, a bold run in the message
    await input.click(); await page.keyboard.type('가 굵게 나');
    await input.evaluate((el) => el.setSelectionRange(2, 4));
    await page.locator(P + ' .ccf-inline-toolbar [data-inline-command="bold"]').click();
    assert.equal(await input.inputValue(), '가 굵게 나', 'no markup in the box');
    const preview = await page.evaluate(() => [...document.querySelectorAll('.ccf-editor-preview-layer')].some((l) => [...l.querySelectorAll('*')].some((e) => /700|bold/.test(e.style.fontWeight || '') && e.textContent.includes('굵게'))));
    assert.equal(preview, true, 'the box shows it bold (preview layer)');
    let out = await send();
    assert.equal(out.length, 1, JSON.stringify(writes).slice(0, 200));
    let env = decode(out[0]);
    assert.equal(env.text, '가 굵게 나'); assert.deepEqual(env.formatRuns.map((r) => [r.start, r.end, !!r.style.bold]), [[2, 4, true]]);
    assert.equal(await input.inputValue(), '', 'cleared');
    // "# 제목": a heading as in the original
    await input.click(); await page.keyboard.type('# 제목');
    out = await send(); env = decode(out[0]);
    assert(env && env.text === '제목' && env.formatRuns.some((r) => r.style.fontSize || r.style.heading), 'heading: ' + JSON.stringify(env));
    // a pasted picture with a format: the picture becomes the same image run the original sends (alt text + imageUrl), the bold run moves with it
    await page.evaluate(() => { window.__CCF_FORMAT_SYNC_IMAGE_PASTE__ = { handle: (event, insert) => { event.preventDefault(); insert('ccf-firestore-image://abc', '스크린샷'); return true; }, preview: async () => '' }; });
    await input.click(); await page.keyboard.type('앞 ');
    await input.evaluate((el) => el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
    await page.keyboard.type(' 뒤');
    await input.evaluate((el) => { const v = el.value; el.setSelectionRange(v.length - 1, v.length); });
    await page.locator(P + ' .ccf-inline-toolbar [data-inline-command="bold"]').click();
    out = await send(); env = decode(out[0]);
    assert.equal(env.text, '앞 스크린샷 뒤', JSON.stringify(env));
    assert.deepEqual(env.formatRuns.map((r) => [r.start, r.end, r.style.imageUrl || (r.style.bold ? 'bold' : '')]).sort(), [[2, 6, 'ccf-firestore-image://abc'], [7, 8, 'bold']].sort());
    assert(out[0].startsWith('앞 스크린샷 뒤'), 'the visible text has the alt, no marker');
    // plain text: as before
    await input.click(); await page.keyboard.type('그냥 글');
    out = await send(); assert.equal(out[0], '그냥 글');
    assert.deepEqual(errors, []);
    console.log('chat panel uses the original format machinery PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
