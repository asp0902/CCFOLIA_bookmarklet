const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Narration spacing with the real prose script on a replica chat list: 16px above a narration group, 6px between its lines, and the space under the
// group the same as before (roll20 bridge 0.3.119, option A: 6px under every narration line + 10px above the next group's first row = 16).
// Image narration row (#124): 12px on top (4px less so the gaps above and below the image are equal); a continuation row keeps 0.
const read = (name) => fs.readFileSync(path.join(__dirname, '../legacy', name), 'utf8');
const styleFunction = (source) => {
  const start = source.indexOf('  function injectStyle()');
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const format = styleFunction(read('ccfolia-format-sync.user.js'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    let n = 0;
    const row = (id, name, narration = true, body = `<span class="ccf-line">${id}</span>`) => `<div data-index="${n++}"><div class="MuiListItem-root" id="${id}"><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}</h6><p class="MuiListItemText-secondary ccf-render-root" ${narration ? 'data-ccf-narration="1"' : ''}>${body}</p></div></div></div>`;
    const img = '<span class="ccf-frag ccf-image-frag"><img class="ccf-image" width="40" height="40"></span>';
    await page.setContent(`<style>body{background:#282828;color:white;font:16px sans-serif}ul{list-style:none;margin:0;padding:0;max-width:320px}.MuiListItem-root{padding:8px 16px;display:flex}.MuiListItemAvatar-root{width:40px;min-width:40px}.MuiListItemText-root{margin:6px 0;flex:1}h6{margin:0;line-height:20px}.ccf-render-root{margin:0;line-height:24px}.ccf-line{display:block}</style>
      <ul role="log"><div>${row('a', '가', false)}${row('single', '나레이터')}${row('b', '가', false)}${row('first', '나레이터')}${row('middle', '나레이터')}${row('last', '나레이터')}${row('c', '가', false)}${row('imgrow', '나레이터', true, img)}${row('imgcont', '나레이터', true, img)}</div></ul>`);
    await page.addScriptTag({ content: `{const CCF_NARRATION_ATTR='data-ccf-narration';const CCF_NARRATION_PANEL_ATTR='data-ccf-narration-panel';${format};injectStyle();}` });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'legacy', 'ccfolia-roll20-css-bridge.user.js') });
    await page.waitForTimeout(300);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const spacing = await page.evaluate(() => {
        const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
        const line = (id) => rect(`#${id} .ccf-line`);
        const text = (id) => rect(`#${id} .MuiListItemText-root`);
        return {
          // plain text bottom (14 under it natively) → narration line: 14 + 16
          singleTop: line('single').top - text('a').bottom,
          singleBottom: text('b').top - line('single').bottom,
          top: line('first').top - text('b').bottom,
          gap1: line('middle').top - line('first').bottom,
          gap2: line('last').top - line('middle').bottom,
          bottom: text('c').top - line('last').bottom,
          ordinary: getComputedStyle(document.querySelector('#a')).paddingTop
        };
      });
      assert.deepEqual(await page.evaluate(() => ['#imgrow', '#imgcont'].map((id) => { const c = getComputedStyle(document.querySelector(id)); return c.paddingTop + '/' + c.paddingBottom; })), ['12px/6px', '0px/6px'], 'image rows');
      // narration → plain: 16 under the narration line + 14 above the plain text (row padding 8 + text margin 6) = 30, both ways
      assert.deepEqual(spacing, { singleTop: 30, singleBottom: 30, top: 30, bottom: 30, gap1: 6, gap2: 6, ordinary: '8px' });
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `narration-spacing-${width}.png`) });
    }
    console.log('PASS: narration group edges 16px, internal gaps 6px, ordinary rows unchanged');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
