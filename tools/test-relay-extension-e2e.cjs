const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Real extension in Chromium on a mocked https://ccfolia.com room with a STRICT page CSP, against a local
// `wrangler dev --port 8787 --var GM_TOKEN:test-gm-token` (8787 is the only http relay origin the extension accepts).
// The CCFOLIA chat store is simulated by a stub of window.__CCF_SECOND_CHAT_PANEL__.
(async () => {
  const base = 'http://127.0.0.1:8787';
  const token = process.env.RELAY_GM_TOKEN || 'test-gm-token';
  const roomId = `ext-${Date.now().toString(36)}`;
  const extension = path.resolve(__dirname, '../extension/personal');
  const admin = (url, body) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    // Test environment only: the https mock page talks to an http loopback relay (Private Network Access checks would block it).
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-features=PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks'],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(settings => chrome.storage.local.set(settings), { relayEnabled: true, relayUrl: base, relayGmToken: token });
    // Only the CCFOLIA hosts are mocked; relay traffic must go over the real network (CORS preflight included).
    await context.route(url => ['ccfolia.com', 'asp0902.github.io'].includes(url.hostname), route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'ccfolia.com' && route.request().isNavigationRequest()) {
        return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'" }, body: '<!doctype html><html><head></head><body><main>mock room</main></body></html>' });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage();
    const sent = [];
    // Simulated CCFOLIA chat store + panel API (what legacy/ccfolia-chat-panel exposes).
    await page.addInitScript(() => {
      const messages = []; const subscribers = [];
      window.__sentToCcfolia = [];
      const add = (name, text) => { messages.push({ id: `m${messages.length + 1}`, name, text, at: Date.now() }); subscribers.forEach(fn => fn()); };
      window.__ccfoliaSay = (name, text) => add(name, text);
      window.__CCF_SECOND_CHAT_PANEL__ = {
        relayMessages: () => messages.map(message => ({ ...message })),
        relaySubscribe: callback => { subscribers.push(callback); return () => {}; },
        relaySend: async (name, text) => { window.__sentToCcfolia.push({ name, text, at: Date.now() }); await new Promise(resolve => setTimeout(resolve, 20)); add('GM', `[참여자 웹 · ${name}] ${text}`); },
      };
    });
    await page.goto(`https://ccfolia.com/rooms/${roomId}`);
    const inviteUrl = await (async () => {
      for (let waited = 0; waited < 8000; waited += 100) {
        const value = (await worker.evaluate(() => chrome.storage.local.get('relayInviteUrl'))).relayInviteUrl;
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('extension did not connect to the relay');
    })();
    const inviteToken = new URLSearchParams(inviteUrl.split('#')[1]).get('token');

    // A participant joins and opens the push socket.
    const join = await fetch(base + '/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, token: inviteToken, displayName: '확장 참가자' }) });
    const cookie = `capybara_session=${/capybara_session=([^;]+)/.exec(join.headers.get('set-cookie'))[1]}`;
    const participantId = (await (await admin(`/api/admin/rooms/${roomId}/participants`)).json()).participants[0].id;
    await admin(`/api/admin/rooms/${roomId}/participants/${participantId}/decision`, { decision: 'approve' });
    const events = [];
    const player = new WebSocket(base.replace(/^http/, 'ws') + `/api/rooms/${roomId}/ws`, { headers: { Cookie: cookie } });
    player.addEventListener('message', event => { try { events.push({ at: Date.now(), ...JSON.parse(event.data) }); } catch (_) {} });
    await new Promise((resolve, reject) => { player.addEventListener('open', resolve); player.addEventListener('error', () => reject(new Error('participant socket failed'))); });
    const waitFor = async (predicate, ms = 3000) => { const started = Date.now(); while (Date.now() - started < ms) { const found = events.find(predicate); if (found) return found; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error(`timeout; events: ${JSON.stringify(events.map(({ at, ...rest }) => rest))}`); };
    await new Promise(resolve => setTimeout(resolve, 600)); // let the GM push socket come up

    // CCFOLIA -> participant: store change -> subscription -> snapshot -> bridge POST -> worker push.
    const t1 = Date.now();
    await page.evaluate(() => window.__ccfoliaSay('GM', '확장 경유 글'));
    const seen = await waitFor(event => event.type === 'message' && event.message.text === '확장 경유 글');
    const gmToPlayer = seen.at - t1;

    // Participant -> CCFOLIA: POST -> GM push -> bridge -> page relaySend -> ack -> echo.
    const t2 = Date.now();
    const send = await fetch(base + `/api/rooms/${roomId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ clientMessageId: 'x1', text: '참가자 발언' }) });
    assert.equal(send.status, 202);
    const echo = await waitFor(event => event.type === 'message' && event.message.origin === 'external' && event.message.text === '참가자 발언');
    const roundTrip = echo.at - t2;
    const writes = await page.evaluate(() => window.__sentToCcfolia);
    assert.equal(writes.length, 1, 'written to CCFOLIA exactly once');
    assert.equal(writes[0].name, '확장 참가자');
    const reachedCcfolia = writes[0].at - t2;

    console.log(`extension e2e (strict page CSP): CCFOLIA→participant ${gmToPlayer}ms, participant→CCFOLIA write ${reachedCcfolia}ms, echo ${roundTrip}ms`);
    assert(gmToPlayer < 1000 && reachedCcfolia < 1000 && roundTrip < 1500);
    player.close();
    await admin('/api/share/stop', { roomId });
  } finally {
    await context.close();
    setTimeout(() => process.exit(process.exitCode || 0), 100);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
