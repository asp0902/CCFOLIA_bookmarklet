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
    // up: it takes the pointer; Esc closes it, nothing is stored, the toolbar is reachable
    let page = await open();
    await greeting(page).waitFor({ state: 'attached', timeout: 8000 });
    assert.equal(await hit(page), 'greeting', 'while it is up the overlay covers the toolbar');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-ccf-handout-greeting]'), null, { timeout: 2000 });
    assert.equal(await hit(page), 'toolbar', 'after Esc the toolbar takes the pointer');
    assert.equal(await greeted(page), null, 'closing without 확인 is not consent');
    await page.hover('#tb'); await page.click('#tb'); // hover and click reach the button
    await page.waitForTimeout(1500);
    assert.equal(await greeting(page).count(), 0, 'not shown again in this page load');
    assert.deepEqual(page.__errors, []); await page.context().close();
    // backdrop click closes it too; a click on the dialog itself does not
    page = await open();
    await greeting(page).waitFor({ state: 'attached', timeout: 8000 });
    await page.mouse.click(500, 350); // the dialog paper
    await page.waitForTimeout(300);
    assert.equal(await greeting(page).count(), 1, 'a click inside the dialog keeps it');
    await page.mouse.click(20, 650); // backdrop
    await page.waitForFunction(() => !document.querySelector('[data-ccf-handout-greeting]'), null, { timeout: 2000 });
    assert.equal(await greeted(page), null); await page.context().close();
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
    console.log('handout greeting PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
