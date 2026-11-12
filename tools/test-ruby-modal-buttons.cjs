const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 루비·툴팁 입력창(서식 바의 팝오버): 버튼 순서 [적용][취소], 취소는 배경 없는 글자 버튼(hover 때만 옅게), 적용은 코코포리아 파랑(#2196f3) 글자 + hover 때 rgba(33,150,243,.08).
// 서식 프리셋·나레이션 캐릭터 창의 버튼 구조는 그대로. 실제 format-sync + 복제 채팅 입력.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><textarea name="text" rows="2" style="width:100%">본문</textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    await page.evaluate(() => { const ta = document.querySelector('#composer textarea'); ta.focus(); ta.setSelectionRange(0, 2); document.dispatchEvent(new Event('selectionchange')); });
    const styles = () => page.evaluate(() => { const c = (a) => { const s = getComputedStyle(document.querySelector(`.ccf-inline-popover.open [data-inline-popover-action="${a}"]`)); return { bg: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius }; }; return { apply: c('apply'), cancel: c('cancel') }; });
    for (const command of ['ruby', 'tooltip']) {
      await page.evaluate((cmd) => document.querySelector(`[data-inline-command="${cmd}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })), command);
      await page.waitForSelector('.ccf-inline-popover.open .ccf-inline-popover-actions', { timeout: 4000 });
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.ccf-inline-popover.open .ccf-inline-popover-actions button')].map((b) => b.dataset.inlinePopoverAction + ':' + b.textContent.trim())), ['apply:적용', 'cancel:취소'], `${command}: 적용 first, 취소 second`);
      // the input popover is small, floats (fixed) inside the screen and has no scrollbar of its own (issue #107)
      const box = await page.evaluate(() => { const p = document.querySelector('.ccf-inline-popover.open'), r = p.getBoundingClientRect(), c = getComputedStyle(p); return { position: c.position, width: Math.round(r.width), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, noScroll: p.scrollHeight <= p.clientHeight, docScroll: document.scrollingElement.scrollHeight > innerHeight }; });
      assert.deepEqual(box, { position: 'fixed', width: 300, inside: true, noScroll: true, docScroll: false }, `${command}: small floating popover without scrollbars`);
      const rest = await styles();
      assert.equal(rest.cancel.bg, 'rgba(0, 0, 0, 0)', `${command}: cancel has no background`); assert.equal(rest.cancel.color, 'rgb(255, 255, 255)');
      assert.equal(rest.apply.bg, 'rgba(0, 0, 0, 0)', `${command}: apply is a text button`); assert.equal(rest.apply.color, 'rgb(33, 150, 243)', `${command}: CCFOLIA blue text`);
      await page.evaluate(() => { const pop = document.querySelector('.ccf-inline-popover.open'); pop.style.setProperty('position', 'fixed', 'important'); pop.style.setProperty('left', '300px', 'important'); pop.style.setProperty('top', '150px', 'important'); });
      await page.locator('.ccf-inline-popover.open [data-inline-popover-action="apply"]').hover(); await page.waitForTimeout(300);
      assert.equal((await styles()).apply.bg, 'rgba(33, 150, 243, 0.08)', `${command}: apply hover = faint blue`);
      await page.locator('.ccf-inline-popover.open [data-inline-popover-action="cancel"]').hover(); await page.waitForTimeout(300);
      assert.equal((await styles()).cancel.bg, 'rgba(255, 255, 255, 0.08)', `${command}: cancel hover = faint`);
      await page.evaluate(() => document.querySelector('.ccf-inline-popover.open [data-inline-popover-action="cancel"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      await page.waitForFunction(() => !document.querySelector('.ccf-inline-popover.open'));
    }
    // the other popovers keep their own buttons (narrator: 새로고침 · 저장 · 닫기)
    await page.evaluate(() => document.querySelector('[data-inline-command="narration"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    await page.waitForSelector('.ccf-inline-narrator-popover.open');
    assert.equal(await page.locator('.ccf-inline-narrator-popover .is-text-buttons').count(), 0, 'narrator popover is untouched');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('ruby/tooltip popover buttons PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
