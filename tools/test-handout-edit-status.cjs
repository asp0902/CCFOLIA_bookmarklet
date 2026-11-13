// handout 0.1.127: the status line (비밀 + who can see) is in the editor above the permission table, not on the list card; an account uid key shows as the
// linked PL name, one person once (name key + uid key), an unlinked account as "연결 안 된 계정"; no uid text anywhere on the list / editor screens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const UID_N = 'OEdv9IAJzSW1wSJA6yVrtAlOx6m1', UID_X = 'ZZZZ9IAJzSW1wSJA6yVrtAlOx6m9';
      const value = { myCharacter: '드와이프', folders: [], plDeleted: {}, plDeletedMigrated: true,
        plList: [{ name: '눈깅', id: '', role: 'player', aliases: [], image: '', uid: UID_N }, { name: 'MURDER FEED', id: '', role: 'player', aliases: [], image: '' }],
        handouts: [{ id: 'h1', title: '바깥 상황', description: '공개', gmNotes: '비밀', order: 1, permissions: { 눈깅: { view: true, secret: true }, [UID_N]: { view: true, secret: true }, 'MURDER FEED': { view: true }, [UID_X]: { view: true } } }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const s = (js, arg) => page.evaluate(([js, arg]) => new Function('s', 'arg', js)(document.querySelector('#ccfolia-handout-root').shadowRoot, arg), [js, arg]);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const card = await s(`const c = s.querySelector('.card[data-id="h1"]'); return { text: c.innerText, status: !!c.querySelector('.badge, .summary-row') };`);
    assert.equal(card.status, false, 'no status line on the card');
    assert.match(card.text, /바깥 상황/); 
    await s(`s.querySelector('[data-action="edit-handout"][data-id="h1"]').click();`); await page.waitForTimeout(300);
    const edit = await s(`const st = s.querySelector('.perm-section .edit-status'); return { badges: st ? [...st.querySelectorAll('.badge')].map((b) => b.textContent) : null, beforeTable: !!st && !!st.nextElementSibling?.classList.contains('perm-title'), text: s.querySelector('.body').innerText };`);
    assert.deepEqual(edit.badges, ['비밀', '눈깅, MURDER FEED, 연결 안 된 계정'], 'status in the editor, names, one person once: ' + JSON.stringify(edit.badges));
    assert.equal(edit.beforeTable, true, 'above the permission table');
    assert.doesNotMatch(edit.text, /OEdv9IAJ|ZZZZ9IAJ/, 'no uid on the editor screen');
    assert.doesNotMatch(card.text, /OEdv9IAJ|ZZZZ9IAJ/, 'no uid on the list');
    assert.deepEqual(errors, []);
    console.log('handout edit status PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
