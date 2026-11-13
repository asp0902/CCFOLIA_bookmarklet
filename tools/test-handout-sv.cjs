// handout 0.1.126: the editor's Sv button lists this room's format presets (format-sync's storage, folders included) and applies one by hand to the selection
// (bold + red + centred here; a tooltip, a ruby); what handout HTML / the play room cannot show the same way (blur, border) is left out. Saved -> the view window shows the
// same style; the play room's cleaning keeps it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
(async () => {
  const { cleanHandoutHtml } = await import('../prototype/public-handout-relay/public/handout-sanitize.mjs');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/R1');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      localStorage.setItem('ccf-format-style-folders-v1:R1', JSON.stringify([{ id: 'f1', name: '강조 모음', open: true }]));
      localStorage.setItem('ccf-format-style-presets-v1:R1', JSON.stringify([
        { name: '빨강 강조', folderId: 'f1', style: { bold: true, color: '#f44336', blur: 3, border: '1px solid red' }, align: 'center' },
        { name: '루비 팁', style: { rubyText: 'かん', tooltipText: '설명' }, align: 'left' }
      ]));
      const value = { myCharacter: '드와이프', handouts: [], folders: [], plList: [] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async (f, k, v) => { window.__saved = JSON.parse(JSON.stringify(v)); } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const sh = (sel) => page.locator('#ccfolia-handout-root').locator(sel);
    const inShadow = (fn, arg) => page.evaluate(([fn, arg]) => new Function('s', 'arg', fn)(document.querySelector('#ccfolia-handout-root').shadowRoot, arg), [fn, arg]);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    await inShadow(`s.querySelector('[data-action="new-handout"]').click(); s.querySelector('[data-action="add-handout-choice"]')?.click();`);
    await page.waitForTimeout(300);
    await sh('[data-field="title"]').fill('프리셋');
    await sh('.rich-editor[data-field="description"]').click();
    await page.keyboard.type('첫 줄'); await page.keyboard.press('Enter'); await page.keyboard.type('강조할 줄');
    // select the second line's text, open Sv
    await page.keyboard.down('Shift'); await page.keyboard.press('Home'); await page.keyboard.up('Shift');
    await sh('[data-format-cmd="sv"]').click(); await page.waitForTimeout(150);
    const menu = await inShadow(`return [...s.querySelectorAll('.sv-menu .sv-folder, .sv-menu .sv-item')].map((e) => e.textContent.trim());`);
    assert.deepEqual(menu, ['강조 모음', '빨강 강조', '루비 팁'], 'folders and presets: ' + JSON.stringify(menu));
    await sh('.sv-menu [data-sv-preset="0"]').click(); await page.waitForTimeout(200);
    assert.equal(await inShadow(`return s.querySelectorAll('.sv-menu').length;`), 0, 'menu closed');
    // the first line: nothing selected (caret) -> ruby + tooltip on the whole line
    await page.evaluate(() => {}); await sh('.rich-editor[data-field="description"]').click({ position: { x: 20, y: 12 } });
    await sh('[data-format-cmd="sv"]').click(); await page.waitForTimeout(150);
    await sh('.sv-menu [data-sv-preset="1"]').click(); await page.waitForTimeout(200);
    await sh('[data-action="save-handout"]').click(); await page.waitForTimeout(500);
    const saved = await page.evaluate(() => window.__saved.handouts[0]);
    const html = saved.description;
    assert.match(html, /font-weight:\s*700/); assert.match(html, /color:\s*(#f44336|rgb\(244, 67, 54\))/);
    assert.doesNotMatch(html, /filter|blur|border:/, 'blur and border are left out: ' + html);
    assert.match(html, /text-align:\s*center/, 'centred: ' + html);
    assert.match(html, /<ruby>.*<rt>かん<\/rt><\/ruby>/, 'ruby: ' + html); assert.match(html, /title="설명"/, 'tooltip: ' + html);
    // the GM's view window shows the same
    await inShadow(`s.querySelector('.tab[data-tab="list"]')?.click();`); await page.waitForTimeout(150);
    await inShadow(`s.querySelector('[data-action="view-handout"][data-id="' + arg + '"]').click();`, saved.id); await page.waitForTimeout(300);
    const look = await page.evaluate(() => { const r = document.querySelector('[data-ccf-handout-show="1"]').shadowRoot; const span = [...r.querySelectorAll('.rendered span')].find((x) => x.textContent.includes('강조할 줄')); const cs = getComputedStyle(span); let block = span; while (block && getComputedStyle(block).display === 'inline') block = block.parentElement; return { weight: cs.fontWeight, color: cs.color, align: getComputedStyle(block).textAlign, rt: r.querySelector('.rendered rt')?.textContent, title: r.querySelector('.rendered [title]')?.getAttribute('title') }; });
    assert.deepEqual(look, { weight: '700', color: 'rgb(244, 67, 54)', align: 'center', rt: 'かん', title: '설명' }, 'view window: ' + JSON.stringify(look));
    // the play room's cleaning keeps the same (bold, colour, centre, ruby, tooltip)
    const cleaned = cleanHandoutHtml(html);
    assert.match(cleaned, /font-weight:700/); assert.match(cleaned, /text-align:center/); assert.match(cleaned, /<rt>かん<\/rt>/); assert.match(cleaned, /title="설명"/);
    assert.deepEqual(errors, []);
    console.log('handout sv PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
