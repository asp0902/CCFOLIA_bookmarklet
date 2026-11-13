// extension path: ntfy-page.js adds a read-only "스마트폰 알림" section to the shared 설정 tab (the settings live in chrome.storage and a page script must not change topic/server),
// it shows the state the bridge sent and tells where to change it; the legacy ntfy (bookmarklet path) does not start next to the extension.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><header class="MuiAppBar-root"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button><button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button></header><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: read('../legacy/ccfolia-toolkit-presence.user.js') });
    await page.addScriptTag({ content: read('../extension/personal/ntfy-page.js') });
    await page.evaluate(() => window.postMessage({ source: 'capybara-ntfy', direction: 'bridge', action: 'config', config: { enabled: true, topic: 'x', scope: 'keywords', keywords: ['a', 'b'], onlyAway: true, awayMinutes: 5 } }, location.origin));
    await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached', timeout: 8000 });
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    await page.waitForSelector('#ccf-gm-tools .ccf-gt-window');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#ccf-gm-tools .ccf-gt-tabs')).display), 'none', 'only the settings tab: no tab strip');
    const text = () => page.locator('#ccf-gm-tools .ccf-gt-settings').innerText();
    await page.waitForFunction(() => /알림: 켜짐/.test(document.querySelector('#ccf-gm-tools .ccf-gt-settings')?.innerText || ''), null, { timeout: 4000 });
    let t = await text(); assert.match(t, /스마트폰 알림/); assert.match(t, /키워드\(2개\)/); assert.match(t, /자리 비움 5분/); assert.match(t, /확장 아이콘/); assert(!/topic: x|\bx\b.*topic/.test(t), 'the topic is not shown');
    assert.equal(await page.locator('#ccf-gm-tools .ccf-gt-settings input, #ccf-gm-tools .ccf-gt-settings form').count(), 0, 'read-only: no input or form');
    // a config change from the bridge is shown live
    await page.evaluate(() => window.postMessage({ source: 'capybara-ntfy', direction: 'bridge', action: 'config', config: { enabled: false, topic: '' } }, location.origin));
    await page.waitForFunction(() => /알림: 꺼짐/.test(document.querySelector('#ccf-gm-tools .ccf-gt-settings')?.innerText || ''), null, { timeout: 4000 });
    // legacy ntfy next to the extension's: does not register a second one
    await page.addScriptTag({ content: read('../legacy/ccfolia-ntfy.user.js') });
    assert.equal(await page.evaluate(() => [...window.__CCF_TOOLKIT_MENU__.items.values()].filter((i) => i.id === 'ntfy').length), 1);
    assert.deepEqual(errors, []);
    console.log('ntfy extension section PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
