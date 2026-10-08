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

function createHarness({ pathname = '/rooms/R1', storage = {}, active = true, commands = [], pollOk = true, connectFailures = 0, webSocket = true, messageFailures = 0 } = {}) {
  const store = { relayEnabled: true, relayUrl: RELAY, relayGmToken: 'test-token', ...storage };
  const state = { commands, pollOk, connectFailures, messageFailures, sockets: [], intervalDelays: [], calls: [], posted: [], storageListeners: [], listeners: [], intervals: [], timeouts: [], storeAtPost: [] };
  const sandbox = {
    console: { warn() {}, error() {}, log() {} },
    URL, btoa, TextEncoder, setInterval: (fn, delay) => { state.intervals.push(fn); state.intervalDelays.push(delay); return state.intervals.length; }, clearInterval() {}, setTimeout: fn => { state.timeouts.push(fn); return state.timeouts.length; }, clearTimeout() {},
    location: { pathname, origin: ORIGIN },
    navigator: { userActivation: { isActive: active } },
    chrome: { runtime: { id: "test-extension", onMessage: { addListener: () => {} } }, storage: { onChanged: { addListener: fn => { state.storageListeners.push(fn); } }, local: {
      get: async keys => Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])),
      set: async value => { Object.assign(store, value); },
      remove: async keys => { for (const key of [].concat(keys)) delete store[key]; }
    } } },
    fetch: async (url, options = {}) => {
      const call = { url, method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined };
      state.calls.push(call);
      const route = url.replace(RELAY, '');
      const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
      if (/\/messages$/.test(route) && state.messageFailures-- > 0) return reply(500, { error: 'down' });
      if (route === '/api/connect' && state.connectFailures-- > 0) return reply(500, { error: 'down' });
      if (route === '/api/connect') return reply(200, { inviteUrl: `${RELAY}/r/${call.body.roomId}` });
      if (route === '/api/share') return reply(200, { inviteUrl: `${RELAY}/r/R1` });
      if (/\/commands$/.test(route)) return pollOk ? reply(200, { commands: state.commands }) : reply(401, { error: 'GM 인증 실패' });
      return reply(200, { ok: true });
    }
  };
  if (webSocket) sandbox.WebSocket = class { constructor(url, protocols) { this.url = url; this.protocols = protocols; this.sent = []; this.closed = false; state.sockets.push(this); } send(data) { this.sent.push(data); } close() { this.closed = true; } };
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
  // In-app navigation: change the URL, then let the bridge's room watcher (the 1000 ms interval) notice it.
  const navigate = async path => { sandbox.location.pathname = path; await state.intervals[state.intervalDelays.indexOf(1000)](); await flush(); await flush(); };
  const pageFor = (roomId, action, extra = {}) => send({ source: ROOM_SOURCE, direction: 'page', roomId, action, ...extra });
  return { state, store, send, page, poll, callsTo, navigate, pageFor };
}

(async () => {
  // Disabled / incomplete configuration performs no network I/O.
  for (const storage of [{ relayEnabled: false }, { relayGmToken: '' }]) {
    const h = createHarness({ storage });
    await h.page('ready', { roomTitle: 'T' });
    assert.equal(h.state.calls.length, 0, 'no fetch without complete config');
  }

  // Starts on its own (no dependence on the page's one-shot "ready"), then ready with a title reconnects once.
  {
    const h = createHarness();
    await flush();
    const first = h.callsTo(/\/api\/connect$/);
    assert.equal(first.length, 1, 'connects without any page message');
    assert.equal(first[0].method, 'POST');
    assert.equal(first[0].headers.Authorization, 'Bearer test-token');
    assert.deepEqual(first[0].body, { roomId: 'R1', roomTitle: '', capabilities: { chatRead: true, chatWrite: true, publicHandout: true } });
    assert.equal(h.store.relayInviteUrl, `${RELAY}/r/R1`);
    assert.equal(h.state.intervalDelays.filter(delay => delay !== 1000).length, 1, 'polling timer armed (the 1000 ms interval is the room watcher)');
    assert(h.callsTo(/\/api\/admin\/rooms\/R1\/commands$/).length >= 1, 'initial poll');
    await h.page('ready', { roomTitle: '' });
    assert.equal(h.callsTo(/\/api\/connect$/).length, 1, 'ready without a new title does not reconnect');
    await h.page('ready', { roomTitle: 'Test Room' });
    const all = h.callsTo(/\/api\/connect$/);
    assert.equal(all.length, 2);
    assert.equal(all[1].body.roomTitle, 'Test Room');
  }

  // A failed start is retried later; a failed connect does not poison later connects.
  {
    const h = createHarness({ connectFailures: 1 });
    await flush();
    assert.equal(h.store.relayInviteUrl, undefined, 'not connected after failure');
    assert.equal(h.state.timeouts.length, 1, 'retry scheduled');
    await h.state.timeouts[0]();
    await flush();
    assert.equal(h.store.relayInviteUrl, `${RELAY}/r/R1`, 'retry connects');
    const h2 = createHarness({ connectFailures: 1 });
    await h2.page('ready', { roomTitle: 'T' });
    assert.equal(h2.store.relayInviteUrl, `${RELAY}/r/R1`, 'later connect still works after an earlier failure');
  }

  // Stop: polling and the stored invite URL are cleared and nothing reconnects until the page is reloaded.
  {
    const h = createHarness();
    await flush();
    assert(h.store.relayInviteUrl);
    await h.send({ source: HANDOUT_SOURCE, direction: 'request', requestId: 's1', action: 'stop' });
    assert.equal(h.callsTo(/\/api\/share\/stop$/).length, 1);
    assert.equal(h.store.relayInviteUrl, undefined, 'invite URL cleared on stop');
    const before = h.callsTo(/\/api\/connect$/).length;
    await h.page('ready', { roomTitle: 'Again' });
    await h.page('title', { roomTitle: 'Again 2' });
    assert.equal(h.callsTo(/\/api\/connect$/).length, before, 'no reconnect after stop');
  }

  // Commands: only chat.send forwarded; marked attempted BEFORE dispatch; replay -> ack only.
  {
    const h = createHarness({ commands: [{ id: 'c1', type: 'chat.send', text: 'hi' }, { id: 'c2', type: 'other.thing' }, { id: 'c3', type: 'piece.move', kind: 'item', pieceId: 'p1', x: 1, y: 2 }] });
    await h.page('ready');
    assert.deepEqual(h.state.posted.map(p => p.command.id), ['c1', 'c3'], 'only chat.send and piece.move dispatched');
    assert.equal(h.state.posted[0].command.id, 'c1');
    assert.equal(h.state.posted[0].action, 'command');
    assert(h.state.storeAtPost[0].includes('c1'), 'delivered id persisted before dispatch');
    await h.poll();
    assert.equal(h.state.posted.length, 2, 'duplicate command is not re-dispatched');
    assert.equal(h.callsTo(/\/commands\/c1\/ack$/).length, 0, 'a command still in flight is not acknowledged by a later poll');
    await h.page('commandResult', { commandId: 'c1', status: 'delivered' });
    await h.poll();
    assert.equal(h.state.posted.length, 2, 'finished command is not re-dispatched');
    const acks = h.callsTo(/\/commands\/c1\/ack$/);
    assert.equal(acks.length, 2, 'result ack + idempotent re-ack on replay');
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

  // A message edited in CCFOLIA keeps its id and gets a new body: it is sent again; an unchanged one is not.
  {
    const h = createHarness();
    await h.page('ready');
    const base = { id: 'e1', author: 'A', text: '처음', createdAt: '2026-01-01T00:00:00Z' };
    await h.page('snapshot', { messages: [base] });
    await h.page('snapshot', { messages: [{ ...base }] });
    assert.equal(h.callsTo(/\/api\/admin\/rooms\/R1\/messages$/).length, 1, 'unchanged: not sent again');
    await h.page('snapshot', { messages: [{ ...base, text: '수정됨', edited: true }] });
    const posts = h.callsTo(/\/api\/admin\/rooms\/R1\/messages$/);
    assert.equal(posts.length, 2, 'edited: sent again');
    assert.deepEqual([posts[1].body.text, posts[1].body.edited], ['수정됨', true]);
  }

  // Late-resolved room title: reconnects with the new title; empty titles are ignored.
  {
    const h = createHarness();
    await flush();
    await h.page('title', { roomTitle: '실제 룸 이름' });
    await h.page('title', { roomTitle: '' });
    await h.page('title', { roomTitle: '실제 룸 이름' });
    const connects = h.callsTo(/\/api\/connect$/);
    assert.equal(connects.length, 2);
    assert.equal(connects[1].body.roomTitle, '실제 룸 이름');
  }

  // Stop signalled from the options page (via storage) disconnects only the matching room.
  {
    const h = createHarness();
    await flush();
    const before = h.callsTo(/\/api\/connect$/).length;
    h.state.storageListeners.forEach(fn => fn({ relayStop: { newValue: { roomId: 'OTHER', at: 1 } } }, 'local'));
    await flush();
    assert(h.store.relayInviteUrl, 'stop for another room is ignored');
    h.state.storageListeners.forEach(fn => fn({ relayStop: { newValue: { roomId: 'R1', at: 2 } } }, 'sync'));
    await flush();
    assert(h.store.relayInviteUrl, 'non-local storage area is ignored');
    h.state.storageListeners.forEach(fn => fn({ relayStop: { newValue: { roomId: 'R1', at: 3 } } }, 'local'));
    await flush();
    assert.equal(h.store.relayInviteUrl, undefined, 'stop for this room clears the invite URL');
    await h.page('ready', { roomTitle: 'Again' });
    assert.equal(h.callsTo(/\/api\/connect$/).length, before, 'no reconnect after options stop');
  }

  // Push socket: opened after connect with the token as a subprotocol; commands arrive without polling.
  {
    const h = createHarness({ commands: [] });
    await flush();
    assert.equal(h.state.sockets.length, 1, 'push socket opened after connect');
    const sock = h.state.sockets[0];
    assert.equal(sock.url, 'wss://relay.example.test/api/admin/rooms/R1/ws');
    assert.deepEqual([...sock.protocols], ['capybara-gm', Buffer.from('test-token').toString('base64url')]);
    assert.equal(h.state.intervalDelays.at(-1), 1500, 'fast polling while the socket is not open');
    assert.equal(h.store.relaySocket.state, 'connecting', 'status: connecting');
    sock.onopen();
    await flush();
    assert.equal(h.store.relaySocket.state, 'open', 'status: open');
    assert.equal(h.state.intervalDelays.at(-1), 10000, 'slow safety-net polling once the socket is open');
    const pollsBefore = h.callsTo(/\/commands$/).length;
    sock.onmessage({ data: JSON.stringify({ type: 'command', command: { id: 'w1', type: 'chat.send', text: '소켓 명령', displayName: '참가자' } }) });
    await flush();
    assert.equal(h.state.posted.length, 1, 'pushed command is dispatched immediately');
    assert.equal(h.state.posted[0].command.id, 'w1');
    assert(h.state.storeAtPost[0].includes('w1'), 'persisted before dispatch');
    sock.onmessage({ data: JSON.stringify({ type: 'command', command: { id: 'w1', type: 'chat.send', text: '소켓 명령' } }) });
    sock.onmessage({ data: JSON.stringify({ type: 'command', command: { id: 'w2', type: 'other', text: 'x' } }) });
    sock.onmessage({ data: 'pong' });
    await flush();
    assert.equal(h.state.posted.length, 1, 'duplicate / unknown pushes are ignored');
    assert.equal(h.callsTo(/\/commands\/w1\/ack$/).length, 0, 'in-flight duplicate is not acknowledged');
    assert.equal(h.callsTo(/\/commands$/).length, pollsBefore, 'no polling needed for the push');

    // Socket lost: back to fast polling and a delayed reconnect.
    sock.onclose({ code: 1006, reason: '' });
    await flush();
    assert.deepEqual({ state: h.store.relaySocket.state, code: h.store.relaySocket.code }, { state: 'closed', code: 1006 }, 'status: closed with the close code');
    assert.equal(h.state.intervalDelays.at(-1), 1500, 'fast polling again after the socket closed');
    assert.equal(h.state.timeouts.length, 1, 'reconnect scheduled');
    await h.state.timeouts[0]();
    assert.equal(h.state.sockets.length, 2, 'reconnected');
    // Server says the share was stopped: tear down for good.
    h.state.sockets[1].onopen();
    h.state.sockets[1].onmessage({ data: JSON.stringify({ type: 'closed', reason: 'stopped' }) });
    await flush();
    assert.equal(h.store.relayInviteUrl, undefined, 'invite URL cleared after a stopped notice');
    assert.equal(h.store.relaySocket.state, 'off', 'status: off after a stopped notice');
    assert(h.state.sockets[1].closed, 'socket closed');
    const connectsBefore = h.callsTo(/\/api\/connect$/).length;
    await h.page('ready', { roomTitle: 'Again' });
    assert.equal(h.callsTo(/\/api\/connect$/).length, connectsBefore, 'no reconnect after the stopped notice');
  }

  // Without WebSocket support the bridge still works by polling alone.
  {
    const h = createHarness({ webSocket: false, commands: [{ id: 'p1', type: 'chat.send', text: 'hi' }] });
    await flush();
    assert.equal(h.state.sockets.length, 0);
    assert.equal(h.store.relaySocket.state, 'unsupported', 'status: unsupported');
    await h.poll();
    assert.equal(h.state.posted.length, 1);
  }

  // A failed message post is retried by the next snapshot instead of being lost.
  {
    const h = createHarness({ messageFailures: 1 });
    await flush();
    const snapshot = { messages: [{ id: 'm9', author: 'GM', text: '재시도', createdAt: '2025-01-01' }] };
    await h.page('snapshot', snapshot);
    assert.equal(h.callsTo(/\/messages$/).length, 1);
    await h.page('snapshot', snapshot);
    assert.equal(h.callsTo(/\/messages$/).length, 2, 'retried after the failure');
    await h.page('snapshot', snapshot);
    assert.equal(h.callsTo(/\/messages$/).length, 2, 'not re-sent once accepted');
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
    assert.equal(h.callsTo(/\/api\/share/).length, 0, 'no activation -> no share');
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

  // Each CCFOLIA room gets its own relay room and invite URL, also when the room changes without a page load.
  {
    const h = createHarness({ pathname: '/rooms/R1' });
    await h.navigate('/rooms/R1'); // same room: nothing happens
    await flush();
    assert.equal(h.callsTo(/\/api\/connect$/).length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.store.relayInvites)), { R1: `${RELAY}/r/R1` });
    const firstSocket = h.state.sockets[0];
    await h.navigate('/rooms/R2');
    const connects = h.callsTo(/\/api\/connect$/);
    assert.equal(connects.length, 2, 'the new room connects');
    assert.equal(connects[1].body.roomId, 'R2');
    assert.deepEqual(JSON.parse(JSON.stringify(h.store.relayInvites)), { R1: `${RELAY}/r/R1`, R2: `${RELAY}/r/R2` }, 'invite URLs are kept per room');
    assert.equal(h.store.relayLastRoomId, 'R2');
    assert.equal(h.store.relayInviteUrl, `${RELAY}/r/R2`);
    assert(firstSocket.closed, 'the previous room socket is closed');
    assert(h.state.sockets.at(-1).url.includes('/rooms/R2/ws'), 'the new socket belongs to the new room');
    await h.poll();
    assert(h.callsTo(/\/api\/admin\/rooms\/R2\/commands$/).length >= 1, 'commands are polled for the new room');
    // Messages tagged with the old room are ignored; the new room's are accepted.
    await h.pageFor('R1', 'snapshot', { messages: [{ id: 'old', author: 'A', text: 'x', createdAt: '2026-01-01T00:00:00Z' }] });
    assert.equal(h.callsTo(/\/rooms\/R1\/messages$/).length, 0, 'old room messages are dropped');
    await h.pageFor('R2', 'snapshot', { messages: [{ id: 'new', author: 'A', text: 'y', createdAt: '2026-01-01T00:00:00Z' }] });
    assert.equal(h.callsTo(/\/rooms\/R2\/messages$/).length, 1, 'new room messages are relayed');
    // Back to the home screen: nothing is relayed.
    await h.navigate('/home');
    await h.send({ source: ROOM_SOURCE, direction: 'page', roomId: '', action: 'snapshot', messages: [{ id: 'z', author: 'A', text: 'z', createdAt: '2026-01-01T00:00:00Z' }] });
    assert.equal(h.callsTo(/\/rooms\/\/messages$/).length, 0, 'no request without a room id');
  }
  // Loaded on the home screen (no room yet): connects once the user enters a room.
  {
    const h = createHarness({ pathname: '/home' });
    await flush();
    assert.equal(h.callsTo(/\/api\/connect$/).length, 0, 'no room, no connection');
    await h.navigate('/rooms/R9');
    assert.equal(h.callsTo(/\/api\/connect$/).length, 1);
    assert.equal(h.callsTo(/\/api\/connect$/)[0].body.roomId, 'R9');
  }

  console.log('relay-bridge: connect, auth header, command queue (idempotency, ordering, restart), snapshot dedup, ack, origin checks, share and URL guard passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
