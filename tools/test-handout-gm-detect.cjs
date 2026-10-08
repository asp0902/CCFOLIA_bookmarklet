// Handout: GM is the CCFOLIA room owner (owner uid among the signed-in accounts), sync connects by itself in rooms that were agreed to.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const cut = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert(a >= 0 && b > a, `${from} not found`); return source.slice(a, b); };

// 1) role from owner + uids, and its precedence in isAdminMode
const roleCode = cut('  let ccfRole = {', '  function findCcfoliaStore()') + cut('  function isAdminCharacter(', '  function canManageHandout(');
const sandbox = {
  state: { data: { myCharacter: 'GM' } }, removeSpaces: s => String(s).replace(/\s+/g, ''), getVisibleCharacterName: () => '투 인 파크',
  remoteGmInfo: null, fbState: null, document: { querySelectorAll: () => [] }
};
vm.runInNewContext(`${roleCode}; this.computeCcfRole = computeCcfRole; this.isAdminMode = isAdminMode; this.setRole = r => { ccfRole = r; };`, sandbox);
const role = (room, uids) => JSON.parse(JSON.stringify(sandbox.computeCcfRole(room, uids)));
assert.deepEqual(role({ owner: 'me' }, ['ext-anon', 'me']), { known: true, isOwner: true, reason: '' }, 'owner among several signed-in records (the extension keeps an anonymous one too)');
assert.equal(role({ owner: 'other' }, ['ext-anon', 'me']).isOwner, false);
assert.equal(role({ owner: 'other' }, ['me']).known, true);
assert.equal(role(null, ['me']).known, false, 'no room in the store -> unknown');
assert.equal(role({ owner: 'me' }, []).known, false, 'no login records -> unknown');
// the speaking character ("투 인 파크") does not match the saved "GM", yet the owner is admin
sandbox.setRole(role({ owner: 'me' }, ['me']));
assert.equal(sandbox.isAdminMode(), true, 'owner is admin whatever character is speaking');
sandbox.setRole(role({ owner: 'other' }, ['me']));
assert.equal(sandbox.isAdminMode(), false, 'a known non-owner is a player even if the name matches');
sandbox.state.data.myCharacter = '투 인 파크';
assert.equal(sandbox.isAdminMode(), false, 'name match does not make a known player an admin');
sandbox.setRole(role(null, []));
assert.equal(sandbox.isAdminMode(), true, 'unknown role falls back to the old name comparison');

// 2) auto connect in a room that was agreed to
const syncCode = cut('  let syncInfo =', '  function maybeShowGreeting()');
const calls = [];
const sync = (greeted, room = 'R1') => {
  calls.length = 0;
  const box = { getCurrentRoomKey: () => room, isGreeted: () => greeted, fbState: null, console, refreshCcfoliaRole: () => calls.push('role'),
    initFirebase: async () => { calls.push('init'); return { uid: 'u' }; }, subscribeToRoomHandouts: async () => calls.push('handouts'), subscribeToRoomShows: async () => calls.push('shows'), subscribeToRoomGm: async () => calls.push('gm') };
  vm.runInNewContext(`${syncCode}; this.autoConnectSync = autoConnectSync; this.info = () => syncInfo;`, box);
  return box;
};
(async () => {
  let box = sync(true); await box.autoConnectSync();
  assert.deepEqual(calls, ['role', 'init', 'handouts', 'shows', 'gm'], 'greeted room: connects and subscribes without the popup');
  assert.equal(box.info().reason, '');
  box = sync(false); await box.autoConnectSync();
  assert.deepEqual(calls, [], 'not agreed: nothing is started');
  assert.match(box.info().reason, /인사 팝업/);
  box = sync(true, 'global'); await box.autoConnectSync();
  assert.deepEqual(calls, [], 'outside a room: nothing');
  console.log('handout gm detect PASS');
})().catch(error => { console.error(error); process.exit(1); });
