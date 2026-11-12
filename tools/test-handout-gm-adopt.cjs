// The GM's local list includes every original in the room (also one made under an old anonymous uid, or without the GM's name in its permission table), with its permission table and secret text;
// a player still only gets what the permission table lets them see (no permission: skipped and removed).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  function ingestRemoteHandout(data, changeType) {');
const b = source.indexOf('  // ===== 수신자별 사본(inbox) =====');
assert(a >= 0 && b > a, 'function not found');
const make = (gm) => {
  const box = { fbState: { uid: 'me-new' }, inboxActive: false, state: { data: { myCharacter: '-', handouts: [] }, isOpen: false }, isAdminMode: () => gm, identityKeys: () => [], getNextOrder: () => 1, toast() {}, saveAll: async () => {}, ingestRemoteRemove(id) { box.removed.push(id); }, removed: [], console, Date, Number, canView: (d, me) => !!d.permissions?.[me]?.view, canViewSecret: (d, me) => !!d.permissions?.[me]?.secret, findHandout: () => null, render() {} };
  vm.createContext(box);
  vm.runInContext(`${source.slice(a, b)}\n;this.ingest = ingestRemoteHandout;`, box);
  return box;
};
const orphan = { id: 'o1', title: '옛 uid 로 만든 것', description: '공개', gmNotes: '비밀', permissions: { 하나: { view: true, secret: true } }, ownerUid: 'old-anon-uid', folderId: 'f1', order: 3 };
const gm = make(true); gm.ingest(orphan, 'added');
assert.equal(gm.state.data.handouts.length, 1, 'the GM sees the orphan');
const h = JSON.parse(JSON.stringify(gm.state.data.handouts[0]));
assert.deepEqual([h.id, h.gmNotes, h.permissions, h._remote, h.folderId, h.ownerUid], ['o1', '비밀', { 하나: { view: true, secret: true } }, false, 'f1', 'old-anon-uid'], 'secret text and permission table kept, treated as the GM\'s own to manage');
const pl = make(false); pl.ingest(orphan, 'added');
assert.equal(pl.state.data.handouts.length, 0, 'a player without permission gets nothing'); assert.deepEqual(pl.removed, ['o1']);
const pl2 = make(false); pl2.state.data.myCharacter = '하나'; pl2.ingest({ ...orphan, permissions: { 하나: { view: true } } }, 'added');
assert.deepEqual([pl2.state.data.handouts.length, pl2.state.data.handouts[0].gmNotes, pl2.state.data.handouts[0]._remote], [1, '', true], 'a player with view only: no secret text, remote copy');
console.log('handout gm adopt PASS');
