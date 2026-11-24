const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// character-sheet 0.5.69 시트 정리: top fields 1:1:1:1 with a 2-row square portrait, ability / relation rows level, type / target centred, dice at the title start and row middle,
// ◇ × the dice size and right left of each other, label → field 2px, skill table line + 12px gap column, bottom row icon above text, a blank sheet gets 4 + 4 rows (an Adelie API import keeps its rows).
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
    await page.waitForTimeout(800);
    // a blank sheet made without an Adelie API (here: from the native character dialog): 4 empty rows in both lists
    const blankRows = await page.evaluate(() => { const d = window.__CCF_CHARACTER_SHEET_DEBUG__.data(); const s = d.sheets.find((x) => x.id === d.selectedId); return [s.abilities.length, s.people.length]; });
    assert.deepEqual(blankRows, [4, 4], 'blank sheet: 4 ability rows, 4 relation rows');
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-abilities section').count(), 4);
    assert.equal(await page.locator('#ccf-character-sheet-root .ccf-cs-people section').count(), 4);
    // a sheet linked from an Adelie API keeps its own rows (3 here)
    await page.evaluate(() => window.__CCF_CHARACTER_SHEET_DEBUG__.importText(JSON.stringify({ kind: 'capybara.insane-sheet', version: 1, data: { name: '하문혁', player: '연갈', life: 5, lifeMax: 6, sanity: 4, sanityMax: 6, merit: 12,
      items: { '진통제': 1, '무기': 2, '부적': 0, '보상 및 기타': 3 }, skills: ['1:0', '2:4'],
      abilities: [{ name: '기본공격', type: '공격' }, { name: '전장이동', type: '서포트' }, { type: '장비' }], people: [{}, {}, {}] } })));
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const R = '#ccf-character-sheet-root ';
      const q = (s) => document.querySelector(R + s), qa = (s) => [...document.querySelectorAll(R + s)];
      const box = (e) => e.getBoundingClientRect();
      const lifeIns = qa('.ccf-cs-vital input').slice(0, 2), items = qa('.ccf-cs-item-cell input');
      const row1 = [...lifeIns, items[0], items[1]].map((e) => box(e));
      const portrait = box(q('.ccf-cs-portrait')), lifeLabel = box(qa('.ccf-cs-vital')[0]), sanityIn = box(qa('.ccf-cs-vital')[1].querySelector('input'));
      const aRows = qa('.ccf-cs-abilities section input[data-prop="name"]').map((e) => box(e).bottom), pRows = qa('.ccf-cs-people section input[data-prop="name"]').map((e) => box(e).bottom);
      const dice = box(q('.ccf-cs-ability-roll')), diceIcon = [...q('.ccf-cs-ability-roll').children].map(box).find((r) => r.width > 0);
      const nameIn = box(q('.ccf-cs-abilities section input[data-prop="name"]'));
      const title = (() => { const h = qa('.ccf-cs-section-head h3').find((x) => x.textContent === '어빌리티 리스트'); const r = document.createRange(); r.selectNodeContents(h); return r.getBoundingClientRect(); })();
      const note = box(q('.ccf-cs-row-actions .ccf-cs-note-toggle svg')), remove = box(q('.ccf-cs-row-actions .ccf-cs-remove svg'));
      const peopleNote = q('.ccf-cs-people section .ccf-cs-row-actions .ccf-cs-note-toggle');
      const skillSmall = getComputedStyle(q('.ccf-cs-skill small')), gaps = getComputedStyle(q('.ccf-cs-skills')).gridTemplateColumns.split(' ');
      const footerBtn = getComputedStyle(q('.ccf-cs-dialog>footer button[data-command]'));
      return { widths: row1.map((r) => r.width), lefts: row1.map((r) => Math.round(r.left)), portrait: [portrait.width, portrait.height, portrait.top - lifeLabel.top, portrait.bottom - sanityIn.bottom],
        rowsA: aRows, rowsP: pRows, align: [getComputedStyle(q('.ccf-cs-abilities input[data-prop="type"]')).textAlign, getComputedStyle(q('.ccf-cs-abilities input[data-prop="target"]')).textAlign],
        diceMid: (dice.top + dice.bottom) / 2 - (nameIn.top + nameIn.bottom) / 2, diceLeft: diceIcon.left - title.left, iconSizes: [diceIcon.height, note.height, remove.height],
        noteBeforeRemove: peopleNote?.nextElementSibling?.classList.contains('ccf-cs-remove'), actionGap: remove.left - note.right,
        labelGap: getComputedStyle(q('.ccf-cs-skill-options label')).rowGap, skillLine: skillSmall.borderLeftWidth, gapCol: gaps[1], footer: footerBtn.flexDirection };
    });
    const spread = (a) => Math.max(...a) - Math.min(...a);
    assert.ok(spread(m.widths) <= 1, `life current / max + two items: equal widths ${m.widths}`);
    assert.ok(Math.abs(m.portrait[0] - m.portrait[1]) <= 1, `portrait square ${m.portrait}`);
    assert.ok(Math.abs(m.portrait[2]) <= 1 && Math.abs(m.portrait[3]) <= 1, `portrait = exactly two rows (life label top → sanity field bottom) ${m.portrait}`);
    assert.equal(m.rowsA.length, 3, 'imported rows kept');
    m.rowsA.forEach((y, i) => assert.ok(Math.abs(y - m.rowsP[i]) <= 1, `row ${i + 1}: ability and relation fields level (${y} / ${m.rowsP[i]})`));
    assert.deepEqual(m.align, ['center', 'center'], 'type / target centred');
    assert.ok(Math.abs(m.diceMid) <= 1, `dice in the vertical middle of the row (${m.diceMid})`);
    assert.ok(Math.abs(m.diceLeft) <= 2, `dice left edge at the title's first letter (${m.diceLeft})`);
    assert.ok(m.iconSizes.every((h) => Math.abs(h - m.iconSizes[0]) <= 3), `◇ / × about the dice size ${m.iconSizes}`);
    assert.equal(m.noteBeforeRemove, true, 'relation list: ◇ right left of ×');
    assert.ok(m.actionGap <= 6, `◇ – × gap narrow (${m.actionGap})`);
    assert.equal(m.labelGap, '2px', 'label → field 2px (was 5px)');
    assert.equal(m.skillLine, '1px', 'skill table: line between name and value'); assert.equal(m.gapCol, '12px', 'gap bar column 8 → 12px');
    assert.equal(m.footer, 'column', 'bottom row: icon above the text');
    assert.deepEqual(errors, []);
    console.log('character sheet tidy PASS', JSON.stringify(m));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
