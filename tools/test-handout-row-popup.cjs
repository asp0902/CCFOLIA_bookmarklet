// handout 0.1.125: the popup button of a PL row in the permission table sends the same signal as the share button, to that PL only: the account uid and the anonymous uid(s)
// of that PL's members (audienceAnon); the copies are written first; a PL without a saved right gets nothing and the GM is told to save. The real rowPopupSend / sendShowSignal /
// findPlForMember in a vm (the receiving side is checked by test-handout-player-e2e).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert(a > 0 && b > a, 'code not found: ' + from); return source.slice(a, b); };
const code = cut('  function ownedCharacterNames(ccfoliaUid) {', '  // 보내는 쪽(GM): 계정(members)마다') + cut('  async function sendShowSignal(handoutId, audience) {', '  async function subscribeToRoomShows() {') + cut('  function rowPopupSend(handoutId, audienceKey) {', '  // ===== JSON 내보내기');
const sent = [], toasts = [], order = [];
const ALL_KEY = '__all__';
const removeSpaces = (v) => String(v || '').replace(/\s+/g, '');
const box = {
  ALL_KEY, removeSpaces, normalizePlNameKey: (v) => removeSpaces(v).toLowerCase(),
  state: { data: { myCharacter: 'GM', plList: [{ name: '눈깅', aliases: [], uid: 'acct-n' }, { name: '앨리스', aliases: [], uid: 'acct-a' }, { name: '밥', aliases: [], uid: '' }] } },
  mergePlListById: (l) => l, findCcfoliaStore: () => null,
  remoteMembers: new Map([['anon-gm', { ccfoliaUid: 'acct-gm', displayName: 'GM' }], ['anon-n', { ccfoliaUid: 'acct-n', displayName: '눈깅이 열심히' }], ['anon-a', { ccfoliaUid: 'acct-a', displayName: '앨리스' }], ['anon-b', { ccfoliaUid: 'acct-b', displayName: '밥' }]]),
  withoutAll: (h) => h,
  canView: (h, name, extra) => [name, ...extra].some((k) => h.permissions?.[k]?.view), canViewSecret: (h, name, extra) => [name, ...extra].some((k) => h.permissions?.[k]?.secret),
  findHandout: (id) => ({ id, title: '바깥 상황', permissions: { 눈깅: { view: true }, 앨리스: { view: true } } }),
  markWebShared: (id) => order.push('shared:' + id), syncInboxes: async () => { order.push('inbox'); }, inboxTimer: 0, clearTimeout() {},
  initFirebase: async () => ({ uid: 'anon-gm', db: {}, modules: { fs: { collection: (db, ...p) => p.join('/'), serverTimestamp: () => 'TS', addDoc: async (col, data) => { order.push('signal'); sent.push(data); return { id: 's' + sent.length }; } } } }),
  getCurrentRoomKey: () => 'R1', toast: (t) => toasts.push(t), noteFirebaseIssue() {}, showHandoutModal() { order.push('local'); }, console: { info() {}, error() {}, warn() {} },
  Array, Set, Map, String, Promise, Object
};
vm.createContext(box);
vm.runInContext(`${code}\n;this.api = { rowPopupSend };`, box);
(async () => {
  box.api.rowPopupSend('h1', '눈깅');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 1, 'one signal');
  assert.equal(sent[0].audience, 'acct-n', 'by the account uid');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].audienceAnon)), ['anon-n'], 'only that PL\'s member');
  assert.deepEqual(order, ['shared:h1', 'inbox', 'signal'], 'the copy is written before the signal');
  // a PL without a saved right: nothing sent, told to save
  box.api.rowPopupSend('h1', '밥');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.length, 1, 'nothing for a PL without a saved right');
  assert.match(toasts.at(-1), /저장된 권한이 없습니다/);
  console.log('handout row popup PASS');
})().catch((e) => { console.error(e); process.exit(1); });
