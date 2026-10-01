const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension/personal/relay-bridge.js'), 'utf8');
const ROOM_SOURCE = 'capybara-player-room-relay-v1';
const HANDOUT_SOURCE = 'capybara-public-handout-relay-v1';
const ORIGIN = 'https://ccfolia.com';
const RELAY = 'https://relay.example.test';
const flush = () => new Promise(resolve => setImmediate(resolve));

function createHarness({ pathname = '/rooms/R1', storage = {}, active = true, commands = [], pollOk = true } = {}) {
  const store = { relayEnabled: true, relayUrl: RELAY, relayGmToken: 'test-token', ...storage };
  const state = { commands, pollOk, calls: [], posted: [], listeners: [], intervals: [], storeAtPost: [] };
  const sandbox = {
    console: { warn() {}, error() {}, log() {} },
    URL, setInterval: fn => { state.intervals.push(fn); return state.intervals.length; }, clearInterval() {},
    location: { pathname, origin: ORIGIN },
    navigator: { userActivation: { isActive: active } },
    chrome: { storage: { local: {
      get: async keys => Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])),
      set: async value => { Object.assign(store, value); }
    } } },
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined };
      state.calls.push(call);
      const route = url.replace(RELAY, '');
      const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
      if (route === '/api/connect' || route === '/api/share') return reply(200, { inviteUrl: `${RELAY}/r/R1` });
      if (/\/commands$/.test(route)) return pollOk ? reply(200, { commands: state.commands }) : reply(401, { error: 'GM 인증 실패' });
      return reply(200, { ok: true });
    }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { if (type === 'message') state.listeners.push(fn); };
  sandbox.postMessage = message => { state.posted.push(message); state.storeAtPost.push([...(store.relayDeliveredCommandIds || [])]); };
  vm.createContext(sandbox);
  const globalWindow = vm.runInContext('window', sandbox);
  vm.runInContext(source, sandbox);
  const send = async (data, overrides = {}) => {
    for (const listener of state.listeners) await listener({ data, source: globalWindow, origin: ORIGIN, ...overrides });
    await flush();
  };
  const page = (action, extra = {}) => send({ source: ROOM_SOURCE, direction: 'page', roomId: 'R1', action, ...extra });
  const poll = async () => { await state.intervals.at(-1)(); await flush(); };
  const callsTo = pattern => state.calls.filter(call => pattern.test(call.url));
  return { state, store, send, page, poll, callsTo };
}

(async () => {
  // Disabled / incomplete configuration performs no network I/O.
  for (const storage of [{ relayEnabled: false }, { relayGmToken: '' }]) {
    const h = createHarness({ storage });
    await h.page('ready', { roomTitle: 'T' });
    assert.equal(h.state.calls.length, 0, 'no fetch without complete config');
  }

  // ready -> /api/connect with bearer token, invite stored, polling started.
  {
    const h = createHarness();
    await h.page('ready', { roomTitle: 'Test Room' });
    const connect = h.callsTo(/\/api\/connect$/)[0];
    assert.equal(connect.method, 'POST');
    assert.equal(connect.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(connect.body, { roomId: 'R1', roomTitle: 'Test Room', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
    assert.equal(h.store.relayInviteUrl, `${RELAY}/r/R1`);
    assert.equal(h.state.intervals.length, 1, 'polling timer armed');
    assert(h.callsTo(/\/api\/admin\/rooms\/R1\/commands$/).length >= 1, 'initial poll');
  }

  // Commands: only chat.send forwarded; marked attempted BEFORE dispatch; replay -> ack only.
  {
    const h = createHarness({ commands: [{ id: 'c1', type: 'chat.send', text: 'hi' }, { id: 'c2', type: 'other.thing' }] });
    await h.page('ready');
    assert.equal(h.state.posted.length, 1, 'only chat.send dispatched');
    assert.equal(h.state.posted[0].command.id, 'c1');
    assert.equal(h.state.posted[0].action, 'command');
    assert(h.state.storeAtPost[0].includes('c1'), 'delivered id persisted before dispatch');
    await h.poll();
    assert.equal(h.state.posted.length, 1, 'duplicate command is not re-dispatched');
    const acks = h.callsTo(/\/commands\/c1\/ack$/);
    assert.equal(acks.length, 1);
    assert.deepEqual(acks[0].body, { status: 'delivered', error: '' });
    assert.equal(h.callsTo(/\/commands\/c2\/ack$/).length, 0, 'unknown type never acked/dispatched');
  }

  // Persisted ids survive a "restart": already-delivered command is only acked.
  {
    const h = createHarness({ storage: { relayDeliveredCommandIds: ['old'] }, commands: [{ id: 'old', type: 'chat.send', text: 'x' }] });
    await h.page('ready');
    assert.equal(h.state.posted.length, 0);
    assert.equal(h.callsTo(/\/commands\/old\/ack$/).length, 1);
  }

  // Failed poll (e.g. 401) does nothing.
  {
    const h = createHarness({ pollOk: false, commands: [{ id: 'z', type: 'chat.send' }] });
    await h.page('ready');
    assert.equal(h.state.posted.length, 0);
  }

  // commandResult acks and records delivery; failure carries a truncated error.
  {
    const h = createHarness();
    await h.page('ready');
    await h.page('commandResult', { commandId: 'r1', status: 'delivered' });
    await h.page('commandResult', { commandId: 'r2', status: 'weird', error: 'e'.repeat(1000) });
    const ok = h.callsTo(/\/commands\/r1\/ack$/)[0].body;
    const bad = h.callsTo(/\/commands\/r2\/ack$/)[0].body;
    assert.deepEqual(ok, { status: 'delivered', error: '' });
    assert.equal(bad.status, 'failed');
    assert.equal(bad.error.length, 300);
    assert(h.store.relayDeliveredCommandIds.includes('r1'));
    assert(!h.store.relayDeliveredCommandIds.includes('r2'), 'failed command is not marked delivered');
    await h.page('commandResult', { commandId: '', status: 'delivered' });
    assert.equal(h.callsTo(/\/commands\/[^/]*\/ack$/).length, 2, 'empty id ignored');
  }

  // Delivered-id cache is capped at 500, keeping the newest.
  {
    const ids = Array.from({ length: 500 }, (_, i) => `id${i}`);
    const h = createHarness({ storage: { relayDeliveredCommandIds: ids } });
    await h.page('ready');
    await h.page('commandResult', { commandId: 'newest', status: 'delivered' });
    assert.equal(h.store.relayDeliveredCommandIds.length, 500);
    assert.equal(h.store.relayDeliveredCommandIds.at(-1), 'newest');
    assert(!h.store.relayDeliveredCommandIds.includes('id0'));
  }

  // Snapshot: dedup by id, sanitize and truncate fields, skip id-less entries.
  {
    const h = createHarness();
    await h.page('ready');
    const messages = [
      { id: 'm1', author: 'a'.repeat(200), text: 'bc\u0000'.repeat(3000), createdAt: '2025-01-01' },
      { id: 'm1', author: 'dup', text: 'dup' },
      { author: 'noid', text: 'x' }
    ];
    await h.page('snapshot', { messages });
    await h.page('snapshot', { messages });
    const posts = h.callsTo(/\/api\/admin\/rooms\/R1\/messages$/);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.author.length, 80);
    assert.equal(posts[0].body.text.length, 4000);
    assert(!posts[0].body.text.includes('\u0000'));
  }

  // Late-resolved room title: reconnects with the new title only once connected; ignores empty titles.
  {
    const h = createHarness();
    await h.page('title', { roomTitle: 'Too Early' });
    assert.equal(h.callsTo(/\/api\/connect$/).length, 0, 'title before ready does not connect');
    await h.page('ready', { roomTitle: '' });
    await h.page('title', { roomTitle: '실제 룸 이름' });
    await h.page('title', { roomTitle: '' });
    const connects = h.callsTo(/\/api\/connect$/);
    assert.equal(connects.length, 2);
    assert.equal(connects[1].body.roomTitle, '실제 룸 이름');
  }

  // Untrusted messages are ignored: wrong room, wrong origin, wrong source, foreign window.
  {
    const h = createHarness();
    await h.send({ source: ROOM_SOURCE, direction: 'page', roomId: 'OTHER', action: 'ready' });
    await h.page('ready', {}).catch(() => {});
    const before = h.state.calls.length;
    await h.send({ source: ROOM_SOURCE, direction: 'page', roomId: 'R1', action: 'ready' }, { origin: 'https://evil.example' });
    await h.send({ source: ROOM_SOURCE, direction: 'page', roomId: 'R1', action: 'ready' }, { source: {} });
    await h.send({ source: 'something-else', direction: 'page', roomId: 'R1', action: 'ready' });
    assert.equal(h.state.calls.length, before, 'untrusted messages cause no network calls');
  }

  // Not on a room page: nothing happens.
  {
    const h = createHarness({ pathname: '/home' });
    await h.send({ source: ROOM_SOURCE, direction: 'page', roomId: '', action: 'ready' });
    assert.equal(h.state.calls.length, 0);
  }

  // Handout share needs user activation and posts to /api/share; stop uses /api/share/stop.
  {
    const h = createHarness({ active: false });
    await h.send({ source: HANDOUT_SOURCE, direction: 'request', requestId: 'q1', action: 'share', handout: { id: 'h', title: 't', bodyText: 'b' } });
    assert.equal(h.state.calls.length, 0, 'no activation -> no share');
    assert.equal(h.state.posted.length, 0);
  }
  {
    const h = createHarness();
    await h.send({ source: HANDOUT_SOURCE, direction: 'request', requestId: 'q1', action: 'share', handout: { id: 'h', title: 't'.repeat(900), bodyText: 'b' } });
    const share = h.callsTo(/\/api\/share$/)[0];
    assert.equal(share.body.handout.title.length, 500);
    assert.equal(h.state.posted.at(-1).ok, true);
    assert.equal(h.state.posted.at(-1).inviteUrl, `${RELAY}/r/R1`);
    await h.send({ source: HANDOUT_SOURCE, direction: 'request', requestId: 'q2', action: 'stop' });
    assert.equal(h.callsTo(/\/api\/share\/stop$/).length, 1);
    await h.send({ source: HANDOUT_SOURCE, direction: 'request', requestId: 'q3', action: 'bogus' });
    assert.equal(h.callsTo(/\/api\/share/).length, 2, 'unknown action ignored');
  }

  // Non-https, non-loopback relay URL is rejected (no token sent over plaintext).
  {
    const h = createHarness({ storage: { relayUrl: 'http://example.com' } });
    await h.page('ready');
    assert.equal(h.state.calls.length, 0);
  }

  console.log('relay-bridge: connect, auth header, command queue (idempotency, ordering, restart), snapshot dedup, ack, origin checks, share and URL guard passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
