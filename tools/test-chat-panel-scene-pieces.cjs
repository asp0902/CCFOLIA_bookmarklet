// relayScene pieces: a flipped card sends only its back, never the front address; a card without a back is dropped; markers are listed (CDN only, memo not sent).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  function relayItemView(');
const b = source.indexOf('  // 다른 곳(롤20)에서 넘어온 메시지의 아이콘 주소');
assert(a >= 0 && b > a, 'piece helpers not found');
const { relayItemView, relayMarkerViews } = vm.runInNewContext(`${source.slice(a, b)}; ({ relayItemView, relayMarkerViews })`, {});
const CDN = 'https://storage.ccfolia-cdn.net/';
const url = v => (typeof v === 'string' && v.startsWith(CDN) ? v : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const plain = x => JSON.parse(JSON.stringify(x));
const base = { _id: 'i1', x: -6, y: -8, z: 1, angle: 0, width: 17, height: 17, imageUrl: `${CDN}front.png`, coverImageUrl: null, visible: true, closed: false, locked: false, freezed: false };
// an open card shows its front
assert.equal(relayItemView(base, url, num).imageUrl, `${CDN}front.png`);
assert.equal(relayItemView(base, url, num).closed, false);
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
console.log('chat panel scene pieces PASS');
