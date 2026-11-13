const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// GM 화면의 '내 캐릭터 목록'에 다른 사람 소유 캐릭터가 음영 행으로 이어 붙는다: 내 것 2 + 남의 것 3(소유자 2명) → 3행, 소유자 표기(title "소유자: 이름"), 삭제 버튼 없음,
// 클릭 → 코코포리아 편집창을 여는 상태 변경(app/state/seted), 소유권이 바뀌면 목록에서 이동, 참가자(GM 아님) 화면에는 없음, 값이 같으면 DOM 을 쓰지 않는다. 인세인 룸이면 시트 버튼.
const read = (name) => fs.readFileSync(path.join(__dirname, '../legacy/' + name), 'utf8');
const source = read('ccfolia-others-characters.user.js');
const sheet = read('ccfolia-character-sheet.user.js');
const html = (insane) => `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">${insane ? '<span class="MuiTypography-caption">인세인</span>' : ''}<div id="root"></div>
  <div class="MuiDialog-root" role="dialog" style="position:fixed;right:20px;top:60px;width:420px;background:#333"><h2>내 캐릭터 목록</h2>
  <ul id="rows"><li class="MuiListItem-root native" style="display:flex;gap:6px;align-items:center"><div class="MuiListItemAvatar-root"><img src="https://example.test/a.png" width="40" height="40"></div><div class="MuiListItemText-root" style="flex:1"><h6 class="MuiListItemText-primary">연갈</h6><p class="MuiListItemText-secondary">메모</p></div><button aria-label="토큰을 화면에서 삭제">삭</button></li>
  <li class="MuiListItem-root native" style="display:flex;gap:6px;align-items:center"><div class="MuiListItemAvatar-root"><img src="https://example.test/b.png" width="40" height="40"></div><div class="MuiListItemText-root" style="flex:1"><h6 class="MuiListItemText-primary">브릿지</h6></div><button aria-label="토큰을 화면에서 삭제">삭</button></li></ul></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async ({ gm, insane = false, withSheet = false }) => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html(insane) }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate((gm) => {
        const me = 'me';
        const state = { app: { user: { uid: me }, state: { roomId: 'r1', openRoomCharacter: false, openRoomCharacterId: null, other: 1 }, room: { members: { entities: { u1: { displayName: '하나' }, u2: { displayName: '둘' }, me: { displayName: '나' } } } } },
          entities: { rooms: { entities: { r1: { owner: gm ? me : 'someone' } } }, roomCharacters: { entities: {
            a1: { name: '연갈', owner: me, order: 1 }, a2: { name: '브릿지', owner: me, order: 2 },
            b1: { name: '하나의 캐릭터', owner: 'u1', order: 1, iconUrl: 'https://example.test/h1.png' }, b2: { name: '하나의 둘째', owner: 'u1', order: 2, iconUrl: '' }, b3: { name: '둘의 캐릭터', owner: 'u2', order: 1, iconUrl: 'https://example.test/t1.png' } } } } };
        const listeners = new Set(); window.__dispatched = []; window.__state = state;
        const store = { getState: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, dispatch(action) { window.__dispatched.push(action); if (action.type === 'app/state/seted') state.app.state = action.payload; return action; } };
        window.__notify = () => listeners.forEach((fn) => fn());
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
      }, gm);
      if (withSheet) await page.addScriptTag({ content: sheet });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(500);
      return page;
    };
    // GM: three shaded rows after the native ones, sorted by owner then order
    {
      const page = await open({ gm: true });
      const rows = await page.evaluate(() => [...document.querySelectorAll('#rows > li')].map((li) => ({ name: li.querySelector('.MuiListItemText-primary').textContent, mine: li.classList.contains('native'), shaded: li.hasAttribute('data-ccf-others-row') && getComputedStyle(li).backgroundColor, title: li.title, buttons: li.querySelectorAll('button').length, img: li.querySelector('img')?.getAttribute('src') || '', secondary: !!li.querySelector('.MuiListItemText-secondary'), owner: li.querySelector('[data-capybara-toolkit-others] span')?.textContent || '' })));
      assert.deepEqual(rows.map((r) => r.name), ['연갈', '브릿지', '둘의 캐릭터', '하나의 캐릭터', '하나의 둘째'], 'my rows first (untouched), then the others: by owner name, order');
      assert.deepEqual(rows.slice(0, 2).map((r) => [r.mine, r.buttons]), [[true, 1], [true, 1]], 'native rows keep their delete button');
      for (const r of rows.slice(2)) { assert.equal(r.shaded, 'rgba(255, 255, 255, 0.06)', 'shaded'); assert.equal(r.buttons, 0, 'no delete (or any) button'); assert.equal(r.secondary, false); }
      assert.deepEqual(rows.slice(2).map((r) => [r.title, r.owner, r.img]), [['소유자: 둘', '둘', 'https://example.test/t1.png'], ['소유자: 하나', '하나', 'https://example.test/h1.png'], ['소유자: 하나', '하나', '']]);
      // click → CCFOLIA's edit dialog state change
      await page.locator('#rows > li[data-ccf-others-row="b1"]').click();
      assert.deepEqual(await page.evaluate(() => window.__dispatched.map((a) => [a.type, a.payload.openRoomCharacter, a.payload.openRoomCharacterId, a.payload.other])), [['app/state/seted', true, 'b1', 1]], 'opens the native edit dialog for that character, the rest of the app state is kept');
      // ownership changes: a participant gives a character back to me → it leaves the others, a new one appears when someone takes one
      await page.evaluate(() => { const c = window.__state.entities.roomCharacters.entities; c.b3.owner = 'me'; c.b4 = { name: '새 캐릭터', owner: 'u2', order: 5 }; window.__notify(); });
      await page.waitForFunction(() => document.querySelectorAll('[data-ccf-others-row]').length === 3 && document.querySelector('[data-ccf-others-row="b4"]') && !document.querySelector('[data-ccf-others-row="b3"]'), null, { timeout: 3000 });
      // idle: nothing is written while nothing changes
      const writes = await page.evaluate(() => new Promise((resolve) => { let n = 0; const mo = new MutationObserver((r) => { n += r.length; }); mo.observe(document.getElementById('rows'), { subtree: true, childList: true, attributes: true, characterData: true }); window.__notify(); setTimeout(() => { mo.disconnect(); resolve(n); }, 1200); }));
      assert.equal(writes, 0, 'idle: no DOM writes');
      // React re-renders the list (our rows are gone): they come back once
      await page.evaluate(() => document.querySelectorAll('[data-ccf-others-row]').forEach((n) => n.remove()));
      await page.waitForFunction(() => document.querySelectorAll('[data-ccf-others-row]').length === 3, null, { timeout: 3000 });
      assert.deepEqual(page.__errors, []); await page.close();
    }
    // not the GM: nothing is added
    { const page = await open({ gm: false }); assert.equal(await page.locator('[data-ccf-others-row]').count(), 0, 'a non-GM account sees nothing extra'); assert.equal(await page.locator('#rows > li').count(), 2); await page.close(); }
    // an inSANe room with the sheet script: each other-owned row has the sheet button, which opens that character's sheet
    {
      const page = await open({ gm: true, insane: true, withSheet: true });
      assert.equal(await page.locator('[data-ccf-others-row] button[aria-label="사이코로픽션 시트"]').count(), 3, 'a sheet button on each row');
      await page.locator('[data-ccf-others-row="b1"] button[aria-label="사이코로픽션 시트"]').click();
      await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor', { timeout: 4000 });
      assert.equal(await page.locator('#ccf-character-sheet-root header h2').textContent(), '하나의 캐릭터', 'the sheet of that character');
      assert.deepEqual(await page.evaluate(() => window.__dispatched.length), 0, 'the sheet button does not open the edit dialog');
      await page.close();
    }
    // the real "내 캐릭터 목록" is a floating Paper panel (h6 title), not a Dialog; a GM with no characters of their own has no native row to copy: the rows are drawn from scratch, in that panel's list
    for (const variant of ['paper-with-rows', 'paper-empty']) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const panel = variant === 'paper-empty'
        ? '<div class="MuiPaper-root MuiPaper-elevation6" style="position:fixed;right:20px;top:60px;width:420px;background:#333"><div><h6 class="MuiTypography-root">내 캐릭터 목록</h6></div><ul class="MuiList-root" id="rows"></ul></div>'
        : '<div class="MuiPaper-root MuiPaper-elevation6" style="position:fixed;right:20px;top:60px;width:420px;background:#333"><div><h6 class="MuiTypography-root">내 캐릭터 목록</h6></div><ul class="MuiList-root" id="rows"><li class="MuiListItem-root" style="display:flex"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">연갈</h6></div><button aria-label="토큰을 화면에서 삭제">삭</button></li></ul></div>';
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div id="root"></div>' + panel }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => {
        const state = { app: { user: { uid: 'me' }, state: { roomId: 'r1', openRoomCharacter: false, openRoomCharacterId: null }, room: { members: { entities: { u1: { displayName: '하나' } } } } }, entities: { rooms: { entities: { r1: { owner: 'me' } } }, roomCharacters: { entities: { b1: { name: '하나의 캐릭터', owner: 'u1', order: 1, iconUrl: 'https://example.test/h1.png' } } } } };
        window.__dispatched = [];
        const store = { getState: () => state, subscribe: () => () => {}, dispatch(action) { window.__dispatched.push(action); return action; } };
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
      });
      await page.addScriptTag({ content: source });
      await page.waitForSelector('[data-ccf-others-row]', { timeout: 4000 });
      assert.equal(await page.locator('[data-ccf-others-row]').count(), 1, variant + ': one row');
      assert.equal(await page.locator('[data-ccf-others-row] button').count(), 0, variant + ': no delete button');
      assert.equal(await page.evaluate(() => document.querySelector('[data-ccf-others-row] .MuiListItemText-primary').textContent), '하나의 캐릭터');
      await page.locator('[data-ccf-others-row]').click();
      assert.deepEqual(await page.evaluate(() => window.__dispatched.map((x) => [x.type, x.payload.openRoomCharacterId])), [['app/state/seted', 'b1']], variant + ': click opens the native edit dialog');
      const diag = await page.evaluate(() => window.__CCF_OTHERS_CHARS__.diag());
      assert.deepEqual([diag.gm, diag.ownedByOthers, diag.panels.map((x) => [x.kind, x.title, x.nativeRows]), diag.reason], [true, 1, [['paper', '내 캐릭터 목록', variant === 'paper-empty' ? 0 : 1]], '정상: 행이 붙어 있음'], variant + ': diag explains');
      assert.deepEqual(errors, []); await page.close();
    }
    // the structure of the real panel (read from CCFOLIA's bundle): Paper > title bar + .scrollable-list > div > sorted list div > class-less relative wrapper > li.MuiListItem-container > ListItem(button) + secondary action
    // (the token button of a character that is not on the board is "add", its tooltip name differs per language: rows are found by their name text, not by a delete label)
    for (const variant of ['bundle-rows', 'bundle-empty']) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const item = (name) => '<div style="position:relative"><li class="MuiListItem-container"><div class="MuiButtonBase-root MuiListItem-root MuiListItem-dense MuiListItem-gutters MuiListItem-button MuiListItem-secondaryAction" role="button" tabindex="0" style="display:flex"><div class="MuiListItemAvatar-root"><div class="MuiAvatar-root"><img class="MuiAvatar-img" src="https://example.test/a.png" width="40" height="40"></div></div><div class="MuiListItemText-root"><span class="MuiTypography-root MuiListItemText-primary">' + name + '</span><p class="MuiListItemText-secondary">메모</p></div></div><div class="MuiListItemSecondaryAction-root"><button class="MuiIconButton-root" aria-label="말로서 판면에 추가">+</button></div></li></div>';
      const panel = '<div class="MuiPaper-root MuiPaper-elevation6" style="position:fixed;right:20px;top:60px;width:420px;background:#333"><div class="MuiPaper-root MuiAppBar-root MuiAppBar-positionStatic" style="background:transparent"><div class="MuiToolbar-root"><h6 class="MuiTypography-root MuiTypography-subtitle2">내 캐릭터 목록</h6></div></div><div class="MuiList-root scrollable-list"><div><div class="css-sorted" id="rows">' + (variant === 'bundle-rows' ? item('연갈') + item('브릿지') : '') + '</div></div></div></div>';
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div id="root"></div>' + panel }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => {
        const state = { app: { user: { uid: 'me' }, state: { roomId: 'r1', openRoomCharacter: false, openRoomCharacterId: null }, room: { members: { entities: { u1: { displayName: '하나' } } } } }, entities: { rooms: { entities: { r1: { owner: 'me' } } }, roomCharacters: { entities: { b1: { name: '하나의 캐릭터', owner: 'u1', order: 1, iconUrl: '' } } } } };
        window.__dispatched = [];
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch(action) { window.__dispatched.push(action); return action; } } } } } };
      });
      await page.addScriptTag({ content: source });
      await page.waitForSelector('[data-ccf-others-row]', { timeout: 4000 });
      const shape = await page.evaluate((variant) => { const own = document.querySelector('[data-ccf-others-row]'); const rows = document.getElementById('rows'); return { sibling: own.parentElement === rows || own.parentElement === rows.parentElement || own.parentElement.closest('#rows') === rows, nativeKept: rows.querySelectorAll('.MuiListItemText-primary').length - 1, last: variant === 'bundle-rows' ? rows.lastElementChild === own : true, buttons: own.querySelectorAll('button').length }; }, variant);
      assert.deepEqual([shape.sibling, shape.last, shape.buttons], [true, true, 0], variant + ': the row is appended as a sibling of the native rows, no buttons (' + JSON.stringify(shape) + ')');
      const diag = await page.evaluate(() => window.__CCF_OTHERS_CHARS__.diag());
      assert.deepEqual(diag.panels.map((x) => [x.nativeRows, x.hasList]), [[variant === 'bundle-rows' ? 2 : 0, true]], variant + ': diag sees the rows by their names');
      await page.locator('[data-ccf-others-row]').click();
      assert.deepEqual(await page.evaluate(() => window.__dispatched.map((x) => x.payload.openRoomCharacterId)), ['b1']);
      assert.deepEqual(errors, []); await page.close();
    }
    // the panel is opened first and its rows are drawn later; 4 characters of my own and 2 of other people, one of them without a name (CCFOLIA draws NONAME): both are listed, after the native rows
    {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const item = (name) => '<div style="position:relative"><li class="MuiListItem-container"><div class="MuiListItem-root MuiListItem-button" role="button" style="display:flex"><div class="MuiListItemText-root"><span class="MuiTypography-root MuiListItemText-primary">' + name + '</span></div></div><div class="MuiListItemSecondaryAction-root"><button class="MuiIconButton-root" aria-label="x">x</button></div></li></div>';
      const panel = '<div class="MuiPaper-root MuiPaper-elevation6" style="position:fixed;right:20px;top:60px;width:420px;background:#333"><div><header class="MuiPaper-root MuiPaper-elevation0 MuiAppBar-root"><div class="MuiToolbar-root"><h6 class="MuiTypography-root MuiTypography-subtitle2">내 캐릭터 목록</h6></div></header></div><div class="MuiList-root scrollable-list"><div><div class="css-sorted" id="rows"></div></div></div></div>';
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div id="root"></div>' + panel }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => {
        const mine = (n, i) => [n, { name: n, owner: 'me', order: i }];
        const state = { app: { user: { uid: 'me' }, state: { roomId: 'r1', openRoomCharacter: false, openRoomCharacterId: null }, room: { members: { entities: { u1: { displayName: '하나' }, u2: { displayName: '둘' } } } } }, entities: { rooms: { entities: { r1: { owner: 'me' } } }, roomCharacters: { entities: Object.fromEntries([mine('가', 1), mine('나', 2), mine('다', 3), mine('라', 4), ['x1', { name: '남의캐릭터', owner: 'u1', order: 1 }], ['x2', { name: '', owner: 'u2', order: 1 }]]) } } };
        window.__dispatched = [];
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch(action) { window.__dispatched.push(action); return action; } } } } } };
      });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(500); // the panel is there, no native rows yet
      await page.evaluate((html) => { document.getElementById('rows').innerHTML = html; }, ['가', '나', '다', '라'].map(item).join(''));
      await page.waitForFunction(() => document.querySelectorAll('[data-ccf-others-row]').length === 2 && document.getElementById('rows').lastElementChild.hasAttribute('data-ccf-others-row'), null, { timeout: 4000 });
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-ccf-others-row] .MuiListItemText-primary')].map((n) => n.textContent)), ['NONAME', '남의캐릭터'], 'both are listed (the nameless one as NONAME), after the four native rows');
      const diag = await page.evaluate(() => window.__CCF_OTHERS_CHARS__.diag());
      assert.deepEqual([diag.othersListed, diag.otherNames, diag.rowsInDom, diag.lastError, diag.syncCount > 0, diag.lastSyncResult.startsWith('ok'), diag.panels[0].nativeRows], [2, ['NONA', '남의캐릭'], 2, '', true, true, 4], 'diag: sync counters, result and the names');
      assert.deepEqual(errors, []); await page.close();
    }
    // diag reasons: not the GM / no panel open
    {
      const page = await browser.newPage();
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body><div id="root"></div>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => { const state = { app: { user: { uid: 'me' }, state: { roomId: 'r1' } }, entities: { rooms: { entities: { r1: { owner: 'x' } } }, roomCharacters: { entities: { b1: { name: 'n', owner: 'u1' } } } } }; document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } }; });
      await page.addScriptTag({ content: source }); await page.waitForTimeout(400);
      assert((await page.evaluate(() => window.__CCF_OTHERS_CHARS__.diag())).reason.includes('계정이 아님')); await page.close();
    }
    // the other people's rows do not depend on the rule: a room that is not inSANe (sheet script loaded or not) lists them all, with no sheet button; an inSANe room lists the same rows plus the sheet button
    for (const withSheet of [false, true]) {
      const page = await open({ gm: true, insane: false, withSheet });
      assert.equal(await page.locator('[data-ccf-others-row]').count(), 3, 'not inSANe (sheet script ' + (withSheet ? 'loaded' : 'absent') + '): all other-owned rows are listed');
      assert.equal(await page.locator('[data-ccf-others-row] button').count(), 0, 'not inSANe: no sheet button');
      await page.close();
    }
    { const page = await open({ gm: true, insane: true, withSheet: true }); assert.equal(await page.locator('[data-ccf-others-row]').count(), 3); assert.equal(await page.locator('[data-ccf-others-row] button[aria-label="사이코로픽션 시트"]').count(), 3, 'inSANe: the same rows plus the sheet button'); await page.close(); }
    console.log('others characters PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
