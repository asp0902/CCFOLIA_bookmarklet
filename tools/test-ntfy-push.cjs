const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Phone push (ntfy): the page side (ntfy-page.js: who/when/how much is sent) and the background side (background.js: the request that goes out). The real files; no network.
const ext = path.join(__dirname, '../extension/personal');
const pageJs = fs.readFileSync(path.join(ext, 'ntfy-page.js'), 'utf8');
const bridgeJs = fs.readFileSync(path.join(ext, 'ntfy-bridge.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(ext, 'background.js'), 'utf8');

async function backgroundPart() {
  const fetches = []; const listeners = []; let stored = {}; let allowed = [];
  const sandbox = {
    URL, console: { error() {} }, Date, JSON, Promise,
    fetch: async (url, init) => { fetches.push({ url, init }); return { ok: true, status: 200 }; },
    chrome: {
      action: { onClicked: { addListener() {} }, getBadgeText: async () => '', setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
      runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
      tabs: { onUpdated: { addListener() {} }, onCreated: { addListener() {} }, onRemoved: { addListener() {} }, create: async () => {} },
      storage: { local: { get: async () => stored, set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
      scripting: { executeScript: async () => [{ result: true }] },
      permissions: { contains: async ({ origins }) => origins.every(o => allowed.includes(o)) }
    }
  };
  vm.runInNewContext(backgroundJs, sandbox);
  const ask = (message, sender = { tab: { id: 1, url: 'https://ccfolia.com/rooms/abc' } }) => new Promise(resolve => {
    let handled = false;
    for (const listener of listeners) { const r = listener(message, sender, answer => { handled = true; resolve(JSON.parse(JSON.stringify(answer))); }); if (r === true) handled = true; }
    if (!handled) resolve(null);
  });
  const payload = { title: '눈깅이님 메시지 · 테스트룸', message: '새 메시지가 도착했습니다.', click: 'https://ccfolia.com/rooms/abc' };
  // off -> nothing is sent
  stored = { ntfy: { enabled: false, topic: 'capy-abc', server: 'https://ntfy.sh' } };
  assert.deepEqual(await ask({ type: 'ntfy-send', payload }), { ok: false, error: '꺼져 있음' }); assert.equal(fetches.length, 0);
  // on -> one JSON publish to the server root
  stored = { ntfy: { enabled: true, topic: 'capy-abc', server: 'https://ntfy.sh' } };
  assert.deepEqual(await ask({ type: 'ntfy-send', payload }), { ok: true });
  assert.equal(fetches.length, 1); assert.equal(fetches[0].url, 'https://ntfy.sh/'); assert.equal(fetches[0].init.method, 'POST');
  const body = JSON.parse(fetches[0].init.body);
  assert.deepEqual(body, { topic: 'capy-abc', title: '눈깅이님 메시지 · 테스트룸', message: '새 메시지가 도착했습니다.', tags: ['speech_balloon'], click: 'https://ccfolia.com/rooms/abc' });
  assert.ok(!/token|email|uid|authorization/i.test(fetches[0].init.body + JSON.stringify(fetches[0].init.headers)), 'no account data in the request');
  // a click address outside CCFOLIA is dropped; the topic must be plain
  fetches.length = 0;
  await ask({ type: 'ntfy-send', payload: { ...payload, click: 'https://evil.example/x' } });
  assert.equal('click' in JSON.parse(fetches[0].init.body), false, 'foreign click address dropped');
  stored = { ntfy: { enabled: true, topic: '../x y', server: 'https://ntfy.sh' } };
  const bad = await ask({ type: 'ntfy-send', payload }); assert.equal(bad.ok, false);
  // another server needs the site permission; http (not local) is refused
  stored = { ntfy: { enabled: true, topic: 'capy-abc', server: 'https://ntfy.example.org' } };
  fetches.length = 0;
  assert.equal((await ask({ type: 'ntfy-send', payload })).ok, false); assert.equal(fetches.length, 0);
  allowed = ['https://ntfy.example.org/*'];
  assert.deepEqual(await ask({ type: 'ntfy-send', payload }), { ok: true }); assert.equal(fetches[0].url, 'https://ntfy.example.org/');
  stored = { ntfy: { enabled: true, topic: 'capy-abc', server: 'http://ntfy.example.org' } };
  assert.equal((await ask({ type: 'ntfy-send', payload })).ok, false);
  // the test button sends although the switch is off; messages from other tabs are ignored; at most 12 a minute
  stored = { ntfy: { enabled: false, topic: 'capy-abc', server: 'https://ntfy.sh' } };
  fetches.length = 0;
  assert.deepEqual(await ask({ type: 'ntfy-test', payload }), { ok: true });
  assert.equal(await ask({ type: 'ntfy-send', payload }, { tab: { id: 2, url: 'https://example.org/' } }), null, 'only room tabs');
  stored = { ntfy: { enabled: true, topic: 'capy-abc', server: 'https://ntfy.sh' } };
  let capped = 0; for (let i = 0; i < 20; i += 1) { const r = await ask({ type: 'ntfy-send', payload }); if (!r.ok && /상한/.test(r.error)) capped += 1; }
  assert.ok(capped >= 6, 'per-minute cap in the background: ' + capped);
}

(async () => {
  await backgroundPart();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route('https://ccfolia.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<title>테스트룸 - CCFOLIA</title><body><input name="name" value="내 캐릭터"></body>' }));
    await page.clock.install();
    await page.goto('https://ccfolia.com/rooms/abc');
    await page.evaluate(() => { window.__sent = []; window.addEventListener('message', (e) => { if (e.data?.source === 'capybara-ntfy' && e.data.direction === 'page' && e.data.action === 'send') window.__sent.push(e.data.payload); window.__times = (window.__times || []).concat(Date.now()); }); });
    await page.addScriptTag({ content: pageJs });
    const config = (c) => page.evaluate((cfg) => { window.postMessage({ source: 'capybara-ntfy', direction: 'bridge', action: 'config', config: cfg }, location.origin); return new Promise((r) => setTimeout(r, 0)); }, c);
    const hook = (info) => page.evaluate((i) => window.__CCF_NTFY_HOOK__(i), info);
    const sent = () => page.evaluate(() => window.__sent.splice(0));
    const base = { enabled: true, topic: 'capy-abc', server: 'https://ntfy.sh', scope: 'all', keywords: [], onlyAway: true, includeText: false };
    // no config / off -> nothing
    assert.equal(await hook({ name: '하나', text: '안녕' }), false);
    await config({ ...base, enabled: false }); await page.clock.runFor(10); assert.equal(await hook({ name: '하나', text: '안녕' }), false);
    // looking at the room (visible and focused): nothing, unless "always"
    await config(base); await page.clock.runFor(10);
    await page.evaluate(() => { document.hasFocus = () => true; });
    assert.equal(await hook({ name: '하나', text: '안녕' }), false, 'the room is in front');
    assert.match(await page.evaluate(() => window.__CCF_NTFY_STATE__.lastSkip), /^룸 화면을 보고 있음\(최근 조작 \d+초 전\)$/);
    // idle: visible and focused, but no input for the set minutes (default 2) -> away
    await page.clock.runFor(60_000); assert.equal(await hook({ name: '하나', text: '1분' }), false, '1 min of no input is still "present"');
    await page.mouse.move(5, 5); await page.clock.runFor(1000);
    assert(await page.evaluate(() => Date.now() - window.__CCF_NTFY_STATE__.lastInputAt) < 2000, 'input is recorded (lastInputAt)');
    await page.clock.runFor(121_000); assert.equal(await hook({ name: '하나', text: '자리 비움' }), true, '2 min without input -> away');
    assert.equal((await sent()).length, 1);
    await page.clock.runFor(11_000); await sent();
    await config({ ...base, awayMinutes: 5 }); await page.clock.runFor(10);
    await page.keyboard.press('a'); await page.clock.runFor(180_000);
    assert.equal(await hook({ name: '하나', text: 'x' }), false, 'custom 5 min: 3 min is not away');
    await page.clock.runFor(130_000); assert.equal(await hook({ name: '하나', text: 'x' }), true, 'custom 5 min passed');
    await sent(); await page.clock.runFor(11_000); await sent();
    await config(base); await page.clock.runFor(10);
    await page.mouse.move(9, 9); await page.clock.runFor(100);
    // away: the first message goes at once with the title "sender + room", no text by default
    await page.evaluate(() => { document.hasFocus = () => false; });
    assert.equal(await hook({ name: '하나', text: '비밀 내용' }), true);
    let out = await sent(); assert.equal(out.length, 1);
    assert.deepEqual(out[0], { title: '하나님 메시지 · 테스트룸', message: '새 메시지가 도착했습니다.', click: 'https://ccfolia.com/rooms/abc' });
    // the next ones within 10 s are gathered into one notification
    await hook({ name: '둘', text: 'b' }); await hook({ name: '둘', text: 'c' }); await hook({ name: '셋', text: 'd' });
    assert.equal((await sent()).length, 0, 'held back');
    await page.clock.runFor(10_500);
    out = await sent(); assert.equal(out.length, 1, 'one summary'); assert.equal(out[0].title, '둘 외 2건 · 테스트룸');
    // room name: the site's default tab title (with unread count) is not a room name; the room heading wins when present
    const titleOf = async (docTitle, heading) => { await page.evaluate(([t, h]) => { document.title = t; document.querySelectorAll('h6').forEach((e) => e.remove()); if (h) { const e = document.createElement('h6'); e.className = 'MuiTypography-subtitle2'; e.textContent = h; e.style.display = 'block'; document.body.append(e); } }, [docTitle, heading]); await page.clock.runFor(61_000); await hook({ name: '에르네스토', text: 'x' }); await page.clock.runFor(10_000); const o = await sent(); return o[0]?.title; };
    assert.equal(await titleOf('(1) CCFOLIA 1.37.6 – TRPGオンラインセッションツール', ''), '에르네스토님 메시지 · 코코포리아');
    assert.equal(await titleOf('(3) 테스트룸 - CCFOLIA', ''), '에르네스토님 메시지 · 테스트룸');
    assert.equal(await titleOf('(1) CCFOLIA 1.37.6 – TRPGオンラインセッションツール', '진짜 룸'), '에르네스토님 메시지 · 진짜 룸');
    await page.evaluate(() => { document.title = '테스트룸 - CCFOLIA'; document.querySelectorAll('h6').forEach((e) => e.remove()); });
    await page.clock.runFor(20_000); await sent();
    // my own message is left out (the speaker name field), keywords narrow it, the text can be added
    await page.clock.runFor(11_000);
    assert.equal(await hook({ name: '내 캐릭터', text: '내가 보냄' }), false, 'own message');
    await config({ ...base, scope: 'keywords', keywords: ['눈깅이'] }); await page.clock.runFor(10);
    assert.equal(await hook({ name: '하나', text: '관계없음' }), false, 'no keyword');
    assert.equal(await hook({ name: '하나', text: '눈깅이 안녕' }), true);
    await sent(); await page.clock.runFor(11_000);
    await config({ ...base, includeText: true }); await page.clock.runFor(10);
    await hook({ name: '하나', text: '이 글이 알림에 들어갑니다' });
    out = await sent(); assert.equal(out[0].message, '하나: 이 글이 알림에 들어갑니다');
    // "always": also while looking at the room
    await page.clock.runFor(11_000);
    await config({ ...base, onlyAway: false }); await page.clock.runFor(10);
    await page.evaluate(() => { document.hasFocus = () => true; });
    assert.equal(await hook({ name: '하나', text: 'x' }), true);
    await sent();
    // at most 6 a minute
    await page.clock.runFor(11_000);
    await page.evaluate(() => { document.hasFocus = () => false; });
    await config(base); await page.clock.runFor(10);
    await page.evaluate(() => { window.__times = []; });
    for (let i = 0; i < 14; i += 1) { await hook({ name: '하나' + i, text: 'm' }); await page.clock.runFor(4_000); }
    await page.clock.runFor(12_000);
    const times = await page.evaluate(() => window.__times);
    const worst = Math.max(...times.map((t) => times.filter((u) => u >= t && u < t + 60_000).length));
    assert.ok(times.length >= 3 && worst <= 6, 'at most 6 notifications in any minute (the rest are gathered): ' + JSON.stringify({ count: times.length, worst }));
    // the bridge hands the stored settings to the page and a send request to the background
    const bridgeSandbox = { sent: [], posted: [] };
    const windowFake = { top: null, origin: 'https://ccfolia.com', listeners: [], postMessage(data) { bridgeSandbox.posted.push(JSON.parse(JSON.stringify(data))); }, addEventListener(type, fn) { this.listeners.push(fn); } };
    windowFake.top = windowFake;
    let changed;
    vm.runInNewContext(bridgeJs, {
      window: windowFake, location: { origin: 'https://ccfolia.com' }, Promise,
      chrome: { storage: { local: { get: async () => ({ ntfy: { enabled: true, topic: 'capy-abc' } }) }, onChanged: { addListener: fn => { changed = fn; } } }, runtime: { sendMessage: async (m) => { bridgeSandbox.sent.push(JSON.parse(JSON.stringify(m))); return { ok: true }; } } }
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(bridgeSandbox.posted[0], { source: 'capybara-ntfy', direction: 'bridge', action: 'config', config: { enabled: true, topic: 'capy-abc' } });
    changed({ ntfy: { newValue: { enabled: false } } }, 'local');
    assert.equal(bridgeSandbox.posted[1].config.enabled, false);
    windowFake.listeners[0]({ source: windowFake, origin: 'https://ccfolia.com', data: { source: 'capybara-ntfy', direction: 'page', action: 'send', payload: { title: 't', message: 'm', click: 'c', topic: 'attacker', server: 'https://evil' } } });
    assert.deepEqual(bridgeSandbox.sent, [{ type: 'ntfy-send', payload: { title: 't', message: 'm', click: 'c' } }], 'only title, text and click address go on; the server and topic are the stored ones');
    // the notifier calls the hook for a newly registered live message
    assert.match(fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8'), /window\.__CCF_NTFY_HOOK__\(\{ name, text: extractMessageText\(itemRoot\) \}\)/);
    // the settings dialog: topic made on first save, saved to chrome.storage.local.ntfy, the test button asks the background, the phone link is shown
    const modalPage = await context.newPage();
    await modalPage.route('https://ccfolia.com/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<body></body>' }));
    await modalPage.goto('https://ccfolia.com/rooms/abc');
    await modalPage.evaluate(() => {
      const store = {}; window.__sentMsgs = [];
      window.chrome = { storage: { local: { get: (keys, cb) => { const r = {}; for (const k of [].concat(keys)) if (k in store) r[k] = store[k]; if (cb) cb(r); return Promise.resolve(r); }, set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); }, remove: async () => {} }, onChanged: { addListener() {}, removeListener() {} } }, runtime: { id: 'x', sendMessage: async (m) => { window.__sentMsgs.push(m); return { ok: true }; } } };
      window.__store = store;
    });
    await modalPage.addScriptTag({ content: fs.readFileSync(path.join(ext, 'share-modal.js'), 'utf8') });
    await modalPage.waitForFunction(() => !!document.getElementById('capybara-share-modal-host'));
    const q = (sel) => modalPage.locator('#capybara-share-modal-host ' + sel);
    await q('#ntfy-save').scrollIntoViewIfNeeded();
    await q('.ntfy label.switch').click(); assert.equal(await q('#ntfy-enabled').isChecked(), true, 'the title-side switch turns it on'); await q('#ntfy-save').click();
    await modalPage.waitForFunction(() => window.__store.ntfy);
    const saved = await modalPage.evaluate(() => window.__store.ntfy);
    assert.match(saved.topic, /^capy-[a-z2-7]{24}$/); assert.equal(saved.enabled, true); assert.equal(saved.onlyAway, true); assert.equal(saved.includeText, false); assert.equal(saved.server, 'https://ntfy.sh');
    assert.equal(await q('#ntfy-link').textContent(), 'ntfy://ntfy.sh/' + saved.topic);
    await q('#ntfy-text').check(); await q('#ntfy-test').click();
    await modalPage.waitForFunction(() => window.__sentMsgs.some((m) => m.type === 'ntfy-test'));
    const asked = await modalPage.evaluate(() => window.__sentMsgs.find((m) => m.type === 'ntfy-test'));
    assert.equal(asked.payload.title, '카피바라 테스트 알림');
    assert.equal((await modalPage.evaluate(() => window.__store.ntfy)).includeText, true, 'the test saves the settings first');
    console.log('ntfy push PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
