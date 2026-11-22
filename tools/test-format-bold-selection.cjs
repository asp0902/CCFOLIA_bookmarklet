// format-sync 0.1.139: B/I/U/S on a selection change only that format of the selection (all on -> off, otherwise on) and do not leave the
// "apply to the next typing" state on; moving the caret elsewhere shows B off, so the next selection is made bold with one click.
// Without a selection B is the typing toggle (on -> typed text bold -> B again -> off). Ctrl+B follows the same rule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div role="log"><ul id="list"></ul></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><div style="display:flex"><button type="button" aria-label="D100">D100</button><button type="submit" style="margin-left:auto">전송</button></div><textarea name="text" class="MuiInputBase-input" rows="3" style="width:100%"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    await page.waitForSelector('[data-inline-command="bold"]', { state: 'attached', timeout: 8000 });
    await page.waitForTimeout(400);
    const ta = page.locator('textarea[name=text]');
    const B = page.locator('[data-inline-command="bold"]').first();
    const select = async (s, e = s) => { await page.evaluate(([s, e]) => { const t = document.querySelector('textarea[name=text]'); t.focus(); t.setSelectionRange(s, e); t.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); }, [s, e]); await page.waitForTimeout(120); };
    const look = () => B.evaluate((b) => ({ on: b.classList.contains('active') || b.classList.contains('ccf-fmt-current'), active: b.classList.contains('active') }));
    const boldAt = async (i) => { await select(i, i + 1); return (await look()).on; };
    const clickB = async () => { await B.dispatchEvent('mousedown'); await B.dispatchEvent('click'); await page.waitForTimeout(150); };

    await ta.click(); await page.keyboard.type('가나다 라마바');
    await select(0, 3); await clickB();
    assert.equal((await look()).active, false, 'a selection does not leave the typing toggle on');
    await select(5);
    assert.deepEqual(await look(), { on: false, active: false }, 'caret after 라 (not bold): B off');
    await select(4, 7); await clickB();
    assert.deepEqual([await boldAt(0), await boldAt(2), await boldAt(3), await boldAt(4), await boldAt(6)], [true, true, false, true, true], 'one click made 라마바 bold, 가나다 stays bold');
    // all bold -> off; partly bold -> all on
    await select(4, 7); await clickB();
    assert.equal(await boldAt(5), false, 'all bold -> unbold');
    await select(2, 6); await clickB();
    assert.deepEqual([await boldAt(2), await boldAt(3), await boldAt(5), await boldAt(6)], [true, true, true, false], 'partly bold -> the whole selection bold');
    // Ctrl+B on a selection: same rule
    await select(6, 7); await page.keyboard.press('Control+b'); await page.waitForTimeout(150);
    assert.equal(await boldAt(6), true, 'Ctrl+B on a selection');
    assert.equal((await look()).active, false);
    // no selection: the typing toggle
    await select(7); await clickB();
    assert.equal((await look()).active, true, 'caret: B = typing toggle on');
    await clickB();
    assert.equal((await look()).active, false, 'B again: off');
    assert.deepEqual(errors, []);
    console.log('format bold selection PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
