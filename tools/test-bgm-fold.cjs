// GM BGM video dock: the fold button cuts the dock to a 24px bar (the 200x200 player stays in place so playback is not interrupted); the state is remembered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-notifier.user.js'), 'utf8');
const a = source.indexOf('  const CCF_BGM_FOLD_KEY');
const b = source.indexOf('  const CCF_BGM_FOLD_CSS');
const cssEnd = source.indexOf('`;', b) + 2;
const fnStart = source.indexOf('  function ensureCcfBgmFoldBar()');
const fnEnd = source.indexOf('  function syncCcfYoutubeBgmPlayerDockVisibility()');
assert(a >= 0 && cssEnd > b && fnEnd > fnStart, 'fold code not found');
const code = `${source.slice(a, cssEnd)}\n${source.slice(fnStart, fnEnd)}`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const run = () => page.evaluate(code => {
    const dock = document.querySelector('.ccf-youtube-bgm-player-dock');
    new Function('ccfBgmPlayerDock', 'ccfBgmPlayer', `${code}; ensureCcfBgmFoldBar();`)(dock, { getVideoData: () => ({ title: '전투 BGM' }) });
  }, code);
  const html = `<style>.ccf-youtube-bgm-player-dock{display:block!important;width:200px!important;height:200px!important;overflow:hidden!important}.ccf-youtube-bgm-player-dock iframe{display:block!important;width:200px!important;height:200px!important;border:0}</style><div class="ccf-youtube-bgm-player-dock"><iframe></iframe></div>`;
  await page.route('http://fold.test/', route => route.fulfill({ contentType: 'text/html', body: html })); // a real origin so localStorage works
  await page.goto('http://fold.test/');
  await page.evaluate(() => { try { localStorage.removeItem('ccf-youtube-bgm-folded'); } catch (_) {} });
  await page.addStyleTag({ content: await page.evaluate(code => new Function(`${code}; return CCF_BGM_FOLD_CSS;`)(), code) });
  await run();
  const dockBox = () => page.locator('.ccf-youtube-bgm-player-dock').evaluate(d => ({ h: d.getBoundingClientRect().height, iframeH: d.querySelector('iframe').getBoundingClientRect().height, folded: d.getAttribute('data-ccf-youtube-bgm-folded') }));
  assert.deepEqual(await dockBox(), { h: 200, iframeH: 200, folded: null }, 'unfolded: 200x200');
  await page.click('.ccf-youtube-bgm-fold-btn');
  assert.deepEqual(await dockBox(), { h: 24, iframeH: 200, folded: '1' }, 'folded: 24px bar, the player keeps its size');
  assert.equal(await page.locator('.ccf-youtube-bgm-fold-title').innerText(), '전투 BGM');
  assert.equal(await page.locator('.ccf-youtube-bgm-fold-btn').getAttribute('aria-label'), 'BGM 영상 펴기');
  // remembered after a reload of the page script (a fresh dock reads the saved state)
  await page.evaluate(() => { const d = document.querySelector('.ccf-youtube-bgm-player-dock'); d.removeAttribute('data-ccf-youtube-bgm-folded'); d.querySelector('.ccf-youtube-bgm-fold-bar').remove(); });
  await run();
  assert.equal((await dockBox()).folded, '1', 'folded state restored');
  await page.click('.ccf-youtube-bgm-fold-btn');
  assert.deepEqual(await dockBox(), { h: 200, iframeH: 200, folded: null }, 'unfolded again');
  await browser.close();
  console.log('bgm fold PASS');
})().catch(error => { console.error(error); process.exit(1); });
