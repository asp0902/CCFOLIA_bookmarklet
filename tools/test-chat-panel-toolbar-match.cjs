// chat-panel 0.5.53 + format-sync 0.1.129: the added panel's format bar looks like the original one: it sits outside the input well (full panel width, no inset box),
// the first button / row height / size field / background / top border are the original's, and the input text starts where the original's does (read from the original).
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
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="background:#222;color:#fff;margin:0"><div id="root"></div><div id="paper" class="MuiDrawer-paper" style="position:fixed;right:0;top:0;bottom:0;width:420px;background:#282828;display:flex;flex-direction:column"><div role="log" style="flex:1;min-height:200px">log</div><form id="composer"><div style="height:39px"><input name="name" value="서술자"><button type="submit">전송</button></div><div class="MuiInputBase-root" style="padding:6px 13px;background:rgba(0,0,0,.2)"><textarea name="text" style="width:100%;border:0;padding:0;background:transparent;color:#fff;font-family:Roboto, Helvetica, Arial, sans-serif;font-size:16px;line-height:23px"></textarea></div></form></div></body>' }));
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
    await page.waitForTimeout(1500);
    if (process.env.CAPTURE) { await page.evaluate(() => { document.querySelector('#ccf-second-chat-panel').style.left = '330px'; }); await page.waitForTimeout(300); await page.screenshot({ path: process.env.CAPTURE, clip: { x: 330, y: 560, width: 1270, height: 340 } }); }
    const look = await page.evaluate(() => {
      const P = document.querySelector('#ccf-second-chat-panel'), paper = document.getElementById('paper');
      const nTb = [...document.querySelectorAll('.ccf-inline-toolbar')].find((t) => !t.closest('.ccf-scp-panel')), pTb = P.querySelector('.ccf-inline-toolbar');
      const one = (tb, box) => { const b = box.getBoundingClientRect(), cs = getComputedStyle(tb), B = tb.querySelector('[data-inline-command="bold"]').getBoundingClientRect(), A = tb.querySelector('[data-inline-command="align"]').getBoundingClientRect();
        return { bx: Math.round(B.left - b.left), rowH: Math.round(A.top - B.top), bH: Math.round(B.height), sizeW: Math.round(tb.querySelector('[data-inline-size]').getBoundingClientRect().width), bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, sideL: Math.round(tb.getBoundingClientRect().left - b.left), sideR: Math.round(b.right - tb.getBoundingClientRect().right) }; };
      const nIn = document.querySelector('textarea[name="text"]'), pIn = P.querySelector('.ccf-scp-input');
      const pr = P.getBoundingClientRect(), panelInner = pr.left + (parseFloat(getComputedStyle(P).borderLeftWidth) || 0);
      return { native: one(nTb, paper), panel: one(pTb, P), wrapParent: pTb.parentElement.className, nText: Math.round(nIn.getBoundingClientRect().left - paper.getBoundingClientRect().left), pText: Math.round(pIn.getBoundingClientRect().left - panelInner) };
    });
    assert.equal(look.wrapParent, 'ccf-scp-compose', 'the bar is outside the input well');
    const { native: n, panel: p } = look;
    assert(Math.abs(n.bx - p.bx) <= 2, 'first button x: ' + JSON.stringify(look));
    assert.deepEqual([p.rowH, p.bH, p.sizeW, p.bg, p.border], [n.rowH, n.bH, n.sizeW, n.bg, n.border], 'row height / button / size field / background / top border: ' + JSON.stringify(look));
    assert(p.sideL <= 2 && p.sideR <= 2, 'no inset box: ' + JSON.stringify(look));
    assert(Math.abs(look.nText - look.pText) <= 2, 'input text starts where the original does: ' + JSON.stringify(look));
    assert.deepEqual(errors, []);
    console.log('chat panel toolbar matches the original PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
