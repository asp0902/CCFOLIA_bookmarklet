// 진단용(테스트 아님): 오리지널 코코포리아 입력칸 Enter → 전송 지연을 복제 페이지에서 단계별로 잰다.
//   node tools/measure-native-send.cjs [rows=300] [scripts=format-sync,css-bridge,...|none|all]
// 단계: ① keydown 처리 종료(디스패치 반환) ② 전송 호출(복제 Firestore 쓰기 시작) ③ 새 행이 그려지고 두 프레임이 지난 시각, 그리고 longtask.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.join(__dirname, '..', 'legacy');
const ALL = { 'format-sync': 'ccfolia-format-sync.user.js', 'css-bridge': 'ccfolia-roll20-css-bridge.user.js', 'chat-panel': 'ccfolia-chat-panel.user.js', 'slash-macros': 'ccfolia-slash-macros.user.js', 'roll-triggers': 'ccfolia-roll-triggers.user.js', notifier: 'ccfolia-chat-notifier.user.js' };
const rows = Number(process.argv[2] || 300);
const arg = process.argv[3] || 'all';
const sets = arg === 'each' ? [['none', []], ...Object.keys(ALL).map((k) => [k, [k]]), ['all', Object.keys(ALL)]] : [[arg, arg === 'none' ? [] : arg === 'all' ? Object.keys(ALL) : arg.split(',')]];
const html = (n) => `<!doctype html><meta charset=utf-8><style>
html,body{margin:0;height:100%}body{background:#282828;color:#fff;font:16px sans-serif}
#app{height:100%;display:flex}#main{flex:1}.MuiDrawer-paper{width:360px;height:100%;display:flex;flex-direction:column;background:#1b1b1b}
#list{flex:1;overflow-y:auto;margin:0;padding:0;list-style:none}.MuiListItem-root{padding:8px 16px;display:flex;border-top:1px solid #333}
.MuiListItemText-root{margin:0}.MuiListItemText-secondary{margin:0;line-height:24px}form{display:flex;gap:4px;padding:8px}textarea{flex:1;height:48px}
</style><div id=app><div id=main></div><div class=MuiDrawer-paper><header class=MuiAppBar-root>룸 채팅</header><div role=log><ul id=list>${Array.from({ length: n }, (_, i) => `<li class="MuiListItem-root"><div class="MuiListItemText-root"><span class="MuiListItemText-primary">캐릭터${i % 5}</span><p class="MuiListItemText-secondary">메시지 ${i} 가나다라마바사</p></div></li>`).join('')}</ul></div>
<form id=composer><textarea name=text placeholder="메시지를 입력"></textarea><button type=submit>전송</button><button type=button>D100</button></form></div></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const results = [];
  for (const [label, names] of sets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html(rows) }));
    await page.goto('https://ccfolia.com/rooms/test');
    // replica of CCFOLIA's composer: React reads the value at the form on Enter keydown (bubble) and on submit; the "Firestore write" lands 40 ms later
    await page.evaluate(() => {
      window.__t = {}; window.__long = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
      const form = document.getElementById('composer'); const ta = form.querySelector('textarea');
      const send = () => { const v = ta.value; if (!v.trim()) return; window.__t.write = performance.now(); ta.value = ''; setTimeout(() => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<div class="MuiListItemText-root"><span class="MuiListItemText-primary">나</span><p class="MuiListItemText-secondary"></p></div>`; li.querySelector('p').textContent = v; document.getElementById('list').append(li); li.scrollIntoView(); window.__t.rowAt = performance.now(); window.__t.row = li; }, 40); };
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) { e.preventDefault(); window.__t.nativeEnter = performance.now(); send(); } });
      form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    });
    for (const n of names) { try { await page.addScriptTag({ content: fs.readFileSync(path.join(root, ALL[n]), 'utf8') }); } catch (e) { console.log('load fail', n, e.message.slice(0, 80)); } }
    await page.waitForTimeout(1500);
    const run = async (text) => {
      await page.locator('textarea[name=text]').click();
      await page.evaluate(() => { window.__t = {}; window.__long.length = 0; });
      await page.locator('textarea[name=text]').fill(text);
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.__t = {}; window.__long.length = 0; window.__t.press = performance.now(); document.addEventListener('keydown', () => { window.__t.keydownSeen = performance.now(); }, { once: true, capture: true }); });
      await page.keyboard.press('Enter');
      await page.evaluate(() => { window.__t.afterPress = performance.now(); });
      await page.waitForFunction(() => window.__t.rowAt, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { window.__t.painted = performance.now(); r(); }))));
      await page.waitForTimeout(400);
      return page.evaluate(() => { const t = window.__t; const d = (x) => (x == null || t.press == null ? null : Math.round((x - t.press) * 10) / 10); return { write: d(t.write ?? t.nativeEnter), rowAt: d(t.rowAt), painted: d(t.painted), long: window.__long.slice() }; });
    };
    const plain = await run('평문 테스트 메시지');
    const plain2 = await run('두번째 평문');
    results.push({ label, plain, plain2 });
    console.log(label.padEnd(14), 'plain  write', plain.write, 'row', plain.rowAt, 'painted', plain.painted, 'long', JSON.stringify(plain.long), '| 2nd write', plain2.write, 'row', plain2.rowAt, 'painted', plain2.painted, 'long', JSON.stringify(plain2.long));
    await page.close();
  }
  await browser.close();
})();
