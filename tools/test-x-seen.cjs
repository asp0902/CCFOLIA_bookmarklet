const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// x.com "seen" check: one ✓ button per tweet (no duplicates on redraw), toggle + storage, checked by hand only (like / repost / already-liked do not check), the click does not reach the tweet.
const source = fs.readFileSync(path.join(__dirname, '../extension/personal/x-seen.js'), 'utf8');
const tweet = (id, { liked = false } = {}) => `<article data-testid="tweet"><a href="/u/status/${id}"><time>1h</time></a><div role="group" style="display:flex;align-items:center;height:48px"><button data-testid="${liked ? 'unlike' : 'like'}">♥</button><button data-testid="retweet">⟲</button></div></article>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body><div id="tl"></div></body>' }));
    await page.goto('https://x.com/home');
    await page.evaluate(() => {
      const store = {}; const listeners = [];
      window.chrome = { runtime: { id: 'x' }, storage: { local: { get: async k => ({ [k]: store[k] }), set: async o => { const old = {}; for (const k in o) { old[k] = { newValue: o[k] }; store[k] = o[k]; } listeners.forEach(fn => fn(old, 'local')); } }, onChanged: { addListener: fn => listeners.push(fn) } } };
      window.__store = store; window.__opened = 0;
      document.addEventListener('click', () => { window.__opened += 1; });
    });
    await page.evaluate(src => { document.querySelector('#tl').innerHTML = src; }, tweet('111') + tweet('222', { liked: true }));
    await page.addScriptTag({ content: source });
    const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await frame();
    assert.equal(await page.locator('[data-capybara-xseen-btn]').count(), 2, 'one button per tweet');
    await page.evaluate(src => { document.querySelector('#tl').innerHTML += src; }, tweet('333'));
    await frame();
    assert.equal(await page.locator('[data-capybara-xseen-btn]').count(), 3, 'no duplicates on redraw');
    const seenIds = async () => Object.keys(await page.evaluate(() => window.__store.xSeen || {})).sort();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), [], 'an already liked tweet is not checked by itself');
    const btn = n => page.locator('article').nth(n).locator('[data-capybara-xseen-btn]');
    // the button toggles and the click stays inside the button
    await page.evaluate(() => { window.__opened = 0; document.body.addEventListener('click', () => { window.__opened += 1; }); });
    await btn(0).click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), ['111'], 'button checks');
    assert.equal(await page.locator('article').nth(0).getAttribute('data-capybara-seen'), '1');
    assert.equal(await page.evaluate(() => window.__opened), 0, 'the click does not reach the tweet');
    // checked = yellow (#FFD400) check mark and band, and the button sits on the vertical middle of the like button
    const look = await page.evaluate(() => { const a = document.querySelector('article[data-capybara-seen="1"]'); const b = a.querySelector('[data-capybara-xseen-btn]'); const l = a.querySelector('[data-testid="unlike"], [data-testid="like"]'); const rb = b.getBoundingClientRect(), rl = l.getBoundingClientRect(); return { color: getComputedStyle(b).color, band: getComputedStyle(a).boxShadow, dy: Math.abs((rb.top + rb.height / 2) - (rl.top + rl.height / 2)) }; });
    assert.equal(look.color, 'rgb(255, 212, 0)'); assert(look.band.includes('rgb(255, 212, 0)'), 'yellow band'); assert(look.dy <= 1, 'centred with the other actions: ' + look.dy);
    await btn(0).click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), [], 'second click unchecks');
    // liking or reposting does not check (a liked tweet neither)
    await page.locator('article').nth(2).locator('[data-testid="like"]').click();
    await page.locator('article').nth(2).locator('[data-testid="retweet"]').click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), [], 'like / repost clicks do not check');
    // a redrawn (reused) element shows the state of its new tweet
    await btn(0).click(); await page.waitForTimeout(450);
    await page.evaluate(() => { document.querySelector('article').querySelector('a').setAttribute('href', '/u/status/222'); });
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('article').nth(0).getAttribute('data-capybara-seen'), null, 'reused element follows its tweet id (unchecked one)');
    await page.evaluate(() => { document.querySelector('article').querySelector('a').setAttribute('href', '/u/status/111'); });
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('article').nth(0).getAttribute('data-capybara-seen'), '1', 'and back to the checked one');
    console.log('x seen PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
