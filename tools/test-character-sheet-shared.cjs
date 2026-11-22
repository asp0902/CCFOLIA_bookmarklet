// character-sheet 0.5.35: room shared storage. A fake Firestore (in node, shared by every browser context; reading sheetSecrets follows the same rule as firebase/firestore.rules: GM or the sheet's ownerUid)
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
  const open = async ({ uid, gm = false, seed = null, denied = false, chars = null }) => {
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
    if (chars) await page.evaluate((chars) => { const entities = Object.fromEntries(Object.entries(chars).map(([name, owner], i) => ['c' + i, { name, owner }])); const st = { entities: { roomCharacters: { entities } } }; document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => st, subscribe: () => () => {}, dispatch() {} } } } } }; }, chars);
    await page.addScriptTag({ content: source });
    return page;
  };
  const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 12000, polling: 200 });
  const sheetOf = (page) => page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets[0]);
  try {
    // a sheet as the paste of the 사이코로픽션 API leaves it: items, abilities, people, madness, profile, extensions and a key this tool does not know
    const original = { id: 's1', name: '에르네스토', player: '시크릿', age: '31', gender: '남', occupation: '청소부', life: 5, lifeMax: 6, sanity: 4, sanityMax: 6, merit: 2, etc: '메모 ETC', curiosity: '1', removedGaps: [false, true, false, false, false], skills: ['0:0', '1:2'], fear: '0:1', modifier: -1, rootLaw: true,
      abilities: [{ id: 'a1', name: '기본공격', type: '공격', target: '격투', cost: '', effect: '1점 데미지', memo: '', extensions: { src: 1 } }], people: [{ id: 'p1', name: '마리아', emotion: '신뢰', shelter: true, detail: '', memo: '거처 메모', extensions: {} }],
      mission: '사명 비밀', secret: '시트 비밀', memo: '', image: 'https://example.test/e.png', profile: { catchphrase: '하하', setting: '설정' }, flashback: '회상',
      items: { 진통제: 1, 무기: 2, 부적: 1, '그물망 발사기': 0, 'B급 기억소거': 1, 기폭장치: 3 }, madnessState: { current: 1, delirium: false }, madness: [{ name: '광기', trigger: '조건', revealed: false, effect: '효과', extensions: {} }],
      extensions: { trpgManagement: { sourceData: { basic: { etc: '메모 ETC' } } } }, unknownKey: { kept: true },
      respec: { newWorld: true, session: false, roleplay: false, gain: false, empathy: 3, mission: false, other: 0 } };
    const A = await open({ uid: 'uA', seed: { version: 1, selectedId: 's1', sheets: [original], permissions: {}, scene: { cycle: 1, number: 0 }, sceneTables: [] } });
    await wait(A, () => true); await A.waitForFunction(() => document.body, null);
    // migration: the browser-only sheet goes up (public part without the secrets; the secrets in their own document)
    await new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => (store.has('rooms/test/sheets/s1') && store.has('rooms/test/sheetSecrets/s1') ? resolve() : Date.now() - t0 > 12000 ? reject(new Error('A did not upload')) : setTimeout(poll, 200)); poll(); });
    const up = store.get('rooms/test/sheets/s1'), upSecret = store.get('rooms/test/sheetSecrets/s1');
    assert.equal(up.ownerUid, 'uA'); assert(!/시트 비밀|사명 비밀/.test(up.json), 'the public document carries no secret text'); assert.match(upSecret.json, /시트 비밀/);
    // 0.5.49 (rules 2026-11-18): a player reads only their own sheets (an ownerUid query) -> B, linked by name only, gets nothing yet
    const B = await open({ uid: 'uB', chars: { 시크릿: 'cB' } });
    await B.waitForTimeout(1500);
    assert.equal(await B.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__?.data().sheets.length), 0, "B does not read A's sheet");
    // the GM hands the sheet to the member whose CCFOLIA character it is linked to (members: toolkit uid uB <-> CCFOLIA uid cB)
    store.set('rooms/test/members/uB', { ccfoliaUid: 'cB', displayName: 'B' });
    const G = await open({ uid: 'uG', gm: true, chars: { 시크릿: 'cB' } });
    await new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => (store.get('rooms/test/sheets/s1')?.ownerUid === 'uB' ? resolve() : Date.now() - t0 > 12000 ? reject(new Error('the GM did not hand the sheet over')) : setTimeout(poll, 200)); poll(); });
    assert.match(store.get('rooms/test/sheetSecrets/s1').json, /시트 비밀/, 'the secret part is kept');
    // B (now the owner) receives it with the secret part
    await wait(B, () => window.__CCF_CHARACTER_SHEET_DEBUG__?.data().sheets.length === 1);
    await wait(B, () => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets[0].secret === '시트 비밀');
    let b = await sheetOf(B);
    assert.deepEqual([b.name, b.skills, b.curiosity, b.fear, b.respec.empathy, b.respec.newWorld], ['에르네스토', ['0:0', '1:2'], '1', '0:1', 3, true], 'B sees skills / curiosity / fear / respec');
    const strip = ({ secret, mission, updatedAt, ...rest }) => rest;
    assert.deepEqual(strip(b), strip(await sheetOf(A)), 'B has every field of A (items, abilities, people, madness, profile, extensions, unknown keys...)');
    assert.deepEqual(b.items, original.items, 'items');
    // B edits the memo: it goes up (B is the owner now)
    await B.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.open());
    await B.waitForSelector('#ccf-character-sheet-root .ccf-cs-sheet-row, #ccf-character-sheet-root [data-field="memo"]', { timeout: 6000 });
    if (await B.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').count()) await B.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').first().click();
    await B.locator('#ccf-character-sheet-root [data-field="memo"]').fill('새 소유자의 메모');
    await new Promise((resolve, reject) => { const t0 = Date.now(); const poll = () => (/새 소유자의 메모/.test(store.get('rooms/test/sheets/s1')?.json || '') ? resolve() : Date.now() - t0 > 12000 ? reject(new Error('B did not push')) : setTimeout(poll, 200)); poll(); });
    assert.equal(store.get('rooms/test/sheets/s1').ownerUid, 'uB');
    assert.match(store.get('rooms/test/sheetSecrets/s1').json, /시트 비밀/, "B's write kept the secret part");
    // the GM reads everything
    await wait(G, () => window.__CCF_CHARACTER_SHEET_DEBUG__?.data().sheets[0]?.memo === '새 소유자의 메모');
    const g = await sheetOf(G); assert.deepEqual(strip(g), strip(await sheetOf(B)), 'the GM has the same sheet'); assert.deepEqual([g.secret, g.mission], ['시트 비밀', '사명 비밀']);
    // A (no longer the owner) does not write it back
    await A.waitForTimeout(1500);
    assert.equal(store.get('rooms/test/sheets/s1').ownerUid, 'uB', 'A does not take it back');
    // 0.5.50 (duplicates bug): after a reload A still has the sheet in its browser but its query no longer returns it -> it must not upload it as "my sheet not shared yet"
    // (the published rules refuse that write and the whole sharing switched off; the unpublished ones let A take the sheet, the owner lost it and made a new one)
    await A.reload(); await A.addScriptTag({ content: source });
    await A.waitForFunction(() => window.__CCF_CHARACTER_SHEET_DEBUG__?.shared().ready || window.__CCF_CHARACTER_SHEET_DEBUG__?.shared().denied, null, { timeout: 12000 }); await A.waitForTimeout(2500);
    assert.equal(store.get('rooms/test/sheets/s1').ownerUid, 'uB', 'A does not take it back after a reload');
    assert.equal((await A.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.shared())).denied, false, 'A keeps sharing');
    // room settings (scene tables / view permissions / scene counter) are the room's: the GM shares them (meta/sheetRoom), everybody receives them, a player cannot write them
    const roomSettings = { permissions: { 시크릿: { view: true, secret: false, edit: true } }, scene: { cycle: 2, number: 3 }, sceneTables: [{ macroName: '/거리', tableName: '거리 장면표', body: '/roll-table\n거리 장면표\n1:a' }], design: { font: 'serif', size: 18, color: '#eeeeee', accent: '#ff5252', bg: 60 } }; // 0.5.43: the sheet design is a room setting too
    await wait(G, () => !!localStorage.getItem('ccf-character-sheet:test'));
    await G.evaluate((r) => { const k = 'ccf-character-sheet:test'; const d = JSON.parse(localStorage.getItem(k)); Object.assign(d, r); localStorage.setItem(k, JSON.stringify(d)); }, roomSettings);
    await G.reload(); await G.addScriptTag({ content: source });
    await wait(B, (r) => { const d = window.__CCF_CHARACTER_SHEET_DEBUG__.data(); return JSON.stringify(d.sceneTables) === JSON.stringify(r.sceneTables) && d.scene.cycle === 2 && d.permissions['시크릿']?.edit === true && d.design?.accent === '#ff5252' && d.design?.bg === 60; }, roomSettings);
    assert.match(store.get('rooms/test/meta/sheetRoom').json, /거리 장면표/);
    // a player with no link to the sheet does not read it at all
    const C = await open({ uid: 'uC', chars: { 다른이: 'cC' } });
    await C.waitForTimeout(1500);
    await C.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.open());
    await C.waitForSelector('#ccf-character-sheet-root .ccf-cs-sheet-panel', { timeout: 6000 });
    assert.equal(await C.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').count(), 0, "a player does not see another player's sheet");
    await G.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.open());
    await G.waitForSelector('#ccf-character-sheet-root .ccf-cs-sheet-row, #ccf-character-sheet-root .ccf-cs-dialog.is-editor', { timeout: 6000 });
    assert(await G.locator('#ccf-character-sheet-root .ccf-cs-sheet-row, #ccf-character-sheet-root .ccf-cs-dialog.is-editor').count() >= 1, 'the GM sees it');
    // rules not deployed: nothing breaks, the sheet stays in the browser, the status line says so
    const D = await open({ uid: 'uD', denied: true, seed: { version: 1, selectedId: 's9', sheets: [{ ...original, id: 's9', name: '로컬만', player: '로컬만' }], permissions: {}, scene: { cycle: 1, number: 0 }, sceneTables: [] } });
    await D.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.open());
    await D.waitForSelector('#ccf-character-sheet-root', { timeout: 6000 });
    if (await D.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').count()) await D.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').first().click();
    await D.locator('#ccf-character-sheet-root [data-field="memo"]').fill('로컬 메모');
    // the status line of the sheet is hidden, so the notice is a line at the top of the sheet body
    await D.waitForFunction(() => window.__CCF_CHARACTER_SHEET_DEBUG__.shared().denied, null, { timeout: 12000 });
    assert.equal(await D.locator('#ccf-character-sheet-root .ccf-cs-share-note').count(), 0, 'no notice in the sheet (0.5.37: the state is only in the debug API)');
    assert.equal((await sheetOf(D)).memo, '로컬 메모'); assert.equal(store.has('rooms/test/sheets/s9'), false);
    assert.equal(await D.evaluate(() => JSON.parse(localStorage.getItem('ccf-character-sheet:test')).sheets[0].memo), '로컬 메모', 'still saved in the browser');
    for (const entry of pages) assert.deepEqual(entry.page.__errors, []);
    console.log('character sheet shared storage PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
