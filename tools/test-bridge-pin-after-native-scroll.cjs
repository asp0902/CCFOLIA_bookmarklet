const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// A new message arrives while CCFOLIA's own list keeps scrolling the scroller (many scrollTo calls and scroll events within a second): the bridge must not count its postponed calls as snaps,
// must not pause itself, and the list ends on the bottom once the page is quiet (the 5 s pause after 4 "snaps" a second used to leave the list above the new message).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const prose = source.slice(source.indexOf('// ===== Prose Mode'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<style>#chat{height:300px;width:320px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px 16px}h6{margin:0;height:20px}p{margin:0}</style><div id="chat"><ul class="MuiList-root" id="list"></ul></div>` }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.addScriptTag({ content: prose });
    const result = await page.evaluate(async () => {
      const chat = document.querySelector('#chat'), list = document.querySelector('#list');
      const add = (i) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">A${i}</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); };
      for (let i = 0; i < 12; i += 1) add(i);
      await new Promise((r) => setTimeout(r, 500));
      // the page's list scrolls a little back and forth by scrollTo for 1.2 s while messages arrive
      let n = 20;
      const timer = setInterval(() => { chat.scrollTo({ top: Math.max(0, chat.scrollTop - 15) }); }, 25);
      const adder = setInterval(() => add(n++), 250);
      await new Promise((r) => setTimeout(r, 1200));
      clearInterval(timer); clearInterval(adder);
      await new Promise((r) => setTimeout(r, 1500));
      const d = window.__CCF_PROSE_MODE_DEBUG__.safetyDiag();
      return { gap: Math.round(chat.scrollHeight - chat.scrollTop - chat.clientHeight), pauses: d.pauses, snaps: d.snaps, scrollers: d.scrollers };
    });
    assert.equal(result.pauses, 0, 'the bridge did not pause itself: ' + JSON.stringify(result));
    assert.ok(result.gap <= 2, 'the list is on the bottom afterwards: ' + JSON.stringify(result));
    console.log('bridge pin after native scroll PASS', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
