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
      window.__nativeClosed = 0; document.getElementById('native-close').addEventListener('click', () => { window.__nativeClosed++; });
      document.getElementById('chat').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.getElementById('chatbox').value); window.__colorAtSubmit = getComputedStyle(document.getElementById('chatbox')).color; window.__heightAtSubmit = document.getElementById('chatbox').offsetHeight; window.__wrapAtSubmit = document.getElementById('chat').offsetHeight; });
      window.__h0 = document.getElementById('chatbox').offsetHeight; window.__w0 = document.getElementById('chat').offsetHeight;
      document.getElementById('chatbox').addEventListener('input', (e) => { e.target.style.height = e.target.value ? '220px' : ''; });
      const state = { entities: { roomCharacters: { entities: { c1: { name: '연갈', iconUrl: 'https://example.test/icon.png', owner: 'me' }, c2: { name: '다른이', iconUrl: 'https://example.test/other.png', owner: 'other' }, c3: { name: '니노', iconUrl: 'https://example.test/nino.png', owner: 'me', order: 2 }, c4: { name: '브릿지', iconUrl: '', owner: 'me', order: 1 }, c5: { name: '남의것', owner: 'someone' } } } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, subscribe: () => () => {}, dispatch() {} } } } } };
    });
    await page.evaluate(() => new Promise((resolve) => { const open = indexedDB.open('firebaseLocalStorageDb'); open.onupgradeneeded = () => open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' }); open.onsuccess = () => { const tx = open.result.transaction('firebaseLocalStorage', 'readwrite'); tx.objectStore('firebaseLocalStorage').put({ fbase_key: 'k', value: { uid: 'me' } }); tx.oncomplete = () => resolve(); }; }));
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
    // 14.1: after the values were moved over, CCFOLIA's own edit dialog is closed (its close button is pressed once); the sheet stays
    await page.waitForFunction(() => window.__nativeClosed === 1, null, { timeout: 4000 });
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-dialog.is-editor').count(), 1, 'the sheet stays after the native dialog is closed');
    // 14.2: the window looks like CCFOLIA's own dialog (title 20px bold, radius 4px, paper rgba(44,44,44,.87), three-layer shadow)
    const lookup = await page.evaluate(() => { const d = document.querySelector('#ccf-character-sheet-root .ccf-cs-dialog'), h = d.querySelector('header h2'), c = getComputedStyle(d), t = getComputedStyle(h); return { title: [t.fontSize, t.fontWeight, t.lineHeight], radius: c.borderTopLeftRadius, bg: c.backgroundColor, shadow: (c.boxShadow.match(/rgba/g) || []).length, header: Math.round(d.querySelector('header').getBoundingClientRect().height) }; });
    assert.deepEqual(lookup, { title: ['20px', '700', '32px'], radius: '4px', bg: 'rgba(44, 44, 44, 0.87)', shadow: 3, header: 64 }, 'CCFOLIA dialog title / radius / paper / shadow / app bar height');
    // 14.3: double-click on the top bar folds the window to the bar and unfolds it again; a double-click on a button does nothing
    const hdr = () => page.locator('#ccf-character-sheet-root .ccf-cs-dialog > header');
    await hdr().dblclick({ position: { x: 300, y: 32 } });
    assert.equal(await page.evaluate(() => Math.round(document.querySelector('#ccf-character-sheet-root .ccf-cs-dialog').getBoundingClientRect().height)), 64, 'folded to the bar');
    await hdr().dblclick({ position: { x: 300, y: 32 } });
    assert((await page.locator('#ccf-character-sheet-root .ccf-cs-dialog').boundingBox()).height > 300, 'unfolded');
    await page.locator('#ccf-character-sheet-root [data-action="back-list"]').dblclick(); await page.waitForTimeout(150);
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-dialog.is-collapsed').count(), 0, 'a double-click on a button does not fold');
    await page.locator('#ccf-character-sheet-root .ccf-cs-sheet-row').first().click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor');
    // 14.4 / 14.5: respect toggles keep their label colour, on = blue, the number fields are about 24px tall
    const respect = async () => page.evaluate(() => { const l = document.querySelector('#ccf-character-sheet-root .ccf-cs-respect-toggle'), i = l.querySelector('i'), n = document.querySelector('#ccf-character-sheet-root .ccf-cs-respect-number input'); return { label: getComputedStyle(l.querySelector('span')).color, track: getComputedStyle(i).backgroundColor, number: Math.round(n.getBoundingClientRect().height) }; });
    const before = await respect();
    await page.locator('#ccf-character-sheet-root .ccf-cs-respect-toggle').first().click(); await page.waitForTimeout(300);
    const after = await respect();
    assert.equal(after.label, before.label, 'the label colour does not change when the toggle is switched');
    assert.equal(after.track, 'rgb(33, 150, 243)', 'on = blue'); assert.equal(before.number, 24, 'respect numbers are 24px tall');
    await page.locator('#ccf-character-sheet-root .ccf-cs-respect-toggle').first().click();
    // 14.6: no 특기 title above the skill table; 14.7: the table fits its content (it was 740px wide at least)
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-section-wide .ccf-cs-section-head').count(), 0, 'no 특기 heading');
    const tableW = await page.evaluate(() => Math.round(document.querySelector('#ccf-character-sheet-root .ccf-cs-skills').getBoundingClientRect().width));
    console.log('skill table width', tableW);
    if (process.env.SHEET_WIDTH_OVERRIDE) await page.addStyleTag({ content: '#ccf-character-sheet-root .ccf-cs-dialog.is-editor{width:' + process.env.SHEET_WIDTH_OVERRIDE + 'px !important}' });
    const fit = await page.evaluate(() => { const d = document.querySelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor'), w = document.querySelector('#ccf-character-sheet-root .ccf-cs-section-wide'); return { dialog: Math.round(d.getBoundingClientRect().width), tableScroll: w.scrollWidth <= w.clientWidth, mainScroll: (() => { const m = d.querySelector('main'); return m.scrollWidth <= m.clientWidth; })() }; });
    if (!process.env.SHEET_WIDTH_OVERRIDE) assert.deepEqual(fit, { dialog: 860, tableScroll: true, mainScroll: true }, 'the window is as wide as its content: no horizontal scrolling of the table or the body (' + JSON.stringify(fit) + ')');
    if (process.env.SHEET_SHOT) await page.locator('#ccf-character-sheet-root .ccf-cs-dialog.is-editor').screenshot({ path: process.env.SHEET_SHOT });
    assert(tableW < 800, 'the skill table is smaller than before (860px at this size, now ' + tableW + 'px)');
    const smallFont = await page.evaluate(() => getComputedStyle(document.querySelector('#ccf-character-sheet-root .ccf-cs-skill small')).fontSize); assert.equal(smallFont, '11px', 'value numbers are smaller');
    // every roll button except the 66 skill cells carries the Roll20 d20 glyph with the font applied (E): footer 장면표/감정표/엔딩표/회피/공포판정 (+ secret ones), ability and respect rolls
    const iconRows = await page.evaluate(async () => { await document.fonts.ready; return [...document.querySelectorAll('#ccf-character-sheet-root footer button, #ccf-character-sheet-root .ccf-cs-ability-roll, #ccf-character-sheet-root .ccf-cs-respect-roll')].filter((b) => b.dataset.command || ['fear-roll', 'scene-menu'].includes(b.dataset.action) || b.dataset.abilityRoll !== undefined || b.classList.contains('ccf-cs-respect-roll')).map((b) => { const g = b.querySelector('.ccf-cs-d20'); return { label: (b.getAttribute('aria-label') || b.textContent).trim(), glyph: !!g, family: g ? getComputedStyle(g).fontFamily.split(',')[0].replace(/"/g, '') : '', width: g ? Math.round(g.getBoundingClientRect().width) : 0 }; }); });
    assert(iconRows.length >= 8, 'the roll buttons were found (' + iconRows.length + ')');
    assert.deepEqual(iconRows.filter((r) => !r.glyph || r.family !== 'ccf-dicefontd20' || r.width < 8), [], 'every roll button has the Roll20 d20 glyph with the font applied');
    if (process.env.ICON_AUDIT) { const rows = await page.evaluate(async () => { await document.fonts.ready; return [...document.querySelectorAll('#ccf-character-sheet-root button')].map((b) => { const g = b.querySelector('.ccf-cs-d20'); const svg = b.querySelector('svg'); const rect = g ? g.getBoundingClientRect() : null; return { where: (b.closest('section')?.className || b.closest('footer') ? 'footer' : '') + '|' + (b.className || '').slice(0, 40), data: Object.keys(b.dataset).join(','), label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 16), glyph: !!g, svg: !!svg, fontFamily: g ? getComputedStyle(g).fontFamily.split(',')[0] : '', width: rect ? Math.round(rect.width) : 0, display: g ? getComputedStyle(g).display : '' }; }); }); console.log('ICON_AUDIT', JSON.stringify(rows)); }
    // 16: Roll20's dicefontd20 "t" is the roll icon (white public, rgb(255,0,12) secret), the SVG only as a fallback
    const dice = await page.evaluate(async () => { await document.fonts.ready; const root = document.getElementById('ccf-character-sheet-root'); const g = document.querySelector('#ccf-character-sheet-root .ccf-cs-roll-public .ccf-cs-d20'), s = document.querySelector('#ccf-character-sheet-root footer .ccf-cs-footer-secret .ccf-cs-d20'); return { flag: root.getAttribute('data-d20-font'), loaded: document.fonts.check('17px ccf-dicefontd20', 't'), width: Math.round(g.getBoundingClientRect().width), size: getComputedStyle(g).fontSize, family: getComputedStyle(g).fontFamily.startsWith('ccf-dicefontd20'), publicColor: getComputedStyle(g.parentElement).color, secretColor: getComputedStyle(s.parentElement).color, fallbackHidden: getComputedStyle(g.nextElementSibling).display === 'none', respect: getComputedStyle(document.querySelector('#ccf-character-sheet-root .ccf-cs-respect-roll')).color }; });
    assert.deepEqual({ ...dice, width: dice.width > 5 }, { flag: '1', loaded: true, width: true, size: '17px', family: true, publicColor: 'rgb(255, 255, 255)', secretColor: 'rgb(255, 0, 12)', fallbackHidden: true, respect: 'rgb(255, 255, 255)' }, 'dicefontd20 glyph, 17px, white / red, fallback svg hidden');
    // 15.3: the memo buttons are visible; 15.4: 관계 목록 = 이름 · 감정 · 거처(toggle) on one row, the old 설명 moves into the memo
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-people').count(), 1);
    await page.locator('#ccf-character-sheet-root [data-add="people"]').click();
    const rel = await page.evaluate(() => { const sec = document.querySelector('#ccf-character-sheet-root .ccf-cs-people section'); const f = sec.querySelector('.ccf-cs-repeater-fields'); const kids = [...f.children].map((c) => { const r = c.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 4); }); return { heads: [...document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-people .ccf-cs-repeater-head .ccf-cs-repeater-fields span')].map((x) => x.textContent), tops: new Set(kids).size, count: f.children.length, title: document.querySelector('#ccf-character-sheet-root .ccf-cs-duo .ccf-cs-section-head:last-child h3, #ccf-character-sheet-root .ccf-cs-duo > section:last-child h3')?.textContent, noteColor: getComputedStyle(sec.querySelector('.ccf-cs-note-toggle')).backgroundColor, hasTextarea: !!f.querySelector('textarea') }; });
    assert.deepEqual(rel, { heads: ['이름', '감정', '거처'], tops: 1, count: 3, title: '관계 목록', noteColor: 'rgba(255, 255, 255, 0.7)', hasTextarea: false }, 'three fields on one row, memo button visible');
    await page.locator('#ccf-character-sheet-root .ccf-cs-people [data-prop="name"]').fill('조력자');
    await page.locator('#ccf-character-sheet-root .ccf-cs-people .ccf-cs-shelter').click(); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => { const raw = Object.keys(localStorage).filter((k) => k.startsWith('ccf-character-sheet:')).map((k) => JSON.parse(localStorage.getItem(k))); return raw[0].sheets.find((x) => x.name === '연갈').people[0].shelter; }), true, 'the 거처 toggle is saved (people[].shelter, the existing transfer field)');
    // (the transfer-data check runs at the end of this test)
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
    assert.deepEqual(respectRow, { label: '리스펙', toggles: ['새로운 세계', '세션 참여', '롤플레이', '획득', '사명 달성'], numbers: ['심금', '기타'], roll: true, switches: 5 });
    const R = '#ccf-character-sheet-root';
    const look = await page.evaluate(() => { const row = document.querySelector('#ccf-character-sheet-root .ccf-cs-respect'), input = row.querySelector('.ccf-cs-respect-number input'), c = getComputedStyle(input), r = getComputedStyle(row); return { rowBorder: r.borderTopWidth, inputBorder: c.borderTopWidth, radius: c.borderTopLeftRadius, bg: c.backgroundColor, align: c.textAlign }; });
    assert.deepEqual(look, { rowBorder: '0px', inputBorder: '0px', radius: '3px', bg: 'rgba(255, 255, 255, 0.1)', align: 'center' }, 'no outline on the row, no round border on the numbers: a filled centred field');
    await page.locator(R + ' .ccf-cs-respect-toggle', { hasText: '새로운 세계' }).click();
    await page.locator(R + ' .ccf-cs-respect-toggle', { hasText: '사명 달성' }).click();
    await page.locator(R + ' .ccf-cs-respect-number', { hasText: '기타' }).locator('input').fill('2');
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => { const raw = Object.keys(localStorage).filter((k) => k.startsWith('ccf-character-sheet:')).map((k) => JSON.parse(localStorage.getItem(k))); const sheet = raw[0].sheets.find((x) => x.name === '연갈'); return sheet.respec; });
    assert.deepEqual(saved, { newWorld: true, session: false, roleplay: false, gain: false, empathy: 0, mission: true, other: 2 }, 'the respect state is saved (TRPG management tool format)');
    // rolling: the breakdown goes to the chat, the merit grows by the total, the toggles and numbers reset
    await page.locator(R + ' [data-action="respect-roll"]').click();
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => window.__sent), ['리스펙: 새로운 세계 1 + 사명 달성 1 + 기타 2 = 4']);
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
    // the footer 장면표 button is a menu: 장면열기 ▸ (드라마/전투 장면), 장면닫기, 장면표 (ST)
    assert.equal(await page.locator(R + ' footer [data-command="ST"]').count(), 0, 'no direct ST button any more');
    await page.locator(R + ' [data-action="scene-menu"]').click();
    assert.deepEqual(await page.locator(R + ' .ccf-cs-menu > button').allTextContents(), ['장면열기▸', '장면닫기', '기본 장면표', '장면표 추가…']);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(R + ' .ccf-cs-menu').count(), 0, 'Esc closes the menu');
    assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1, 'and the sheet stays');
    await page.locator(R + ' [data-action="scene-menu"]').click();
    await page.locator(R + ' [data-action="scene-open-submenu"]').click();
    assert.deepEqual(await page.locator(R + ' .ccf-cs-submenu button').allTextContents(), ['드라마 장면', '전투 장면']);
    await page.locator(R + ' [data-action="scene-form"][data-kind="drama"]').click();
    const defaults = await page.evaluate(() => { const f = document.querySelector('#ccf-character-sheet-root .ccf-cs-scene-form'); return { cycle: f.cycle.value, number: f.number.value, cast: f.cast.value, detailLabel: f.querySelector('input[name="detail"]').closest('label').textContent.trim() }; });
    assert.deepEqual(defaults, { cycle: '1', number: '1', cast: '연갈', detailLabel: '배경' }, 'cycle 1, scene 1 suggested, the cast defaults to this sheet');
    await page.locator(R + ' .ccf-cs-scene-form input[name="detail"]').fill('밤의 교실');
    await page.locator(R + ' .ccf-cs-scene-form [data-action="scene-send"]').click(); await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__sent)).pop(), '【드라마 장면 #1-1】 등장인물: 연갈 / 배경: 밤의 교실');
    // the last numbers are remembered (+1 suggested); the battle scene asks for the opponent
    await page.locator(R + ' [data-action="scene-menu"]').click();
    await page.locator(R + ' [data-action="scene-open-submenu"]').click();
    await page.locator(R + ' [data-action="scene-form"][data-kind="battle"]').click();
    const next = await page.evaluate(() => { const f = document.querySelector('#ccf-character-sheet-root .ccf-cs-scene-form'); return { cycle: f.cycle.value, number: f.number.value, detailLabel: f.querySelector('input[name="detail"]').closest('label').textContent.trim() }; });
    assert.deepEqual(next, { cycle: '1', number: '2', detailLabel: '대전 상대' });
    await page.locator(R + ' .ccf-cs-scene-form input[name="cycle"]').fill('2');
    await page.locator(R + ' .ccf-cs-scene-form input[name="number"]').fill('1');
    await page.locator(R + ' .ccf-cs-scene-form input[name="cast"]').fill('연갈, 브릿지');
    await page.locator(R + ' .ccf-cs-scene-form input[name="detail"]').fill('괴이');
    await page.locator(R + ' .ccf-cs-scene-form [data-action="scene-send"]').click(); await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__sent)).pop(), '【전투 장면 #2-1】 등장인물: 연갈, 브릿지 / 대전 상대: 괴이');
    // closing the scene, and the plain scene table
    await page.locator(R + ' [data-action="scene-menu"]').click();
    await page.locator(R + ' [data-action="scene-close"]').click(); await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__sent)).pop(), '【장면 종료】');
    assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1, 'the sheet stays open after a scene message');
    await page.locator(R + ' [data-action="scene-menu"]').click();
    await page.locator(R + ' .ccf-cs-menu [data-command="ST"]').click(); await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__sent)).pop(), 'ST', 'the basic scene table is sent at once'); assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1, 'and the sheet stays open');
    // custom scene tables: 장면표 추가… lists the /roll-table custom commands, a checked one becomes a menu item that sends its body as it is
    await page.evaluate(() => localStorage.setItem('ccf-slash-macros-v1', JSON.stringify([{ name: '장면표Q', body: '/roll-table\n괴담 장면표\n1D3\n1 첫째\n2 둘째\n3 셋째' }, { name: '인사', body: '안녕' }])));
    await page.locator(R + ' [data-action="scene-menu"]').click();
    await page.locator(R + ' [data-action="scene-table-add"]').click();
    await page.waitForSelector(R + ' .ccf-cs-link-picker');
    assert.deepEqual(await page.locator(R + ' .ccf-cs-link-picker label.ccf-cs-link-row').allTextContents(), ['괴담 장면표커스텀 커맨드: 장면표Q'], 'only /roll-table custom commands, table name + command name');
    await page.locator(R + ' .ccf-cs-link-picker input[data-table-toggle="0"]').check(); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ccf-character-sheet:')))).sceneTables.map((t) => [t.macroName, t.tableName, t.body.includes('1D3')])), [['장면표Q', '괴담 장면표', true]], 'saved in the room data with a copy of the body');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(R + ' .ccf-cs-link-picker').count(), 0); assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1);
    await page.locator(R + ' [data-action="scene-menu"]').click();
    assert.deepEqual(await page.locator(R + ' .ccf-cs-menu > button').allTextContents(), ['장면열기▸', '장면닫기', '기본 장면표', '괴담 장면표', '장면표 추가…']);
    await page.locator(R + ' [data-action="scene-table"]').click(); await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => window.__sent)).pop(), '/roll-table\n괴담 장면표\n1D3\n1 첫째\n2 둘째\n3 셋째', 'the custom command body goes out as it is');
    // 15.1: while a command is sent the chat box text is transparent and the box keeps its height; afterwards it is back to normal (the fake chat never clears the box, so this is also the send-failed path: restored + a notice)
    const during = await page.evaluate(() => ({ color: window.__colorAtSubmit, height: window.__heightAtSubmit }));
    assert.equal(during.color, 'rgba(0, 0, 0, 0)', 'the typed command is invisible while it is sent');
    const sizes = await page.evaluate(() => ({ h0: window.__h0, w0: window.__w0, hSubmit: window.__heightAtSubmit, wSubmit: window.__wrapAtSubmit }));
    assert(sizes.hSubmit <= sizes.h0 + 8 && sizes.wSubmit <= sizes.w0 + 8, 'the box and its wrapper keep their height while sending even though the autosize wants 220px (' + JSON.stringify(sizes) + ')');
    await page.waitForTimeout(1900);
    const restored = await page.evaluate(() => { const t = document.getElementById('chatbox'); return { color: t.style.color, important: t.getAttribute('style') || '' }; });
    assert.equal(restored.color, '', 'the box style is restored'); assert(!restored.important.includes('--ccf-sheet') && !(await page.evaluate(() => document.getElementById('chatbox').hasAttribute('data-ccf-sheet-sending') || document.getElementById('chat').hasAttribute('data-ccf-sheet-sending-wrap'))), 'nothing of ours is left on the box or its wrapper (the 220px is the fake autosize leftover: the fake chat never clears the box)');
    await page.evaluate(() => localStorage.removeItem('ccf-slash-macros-v1'));
    await page.locator(R + ' [data-action="scene-menu"]').click(); await page.locator(R + ' [data-action="scene-table-add"]').click();
    await page.locator(R + ' .ccf-cs-link-picker input[data-table-toggle="0"]').uncheck(); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ccf-character-sheet:')))).sceneTables.length), 0, 'unchecking removes it (also when the command is gone from this browser)');
    await page.keyboard.press('Escape');
    // a second press finds the linked sheet instead of making another
    await page.locator('#ccf-character-sheet-root [data-action="close"], #ccf-character-sheet-root header .ccf-cs-icon:last-of-type').last().click().catch(() => {});
    await page.evaluate(() => document.getElementById('ccf-character-sheet-root')?.remove());
    await dialogButton.click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor');
    assert.equal(await page.locator('#ccf-character-sheet-root header h2').textContent(), '연갈');
    await page.evaluate(() => document.getElementById('ccf-character-sheet-root')?.remove());
    // the list: ＋ is at the right end of the tab bar (list tab only), no heading row any more
    await page.evaluate(() => window.__CCF_TOOLKIT_MENU__ ? window.__CCF_TOOLKIT_MENU__.items.get('saikoro').onClick() : window.__CCF_CHARACTER_SHEET_DEBUG__.open()); // the toolbar icon is now an item of the penguin menu (tools/test-toolkit-menu.cjs)
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-tabs');
    const tabs = await page.evaluate(() => {
      const nav = document.querySelector('#ccf-character-sheet-root .ccf-cs-tabs'), add = nav.querySelector('[data-action="add-sheet"]');
      const rn = nav.getBoundingClientRect(), ra = add.getBoundingClientRect();
      return { inNav: !!add, lastChild: nav.lastElementChild === add, rightEnd: rn.right - ra.right < 24, heading: !!document.querySelector('#ccf-character-sheet-root .ccf-cs-panel-heading'), rows: document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-sheet-row').length };
    });
    assert.deepEqual({ ...tabs, rows: undefined }, { inNav: true, lastChild: true, rightEnd: true, heading: false, rows: undefined });
    assert.equal(tabs.rows, 1, 'only the one made for 연갈 (no default sheet any more; still one after the second press)');
    await page.locator('#ccf-character-sheet-root [data-action="panel-settings"]').click();
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-tabs [data-action="add-sheet"]').count(), 0, 'no + on the settings tab');
    await page.locator('#ccf-character-sheet-root [data-action="panel-list"]').click();
    await page.locator('#ccf-character-sheet-root .ccf-cs-tabs [data-action="add-sheet"]').click();
    await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog.is-editor');
    // 10: the character link is a modal like the 내 캐릭터 목록 (my characters only, icon + name, 선택 안 함, Esc), not a select
    await page.evaluate(() => { document.getElementById('ccf-character-sheet-root')?.remove(); });
    await dialogButton.click();
    await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
    assert.equal(await page.locator(R + ' select[data-field="player"]').count(), 0, 'no select any more');
    await page.locator(R + ' [data-action="link-pick"]').click();
    await page.waitForSelector(R + ' .ccf-cs-link-picker');
    const picker = await page.evaluate(() => [...document.querySelectorAll('#ccf-character-sheet-root .ccf-cs-link-row')].map((row) => ({ name: row.querySelector('.ccf-cs-link-name').textContent, icon: row.querySelector('img')?.getAttribute('src') || '', selected: row.classList.contains('is-selected') })));
    assert.deepEqual(picker, [{ name: '선택 안 함', icon: '', selected: false }, { name: '연갈', icon: 'https://example.test/icon.png', selected: true }, { name: '브릿지', icon: '', selected: false }, { name: '니노', icon: 'https://example.test/nino.png', selected: false }], 'my three characters only (not 다른이/남의것), by order, the current one marked');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(R + ' .ccf-cs-link-picker').count(), 0, 'Esc closes the picker'); assert.equal(await page.locator(R + ' .ccf-cs-dialog.is-editor').count(), 1, 'and the sheet stays');
    await page.locator(R + ' [data-action="link-pick"]').click();
    await page.locator(R + ' .ccf-cs-link-row', { hasText: '니노' }).click();
    assert.equal(await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets.find((x) => x.name === '연갈').player), '니노', 'the choice is saved as the link');
    assert.equal(await page.locator(R + ' .ccf-cs-portrait img').getAttribute('src'), 'https://example.test/icon.png', 'own/other image rules unchanged (name 연갈 still matches an icon)');
    await page.locator(R + ' [data-action="link-pick"]').click();
    await page.locator(R + ' .ccf-cs-link-row', { hasText: '선택 안 함' }).click();
    assert.equal(await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.data().sheets.find((x) => x.name === '연갈').player), '', '선택 안 함 clears it');
    // pasting a sheet opens the picker at once
    await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.importText(JSON.stringify({ kind: 'capybara.insane-sheet', version: 1, data: { name: '붙여넣기', player: '' } })));
    await page.waitForSelector(R + ' .ccf-cs-link-picker');
    await page.keyboard.press('Escape');
    // 12: every sheet can be deleted; the empty list survives a reload and no click throws
    await page.evaluate(() => window.__CCF_TOOLKIT_MENU__.items.get('saikoro').onClick());
    await page.locator(R + ' [data-action="panel-list"]').click();
    page.on('dialog', (d) => d.accept());
    for (let i = 0; i < 10 && await page.locator(R + ' [data-action="delete-sheet-list"]').count(); i++) { await page.locator(R + ' [data-action="delete-sheet-list"]').first().click(); await page.waitForTimeout(100); }
    assert.equal(await page.locator(R + ' .ccf-cs-sheet-row').count(), 0, 'the last sheet was deletable');
    assert.match(await page.locator(R + ' .ccf-cs-empty').textContent(), /시트가 없습니다/);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ccf-character-sheet:')))).sheets.length), 0, 'the empty list is stored');
    await page.locator(R + ' [data-action="panel-settings"]').click(); await page.locator(R + ' [data-action="panel-list"]').click();
    await page.locator(R + ' .ccf-cs-tabs [data-action="add-sheet"]').click();
    await page.waitForSelector(R + ' .ccf-cs-dialog.is-editor');
    const migrated = await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.importText(JSON.stringify({ kind: 'capybara.insane-sheet', version: 1, data: { name: '옛 시트', player: '옛', people: [{ name: 'A', emotion: '호의', detail: '옛 설명' }] } })).people[0]);
    assert.equal(migrated.memo, '옛 설명', 'transfer data: the old 설명 (detail) is read as the memo'); assert.equal(migrated.detail, '옛 설명', 'and detail stays readable');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('character sheet ui PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
