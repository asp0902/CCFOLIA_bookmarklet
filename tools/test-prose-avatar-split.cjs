const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// roll20-css-bridge 0.3.111 (theme 3단계): consecutive messages of the same name are merged, but not when the standing picture (avatar) differs
// (ccf-prose-split-avatar, default on); merging can be switched off (ccf-prose-merge=off). The theme popup's 채팅 section sets both.
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const row = (name, img, text) => `<li class="MuiListItem-root"><div class="MuiListItemAvatar-root"><img src="https://example.test/${img}.png"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}</h6><p class="MuiListItemText-secondary">${text}</p></div></li>`;
  const html = `<ul>${row('카피바라', 'a', '1') + row('카피바라', 'a', '2') + row('카피바라', 'b', '3')}</ul>`;
  try {
    const page = await browser.newPage();
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><body>${html}</body>` }));
    await page.goto('https://ccfolia.com/rooms/t');
    const run = async (prefs) => {
      await page.evaluate((prefs) => { for (const [k, v] of Object.entries(prefs)) { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } window.__CCF_PROSE_MODE_DEBUG__?.rescan?.(); }, prefs);
      await page.waitForTimeout(150);
      return page.evaluate(() => [...document.querySelectorAll('li')].map((li) => Number(li.hasAttribute('data-ccf-prose-cont'))).join(''));
    };
    await page.addScriptTag({ path: path.join(__dirname, '..', 'legacy', 'ccfolia-roll20-css-bridge.user.js') }).catch(() => {});
    await page.waitForTimeout(400);
    assert.equal(await run({}), '010', 'default: the third (other standing picture) starts a new group');
    assert.equal(await run({ 'ccf-prose-split-avatar': 'off' }), '011', 'split off: same name merges');
    assert.equal(await run({ 'ccf-prose-merge': 'off' }), '000', 'merging off');
    assert.equal(await run({ 'ccf-prose-merge': null, 'ccf-prose-split-avatar': null }), '010', 'back to the default');
    console.log('prose avatar split PASS');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
