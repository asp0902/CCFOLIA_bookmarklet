// Handout permissions by CCFOLIA account: the same person keeps their rights in another browser (account uid key), name keys still work, PL entries link to accounts only when the name fits exactly one account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  function permFlag(');
const b = source.indexOf('  function aggregatePermissionsForPl(');
assert(a >= 0 && b > a && source.slice(a, b).includes('resolveMyCcfUid'), 'code not found');
const code = source.slice(a, b);
const saved = [];
const context = {
  ALL_KEY: '*', fbState: { uid: 'anon-1' }, state: { data: { plList: [] }, isOpen: false }, render() {}, registerTeardown() {}, initFirebase: async () => null, getCurrentRoomKey: () => 'room',
  saveAll: async data => { saved.push(JSON.parse(JSON.stringify(data.plList))); }, normalizePlNameKey: v => String(v || '').replace(/\s+/g, '').toLowerCase(), isAdminMode: () => true, console, Object, Array, Set, Map, String, Number, JSON,
  readFirebaseAuthUids: async () => ['anon-1', 'acct-1'],
  findCcfoliaStore: () => ({ getState: () => ({ entities: { roomMembers: { entities: { m1: { _id: 'acct-1', displayName: '알리스' }, m2: { _id: 'acct-2', displayName: '밥' } } } } }) })
};
vm.createContext(context);
vm.runInContext(`${code}\n;this.api = { permFor, canView, canViewSecret, canEdit, resolveMyCcfUid, myCcfDisplayName, withAccountKeys, linkPlsToMembers, remoteMembers, identityKeys, setUid: v => { myCcfUid = v; } };`, context);
(async () => {
const api = context.api;
const handout = { permissions: { 'acct-1': { view: true, secret: true, edit: false }, '밥': { view: true, secret: false, edit: false } } };
// the account key grants the same person rights whatever name they play under; name keys keep working; "*" stays for everyone
assert.equal(api.canView(handout, '아무개', ['acct-1']), true);
assert.equal(api.canViewSecret(handout, '아무개', ['acct-1']), true);
assert.equal(api.canViewSecret(handout, '아무개', ['acct-2']), false);
assert.equal(api.canView(handout, '밥', []), true); assert.equal(api.canViewSecret(handout, '밥', []), false);
assert.equal(api.canEdit(handout, '밥', ['acct-1']), false);
assert.equal(api.canView({ permissions: { '*': { view: true } } }, '', []), true);
assert.equal(api.canView(null, '밥', ['acct-1']), false);
// my account: the CCFOLIA login that is a member of this room, never the extension's own anonymous account
assert.equal(await api.resolveMyCcfUid(), 'acct-1'); assert.equal(api.myCcfDisplayName(), '알리스'); assert.deepEqual(Array.from(api.identityKeys()), ['acct-1']);
context.readFirebaseAuthUids = async () => ['anon-1', 'acct-x', 'acct-y'];
assert.equal(await api.resolveMyCcfUid(), '', 'two candidates and none a member: no guess');
context.readFirebaseAuthUids = async () => ['anon-1', 'acct-x'];
assert.equal(await api.resolveMyCcfUid(), 'acct-x', 'a single candidate is taken');
// PL entries link to an account only when exactly one account fits their name (or a merged name)
context.state.data.plList = [{ name: '알리스', aliases: [], uid: '' }, { name: '밥 2', aliases: ['밥'], uid: '' }, { name: '찰리', aliases: [], uid: '' }, { name: '이미연결', aliases: [], uid: 'keep' }];
api.remoteMembers.set('a1', { ccfoliaUid: 'acct-1', displayName: '알리스' }); api.remoteMembers.set('a2', { ccfoliaUid: 'acct-2', displayName: '밥' });
api.remoteMembers.set('a3', { ccfoliaUid: 'acct-3', displayName: '찰리' }); api.remoteMembers.set('a4', { ccfoliaUid: 'acct-4', displayName: '찰리' });
assert.equal(api.linkPlsToMembers(), true);
assert.deepEqual(context.state.data.plList.map(p => p.uid), ['acct-1', 'acct-2', '', 'keep'], 'two accounts called 찰리: not linked');
assert.equal(saved.length, 1);
// saved permissions get the account key next to the name key (old clients keep reading the name key)
const withAccounts = api.withAccountKeys({ '*': { view: false, secret: false, edit: false }, '알리스': { view: true, secret: true, edit: false }, '찰리': { view: true, secret: false, edit: false } });
assert.deepEqual(Object.keys(withAccounts).sort(), ['*', 'acct-1', '알리스', '찰리'].sort());
assert.deepEqual(JSON.parse(JSON.stringify(withAccounts['acct-1'])), { view: true, secret: true, edit: false });
console.log('handout account ids PASS');
})().catch(error => { console.error(error); process.exit(1); });
