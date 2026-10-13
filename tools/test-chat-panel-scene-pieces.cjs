// relayScene pieces: a flipped card sends only its back, never the front address; a card without a back is dropped; markers are listed (CDN only, memo not sent).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  function relayItemView(');
const b = source.indexOf('  // 다른 곳(롤20)에서 넘어온 메시지의 아이콘 주소');
assert(a >= 0 && b > a, 'piece helpers not found');
const { relayItemView, relayMarkerViews, relayDeckViews, relayDiceViews, relayCharacterDocs, relayCdnUrl } = vm.runInNewContext(`${source.slice(a, b)}; ({ relayItemView, relayMarkerViews, relayDeckViews, relayDiceViews, relayCharacterDocs, relayCdnUrl })`, { Object, Array, String, Number });
const CDN = 'https://storage.ccfolia-cdn.net/';
const url = v => (typeof v === 'string' && v.startsWith(CDN) ? v : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const plain = x => JSON.parse(JSON.stringify(x));
const base = { _id: 'i1', x: -6, y: -8, z: 1, angle: 0, width: 17, height: 17, imageUrl: `${CDN}front.png`, coverImageUrl: null, visible: true, active: true, closed: false, locked: false, freezed: false };
// an open card shows its front
assert.equal(relayItemView(base, url, num).imageUrl, `${CDN}front.png`);
assert.equal(relayItemView(base, url, num).closed, false);
// a hidden panel (active false: not on the field, even though visible is true) is never sent; active true is
assert.equal(relayItemView({ ...base, active: false }, url, num), null, 'a panel the GM did not put on the field is not sent');
assert.equal(relayItemView({ ...base, active: false, closed: true, coverImageUrl: `${CDN}back.png` }, url, num), null, 'nor its back');
assert.equal(relayItemView({ ...base, active: true }, url, num).imageUrl, `${CDN}front.png`);
assert.notEqual(relayItemView({ ...base, active: undefined }, url, num), null, 'a record without the field is treated as on the field');
// a flipped card: the back only, and the front address appears nowhere in what is sent
const flipped = plain(relayItemView({ ...base, closed: true, coverImageUrl: `${CDN}back.png` }, url, num));
assert.equal(flipped.imageUrl, `${CDN}back.png`); assert.equal(flipped.closed, true); assert.equal(flipped.locked, true, 'a flipped card cannot be moved by a participant');
assert(!JSON.stringify(flipped).includes('front.png'), 'the front address is never sent');
// no back (or a back outside the CDN) -> dropped; hidden items are dropped
assert.equal(relayItemView({ ...base, closed: true }, url, num), null);
assert.equal(relayItemView({ ...base, closed: true, coverImageUrl: 'https://evil.example/b.png' }, url, num), null);
assert.equal(relayItemView({ ...base, visible: false }, url, num), null);
// markers: a map id -> marker, CDN images only, no memo
const markers = plain(relayMarkerViews({ m1: { x: -21, y: 0, z: 1, angle: 0, width: 10, height: 10, text: '비밀 메모', imageUrl: `${CDN}m.png`, locked: false }, m2: { x: 0, y: 0, imageUrl: 'https://evil.example/x.png' }, m3: { x: 1, y: 1 } }, url, num));
assert.deepEqual(markers, [{ id: 'm1', x: -21, y: 0, z: 1, angle: 0, width: 10, height: 10, imageUrl: `${CDN}m.png` }]);
assert(!JSON.stringify(markers).includes('비밀'), 'the memo is not sent');
assert.equal(relayMarkerViews(null, url, num).length, 0);
assert.equal(relayMarkerViews(Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`m${i}`, { imageUrl: `${CDN}m.png` }])), url, num).length, 100, 'at most 100');
// an image uploaded long ago has a firebasestorage address: it is sent through the CDN like CCFOLIA itself shows it; other hosts stay out
assert.equal(relayCdnUrl('https://firebasestorage.googleapis.com/v0/b/ccfolia-160aa.appspot.com/o/users%2Fabc%2Ffile.png?alt=media&token=t'), 'https://storage.ccfolia-cdn.net/users%2Fabc%2Ffile.png?alt=media&token=t');
assert.equal(relayCdnUrl('https://storage.ccfolia-cdn.net/a.png'), 'https://storage.ccfolia-cdn.net/a.png');
assert.equal(relayCdnUrl('https://firebasestorage.googleapis.com/v0/b/other-project.appspot.com/o/a.png'), '');
assert.equal(relayCdnUrl('https://evil.example/a.png'), ''); assert.equal(relayCdnUrl(null), '');
// decks: the pile only (back + cards left); the front address of any card inside never appears
const decks = plain(relayDeckViews({ d1: { _id: 'd1', x: 3, y: 4, z: 2, zIndex: 9, width: 6, height: 8, coverImageUrl: `${CDN}back.png`, items: { c1: { imageUrl: `${CDN}front1.png`, memo: '비밀' }, c2: { imageUrl: `${CDN}front2.png`, memo: '' }, c3: { imageUrl: `${CDN}front3.png`, memo: '' } } }, d2: { _id: 'd2', coverImageUrl: 'https://evil.example/b.png', items: {} } }, url, num));
assert.deepEqual(decks, [{ id: 'd1', x: 3, y: 4, z: 2, width: 6, height: 8, count: 3, coverUrl: `${CDN}back.png` }]);
assert(!JSON.stringify(decks).includes('front') && !JSON.stringify(decks).includes('비밀'), 'no card face or memo is sent');
assert.equal(relayDeckViews(null, url, num).length, 0);
// the default card back is a path on CCFOLIA's own site: the path is sent (the picture comes as an asset), other relative paths and other hosts are not
const own = plain(relayDeckViews({ d1: { _id: 'd1', coverImageUrl: '/images/trump/z01.png', items: { a: { imageUrl: `${CDN}f.png` } } }, d2: { _id: 'd2', coverImageUrl: '/x/../secret.png' }, d3: { _id: 'd3', coverImageUrl: 'https://evil.example/b.png' } }, url, num));
assert.deepEqual(own.map(d => [d.id, d.coverUrl, d.count]), [['d1', '/images/trump/z01.png', 1]]);
// dice symbols: place, size, faces, value; a hidden value is not sent
const dice = plain(relayDiceViews({ a: { _id: 'a', x: -1, y: -1, width: 2, height: 2, faces: 6, value: 4, closed: false, name: '-', owner: 'uid-secret', changeCount: 0 }, b: { _id: 'b', x: 0, y: 0, width: 2, height: 2, faces: 20, value: 17, closed: true } }, num));
assert.deepEqual(dice, [{ id: 'a', x: -1, y: -1, width: 2, height: 2, faces: 6, closed: false, value: 4 }, { id: 'b', x: 0, y: 0, width: 2, height: 2, faces: 20, closed: true, value: 0 }]);
assert(!JSON.stringify(dice).includes('uid-secret'), 'the owner is not sent');
// character documents for the editor: every character (also off the field), secret or invisible ones without name, memo, commands, status or params; nothing about the owner
const docs = plain(relayCharacterDocs({ a: { _id: 'a', name: '알리스', memo: '메모', commands: '1d100', initiative: 3, externalUrl: 'https://x.test/s', x: 5, y: -6, width: 4, active: false, status: [{ label: 'HP', value: 7, max: 10 }], params: [{ label: 'STR', value: 60 }], owner: 'uid-secret', color: '#fff' }, b: { _id: 'b', name: '비밀', memo: '비밀 메모', secret: true, status: [{ label: 'HP', value: 1, max: 1 }], width: 2 }, c: { name: 'no id' } }));
assert.deepEqual(docs.map(d => d.id), ['a', 'b']);
assert.deepEqual([docs[0].name, docs[0].memo, docs[0].commands, docs[0].initiative, docs[0].x, docs[0].y, docs[0].active, docs[0].status[0].value], ['알리스', '메모', '1d100', 3, 5, -6, false, 7]);
assert.deepEqual([docs[1].name, docs[1].memo, docs[1].status.length, docs[1].params.length], ['', '', 0, 0], 'a hidden character shows nothing');
assert(!JSON.stringify(docs).includes('uid-secret'), 'no owner id');
console.log('chat panel scene pieces PASS');
