const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// x.com "seen" check: one ✓ button per tweet (no duplicates on redraw), toggle + storage, like click and already-liked state check it, the click does not reach the tweet.
const source = fs.readFileSync(path.join(__dirname, '../extension/personal/x-seen.js'), 'utf8');
const tweet = (id, { liked = false } = {}) => `<article data-testid="tweet"><a href="/u/status/${id}"><time>1h</time></a><div role="group"><button data-testid="${liked ? 'unlike' : 'like'}">♥</button><button data-testid="retweet">⟲</button></div></article>`;
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
    assert.deepEqual(await seenIds(), ['222'], 'an already liked tweet is checked');
    // the button toggles and the click stays inside the button
    await page.evaluate(() => { window.__opened = 0; document.body.addEventListener('click', () => { window.__opened += 1; }); });
    await page.locator('article').nth(0).locator('[data-capybara-xseen-btn]').click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), ['111', '222'], 'button checks');
    assert.equal(await page.locator('article').nth(0).getAttribute('data-capybara-seen'), '1');
    assert.equal(await page.evaluate(() => window.__opened), 0, 'the click does not reach the tweet');
    await page.locator('article').nth(0).locator('[data-capybara-xseen-btn]').click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), ['222'], 'second click unchecks');
    // a like click checks
    await page.locator('article').nth(2).locator('[data-testid="like"]').click();
    await page.waitForTimeout(450);
    assert.deepEqual(await seenIds(), ['222', '333'], 'like click checks');
    // a redrawn (reused) element shows the state of its new tweet
    await page.evaluate(() => { document.querySelector('article').querySelector('a').setAttribute('href', '/u/status/222'); });
    await frame(); await page.evaluate(() => { document.querySelector('#tl').append(document.createElement('i')); }); await frame();
    assert.equal(await page.locator('article').nth(0).getAttribute('data-capybara-seen'), '1', 'reused element follows its tweet id');
    console.log('x seen PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
