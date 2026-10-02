const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Real relay-bridge.js (VM) + real local worker + simulated CCFOLIA page and participant. Measures push latency.
// Run against `wrangler dev --port 8790 --var GM_TOKEN:test-gm-token`.
const base = process.env.RELAY_BASE_URL || 'http://127.0.0.1:8790';
const gmToken = process.env.RELAY_GM_TOKEN || 'test-gm-token';
const bridgeSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'extension/personal/relay-bridge.js'), 'utf8');
const ROOM_SOURCE = 'capybara-player-room-relay-v1';
const roomId = `e2e-${Date.now().toString(36)}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const admin = (url, body) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gmToken}` }, body: body ? JSON.stringify(body) : undefined });

(async () => {
  const store = { relayEnabled: true, relayUrl: base, relayGmToken: gmToken };
  const listeners = [];
  const sandbox = {
    console, URL, fetch, WebSocket, TextEncoder, btoa, setInterval, clearInterval, setTimeout, clearTimeout,
    location: { pathname: `/rooms/${roomId}`, origin: 'https://ccfolia.com' },
    navigator: { userActivation: { isActive: true } },
    chrome: { storage: { onChanged: { addListener() {} }, local: {
      get: async keys => Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])),
      set: async value => { Object.assign(store, value); },
      remove: async keys => { for (const key of [].concat(keys)) delete store[key]; },
    } } },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
  };
  vm.createContext(sandbox);
  const pageWindow = vm.runInContext('window = globalThis', sandbox);
  sandbox.postMessage = (data, origin) => setTimeout(() => listeners.forEach(fn => fn({ data, source: pageWindow, origin: 'https://ccfolia.com' })), 0);

  // Simulated CCFOLIA: a chat store, the page script's snapshot emission and relaySend.
  const chat = [];
  const emitSnapshot = () => sandbox.postMessage({ source: ROOM_SOURCE, direction: 'page', roomId, action: 'snapshot', messages: chat.map(message => ({ ...message })) });
  const ccfoliaSend = (name, text) => { chat.push({ id: `c${chat.length + 1}`, author: name, text, createdAt: new Date().toISOString() }); emitSnapshot(); };
  listeners.push(event => {
    const data = event.data;
    if (data?.source === ROOM_SOURCE && data.direction === 'bridge' && data.action === 'command') {
      setTimeout(() => {
        ccfoliaSend('GM', `[참여자 웹 · ${data.command.displayName}] ${data.command.text}`);
        sandbox.postMessage({ source: ROOM_SOURCE, direction: 'page', roomId, action: 'commandResult', commandId: data.command.id, status: 'delivered' });
      }, 30); // CCFOLIA write time
    }
  });

  vm.runInContext(bridgeSource, sandbox);
  sandbox.postMessage({ source: ROOM_SOURCE, direction: 'page', roomId, action: 'ready', roomTitle: 'E2E 룸' });
  for (let waited = 0; !store.relayInviteUrl && waited < 5000; waited += 20) await sleep(20);
  assert(store.relayInviteUrl, 'bridge connected on its own');
  const inviteToken = new URLSearchParams(store.relayInviteUrl.split('#')[1]).get('token');

  // Participant joins and is approved; opens the push socket.
  const join = await fetch(base + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, token: inviteToken, displayName: '왕복 참가자' }) });
  const cookie = `capybara_session=${/capybara_session=([^;]+)/.exec(join.headers.get('set-cookie'))[1]}`;
  const participantId = (await (await admin(`/api/admin/rooms/${roomId}/participants`)).json()).participants[0].id;
  await admin(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'approve' });
  const events = [];
  const player = new WebSocket(base.replace(/^http/, 'ws') + `/api/rooms/${roomId}/ws`, { headers: { Cookie: cookie } });
  player.addEventListener('message', event => { try { events.push({ at: Date.now(), ...JSON.parse(event.data) }); } catch (_) {} });
  await new Promise((resolve, reject) => { player.addEventListener('open', resolve); player.addEventListener('error', () => reject(new Error('participant socket failed'))); });
  const waitFor = async (predicate, ms = 3000) => { const started = Date.now(); while (Date.now() - started < ms) { const found = events.find(predicate); if (found) return found; await sleep(5); } throw new Error(`timeout; events: ${JSON.stringify(events.map(({ at, ...rest }) => rest))}`); };
  // The bridge opens its own GM socket after connect; give it a moment so commands are pushed, not polled.
  await sleep(500);

  // 1) CCFOLIA -> participant.
  const t1 = Date.now();
  ccfoliaSend('GM', '코코포리아에서 보낸 글');
  const seen1 = await waitFor(event => event.type === 'message' && event.message.text === '코코포리아에서 보낸 글');
  const gmToPlayer = seen1.at - t1;

  // 2) participant -> CCFOLIA (command push -> relaySend -> ack), then both copies reach the participant.
  const t2 = Date.now();
  const send = await fetch(base + `/api/rooms/${roomId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ clientMessageId: 'e1', text: '참가자가 보낸 글' }) });
  assert.equal(send.status, 202);
  const echo = await waitFor(event => event.type === 'message' && event.message.origin === 'external' && event.message.text === '참가자가 보낸 글');
  const copy = await waitFor(event => event.type === 'message' && event.message.text.includes('[참여자 웹 · 왕복 참가자] 참가자가 보낸 글'));
  const playerRoundTrip = echo.at - t2;
  assert.equal(chat.filter(message => message.text.includes('참가자가 보낸 글')).length, 1, 'written to CCFOLIA exactly once');

  console.log(`bridge e2e: CCFOLIA→participant ${gmToPlayer}ms, participant→CCFOLIA→echo ${playerRoundTrip}ms (CCFOLIA copy +${copy.at - t2}ms; includes a 30ms simulated CCFOLIA write)`);
  assert(gmToPlayer < 1000, `CCFOLIA→participant took ${gmToPlayer}ms`);
  assert(playerRoundTrip < 1000, `participant round trip took ${playerRoundTrip}ms`);
  player.close();
  await admin('/api/share/stop', { roomId });
  setTimeout(() => process.exit(0), 100);
})().catch(error => { console.error(error); process.exit(1); });
