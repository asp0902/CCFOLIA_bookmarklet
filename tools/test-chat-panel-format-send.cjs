const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The format tools reach Firestore as an envelope in the sent text, in panel 1 and in an added panel (the real script, fake store and Firestore).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
        const log = []; page.on('console', (m) => { if (/ccf-scp-timing/.test(m.text())) log.push(m.text()); });
    const calls = []; let failWrite = false;
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const req = route.request(); const kind = req.method() === 'POST' && /:runQuery/.test(req.url()) ? 'query' : 'write';
      calls.push({ kind, at: Date.now(), body: req.postData() });
      
      if (kind === 'query') return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ document: { name: 'projects/p/databases/(default)/documents/rooms/test/messages/t1', fields: { channel: { stringValue: 'main' }, text: { stringValue: '직전 메시지' }, name: { stringValue: '눈깅이' }, color: { stringValue: '#cce5df' }, from: { stringValue: 'u1' }, type: { stringValue: 'text' }, createdAt: { timestampValue: new Date().toISOString() }, updatedAt: { timestampValue: new Date().toISOString() } } } }]) });
      if (failWrite) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'projects/p/databases/(default)/documents/rooms/test/messages/new1' }) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async () => {
      
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = reject; }; req.onerror = reject; });
      const entities = { n0: { name: '눈깅이', text: '메인', channel: 'main', createdAt: { seconds: Math.floor(Date.now() / 1000) - 5, nanoseconds: 0 } } };
      const state = { entities: { roomMessages: { entities, ids: ['n0'], idsGroupBy: { main: ['n0'] } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    if (process.env.WITH_SYNC) { for (const f of ['ccfolia-format-sync', 'ccfolia-roll20-css-bridge']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../legacy/' + f + '.user.js'), 'utf8') }); }
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(400);
    const sentTexts = () => calls.filter((c) => c.kind === 'write').map((c) => JSON.parse(c.body).fields.text.stringValue);
    const send = async (sel, text, prep) => {
      const input = page.locator(sel + ' .ccf-scp-input');
      await input.click(); await input.fill(text); await page.waitForTimeout(500);
      if (prep) await prep();
      const before = sentTexts().length;
      await page.evaluate((s) => document.querySelector(s + ' .ccf-scp-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), sel);
      await page.waitForTimeout(800);
      const all = sentTexts(); assert.equal(all.length, before + 1, 'one message was written');
      return all[all.length - 1];
    };
    const INVIS = /[\u200b-\u200f\u2060-\u206f\ufe00-\ufe0f\u{e0000}-\u{e01ef}]/u;
    const checkPanel = async (sel, label) => {
      const bold = await send(sel, '**굵게** 일반');
      assert.ok(bold.startsWith('굵게 일반') && bold.length > 20 && INVIS.test(bold), label + ': bold marker became an envelope: ' + JSON.stringify(bold.slice(0, 30)));
      const viaBtn = await send(sel, '선택 굵게', async () => {
        await page.evaluate((q) => { const i = document.querySelector(q + ' .ccf-scp-input'); i.focus(); i.setSelectionRange(3, 5); }, sel);
        await page.locator(sel + ' .ccf-scp-fmt-btn', { has: page.locator('b') }).first().click();
        assert.equal(await page.locator(sel + ' .ccf-scp-input').inputValue(), '선택 **굵게**', label + ': the B button wrapped the selection');
      });
      assert.ok(viaBtn.startsWith('선택 굵게') && INVIS.test(viaBtn), label + ': button marker became an envelope');
      // keyboard shortcuts wrap the selection like the buttons: Ctrl+B bold, Ctrl+I italic, Ctrl+U underline
      for (const [key, marker] of [['KeyB', '**'], ['KeyI', '*'], ['KeyU', '__']]) {
        const wrapped = await page.evaluate(({ q, code }) => { const i = document.querySelector(q + ' .ccf-scp-input'); i.focus(); i.value = '단축 키'; i.setSelectionRange(3, 4); const ev = new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), ctrlKey: true, bubbles: true, cancelable: true }); i.dispatchEvent(ev); return { v: i.value, prevented: ev.defaultPrevented }; }, { q: sel, code: key });
        assert.deepEqual(wrapped, { v: '단축 ' + marker + '키' + marker, prevented: true }, label + ': Ctrl+' + key.slice(3) + ' wraps the selection');
      }
      const styled = await send(sel, '색과 정렬', async () => {
        await page.evaluate((s) => { const c = document.querySelector(s + ' .ccf-scp-fmt-color input'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); }, sel);
        await page.locator(sel + ' .ccf-scp-fmt-align[data-align="center"]').click();
      });
      assert.ok(styled.startsWith('색과 정렬') && styled.length > '색과 정렬'.length + 20 && INVIS.test(styled), label + ': colour/alignment envelope: ' + styled.length);
      // a copied message brings its invisible envelope: pasting drops it, and a text that already carries one is stripped before it is sent (no double envelope)
      const pasted = await page.evaluate(({ q, text }) => { const i = document.querySelector(q + ' .ccf-scp-input'); i.focus(); i.value = ''; const dt = new DataTransfer(); dt.setData('text/plain', text); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return i.value; }, { q: sel, text: bold });
      assert.equal(pasted, '굵게 일반', label + ': pasting a copied message gives the visible text only');
      const twice = await send(sel, bold);
      assert.equal(twice, '굵게 일반', label + ': the old envelope is dropped, the visible text goes out plain (no double envelope): ' + twice.length);
      // chat commands and dice commands go out exactly as typed: markers are not parsed, the format bar state (colour, narration, line break) is not applied, no envelope
      for (const command of ['/roll-table\n장면표\n1D5\n1: **굵게** 단어', '/roll 2d6 *기울임*', '2D6>=5 **판정**', 'ST']) {
        const sent = await send(sel, command, async () => {
          await page.evaluate((q) => { const c = document.querySelector(q + ' .ccf-scp-fmt-color input'); if (c) { c.value = '#00ff00'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); } }, sel);
        });
        assert.equal(sent, command, label + ': a command is sent as typed: ' + JSON.stringify(command));
        assert.ok(!INVIS.test(sent), label + ': no envelope on a command');
      }
      const plain = await send(sel, '그냥 글');
      assert.equal(plain, '그냥 글', label + ': plain text stays plain');
    };
    await checkPanel('#ccf-second-chat-panel', 'panel 1');
    await page.evaluate(() => window.__ccfScpHost.addPanel());
    await page.waitForTimeout(600);
    const ids = await page.evaluate(() => [...document.querySelectorAll('.ccf-scp-panel')].map((p) => p.id));
    assert.ok(ids.length >= 2, 'an added panel exists: ' + ids);
    await checkPanel('#' + ids[ids.length - 1], 'added panel');
    // every format button is really on top at its centre (nothing covers or clips it), docked and detached
    const covered = async () => page.evaluate(() => [...document.querySelectorAll('.ccf-scp-panel .ccf-scp-fmt > *')].filter((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height > 0).map((b) => { const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return (t === b || b.contains(t)) ? null : (b.className + '|' + (b.title || b.textContent) + '|' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height) + '|panel ' + b.closest('.ccf-scp-panel').id) + ' <- ' + (t && (t.className || t.tagName)); }).filter(Boolean));
    assert.deepEqual(await covered(), [], 'docked: no format button is covered');
    await page.evaluate(() => { for (const h of Object.values(window.__ccfScpHost.instances || {})) h.setFloating?.(true); });
    await page.waitForTimeout(400);
    console.log('floating covered:', JSON.stringify(await covered()));
    const fd = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.formatDiag());
    assert.equal(fd.panels.length, 2); for (const d of fd.panels) { assert.equal(d.sent, true); assert.equal(d.envelope, false, 'the last message of each panel was plain: ' + JSON.stringify(d)); assert.equal(d.input, '그냥 글'); }
    console.log('chat panel format send PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
