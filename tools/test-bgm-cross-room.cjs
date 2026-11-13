// chat-notifier 0.3.44: the last-played YouTube BGM state is kept per room. A room's "playing" state is not found in another room (no autoplay there);
// the old global key is dropped; going to another room without a reload clears the restore so the new room only restores its own state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body><div id="root"></div></body>' }));
    await page.route('https://www.youtube.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.goto('https://ccfolia.com/rooms/A');
    await page.evaluate(() => {
      localStorage.setItem('ccf-chat-notifier:youtube-bgm:active', JSON.stringify({ slotKey: 's', entryKey: 'old', videoId: 'v0', state: 'playing' })); // the old global state
      localStorage.setItem('ccf-chat-notifier:youtube-bgm:active:A', JSON.stringify({ slotKey: 's1', entryKey: 'e1', videoId: 'vA', state: 'playing' }));
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(500);
    const persisted = () => page.evaluate(() => window.__ccfBgmCounts().youtube.persisted);
    assert.equal((await persisted())?.entryKey, 'e1', 'room A: its own last state');
    assert.equal(await page.evaluate(() => localStorage.getItem('ccf-chat-notifier:youtube-bgm:active')), null, 'the old global key is dropped');
    // go to room B without a reload
    await page.evaluate(() => history.pushState({}, '', '/rooms/B'));
    await page.waitForTimeout(1000);
    assert.equal(await persisted(), null, 'room B: nothing to restore (A\'s "playing" is not B\'s)');
    assert.equal(await page.evaluate(() => window.__ccfBgmCounts().youtube.restoreConsumed), false, 'the restore is open for the new room\'s own state');
    // back to A: A's state is still there
    await page.evaluate(() => history.pushState({}, '', '/rooms/A'));
    await page.waitForTimeout(1000);
    assert.equal((await persisted())?.state, 'playing', 'room A keeps its own state');
    assert.deepEqual(errors, []);
    console.log('bgm cross room PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
