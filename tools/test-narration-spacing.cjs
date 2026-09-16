const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const read = name => fs.readFileSync(path.join(__dirname, '../legacy', name), 'utf8');
const styleFunction = source => {
  const start = source.indexOf('  function injectStyle()');
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const format = styleFunction(read('ccfolia-format-sync.user.js'));
const bridge = read('ccfolia-roll20-css-bridge.user.js');
const prose = styleFunction(bridge.slice(bridge.indexOf('// ===== Prose Mode')));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const row = (id, attrs = '', narration = true) => `<div class="MuiListItem-root" id="${id}" ${attrs}><div class="MuiListItemText-root"><p class="MuiListItemText-secondary ccf-render-root" ${narration ? 'data-ccf-narration="1"' : ''}><span class="ccf-line">${id}</span></p></div></div>`;
    await page.setContent(`<style>body{background:#282828;color:white;font:16px sans-serif}.MuiListItem-root{padding:8px 16px;display:flex}.MuiListItemText-root{margin:6px 0}.ccf-render-root{margin:0;line-height:24px}.ccf-line{display:block}section{max-width:320px;border-block:1px solid #555;margin-bottom:20px}</style>
      <section id="single-group">${row('single')}</section>
      <section id="multi-group">${row('first', 'data-ccf-prose-cont-leader="1"')}${row('middle', 'data-ccf-prose-cont="1"')}${row('last', 'data-ccf-prose-cont="1" data-ccf-prose-cont-last="1"')}</section>
      ${row('ordinary', '', false)}`);
    await page.addScriptTag({ content: `{const CCF_NARRATION_ATTR='data-ccf-narration';const CCF_NARRATION_PANEL_ATTR='data-ccf-narration-panel';${format};injectStyle();}` });
    await page.addScriptTag({ content: `{const STYLE_ID='ccfolia-prose-mode-style';const CONT_ATTR='data-ccf-prose-cont';${prose};injectStyle();}` });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 600 });
      const spacing = await page.evaluate(() => {
        const rect = id => document.querySelector(id).getBoundingClientRect();
        const line = id => rect(`#${id} .ccf-line`);
        return { singleTop: line('single').top - rect('#single-group').top - 1,
          singleBottom: rect('#single-group').bottom - line('single').bottom - 1,
          top: line('first').top - rect('#multi-group').top - 1,
          bottom: rect('#multi-group').bottom - line('last').bottom - 1,
          gap1: line('middle').top - line('first').bottom,
          gap2: line('last').top - line('middle').bottom,
          ordinary: getComputedStyle(document.querySelector('#ordinary')).paddingTop };
      });
      assert.deepEqual(spacing, { singleTop:16, singleBottom:16, top:16, bottom:16, gap1:6, gap2:6, ordinary:'8px' });
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `narration-spacing-${width}.png`) });
    }
    console.log('PASS: narration group edges 16px, internal gaps 6px, ordinary rows unchanged');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
