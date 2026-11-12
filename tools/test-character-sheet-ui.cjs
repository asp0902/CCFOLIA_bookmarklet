const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 사이코로픽션(캐릭터 시트) UI: 편집창 버튼은 닫기 버튼 왼쪽에 있고 연결된 시트가 없으면 새 시트를 만들어 목록 없이 바로 열며, 목록 탭 바 오른쪽 끝에 ＋가 있다.
// 실제 character-sheet 스크립트 + 복제 편집창(네이티브 앱바 · 이름/메모 입력).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">
      <span class="MuiTypography-caption">인세인</span>
      <div id="root"></div>
      <form id="chat" style="margin:8px"><textarea id="chatbox" style="width:300px"></textarea><button type="submit">전송</button></form>
      <div id="toolbar"><button aria-label="내 캐릭터">내 캐릭터</button></div>
      <div class="MuiDialog-root" role="dialog" style="position:fixed;left:20px;top:200px;width:560px;background:#333">
        <div class="MuiAppBar-root"><div class="MuiToolbar-root" style="display:flex;align-items:center"><h6 class="MuiTypography-root MuiTypography-h6">캐릭터 편집</h6><div style="flex:1"></div><button class="MuiIconButton-root" aria-label="저장">저장</button><button class="MuiIconButton-root" id="native-close" aria-label="닫기">X</button></div></div>
        <div><input name="name" value="연갈"><textarea name="memo">메모 내용</textarea>
          <input name="status.0.label" value="생명력"><input name="status.0.value" value="5"><input name="status.0.max" value="6">
          <input name="status.1.label" value="이성치"><input name="status.1.value" value="4"><input name="status.1.max" value="6"></div></div></body>` }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__sent = [];
      document.getElementById('chat').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.getElementById('chatbox').value); });
      const state = { entities: { roomCharacters: { entities: { c1: { name: '연갈', iconUrl: 'https://example.test/icon.png' }, c2: { name: '다른이', iconUrl: 'https://example.test/other.png' } } } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } };
    });
    await page.addScriptTag({ content: source });
    const dialogButton = page.locator('[data-ccf-character-sheet-dialog-button]');
    await dialogButton.waitFor({ state: 'attached', timeout: 8000 });
    // position: right side, directly left of the close button (not right after the title)
    const pos = await page.evaluate(() => {
      const b = document.querySelector('[data-ccf-character-sheet-dialog-button]'), c = document.getElementById('native-close'), t = document.querySelector('.MuiToolbar-root h6');
      const rb = b.getBoundingClientRect(), rc = c.getBoundingClientRect(), rt = t.getBoundingClientRect();
      return { nextIsClose: b.nextElementSibling === c, leftOfClose: rb.right <= rc.left + 1, farFromTitle: rb.left - rt.right > 100, sameRow: Math.abs((rb.top + rb.height / 2) - (rc.top + rc.height / 2)) < 6 };
    });
    assert.deepEqual(pos, { nextIsClose: true, leftOfClose: true, farFromTitle: true, sameRow: true }, 'the button sits just left of the close button');
    // no linked sheet: a new sheet for this character opens at once (the editor, not the list)
    await dialogButton.click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor', { timeout: 5000 });
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-dialog.is-panel').count(), 0, 'the list was not shown');
    assert.equal(await page.locator('#ccf-character-sheet-root header h2').textContent(), '연갈');
    assert.equal(await page.locator('#ccf-character-sheet-root [data-field="memo"]').inputValue(), '메모 내용', 'filled from the native dialog');
    // layout: [image | life, sanity, merit, items] on top, the memo below, the respect row under it
    const layout = await page.evaluate(() => {
      const q = (sel) => document.querySelector('#ccf-character-sheet-root ' + sel).getBoundingClientRect();
      const portrait = q('.ccf-cs-portrait'), stats = q('.ccf-cs-stats-items'), memo = q('.ccf-cs-profile-memo'), respect = q('.ccf-cs-respect');
      return { src: document.querySelector('#ccf-character-sheet-root .ccf-cs-portrait img')?.getAttribute('src'), size: [Math.round(portrait.width), Math.round(portrait.height)], statsRight: stats.left >= portrait.right - 1, sameTop: Math.abs(stats.top - portrait.top) < 4, memoBelow: memo.top >= Math.max(portrait.bottom, stats.bottom) - 1, respectBelow: respect.top >= memo.bottom - 1 };
    });
    assert.deepEqual(layout, { src: 'https://example.test/icon.png', size: [120, 120], statsRight: true, sameTop: true, memoBelow: true, respectBelow: true }, 'image | stats on top, memo, respect row; the image defaults to the character icon');
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-stats-items [data-field="life"]').inputValue(), '5', 'life from the native dialog');
    assert((await page.locator('#ccf-character-sheet-root .ccf-cs-respect').boundingBox()).height <= 50, 'the respect row stays on one line');
    // the respect row
    const respectRow = await page.evaluate(() => { const r = document.querySelector('#ccf-character-sheet-root .ccf-cs-respect'); return { label: r.querySelector('strong').textContent, toggles: [...r.querySelectorAll('.ccf-cs-respect-toggle span')].map((e) => e.textContent), numbers: [...r.querySelectorAll('.ccf-cs-respect-number span')].map((e) => e.textContent), roll: !!r.querySelector('[data-action="respect-roll"] svg'), switches: [...r.querySelectorAll('input[role="switch"]')].length }; });
    assert.deepEqual(respectRow, { label: '리스펙', toggles: ['새로운 세계', '세션참여', '롤플레이', '획득', '사명달성'], numbers: ['심금', '기타'], roll: true, switches: 5 });
    const R = '#ccf-character-sheet-root';
    await page.locator(R + ' .ccf-cs-respect-toggle', { hasText: '새로운 세계' }).click();
    await page.locator(R + ' .ccf-cs-respect-toggle', { hasText: '사명달성' }).click();
    await page.locator(R + ' .ccf-cs-respect-number', { hasText: '기타' }).locator('input').fill('2');
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => { const raw = Object.keys(localStorage).filter((k) => k.startsWith('ccf-character-sheet:')).map((k) => JSON.parse(localStorage.getItem(k))); const sheet = raw[0].sheets.find((x) => x.name === '연갈'); return sheet.respec; });
    assert.deepEqual(saved, { newWorld: true, session: false, roleplay: false, gain: false, empathy: 0, mission: true, other: 2 }, 'the respect state is saved (TRPG management tool format)');
    // rolling: the breakdown goes to the chat, the merit grows by the total, the toggles and numbers reset
    await page.locator(R + ' [data-action="respect-roll"]').click();
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => window.__sent), ['리스펙: 새로운 세계 1 + 사명달성 1 + 기타 2 = 4']);
    assert.equal(await page.locator(R + ' [data-field="merit"]').inputValue(), '4', 'merit grew by the total');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-respect input')].map((i) => (i.type === 'checkbox' ? i.checked : i.value))), [false, false, false, false, false, '0', '0'], 'toggles and numbers reset');
    assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1, 'the sheet stays open');
    // nothing on: a notice, no message, merit unchanged
    await page.locator(R + ' [data-action="respect-roll"]').click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.__sent.length), 1); assert.equal(await page.locator(R + ' [data-field="merit"]').inputValue(), '4');
    // the image: a clicked prompt sets an own image, an empty answer goes back to the character icon
    await page.evaluate(() => { window.prompt = () => 'https://example.test/own.png'; });
    await page.locator(R + ' [data-action="portrait"]').click(); await page.waitForTimeout(150);
    assert.equal(await page.locator(R + ' .ccf-cs-portrait img').getAttribute('src'), 'https://example.test/own.png');
    await page.evaluate(() => { window.prompt = () => ''; });
    await page.locator(R + ' [data-action="portrait"]').click(); await page.waitForTimeout(150);
    assert.equal(await page.locator(R + ' .ccf-cs-portrait img').getAttribute('src'), 'https://example.test/icon.png');
    // a second press finds the linked sheet instead of making another
    await page.locator('#ccf-character-sheet-root [data-action="close"], #ccf-character-sheet-root header .ccf-cs-icon:last-of-type').last().click().catch(() => {});
    await page.evaluate(() => document.getElementById('ccf-character-sheet-root')?.remove());
    await dialogButton.click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor');
    assert.equal(await page.locator('#ccf-character-sheet-root header h2').textContent(), '연갈');
    await page.evaluate(() => document.getElementById('ccf-character-sheet-root')?.remove());
    // the list: ＋ is at the right end of the tab bar (list tab only), no heading row any more
    await page.locator('#toolbar [data-ccf-character-sheet-icon], [data-ccf-character-sheet-icon]').first().click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-tabs');
    const tabs = await page.evaluate(() => {
      const nav = document.querySelector('#ccf-character-sheet-root .ccf-cs-tabs'), add = nav.querySelector('[data-action="add-sheet"]');
      const rn = nav.getBoundingClientRect(), ra = add.getBoundingClientRect();
      return { inNav: !!add, lastChild: nav.lastElementChild === add, rightEnd: rn.right - ra.right < 24, heading: !!document.querySelector('#ccf-character-sheet-root .ccf-cs-panel-heading'), rows: document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-sheet-row').length };
    });
    assert.deepEqual({ ...tabs, rows: undefined }, { inNav: true, lastChild: true, rightEnd: true, heading: false, rows: undefined });
    assert.equal(tabs.rows, 2, 'the default sheet and the one made for 연갈 (still one for 연갈 after the second press)');
    await page.locator('#ccf-character-sheet-root [data-action="panel-settings"]').click();
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-tabs [data-action="add-sheet"]').count(), 0, 'no + on the settings tab');
    await page.locator('#ccf-character-sheet-root [data-action="panel-list"]').click();
    await page.locator('#ccf-character-sheet-root .ccf-cs-tabs [data-action="add-sheet"]').click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('character sheet ui PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
