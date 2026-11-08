const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Another tab: the real panel script asks for that tab only (where channel == X, newest first), shows the first page at once, keeps what it got per tab (choosing the tab again needs no request),
// and falls back to the old page scan when the server refuses the query (no index, HTTP 400). The fake server answers like Firestore does, 300 ms per request.
const sourcePath = process.env.PANEL_SOURCE || path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const run = async (allowFilter) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const base = Date.now() - 20 * 3600000, docs = [];
    for (let i = 0; i < 450; i += 1) docs.push({ id: 'm' + i, channel: 'main', text: '메인 ' + i, at: base + 100000 + i * 1000 });
    for (let i = 0; i < 5; i += 1) docs.push({ id: 'i' + i, channel: 'info', text: '정보 ' + i, at: base + i * 1000 }); // older than every main message
    docs.sort((a, b) => b.at - a.at);
    const toDoc = (d) => ({ document: { name: `projects/p/databases/(default)/documents/rooms/test/messages/${d.id}`, fields: { channel: { stringValue: d.channel }, text: { stringValue: d.text }, name: { stringValue: '눈깅이' }, createdAt: { timestampValue: new Date(d.at).toISOString() }, type: { stringValue: 'text' } } } });
    const requests = [];
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', async (route) => {
      const q = JSON.parse(route.request().postData() || '{}').structuredQuery || {};
      const filtered = !!q.where; requests.push({ filtered, limit: q.limit, at: Date.now() });
      await new Promise((r) => setTimeout(r, 300));
      if (filtered && !allowFilter) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { status: 'FAILED_PRECONDITION', message: 'The query requires an index.' } }) });
      let rows = docs;
      if (filtered) rows = rows.filter((d) => d.channel === q.where.fieldFilter.value.stringValue);
      const cursor = q.startAt && q.startAt.values[0] && Date.parse(q.startAt.values[0].timestampValue);
      if (cursor) rows = rows.filter((d) => d.at < cursor);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows.slice(0, q.limit || 100).map(toDoc)) });
    });
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(async (baseMs) => {
      await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = reject; }; req.onerror = reject; });
      const entities = {}, main = [];
      for (let i = 0; i < 3; i += 1) { const id = 'n' + i; entities[id] = { name: '눈깅이', text: '최근 ' + i, channel: 'main', createdAt: { seconds: Math.floor((baseMs + 100000 + 450000 + i * 1000) / 1000), nanoseconds: 0 } }; main.push(id); }
      const state = { entities: { roomMessages: { entities, ids: main, idsGroupBy: { main } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    }, base);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(400);
    const pick = (re) => page.evaluate((src) => { [...document.querySelectorAll('.ccf-scp-tab')].find((t) => new RegExp(src, 'i').test(t.textContent)).click(); }, re.source);
    const has = () => page.evaluate(() => /정보 4/.test(document.querySelector('.ccf-scp-list')?.innerText || ''));
    const t0 = Date.now(); await pick(/정보|info/);
    let shownAfter = null; while (Date.now() - t0 < 8000) { if (await has()) { shownAfter = Date.now() - t0; break; } await page.waitForTimeout(25); }
    // all five messages of the tab
    await page.waitForTimeout(1500);
    const count = await page.evaluate(() => [...document.querySelectorAll('.ccf-scp-list li')].filter((li) => /정보 \d/.test(li.innerText)).length);
    // away and back: nothing new is requested
    const before = requests.length; await pick(/메인|main/); await page.waitForTimeout(300); await pick(/정보|info/); await page.waitForTimeout(600);
    const again = requests.length - before;
    return { shownAfter, count, requests: requests.length, filteredRequests: requests.filter((r) => r.filtered).length, firstLimit: requests[0] && requests[0].limit, again };
  } finally { await browser.close(); }
};
(async () => {
  const withFilter = await run(true);
  console.log('with channel query:', JSON.stringify(withFilter));
  if (process.env.PANEL_SOURCE) return; // old code: just print the numbers
  assert.ok(withFilter.shownAfter !== null && withFilter.shownAfter < 1200, 'the tab shows quickly: ' + withFilter.shownAfter);
  assert.equal(withFilter.count, 5); assert.equal(withFilter.firstLimit, 30, 'the first request is one screen worth'); assert.ok(withFilter.filteredRequests >= 1);
  assert.equal(withFilter.again, 0, 'choosing the tab again requests nothing');
  const fallback = await run(false);
  console.log('server refuses the query:', JSON.stringify(fallback));
  assert.equal(fallback.count, 5, 'the old page scan still finds the tab'); assert.ok(fallback.filteredRequests === 1, 'only one refused attempt, then the old way');
  console.log('chat panel channel query PASS');
})().catch((e) => { console.error(e); process.exit(1); });
