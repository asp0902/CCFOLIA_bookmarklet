// handout 0.1.122: a player's handout popup. The GM signals a linked PL by its account uid; the player's tool never reads the originals (GM-only) and shows its inbox copy;
// a signal that arrives before the copy waits (3 minutes) and shows the moment the copy comes in. The real ingestShowSignal / showPendingFor in a vm.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  const pendingShows = new Map();'), b = source.indexOf('  function showHandoutModal(handout, fromName');
assert(a > 0 && b > a, 'code not found');
const shown = [], originalReads = [];
const box = {
  state: { data: { myCharacter: '에르네스토', handouts: [] } }, myCcfUid: 'acct-n', fbState: { uid: 'anon-p' }, seenShowIds: new Set(),
  removeSpaces: (v) => String(v || '').replace(/\s+/g, ''), isAdminMode: () => false,
  findHandout: (id) => box.state.data.handouts.find((h) => h.id === id), showHandoutModal: (h, from) => shown.push([h.id, from]),
  refreshRemoteHandoutFromFirestore: async (id) => { originalReads.push(id); return null; },
  console: { info() {}, warn() {} }, Date, Map, Set, String, setTimeout
};
vm.createContext(box);
vm.runInContext(`${source.slice(a, b)}\n;this.api = { ingestShowSignal, showPendingFor, pendingShows };`, box);
const { ingestShowSignal, showPendingFor, pendingShows } = box.api;
// the copy is already here: the signal for my account shows it at once
box.state.data.handouts.push({ id: 'h1', title: '바깥 상황' });
ingestShowSignal('s1', { handoutId: 'h1', audience: 'acct-n', atName: 'GM', atUid: 'anon-gm' });
assert.deepEqual(shown, [['h1', 'GM']], 'shown from the inbox copy');
// the signal first, the copy afterwards: shown when the copy arrives
ingestShowSignal('s2', { handoutId: 'h2', audience: 'acct-n', atName: 'GM', atUid: 'anon-gm' });
assert.equal(shown.length, 1, 'not yet: the copy has not arrived'); assert.equal(pendingShows.size, 1);
box.state.data.handouts.push({ id: 'h2', title: '두 번째' }); showPendingFor('h2');
assert.deepEqual(shown[1], ['h2', 'GM'], 'shown when the copy came in'); assert.equal(pendingShows.size, 0);
// a signal for somebody else is skipped
ingestShowSignal('s3', { handoutId: 'h1', audience: 'acct-other', atName: 'GM', atUid: 'anon-gm' });
assert.equal(shown.length, 2, 'not for me');
// a waiting signal that expired is dropped
ingestShowSignal('s4', { handoutId: 'h9', audience: 'acct-n', atName: 'GM', atUid: 'anon-gm' });
pendingShows.get('h9').until = Date.now() - 1; box.state.data.handouts.push({ id: 'h9' }); showPendingFor('h9');
assert.equal(shown.length, 2, 'expired: not shown');
assert.deepEqual(originalReads, [], 'the player never reads an original');
// the source: the player's refused subscription of the originals is not reported as a problem; the GM's audience is the account uid
assert.match(source, /if \(error\?\.code === "permission-denied" && !isAdminMode\(\)\) \{ console\.info/);
assert.match(source, /\.map\(\(\[key\]\) => uidOfName\.get\(key\) \|\| key\)/);
console.log('handout player popup PASS');
