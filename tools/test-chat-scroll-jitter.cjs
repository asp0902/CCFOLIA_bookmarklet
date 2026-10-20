const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// Messages arrive in a chat that follows the bottom while the page itself starts a smooth scroll for each one (like CCFOLIA): the list must only move down, frame after frame,
// and a reader who scrolled up must not be moved at all.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
const prose = source.slice(source.indexOf('// ===== Prose Mode'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>#chat{height:300px;width:320px;overflow-y:auto;scroll-behavior:smooth}.MuiListItem-root{display:block;padding:8px 16px 16px}h6{margin:0;height:20px}p{margin:0}</style>
      <div id="chat"><ul class="MuiList-root" id="list"></ul></div>`);
    await page.addScriptTag({ content: prose });
    const run = (opts) => page.evaluate(async ({ authors, readerUp }) => {
      const chat = document.querySelector('#chat'), list = document.querySelector('#list');
      const frames = [];
      let running = true;
      const sample = () => { frames.push(chat.scrollTop); if (running) requestAnimationFrame(sample); };
      const add = (author, text) => {
        const li = document.createElement('li');
        li.className = 'MuiListItem-root';
        li.innerHTML = `<h6 class="MuiListItemText-primary">${author}</h6><p class="MuiListItemText-secondary">${text}</p>`;
        list.append(li);
        // the page's own follow-up: a smooth scroll to the bottom as measured when the message was added
        if (!readerUp || !window.__reading) chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' }); // a native list does not follow a reader who scrolled up
      };
      for (let i = 0; i < 12; i += 1) add('A', '첫 줄 ' + i);
      await new Promise(r => setTimeout(r, 300));
      if (readerUp) { window.__reading = true; chat.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); chat.scrollTop = 40; await new Promise(r => setTimeout(r, 100)); }
      const start = chat.scrollTop;
      requestAnimationFrame(sample);
      for (const author of authors) { add(author, '새 메시지 ' + author); await new Promise(r => setTimeout(r, 60)); }
      await new Promise(r => setTimeout(r, 500));
      running = false;
      const gap = chat.scrollHeight - chat.clientHeight - chat.scrollTop;
      let reversals = 0;
      for (let i = 1; i < frames.length; i += 1) if (frames[i] < frames[i - 1] - 0.5) reversals += 1;
      return { reversals, gap, start, end: chat.scrollTop };
    }, opts);
    const followed = await run({ authors: ['A', 'A', 'B', 'B', 'A', 'C', 'C', 'C', 'A', 'B'], readerUp: false });
    assert.equal(followed.reversals, 0, 'the list never moves back up while following the bottom');
    assert(followed.gap <= 2, 'and ends on the bottom');
    await page.reload();
    await page.setContent(`<style>#chat{height:300px;width:320px;overflow-y:auto;scroll-behavior:smooth}.MuiListItem-root{display:block;padding:8px 16px 16px}h6{margin:0;height:20px}p{margin:0}</style><div id="chat"><ul class="MuiList-root" id="list"></ul></div>`);
    await page.addScriptTag({ content: prose });
    const reader = await run({ authors: ['A', 'B', 'B', 'A'], readerUp: true });
    assert.equal(reader.end, reader.start, 'a reader who scrolled up is not moved');
    console.log('chat scroll jitter PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
