// Inbox copies: what a person may read goes into rooms/{room}/inbox/{their uid}/handouts; the secret text only for those who may read it; a copy that stops being allowed is deleted; a player's tool reads its own inbox.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
  const a = source.indexOf('  function permFlag(');
  const b = source.indexOf('  function aggregatePermissionsForPl(');
  const c = source.indexOf('  let inboxActive = false;');
  const d = source.indexOf('  // ===== 폴더 동기화 =====');
  assert(a >= 0 && b > a && c > 0 && d > c, 'code not found');
  // the Firestore stand-in: collections as maps of documents, onSnapshot as a callback holder
  const store = new Map(); const listeners = [];
  const key = parts => parts.join('/');
  const fsApi = {
    doc: (db, ...parts) => ({ path: key(parts), id: parts[parts.length - 1] }),
    collection: (db, ...parts) => ({ prefix: key(parts) }),
    setDoc: async (ref, data) => { if (box.denied) { const error = new Error('denied'); error.code = 'permission-denied'; throw error; } store.set(ref.path, JSON.parse(JSON.stringify(data))); },
    deleteDoc: async ref => { store.delete(ref.path); },
    getDocs: async col => ({ forEach: fn => { for (const [p, v] of store) if (p.startsWith(col.prefix + '/') && !p.slice(col.prefix.length + 1).includes('/')) fn({ id: p.split('/').pop(), data: () => v }); } }),
    serverTimestamp: () => 'TS',
    onSnapshot: (col, ok, bad) => { listeners.push({ col, ok, bad }); return () => {}; }
  };
  const ingested = [], removed = [];
  const box = { ALL_KEY: '*', fbState: { uid: 'gm-anon' }, state: { data: { plList: [{ name: '앨리스', aliases: [], uid: 'acct-a' }, { name: '밥', aliases: [], uid: '' }], handouts: [], folders: [{ id: 'f1', name: '1막' }], myCharacter: 'GM' }, isOpen: false }, denied: false,
    render() {}, registerTeardown() {}, hasPlayerRelay: () => false, noteFirebaseIssue() {}, noteFirebaseOk() {}, readWebShared: () => new Set(), initFirebase: async () => ({ uid: 'gm-anon', db: {}, modules: { fs: fsApi } }), getCurrentRoomKey: () => 'room', saveAll: async () => {}, isAdminMode: () => true,
    normalizePlNameKey: v => String(v || '').replace(/\s+/g, '').toLowerCase(), mergePlListById: l => l, ingestRemoteHandout: (data, type) => ingested.push([data, type]), ingestRemoteRemove: id => removed.push(id),
    readFirebaseAuthUids: async () => [], findCcfoliaStore: () => null, setTimeout: () => 0, clearTimeout() {}, console, Object, Array, Set, Map, String, Number, JSON, Date, Promise };
  vm.createContext(box);
  box.withoutAll = vm.runInContext('(' + source.match(/const withoutAll = (.*);\r?\n/)[1] + ')', box);
  vm.runInContext(`${source.slice(a, b)}\n${source.slice(c, d)}\n;this.api = { inboxCopiesFor, syncInboxes, subscribeToInbox, remoteMembers, inboxActive: () => inboxActive };`, box);
  const api = box.api;
  const handouts = [
    { id: 'h1', title: '지도', description: '공개', gmNotes: '비밀', image: 'img', permissions: { '*': { view: true }, 'acct-a': { view: true, secret: true } }, order: 1, folderId: 'f1' },
    { id: 'h2', title: '밥만', description: '밥의 공개', gmNotes: '밥의 비밀', permissions: { '밥': { view: true, secret: true } }, order: 0 },
    { id: 'h3', title: '비밀만', description: '숨김', gmNotes: '비밀 읽기', permissions: { '밥': { secret: true } }, order: 2 },
    { id: 'h4', title: '아무도', description: 'x', gmNotes: 'y', permissions: {}, order: 3 }
  ];
  box.state.data.handouts = handouts;
  const plList = box.state.data.plList, copy = x => JSON.parse(JSON.stringify(x));
  // what a person gets
  const alice = copy(api.inboxCopiesFor({ ccfoliaUid: 'acct-a', displayName: '다른 이름' }, plList, handouts, box.state.data.folders));
  assert.deepEqual(Object.keys(alice), ['h1'], 'by account: Alice (whatever name she plays under) gets h1 only');
  assert.deepEqual([alice.h1.description, alice.h1.gmNotes, alice.h1.image, alice.h1.folder, JSON.stringify(alice.h1.access)], ['공개', '비밀', 'img', '1막', '{"view":true,"secret":true}']);
  const bob = copy(api.inboxCopiesFor({ ccfoliaUid: 'acct-b', displayName: '밥' }, plList, handouts, box.state.data.folders));
  assert.deepEqual(Object.keys(bob).sort(), ['h2', 'h3'], 'by name: Bob (the old "all players" * permission of h1 is ignored)');
  assert.equal(bob.h2.gmNotes, '밥의 비밀'); assert.equal(bob.h3.description, '', 'secret-only: no public text'); assert.equal(bob.h3.gmNotes, '비밀 읽기');
  assert(!JSON.stringify(bob).includes('permissions') && !JSON.stringify(alice).includes('"permissions"'), 'the copies carry no permission table');
  const stranger = copy(api.inboxCopiesFor({ ccfoliaUid: 'acct-x', displayName: '낯선 사람' }, plList, handouts, []));
  assert.deepEqual(Object.keys(stranger), [], 'a stranger gets nothing');
  // with the relay (a share button) only what the GM has shared is sent at all
  assert.deepEqual(Object.keys(copy(api.inboxCopiesFor({ ccfoliaUid: 'acct-b', displayName: '밥' }, plList, handouts, [], new Set(['h3'])))), ['h3'], 'only the shared one');
  assert.deepEqual(Object.keys(copy(api.inboxCopiesFor({ ccfoliaUid: 'acct-b', displayName: '밥' }, plList, handouts, [], new Set()))), [], 'nothing shared yet: nothing sent');
  // writing: every member except the GM's own account, only what changed, stale copies deleted
  api.remoteMembers.set('gm-anon', { ccfoliaUid: 'acct-gm', displayName: 'GM' }); api.remoteMembers.set('anon-a', { ccfoliaUid: 'acct-a', displayName: '앨리스' }); api.remoteMembers.set('anon-b', { ccfoliaUid: 'acct-b', displayName: '밥' });
  store.set('rooms/room/inbox/anon-b/handouts/old', { id: 'old' }); // left over from a handout that was deleted
  await api.syncInboxes();
  assert.deepEqual([...store.keys()].sort(), ['rooms/room/inbox/anon-a/handouts/h1', 'rooms/room/inbox/anon-b/handouts/h2', 'rooms/room/inbox/anon-b/handouts/h3']);
  assert.equal(store.get('rooms/room/inbox/anon-a/handouts/h1').gmNotes, '비밀');
  // a right taken away deletes the copy; a changed text rewrites that copy
  handouts[1].permissions = {}; handouts[0].description = '바뀐 공개';
  await api.syncInboxes();
  assert.equal(store.has('rooms/room/inbox/anon-b/handouts/h2'), false, 'h2 is no longer for Bob: the copy is gone');
  assert.equal(store.get('rooms/room/inbox/anon-a/handouts/h1').description, '바뀐 공개');
  // rules that refuse the write: nothing breaks, the tool waits
  box.denied = true; handouts[0].description = '또 바뀜'; await api.syncInboxes(); box.denied = false;
  await api.syncInboxes(); assert.equal(store.get('rooms/room/inbox/anon-a/handouts/h1').description, '바뀐 공개', 'paused after a refusal');
  // reading: the player's own inbox
  await api.subscribeToInbox();
  assert.equal(listeners.length, 1); assert.equal(listeners[0].col.prefix, 'rooms/room/inbox/gm-anon/handouts', 'own uid');
  assert.equal(api.inboxActive(), false);
  listeners[0].ok({ docChanges: () => [{ type: 'added', doc: { id: 'h1', data: () => ({ id: 'h1', title: '지도', description: '공개', gmNotes: '', access: { view: true, secret: false } }) } }, { type: 'removed', doc: { id: 'h2', data: () => ({ id: 'h2' }) } }] });
  assert.equal(api.inboxActive(), true);
  assert.deepEqual(copy(ingested[0][0].permissions), { '*': { view: true, secret: false, edit: false } }); assert.equal(ingested[0][0]._viaInbox, true); assert.deepEqual(removed, ['h2']);
  listeners[0].bad({ code: 'permission-denied' }); assert.equal(api.inboxActive(), false, 'an unreadable inbox falls back to the shared originals');
  console.log('handout inbox PASS');
})().catch(error => { console.error(error); process.exit(1); });
