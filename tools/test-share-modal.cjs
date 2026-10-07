const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Runs the real share-modal.js (injected by the toolbar icon) against a stubbed chrome.* API and relay.
//   PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE, SCREENSHOT_DIR (optional)
const source = fs.readFileSync(path.join(__dirname, '..', 'extension/personal/share-modal.js'), 'utf8');
const stub = ({ storage, stopStatus = 200, participants = [] }) => `(() => {
  const store = ${JSON.stringify(storage)};
  const listeners = [];
  window.__calls = []; window.__messages = []; window.__confirm = true; window.__stopStatus = ${stopStatus}; window.__participants = ${JSON.stringify(participants)};
  window.chrome = {
    runtime: { sendMessage: async message => { window.__messages.push(message); } },
    storage: {
      onChanged: { addListener: fn => listeners.push(fn), removeListener: fn => listeners.splice(listeners.indexOf(fn), 1) },
      local: {
        get: (keys, callback) => callback(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]))),
        set: async value => { const changes = {}; for (const [k, v] of Object.entries(value)) { changes[k] = { newValue: v }; } Object.assign(store, value); listeners.forEach(fn => fn(changes, 'local')); },
        remove: async keys => { for (const key of [].concat(keys)) delete store[key]; }
      }
    }
  };
  window.__store = store; window.__listeners = listeners;
  window.confirm = () => window.__confirm;
  window.fetch = async (url, options = {}) => {
    window.__calls.push({ url, method: options.method || 'GET', auth: options.headers && options.headers.Authorization, body: options.body ? JSON.parse(options.body) : undefined });
    if (/\\/share\\/stop$/.test(url)) return { ok: window.__stopStatus < 300, status: window.__stopStatus, json: async () => (window.__stopStatus < 300 ? { stopped: true } : { error: 'GM 인증 실패' }) };
    if (/\\/participants$/.test(url)) return { ok: true, status: 200, json: async () => ({ participants: window.__participants }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
})();`;
const base = { relayEnabled: true, relayUrl: 'https://relay.example.test', relayGmToken: 'tok', relayLastRoomId: 'R1', relayInviteUrl: 'https://relay.example.test/#room=R1&token=t' };
const flush = page => page.waitForTimeout(80);

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const open = async options => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent('<body style="background:#282828;color:#fff"><input id="chat"><main>room</main></body>');
    await page.evaluate(stub(options));
    await page.addScriptTag({ content: source });
    await page.waitForSelector('#capybara-share-modal-host', { state: 'attached' });
    await flush(page);
    return page;
  };
  const q = (page, selector) => page.locator(`#capybara-share-modal-host ${selector}`);
  try {
    // Form is filled from storage; invite URL, room and push-socket status are shown.
    {
      const page = await open({ storage: { ...base, relaySocket: { state: 'open', roomId: 'R1', at: Date.now() } }, participants: [
        { id: 'p1', displayName: '<b>x</b> 대기', status: 'pending' }, { id: 'p2', displayName: '승인된 사람', status: 'approved' }, { id: 'p3', displayName: '거절된 사람', status: 'rejected' }] });
      assert.equal(await q(page, '#title').textContent(), '웹 공유');
      assert.equal(await q(page, '#url').inputValue(), 'https://relay.example.test');
      assert.equal(await q(page, '#token').inputValue(), 'tok');
      assert.equal(await q(page, '#invite').inputValue(), base.relayInviteUrl);
      assert.equal(await q(page, '#enabled').isChecked(), true);
      assert.match(await q(page, '#socket').textContent(), /연결됨/);
      assert.match(await q(page, '#room').textContent(), /R1/);
      const rows = await q(page, '.participant').allTextContents();
      assert.equal(rows.length, 3);
      assert(rows[0].includes('<b>x</b> 대기') && rows[0].includes('대기 중'), 'HTML in names stays text');
      assert.equal(await q(page, '.participant b').count(), 0);
      assert.deepEqual(await q(page, 'button[data-decision]').evaluateAll(b => b.map(x => `${x.dataset.id}:${x.dataset.decision}`)), ['p1:approve', 'p1:reject', 'p2:revoke']);
      // Approve: authenticated POST for that participant.
      await q(page, 'button[data-decision="approve"]').click();
      await flush(page);
      const decision = (await page.evaluate(() => window.__calls)).find(c => /\/decision$/.test(c.url));
      assert.equal(decision.method, 'POST'); assert.equal(decision.auth, 'Bearer tok');
      assert(decision.url.endsWith('/api/admin/rooms/R1/participants/p1/decision')); assert.deepEqual(decision.body, { decision: 'approve' });
      // Layout: a centred dialog inside the viewport; labelled; modal.
      const box = await q(page, '.paper').boundingBox();
      assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800, 'dialog fits the viewport');
      assert.equal(await q(page, '.paper').getAttribute('aria-modal'), 'true');
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'share-modal.png') });
      await page.close();
    }
    // Save writes storage (HTTPS or local relay only).
    {
      const page = await open({ storage: { ...base } });
      await q(page, '#url').fill('http://evil.example'); await q(page, '#save').click(); await flush(page);
      assert.match(await q(page, '#toast').textContent(), /HTTPS 또는 로컬/);
      assert.equal(await page.evaluate(() => window.__store.relayUrl), 'https://relay.example.test');
      await q(page, '#url').fill('https://other.example.test/path'); await q(page, '#token').fill(' new '); await q(page, '#save').click(); await flush(page);
      const store = await page.evaluate(() => window.__store);
      assert.equal(store.relayUrl, 'https://other.example.test'); assert.equal(store.relayGmToken, 'new');
      await page.close();
    }
    // Stop: confirmed / declined / rejected / nothing shared.
    {
      const page = await open({ storage: { ...base } });
      await q(page, '#stop').click(); await flush(page);
      const stop = (await page.evaluate(() => window.__calls)).find(c => /\/api\/share\/stop$/.test(c.url));
      assert.equal(stop.method, 'POST'); assert.equal(stop.auth, 'Bearer tok'); assert.deepEqual(stop.body, { roomId: 'R1' });
      const store = await page.evaluate(() => window.__store);
      assert.equal(store.relayInviteUrl, undefined); assert.equal(store.relayLastRoomId, undefined); assert.equal(store.relayStop.roomId, 'R1');
      assert.equal(await q(page, '#invite').inputValue(), '');
      assert.match(await q(page, '#toast').textContent(), /중지했습니다/);
      await page.close();
    }
    {
      const page = await open({ storage: { ...base } });
      await page.evaluate(() => { window.__confirm = false; });
      await q(page, '#stop').click(); await flush(page);
      assert.equal((await page.evaluate(() => window.__calls)).filter(c => /share\/stop/.test(c.url)).length, 0);
      assert(await page.evaluate(() => !!window.__store.relayInviteUrl && !window.__store.relayStop));
      await page.close();
    }
    {
      const page = await open({ storage: { ...base }, stopStatus: 401 });
      await q(page, '#stop').click(); await flush(page);
      assert(await page.evaluate(() => !!window.__store.relayInviteUrl && !window.__store.relayStop));
      assert.match(await q(page, '#toast').textContent(), /GM 인증 실패/);
      assert.equal(await q(page, '#toast.error').count(), 1);
      await page.close();
    }
    {
      const page = await open({ storage: { ...base, relayLastRoomId: '' } });
      await q(page, '#stop').click(); await flush(page);
      assert.equal((await page.evaluate(() => window.__calls)).filter(c => /share\/stop/.test(c.url)).length, 0);
      assert.match(await q(page, '#toast').textContent(), /공유 중인 룸이 없습니다/);
      await page.close();
    }
    // Push-socket status line.
    for (const [info, expected] of [
      [{ state: 'closed', roomId: 'R1', at: Date.now(), code: 1006, reason: '' }, /끊김 \(코드 1006\)/],
      [{ state: 'closed', roomId: 'OTHER', at: Date.now(), code: 1006 }, /아직 연결 시도 없음/],
      [undefined, /아직 연결 시도 없음/],
    ]) {
      const page = await open({ storage: { ...base, ...(info ? { relaySocket: info } : {}) } });
      assert.match(await q(page, '#socket').textContent(), expected);
      await page.close();
    }
    // Live updates from storage while open (the bridge writes the invite URL after connecting).
    {
      const page = await open({ storage: { ...base, relayInviteUrl: '' } });
      assert.equal(await q(page, '#invite').inputValue(), '');
      await page.evaluate(() => chrome.storage.local.set({ relayInviteUrl: 'https://relay.example.test/#room=R1&token=new' }));
      assert.match(await q(page, '#invite').inputValue(), /token=new/);
      await page.close();
    }
    // Closing: X, 닫기, Escape, backdrop, toggling by a second injection; listeners are released.
    for (const how of ['x', 'close', 'escape', 'backdrop', 'toggle']) {
      const page = await open({ storage: { ...base } });
      if (how === 'x') await q(page, '#x').click();
      if (how === 'close') await q(page, '#close').click();
      if (how === 'escape') await page.keyboard.press('Escape');
      if (how === 'backdrop') await page.mouse.click(5, 5);
      if (how === 'toggle') await page.addScriptTag({ content: source });
      await page.waitForFunction(() => !document.getElementById('capybara-share-modal-host'));
      assert.equal(await page.evaluate(() => window.__listeners.length), 0, `${how}: storage listener removed`);
      await page.close();
    }
    // Typing inside the dialog never reaches the page's own shortcuts; clicking inside does not close it.
    {
      const page = await open({ storage: { ...base } });
      await page.evaluate(() => { window.__keys = 0; document.addEventListener('keydown', () => window.__keys++); });
      await q(page, '#url').click();
      await page.keyboard.type('abc');
      assert.equal(await page.evaluate(() => window.__keys), 0, 'keys stay inside the dialog');
      await q(page, '.paper').click({ position: { x: 20, y: 20 } });
      assert.equal(await page.locator('#capybara-share-modal-host').count(), 1);
      // "툴킷 열기" asks the background to open the toolkit panel and closes the modal.
      await q(page, '#toolkit').click();
      assert.deepEqual(await page.evaluate(() => window.__messages), [{ type: 'capybara-open-toolkit' }]);
      await page.waitForFunction(() => !document.getElementById('capybara-share-modal-host'));
      await page.close();
    }
    // Phone-width viewport: no horizontal overflow.
    {
      const page = await open({ storage: { ...base } });
      await page.setViewportSize({ width: 360, height: 640 });
      const box = await q(page, '.paper').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= 360 && box.y + box.height <= 640, 'fits a phone viewport');
      await page.close();
    }
    console.log('share modal: form, save rules, participants, stop flows, socket status, live updates, closing, key isolation, toolkit button, small viewport PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
