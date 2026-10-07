const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// #117: a narrator's dice command (sent raw so CCFOLIA can roll it) must still look like narration:
// avatar and name hidden, centered, italic. Other speakers and non-dice messages stay untouched.
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-format-sync.user.js'), 'utf8');
const item = (id, name, text, result = '') => `<li class="MuiListItem-root" id="${id}"><img class="avatar" width="40" height="40" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}<span class="MuiTypography-caption"> - 今日 17:18</span></h6><p class="MuiTypography-root MuiTypography-body2 MuiListItemText-secondary">${text}${result ? `<span class="MuiTypography-root MuiTypography-body2">${result}</span>` : ''}</p></div></li>`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
    await page.goto('https://ccfolia.com/rooms/testroom');
    await page.evaluate(() => localStorage.setItem('ccf-format-narrators-v1:testroom', JSON.stringify(['배드 시프터'])));
    await page.setContent(`<style>.MuiListItem-root{display:flex;padding:8px 16px}.MuiListItemText-secondary{margin:0}</style>
      <div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul>
      ${item('narr-dice', '배드 시프터', 'choice[A,B,C]', ' (choice[A,B,C]) ＞ A')}
      ${item('narr-text', '배드 시프터', '그냥 문장')}
      ${item('other-dice', '다른 사람', 'choice[A,B,C]', ' (choice[A,B,C]) ＞ B')}
      ${item('narr-roll', '배드 시프터', '1D100', ' (1D100) ＞ 42')}
      </ul></div></div>`);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(800);
    const state = id => page.evaluate(target => {
      const li = document.getElementById(target);
      const cs = selector => getComputedStyle(li.querySelector(selector));
      return { marked: li.getAttribute('data-ccf-narration') === '1', avatar: cs('img.avatar').display, name: cs('.MuiListItemText-primary').display, align: cs('.MuiListItemText-root').textAlign, italic: cs('.MuiListItemText-secondary').fontStyle };
    }, id);
    for (const id of ['narr-dice', 'narr-roll']) {
      assert.deepEqual(await state(id), { marked: true, avatar: 'none', name: 'none', align: 'center', italic: 'italic' }, `${id} looks like narration`);
    }
    for (const id of ['narr-text', 'other-dice']) assert.equal((await state(id)).marked, false, `${id} is left alone`);
    // Removing the speaker from the narrator list restores the normal look.
    await page.evaluate(() => { localStorage.setItem('ccf-format-narrators-v1:testroom', '[]'); window.__CCF_FORMAT_SYNC_RUNTIME__.rescan(); });
    await page.waitForTimeout(500);
    assert.equal((await state('narr-dice')).marked, false, 'narration look removed once the speaker is no longer a narrator');
    console.log('narrator dice commands render as narration (and only for narrators; cleared on rescan) PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
