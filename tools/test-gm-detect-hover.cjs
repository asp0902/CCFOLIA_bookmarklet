const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 오리지널 채팅 호버 버튼: GM 판정은 코코포리아 getIsOwner 와 같은 기준(현재 방 owner === app.user.uid)이라 IndexedDB 에 로그인 기록이 없어도 GM 으로 잡히고,
// 방 정보가 늦게 와도 null 로 굳지 않고 다시 판정한다. 눈 버튼은 편집(내 메시지)/답장(남의 메시지) 호버 묶음 안 첫 네이티브 버튼 앞에 들어가고 네이티브 버튼은 그대로다. GM 이 아니면 눈 없음.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const run = async (label, { owner, appUid, roomsJs }) => {
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="background:#222;color:#fff"><div id="root"></div></body>' }));
      await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
      await page.goto('https://ccfolia.test/rooms/test');
      await page.evaluate(({ owner, appUid, roomsJs }) => {
        const now = Math.floor(Date.now() / 1000);
        const entities = { m1: { name: '나', text: '내 말', from: appUid, channel: 'main', createdAt: { seconds: now - 20, nanoseconds: 0 } }, m2: { name: '남', text: '남의 말', from: 'other', channel: 'main', createdAt: { seconds: now - 10, nanoseconds: 0 } }, m3: { name: '나', text: '서식 내 말⁠​‌‍​', from: appUid, channel: 'main', createdAt: { seconds: now - 5, nanoseconds: 0 } } };
        const rooms = new Function('owner', 'return ' + roomsJs)(owner);
        const state = { app: { state: { roomId: 'r1' }, user: { uid: appUid } }, entities: { roomMessages: { entities, ids: ['m1', 'm2', 'm3'], idsGroupBy: { main: ['m1', 'm2', 'm3'] } }, roomCharacters: { entities: {} }, rooms: { entities: rooms } } };
        window.__state = state;
        const root = document.getElementById('root');
        root['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
        const row = (id, name, text, button) => `<li class="MuiListItem-root" id="${id}" style="position:relative;padding:12px 16px;list-style:none"><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary">${name}</h6><p class="MuiListItemText-secondary">${text}</p></div><div class="hover-group" style="position:absolute;top:12px;right:16px;display:flex"><button class="MuiIconButton-root native" aria-label="${button}">x</button></div></li>`;
        const ul = document.createElement('ul'); ul.innerHTML = row('own', '나', '내 말', 'chat-edit') + row('theirs', '남', '남의 말', 'reply-to') + row('fmt', '나', '서식 내 말', 'chat-edit');
        root.appendChild(ul);
      }, { owner, appUid, roomsJs });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
      await page.waitForTimeout(2300);
      return { page, errors, label };
    };
    // 1) the login record is only in the redux state (nothing in IndexedDB), and the first room of the list is someone else's
    {
      const { page, errors } = await run('redux uid', { owner: 'me', appUid: 'me', roomsJs: "({ other: { owner: 'x' }, r1: { owner } })" });
      assert.equal(await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.isGm()), true, 'GM from app.user.uid === current room owner');
      const diag = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.hideDiag());
      assert.equal(diag.isGm, true); assert.equal(diag.gmReason, 'owner'); assert.equal(diag.gmAttr, '1');
      for (const id of ['own', 'theirs', 'fmt']) { // fmt = my message with a format envelope: the row shows only the visible text, the stored text carries the envelope
        const info = await page.evaluate((rowId) => { const li = document.getElementById(rowId); const hide = li.querySelector('.ccf-hide-btn'); const native = li.querySelector('.native:not(.ccf-hide-btn)'); return { hide: !!hide, native: !!native, nativeVisible: native && getComputedStyle(native).display !== 'none' && getComputedStyle(native).visibility !== 'hidden' }; }, id);
        assert.deepEqual(info, { hide: true, native: true, nativeVisible: true }, id + ': the eye button was added, the native button is untouched');
      }
      // hover: the eye goes into the native hover group, just before its first button (the edit / reply button)
      await page.locator('#own').hover(); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => { const g = document.querySelector('#own .hover-group'); const eye = g.querySelector('.ccf-hide-btn'); return !!eye && eye.nextElementSibling === g.querySelector('.native:not(.ccf-hide-btn)'); }), true, 'the eye sits right before the edit button');
      await page.locator('#theirs').hover(); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => { const g = document.querySelector('#theirs .hover-group'); const eye = g.querySelector('.ccf-hide-btn'); return !!eye && eye.nextElementSibling === g.querySelector('.native:not(.ccf-hide-btn)') && g.querySelectorAll('.native:not(.ccf-hide-btn)').length === 1; }), true, 'the reply button stays, the eye before it');
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    // 2) not the owner: no eye buttons, the native ones stay
    {
      const { page } = await run('not gm', { owner: 'someone-else', appUid: 'me', roomsJs: "({ r1: { owner } })" });
      assert.equal(await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.isGm()), false);
      assert.equal(await page.locator('.ccf-hide-btn').count(), 0, 'no eye for a non-GM'); assert.equal(await page.locator('.native').count(), 3, 'native buttons stay');
      assert.equal((await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.hideDiag())).gmReason, 'not-owner');
      await page.context().close();
    }
    // 3) the room arrives late: not frozen at "unknown", the next check (1.5 s) finds it; the reason is shown meanwhile
    {
      const { page } = await run('late room', { owner: 'me', appUid: 'me', roomsJs: '({})' });
      const early = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.hideDiag());
      assert.equal(early.isGm, null); assert.equal(early.gmReason, 'room-not-in-store', 'the failure reason is reported');
      await page.evaluate(() => { window.__state.entities.rooms.entities.r1 = { owner: 'me' }; });
      await page.waitForFunction(() => window.__CCF_SECOND_CHAT_PANEL__.isGm() === true, null, { timeout: 6000 });
      await page.waitForSelector('#own .ccf-hide-btn', { state: 'attached', timeout: 4000 });
      await page.context().close();
    }
    console.log('gm detect + hover buttons PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
