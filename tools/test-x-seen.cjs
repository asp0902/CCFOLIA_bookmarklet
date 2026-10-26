const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// x.com "seen" check: the ✓ button sits right of the like button (one per tweet, none doubled on redraw), checking is by hand only, a checked tweet's timeline cell is hidden with a 5 s undo
// (not the main tweet of a tweet page, not when the switch is off), the left menu gets one "확인한 트윗" item under the bookmarks that asks for the list page, and the list page shows 20 at a time.
const root = path.join(__dirname, '..', 'extension', 'personal');
const source = fs.readFileSync(path.join(root, 'x-seen.js'), 'utf8');
const stub = () => {
  const store = {}; const listeners = []; const sent = [];
  const pick = k => (Array.isArray(k) ? Object.fromEntries(k.map(key => [key, store[key]])) : { [k]: store[k] });
  window.chrome = { runtime: { id: 'x', sendMessage: async m => { sent.push(m); } }, storage: { local: { get: async k => pick(k), set: async o => { const changes = {}; for (const k in o) { changes[k] = { newValue: o[k] }; store[k] = o[k]; } listeners.forEach(fn => fn(changes, 'local')); } }, onChanged: { addListener: fn => listeners.push(fn) } } };
  window.__store = store; window.__sent = sent; window.__opened = 0;
};
const tweet = (id, { liked = false } = {}) => `<div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/u/status/${id}"><time>1h</time></a><div role="group" style="display:flex;align-items:center;height:48px"><div class="cell"><button data-testid="${liked ? 'unlike' : 'like'}">♥</button></div><div class="cell"><button data-testid="retweet">⟲</button></div></div></article></div>`;
const unusedNav = '<nav><a href="/home"><svg></svg><span>홈</span></a><a href="/i/bookmarks" aria-current="false" data-testid="AppTabBar_Bookmarks_Link"><div><svg width="26" height="26"></svg><div><span>북마크</span></div></div></a><a href="/profile"><span>프로필</span></a></nav>';
const bookmarksPage = `<div data-testid="primaryColumn"><div id="hdr"><div>역사</div><div role="tablist"><div role="presentation"><a role="tab" aria-selected="true" href="/i/bookmarks" style="position:relative"><div><svg width="22" height="22"></svg><span style="font-weight:700">북마크</span></div><div class="ul" style="position:absolute;bottom:0;left:0;width:50px;height:4px;background:rgb(29, 155, 240)"></div></a></div><div role="presentation"><a role="tab" aria-selected="false" href="/u/likes"><div><svg width="22" height="22"></svg><span>마음에 들어요</span></div></a></div></div></div><section><div id="tl"></div></section></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><body>${bookmarksPage}</body>` }));
    await page.goto('https://x.com/home');
    await page.evaluate(stub);
    await page.evaluate(src => { document.querySelector('#tl').innerHTML = src; document.addEventListener('click', () => { window.__opened += 1; }); }, tweet('111') + tweet('222', { liked: true }));
    await page.route('https://platform.twitter.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>embed</body>' }));
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'x-seen-list.js'), 'utf8') });
    await page.addScriptTag({ content: source });
    const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const seenIds = async () => Object.keys(await page.evaluate(() => window.__store.xSeen || {})).sort();
    const cellHidden = n => page.locator('[data-testid="cellInnerDiv"]').nth(n).evaluate(el => getComputedStyle(el).display === 'none');
    await frame();
    // one button per tweet, right of the like button (the cell after the one that holds it)
    assert.equal(await page.locator('[data-capybara-xseen-btn]').count(), 2, 'one button per tweet');
    assert.equal(await page.locator('article').nth(0).evaluate(a => a.querySelector('[data-capybara-xseen-btn]').closest('[data-capybara-xseen-cell]').previousElementSibling.querySelector('[data-testid="like"], [data-testid="unlike"]') !== null), true, 'right of the like button');
    assert.equal(await page.locator('article').nth(0).evaluate(a => a.querySelector('[data-capybara-xseen-btn]').closest('[data-capybara-xseen-cell]').className), 'cell', 'same cell shape');
    // redraw does not double (innerHTML += re-parses the buttons as dead copies; the extra ones must not appear)
    await page.evaluate(src => { document.querySelector('#tl').insertAdjacentHTML('beforeend', src); }, tweet('333'));
    await frame();
    assert.equal(await page.locator('[data-capybara-xseen-btn]').count(), 3, 'no duplicates on redraw');
    assert.deepEqual(await seenIds(), [], 'nothing is checked by itself (a liked tweet neither)');
    // checking hides the timeline cell at once, with a toast and an undo
    await page.evaluate(() => { window.__opened = 0; });
    await page.locator('article').nth(0).locator('[data-capybara-xseen-btn]').click();
    assert.equal(await cellHidden(0), true, 'the cell is hidden at once');
    assert.equal(await page.locator('#capybara-xseen-toast').count(), 1, 'toast');
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), ['111'], 'saved');
    assert.equal(await page.evaluate(() => window.__opened), 0, 'the click does not reach the tweet');
    await page.locator('#capybara-xseen-toast button').click();
    await page.waitForTimeout(450);
    assert.equal(await cellHidden(0), false, 'undo shows it again');
    assert.deepEqual(await seenIds(), [], 'undo unchecks');
    // yellow check mark and band, button on the vertical middle of the like button (looked at on a tweet that is not hidden: switch off)
    await page.evaluate(() => window.chrome.storage.local.set({ xSeenHide: false }));
    await page.locator('article').nth(0).locator('[data-capybara-xseen-btn]').click();
    await frame();
    assert.equal(await cellHidden(0), false, 'switch off: shown, only the yellow check');
    const look = await page.evaluate(() => { const a = document.querySelector('article[data-capybara-seen="1"]'); const b = a.querySelector('[data-capybara-xseen-btn]'); const l = a.querySelector('[data-testid="unlike"], [data-testid="like"]'); const rb = b.getBoundingClientRect(), rl = l.getBoundingClientRect(); return { color: getComputedStyle(b).color, band: getComputedStyle(a).boxShadow, dy: Math.abs((rb.top + rb.height / 2) - (rl.top + rl.height / 2)) }; });
    assert.equal(look.color, 'rgb(255, 212, 0)'); assert(look.band.includes('rgb(255, 212, 0)'), 'yellow band'); assert(look.dy <= 1, 'centred with the other actions: ' + look.dy);
    assert.equal(await page.locator('#capybara-xseen-toast').count(), 0, 'no toast when nothing is hidden');
    // switching back on hides it; a reused element follows its tweet
    await page.evaluate(() => window.chrome.storage.local.set({ xSeenHide: true }));
    await frame();
    assert.equal(await cellHidden(0), true, 'switch on: hidden');
    await page.evaluate(() => { document.querySelectorAll('article')[0].querySelector('a').setAttribute('href', '/u/status/222'); });
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await cellHidden(0), false, 'reused cell follows its tweet id (unchecked one is shown)');
    await page.evaluate(() => { document.querySelectorAll('article')[0].querySelector('a').setAttribute('href', '/u/status/111'); });
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await cellHidden(0), true, 'and hidden again for the checked one');
    // the main tweet of a tweet page is not hidden
    await page.evaluate(() => history.pushState({}, '', '/u/status/111'));
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await cellHidden(0), false, 'main tweet of its own page stays');
    await page.evaluate(() => history.pushState({}, '', '/home'));
    // liking or reposting does not check
    await page.locator('article').nth(2).locator('[data-testid="like"]').click();
    await page.locator('article').nth(2).locator('[data-testid="retweet"]').click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), ['111'], 'like / repost clicks do not check');
    // the bookmarks page: a third tab "확인 완료", one only, that swaps the page body for the list and back
    await page.evaluate(() => history.pushState({}, '', '/i/bookmarks'));
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('[data-capybara-xseen-tab]').count(), 1, 'one extra tab');
    assert.equal(await page.locator('[role="tablist"] [role="tab"]').count(), 3);
    assert.match(await page.locator('[data-capybara-xseen-tab]').innerText(), /확인 완료/);
    await page.evaluate(() => { document.querySelector('[role="tablist"]').appendChild(document.createElement('i')); document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('[data-capybara-xseen-tab]').count(), 1, 'still one after a redraw');
    await page.locator('[data-capybara-xseen-tab]').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-capybara-xseen-list] .cxs-item').count() > 0, true, 'the list takes the body place');
    assert.equal(await page.locator('section').evaluate(el => getComputedStyle(el).display), 'none', 'the page body is hidden');
    assert.equal(await page.locator('[data-capybara-xseen-tab]').getAttribute('data-active'), '1');
    assert.equal(await page.locator('.ul').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'the old tab underline is muted');
    // the other tab brings the page back (and its click goes on)
    await page.evaluate(() => { window.__tabClicked = 0; document.querySelector('a[href="/u/likes"]').addEventListener('click', e => { window.__tabClicked += 1; e.preventDefault(); }); });
    await page.locator('a[href="/u/likes"]').click();
    assert.equal(await page.locator('[data-capybara-xseen-list]').count(), 0, 'our list is gone');
    assert.equal(await page.locator('section').evaluate(el => getComputedStyle(el).display), 'block', 'the page body is back');
    assert.equal(await page.evaluate(() => window.__tabClicked), 1, 'X still gets the click');
    assert.equal(await page.locator('.ul').evaluate(el => getComputedStyle(el).visibility), 'visible', 'underline back');
    // the page's policy refuses the embed frames: the extension page is opened instead (once)
    await page.evaluate(() => { window.__sent.length = 0; });
    await page.locator('[data-capybara-xseen-tab]').click(); await page.waitForTimeout(200);
    await page.evaluate(() => { for (let i = 0; i < 2; i += 1) document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { violatedDirective: 'frame-src', blockedURI: 'https://platform.twitter.com/embed/Tweet.html?id=1' })); });
    assert.deepEqual(await page.evaluate(() => window.__sent), [{ type: 'x-seen-open' }], 'asks for the list page once');
    // the history page (/i/history and below) is the same: the tab is there, also after a navigation inside the page
    await page.evaluate(() => history.pushState({}, '', '/i/history')); await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('[data-capybara-xseen-tab]').count(), 1, '/i/history has the tab');
    await page.evaluate(() => history.pushState({}, '', '/i/history/likes')); await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('[data-capybara-xseen-tab]').count(), 1, '/i/history/... too, once');
    await page.evaluate(() => history.pushState({}, '', '/i/historyx')); await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('[data-capybara-xseen-list]').count(), 0);
    // and leaving the page puts it back too
    await page.locator('[data-capybara-xseen-tab]').click(); await page.waitForTimeout(200);
    await page.evaluate(() => history.pushState({}, '', '/home')); await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('[data-capybara-xseen-list]').count(), 0, 'left the page: list removed');
    assert.equal(await page.locator('section').evaluate(el => getComputedStyle(el).display), 'block');

    // the list page
    const page2 = await browser.newPage();
    await page2.route('https://platform.twitter.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>embed</body>' }));
    await page2.addInitScript(() => {
      const store = { xSeen: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(1000 + i), 5000 + i])) };
      window.__store = store;
      window.chrome = { storage: { local: { get: async k => Object.fromEntries(k.map(key => [key, store[key]])), set: async o => { Object.assign(store, o); } } } };
    });
    await page2.goto(require('node:url').pathToFileURL(path.join(root, 'x-seen.html')).href);
    await page2.waitForSelector('.cxs-item');
    assert.equal(await page2.locator('.cxs-item').count(), 20, '20 at first');
    assert.equal(await page2.locator('.cxs-item iframe').first().getAttribute('src'), 'https://platform.twitter.com/embed/Tweet.html?id=1024&theme=dark&dnt=true', 'newest check first, X embed');
    await page2.locator('.cxs-more').click();
    assert.equal(await page2.locator('.cxs-item').count(), 25, '20 more');
    assert.equal(await page2.locator('.cxs-more').isHidden(), true);
    await page2.locator('.cxs-item').first().locator('button').click();
    assert.equal(await page2.locator('.cxs-item').count(), 24, 'shown again = gone from the list');
    assert.equal(await page2.evaluate(() => '1024' in window.__store.xSeen), false, 'and unchecked in the store');
    assert.equal(await page2.locator('.cxs-bar input').isChecked(), true, 'hiding is on by default');
    await page2.locator('.cxs-bar input').uncheck();
    assert.equal(await page2.evaluate(() => window.__store.xSeenHide), false, 'the switch is saved');
    console.log('x seen PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
