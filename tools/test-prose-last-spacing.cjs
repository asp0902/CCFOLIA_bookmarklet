const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Runs the real prose-mode script in a replica chat: the last row of a merged run keeps the native bottom
// spacing, and rows inside a run are 5px apart.
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const row = (name, text) => `<li class="MuiListItem-root"><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}</h6><p class="MuiListItemText-secondary">${text}</p></div></li>`;
  const html = lines => `<style>body{background:#282828;color:#fff;font:16px/24px sans-serif}ul{list-style:none;margin:0;padding:0;width:400px}
    .MuiListItem-root{display:flex;padding:8px 16px;box-sizing:border-box}.MuiListItemAvatar-root{width:40px;min-width:40px}
    .MuiListItemText-root{margin:6px 0;flex:1}h6{margin:0}p{margin:0}</style><ul>${lines}</ul>`;
  const bottomGap = page => page.evaluate(() => { const lis = [...document.querySelectorAll('li')]; const li = lis[lis.length - 1]; const p = li.querySelector('p'); return li.getBoundingClientRect().bottom - p.getBoundingClientRect().bottom; });
  const withScript = async content => {
    const page = await browser.newPage();
    await page.setContent(html(content));
    await page.addScriptTag({ path: path.join(__dirname, '..', 'legacy', 'ccfolia-roll20-css-bridge.user.js') }).catch(() => {});
    await page.waitForTimeout(400);
    return page;
  };
  try {
    const native = await browser.newPage();
    await native.setContent(html(row('카피바라', 'a') + row('다른사람', 'b')));
    const nativeGap = await bottomGap(native);
    const merged = await withScript(row('카피바라', 'a') + row('카피바라', 'b') + row('카피바라', 'c'));
    const flags = await merged.evaluate(() => [...document.querySelectorAll('li')].map(li => [li.hasAttribute('data-ccf-prose-cont-leader'), li.hasAttribute('data-ccf-prose-cont'), li.hasAttribute('data-ccf-prose-cont-last')].map(Number).join('')));
    assert.deepEqual(flags, ['100', '010', '011'], 'leader / cont / cont-last flags');
    const mergedGap = await bottomGap(merged);
    assert.equal(mergedGap, nativeGap, `last row bottom space ${mergedGap} equals native ${nativeGap}`);
    const gaps = await merged.evaluate(() => { const ps = [...document.querySelectorAll('p')].map(p => p.getBoundingClientRect()); return [ps[1].top - ps[0].bottom, ps[2].top - ps[1].bottom]; });
    assert.deepEqual(gaps, [5, 5], `gaps between merged lines ${gaps}`);
    console.log(`prose spacing: last row ${mergedGap}px (native ${nativeGap}px), line gaps ${gaps} PASS`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
