// extension 1.52.25 (handout Drive, first real use: "다시 연결이 필요합니다" right after choosing the direction):
// - the silent re-issue (the session token is gone after a browser restart) asks Chrome not to stop at the first page load
//   (abortOnLoadForNonInteractive: false + a 10s limit) — Google's prompt=none flow redirects by script after the page has loaded;
// - failures come back with a Korean reason by cause (login expired / consent / denied / 401 / Drive API off / scope / rate / network), a code and
//   needsConnect only where [다시 연결] fixes it; a 401 drops the stored token; 'ensure' and 'connect' report the same way.
// No real Google account: a fake chrome + fetch (the user checks the real one).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.join(__dirname, '../extension/personal');
function load({ token = null, auth, fetchImpl }) {
  const session = token ? { driveToken: { token, exp: Date.now() + 3600e3 } } : {};
  const local = { driveClientId: 'test-client.apps.googleusercontent.com', driveConnected: true };
  const calls = { auth: [] };
  let listener = null;
  const area = (store) => ({ get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, store[k]])), set: async (v) => Object.assign(store, v), remove: async (k) => { delete store[k]; } });
  const sandbox = {
    console, URL, URLSearchParams, Promise, Error, JSON, Date, Math, String, Number, Object, Array, Set, Map, encodeURIComponent, TextEncoder,
    chrome: {
      storage: { session: area(session), local: area(local) },
      identity: { getRedirectURL: () => 'https://ext.chromiumapp.org/', launchWebAuthFlow: async (opts) => { calls.auth.push(opts); return auth(opts); } },
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } }
    },
    fetch: fetchImpl
  };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, 'drive-core.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(dir, 'drive-background.js'), 'utf8'), sandbox);
  const send = (message) => new Promise((resolve) => listener({ type: 'drive-sync', ...message }, { tab: { url: 'https://ccfolia.com/rooms/x' } }, resolve));
  return { send, calls, session, local };
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body, clone() { return this; }, text: async () => JSON.stringify(body) });
const upload = { op: 'upload', room: 'R', roomTitle: 't', handouts: [{ id: 'h1', title: 'a' }] };
(async () => {
  // 1) no token, the silent re-issue fails (Chrome: user interaction required) → login expired, [다시 연결]; the flow was not cut at the first load
  let x = load({ auth: async () => { throw new Error('User interaction required.'); }, fetchImpl: async () => json(200, {}) });
  let r = await x.send(upload);
  assert.equal(r.ok, false); assert.equal(r.needsConnect, true); assert.equal(r.code, 'login-expired');
  assert.match(r.error, /Google 로그인이 만료되었습니다 — \[다시 연결\]/);
  assert.equal(x.calls.auth[0].interactive, false); assert.equal(x.calls.auth[0].abortOnLoadForNonInteractive, false); assert.equal(x.calls.auth[0].timeoutMsForNonInteractive, 10000);
  assert.match(x.calls.auth[0].url, /prompt=none/);
  assert.equal(x.local.driveLast.code, 'login-expired'); assert.equal(x.local.driveLast.ok, false);
  assert.ok(!JSON.stringify(x.local.driveLast).includes('test-client'), 'no client id in the diagnostic record');
  // 2) the silent re-issue works → no reconnect needed (a token is stored in the session area only)
  x = load({ auth: async () => 'https://ext.chromiumapp.org/#access_token=TOKEN1&expires_in=3600', fetchImpl: async () => json(200, {}) });
  r = await x.send({ op: 'ensure' });
  assert.equal(r.ok, true); assert.equal(x.session.driveToken.token, 'TOKEN1'); assert.ok(!('driveToken' in x.local));
  // 3) 'ensure' with a denied consent (test-mode app, approval expired)
  x = load({ auth: async () => 'https://ext.chromiumapp.org/#error=access_denied', fetchImpl: async () => json(200, {}) });
  r = await x.send({ op: 'ensure' });
  assert.deepEqual([r.ok, r.needsConnect, r.code], [false, true, 'access-denied']); assert.match(r.error, /테스트/);
  // 4) Drive answers 401 → login expired, the stored token is dropped
  x = load({ token: 'OLD', auth: async () => { throw new Error('no'); }, fetchImpl: async () => json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }) });
  r = await x.send(upload);
  assert.deepEqual([r.ok, r.needsConnect, r.code], [false, true, 'http-401']); assert.ok(!x.session.driveToken, 'expired token dropped');
  // 5) 403 Drive API off → not a reconnect, says where to switch it on
  x = load({ token: 'T', auth: async () => { throw new Error('no'); }, fetchImpl: async () => json(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }) });
  r = await x.send(upload);
  assert.deepEqual([r.ok, r.needsConnect, r.code], [false, false, 'api-disabled']); assert.match(r.error, /Drive API 가 꺼져 있습니다/);
  // 6) 403 scope → reconnect
  x = load({ token: 'T', auth: async () => { throw new Error('no'); }, fetchImpl: async () => json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }) });
  r = await x.send(upload);
  assert.deepEqual([r.ok, r.needsConnect, r.code], [false, true, 'scope']);
  // 7) network
  x = load({ token: 'T', auth: async () => { throw new Error('no'); }, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  r = await x.send(upload);
  assert.deepEqual([r.ok, r.needsConnect, r.code], [false, false, 'network']); assert.match(r.error, /네트워크/);
  // 8) [다시 연결] = 'connect' opens the interactive login (no prompt=none), the window closed → a reason
  x = load({ auth: async (o) => { if (o.interactive) throw new Error('The user did not approve access.'); throw new Error('x'); }, fetchImpl: async () => json(200, {}) });
  r = await x.send({ op: 'connect' });
  assert.deepEqual([r.ok, r.code], [false, 'window-closed']); assert.equal(x.calls.auth[0].interactive, true); assert.doesNotMatch(x.calls.auth[0].url, /prompt=none/);
  // the bridge passes the two new requests
  assert.match(fs.readFileSync(path.join(dir, 'drive-bridge.js'), 'utf8'), /new Set\(\["status", "ensure", "connect",/);
  console.log('drive errors PASS');
})().catch((e) => { console.error(e); process.exit(1); });
