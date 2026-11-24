// theme 0.2.70 (Unsung Duet sheet theme, user decision): only ccfolia's '캐릭터 편집' window gets the Unsung Duet look — recognised by its structure
// (a dialog paper with the name field and the character memo field), not by its title. Every other dialog (필드 설정 here) stays ccfolia's own.
// The character edit artwork covers the whole window width (it was only on the inner content box: about 36/40px bands on the left / right),
// the content box and the scrollbar track are transparent over it. (On the real test room the 필드 설정 window measured the same as without the theme.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const dialog = (id, inner) => `<div class="MuiDialog-root" role="presentation"><div class="MuiDialog-container"><div id="${id}" class="MuiPaper-root MuiDialog-paper" role="dialog" style="width:880px;height:600px;display:flex;flex-direction:column;background:rgba(44,44,44,.87)">${inner}</div></div></div>`;
    const charEdit = dialog('char', `<header class="MuiAppBar-root" style="height:64px">캐릭터 편집</header><div style="padding:0 36px;flex:1;overflow:auto"><div class="MuiDialogContent-root" style="height:900px"><input name="name" value="시프터"><textarea name="memo"></textarea></div></div><div class="MuiDialogActions-root"><button class="MuiButton-root">삭제</button></div>`);
    const field = dialog('field', `<div class="MuiDialogContent-root"><input name="width" type="number" value="24"><input name="height" type="number" value="16"></div>`);
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body style="margin:0;background:#123"><div id="root"></div>${charEdit}${field}</body>` }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => localStorage.setItem('ccf-theme-switcher-settings-v1', JSON.stringify({ selectedSheetTheme: 'unsung-duet', unsungDuetEnabled: true })));
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ccf-dicebot') === 'unsung-duet', null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const look = (id) => page.evaluate((id) => { const d = document.getElementById(id), c = getComputedStyle(d), content = getComputedStyle(d.querySelector('.MuiDialogContent-root')), input = getComputedStyle(d.querySelector('input')); return { bgImage: c.backgroundImage, bgSize: c.backgroundSize, bg: c.backgroundColor, minWidth: c.minWidth, contentBg: content.backgroundImage + ' ' + content.backgroundColor, inputBg: input.backgroundColor }; }, id);
    const ch = await look('char'), fd = await look('field');
    assert.match(ch.bgImage, /imgur\.com\/htxGxau\.png/, 'character edit: the Unsung Duet artwork on the window itself');
    assert.equal(ch.bgSize, 'cover, cover', 'covers the whole width');
    assert.equal(ch.contentBg, 'none rgba(0, 0, 0, 0)', 'the content box adds no own band');
    assert.notEqual(ch.inputBg, 'rgba(0, 0, 0, 0)', 'character edit fields themed');
    assert.deepEqual([fd.bgImage, fd.bg, fd.inputBg], ['none', 'rgba(44, 44, 44, 0.87)', 'rgb(255, 255, 255)'], 'field settings: ccfolia own look (the replica field keeps its own default colour)');
    assert.notEqual(fd.minWidth, '600px', 'field settings keeps its own width');
    assert.deepEqual(errors, []);
    console.log('unsung duet character edit only PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
