const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// CCFOLIA's virtual list scrolls the same scroller with scrollTo; the bridge must not write scrollTop right after that (the two tugged against each other and the list shook),
// and must put the list on the bottom once, after the page has been quiet.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const prose = source.slice(source.indexOf('// ===== Prose Mode'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>#chat{height:300px;width:320px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px 16px}h6{margin:0;height:20px}p{margin:0}</style>
      <div id="chat"><ul class="MuiList-root" id="list"></ul></div>`);
    await page.addScriptTag({ content: prose });
    const result = await page.evaluate(async () => {
      const chat = document.querySelector('#chat'), list = document.querySelector('#list');
      const add = (i) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">A${i}</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); };
      for (let i = 0; i < 12; i += 1) add(i);
      await new Promise((r) => setTimeout(r, 400));
      // count the writes of scrollTop from now on
      const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      let writes = 0; const writeTimes = [];
      Object.defineProperty(chat, 'scrollTop', { configurable: true, get() { return desc.get.call(this); }, set(v) { writes += 1; writeTimes.push(performance.now()); desc.set.call(this, v); } });
      // the page scrolls the list by scrollTo (like the virtual list) and, in the same moment, the content grows
      const t0 = performance.now();
      chat.scrollTo({ top: 5 });
      add(99); add(100);
      await new Promise((r) => setTimeout(r, 120));
      const writesInQuiet = writes;
      await new Promise((r) => setTimeout(r, 600));
      const gap = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
      return { writesInQuiet, gap, firstWrite: writeTimes.length ? Math.round(writeTimes[0] - t0) : null };
    });
    assert.equal(result.writesInQuiet, 0, 'no scrollTop write right after the page scrolled: ' + JSON.stringify(result));
    assert.ok(result.gap <= 2, 'on the bottom afterwards: ' + JSON.stringify(result));
    console.log('chat scroll native quiet PASS', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
