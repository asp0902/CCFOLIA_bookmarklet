// The room's owner takes the GM seat (meta/gm) back when this browser's anonymous account is not the one that holds it: the security rules let only the seat holder read the members and the handout originals.
// Only the owner, only when the seat is someone else's (or missing), one try a minute; the refused subscriptions are made again after it worked; a refusal is kept for the settings line and seat().
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  let lastGmDoc = null, seatClaimAt = 0, seatClaimLog = null;');
const b = source.indexOf('  async function resubscribeAfterSeat()');
const c = source.indexOf('\n  }\n', b) + 5;
assert(a > 0 && b > a && c > b, 'code not found');
const make = ({ isOwner = true, known = true, uid = 'anon2', push = async () => {} } = {}) => {
  const log = [];
  const box = {
    ccfRole: { known, isOwner }, fbState: { uid }, state: { data: { myCharacter: '카피바라' } }, myCcfUid: '', console, Date, Promise, String, JSON, Object,
    resolveMyCcfUid: async () => { box.myCcfUid = 'acct-gm'; return 'acct-gm'; },
    pushGmToFirestore: async (name) => { log.push(['push', name]); return push(name); },
    noteFirebaseIssue: (where, error) => log.push(['issue', where, error?.code]),
    unsubHandouts: () => log.push(['unsub', 'handouts']), unsubMembers: () => log.push(['unsub', 'members']), subscribedRoom: 'r', membersWarned: true, inboxDeniedAt: 5,
    subscribeToRoomHandouts: async () => log.push(['sub', 'handouts']), registerMember: async () => log.push(['register']), subscribeToMembers: async () => log.push(['sub', 'members']),
    scheduleInboxSync: () => log.push(['inbox']), scheduleWebSync: () => log.push(['web'])
  };
  vm.createContext(box);
  vm.runInContext(`${source.slice(a, c)}\n;this.api = { maybeClaimGmSeat, seat: () => ({ lastGmDoc, seatClaimLog }), setSeat: (value) => { lastGmDoc = value; } };`, box);
  return { box, log, api: box.api };
};
const plain = x => JSON.parse(JSON.stringify(x));
(async () => {
  // the owner, the seat is another browser's: claim (the proof document and the seat are pushGmToFirestore's job), then the refused subscriptions again
  let t = make();
  t.api.setSeat({ gmUid: 'old-anon', gmCcfoliaUid: 'acct-gm', gmCharacter: 'GM' });
  await t.api.maybeClaimGmSeat();
  assert.deepEqual(plain(t.log.map(x => x[0] + (x[1] ? ':' + x[1] : ''))), ['push:카피바라', 'unsub:handouts', 'unsub:members', 'sub:handouts', 'register', 'sub:members', 'inbox', 'web']);
  assert.equal(t.log[0][0], 'push'); assert.deepEqual(plain(t.log.map(x => x[0])).filter(n => n === 'sub').length, 2);
  assert.equal(t.api.seat().seatClaimLog.ok, true);
  // one try a minute
  t.log.length = 0; await t.api.maybeClaimGmSeat();
  assert.equal(t.log.length, 0, 'not again within a minute');
  // nothing to do: the seat is ours already; not the owner; role unknown; no seat document read yet
  for (const [label, opts, seat] of [['ours', {}, { gmUid: 'anon2' }], ['not the owner', { isOwner: false }, { gmUid: 'old' }], ['role unknown', { known: false }, { gmUid: 'old' }], ['no document read', {}, null]]) {
    t = make(opts); t.api.setSeat(seat); await t.api.maybeClaimGmSeat();
    assert.equal(t.log.length, 0, label);
  }
  // a missing seat document is created by the owner
  t = make(); t.api.setSeat({ exists: false }); await t.api.maybeClaimGmSeat();
  assert.equal(t.log[0][0], 'push', 'the owner creates the seat');
  // refused (the old seat holds another account uid): kept for the settings line and seat(), nothing subscribed again
  t = make({ push: async () => { const error = new Error('denied'); error.code = 'permission-denied'; throw error; } });
  t.api.setSeat({ gmUid: 'old-anon', gmCcfoliaUid: 'other-acct', gmCharacter: 'GM' });
  await t.api.maybeClaimGmSeat();
  assert.deepEqual(plain(t.log.filter(x => x[0] === 'issue')), [['issue', 'GM 자리 되찾기', 'permission-denied']]);
  assert.equal(t.log.some(x => x[0] === 'sub'), false);
  assert.deepEqual(plain(t.api.seat().seatClaimLog), Object.assign(plain(t.api.seat().seatClaimLog), { ok: false, code: 'permission-denied', seatHadAccountUid: true }));
  // the members subscription is only the GM's (the rules refuse everybody else)
  assert(/if \(ccfRole\.known && !ccfRole\.isOwner\) return;[^\n]*\n\s*const \{ collection, onSnapshot \} = fb\.modules\.fs;\s*\n\s*unsubMembers = onSnapshot\(/.test(source));
  // the status line is the last thing of the settings tab
  assert(/renderSettingsPlList\(\)\}\s*<\/div>\s*<div class="hint" style="margin:14px 0 0;">Firebase: /.test(source));
  console.log('handout gm seat PASS');
})().catch(error => { console.error(error); process.exit(1); });
