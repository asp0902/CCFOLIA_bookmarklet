// (harness from test-character-sheet-shared) character-sheet 0.5.35: room shared storage. A fake Firestore (in node, shared by every browser context; reading sheetSecrets follows the same rule as firebase/firestore.rules: GM or the sheet's ownerUid)
// is given to the sheet through window.__CCF_HANDOUT_FB__ (what the handout tool exports once the room is consented).
//  - A has the sheet only in localStorage (pasted from the API) -> goes up by itself (migration), secrets in the separate document
//  - B (empty browser) sees skills / curiosity / fear / respec; the secret part stays empty (not owner, not GM)
//  - B edits -> the shared copy (ownerUid reported by B) -> A sees it and keeps its own secret text; the secret document is not overwritten by B's empty value
//  - the GM reads the secret part
//  - rules not deployed (permission-denied): everything stays in the browser, the status line says so
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const store = new Map(); // path -> data
  const pages = []; // { page, uid, gm, subs: Map<collection path, where filter|null> }
  let deny = false;
  const denyError = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const under = (collectionPath) => [...store.entries()].filter(([p]) => p.startsWith(collectionPath + '/') && !p.slice(collectionPath.length + 1).includes('/'));
  const emit = async (changedPath) => {
    const parts = changedPath.split('/'), id = parts.pop(), col = parts.join('/');
    for (const entry of pages) if (entry.subs.has(col)) { const f = entry.subs.get(col), d = store.get(changedPath) ?? null; const shown = d && (!f || d[f.field] === f.value) ? d : null; await entry.page.evaluate(([c, i, d]) => window.__fsEmit(c, i, d), [col, id, shown]).catch(() => {}); }
  };
  const open = async ({ uid, gm = false, seed = null, denied = false, chars = null, ccf = '' }) => {
    const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
    const entry = { page, uid, gm, subs: new Map() }; pages.push(entry);
    await page.exposeFunction('__nget', (p) => {
      const parts = p.split('/'); const col = parts[2];
      if (col === 'sheets' && !gm && store.has(p) && store.get(p).ownerUid !== uid) throw denyError(); // rules 2026-11-18: read = GM or the owner
      if (col === 'sheetSecrets') { const sheet = store.get(`rooms/test/sheets/${parts[3]}`); if (!(gm || (sheet && sheet.ownerUid === uid))) throw denyError(); }
      return store.has(p) ? store.get(p) : null;
    });
    await page.exposeFunction('__nbatch', async (ops) => {
      if (deny || denied) throw denyError();
      // sheets: a member writes with their own ownerUid, the GM anything; secrets follow the sheet's ownerUid after the batch
      const after = new Map(store); for (const [p, d] of ops) after.set(p, d);
      for (const [p, d] of ops) {
        const col = p.split('/')[2];
        if (col === 'sheets' && !(gm || (d.ownerUid === uid && (!store.has(p) || store.get(p).ownerUid === uid)))) throw denyError(); // 2026-11-18 rules: update = GM or the current owner
        if (col === 'sheetSecrets' && !(gm || after.get(`rooms/test/sheets/${p.split('/')[3]}`)?.ownerUid === uid)) throw denyError();
        if (col === 'meta' && !gm) throw denyError(); // meta/{docId}: only the GM writes (existing rule)
      }
      for (const [p, d] of ops) store.set(p, d);
      for (const [p] of ops) await emit(p);
    });
    await page.exposeFunction('__nsub', (col, f) => {
      if (col.endsWith('/sheets') && !gm && !(f && f.field === 'ownerUid' && f.value === uid)) throw denyError(); // a player may not list every sheet
      entry.subs.set(col, f || null); return under(col).filter(([, d]) => !f || d[f.field] === f.value).map(([p, d]) => [p.split('/').pop(), d]);
    });
    await page.addInitScript(({ uid, gm, seed }) => {
      if (seed) localStorage.setItem('ccf-character-sheet:test', JSON.stringify(seed));
      const handlers = new Map();
      window.__fsEmit = (col, id, data) => { const h = handlers.get(col); if (h) h.cb({ docChanges: () => [{ type: data ? 'modified' : 'removed', doc: { id, data: () => data } }] }); };
      let ops;
      const fs = {
        collection: (db, ...p) => ({ path: p.join('/') }), doc: (db, ...p) => ({ path: p.join('/'), id: p[p.length - 1] }),
        query: (ref, w) => ({ path: ref.path, where: w }), where: (field, op, value) => ({ field, value }),
        getDoc: async (ref) => { const d = await window.__nget(ref.path); return { exists: () => d !== null, data: () => d }; },
        writeBatch: () => { ops = []; const b = { set(ref, data) { ops.push([ref.path, data]); return b; }, commit: () => window.__nbatch(ops) }; return b; },
        onSnapshot: (ref, cb, onError) => { handlers.set(ref.path, { cb }); window.__nsub(ref.path, ref.where || null).then((rows) => cb({ docChanges: () => rows.map(([id, data]) => ({ type: 'added', doc: { id, data: () => data } })) }), (e) => onError?.(e)); return () => handlers.delete(ref.path); }
      };
      window.__CCF_HANDOUT_FB__ = { state: () => ({ db: {}, uid, modules: { fs } }), isGm: () => gm, roomKey: () => 'test' };
    }, { uid, gm, seed });
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><span class="MuiTypography-caption">인세인</span><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    // the room's characters (name -> owner uid): a player sees only their own sheets (owner, or the linked character is theirs) - character-sheet 0.5.45
    await page.evaluate((ccf) => { window.__ccf = ccf; window.alert = (m) => { (window.__alerts ||= []).push(m); }; }, ccf);
    if (chars) await page.evaluate((chars) => { const entities = Object.fromEntries(Object.entries(chars).map(([name, owner], i) => ['c' + i, { name, owner }])); const st = { app: { user: { uid: window.__ccf || '' } }, entities: { roomCharacters: { entities } } }; document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => st, subscribe: () => () => {}, dispatch() {} } } } } }; }, chars);
    await page.addScriptTag({ content: source });
    return page;
  };
  const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 12000, polling: 200 });
  const sheetOf = (page) => page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets[0]);
  const SHEET = (id, extra = {}) => ({ id, name: '에르네스토', player: '에르네스토', age: '30', life: 5, lifeMax: 6, sanity: 4, sanityMax: 6, merit: 1, memo: '내용 있음', skills: ['0:0'], curiosity: '1', updatedAt: 1000, ...extra });
  const EMPTY = (id, at) => ({ id, name: '에르네스토', player: '에르네스토', life: 6, lifeMax: 6, sanity: 6, sanityMax: 6, merit: 0, skills: [], removedGaps: [false, false, false, false, false], updatedAt: at });
  const seed = (sheets) => ({ version: 1, selectedId: sheets[0]?.id || '', sheets, permissions: {}, scene: { cycle: 1, number: 0 }, sceneTables: [] });
  const until = (fn, label) => new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => (fn() ? resolve() : Date.now() - t0 > 12000 ? reject(new Error(label)) : setTimeout(poll, 200)); poll(); });
  const reopen = async (page, opts, keepLocal = true) => {
    const local = keepLocal ? await page.evaluate(() => localStorage.getItem('ccf-character-sheet:test')) : null;
    const i = pages.findIndex((e) => e.page === page); pages.splice(i, 1); await page.context().close();
    return open({ ...opts, seed: local ? JSON.parse(local) : opts.seed });
  };
  try {
    // 1) the GM has a sheet linked to the player's character; the player (bookmarklet, member not registered yet) has a blank copy from the duplicates time
    const G = await open({ uid: 'uG', gm: true, ccf: 'cG', chars: { 에르네스토: 'cB' }, seed: seed([EMPTY('blankgm', 2000), SHEET('real'), { ...SHEET('free'), player: '', name: '연결 없음' }, { ...SHEET('lost'), player: '없는캐릭', name: '없는캐릭' }]) });
    // character-sheet 0.5.55: the GM list shows a light per sheet (gray not linked / red character not found / yellow not handed over / green handed over)
    const lights = (page) => page.evaluate(() => { let c = document.getElementById('tab-probe'); if (!c) { c = document.createElement('div'); c.id = 'tab-probe'; c.style.cssText = 'position:relative;width:600px;height:400px'; document.body.append(c); window.__CCF_TOOLKIT_MENU__.items.get('saikoro').mount(c); } return Object.fromEntries([...c.querySelectorAll('[data-tab-open]')].map((b) => { const l = b.parentElement.querySelector('[data-tab-light]'); return [b.dataset.tabOpen, [l?.dataset.tabLight, l?.title]]; })); });
    await until(() => store.has('rooms/test/sheets/real') && store.has('rooms/test/meta/sheetIndex'), 'GM uploads the sheet and the index');
    assert.equal(JSON.parse(store.get('rooms/test/meta/sheetIndex').json)['에르네스토'].id, 'real', 'index: character -> sheet');
    // the GM sees why it is not handed over
    await wait(G, () => /구성원 등록 없음/.test(Object.values(window.__CCF_CHARACTER_SHEET_DEBUG__.shared().issues || {}).join(' ')));
    await until(() => store.has('rooms/test/sheets/lost'), 'all uploaded');
    await G.waitForTimeout(1200);
    let l = await lights(G);
    assert.equal(l.free[0], 'gray', 'not linked: gray ' + JSON.stringify(l)); assert.equal(l.lost[0], 'red', 'character not found: red ' + JSON.stringify(l));
    assert.equal(l.real[0], 'yellow'); assert.match(l.real[1], /구성원 등록 없음/, 'the reason in the tooltip');
    // 2) the player's character button: no new blank sheet while the GM's linked sheet exists, a reason instead
    const B = await open({ uid: 'uB', ccf: 'cB', chars: { 에르네스토: 'cB' } });
    await B.waitForFunction(() => window.__CCF_CHARACTER_SHEET_DEBUG__?.shared().ready, null, { timeout: 12000 });
    await B.waitForTimeout(800);
    await B.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.openForCharacter('에르네스토'));
    await B.waitForTimeout(1500);
    assert.equal(await B.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets.length), 0, 'no blank sheet made');
    assert.match((await B.evaluate(() => window.__alerts || [])).join(' '), /GM이 연결/, 'the player is told why');
    assert.equal([...store.entries()].filter(([k, d]) => k.startsWith('rooms/test/sheets/') && d.ownerUid === 'uB').length, 0, 'nothing new uploaded by the player');
    // 3) the player registers as a member -> the GM hands the sheet over -> the player gets the real one (with content)
    store.set('rooms/test/members/uB', { ccfoliaUid: 'cB' });
    const gOpts = { uid: 'uG', gm: true, ccf: 'cG', chars: { 에르네스토: 'cB' } }, bOpts = { uid: 'uB', ccf: 'cB', chars: { 에르네스토: 'cB' } };
    let G2 = await reopen(G, gOpts); // members are read when the GM page subscribes
    await until(() => store.get('rooms/test/sheets/real')?.ownerUid === 'uB', 'handed over to the player');
    await G2.waitForTimeout(1500);
    l = await lights(G2);
    assert.equal(l.real[0], 'green', 'handed over: green ' + JSON.stringify(l));
    // two sheets of the same character: each row says which one (time, content, handed over)
    const dups = await G2.evaluate(() => [...document.querySelectorAll('#tab-probe [data-tab-dup]')].map((d) => d.textContent));
    assert.equal(dups.length, 2, 'both rows carry the info ' + JSON.stringify(dups)); assert(dups.some((t) => /내용 있음 · 캐릭터 버튼이 여는 시트/.test(t)) && dups.some((t) => /비어 있음/.test(t)), JSON.stringify(dups));
    if (process.env.CAPTURE) await G2.locator('#tab-probe').screenshot({ path: process.env.CAPTURE });
    let B2 = await reopen(B, bOpts);
    await wait(B2, () => window.__CCF_CHARACTER_SHEET_DEBUG__?.data().sheets.some((s) => s.id === 'real' && s.memo === '내용 있음'));
    // 4) the player's browser also has a blank copy of the same character (duplicates time): the character opens the real one, the blank one is hidden (kept)
    await B2.waitForTimeout(1500);
    const withBlank = JSON.parse(await B2.evaluate(() => localStorage.getItem('ccf-character-sheet:test'))); withBlank.sheets.push(EMPTY('blank', Date.now() + 60000));
    let B3 = await reopen(B2, { ...bOpts, seed: withBlank }, false);
    await wait(B3, () => window.__CCF_CHARACTER_SHEET_DEBUG__?.shared().ready);
    await B3.waitForTimeout(1500);
    await B3.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.openForCharacter('에르네스토'));
    await B3.waitForSelector('#ccf-character-sheet-root [data-field="memo"]', { timeout: 6000 });
    assert.equal(await B3.locator('#ccf-character-sheet-root [data-field="memo"]').inputValue(), '내용 있음', 'the real sheet opens, not the blank one');
    assert.equal(store.has('rooms/test/sheets/blank'), false, 'the blank copy is not uploaded over the real one');
    // 5) the GM deletes the sheet; the player's copy has a later clock -> the deletion still wins and nobody brings it back
    await G2.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.deleteSheet('real'));
    await until(() => store.get('rooms/test/sheets/real')?.deleted === true, 'deleted mark');
    await B3.waitForTimeout(2500);
    const skew = JSON.parse(await B3.evaluate(() => localStorage.getItem('ccf-character-sheet:test'))); skew.sheets.forEach((s) => { s.updatedAt = Date.now() + 3600000; }); skew.sheets.push({ ...SHEET('real'), updatedAt: Date.now() + 3600000 }); // a clock one hour ahead, the copy still in the browser
    const B4 = await reopen(B3, { ...bOpts, seed: skew }, false);
    await B4.waitForTimeout(5000);
    assert.equal(store.get('rooms/test/sheets/real')?.deleted, true, 'not brought back by the player');
    assert.equal(await B4.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets.some((s) => s.id === 'real')), false, 'gone from the player too');
    for (const entry of pages) assert.deepEqual(entry.page.__errors, []);
    console.log('character sheet owner flow PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
