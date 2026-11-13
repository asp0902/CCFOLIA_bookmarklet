const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 나레이션 캐릭터 창: 버튼 순서 새로고침·저장·닫기. 체크는 창 안에서만 임시 반영 → 저장에서만 기록, 닫기는 버림, 새로고침은 임시 선택 유지.
// 실제 format-sync + 복제 채팅 입력(form/textarea).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const KEY = 'ccf-format-narrators-v1:test';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><textarea name="text" rows="2" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify(['가'])), KEY);
    await page.addScriptTag({ content: source });
    const toolbar = page.locator('.ccf-inline-toolbar').first();
    await toolbar.waitFor({ state: 'attached', timeout: 8000 });
    await page.evaluate(() => document.querySelector('[data-inline-command="narration"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    const pop = page.locator('.ccf-inline-narrator-popover.open');
    await pop.waitFor({ state: 'attached', timeout: 5000 });
    // the list is read from the page; with no characters on the page the saved name is still listed ("목록 없음") and can be toggled
    const buttons = await pop.locator('.ccf-inline-popover-actions button').allTextContents();
    assert.deepEqual(buttons.map((t) => t.trim()), ['저장', '닫기'], 'save · close (refresh is an icon in the title row now)');
    // refresh: an icon button at the right end of the title row, tooltip "목록 새로고침"; no outline around the window
    const look = await pop.evaluate((p) => { const title = p.querySelector('.ccf-narrator-title'), btn = title?.querySelector('[data-inline-narrator-action="refresh"]'), r = btn?.getBoundingClientRect(), t = title?.getBoundingClientRect(), cs = getComputedStyle(p); return { inTitle: !!btn, atRight: !!r && Math.abs(r.right - t.right) <= 1, size: r ? [Math.round(r.width), Math.round(r.height)] : null, svg: !!btn?.querySelector('svg path'), border: cs.borderTopWidth + ' ' + cs.borderTopStyle, outline: cs.outlineStyle, label: btn?.getAttribute('aria-label') }; });
    assert.deepEqual(look, { inTitle: true, atRight: true, size: [30, 30], svg: true, border: '0px none', outline: 'none', label: '목록 새로고침' }, JSON.stringify(look));
    if (process.env.NARRATOR_SHOT) await pop.screenshot({ path: process.env.NARRATOR_SHOT });
    await pop.locator('[data-inline-narrator-action="refresh"]').hover(); await page.waitForTimeout(250);
    assert.equal(await page.locator('.ccf-ui-tip[data-open="1"]').textContent(), '목록 새로고침', 'tooltip');
    await page.mouse.move(0, 0);
    assert.match(await pop.locator('.ccf-inline-popover-actions button.primary').textContent(), /저장/, 'save is the primary one');
    const item = (name) => pop.locator(`.ccf-narrator-item[data-inline-narrator-name="${name}"]`);
    await item('가').waitFor();
    assert.equal(await item('가').getAttribute('aria-selected'), 'true');
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), KEY);
    // uncheck 가 → only in the window
    await item('가').dispatchEvent('click');
    assert.equal(await item('가').count(), 0, 'unchecked in the window (a name with no page character leaves the list, as before)');
    assert.deepEqual(await stored(), ['가'], 'nothing saved yet');
    // refresh keeps the temporary choice
    await pop.locator('[data-inline-narrator-action="refresh"]').dispatchEvent('click');
    await page.waitForTimeout(600);
    assert.equal(await item('가').count(), 0, 'refresh keeps the temporary choice');
    assert.deepEqual(await stored(), ['가']);
    // close discards
    await pop.locator('[data-inline-popover-action="cancel"]').dispatchEvent('click');
    assert.equal(await page.locator('.ccf-inline-narrator-popover.open').count(), 0, 'closed');
    assert.deepEqual(await stored(), ['가'], 'close discards the unsaved change');
    // reopen: the saved value is shown again; uncheck + save → written, the window closes
    await page.evaluate(() => document.querySelector('[data-inline-command="narration"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await pop.waitFor({ state: 'attached' });
    assert.equal(await item('가').getAttribute('aria-selected'), 'true', 'reopened with the saved value');
    await item('가').dispatchEvent('click');
    await pop.locator('[data-inline-narrator-action="save"]').dispatchEvent('click');
    assert.deepEqual(await stored(), [], 'saved');
    assert.equal(await page.locator('.ccf-inline-narrator-popover.open').count(), 0, 'the window closes after saving');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('narrator popover save PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
