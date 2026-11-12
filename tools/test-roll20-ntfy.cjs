// Roll20 new chat message -> phone push (extension roll20-reader.js): the history present at load and the first seconds is never pushed; another person's line -> one push
// (title "[Roll20] 이름", body only with includeText); my line (.you / my speaker) skipped; a roll is summarised "주사위: 결과"; a whisper to me is "[Roll20 귓속말]"; system lines skipped;
// onlyAway (watching the tab) skipped; per-minute cap; batching ("외 N건"); the Roll20-only switch ("roll20": false). The reader keeps its status in documentElement.dataset.capybaraR20Ntfy.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const reader = fs.readFileSync(path.join(__dirname, '../extension/personal/roll20-reader.js'), 'utf8');
const message = (id, cls, by, body) => `<div class="message ${cls}" data-messageid="${id}"><div class="spacer"></div>${by ? `<span class="tstamp">5:30PM</span><span class="by">${by}:</span>` : ''}${body}</div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async (config) => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://app.roll20.net/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body><div id="textchat"><div class="content">${message('h1', 'general', '옛날', '이력 한 줄')}</div><div id="textchat-input"><textarea></textarea><select id="speakingas"><option>나의 캐릭터</option></select><button id="chatSendBtn">Send</button></div></div></body>` }));
      await page.goto('https://app.roll20.net/editor/');
      await page.evaluate((config) => {
        window.__sent = []; const stored = { ntfy: config };
        window.chrome = { runtime: { id: 'x', sendMessage: (m) => { window.__sent.push(m); return Promise.resolve({ ok: true }); } }, storage: { local: { get: async () => stored }, onChanged: { addListener() {} }, session: { get: async () => ({}), set: async () => {} } } };
        document.hasFocus = () => !window.__focused; window.__focused = false;
      }, config);
      await page.addScriptTag({ content: reader });
      return page;
    };
    const status = (page) => page.evaluate(() => JSON.parse(document.documentElement.dataset.capybaraR20Ntfy || 'null'));
    const add = (page, html) => page.evaluate((h) => { const t = document.createElement('template'); t.innerHTML = h; document.querySelector('#textchat .content').appendChild(t.content.firstElementChild); }, html);
    const sent = (page) => page.evaluate(() => window.__sent.filter((m) => m.type === 'ntfy-send').map((m) => m.payload));
    const base = { enabled: true, topic: 'test-topic_1', scope: 'all', onlyAway: false, includeText: true, awayMinutes: 2 };
    // 1) history and the first seconds are never pushed; later lines are
    let page = await open(base);
    await add(page, message('e1', 'general', '일찍', '로드 직후 줄'));
    await page.waitForTimeout(1200);
    assert.deepEqual(await sent(page), [], 'nothing in the first seconds (history)');
    await page.waitForTimeout(2300); await add(page, message('e2', 'general', '일찍2', '3초 넘어 도착한 이력')); await page.waitForTimeout(500);
    assert.deepEqual(await sent(page), [], 'still history inside the grace'); assert.equal((await status(page)).lastSkip, '접속 직후 이력');
    await page.waitForTimeout(5000); // past the grace
    await add(page, message('n1', 'general', '다른사람', '안녕하세요 새 메시지입니다'));
    await page.waitForTimeout(700);
    assert.deepEqual(await sent(page), [{ title: '[Roll20] 다른사람', message: '다른사람: 안녕하세요 새 메시지입니다' }], 'another person: one push, name and a short body');
    // within the batch window: batched into one later push, "외 N건"
    await add(page, message('n2', 'general', '둘째', '두번째')); await add(page, message('n3', 'general', '셋째', '세번째'));
    await page.waitForTimeout(700);
    assert.equal((await sent(page)).length, 1, 'inside the 10 s window the next ones wait');
    // my own line / my speaker, system line
    await add(page, message('m1', 'general you', '나', '내가 쓴 말'));
    await add(page, message('m2', 'general', '나의 캐릭터', '선택한 발화자로 쓴 말'));
    await page.waitForTimeout(400);
    const st = await status(page); assert.equal(st.lastSkip, '내 메시지');
    await add(page, message('s1', 'system', '', '<div>시스템 알림</div>'));
    await page.waitForTimeout(300);
    assert.deepEqual(page.__errors, []); await page.close();
    // 2) roll summary, whisper, long body, no text unless includeText, Roll20 switch off, onlyAway
    page = await open({ ...base, includeText: false });
    await page.waitForTimeout(8400);
    await add(page, message('r1', 'rollresult', '굴리는이', '<div class="formula">rolling 1d20+5</div><div class="rolled">17</div>'));
    await page.waitForTimeout(600);
    assert.deepEqual(await sent(page), [{ title: '[Roll20] 굴리는이', message: '새 메시지가 도착했습니다.' }], 'without includeText the body stays generic');
    await page.close();
    page = await open(base); await page.waitForTimeout(8400);
    await add(page, message('r2', 'rollresult', '굴리는이', '<div class="formula">rolling 1d20+5</div><div class="rolled">17</div>')); await page.waitForTimeout(500);
    assert.deepEqual(await sent(page), [{ title: '[Roll20] 굴리는이', message: '굴리는이: 주사위: 17' }], 'a roll is summarised as 주사위: result');
    await page.waitForTimeout(10300);
    await add(page, message('w1', 'private', '귓말이', '비밀이야 ' + '길게'.repeat(60))); await page.waitForTimeout(500);
    const whisper = (await sent(page))[1]; assert.equal(whisper.title, '[Roll20 귓속말] 귓말이'); assert(whisper.message.length <= 64 + 6, 'body is short (60 characters)'); assert.match(whisper.message, /^귓말이: 비밀이야/);
    await page.close();
    page = await open({ ...base, roll20: false }); await page.waitForTimeout(8400);
    await add(page, message('o1', 'general', '누구', '꺼진 상태')); await page.waitForTimeout(500);
    assert.deepEqual(await sent(page), []); assert.equal((await status(page)).lastSkip, 'Roll20 알림 꺼짐'); assert.equal((await status(page)).roll20Switch, false); await page.close();
    page = await open({ ...base, onlyAway: true }); await page.waitForTimeout(8400);
    await page.mouse.move(100, 100); await add(page, message('a1', 'general', '누구', '보고 있는 중')); await page.waitForTimeout(500);
    assert.deepEqual(await sent(page), [], 'onlyAway: watching the tab'); assert.match((await status(page)).lastSkip, /보고 있음/);
    await page.evaluate(() => { window.__focused = true; }); await add(page, message('a2', 'general', '누구', '창을 벗어남')); await page.waitForTimeout(500);
    assert.equal((await sent(page)).length, 1, 'onlyAway: away (window not focused) → pushed'); await page.close();
    // 3) disabled or no topic: nothing, a reason
    page = await open({ ...base, enabled: false }); await page.waitForTimeout(8400);
    await add(page, message('d1', 'general', '누구', '꺼짐')); await page.waitForTimeout(400); assert.deepEqual(await sent(page), []); await page.close();
    // the paste-in file for the 'User JavaScript and CSS' extension (page context, fetch): same rules; the topic is blank in the file and stays unused until typed in
    {
      const userjs = fs.readFileSync(path.join(__dirname, 'roll20-ntfy.user-js.js'), 'utf8');
      assert(userjs.includes('topic: "",'), 'the file ships with an empty topic');
      const page = await browser.newPage(); const posts = [];
      await page.route('https://ntfy.sh/**', (r) => { posts.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ status: 200, body: '{}' }); });
      await page.route('https://app.roll20.net/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body><div id="textchat"><div class="content"></div><div id="textchat-input"><select id="speakingas"><option>나</option></select></div></div></body>' }));
      await page.goto('https://app.roll20.net/editor/');
      await page.addScriptTag({ content: userjs.replace('topic: "",', 'topic: "test-topic_1",').replace('onlyAway: true', 'onlyAway: false').replace('includeText: false', 'includeText: true') });
      await page.waitForTimeout(8400);
      await add(page, message('u1', 'general', '다른사람', '유저JS 경로'));
      await page.waitForTimeout(700);
      assert.deepEqual(posts.map((b) => [b.topic, b.title, b.message]), [['test-topic_1', '[Roll20] 다른사람', '다른사람: 유저JS 경로']], 'user-js path pushes once');
      await add(page, message('u2', 'general you', '나', '내 말')); await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => window.__R20_NTFY_STATE__.lastSkip), '내 메시지'); assert.equal(posts.length, 1); await page.close();
    }
    console.log('roll20 ntfy PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
