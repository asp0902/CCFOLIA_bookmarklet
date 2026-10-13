// The handouts a participant gets: only the ones put on the web, only what their permissions allow (public body to those who may view, the secret body to those who may read it), recipients by the GM's choice or by name.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  function permFlag(');
const b = source.indexOf('  function aggregatePermissionsForPl(');
const c = source.indexOf('  function recipientFor(');
const d = source.indexOf('  const handoutImageHtml');
assert(a >= 0 && b > a && c > 0 && d > c, 'code not found');
const box = { ALL_KEY: '*', fbState: { uid: 'anon' }, state: { data: { plList: [] } }, render() {}, registerTeardown() {}, initFirebase: async () => null, getCurrentRoomKey: () => 'r', saveAll: async () => {}, isAdminMode: () => true,
  normalizePlNameKey: v => String(v || '').replace(/\s+/g, '').toLowerCase(), readFirebaseAuthUids: async () => [], findCcfoliaStore: () => null, console, Object, Array, Set, Map, String, Number, JSON };
vm.createContext(box);
vm.runInContext(`${source.slice(a, b)}\n${source.slice(c, d)}\n;this.api = { recipientFor, buildHandoutLists };`, box);
const { recipientFor, buildHandoutLists } = box.api;
const plain = x => JSON.parse(JSON.stringify(x));
const pls = [{ name: '앨리스', aliases: ['Alice'], uid: 'acct-a' }, { name: '밥', aliases: [], uid: '' }];
const handouts = [
  { id: 'h1', title: '지도', description: '공개 본문', gmNotes: '비밀 본문', image: '', permissions: { '*': { view: true, secret: false, edit: false }, 'acct-a': { view: true, secret: true, edit: false } }, order: 1, updatedAt: 't1', folderId: 'f1' },
  { id: 'h2', title: '밥 전용', description: '밥만 본다', gmNotes: '밥의 비밀', image: 'data:image/png;base64,AA', permissions: { '밥': { view: true, secret: true, edit: false } }, order: 0, updatedAt: 't2' },
  { id: 'h3', title: '올리지 않음', description: '아직', gmNotes: '', permissions: { '*': { view: true } }, order: 2 },
  { id: 'h4', title: '비밀만', description: '공개 안 함', gmNotes: '비밀만 읽기', permissions: { '밥': { view: false, secret: true, edit: false } }, order: 3 },
  { id: 'h5', title: '아무도', description: 'x', gmNotes: 'y', permissions: {}, order: 4 }
];
const people = [{ id: 'p1', displayName: 'Alice', status: 'approved' }, { id: 'p2', displayName: '밥', status: 'approved' }, { id: 'p3', displayName: '손님', status: 'approved' }, { id: 'p4', displayName: '대기', status: 'pending' }, { id: 'p5', displayName: '밥', status: 'revoked' }];
const render = text => `<p>${text}</p>`, image = value => (value ? '<p><img></p>' : '');
const lists = plain(buildHandoutLists(handouts, [{ id: 'f1', name: '1막' }], pls, people, new Set(['h1', 'h2', 'h4', 'h5']), render, image));
// Alice (matched by a merged name, rights by her account key) reads the secret part of h1; Bob sees only what is his; a stranger only what is for everyone
assert.deepEqual(lists.p1.map(i => [i.id, i.html, i.secretHtml, i.folder]), [['h1', '<p>공개 본문</p>', '<p>비밀 본문</p>', '1막']]);
assert.deepEqual(lists.p2.map(i => [i.id, i.html, i.secretHtml]), [['h1', '<p>공개 본문</p>', ''], ['h2', '<p><img></p><p>밥만 본다</p>', '<p>밥의 비밀</p>'], ['h4', '', '<p>비밀만 읽기</p>']]);
assert.deepEqual(lists.p3.map(i => [i.id, i.secretHtml]), [['h1', '']]);
assert(!JSON.stringify(lists.p1).includes('밥만') && !JSON.stringify(lists.p3).includes('밥의 비밀') && !JSON.stringify(lists.p3).includes('비밀 본문'), 'nothing leaks to somebody without the right');
assert.equal('p4' in lists, false, 'pending: no list'); assert.equal('p5' in lists, false, 'revoked: no list');
assert(!lists.p1.some(i => i.id === 'h3') && !lists.p2.some(i => i.id === 'h5'), 'not on the web / nobody: not sent');
// the GM's own choice of recipient beats the name; a key that is a PL name or an account
assert.deepEqual(plain(recipientFor({ displayName: '손님', recipientKey: 'acct-a' }, pls)), { name: '앨리스', extra: ['acct-a'] });
assert.deepEqual(plain(recipientFor({ displayName: '손님', recipientKey: '밥' }, pls)), { name: '밥', extra: ['밥'] });
assert.deepEqual(plain(recipientFor({ displayName: 'alice' }, pls)), { name: '앨리스', extra: ['acct-a'] });
assert.deepEqual(plain(recipientFor({ displayName: '손님' }, pls)), { name: '손님', extra: [] });
const chosen = plain(buildHandoutLists(handouts, [], pls, [{ id: 'p3', displayName: '손님', status: 'approved', recipientKey: 'acct-a' }], new Set(['h1']), render, image));
assert.equal(chosen.p3[0].secretHtml, '<p>비밀 본문</p>', 'the chosen recipient decides');
console.log('handout per person PASS');
