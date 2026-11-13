const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Hiding a message (GM only): the real chat panel script with a fake store and Firestore.
// GM: the eye button writes the message text with a hidden flag in its envelope (PATCH text + updatedAt), the hidden row stays dimmed with the "show again" button, and it is not relayed to the participants;
// showing it again writes the plain text back. A non-GM account: the hidden row is gone, no buttons, and hiding is refused. The real format-sync script marks the render root of a hidden message.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
const sync = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS = /[\u2063\u200b-\u200d\u2060\u2062]/u;

async function open(browser, ownerUid, withSync) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const patches = [];
  await context.route(withSync ? 'https://ccfolia.com/**' : 'https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body><div id="root"></div></body>' }));
  await context.route('https://firestore.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') { patches.push({ url: req.url(), body: JSON.parse(req.postData()) }); return route.fulfill({ contentType: 'application/json', body: '{}' }); }
    return route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.goto(withSync ? 'https://ccfolia.com/rooms/test' : 'https://ccfolia.test/rooms/test');
  await page.evaluate(async (owner) => {
    await new Promise((resolve, reject) => { const req = indexedDB.open('firebaseLocalStorageDb', 1); req.onupgradeneeded = () => req.result.createObjectStore('firebaseLocalStorage', { autoIncrement: true }); req.onsuccess = () => { const tx = req.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ value: { uid: 'u1', stsTokenManager: { accessToken: 'tok', expirationTime: Date.now() + 3600000 } } }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }; req.onerror = () => reject(req.error); });
    const now = Math.floor(Date.now() / 1000);
    const entities = { m1: { name: '눈깅이', text: '보이는 말', channel: 'main', createdAt: { seconds: now - 20, nanoseconds: 0 } }, m3: { name: '눈깅이', text: '다른 말', channel: 'main', createdAt: { seconds: now - 10, nanoseconds: 0 } } };
    const state = { entities: { roomMessages: { entities, ids: ['m1', 'm3'], idsGroupBy: { main: ['m1', 'm3'] } }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner } } } } };
    window.__state = state;
    document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
  }, ownerUid);
  if (withSync) await page.addScriptTag({ content: sync });
  await page.addScriptTag({ content: source });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
  await page.waitForTimeout(2200); // the GM check runs every 1.5 s until known
  return { context, page, patches };
}

// the log package drops hidden entries before it builds the package
const logSrc = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-log-package.user.js'), 'utf8');
assert.match(logSrc, /function isHiddenLogEntry\(entry\)/);
assert.match(logSrc, /entries\.filter\(\(entry\) => !isHiddenLogEntry\(entry\)\)/);
assert.match(sync, /out\.hidden = true/);
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    // ---- GM (the owner of the room is the logged-in account u1)
    {
      const { context, page, patches } = await open(browser, 'u1', false);
      assert.equal(await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.isGm()), true, 'the owner is the GM');
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ccf-gm')), '1');
      // the eye button of a row of the panel
      const row = page.locator('#ccf-second-chat-panel [data-ccf-msg-id="m1"]');
      await row.hover();
      const eye = row.locator('.ccf-hide-btn');
      assert.equal(await eye.count(), 1, 'the GM sees the eye button');
      assert.equal(await eye.getAttribute('title'), '숨기기');
      await eye.click({ force: true });
      await page.waitForTimeout(400);
      assert.equal(patches.length, 1, 'one write');
      assert.match(patches[0].url, /rooms\/test\/messages\/m1\?updateMask\.fieldPaths=text&updateMask\.fieldPaths=updatedAt/);
      const hiddenText = patches[0].body.fields.text.stringValue;
      assert.ok(hiddenText.startsWith('보이는 말') && INVIS.test(hiddenText), 'the visible text stays, the envelope carries the flag');
      // the store now has the hidden text (as Firestore would deliver it)
      await page.evaluate((t) => { window.__state.entities.roomMessages.entities.m1.text = t; }, hiddenText);
      await page.waitForTimeout(1500);
      const dim = await page.evaluate(() => { const r = document.querySelector('#ccf-second-chat-panel [data-ccf-msg-id="m1"]'); return { hidden: r?.getAttribute('data-ccf-hidden-row'), title: r?.querySelector('.ccf-hide-btn')?.title, body: r ? getComputedStyle(r.querySelector('.ccf-scp-text, p.MuiListItemText-secondary')).display : null, fold: r?.querySelector('.ccf-hidden-fold')?.textContent || null }; });
      assert.equal(dim.hidden, '1', 'the hidden row stays for the GM, marked'); assert.equal(dim.title, '다시 보이기'); assert.deepEqual([dim.body, dim.fold], ['none', '숨긴 메시지 · 펼치기'], 'folded to one line (0.5.39): ' + JSON.stringify(dim));
      // not relayed
      const relayed = await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.relayMessages().map((m) => m.id));
      assert.deepEqual(relayed, ['m3'], 'the participants do not get the hidden message');
      // show again
      await page.locator('#ccf-second-chat-panel [data-ccf-msg-id="m1"]').hover();
      await page.locator('#ccf-second-chat-panel [data-ccf-msg-id="m1"] .ccf-hide-btn').click({ force: true });
      await page.waitForTimeout(400);
      assert.equal(patches.length, 2); assert.equal(patches[1].body.fields.text.stringValue, '보이는 말', 'showing again writes the plain text back');
      await context.close();
    }
    // ---- not the GM
    {
      const { context, page, patches } = await open(browser, 'someone-else', false);
      assert.equal(await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.isGm()), false);
      const hiddenText = '숨은 말' + await page.evaluate(() => 'x'); // placeholder, replaced below
      void hiddenText;
      // give the page a hidden message made by the GM's script: reuse the text of a GM run
      const gm = await open(browser, 'u1', false);
      await gm.page.locator('#ccf-second-chat-panel [data-ccf-msg-id="m3"]').hover();
      await gm.page.locator('#ccf-second-chat-panel [data-ccf-msg-id="m3"] .ccf-hide-btn').click({ force: true });
      await gm.page.waitForTimeout(400);
      const t = gm.patches[0].body.fields.text.stringValue;
      await gm.context.close();
      await page.evaluate((text) => { window.__state.entities.roomMessages.entities.m3.text = text; }, t);
      await page.waitForTimeout(1600);
      const rows = await page.evaluate(() => [...document.querySelectorAll('#ccf-second-chat-panel [data-ccf-msg-id]')].map((r) => r.getAttribute('data-ccf-msg-id')));
      assert.deepEqual(rows, ['m1'], 'the hidden message is gone from a non-GM panel');
      assert.equal(await page.locator('.ccf-hide-btn').count(), 0, 'no eye buttons for a non-GM');
      await assert.rejects(page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.setMessageHidden('m1', true)), /GM/);
      assert.equal(patches.length, 0, 'nothing was written');
      await context.close();
    }
    // ---- the format-sync renderer marks the render root of a hidden message
    {
      const { context, page } = await open(browser, 'u1', true);
      const gmRow = page.locator('#ccf-second-chat-panel [data-ccf-msg-id="m1"]');
      await gmRow.hover();
      // an original chat row (native list) gets the button too, matched to its message by the text
      await page.evaluate(() => { const ul = document.createElement('ul'); ul.id = 'nat'; ul.innerHTML = '<li class="MuiListItem-root" style="position:relative;height:60px"><h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">보이는 말</p><div class="act" style="position:absolute;right:16px;top:8px;display:flex;gap:6px"><button style="width:30px;height:30px">답</button><button style="width:30px;height:30px">수</button></div></li><li class="MuiListItem-root" style="position:relative"><h6 class="MuiListItemText-primary">눈깅이</h6><p class="MuiListItemText-secondary">다른 말</p></li>'; document.getElementById('root').append(ul); });
      await page.waitForTimeout(2000);
      const ids = await page.evaluate(() => [...document.querySelectorAll('#nat .ccf-hide-btn')].map((b) => b.dataset.id));
      assert.deepEqual(ids, ['m1', 'm3'], 'eye buttons on the original rows, matched to the messages: ' + JSON.stringify(ids));
      // the eye sits right next to the native hover buttons (to their left, same height)
      await page.locator('#nat > li').first().hover();
      await page.waitForTimeout(200);
      const pos = await page.evaluate(() => { const li = document.querySelector('#nat > li'); const eye = li.querySelector('.ccf-hide-btn'); const act = li.querySelector('.act'); return { inGroup: eye.parentElement === act, before: eye.nextElementSibling === act.querySelector('button:not(.ccf-hide-btn):not(.ccf-break-btn)'), cls: eye.className }; });
      assert.ok(pos.inGroup && pos.before, 'the eye button sits in the native hover button group, just before the edit button: ' + JSON.stringify(pos));
      assert.equal(await page.locator('#nat > li').first().locator('.ccf-hide-btn').count(), 1, 'still one eye button');
      await context.close();
    }
    console.log('message hide PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
