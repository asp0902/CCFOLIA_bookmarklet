const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 오리지널 입력칸 Enter 전송: 서식 없는 글도 한 번만 전송되고, 진단(ccfNativeSendTiming)이 단계별 시간을 남기며, [CCF NAR] 로그는 기본으로 조용하다.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8') + String.fromCharCode(10) + '//# sourceURL=https://example.test/ccfolia-format-sync.user.js';
const profiler = fs.readFileSync(path.join(__dirname, '../extension/personal/send-profiler.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  try {
    const open = async (timing) => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const logs = [];
      page.on('console', (m) => logs.push(m.text()));
      await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div role="log"><ul id="list"></ul></div><form id="composer"><textarea name="text" rows="2"></textarea><button type="submit">전송</button><button type="button">D100</button></form></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate((t) => {
        if (t) localStorage.setItem('ccfNativeSendTiming', '1');
        window.__sends = [];
        const form = document.getElementById('composer'); const ta = form.querySelector('textarea');
        // React 의 제어 입력칸처럼: input 이벤트를 받으면 props.value 를 갱신한다(format-sync 가 "React 가 값을 받았나"를 이걸로 확인한다)
        ta['__reactProps$t'] = { value: '' }; ta.addEventListener('input', () => { ta['__reactProps$t'].value = ta.value; });
        const send = () => { const v = ta.value; if (!v.trim()) return; window.__sends.push(v); ta.value = ''; ta['__reactProps$t'].value = ''; setTimeout(() => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<p class="MuiListItemText-secondary"></p>'; li.querySelector('p').textContent = v.replace(/[\u2062\u2063\u200b\u200c\u200d\u2060]/g, ''); document.getElementById('list').append(li); }, 40); };
        form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) { e.preventDefault(); send(); } });
        form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
      }, timing);
      if (timing) await page.addScriptTag({ content: profiler });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(800);
      return { page, logs };
    };
    // off (default): plain text sent once, no timing records, no "[CCF NAR]" noise
    {
      const { page, logs } = await open(false);
      await page.locator('textarea[name=text]').click(); await page.locator('textarea[name=text]').fill('평문 메시지'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('#list li').length === 1);
      await page.waitForTimeout(600);
      assert.deepEqual(await page.evaluate(() => window.__sends), ['평문 메시지'], 'plain text goes out exactly once');
      assert.deepEqual(await page.evaluate(() => window.__CCF_FORMAT_SYNC_RUNTIME__.sendTimingDiag()), [], 'no records while the switch is off');
      assert.equal(logs.filter((t) => t.includes('[CCF NAR]')).length, 0, '[CCF NAR] logs are quiet by default');
      assert.equal(logs.filter((t) => t.includes('[CCF send timing]')).length, 0);
      await page.close();
    }
    // on: steps are recorded for each send (last 5 kept)
    {
      const { page, logs } = await open(true);
      for (let i = 0; i < 6; i += 1) {
        await page.locator('textarea[name=text]').click(); await page.locator('textarea[name=text]').fill(`전송 ${i}`); await page.keyboard.press('Enter');
        await page.waitForFunction((n) => document.querySelectorAll('#list li').length === n, i + 1);
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(500);
      const diag = await page.evaluate(() => window.__CCF_FORMAT_SYNC_RUNTIME__.sendTimingDiag());
      assert.equal(diag.length, 5, 'keeps the last 5');
      const last = diag[4];
      for (const key of ['guards', 'prepared', 'keydown', 'click', 'cleared', 'row']) assert(typeof last.steps[key] === 'number', `step ${key} recorded: ${JSON.stringify(last.steps)}`);
      assert(last.steps.keydown < 200, 'keydown handler is short in the replica');
      // 서식(제목 문법)이 있는 글은 봉투가 입력칸에 새로 써진다 — React 가 값을 받은 걸 확인하면 마이크로태스크로, 그래도 한 번만 전송된다.
      await page.locator('textarea[name=text]').click(); await page.locator('textarea[name=text]').fill('# 제목'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('#list li').length === 7); await page.waitForTimeout(700);
      const fmt = (await page.evaluate(() => window.__CCF_FORMAT_SYNC_RUNTIME__.sendTimingDiag())).pop();
      assert.equal(fmt.kind, 'intercepted'); assert(fmt.steps.prepared != null);
      assert(fmt.steps.click - fmt.steps.keydown < 5, `an envelope message is submitted in a microtask once React has the value: ${JSON.stringify(fmt.steps)}`);
      assert.equal((await page.evaluate(() => window.__sends)).length, 7, 'exactly one send for the formatted message');
      assert(last.steps.click - last.steps.keydown < 5, `plain text is submitted right away (microtask), not behind a timer: ${JSON.stringify(last.steps)}`);
      assert(last.byScript && typeof last.byScript['format-sync'] === 'number', `profiler sums time per toolkit script: ${JSON.stringify(last.byScript)}`);
      assert(Array.isArray(last.top) && last.windowMs > 300, 'profiler window recorded');
      assert(logs.some((t) => t.includes('[CCF send timing]')), 'also logged to the console');
      assert.equal((await page.evaluate(() => window.__sends)).length, 7, 'still exactly one send per Enter');
      assert(last.top.every((t) => /d/.test(t.label) && t.n >= 1 && t.total >= t.max), 'top entries carry the registration site (function:line) and are merged');
      const idle = await page.evaluate(() => window.__CCF_FORMAT_SYNC_RUNTIME__.idleProfile(600));
      assert(typeof idle.mutations === 'number' && Array.isArray(idle.mutationTop) && idle.byScript && idle.windowMs >= 500, `idleProfile reports scripts and document changes: ${JSON.stringify(idle)}`);
      console.log('send timing sample', JSON.stringify(last));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log('native send timing PASS');
})().catch((e) => { console.error(e); process.exit(1); });
