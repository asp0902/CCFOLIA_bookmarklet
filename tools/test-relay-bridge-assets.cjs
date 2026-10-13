// The extension forwards the mirror's small pictures as an object { path: data URI } (it once required a string and dropped every picture).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'relay-bridge.js'), 'utf8');
const a = source.indexOf('  function boundedAssets(');
const b = source.indexOf('  async function handleCommand(');
assert(a >= 0 && b > a, 'boundedAssets not found');
const { boundedAssets } = vm.runInNewContext(`${source.slice(a, b)}; ({ boundedAssets })`, { Object, String });
const png = 'data:image/png;base64,iVBORw0KGgo=';
assert.deepEqual(JSON.parse(JSON.stringify(boundedAssets({ '/ccfolia.png': png, '/images/trump/z01.png': png }))), { '/ccfolia.png': png, '/images/trump/z01.png': png });
assert.equal(boundedAssets(undefined), undefined); assert.equal(boundedAssets('data:image/png;base64,AA'), undefined, 'a plain string is not a picture table');
assert.deepEqual(JSON.parse(JSON.stringify(boundedAssets({ a: 5, b: png }))), { b: png }, 'non-string data is dropped');
assert.equal(Object.keys(boundedAssets(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`/images/${i}.png`, png])))).length, 24, 'at most 24');
assert.equal(boundedAssets({ a: 'x'.repeat(200000) }).a.length, 90000, 'each picture is bounded');
console.log('relay bridge assets PASS');
