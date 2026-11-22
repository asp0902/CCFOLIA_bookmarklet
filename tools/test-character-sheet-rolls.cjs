const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 사이코로픽션 시트: 어빌리티/인물 두 칸 나란히(좁으면 접힘), 공개(회색)/비공개(빨강, 앞에 S) 판정 아이콘, 특기·공포·회피의 비공개 선택, 전체 수정치(공포 -2와 합산),
// 특기 이름-판정값 여백 절반, '내 캐릭터 목록' 모달 행의 사이코로픽션 버튼.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
const room = (insane) => `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">
  ${insane ? '<span class="MuiTypography-caption">인세인</span>' : '<span class="MuiTypography-caption">다른 시스템</span>'}
  <div id="root"></div><div id="toolbar"><button aria-label="내 캐릭터">내 캐릭터</button></div>
  <form id="chat" style="margin:8px"><textarea id="chatbox" style="width:300px"></textarea><button type="submit">전송</button></form>
  <div class="MuiDialog-root" role="dialog" id="charlist" style="position:fixed;right:20px;top:120px;width:360px;background:#333">
    <h2>내 캐릭터 목록</h2>
    <ul id="rows">
      <li class="MuiListItem-root" id="row1" style="display:flex;gap:6px"><div class="MuiListItemText-root" style="flex:1"><h6 class="MuiListItemText-primary">연갈</h6></div><button aria-label="토큰을 화면에서 삭제" class="MuiIconButton-root del">삭</button></li>
      <li class="MuiListItem-root" id="row2" style="display:flex;gap:6px"><div class="MuiListItemText-root" style="flex:1"><h6 class="MuiListItemText-primary">브릿지</h6></div><button aria-label="토큰을 화면에서 삭제" class="MuiIconButton-root del">삭</button></li>
    </ul></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async (insane, viewport = { width: 1300, height: 900 }) => {
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: room(insane) }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(() => {
        window.__sent = []; window.__rowClicks = 0;
        document.getElementById('chat').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.getElementById('chatbox').value); });
        document.getElementById('rows').addEventListener('click', () => { window.__rowClicks += 1; });
        const state = { entities: { roomCharacters: { entities: {} } } };
        document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } };
      });
      await page.addScriptTag({ content: source });
      return page;
    };
    const R = '#ccf-character-sheet-root';

    // ---- 내 캐릭터 목록: buttons only in an inSANe room, one per row, left of the delete button, no click through to the row
    {
      const page = await open(true);
      await page.waitForSelector('#row2 [data-ccf-character-sheet-row-button]', { timeout: 8000 });
      const pos = await page.evaluate(() => [...document.querySelectorAll('#rows li')].map((li) => { const b = li.querySelector('[data-ccf-character-sheet-row-button]'), d = li.querySelector('button[aria-label="토큰을 화면에서 삭제"]'); return { n: li.querySelectorAll('[data-ccf-character-sheet-row-button]').length, before: b.nextElementSibling === d, left: b.getBoundingClientRect().right <= d.getBoundingClientRect().left + 1, label: b.getAttribute('aria-label'), cls: b.className === d.className }; }));
      assert.deepEqual(pos, [{ n: 1, before: true, left: true, label: '사이코로픽션 시트', cls: true }, { n: 1, before: true, left: true, label: '사이코로픽션 시트', cls: true }]);
      // a re-render of the rows (the virtual list) does not duplicate them
      await page.evaluate(() => { const ul = document.getElementById('rows'); const rows = [...ul.children]; rows.forEach((r) => r.remove()); rows.forEach((r) => { r.querySelector('[data-ccf-character-sheet-row-button]')?.remove(); ul.appendChild(r); }); });
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#rows [data-ccf-character-sheet-row-button]').count(), 2, 'one per row after a re-render');
      await page.locator('#row2 [data-ccf-character-sheet-row-button]').click();
      await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
      assert.equal(await page.locator(R + ' header h2').textContent(), '브릿지', 'a sheet is made for that character and opened');
      assert.equal(await page.evaluate(() => window.__rowClicks), 0, 'the click did not reach the row');
      await page.evaluate(() => document.getElementById('ccf-character-sheet-root').remove());
      await page.locator('#row2 [data-ccf-character-sheet-row-button]').click();
      await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
      await page.evaluate(() => document.getElementById('ccf-character-sheet-root').remove());
      await page.locator('#row1 [data-ccf-character-sheet-row-button]').click();
      await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
      assert.equal(await page.locator(R + ' header h2').textContent(), '연갈');
      await page.locator(R + ' [data-action="back-list"]').click();
      assert.equal(await page.locator(R + ' .ccf-cs-sheet-row').count(), 2, '브릿지 + 연갈 (no default sheet) (a second press on 브릿지 reused its sheet)');
      assert.deepEqual(page.__errors, []);
      await page.close();
    }
    {
      const page = await open(false);
      await page.waitForTimeout(800);
      assert.equal(await page.locator('[data-ccf-character-sheet-row-button]').count(), 0, 'no buttons outside inSANe rooms');
      await page.close();
    }

    // ---- the sheet: two columns, rolls, modifier, gap
    const page = await open(true);
    await page.waitForSelector('#row1 [data-ccf-character-sheet-row-button]');
    await page.locator('#row1 [data-ccf-character-sheet-row-button]').click();
    await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
    const cols = () => page.evaluate(() => { const [a, p] = [...document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-duo > .ccf-cs-form-section')].map((e) => e.getBoundingClientRect()); return { sideBySide: Math.abs(a.top - p.top) < 4 && a.right <= p.left + 1, stacked: p.top >= a.bottom - 1, widths: [Math.round(a.width), Math.round(p.width)] }; });
    const wide = await cols();
    assert(wide.sideBySide, 'abilities (left) and people (right) sit side by side: ' + JSON.stringify(wide));
    assert(Math.abs(wide.widths[0] - 2 * wide.widths[1]) <= 2, 'abilities : people = 2 : 1 (' + JSON.stringify(wide.widths) + ')');
    await page.setViewportSize({ width: 560, height: 900 }); await page.waitForTimeout(300);
    assert((await cols()).stacked, 'a narrow sheet folds them into one column');
    await page.setViewportSize({ width: 1300, height: 900 }); await page.waitForTimeout(300);
    // skill name / value gap: about half of what it was (62px)
    const gap = await page.evaluate(() => { const b = document.querySelector('#ccf-character-sheet-root button[data-roll="0:7"]'); const small = b.querySelector('small').getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(b.firstChild); return Math.round(small.left - range.getBoundingClientRect().right); });
    assert(gap >= 38 && gap <= 44, `the gap between the longest skill name of a column and its value is about 40px (was 62, then 31), now ${gap}px`);
    // add an ability pointing at 소각 (0:0), and acquire 소각
    await page.locator(R + ' [data-skill="0:0"]').check();
    await page.locator(R + ' [data-add="abilities"]').click();
    await page.locator(R + ' .ccf-cs-abilities [data-prop="name"]').first().fill('기습');
    await page.locator(R + ' .ccf-cs-abilities [data-prop="target"]').first().fill('소각');
    // 0.5.57: the type box fits '서포트' (3 Korean letters + padding), the memo button sits right before the remove button
    await page.locator(R + ' .ccf-cs-abilities [data-prop="type"]').first().fill('서포트');
    const typeBox = await page.locator(R + ' .ccf-cs-abilities section [data-prop="type"]').first().evaluate((i) => ({ w: Math.round(i.getBoundingClientRect().width), fits: i.scrollWidth <= i.clientWidth, em: parseFloat(getComputedStyle(i).fontSize) }));
    assert(typeBox.fits && typeBox.w <= typeBox.em * 3 + 30, 'type box ~3 letters and 서포트 fits ' + JSON.stringify(typeBox));
    assert.equal(await page.locator(R + ' .ccf-cs-abilities section').first().evaluate((sec) => sec.querySelector('.ccf-cs-remove').previousElementSibling?.classList.contains('ccf-cs-note-toggle')), true, 'memo button right before ×');
    await page.locator(R + ' .ccf-cs-abilities [data-prop="type"]').first().fill('');
    const pair = await page.evaluate(() => [...document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-abilities .ccf-cs-roll-pair button')].map((b) => ({ color: getComputedStyle(b).color, secret: b.dataset.secret || '', svg: !!b.querySelector('svg circle'), size: [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)] })));
    assert.deepEqual(pair.map((b) => [b.color, b.secret]), [['rgb(255, 255, 255)', '']], 'abilities have only the public roll button, white');
    const roll = async (action) => { await page.evaluate(() => { window.__sent.length = 0; document.getElementById('chatbox').value = ''; }); await action(); await page.waitForTimeout(250); return { sent: await page.evaluate(() => window.__sent.slice()), box: await page.locator('#chatbox').inputValue() }; };
    const reopen = async () => { if (!(await page.locator(R + ' .ccf-cs-dialog.is-editor').count())) { await page.locator('#row1 [data-ccf-character-sheet-row-button]').click(); await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor'); } };
    page.on('dialog', (d) => d.accept('7')); // 목표치(숫자) prompt for the commands that still have a ?
    let r = await roll(() => page.locator(R + ' .ccf-cs-abilities .ccf-cs-roll-public').first().click());
    assert.deepEqual(r.sent, ['2D6>=5 [기습/소각]'], 'public ability roll is unchanged'); await reopen();
    assert.equal(await page.locator(R + ' .ccf-cs-abilities .ccf-cs-roll-secret').count(), 0, 'no secret ability roll button any more');
    // 0.5.54: an ability without a designated skill sends the ability card text instead of an error
    await page.locator(R + ' .ccf-cs-abilities [data-prop="target"]').first().fill('');
    await page.locator(R + ' .ccf-cs-abilities [data-prop="type"]').first().fill('서포트');
    r = await roll(() => page.locator(R + ' .ccf-cs-abilities .ccf-cs-roll-public').first().click());
    assert.deepEqual(r.sent, ['[어빌리티:서포트] 기습'], 'no skill: the ability card text'); await reopen();
    await page.locator(R + ' .ccf-cs-abilities [data-prop="target"]').first().fill('소각');
    // a skill: click = public (typed into the chat box), Shift+click / right click = secret
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click());
    assert.equal(r.box, '2D6>=5 [소각]'); assert.deepEqual(r.sent, ['2D6>=5 [소각]'], 'a skill click is sent at once'); assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1, 'the sheet stays open after a roll'); assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'chatbox', 'the chat box does not take the focus'); await reopen();
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click({ modifiers: ['Shift'] }));
    assert.equal(r.box, 'S2D6>=5 [소각]'); await reopen();
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click({ button: 'right' }));
    assert.equal(r.box, 'S2D6>=5 [소각]'); await reopen();
    // the overall modifier: -9..9, note above the skills, added to every roll, merged with the fear -2
    const mod = page.locator(R + ' [data-field="modifier"]');
    await mod.fill('15'); await page.waitForTimeout(150);
    assert.equal(await mod.inputValue(), '15'); // the field keeps what is typed, the stored value is clamped
    await mod.fill('1'); await page.waitForTimeout(150);
    assert.equal((await page.locator(R + ' .ccf-cs-modifier-note').textContent()).trim(), '수정치 +1');
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click());
    assert.equal(r.box, '2D6+1>=5 [소각]'); await reopen();
    r = await roll(() => page.locator(R + ' .ccf-cs-abilities .ccf-cs-roll-public').first().click());
    assert.deepEqual(r.sent, ['2D6+1>=5 [기습/소각]']); await reopen();
    await page.locator(R + ' [data-field="fear"]').selectOption('0:0');
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click());
    assert.equal(r.box, '2D6-1>=5 [소각/공포심]', 'fear -2 and the modifier +1 are merged'); await reopen();
    r = await roll(() => page.locator(R + ' footer [data-action="fear-roll"]:not([data-secret])').click());
    assert.equal(r.box, '2D6-1>=5 [소각/공포심]'); await reopen();
    r = await roll(() => page.locator(R + ' footer [data-action="fear-roll"][data-secret="1"]').click());
    assert.equal(r.box, 'S2D6-1>=5 [소각/공포심]'); await reopen();
    // 0.5.58 evasion: plot (speed) -> target plot+4 (editable, kept until the plot changes), skill toggle +1, fear -2, extra; the sheet modifier (+1) is added; values kept
    const evadeForm = async (secret) => { await page.locator(R + ` footer [data-action="evade"]${secret ? '[data-secret="1"]' : ':not([data-secret])'}`).click(); return page.locator(R + ' .ccf-cs-evade-form'); };
    r = await roll(async () => { const f = await evadeForm(); assert.equal(await f.locator('select[name="plot"]').inputValue(), '', 'no sheet plot: empty'); await f.locator('select[name="plot"]').selectOption('3'); assert.equal(await f.locator('input[name="target"]').inputValue(), '7', 'plot 3 -> 7'); assert.equal(await f.locator('.ccf-cs-evade-preview').textContent(), '2D6+1>=7 [회피/속도3]', 'preview'); await f.locator('button[type="submit"]').click(); });
    assert.deepEqual(r.sent, ['2D6+1>=7 [회피/속도3]'], 'plot 3'); await reopen();
    assert.equal(await page.locator(R + ' footer [data-plot-select]').inputValue(), '3', 'the sheet plot follows');
    r = await roll(async () => { const f = await evadeForm(true); assert.equal(await f.locator('select[name="plot"]').inputValue(), '3', 'sheet plot'); await f.locator('select[name="plot"]').selectOption('2'); await f.locator('input[name="skill"]').check(); await f.locator('input[name="extra"]').fill('-1'); await f.locator('button[type="submit"]').click(); });
    assert.deepEqual(r.sent, ['S2D6+1>=6 [회피/속도2/특기]'], 'plot 2 + skill (+1, sheet +1, extra -1), secret'); await reopen();
    r = await roll(async () => { const f = await evadeForm(); await f.locator('input[name="target"]').fill('9'); await f.locator('input[name="extra"]').fill('0'); await f.locator('input[name="fear"]').check(); assert.equal(await f.locator('input[name="skill"]').isChecked(), true, 'skill kept'); await f.locator('button[type="submit"]').click(); });
    assert.deepEqual(r.sent, ['2D6>=9 [회피/속도2/특기/공포심]'], 'skill + fear = -1 (+ sheet +1), manual target'); await reopen();
    r = await roll(async () => { const f = await evadeForm(); assert.equal(await f.locator('input[name="target"]').inputValue(), '9', 'manual target kept while the plot is the same'); await f.locator('button[type="submit"]').click(); });
    await reopen();
    // 0.5.52 plot: choosing only stores the value (nothing is sent), the dice button next to it sends it; 가변 = S1D6 (sc(1D6) is not a BCDice Insane command), n = sc(n)
    const plot = page.locator(R + ' footer [data-plot-select]'), plotSend = page.locator(R + ' footer [data-action="plot-send"]');
    await plot.selectOption(''); // the evasion form above set the plot
    assert.equal(await plotSend.isDisabled(), true, 'nothing chosen: the button is off');
    r = await roll(() => plot.selectOption('1D6'));
    assert.deepEqual(r.sent, [], 'choosing sends nothing');
    r = await roll(() => plotSend.click());
    assert.deepEqual(r.sent, ['S1D6'], '가변 -> S1D6'); await reopen();
    assert.equal(await page.locator(R + ' footer [data-plot-select]').inputValue(), '1D6', 'kept after reopening');
    r = await roll(() => page.locator(R + ' footer [data-plot-select]').selectOption('4'));
    assert.deepEqual(r.sent, []);
    r = await roll(() => page.locator(R + ' footer [data-action="plot-send"]').click());
    assert.deepEqual(r.sent, ['sc(4)'], 'a number -> sc(n)'); await reopen();
    // without a modifier everything is as before
    await mod.fill('0'); await page.waitForTimeout(150);
    assert.equal(await page.locator(R + ' .ccf-cs-modifier-note').isHidden(), true, 'no note without a modifier');
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click());
    assert.equal(r.box, '2D6-2>=5 [소각/공포심]', 'only the fear -2 is left'); await reopen();
    await page.locator(R + ' [data-field="fear"]').selectOption('');
    r = await roll(() => page.locator(R + ' [data-roll="0:0"]').click());
    assert.equal(r.box, '2D6>=5 [소각]', 'no modifier, no fear: exactly the old command');
    // the stored modifier is clamped and kept in the sheet data
    await reopen(); await page.locator(R + ' [data-field="modifier"]').fill('-12'); await page.waitForTimeout(400);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ccf-character-sheet:')))).sheets.find((s) => s.name === '연갈').modifier);
    assert.equal(stored, -9, 'modifier is stored clamped to -9..9');
    assert.deepEqual(page.__errors, [], 'no page errors');
    console.log('character sheet rolls PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
