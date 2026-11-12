// #105: after a chat tab switch the new tab's rows are grouped (prose continuation spacing) in the same task the rows arrive, not one frame later:
// the first paint of the new tab already has its final spacing (no "late space" after the switch).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const row = (name, text) => `<li class="MuiListItem-root"><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}</h6><p class="MuiListItemText-secondary">${text}</p></div></li>`;
    const page = await browser.newPage();
    await page.setContent(`<style>body{background:#282828;color:#fff;font:16px/24px sans-serif}ul{list-style:none;margin:0;padding:0;width:400px}
      .MuiListItem-root{display:flex;padding:8px 16px;box-sizing:border-box}.MuiListItemAvatar-root{width:40px;min-width:40px}.MuiListItemText-root{margin:6px 0;flex:1}h6{margin:0}p{margin:0}</style>
      <div role="tablist"><button role="tab" aria-selected="true" id="a">메인</button><button role="tab" aria-selected="false" id="b">정보</button></div><ul id="list">${row('나', '1') + row('나', '2')}</ul>`);
    await page.addScriptTag({ path: path.join(__dirname, '..', 'legacy', 'ccfolia-roll20-css-bridge.user.js') }).catch(() => {});
    await page.waitForTimeout(400);
    const result = await page.evaluate(async () => {
      // the tab switch as React commits it: the selected tab changes and the rows are replaced in one batch
      document.getElementById('a').setAttribute('aria-selected', 'false'); document.getElementById('b').setAttribute('aria-selected', 'true');
      document.getElementById('list').innerHTML = [['카피', 'x'], ['카피', 'y'], ['카피', 'z']].map(([n, t]) => `<li class="MuiListItem-root"><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${n}</h6><p class="MuiListItemText-secondary">${t}</p></div></li>`).join('');
      await Promise.resolve(); await Promise.resolve(); // microtasks only: no animation frame, no timer
      return [...document.querySelectorAll('li')].map((li) => [li.hasAttribute('data-ccf-prose-cont-leader'), li.hasAttribute('data-ccf-prose-cont'), li.hasAttribute('data-ccf-prose-cont-last')].map(Number).join(''));
    });
    assert.deepEqual(result, ['100', '010', '011'], 'the switched-to tab is already grouped before the first paint');
    console.log('tab switch grouping PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
