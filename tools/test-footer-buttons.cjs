// theme 0.2.58 + roll20-css-bridge 0.3.114: the theme palette (bottom 'Dicebot engine' row) stays when CCFOLIA swaps that row for
// "○○ 열심히 입력중..." (same place, still clickable); the Roll20 d20 button sits right left of the palette (same 24px, same top), not in the dice row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const theme = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const dice = ['D4', 'D6', 'D8', 'D10', 'D12', 'D20', 'D100'].map((d) => `<button type="button" aria-label="${d}" class="MuiButtonBase-root MuiIconButton-root" style="width:36px;height:36px">${d}</button>`).join('');
const html = `<!doctype html><html><body style="margin:0;background:#202020;color:#fff">
<div class="MuiDrawer-paper" style="position:fixed;right:0;top:0;width:376px;height:100%;background:#2a2a2a">
<form style="position:absolute;bottom:0;left:0;right:0">
<div id="dicerow" style="display:flex;align-items:center;padding:0 8px 8px">${dice}<button type="submit" class="MuiButtonBase-root MuiButton-root" style="margin-left:auto">전송</button></div>
<div class="MuiInputBase-root"><textarea name="text" style="width:100%;height:80px"></textarea></div>
<hr style="margin:0">
<div id="footer" class="MuiBox-root" style="height:37px;display:flex;align-items:center;padding:0 16px"><span class="MuiTypography-caption">Dicebot engine : <a href="https://docs.bcdice.org/">BCDice@3.17.0</a></span></div>
</form></div></body></html>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => route.request().url().startsWith('https://ccfolia.com/') ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
    await page.goto('https://ccfolia.com/rooms/footer-test');
    await page.addScriptTag({ content: theme });
    await page.addScriptTag({ content: bridge });
    await page.waitForFunction(() => { const t = document.getElementById('ccf-theme-switcher-toggle'); return t && !t.hidden && document.querySelector('.ccr20-open-btn.is-footer'); }, null, { timeout: 8000 });
    await page.waitForTimeout(400);
    const geo = () => page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right) }; };
      const t = document.getElementById('ccf-theme-switcher-toggle'), b = document.querySelector('.ccr20-open-btn'), f = document.getElementById('footer');
      return { toggle: t.hidden ? null : r(t), roll20: r(b), footer: r(f), inDiceRow: getComputedStyle(b).position !== 'fixed' };
    });
    const g1 = await geo();
    assert(g1.toggle, 'palette shown');
    assert.equal(g1.inDiceRow, false, 'the Roll20 button left the dice row');
    assert.equal(g1.roll20.w, 24); assert.equal(g1.roll20.h, 24);
    assert(Math.abs(g1.roll20.r + 4 - g1.toggle.l) <= 1, 'Roll20 button right left of the palette ' + JSON.stringify(g1));
    assert(Math.abs(g1.roll20.t - g1.toggle.t) <= 1, 'same top ' + JSON.stringify(g1));
    assert(g1.toggle.t >= g1.footer.t && g1.toggle.t + 24 <= g1.footer.t + g1.footer.h + 1, 'in the bottom row ' + JSON.stringify(g1));
    // someone is typing: CCFOLIA swaps the row content (no Dicebot link)
    await page.evaluate(() => { const old = document.getElementById('footer'); const row = document.createElement('div'); row.id = 'footer'; row.className = 'MuiBox-root'; row.style.cssText = old.style.cssText; row.innerHTML = '<span class="MuiTypography-caption">드와이프 열심히 입력중...</span>'; old.replaceWith(row); /* React draws a new row element */ });
    await page.waitForTimeout(800);
    const g2 = await geo();
    assert(g2.toggle, 'palette still shown while typing');
    assert.deepEqual([g2.toggle.l, g2.toggle.t], [g1.toggle.l, g1.toggle.t], 'palette in the same place');
    assert.deepEqual([g2.roll20.l, g2.roll20.t], [g1.roll20.l, g1.roll20.t], 'Roll20 button in the same place');
    await page.locator('#ccf-theme-switcher-toggle').click();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => { const p = document.getElementById('ccf-theme-switcher-panel'); return !!p && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0; }), true, 'palette click opens the theme panel');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'footer-buttons.png'), clip: { x: 824, y: 600, width: 376, height: 200 } });
    assert.deepEqual(errors.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e)), []);
    console.log('footer buttons PASS', JSON.stringify(g1));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
