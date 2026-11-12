const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 1) 서식 바 버튼이 커서/선택 영역의 실제 서식과 자동 서식(프리셋 이름)을 활성 모양(.ccf-fmt-current)으로 보여 준다(눌러서 켠 .active 와 별개).
// 2) 서식 프리셋은 룸별로 저장된다: 첫 진입 때 전역 목록 복사(원본 유지), 룸 A에서 바꾼 것은 룸 B에 안 보임, 홈에서는 비어 있음, 다른 탭의 변경이 반영됨.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const GLOBAL_KEY = 'ccf-format-style-presets-v1';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await context.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div role="log"><ul id="list"></ul></div><form id="composer"><textarea name="text" class="MuiInputBase-input" rows="3"></textarea><button type="submit">전송</button><button type="button" aria-label="D100">D100</button></form></body>' }));
    const open = async (roomPath, init, expectToolbar = true) => {
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.goto('https://ccfolia.com' + roomPath);
      if (init) await page.evaluate(init);
      await page.addScriptTag({ content: source });
      if (expectToolbar) await page.waitForSelector('[data-inline-command="bold"]', { state: 'attached', timeout: 8000 });
      await page.waitForTimeout(400);
      return page;
    };
    const current = (page, command) => page.locator(`[data-inline-command="${command}"]`).first().evaluate((b) => ({ current: b.classList.contains('ccf-fmt-current'), active: b.classList.contains('active'), bg: getComputedStyle(b).backgroundColor }));
    const caret = async (page, start, end = start) => { await page.evaluate(([s, e]) => { const t = document.querySelector('textarea[name=text]'); t.focus(); t.setSelectionRange(s, e); t.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); }, [start, end]); await page.waitForTimeout(120); };
    const presetRows = async (page) => { await page.locator('[data-inline-command="style-clipboard"]').first().click(); await page.waitForSelector('.ccf-inline-popover.open'); await page.waitForTimeout(100); return page.locator('.ccf-style-preset-apply').allTextContents(); };

    // ---- 2) per-room presets
    await context.addInitScript(() => {});
    let a = await open('/rooms/A', () => { if (!localStorage.getItem('ccf-test-seeded')) { localStorage.setItem('ccf-test-seeded', '1'); localStorage.setItem('ccf-format-style-presets-v1', JSON.stringify([{ name: '전역서식', style: { bold: true }, auto: true, savedAt: 1 }])); } });
    assert.deepEqual((await presetRows(a)).map((t) => t.trim()).filter(Boolean).length, 1, 'first visit: the global list is copied into room A');
    assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:A')).length), 1);
    assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1')).length), 1, 'the global original stays');
    assert.match(await a.locator('.ccf-inline-popover.open [data-preset-room]').textContent(), /이 룸의 서식 프리셋/);
    // add a preset in room A (builder: bold + name)
    await a.evaluate(() => { const t = document.querySelector('textarea[name=text]'); t.value = '문장'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await a.locator('.ccf-inline-popover.open [data-style-preset-name]').fill('룸A서식');
    await a.locator('.ccf-inline-popover.open [data-style-builder="italic"]').click();
    await a.locator('.ccf-inline-popover.open .ccf-inline-popover-actions [data-inline-style-action="add"]').click();
    await a.waitForTimeout(200);
    assert.deepEqual(await a.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:A')).map((p) => p.name)), ['전역서식', '룸A서식']);
    assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1')).length), 1, 'the global list is not touched by a room change');
    // another tab of the same room sees the change at once (storage event); a second room starts from the global list, not from room A
    const a2 = await open('/rooms/A');
    await a2.locator('[data-inline-command="style-clipboard"]').first().click();
    await a2.waitForSelector('.ccf-inline-popover.open .ccf-style-preset-apply');
    assert.equal(await a2.locator('.ccf-style-preset-apply').count(), 2, 'room A (second tab) shows both');
    await a.evaluate(() => { const list = JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:A')); list.push({ name: '세번째', style: { underline: true }, auto: true, savedAt: 3 }); localStorage.setItem('ccf-format-style-presets-v1:A', JSON.stringify(list)); });
    await a2.waitForFunction(() => document.querySelectorAll('.ccf-style-preset-apply').length === 3, null, { timeout: 4000 });
    const b = await open('/rooms/B');
    assert.equal((await presetRows(b)).filter((t) => t.trim()).length, 1, 'room B: only the copy of the global list (room A changes are not here)');
    assert.deepEqual(await b.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:B')).map((p) => p.name)), ['전역서식']);
    // the per-preset auto switch is part of the room's list: switching it off in B does not change A
    await b.locator('.ccf-style-preset-auto-dot').first().click(); await b.waitForTimeout(150);
    assert.equal(await b.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:B'))[0].auto), false);
    assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:A'))[0].auto), true, 'room A keeps its own auto switch');
    // reload keeps it; outside a room (home) there is no list
    await b.reload();
    await b.addScriptTag({ content: source }); await b.waitForSelector('[data-inline-command="bold"]', { state: 'attached' }); await b.waitForTimeout(400);
    assert.equal(await b.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:B'))[0].auto), false, 'survives a reload');
    // outside a room (home) the format bar and its presets are not shown at all, and nothing is read or written for presets
    const home = await open('/home', null, false);
    assert.equal(await home.locator('[data-inline-command="style-clipboard"]').count(), 0, 'home: no preset button');
    assert.deepEqual(await home.evaluate(() => Object.keys(localStorage).filter((k) => /^ccf-format-style-presets-v1:$/.test(k))), []);
    await home.close(); await b.close(); await a2.close();

    // ---- 1) current formatting on the buttons (room A has the preset 룸A서식=italic and 전역서식=bold)
    const page = a;
    await page.evaluate(() => { const t = document.querySelector('textarea[name=text]'); t.value = '굵게 보통 전역서식 끝'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150);
    // bold applied to the first word with the B button
    await caret(page, 0, 2);
    await page.locator('[data-inline-command="bold"]').first().click(); await page.waitForTimeout(200);
    await caret(page, 1);
    assert.equal((await current(page, 'bold')).current, true, 'caret inside bold text: B shows as current');
    assert.equal((await current(page, 'italic')).current, false, 'I is not');
    await caret(page, 6);
    assert.equal((await current(page, 'bold')).current, false, 'caret outside: B is not current');
    // the preset word is turned bold by the auto preset at send time: B shows current inside it
    const wordAt = '굵게 보통 전역서식 끝'.indexOf('전역서식');
    await caret(page, wordAt + 1);
    assert.equal((await current(page, 'bold')).current, true, 'inside a preset-formatted word: the preset style shows on the button');
    await caret(page, wordAt + 5); // after the word, the character before the caret is the space
    assert.equal((await current(page, 'bold')).current, false);
    // a selection that is only partly formatted is not current; fully inside is
    await caret(page, 0, 2); assert.equal((await current(page, 'bold')).current, true);
    await caret(page, 0, 6); assert.equal((await current(page, 'bold')).current, false, 'mixed selection: not current');
    // the look is the active look
    await caret(page, 1);
    const look = await current(page, 'bold'); const plain = await current(page, 'strike');
    assert.notEqual(look.bg, plain.bg, 'a current button has the active background');
    // idle: the sync does not keep rewriting anything
    const writes = await page.evaluate(() => new Promise((resolve) => { let n = 0; const mo = new MutationObserver((r) => { n += r.length; }); mo.observe(document, { subtree: true, childList: true, attributes: true }); setTimeout(() => { mo.disconnect(); resolve(n); }, 1200); }));
    assert(writes < 6, `idle: ${writes} document changes`);
    assert.deepEqual(page.__errors, [], 'no page errors');
    console.log('format active + room presets PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
