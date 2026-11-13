// chat-panel relayHelpProbe (the web-share relay reads CCFOLIA's "채팅 커맨드" dialog at room entry): the dialog must never be left open and never be seen.
//  - a system whose dialog carries no docs.bcdice.org link (readHelpDialog gives null) used to be left open: the hide CSS was removed and the dialog showed at every entry;
//  - now it is closed in every case (Escape; if the dialog ignores Escape, the app state openRoomDiceBotInfo=false), the result (also "unreadable") is remembered per system in localStorage and the dialog is not opened again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    for (const variant of ['no-link/escape-closes', 'no-link/escape-ignored', 'with-link']) {
      const context = await browser.newContext({ viewport: { width: 1300, height: 800 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body style="background:#222;color:#fff"><div id="root"></div><button aria-label="채팅 커맨드에 대해" id="help-btn">?</button></body>' }));
      await page.route('https://firestore.googleapis.com/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate((variant) => {
        const state = { app: { user: { uid: 'me' }, state: { roomId: 'r1', openRoomDiceBotInfo: false } }, entities: { roomMessages: { entities: {}, ids: [], idsGroupBy: {} }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner: 'me', diceBotSystem: 'Insane:Korean' } } } } };
        const closeDialog = () => document.querySelectorAll('.MuiDialog-root').forEach((d) => d.remove());
        const store = { getState: () => state, subscribe: () => () => {}, dispatch(action) { if (action.type === 'app/state/seted') { state.app.state = action.payload; if (!action.payload.openRoomDiceBotInfo) closeDialog(); } return action; } };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
        window.__opened = 0;
        document.getElementById('help-btn').addEventListener('click', () => {
          window.__opened += 1; state.app.state = { ...state.app.state, openRoomDiceBotInfo: true };
          const d = document.createElement('div'); d.className = 'MuiDialog-root MuiModal-root'; d.setAttribute('role', 'presentation');
          d.innerHTML = '<div class="MuiDialog-container" tabindex="-1"><div class="MuiDialog-paper" role="dialog"><h2 class="MuiDialogTitle-root">채팅 커맨드</h2><div class="MuiDialogContent-root"><h6>시스템 전용 다이스 커맨드</h6><p>ST 장면표' + (variant === 'with-link' ? ' <a href="https://docs.bcdice.org/x">도움말</a>' : '') + '</p></div></div></div>';
          if (variant !== 'no-link/escape-ignored') d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { state.app.state = { ...state.app.state, openRoomDiceBotInfo: false }; closeDialog(); } });
          document.body.append(d);
        });
      }, variant);
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(300);
      const visibleAtAnyTime = [];
      await page.evaluate(() => { window.__seen = false; new MutationObserver(() => { const d = document.querySelector('.MuiDialog-root'); if (d && getComputedStyle(d).visibility !== 'hidden' && getComputedStyle(d).opacity !== '0') window.__seen = true; }).observe(document.body, { childList: true, subtree: true, attributes: true }); });
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.relayHelpProbe());
      assert.equal(await page.locator('.MuiDialog-root').count(), 0, variant + ': the dialog is closed afterwards');
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('style')].some((s) => /MuiDialog-root,\.MuiBackdrop-root/.test(s.textContent))), false, variant + ': the hide CSS is gone');
      assert.equal(await page.evaluate(() => window.__seen), false, variant + ': the dialog was never visible');
      assert.equal(await page.evaluate(() => window.__opened), 1);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-relay-help-v1:Insane:Korean')));
      assert.equal(!!saved?.help, variant === 'with-link', variant + ': the result is remembered per system (' + JSON.stringify(saved) + ')');
      // a second probe (next entry / next mirror) does not open it again; neither does a fresh page load with the stored result
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.relayHelpProbe());
      assert.equal(await page.evaluate(() => window.__opened), 1, variant + ': not opened again');
      await page.reload();
      await page.evaluate(() => { const state = { app: { user: { uid: 'me' }, state: { roomId: 'r1', openRoomDiceBotInfo: false } }, entities: { roomMessages: { entities: {}, ids: [], idsGroupBy: {} }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner: 'me', diceBotSystem: 'Insane:Korean' } } } } }; window.__opened = 0; document.getElementById('help-btn').addEventListener('click', () => { window.__opened += 1; }); document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } }; });
      await page.addScriptTag({ content: source }); await page.waitForTimeout(300);
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.relayHelpProbe());
      assert.equal(await page.evaluate(() => window.__opened), 0, variant + ': a later entry does not open the dialog at all');
      assert.deepEqual(errors, []); await context.close();
    }
    console.log('help probe hidden PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
