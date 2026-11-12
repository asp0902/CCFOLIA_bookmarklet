const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 메시지창이 숨겨진 동안 큐 빨리감기: 숨김 + 연속 메시지 10개 + 다이스 롤 → 롤이 맨 앞이 되는 시각(= 3D 다이스 effect 시작)이 도착 후 300ms 이내.
// 보임 상태는 손대지 않고, 끄기 스위치·액션 실패 안전장치·비밀 롤/내게 안 보이는 메시지도 확인. 실제 스크립트 + 복제 저장소(코코포리아 리듀서와 같은 규칙: roomMessages/shiftAddedRoomMessage).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-message-window-sync.user.js'), 'utf8');
const html = `<!doctype html><meta charset=utf-8><body><div id="root"></div>
<div id="win" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;left:16px;right:88px;bottom:16px;height:100px;background:#222;visibility:hidden">window</div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    // fake store: addedIds queue like the real roomMessages slice, plus a "3D dice effect" that, like chunk 216, reacts when the front id changes
    await page.evaluate(() => {
      const state = { app: { user: { uid: 'me' } }, entities: { rooms: { entities: { r: { hidden3dDice: false } } }, roomMessages: { addedIds: [], entities: {} } } };
      const listeners = new Set();
      window.__broken = false; window.__t0 = 0; window.__fx = []; let lastFront = null;
      const store = { getState: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, dispatch(action) { if (action.type === 'roomMessages/shiftAddedRoomMessage' && !window.__broken) state.entities.roomMessages.addedIds.shift(); listeners.forEach((fn) => fn()); return action; } };
      const front = () => { const q = state.entities.roomMessages; return q.addedIds.find((id) => { const to = q.entities[id].to; return to == null || to === 'me'; }); };
      // react-redux + useEffect: a render after each store change, effect when the front id differs from the last rendered one
      store.subscribe(() => setTimeout(() => { const id = front(); if (id !== lastFront) { lastFront = id; const roll = id && state.entities.roomMessages.entities[id].extend?.roll; if (roll && !roll.secret && !state.entities.rooms.entities.r.hidden3dDice) window.__fx.push({ id, at: performance.now() - window.__t0 }); } }, 0));
      window.__push = (n, extra = {}) => { for (let i = 0; i < n; i++) { const id = `${extra.prefix || 'm'}${i}`; state.entities.roomMessages.entities[id] = { to: null, text: '글자'.repeat(40), ...extra }; state.entities.roomMessages.addedIds.push(id); } listeners.forEach((fn) => fn()); };
      window.__queue = () => state.entities.roomMessages.addedIds.slice();
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store } } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => window.__CCF_MSG_WINDOW_SYNC__?.state().attached);
    const arrive = () => page.evaluate(() => { window.__t0 = performance.now(); window.__fx = []; window.__push(10); window.__push(1, { prefix: 'roll', extend: { roll: { secret: false, dices: [{ faces: 6, value: 3 }] } } }); window.__push(3, { prefix: 'after' }); });
    const waitEmpty = () => page.waitForFunction(() => window.__queue().length === 0, null, { timeout: 5000 });
    // 1) hidden window: the 3D dice effect starts within 300ms of the arrival, the queue empties fast
    await arrive(); await waitEmpty();
    const fx = await page.evaluate(() => window.__fx);
    assert.equal(fx.length, 1, 'one dice effect'); assert.equal(fx[0].id, 'roll0');
    assert(fx[0].at <= 300, `dice effect starts within 300ms (${Math.round(fx[0].at)}ms)`);
    console.log('hidden: dice effect at', Math.round(fx[0].at), 'ms; shifts', await page.evaluate(() => window.__CCF_MSG_WINDOW_SYNC__.state().shifts));
    // 2) visible window: the queue is left alone (the original typing behaviour)
    await page.evaluate(() => { document.getElementById('win').style.visibility = 'visible'; });
    await arrive(); await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => window.__queue().length), 14, 'visible window: queue untouched');
    assert.equal(await page.evaluate(() => window.__fx.length), 0, 'visible window: the dice wait for their turn');
    // 3) hiding it again (close button) resumes the fast-forward
    await page.evaluate(() => { document.getElementById('win').style.visibility = 'hidden'; });
    await waitEmpty();
    // 4) secret rolls and rolls under the old dice effect do not wait; messages for someone else are dropped without waiting
    await page.evaluate(() => { window.__t0 = performance.now(); window.__fx = []; window.__push(2, { prefix: 'other', to: 'someone' }); window.__push(1, { prefix: 'secret', extend: { roll: { secret: true, dices: [] } } }); });
    await waitEmpty(); assert.equal(await page.evaluate(() => window.__fx.length), 0, 'secret roll: no 3D effect to wait for');
    // 5) the off switch
    await page.evaluate(() => localStorage.setItem('ccfMsgWindowSync', 'off'));
    await page.evaluate(() => window.__push(5)); await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__queue().length), 5, 'off: queue untouched');
    await page.evaluate(() => localStorage.removeItem('ccfMsgWindowSync'));
    await page.evaluate(() => window.__push(1)); await waitEmpty();
    // 6) safety: when the shift action does nothing, the feature turns itself off and stops dispatching
    await page.evaluate(() => { window.__broken = true; window.__push(4); });
    await page.waitForFunction(() => window.__CCF_MSG_WINDOW_SYNC__.state().broken, null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => window.__queue().length), 4, 'broken action: nothing lost, original behaviour left to CCFOLIA');
    assert.match(await page.evaluate(() => window.__CCF_MSG_WINDOW_SYNC__.state().reason), /no effect/);
    assert.deepEqual(errors, [], 'no page errors');
    console.log('message window sync PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
