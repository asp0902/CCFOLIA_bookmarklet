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
      <div id="toolbar"><button aria-label="내 캐릭터">내 캐릭터</button></div>
      <div class="MuiDialog-root" role="dialog" style="position:fixed;left:20px;top:200px;width:560px;background:#333">
        <div class="MuiAppBar-root"><div class="MuiToolbar-root" style="display:flex;align-items:center"><h6 class="MuiTypography-root MuiTypography-h6">캐릭터 편집</h6><div style="flex:1"></div><button class="MuiIconButton-root" aria-label="저장">저장</button><button class="MuiIconButton-root" id="native-close" aria-label="닫기">X</button></div></div>
        <div><input name="name" value="연갈"><textarea name="memo">메모 내용</textarea>
          <input name="status.0.label" value="생명력"><input name="status.0.value" value="5"><input name="status.0.max" value="6">
          <input name="status.1.label" value="이성치"><input name="status.1.value" value="4"><input name="status.1.max" value="6"></div></div></body>` }));
    await page.goto('https://ccfolia.com/rooms/test');
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
