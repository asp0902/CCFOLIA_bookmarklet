// Handout greeting (consent) overlay: while it is up it covers the page like a dialog; Esc or a backdrop click closes it WITHOUT consent (nothing stored, not shown again until a reload);
// "확인" consents (greeted flag) and removes it; "오늘 다시 보지 않기" still skips it on the next load; once it is gone the toolbar takes hover and clicks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const html = '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><header class="MuiAppBar-root" style="display:flex;padding:8px"><button class="MuiIconButton-root" id="tb" aria-label="내 캐릭터 목록" style="width:40px;height:40px">캐</button></header><div id="root"></div></body>';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async (storage) => {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const page = await context.newPage();
      page.__errors = []; page.on('pageerror', (e) => page.__errors.push(e.message));
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
      await page.goto('https://ccfolia.com/rooms/test');
      if (storage) await page.evaluate((entries) => { for (const [k, v] of entries) localStorage.setItem(k, v); }, Object.entries(storage));
      await page.addScriptTag({ content: source });
      return page;
    };
    const greeting = (page) => page.locator('[data-ccf-handout-greeting]');
    const hit = (page) => page.evaluate(() => { const b = document.getElementById('tb').getBoundingClientRect(); const top = document.elementFromPoint(b.x + 20, b.y + 20); return top === document.getElementById('tb') ? 'toolbar' : (top?.hasAttribute('data-ccf-handout-greeting') ? 'greeting' : top?.tagName); });
    const greeted = (page) => page.evaluate(() => localStorage.getItem('ccf-handout:greeted:test'));
    // 0.1.120 policy: only 확인 closes it. Esc (real or synthetic, e.g. another script's Escape at room entry), a backdrop click or a click in the dialog keep it up.
    let page = await open();
    await greeting(page).waitFor({ state: 'attached', timeout: 8000 });
    assert.equal(await hit(page), 'greeting', 'while it is up the overlay covers the toolbar (intended: press 확인)');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    assert.equal(await greeting(page).count(), 1, 'Esc keeps it');
    await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); await page.waitForTimeout(300);
    assert.equal(await greeting(page).count(), 1, 'synthetic Escape / mousedown keep it');
    await page.mouse.click(500, 350); await page.mouse.click(20, 650); await page.waitForTimeout(300);
    assert.equal(await greeting(page).count(), 1, 'clicks in the dialog and on the backdrop keep it');
    assert.equal(await greeted(page), null, 'no consent yet');
    assert.deepEqual(page.__errors, []); await page.context().close();
    // 확인: consent stored, overlay removed, toolbar reachable; with 오늘 다시 보지 않기 the next load skips it
    page = await open();
    await greeting(page).waitFor({ state: 'attached', timeout: 8000 });
    await page.locator('[data-ccf-handout-greeting] input[data-skip-today]').check();
    await page.locator('[data-ccf-handout-greeting] button[data-action="greeting-ok"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-ccf-handout-greeting]'), null, { timeout: 2000 });
    assert.equal(await greeted(page), '1', '확인 = consent'); assert.equal(await hit(page), 'toolbar');
    const skipDay = await page.evaluate(() => localStorage.getItem('ccf-handout:greeted-skip-day'));
    assert(skipDay, 'skip-today stored'); await page.context().close();
    page = await open({ 'ccf-handout:greeted-skip-day': skipDay });
    await page.waitForTimeout(2500);
    assert.equal(await greeting(page).count(), 0, '오늘 다시 보지 않기: not shown again today');
    await page.context().close();
    // checking 오늘 다시 보지 않기 stores the local date at once (the window stays until 확인)
    page = await open();
    await greeting(page).waitFor({ state: 'attached', timeout: 8000 });
    await page.locator('[data-ccf-handout-greeting] input[data-skip-today]').check();
    const stored = await page.evaluate(() => localStorage.getItem('ccf-handout:greeted-skip-day'));
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    assert.equal(stored, today, 'the box stores the local date at once'); assert.equal(await greeting(page).count(), 1, 'still up'); assert.equal(await greeted(page), null, 'still no consent');
    const log = await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.greetingLog()); assert.deepEqual(log, [], 'nothing removed it');
    await page.context().close();
    page = await open({ 'ccf-handout:greeted-skip-day': today });
    await page.goto('https://ccfolia.com/rooms/other'); await page.addScriptTag({ content: source }); await page.waitForTimeout(2500);
    assert.equal(await greeting(page).count(), 0, 'another room today: not shown'); await page.context().close();
    // a room that was consented to: never asked again, whatever the day
    page = await open({ 'ccf-handout:greeted:test': '1' });
    await page.waitForTimeout(2500);
    assert.equal(await greeting(page).count(), 0, 'consented room: not shown'); await page.context().close();
    // the next day, in a room without consent: shown again
    page = await open({ 'ccf-handout:greeted-skip-day': '2000-01-01' });
    await greeting(page).waitFor({ state: 'attached', timeout: 8000 });
    await page.context().close();
    console.log('handout greeting PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
