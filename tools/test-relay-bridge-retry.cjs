// A request to the relay that gets no answer (Failed to fetch) is tried again; the final error names the request, its size and the number of tries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'relay-bridge.js'), 'utf8');
  const a = source.indexOf('  const shortPath = ');
  const b = source.indexOf('  const adminFetch = ');
  assert(a >= 0 && b > a, 'code not found');
  const run = (fetchImpl) => { const delays = []; const box = { fetch: fetchImpl, setTimeout: (fn, ms) => { delays.push(ms); fn(); }, Promise, Error, String }; vm.createContext(box); vm.runInContext(`${source.slice(a, b)}\nthis.fetchRelay = fetchRelay;`, box); return { fetchRelay: box.fetchRelay, delays }; };
  // answers on the third try
  let calls = 0;
  let { fetchRelay, delays } = run(async () => { calls += 1; if (calls < 3) throw new TypeError('Failed to fetch'); return { ok: true }; });
  assert.deepEqual(JSON.parse(JSON.stringify(await fetchRelay('https://r.test/x', '/api/admin/rooms/R/messages', { method: 'POST', body: '{}' }))), { ok: true });
  assert.equal(calls, 3); assert.deepEqual(delays, [600, 1800]);
  // never answers: one error that says which request, how big and how many tries
  calls = 0; ({ fetchRelay } = run(async () => { calls += 1; throw new TypeError('Failed to fetch'); }));
  await assert.rejects(() => fetchRelay('https://r.test/x', '/api/admin/rooms/R1/messages', { method: 'POST', body: 'x'.repeat(1234) }), error => { assert.match(error.message, /POST \/api\/admin\/rooms\/\*\/messages 1234자: 릴레이에 닿지 못했습니다 \(Failed to fetch, 3번 시도\)/); return true; });
  assert.equal(calls, 3);
  // an answer (any status) is not retried
  calls = 0; ({ fetchRelay } = run(async () => { calls += 1; return { ok: false, status: 429 }; }));
  assert.equal((await fetchRelay('https://r.test/x', '/p', { method: 'GET' })).status, 429); assert.equal(calls, 1);
  console.log('relay bridge retry PASS');
})().catch(error => { console.error(error); process.exit(1); });
