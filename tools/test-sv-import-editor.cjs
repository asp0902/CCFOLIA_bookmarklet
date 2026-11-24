// format-sync 0.1.166: [입력칸 서식 가져오기] in the format preset (Sv) window fills the builder with the formatting set in the input box
// (selection: what the whole selection shares; no selection: the character before the cursor + kept formatting). Saved only with [저장]; no formatting -> one note.
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
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:300px;bottom:20px;width:500px"><input name="name" value="나"><div style="display:flex"><button type="submit" style="margin-left:auto">전송</button></div><textarea name="text" rows="3" style="width:100%"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => { const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } }; document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } }; });
    await page.addScriptTag({ content: source });
    const bar = page.locator('.ccf-inline-toolbar').first();
    await bar.waitFor({ state: 'attached', timeout: 8000 });
    const ta = page.locator('#composer textarea');
    await ta.click(); await page.keyboard.type('가나다라마');
    const select = async (a, z) => { await ta.focus(); await page.keyboard.press('Control+Home'); for (let i = 0; i < a; i++) await page.keyboard.press('ArrowRight'); for (let i = a; i < z; i++) await page.keyboard.press('Shift+ArrowRight'); await page.waitForTimeout(80); };
    // bold + red + 24 on "가나다"
    await select(0, 3);
    await bar.locator('[data-inline-color="color"]').click();
    await page.locator('#ccf-color-pick .hex').fill('#ff0000'); await page.locator('#ccf-color-pick [data-ok]').click();
    await select(0, 3);
    await bar.locator('[data-inline-size]').fill('24'); await bar.locator('[data-inline-size]').press('Enter');
    // bold last: applying a colour to bold text currently drops the bold (separate existing bug, to fix next)
    await select(0, 3);
    await bar.locator('[data-inline-command="bold"]').click();
    // open Sv with "가나다" selected and import
    await select(0, 3);
    await bar.locator('[data-inline-command="style-clipboard"]').click();
    const sv = page.locator('.ccf-inline-popover.open'); await sv.waitFor({ timeout: 3000 });
    await sv.locator('[data-inline-style-action="import-editor"]').click();
    const got = await sv.evaluate((p) => ({ bold: p.querySelector('[data-style-builder="bold"]').getAttribute('data-active'), color: p.querySelector('[data-style-builder-color]').value, touched: p.querySelector('[data-style-builder-color]').getAttribute('data-touched'), size: p.querySelector('[data-style-builder-size]').value, name: p.querySelector('[data-style-preset-name]').value }));
    assert.deepEqual(got, { bold: '1', color: '#ff0000', touched: '1', size: '24', name: '' }, 'builder filled from the input box');
    await sv.locator('[data-style-preset-name]').fill('가져온 서식');
    await sv.locator('[data-inline-style-action="add-menu"]').click();
    await page.locator('.ccf-style-add-menu [data-inline-style-action="add"]').click();
    await page.waitForTimeout(200);
    const saved = await page.evaluate(() => { for (const k of Object.keys(localStorage)) { try { const v = JSON.parse(localStorage.getItem(k)); const list = Array.isArray(v) ? v : v?.presets; const hit = Array.isArray(list) && list.find((p) => p?.name === '가져온 서식'); if (hit) return hit.style; } catch (_) {} } return null; });
    assert.deepEqual(saved && { bold: saved.bold, color: saved.color, fontSize: saved.fontSize }, { bold: true, color: '#ff0000', fontSize: 24 }, 'saved preset has the three values');
    // a selection with mixed formatting: only what all of it shares ("다라": 다 is bold/red/24, 라 is plain) -> nothing -> note
    await page.mouse.click(20, 20); await page.waitForTimeout(150);
    await select(3, 5);
    await bar.locator('[data-inline-command="style-clipboard"]').click();
    const sv2 = page.locator('.ccf-inline-popover.open'); await sv2.waitFor({ timeout: 3000 });
    await sv2.locator('[data-inline-style-action="import-editor"]').click();
    assert.match(await sv2.innerText(), /입력칸에 가져올 서식이 없습니다/, 'no formatting: a note');
    assert.deepEqual(errors, []);
    console.log('sv import editor PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
