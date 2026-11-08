const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// A page that answers every bottom snap of the bridge with a scrollTo of its own (the virtual list fighting back) must not make the bridge snap forever:
// more than 4 snaps in a second pause the snapping for 5 s. A row whose group flag flips again and again is frozen. localStorage.ccfBridgeNoSnap = "1" switches snapping off.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const prose = source.slice(source.indexOf('// ===== Prose Mode'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: `<style>#chat{height:300px;width:320px;overflow-y:auto}.MuiListItem-root{display:block;padding:8px 16px 16px}h6{margin:0;height:20px}p{margin:0}</style>
      <div id="chat"><ul class="MuiList-root" id="list"></ul></div>` }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.addScriptTag({ content: prose });
    const result = await page.evaluate(async () => {
      const chat = document.querySelector('#chat'), list = document.querySelector('#list');
      const add = (i) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<h6 class="MuiListItemText-primary">A${i}</h6><p class="MuiListItemText-secondary">줄 ${i}</p>`; list.append(li); };
      for (let i = 0; i < 12; i += 1) add(i);
      await new Promise((r) => setTimeout(r, 400));
      // the "virtual list": whenever the list is on the bottom it scrolls itself 40px up (through scrollTo, so the bridge notes it), again and again
      const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      let writes = 0;
      Object.defineProperty(chat, 'scrollTop', { configurable: true, get() { return desc.get.call(this); }, set(v) { writes += 1; desc.set.call(this, v); } });
      chat.addEventListener('scroll', () => { const gap = chat.scrollHeight - chat.scrollTop - chat.clientHeight; if (gap <= 2) setTimeout(() => chat.scrollTo({ top: chat.scrollHeight - chat.clientHeight - 40 }), 5); });
      chat.scrollTo({ top: 3 });
      await new Promise((r) => setTimeout(r, 3000));
      const during = writes;
      const safety = window.__CCF_PROSE_MODE_DEBUG__.safetyDiag();
      return { writes: during, pauses: safety.pauses, snaps: safety.snaps };
    });
    assert.ok(result.pauses >= 1, 'the snapping was paused: ' + JSON.stringify(result));
    assert.ok(result.writes <= 12, 'the bridge did not keep writing scrollTop for 3 s: ' + JSON.stringify(result));
    // the off switch
    const off = await page.evaluate(async () => {
      localStorage.setItem('ccfBridgeNoSnap', '1');
      const chat = document.querySelector('#chat'); chat.scrollTo({ top: 0 }); const before = window.__CCF_PROSE_MODE_DEBUG__.safetyDiag().snaps;
      const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<h6 class="MuiListItemText-primary">Z</h6><p>z</p>'; document.querySelector('#list').append(li);
      await new Promise((r) => setTimeout(r, 700));
      return { before, after: window.__CCF_PROSE_MODE_DEBUG__.safetyDiag().snaps, sw: window.__CCF_PROSE_MODE_DEBUG__.safetyDiag().disabledBySwitch };
    });
    assert.equal(off.after, off.before, 'no snap with the switch on: ' + JSON.stringify(off)); assert.equal(off.sw, true);
    console.log('bridge snap loop guard PASS', JSON.stringify(result));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
