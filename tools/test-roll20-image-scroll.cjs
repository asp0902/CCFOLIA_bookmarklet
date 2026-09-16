const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const prose = source.slice(source.indexOf('// ===== Prose Mode'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>#chat{height:200px;width:320px;overflow-y:auto}img{display:block}</style>
      <div id="chat"><div id="content"><div class="MuiListItem-root"><h6 class="MuiListItemText-primary">GM</h6><p class="MuiTypography-body2"><img id="image"></p></div></div></div>`);
    await page.addScriptTag({ content: prose });
    const loadImage = height => page.evaluate(async h => {
      const img = document.querySelector('#image');
      await new Promise(resolve => { img.onload = resolve; img.src = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${h}"><rect width="200" height="${h}" fill="gray"/></svg>`); });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, height);
    const gap = () => page.$eval('#chat', el => el.scrollHeight - el.clientHeight - el.scrollTop);
    await loadImage(600);
    assert(await gap() <= 2, 'first delayed image must scroll a previously non-overflowing chat to bottom');
    await page.evaluate(() => {
      const chat = document.querySelector('#chat');
      chat.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      chat.scrollTop = 50;
    });
    await loadImage(800);
    assert.equal(await page.$eval('#chat', el => el.scrollTop), 50, 'keep reader position');
    await page.$eval('#chat', el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => document.querySelector('#content').replaceWith(document.querySelector('#content').cloneNode(true)));
    await loadImage(1000);
    assert(await gap() <= 2, 'replaced virtual list must keep following images');
    await page.$eval('#content', el => { el.style.height = `${el.offsetHeight}px`; });
    await loadImage(1300);
    assert(await gap() <= 2, 'image load must follow overflow even when spacer height stays fixed');
    await page.evaluate(() => window.__CCF_PROSE_MODE_DEBUG__.disable());
    assert.equal(await page.$eval('#chat', el => el.__ccr20BottomFinisher), undefined);
    await page.addScriptTag({ content: prose });
    await loadImage(1500);
    assert(await gap() <= 2, 'reenabling must bind a fresh observer');
    console.log('PASS: delayed images, reader position, replaced/fixed list, disable and reenable');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
