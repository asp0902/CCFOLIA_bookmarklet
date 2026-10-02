const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'extension/personal');
const source = fs.readFileSync(path.join(dir, 'options.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'options.html'), 'utf8');
assert.match(html, /id="stop"/, 'options page has a stop button');
const flush = () => new Promise(resolve => setImmediate(resolve));

function createOptions({ confirmResult = true, stopStatus = 200, storage = {} } = {}) {
  const store = { relayEnabled: true, relayUrl: 'https://relay.example.test', relayGmToken: 'tok', relayLastRoomId: 'R1', relayInviteUrl: 'https://relay.example.test/#room=R1&token=t', ...storage };
  const calls = [];
  const handlers = {};
  const elements = new Proxy({}, { get: (target, id) => target[id] ||= {
    id, value: '', textContent: '', checked: false, dataset: {},
    addEventListener(type, fn) { handlers[`${id}:${type}`] = fn; },
    replaceChildren() { this.textContent = ''; }, append() {}
  } });
  const sandbox = {
    console, URL, setInterval() {}, setTimeout() {},
    document: { getElementById: id => elements[id], createElement: () => ({ dataset: {}, append() {} }) },
    confirm: () => confirmResult,
    chrome: { storage: { local: {
      get: (keys, callback) => callback(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))),
      set: async value => { Object.assign(store, value); },
      remove: async keys => { for (const key of [].concat(keys)) delete store[key]; }
    } } },
    fetch: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined });
      if (/\/share\/stop$/.test(url)) return { ok: stopStatus < 300, status: stopStatus, json: async () => (stopStatus < 300 ? { stopped: true } : { error: 'GM 인증 실패' }) };
      return { ok: true, status: 200, json: async () => ({ participants: [] }) };
    }
  };
  vm.runInNewContext(source, sandbox);
  return { store, calls, elements, click: async () => { await handlers['stop:click'](); await flush(); } };
}

(async () => {
  // Confirmed stop: authenticated POST for the stored room, state cleared, bridge signalled.
  {
    const o = createOptions();
    await flush();
    await o.click();
    const stop = o.calls.find(call => /\/api\/share\/stop$/.test(call.url));
    assert.equal(stop.method, 'POST');
    assert.equal(stop.headers.Authorization, 'Bearer tok');
    assert.deepEqual(stop.body, { roomId: 'R1' });
    assert.equal(o.store.relayInviteUrl, undefined);
    assert.equal(o.store.relayLastRoomId, undefined);
    assert.equal(o.store.relayStop.roomId, 'R1', 'bridge is signalled for that room');
    assert.equal(o.elements.invite.value, '');
    assert.match(o.elements['stop-status'].textContent, /중지했습니다/);
  }
  // Declined confirmation does nothing.
  {
    const o = createOptions({ confirmResult: false });
    await flush();
    await o.click();
    assert.equal(o.calls.filter(call => /share\/stop/.test(call.url)).length, 0);
    assert(o.store.relayInviteUrl && !o.store.relayStop);
  }
  // Server rejection (e.g. wrong token) keeps local state and shows the error.
  {
    const o = createOptions({ stopStatus: 401 });
    await flush();
    await o.click();
    assert(o.store.relayInviteUrl && !o.store.relayStop);
    assert.match(o.elements['stop-status'].textContent, /GM 인증 실패/);
  }
  // No shared room: no request.
  {
    const o = createOptions({ storage: { relayLastRoomId: '' } });
    await flush();
    await o.click();
    assert.equal(o.calls.filter(call => /share\/stop/.test(call.url)).length, 0);
    assert.match(o.elements['stop-status'].textContent, /공유 중인 룸이 없습니다/);
  }
  // Push-socket status line.
  for (const [info, expected] of [
    [{ state: 'open', roomId: 'R1', at: Date.now() }, /연결됨/],
    [{ state: 'closed', roomId: 'R1', at: Date.now(), code: 1006, reason: '' }, /끊김 \(코드 1006\)/],
    [{ state: 'closed', roomId: 'OTHER', at: Date.now(), code: 1006 }, /아직 연결 시도 없음/],
    [undefined, /아직 연결 시도 없음/],
  ]) {
    const o = createOptions({ storage: { relaySocket: info } });
    await flush();
    assert.match(o.elements.socket.textContent, expected);
  }
  console.log('relay options: stop button confirm, request, state cleanup and bridge signal passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
