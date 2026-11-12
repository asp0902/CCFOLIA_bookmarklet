// chat-notifier → ntfy hook: a live message from someone else always reaches the hook (ntfy total +1, one real POST), my own message is skipped by ntfy ("내 메시지"),
// the history that was already there at load never does; __CCF_NOTIFIER_DIAG__ explains blocks. Chat structure like CCFOLIA's: ul.MuiList-root > li.MuiListItem-root (h6 name, p text).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = (n) => fs.readFileSync(path.join(__dirname, '../legacy/' + n), 'utf8');
const notifier = read('ccfolia-chat-notifier.user.js'), ntfy = read('ccfolia-ntfy.user.js');
const row = (name, text, extra = '') => `<li class="MuiListItem-root" ${extra}><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary MuiTypography-subtitle2">${name}<span> - 2026/11/12 20:00</span></h6><p class="MuiTypography-root MuiListItemText-secondary MuiTypography-body2">${text}</p></div></li>`;
const html = (rows) => `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif"><div id="root"><div style="display:flex"><div class="MuiDrawer-paper" style="width:420px"><h6 class="MuiTypography-root MuiTypography-subtitle2">룸 채팅</h6><div id="chat" style="height:300px;overflow:auto"><ul class="MuiList-root" id="list" style="list-style:none;margin:0;padding:0">${rows}</ul></div><form><input name="name" value="나"><textarea></textarea><button type="submit">전송</button></form></div></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    for (const variant of ['plain', 'data-index']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const posts = [];
      await page.route('https://ntfy.sh/**', (r) => { posts.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ status: 200, body: '{}' }); });
      const idx = (n) => (variant === 'data-index' ? `data-index="${n}"` : '');
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html(row('옛날', '이미 있던 이력 1', idx(0)) + row('옛날', '이미 있던 이력 2', idx(1))) }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => localStorage.setItem('ccf-ntfy-v1', JSON.stringify({ enabled: true, topic: 'test-topic_1', scope: 'all', onlyAway: false, includeText: true, server: 'https://ntfy.sh', awayMinutes: 2 })));
      await page.addScriptTag({ content: ntfy });
      await page.addScriptTag({ content: notifier });
      await page.waitForTimeout(2600); // past the load grace
      assert.equal(await page.evaluate(() => window.__CCF_NTFY_STATE__.total), 0, variant + ': the history present at load is never pushed');
      assert.equal(posts.length, 0);
      // someone else writes: the hook is called, ntfy counts it and posts once
      await page.evaluate((idx) => { const t = (() => { const d = new Date(); return '今日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); })(); const li = document.createElement('template'); li.innerHTML = `<li class="MuiListItem-root" ${idx}><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary MuiTypography-subtitle2">다른사람<span> - ${t}</span></h6><p class="MuiTypography-root MuiListItemText-secondary MuiTypography-body2">안녕하세요 새 메시지</p></div></li>`; document.getElementById('list').appendChild(li.content.firstElementChild); }, idx(2));
      await page.waitForTimeout(1200);
      const diag1 = await page.evaluate(() => window.__CCF_NOTIFIER_DIAG__());
      assert.equal(await page.evaluate(() => window.__CCF_NTFY_STATE__.total), 1, `${variant}: other person's message -> total 1 (diag ${JSON.stringify(diag1)})`);
      assert.equal(posts.length, 1, 'one real POST'); assert.match(posts[0].message, /다른사람: 안녕하세요 새 메시지/);
      // my own message: ntfy skips it
      await page.evaluate((idx) => { const t = (() => { const d = new Date(); return '今日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); })(); const li = document.createElement('template'); li.innerHTML = `<li class="MuiListItem-root" ${idx}><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary MuiTypography-subtitle2">나<span> - ${t}</span></h6><p class="MuiTypography-root MuiListItemText-secondary MuiTypography-body2">내가 쓴 말</p></div></li>`; document.getElementById('list').appendChild(li.content.firstElementChild); }, idx(3));
      await page.waitForTimeout(1200);
      const st = await page.evaluate(() => ({ total: window.__CCF_NTFY_STATE__.total, lastSkip: window.__CCF_NTFY_STATE__.lastSkip }));
      assert.deepEqual(st, { total: 1, lastSkip: '내 메시지' }, variant + ': my message is skipped'); assert.equal(posts.length, 1);
      // the text of an existing row changes into a new message (virtual lists reuse rows): also reaches the hook
      await page.evaluate(() => { document.querySelector('#list li:first-child p').textContent = '재사용된 줄의 새 글'; document.querySelector('#list li:first-child h6').firstChild.textContent = '또다른사람'; document.querySelector('#list li:first-child h6 span').textContent = ' - ' + (() => { const d = new Date(); return '今日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); })(); });
      await page.waitForTimeout(1500);
      const reused = await page.evaluate(() => window.__CCF_NTFY_STATE__.total);
      assert.equal(reused, 2, variant + ': a reused row with new text is a new message');
      // an OLD row drawn again (tab switch / scroll up): not a new message
      await page.evaluate((idx) => { const li = document.createElement('template'); li.innerHTML = `<li class="MuiListItem-root" ${idx}><div class="MuiListItemAvatar-root"></div><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary MuiTypography-subtitle2">옛사람<span> - 2026/10/07 09:00</span></h6><p class="MuiTypography-root MuiListItemText-secondary MuiTypography-body2">오래된 글이 다시 그려짐</p></div></li>`; document.getElementById('list').appendChild(li.content.firstElementChild); }, idx(9));
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => window.__CCF_NTFY_STATE__.total), 2, variant + ': an old row drawn again is not pushed'); assert.equal(await page.evaluate(() => window.__CCF_NOTIFIER_DIAG__().blocked['old-timestamp'] >= 1), true);
      const diag = await page.evaluate(() => window.__CCF_NOTIFIER_DIAG__());
      assert(diag.hookCalls >= 3 && diag.hasHook, 'diag counts hook calls: ' + JSON.stringify(diag));
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('notifier ntfy hook PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
