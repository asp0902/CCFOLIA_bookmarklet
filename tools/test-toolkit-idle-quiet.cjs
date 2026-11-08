const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 툴킷 스크립트 전부를 켠 방(앱바·채팅 서랍·입력칸 래퍼·색 팝오버/테마 카드/ccr20 본문이 생기는 상태, 입력칸에 글)이 유휴일 때 문서가 계속 바뀌지 않는다.
// 스크립트끼리 서로의 DOM 쓰기에 반응해 다시 쓰는 핑퐁(실제 룸: 5초에 3220건)이 없고, 코코포리아 쪽 변화 1건이 연쇄로 수십 건이 되지도 않는다.
const root = path.join(__dirname, '..', 'legacy');
const names = ['format-sync', 'roll20-css-bridge', 'chat-panel', 'slash-macros', 'roll-triggers', 'chat-notifier', 'toolkit-presence', 'theme-switcher', 'log-package'];
const html = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div id="root">
 <div class="sc-clGGjC MuiAppBar-root" style="position:fixed;top:0;left:0;right:0;height:48px;background:#111"><div class="MuiToolbar-root"><h6>룸</h6><button aria-label="캐릭터 선택">캐릭터</button></div></div>
 <div class="MuiDrawer-paper" style="position:fixed;right:0;top:48px;width:360px;bottom:0;display:flex;flex-direction:column"><div role="log" style="flex:1;overflow:auto"><ul id="list"><li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">캐릭터</h6><p class="MuiListItemText-secondary">안녕</p></div></li></ul></div>
 <form id="composer"><div class="MuiFormControl-root"><div class="MuiInputBase-root MuiOutlinedInput-root"><textarea name="text" class="MuiInputBase-input" rows="2"></textarea></div></div><input name="name" value="나"><button type="submit">전송</button><button type="button" aria-label="D100">D100</button></form></div></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route('https://firestore.googleapis.com/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    for (const name of names) await page.addScriptTag({ content: fs.readFileSync(path.join(root, `ccfolia-${name}.user.js`), 'utf8') });
    await page.waitForTimeout(3000);
    await page.locator('textarea[name=text]').click();
    await page.locator('textarea[name=text]').fill('안녕하세요');
    await page.waitForTimeout(800);
    const watch = (ms, seeds) => page.evaluate(([duration, seedCount]) => new Promise((resolve) => {
      const counts = {}; let n = 0;
      const mo = new MutationObserver((records) => { for (const r of records) { n += 1; const t = r.target; const key = `${r.type}${r.attributeName ? ':' + r.attributeName : ''} ${t.nodeType === 1 ? t.tagName.toLowerCase() + (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '') : '#text'}`; counts[key] = (counts[key] || 0) + 1; } });
      mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      let seeded = 0; const timer = seedCount ? setInterval(() => { document.querySelector('.MuiToolbar-root h6').setAttribute('data-seed', String(++seeded)); }, Math.floor(duration / (seedCount + 1))) : 0;
      setTimeout(() => { clearInterval(timer); mo.disconnect(); resolve({ n, seeded, top: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6) }); }, duration);
    }), [ms, seeds]);
    const idle = await watch(2000, 0);
    assert(idle.n < 10, `idle: ${idle.n} document changes in 2 s ${JSON.stringify(idle.top)}`);
    const seeded = await watch(2400, 5);
    assert(seeded.n <= seeded.seeded + 8, `${seeded.seeded} native changes caused ${seeded.n} document changes (no amplification): ${JSON.stringify(seeded.top)}`);
    console.log('toolkit idle quiet', JSON.stringify({ idle: idle.n, seededChanges: seeded.seeded, seededTotal: seeded.n }));
  } finally { await browser.close(); }
  console.log('toolkit idle quiet PASS');
})().catch((e) => { console.error(e); process.exit(1); });
