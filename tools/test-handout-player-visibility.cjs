// handout 0.1.130 + toolkit-presence 0.0.22: on a player's screen the handout list shows only the copies sent to them (inbox), never handouts this browser keeps from
// elsewhere (e.g. an earlier GM session in the same browser profile, with their permission tables); a secret part only when the copy carries the secret right.
// The tools window is titled "도구" for a player ("GM 도구" for the GM).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const src = (n) => fs.readFileSync(path.join(__dirname, `../legacy/ccfolia-${n}.user.js`), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222;color:#fff"><span class="MuiTypography-caption">인세인</span><header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button></header><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="플레이어"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: 'GM캐릭', folders: [], plList: [], handouts: [
        { id: 'g1', title: '로컬 GM 원본', description: '공개', gmNotes: 'GM만 보는 비밀', permissions: { 플레이어: { view: true, secret: true } }, order: 1 },
        { id: 'c1', title: '받은 사본', description: '공개 본문', gmNotes: '', _remote: true, _canSecret: false, _canView: true, order: 2 },
        { id: 'c2', title: '비밀 받은 사본', description: '공개 둘', gmNotes: '허락된 비밀', _remote: true, _canSecret: true, _canView: true, order: 3 }
      ] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async (f) => ({ value: /handout/.test(f) ? value : { sheets: [] } }), setRoomData: async () => {} } };
    });
    for (const n of ['handout', 'character-sheet', 'toolkit-presence']) await page.addScriptTag({ content: src(n) });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.visibilityDiag().gm), false, 'a player');
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(400);
    const titles = await page.evaluate(() => [...document.querySelector('#ccfolia-handout-root').shadowRoot.querySelectorAll('.card .card-title-btn')].map((b) => b.textContent));
    assert.deepEqual(titles, ['받은 사본', '비밀 받은 사본'], 'only the copies sent to me: ' + JSON.stringify(titles));
    const view = async (id) => { await page.evaluate((id) => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector(`[data-action="view-handout"][data-id="${id}"]`).click(), id); await page.waitForTimeout(200); const r = await page.evaluate(() => { const h = [...document.querySelectorAll('[data-ccf-handout-show="1"]')].pop(); return { secret: !!h.shadowRoot.querySelector('.secret-block') }; }); await page.evaluate(() => document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((h) => h.remove())); return r; };
    assert.deepEqual(await view('c1'), { secret: false });
    assert.deepEqual(await view('c2'), { secret: true }, 'the copy with the secret right shows it');
    // the tools window title
    await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached' });
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.close?.()); await page.waitForTimeout(200);
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    await page.waitForSelector('#ccf-gm-tools .ccf-gt-window');
    assert.equal(await page.locator('#ccf-gm-tools .ccf-gt-window > header > h2').textContent(), '도구', 'player: "도구"');
    const d = await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.visibilityDiag());
    assert.deepEqual([d.local, d.copies, d.copiesWithSecret, d.localNotCopies, d.shownToMe], [3, 2, 1, 1, 2]);
    assert.deepEqual(errors, []);
    console.log('handout player visibility PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
