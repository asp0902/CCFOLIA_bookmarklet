const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 서식 프리셋 미니모달: (1) 열어 둔 뒤 고른 전체 선택으로도 적용(alert 없음, 선택 없으면 모달 안 안내), (2) 안내 문구 삭제, (3) 폴더(추가·이름 변경·접기·삭제·드래그·새로고침 유지·옛 데이터),
// (4) 빌더: 정렬 3개 없음(저장된 align 유지), 블러·루비·툴팁 → 저장·적용. 실제 format-sync + 복제 채팅 입력.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const MAP = ['​', '‌', '‍', '⁠'], START = '⁣⁣⁣', END = '⁢⁢⁢';
const decode = (text) => { const a = text.indexOf(START), b = text.indexOf(END, a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(String.fromCharCode(...bytes).replace(/\0+$/g, ''), 'base64').toString('utf8')); };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.type() + ':' + d.message()); d.accept(); });
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><textarea name="text" rows="2" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__sent = []; document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.querySelector('#composer textarea').value); });
      // old data: a plain array, no folders, one preset with a stored align
      localStorage.setItem('ccf-format-style-presets-v1:test', JSON.stringify([{ name: '빨강', style: { color: '#ff0000', bold: true }, align: 'left', savedAt: 1 }, { name: '가운데', style: { italic: true }, align: 'center', savedAt: 2 }]));
    });
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const ta = page.locator('#composer textarea');
    const open = async () => { await page.evaluate(() => document.querySelector('[data-inline-command="style-clipboard"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); await page.waitForSelector('.ccf-inline-popover.open [data-style-preset-list]'); };
    const pop = page.locator('.ccf-inline-popover.open');
    const keyOf = (k) => `ccf-format-style-${k}-v1:test`;
    const stored = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), keyOf(k));
    const sendAndDecode = async () => { await page.evaluate(() => { window.__sent.length = 0; }); await page.locator('#composer button[type=submit]').dispatchEvent('click'); await page.waitForTimeout(2300); /* the send's own restore/reset timers (180ms..2s) finish first */ return decode((await page.evaluate(() => window.__sent[0])) || ''); };
    const reset = async (text) => { await page.evaluate((t) => { const el = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, t); el.dispatchEvent(new Event('input', { bubbles: true })); }, text); };

    // (0) formats that are on in the toolbar (bold typed on, italic) are already active in the preset modal's builder
    await ta.click(); await page.evaluate(() => { document.querySelector('[data-inline-command="bold"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); document.querySelector('[data-inline-command="italic"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await open();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.ccf-inline-popover.open [data-style-builder]')].filter((b) => b.getAttribute('data-active') === '1').map((b) => b.getAttribute('data-style-builder'))), ['bold', 'italic'], 'the formats that are on show as active in the builder');
    await pop.locator('[data-inline-popover-action="cancel"]').dispatchEvent('click'); await page.waitForFunction(() => !document.querySelector('.ccf-inline-popover.open'));
    await page.evaluate(() => { for (const key of ['bold', 'italic']) document.querySelector(`[data-inline-command="${key}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await reset('');
    // (1) the popover is opened first (no selection), then the whole text is selected, then a preset is clicked
    await ta.click(); await page.keyboard.type('안녕하세요 테스트');
    await open();
    assert.equal(await page.locator('text=이 룸의 서식 프리셋').count(), 0, '2: the room caption is gone');
    await pop.locator('.ccf-style-preset-apply', { hasText: '빨강' }).click();
    assert.match(await pop.locator('[data-style-preset-note]').textContent(), /먼저 선택/, 'no selection: a note inside the popover'); assert.equal(dialogs.length, 0, 'no alert');
    assert.equal(await page.locator('.ccf-inline-popover.open').count(), 1, 'the popover stays');
    await ta.click(); await page.keyboard.press('Control+A');
    await pop.locator('.ccf-style-preset-apply', { hasText: '빨강' }).click();
    await page.waitForFunction(() => !document.querySelector('.ccf-inline-popover.open'));
    let envelope = await sendAndDecode();
    assert(envelope, 'an envelope was sent');
    assert.deepEqual(envelope.formatRuns.map((r) => [r.start, r.end, r.style.color, r.style.bold]), [[0, 9, '#ff0000', true]], 'select-all after opening: the preset covers the whole text');
    // a partial selection still works
    await reset('가나다라마'); await ta.evaluate((t) => { t.focus(); t.setSelectionRange(1, 3); });
    await open(); await pop.locator('.ccf-style-preset-apply', { hasText: '빨강' }).click(); await page.waitForFunction(() => !document.querySelector('.ccf-inline-popover.open'));
    envelope = await sendAndDecode(); assert.deepEqual(envelope.formatRuns.map((r) => [r.start, r.end]), [[1, 3]], 'partial selection');

    // (4) builder: no align buttons; Bl / Rb / Tip; save and apply
    await reset('루비와 툴팁'); await ta.evaluate((t) => { t.focus(); t.setSelectionRange(0, 2); });
    await open();
    assert.equal(await pop.locator('[data-style-builder-align]').count(), 0, 'the three align buttons are gone');
    assert.deepEqual(await pop.locator('.ccf-style-builder-row .ccf-toggle').allTextContents(), ['B', 'I', 'U', 'S', 'Bl', 'Rb', 'Tip']);
    await pop.locator('[data-style-builder="bold"]').dispatchEvent('click'); await pop.locator('[data-style-builder="blur"]').dispatchEvent('click');
    await pop.locator('[data-style-builder-text="rubyText"]').dispatchEvent('click'); await pop.locator('[data-style-builder-input="rubyText"]').fill('루비');
    await pop.locator('[data-style-builder-text="tooltipText"]').dispatchEvent('click'); await pop.locator('[data-style-builder-input="tooltipText"]').fill('설명');
    assert.equal(await pop.locator('[data-style-builder-text="rubyText"]').getAttribute('data-active'), '1', 'Rb is on when it has a value'); assert.match(await pop.locator('[data-style-builder-text="rubyText"]').getAttribute('title'), /루비: 루비/);
    assert.match(await pop.locator('[data-style-preset-name]').evaluate((i) => i.getAttribute('style') || ''), /blur/, 'the name box previews the blur');
    await pop.locator('[data-style-preset-name]').fill('복합'); await pop.locator('[data-inline-style-action="add"].ccf-btn').dispatchEvent('click');
    await page.waitForSelector('.ccf-style-preset-apply:has-text("복합")');
    assert.deepEqual((await stored('presets')).find((p) => p.name === '복합').style, { bold: true, blur: '4px', rubyText: '루비', tooltipText: '설명' }, 'saved with blur / ruby / tooltip');
    await ta.click(); await ta.evaluate((t) => t.setSelectionRange(0, 2)); // a real click into the box (programmatic focus() closes the popover)
    await pop.locator('.ccf-style-preset-apply', { hasText: '복합' }).click(); await page.waitForFunction(() => !document.querySelector('.ccf-inline-popover.open'));
    envelope = await sendAndDecode();
    assert.deepEqual(envelope.formatRuns.map((r) => [r.start, r.end, !!r.style.bold, r.style.blur, r.style.rubyText, r.style.tooltipText]), [[0, 2, true, '4px', '루비', '설명']], 'applied: bold + blur + ruby + tooltip on the selection');
    // editing a preset that has an align keeps the align (the UI for it is gone)
    await open(); await pop.locator('.ccf-style-preset-row', { hasText: '가운데' }).locator('[data-inline-style-action="edit"]').dispatchEvent('click');
    await pop.locator('[data-inline-style-action="add"].ccf-btn').dispatchEvent('click'); await page.waitForTimeout(200);
    assert.equal((await stored('presets')).find((p) => p.name === '가운데').align, 'center', 'the stored align survives an edit');

    // (3) folders (the popover is still open from the edit above)
    await pop.locator('[data-inline-style-action="add-menu"]').dispatchEvent('click');
    assert.deepEqual(await pop.locator('.ccf-style-add-menu button').allTextContents(), ['프리셋 추가', '폴더 추가']);
    await pop.locator('[data-inline-style-action="folder-add-start"]').dispatchEvent('click');
    await pop.locator('[data-style-folder-name]').fill('강조'); await pop.locator('[data-style-folder-name]').press('Enter');
    await page.waitForSelector('.ccf-style-folder');
    assert.deepEqual((await stored('folders')).map((f) => [f.name, f.open]), [['강조', true]]);
    // drag a preset into the folder
    await pop.locator('.ccf-style-preset-row', { hasText: '빨강' }).locator('.ccf-style-preset-apply').dragTo(pop.locator('.ccf-style-folder-head'));
    await page.waitForSelector('.ccf-style-folder-body .ccf-style-preset-row');
    const folderId = (await stored('folders'))[0].id;
    assert.equal((await stored('presets')).find((p) => p.name === '빨강').folderId, folderId, 'dragged into the folder');
    assert.equal(await pop.locator('.ccf-style-folder-body .ccf-style-preset-row').count(), 1);
    // rename: ✎ + Enter
    await pop.locator('[data-inline-style-action="folder-rename"]').dispatchEvent('click'); await pop.locator('[data-folder-rename]').fill('굵게 모음'); await pop.locator('[data-folder-rename]').press('Enter');
    await page.waitForSelector('.ccf-style-folder-name:has-text("굵게 모음")');
    assert.equal((await stored('folders'))[0].name, '굵게 모음');
    // fold: the state is stored and survives a reopen
    await pop.locator('[data-inline-style-action="folder-toggle"]').dispatchEvent('click');
    assert.equal(await pop.locator('.ccf-style-folder-body').count(), 0, 'folded'); assert.equal((await stored('folders'))[0].open, false);
    await page.evaluate(() => document.querySelector('.ccf-inline-popover.open [data-inline-popover-action="cancel"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await open(); assert.equal(await pop.locator('.ccf-style-folder-body').count(), 0, 'still folded after reopening'); assert.equal(await pop.locator('.ccf-style-folder-toggle').getAttribute('aria-expanded'), 'false');
    await pop.locator('[data-inline-style-action="folder-toggle"]').dispatchEvent('click');
    // drag out: onto the "outside the folder" strip
    await pop.locator('.ccf-style-folder-body .ccf-style-preset-apply').dragTo(pop.locator('[data-root-drop]'));
    await page.waitForFunction(() => !document.querySelector('.ccf-style-folder-body .ccf-style-preset-row'));
    assert.equal((await stored('presets')).find((p) => p.name === '빨강').folderId, undefined, 'dragged out of the folder');
    // delete: the presets stay (moved out), a confirm asks once
    await pop.locator('.ccf-style-preset-row', { hasText: '빨강' }).locator('.ccf-style-preset-apply').dragTo(pop.locator('.ccf-style-folder-head'));
    await page.waitForSelector('.ccf-style-folder-body .ccf-style-preset-row');
    dialogs.length = 0;
    await pop.locator('[data-inline-style-action="folder-remove"]').dispatchEvent('click'); await page.waitForFunction(() => !document.querySelector('.ccf-style-folder'));
    assert.equal(dialogs.length, 1, 'one confirm'); assert.match(dialogs[0], /confirm:.*폴더/);
    assert.deepEqual((await stored('folders')), [], 'folder removed'); assert((await stored('presets')).some((p) => p.name === '빨강' && !p.folderId), 'its preset is kept, outside any folder');
    assert.equal(await pop.locator('.ccf-style-preset-apply', { hasText: '빨강' }).count(), 1);
    // an Escape that arrives while no format window is open (the toolkit closes CCFOLIA's character dropdown with one after reading it at entry) must not move the focus into the chat box
    await page.evaluate(() => { document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), false, 'Escape without an open format window does not focus the chat box');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('style preset folders PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
