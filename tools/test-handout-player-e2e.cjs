// handout 0.1.124, the whole script as the bookmarklet / loader runs it, as a PLAYER whose tool cannot read its CCFOLIA account (no login record: the bookmarklet case),
// against a stand-in Firebase (the gstatic SDK modules are routed to a small in-page fake):
// - the originals (rooms/{room}/handouts) are never read: no onSnapshot / getDoc / getDocs on them
// - a show signal that existed before connecting does not pop up; a new one for this player (named by its anonymous uid) pops the inbox copy once
// - a signal before the copy: pops when the copy arrives; sharing the same handout again pops it again (one window, not a pile)
// - the GM turns the secret right on (the copy is modified): the open window shows the secret body; off: it disappears
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
const FAKE_APP = `export const getApps = () => []; export const initializeApp = () => ({});`;
const FAKE_AUTH = `export const getAuth = () => ({}); export const signInAnonymously = async () => ({ user: { uid: globalThis.__fake.anon } });`;
const FAKE_FS = `
const F = globalThis.__fake;
const join = (parts) => parts.join('/');
const parent = (p) => p.split('/').slice(0, -1).join('/');
const snapDoc = (p) => ({ id: p.split('/').pop(), exists: () => F.docs.has(p), data: () => (F.docs.has(p) ? JSON.parse(JSON.stringify(F.docs.get(p))) : undefined), ref: { path: p } });
export const getFirestore = () => ({});
export const doc = (db, ...parts) => ({ kind: 'doc', path: join(parts) });
export const collection = (db, ...parts) => ({ kind: 'col', path: join(parts) });
export const serverTimestamp = () => ({ ts: Date.now() });
export async function getDoc(ref) { F.calls.push(['getDoc', ref.path]); return snapDoc(ref.path); }
export async function getDocs(col) { F.calls.push(['getDocs', col.path]); const docs = [...F.docs.keys()].filter((p) => parent(p) === col.path).map(snapDoc); return { docs, size: docs.length, forEach: (fn) => docs.forEach(fn) }; }
export function onSnapshot(ref, ok, bad) {
  F.calls.push(['onSnapshot', ref.path]);
  const l = { ref, ok, bad }; F.listeners.push(l);
  setTimeout(() => {
    if (ref.kind === 'doc') ok(snapDoc(ref.path));
    else { const docs = [...F.docs.keys()].filter((p) => parent(p) === ref.path).map(snapDoc); ok({ docs, size: docs.length, forEach: (fn) => docs.forEach(fn), docChanges: () => docs.map((d) => ({ type: 'added', doc: d })) }); }
  }, 0);
  return () => { F.listeners = F.listeners.filter((x) => x !== l); };
}
F.emit = (p, type) => {
  for (const l of F.listeners) {
    if (l.ref.kind === 'doc' && l.ref.path === p) l.ok(snapDoc(p));
    if (l.ref.kind === 'col' && l.ref.path === parent(p)) { const d = type === 'removed' ? { id: p.split('/').pop(), exists: () => false, data: () => F.removedData } : snapDoc(p); l.ok({ docs: [], size: 0, forEach() {}, docChanges: () => [{ type, doc: d }] }); }
  }
};
F.put = (p, data) => { const type = F.docs.has(p) ? 'modified' : 'added'; F.docs.set(p, data); F.emit(p, type); };
F.del = (p) => { F.removedData = F.docs.get(p); F.docs.delete(p); F.emit(p, 'removed'); };
export async function setDoc(ref, data) { F.calls.push(['setDoc', ref.path]); F.put(ref.path, JSON.parse(JSON.stringify(data))); }
export async function deleteDoc(ref) { F.calls.push(['deleteDoc', ref.path]); F.del(ref.path); }
export async function addDoc(col, data) { const id = 'auto' + (++F.seq); F.calls.push(['addDoc', col.path]); F.put(col.path + '/' + id, JSON.parse(JSON.stringify(data))); return { id, path: col.path + '/' + id }; }
`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body><div id="root"></div></body>' }));
    await page.route('https://www.gstatic.com/firebasejs/**', (r) => {
      const url = r.request().url();
      const body = url.endsWith('firebase-app.js') ? FAKE_APP : url.endsWith('firebase-auth.js') ? FAKE_AUTH : FAKE_FS;
      r.fulfill({ contentType: 'application/javascript; charset=utf-8', body, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('https://ccfolia.com/rooms/R1');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted:R1', '1');
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const F = globalThis.__fake = { anon: 'anon-p', docs: new Map(), listeners: [], calls: [], seq: 0 };
      F.docs.set('rooms/R1/meta/gm', { gmUid: 'anon-gm', gmCharacter: 'GM' });
      // already in Firestore before this player connects: a copy and an old show signal for it (must not pop up after a reload)
      F.docs.set('rooms/R1/inbox/anon-p/handouts/h1', { id: 'h1', title: '바깥 상황', description: '공개 본문', gmNotes: '', image: '', access: { view: true, secret: false } });
      F.docs.set('rooms/R1/shows/old', { handoutId: 'h1', audience: 'acct-n', audienceAnon: ['anon-p'], atUid: 'anon-gm', atName: 'GM' });
      const value = { myCharacter: '', handouts: [], folders: [], plList: [] };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => ({ entities: { roomCharacters: { entities: {} }, rooms: { entities: { R1: { owner: 'acct-gm' } } }, roomMembers: { entities: {} } } }), dispatch() {}, subscribe: () => () => {} } } } } };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(2500);
    const shows = () => page.evaluate(() => [...document.querySelectorAll('[data-ccf-handout-show="1"]')].map((h) => ({ id: h.dataset.handoutId, mark: h.dataset.mark || '', secret: !!h.shadowRoot.querySelector('.secret-block'), text: h.shadowRoot.querySelector('.show-body')?.textContent.replace(/\s+/g, ' ').trim() })));
    const diag = await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.receiveDiag());
    assert.equal(diag.inboxSubscribed, true, 'the inbox is read: ' + JSON.stringify(diag));
    assert.equal(diag.gm, false);
    assert.deepEqual(await shows(), [], 'the old signal does not pop up');
    // a new share for this player
    const signal = (id) => page.evaluate((id) => globalThis.__fake.put('rooms/R1/shows/s' + (++globalThis.__fake.seq), { handoutId: id, audience: 'acct-n', audienceAnon: ['anon-p'], atUid: 'anon-gm', atName: 'GM' }), id);
    await signal('h1'); await page.waitForTimeout(200);
    let w = await shows();
    assert.equal(w.length, 1, 'popped once: ' + JSON.stringify(w)); assert.equal(w[0].id, 'h1'); assert.match(w[0].text, /공개 본문/);
    // a signal for someone else does nothing
    await page.evaluate(() => globalThis.__fake.put('rooms/R1/shows/x1', { handoutId: 'h1', audience: 'acct-other', audienceAnon: ['anon-other'], atUid: 'anon-gm', atName: 'GM' }));
    await page.evaluate(() => document.querySelector('[data-ccf-handout-show="1"]').dataset.mark = 'first');
    await page.waitForTimeout(150);
    assert.equal((await shows())[0].mark, 'first', 'not for me: untouched');
    // shared again: pops again (a new window replaces the open one)
    await signal('h1'); await page.waitForTimeout(200);
    w = await shows();
    assert.deepEqual(w.map((x) => [x.id, x.mark]), [['h1', '']], 'popped again, one window: ' + JSON.stringify(w));
    // the signal first, the copy afterwards
    await signal('h2'); await page.waitForTimeout(200);
    assert.equal((await shows()).length, 1, 'h2 waits for its copy');
    await page.evaluate(() => globalThis.__fake.put('rooms/R1/inbox/anon-p/handouts/h2', { id: 'h2', title: '두 번째', description: '둘째 본문', gmNotes: '', image: '', access: { view: true, secret: false } }));
    await page.waitForTimeout(200);
    w = await shows();
    assert.deepEqual(w.map((x) => x.id).sort(), ['h1', 'h2'], 'h2 popped when its copy came: ' + JSON.stringify(w));
    // the GM turns the secret right on for h1 and saves: the copy is modified -> the open window shows it; off -> gone
    await page.evaluate(() => globalThis.__fake.put('rooms/R1/inbox/anon-p/handouts/h1', { id: 'h1', title: '바깥 상황', description: '공개 본문', gmNotes: '비밀 본문', image: '', access: { view: true, secret: true } }));
    await page.waitForTimeout(200);
    let h1 = (await shows()).find((x) => x.id === 'h1');
    assert.equal(h1.secret, true, 'secret appears: ' + JSON.stringify(h1)); assert.match(h1.text, /비밀 본문/);
    await page.evaluate(() => globalThis.__fake.put('rooms/R1/inbox/anon-p/handouts/h1', { id: 'h1', title: '바깥 상황', description: '공개 본문', gmNotes: '', image: '', access: { view: true, secret: false } }));
    await page.waitForTimeout(200);
    h1 = (await shows()).find((x) => x.id === 'h1');
    assert.equal(h1.secret, false, 'secret gone');
    // the originals were never asked for
    const calls = await page.evaluate(() => globalThis.__fake.calls);
    const originals = calls.filter(([, p]) => /^rooms\/R1\/handouts(\/|$)/.test(p));
    assert.deepEqual(originals, [], 'no read of the originals: ' + JSON.stringify(originals));
    const d2 = await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.receiveDiag());
    assert.equal(d2.issue, null, 'no refused read noted: ' + JSON.stringify(d2.issue));
    assert.equal(d2.originalsSubscribed, false);
    assert.deepEqual(errors, []);
    console.log('handout player e2e PASS', JSON.stringify({ lastShow: d2.lastShow, copies: d2.copies.length }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
