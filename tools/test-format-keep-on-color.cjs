// format-sync 0.1.167: colour / background / size / font on a selection change only that one thing; bold, italic, underline, strike
// (and partial formatting inside the selection) stay. In the real order: bold -> colour -> size, and colour -> italic.
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
    await ta.click(); await page.keyboard.type('가나다라마바');
    const select = async (a, z) => { await ta.evaluate((t, [a, z]) => { t.focus(); t.setSelectionRange(a, z); document.dispatchEvent(new Event('selectionchange')); }, [a, z]); await page.waitForTimeout(200); };
    const pickColor = async (which, hex) => { await bar.locator(`[data-inline-color="${which}"]`).click(); await page.locator('#ccf-color-pick .hex').fill(hex); await page.locator('#ccf-color-pick [data-ok]').click(); };
    const frags = () => page.evaluate(() => [...document.querySelectorAll('span.ccf-frag')].map((e) => [e.textContent, e.getAttribute('style') || '']));
    // bold on 가나다, then colour, then size on the same text
    await select(0, 3); await bar.locator('[data-inline-command="bold"]').click();
    await select(0, 3); await pickColor('color', '#ff0000');
    await select(0, 3); await bar.locator('[data-inline-size]').fill('24'); await bar.locator('[data-inline-size]').press('Enter');
    let f = await frags();
    let hit = f.find(([t]) => t === '가나다');
    assert(hit, JSON.stringify(f));
    assert.match(hit[1], /font-weight: 700/, 'bold kept after colour and size: ' + hit[1]);
    assert.match(hit[1], /color: rgb\(255, 0, 0\)/); assert.match(hit[1], /font-size: 24px/);
    // colour first on 라마바, then italic, then background: all kept
    await select(3, 6); await pickColor('color', '#00ff00');
    await select(3, 6); await bar.locator('[data-inline-command="italic"]').click();
    await select(3, 6); await pickColor('backgroundColor', '#0000ff');
    f = await frags(); hit = f.find(([t]) => t === '라마바');
    assert(hit, JSON.stringify(f));
    assert.match(hit[1], /color: rgb\(0, 255, 0\)/); assert.match(hit[1], /font-style: italic/); assert.match(hit[1], /background-color: rgb\(0, 0, 255\)/);
    // a colour over a mixed selection keeps the bold part bold and the plain part plain
    await select(1, 5); await pickColor('color', '#ffff00');
    f = await frags();
    const boldPart = f.filter(([, st]) => /font-weight: 700/.test(st)).map(([t]) => t).join('');
    assert.equal(boldPart, '가나다', 'only 가나다 is bold: ' + JSON.stringify(f));
    assert.deepEqual(errors, []);
    console.log('format keep on color PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
