const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 1) 서식 바 버튼이 커서/선택 영역의 실제 서식과 자동 서식(프리셋 이름)을 활성 모양(.ccf-fmt-current)으로 보여 준다(눌러서 켠 .active 와 별개).
// 2) 서식 프리셋 = 공용(모든 룸) + 이 룸 전용(format-sync 0.1.123): 옛 룸별 목록 1회 합치기(중복 없음·백업), 새 프리셋은 공용, '룸' 단추로 전환.
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
    const presetRows = async (page) => { await page.locator('[data-inline-group="extra"] [data-inline-group-toggle]').first().click(); await page.locator('[data-inline-command="style-clipboard"]').first().click(); await page.waitForSelector('.ccf-inline-popover.open'); await page.waitForTimeout(100); return page.locator('.ccf-style-preset-apply').allTextContents(); };

    // ---- 2) presets: shared by every room (global key) + this room's own (room key) - format-sync 0.1.123
    await context.addInitScript(() => {});
    const P = (k) => (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), k);
    const shared = P('ccf-format-style-presets-v1'), roomA = P('ccf-format-style-presets-v1:A'), roomB = P('ccf-format-style-presets-v1:B');
    // the old per-room data: A and B each hold the copy of the global list + their own; B has a same-named preset with another style
    let a = await open('/rooms/A', () => { if (!localStorage.getItem('ccf-test-seeded')) { localStorage.setItem('ccf-test-seeded', '1');
      localStorage.setItem('ccf-format-style-presets-v1', JSON.stringify([{ name: '전역서식', style: { bold: true }, auto: true, savedAt: 1 }]));
      localStorage.setItem('ccf-format-style-presets-v1:A', JSON.stringify([{ name: '전역서식', style: { bold: true }, auto: true, savedAt: 1 }, { name: '옛룸A', style: { strike: true }, auto: false, savedAt: 2 }]));
      localStorage.setItem('ccf-format-style-presets-v1:B', JSON.stringify([{ name: '전역서식', style: { bold: true }, auto: true, savedAt: 1 }, { name: '옛룸A', style: { color: '#ff0000' }, auto: false, savedAt: 3 }])); } });
    // migration (once): merged into the shared list without duplicates; a same name with another style comes up as "name (room)"; the room keys are emptied; a backup of everything
    assert.deepEqual((await shared(a)).map((p) => p.name), ['전역서식', '옛룸A', '옛룸A (B)']);
    assert.deepEqual([await roomA(a), await roomB(a)], [[], []]);
    const backup = await a.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-backup-1117') || 'null'));
    assert(backup && JSON.parse(backup['ccf-format-style-presets-v1:B']).length === 2, 'backup of the old lists');
    assert.equal((await presetRows(a)).filter((t) => t.trim()).length, 3, 'room A shows the shared list');
    assert.equal(await a.locator('.ccf-inline-popover.open [data-preset-room]').count(), 0, 'the "이 룸의 서식 프리셋" caption was removed');
    // a new preset is shared
    await a.evaluate(() => { const t = document.querySelector('textarea[name=text]'); t.value = '문장'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await a.locator('.ccf-inline-popover.open [data-style-preset-name]').fill('룸A서식');
    await a.locator('.ccf-inline-popover.open [data-style-builder="italic"]').click();
    await a.locator('.ccf-inline-popover.open .ccf-inline-popover-actions [data-inline-style-action="add"]').click();
    await a.waitForTimeout(200);
    assert.deepEqual((await shared(a)).map((p) => p.name), ['전역서식', '옛룸A', '옛룸A (B)', '룸A서식'], 'new = shared');
    const b = await open('/rooms/B');
    assert.equal((await presetRows(b)).filter((t) => t.trim()).length, 4, 'room B sees the shared presets');
    // 이 룸 전용: the '룸' toggle moves it into room A only; again moves it back
    await a.locator('.ccf-style-preset-scope').nth(3).click(); await a.waitForTimeout(200);
    assert.deepEqual([(await shared(a)).length, (await roomA(a)).map((p) => p.name)], [3, ['룸A서식']]);
    assert.equal(await a.locator('.ccf-style-preset-scope.is-room').count(), 1, 'marked 이 룸');
    const b2 = await open('/rooms/B');
    assert.equal((await presetRows(b2)).filter((t) => t.trim()).length, 3, 'room B does not show A-only');
    const a2 = await open('/rooms/A');
    assert.equal((await presetRows(a2)).filter((t) => t.trim()).length, 4, 'room A (another tab) shows shared + its own');
    await a.locator('.ccf-style-preset-scope.is-room').first().click(); await a.waitForTimeout(200);
    assert.deepEqual([(await shared(a)).length, (await roomA(a)).length], [4, 0], 'back to shared');
    // the migration runs once: emptied room keys are not merged again
    await a.reload(); await a.addScriptTag({ content: source }); await a.waitForSelector('[data-inline-command="bold"]', { state: 'attached' }); await a.waitForTimeout(400);
    assert.equal((await shared(a)).length, 4);
    // outside a room (home) the format bar and its presets are not shown at all
    const home = await open('/home', null, false);
    assert.equal(await home.locator('[data-inline-command="style-clipboard"]').count(), 0, 'home: no preset button');
    await home.close(); await b.close(); await b2.close(); await a2.close();

    // ---- 1) current formatting on the buttons (the shared presets include 룸A서식=italic and 전역서식=bold)
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
