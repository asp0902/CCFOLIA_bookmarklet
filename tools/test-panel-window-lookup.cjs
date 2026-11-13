// The real "내 캐릭터 목록" window is a Paper (elevation 6) holding a title bar that is a Paper too (MUI AppBar, elevation 0) and a .scrollable-list. Code that looks the window up from its title with
// closest(".MuiPaper-root") got the title bar (no rows). Checked with the real structure and chat ListItems in the same document (they must never be taken for character rows):
//  - character sheet: the 사이코로픽션 button is added to every character row of that window (also a character that is not on the board: its token button is "add"), never to chat rows;
//  - format-sync getMyCharacterPanel(): returns the window (the narrator list reads the names from it), not the title bar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = (name) => fs.readFileSync(path.join(__dirname, '../legacy/' + name), 'utf8');
const sheet = read('ccfolia-character-sheet.user.js'), format = read('ccfolia-format-sync.user.js').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const chatRow = (name, text) => `<li class="MuiListItem-root" style="display:flex"><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary MuiTypography-subtitle2">${name}<span> - 2026/10/07</span></h6><p class="MuiListItemText-secondary">${text}</p></div></li>`;
const charRow = (name, label) => `<div style="position:relative"><li class="MuiListItem-container"><div class="MuiListItem-root MuiListItem-button" role="button" style="display:flex"><div class="MuiListItemText-root"><span class="MuiTypography-root MuiListItemText-primary">${name}</span><p class="MuiListItemText-secondary">메모</p></div></div><div class="MuiListItemSecondaryAction-root"><button class="MuiIconButton-root" aria-label="${label}">x</button></div></li></div>`;
const html = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><span class="MuiTypography-caption">인세인</span><div id="root"></div>
  <ul id="chat">${chatRow('호질', '채팅 한 줄')}${chatRow('시크릿 룸', '또 한 줄')}</ul>
  <div class="MuiPaper-root MuiPaper-elevation6" id="win" style="position:fixed;right:20px;top:60px;width:420px;background:#333"><div><header class="MuiPaper-root MuiPaper-elevation0 MuiAppBar-root MuiAppBar-positionStatic"><div class="MuiToolbar-root MuiToolbar-dense"><h6 class="MuiTypography-root MuiTypography-subtitle2">내 캐릭터 목록</h6></div></header></div><div class="MuiList-root scrollable-list"><div><div class="css-sorted">${charRow('연갈', '駒を盤面から削除')}${charRow('브릿지', '駒として盤面に追加')}</div></div></div></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: sheet });
    await page.waitForSelector('#win [data-ccf-character-sheet-row-button]', { timeout: 5000 });
    const result = await page.evaluate(() => ({
      winButtons: document.querySelectorAll('#win [data-ccf-character-sheet-row-button]').length,
      chatButtons: document.querySelectorAll('#chat [data-ccf-character-sheet-row-button]').length,
      inSecondary: [...document.querySelectorAll('#win [data-ccf-character-sheet-row-button]')].every((b) => b.parentElement.classList.contains('MuiListItemSecondaryAction-root') && b.nextElementSibling?.tagName === 'BUTTON'),
    }));
    assert.deepEqual(result, { winButtons: 2, chatButtons: 0, inSecondary: true }, 'a sheet button on each character row (also the one with the "add" token button), none on chat rows, left of the token button');
    // format-sync's lookup: extract the function with its helpers and run it in the page
    const names = (src, from, to) => { const a = src.indexOf(from); return src.slice(a, src.indexOf(to, a)); };
    const code = names(format, '  const MY_CHARACTER_PANEL_TITLES = [', '  ];\n') + '  ];\n' + names(format, '  function normalizeMyCharacterName(value) {', '  function getMyCharacterPanelItemName') ;
    const panelInfo = await page.evaluate((code) => {
      const isVisible = (el) => el instanceof HTMLElement && el.getClientRects().length > 0;
      const fn = new Function('isVisible', 'const CHARACTER_STATUS_TEXT_RE = /(?!)/;' + code +'\n;return getMyCharacterPanel;');
      const panel = fn(isVisible)();
      return { id: panel?.id || '', names: panel ? panel.querySelectorAll('.MuiListItemText-primary').length : -1, isHeader: panel?.tagName === 'HEADER' };
    }, code);
    assert.deepEqual(panelInfo, { id: 'win', names: 2, isHeader: false }, 'format-sync finds the window, not the title bar (' + JSON.stringify(panelInfo) + ')');
    assert.deepEqual(errors, []); await page.close();
    console.log('panel window lookup PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
