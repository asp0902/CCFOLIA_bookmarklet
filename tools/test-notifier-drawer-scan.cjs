const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 알림 스크립트는 메시지 줄마다 같은 채팅 서랍을 다시 판정하지 않는다(줄 수만큼 제목을 훑으면 O(줄²) — 큰 방의 로드·첫 전송이 1초 이상 멈췄다).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const rows = 600;
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div class="MuiDrawer-paper" style="position:fixed;right:0;top:0;width:360px;height:100%;display:flex;flex-direction:column"><div role="log" style="flex:1;overflow:auto"><ul id="list">${Array.from({ length: rows }, (_, i) => `<li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">캐릭터${i % 5}</h6><p class="MuiListItemText-secondary">메시지 ${i}</p></div></li>`).join('')}</ul></div><form><textarea name="text"></textarea><button type="submit">전송</button></form></div></body>` }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => { window.__h = 0; const orig = Element.prototype.querySelectorAll; Element.prototype.querySelectorAll = function (sel, ...a) { if (sel === 'h1,h2,h3,h4,h5,h6') window.__h += 1; return orig.call(this, sel, ...a); }; });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">나</h6><p class="MuiListItemText-secondary">새 글</p></div>'; document.getElementById('list').append(li); });
    await page.waitForTimeout(2000);
    const heading = await page.evaluate(() => window.__h);
    assert(heading < 60, `the chat drawer is judged a few times, not once per row (${heading} heading scans for ${rows} rows)`);
    console.log('notifier drawer scans', heading, 'for', rows, 'rows');
    assert(heading >= 1, 'the drawer is judged at least once (the notifier is really scanning)');
  } finally { await browser.close(); }
  console.log('notifier drawer scan PASS');
})().catch((e) => { console.error(e); process.exit(1); });
