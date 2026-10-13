// The handout tool's share button: only the people who may read the handout get it (the participants' lists are synced, then a popup signal goes to those who hold it; native players get show signals for
// the same people, everybody for "all players"), no link prompt, the card buttons sit closer; participants approved in the play room are added to the PL list (marked 플레이룸), once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  const sleep = (ms)');
const b = source.indexOf('  function markWebShared(');
assert(a > 0 && b > a, 'code not found');
const calls = [], toasts = [], saved = [];
const state = { data: { myCharacter: '카피바라', plList: [{ name: '앨리스', aliases: ['Alice'], uid: 'acct-a' }, { name: '철수', aliases: [], uid: '' }], plDeleted: { '지운사람': true }, handouts: [] }, isOpen: false };
const box = {
  ALL_KEY: '*', state, console, Object, Array, Set, Map, String, Number, JSON, Date, Promise,
  removeSpaces: v => String(v || '').replace(/\s+/g, ''), normalizePlNameKey: v => String(v || '').replace(/\s+/g, '').toLowerCase(),
  markWebShared: (id, on) => calls.push(['mark', id, on]), webSyncTimer: 0, webSyncBusy: false, clearTimeout() {}, setTimeout: (fn) => 0, setInterval: () => 0, clearInterval() {},
  syncPublicHandouts: async () => calls.push(['sync']), scheduleWebSync: ms => calls.push(['schedule', ms]),
  relayCall: async (action, payload) => { calls.push(['relay', action, payload]); return action === 'popup' ? { count: box.popupCount } : { participants: box.participants }; },
  sendShowSignal: async (id, audience) => calls.push(['show', id, audience]), toast: text => toasts.push(text), saveAll: async () => saved.push(1), render() {},
  hasPlayerRelay: () => true, isAdminMode: () => true, registerTeardown() {}, prompt() { throw new Error('the read-only link prompt must not come up'); },
  popupCount: 1, participants: []
};
vm.createContext(box);
vm.runInContext(`${source.slice(a, b)}\n;this.api = { showAudienceKeys, shareHandoutNow, syncPlayroomMembers };`, box);
const { showAudienceKeys, shareHandoutNow, syncPlayroomMembers } = box.api;
const plain = x => JSON.parse(JSON.stringify(x));
(async () => {
  // who is addressed: by the permission table, the GM's own row and a person's account key (it comes with their name key) left out, nobody without a right
  assert.deepEqual(plain(showAudienceKeys({ permissions: { '*': { view: true } } })), ['*']);
  assert.deepEqual(plain(showAudienceKeys({ permissions: { '앨리스': { view: true }, 'acct-a': { view: true, secret: true }, '철수': { view: false, secret: false }, '카피바라': { view: true }, '밥': { view: false, secret: true }, 'acct-orphan': { view: true } } })), ['앨리스', '밥', 'acct-orphan']);
  assert.deepEqual(plain(showAudienceKeys({ permissions: {} })), []);
  // the share: list first (the tool syncs and waits), then the popup signal to the holders, show signals to the native players, one short toast
  calls.length = 0; toasts.length = 0;
  await shareHandoutNow({ id: 'h1', permissions: { '앨리스': { view: true } } });
  assert.deepEqual(plain(calls), [['mark', 'h1', true], ['sync'], ['relay', 'popup', { handoutId: 'h1' }], ['show', 'h1', '앨리스']]);
  assert.deepEqual(toasts, ['공유했습니다.']);
  calls.length = 0;
  await shareHandoutNow({ id: 'h2', permissions: { '*': { view: true } } });
  assert.deepEqual(plain(calls.filter(c => c[0] === 'show')), [['show', 'h2', 'all']], 'everybody for "all players"');
  // nobody can read it: the lists are synced, nothing is sent to anybody, and it says so
  calls.length = 0; toasts.length = 0; box.popupCount = 0;
  await shareHandoutNow({ id: 'h3', permissions: {} });
  assert.deepEqual(plain(calls.filter(c => c[0] === 'show')), []);
  assert.match(toasts[0], /볼 수 있는 사람이 없습니다/);
  // the source: no read-only link prompt, the card buttons closer together, the room-wide share is not used by the button
  assert(!/prompt\("참여자에게 전달할 읽기 전용 링크/.test(source), 'no prompt with the link');
  assert(/\.card \.head \.card-icon-btn \+ \.card-icon-btn \{ margin-left: -6px; \}/.test(source));
  assert(!/requestPublicRelay\("share"/.test(source), 'the share button does not send the room-wide handout any more');
  // PL list: the approved participants of the play room, once, not the waiting, not the ones already known by name or alias, not the deleted
  box.participants = [{ id: 'p1', displayName: '새 사람', status: 'approved' }, { id: 'p2', displayName: '대기', status: 'pending' }, { id: 'p3', displayName: 'alice', status: 'approved' }, { id: 'p4', displayName: '지운 사람', status: 'approved' }, { id: 'p5', displayName: '취소됨', status: 'revoked' }];
  assert.equal(await syncPlayroomMembers(), 1);
  assert.deepEqual(plain(state.data.plList.slice(2)), [{ name: '새 사람', id: '', role: 'player', aliases: [], image: '', uid: '', source: 'playroom', playroomId: 'p1' }]);
  assert.equal(saved.length, 1);
  assert.equal(await syncPlayroomMembers(), 0, 'not added twice');
  assert.equal(state.data.plList.length, 3);
  console.log('handout share ux PASS');
})().catch(error => { console.error(error); process.exit(1); });
