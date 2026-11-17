// format-sync 0.1.122: a check sent from the sheet with narration on ("command + space + envelope{command:true}") still becomes the Insane check card:
// the renderer copies the row text for the command + result, but the toolkit's own nodes in the row (the theme's card, a cut-in image) are not part of it
// (the overlay had the card's text flattened after the result: "... 실패MURDER FEED633맛실패목표치 7").
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const theme = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const decode = (text) => { const a = text.indexOf('⁣⁣⁣'), b = text.indexOf('⁢⁢⁢', a + 3); if (a < 0 || b < 0) return null; let bits = ''; for (const ch of text.slice(a + 3, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, '0'); } let b64 = ''; for (let i = 0; i + 8 <= bits.length; i += 8) b64 += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2)); return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><ul id="chatlist" style="width:500px"></ul><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><input name="name" value="서술자"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__sent = [];
      document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.querySelector('#composer textarea').value); });
      localStorage.setItem('ccf-format-narrators-v1:test', JSON.stringify(['서술자'])); localStorage.setItem('ccf-theme-switcher-settings-v1', JSON.stringify({ mode: 'default', selectedSheetTheme: 'insane-roll20', unsungDuetEnabled: true })); // the speaker is a narrator: narration is on
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: [], entities: {} } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.addScriptTag({ content: theme });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const send = (text, fromSheet) => page.evaluate(([t, fromSheet]) => { window.__sent.length = 0; const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); if (fromSheet) ta.setAttribute('data-ccf-sheet-command', '1'); try { document.querySelector('#composer button[type=submit]').click(); } finally { ta.removeAttribute('data-ccf-sheet-command'); } return new Promise((r) => setTimeout(() => r(window.__sent.slice()), 120)); }, [text, fromSheet]);
    const sent = await send('2D6>=7 [맛/공포심]', true);
    assert(decode(sent[0])?.command === true, 'narration envelope after the command');
    await page.evaluate((text) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">서술자</h6><p class="MuiListItemText-secondary MuiTypography-body2"></p></div>'; li.querySelector('p').append(document.createTextNode(text), document.createTextNode(' (2D6>=7) ＞ 6[3,3] ＞ 6 ＞ 실패')); const c = document.createElement('span'); c.className = 'ccf-roll20-emotion-card ccf-roll20-check-card'; c.textContent = 'MURDER FEED633맛실패목표치 7'; li.querySelector('p').append(c); /* the card can be in the row before the renderer runs */ document.getElementById('chatlist').appendChild(li); }, sent[0]);
    await page.waitForSelector('#chatlist .ccf-roll20-check-card', { timeout: 5000 });
    await page.waitForTimeout(1200);
    const look = await page.evaluate(() => { const p = document.querySelector('#chatlist p'); const o = p.querySelector('.ccf-render-overlay'); const card = p.querySelector('.ccf-roll20-check-card'); return { overlay: o ? o.textContent.replace(/\s+/g, ' ').trim() : null, card: !!card && getComputedStyle(card).display !== 'none' && card.getBoundingClientRect().height > 20, skill: card?.querySelector('.ccf-roll20-check-skill')?.textContent }; });
    assert(!/목표치/.test(look.overlay || ''), 'the overlay does not carry the card text: ' + JSON.stringify(look));
    assert.equal(look.card, true, 'the card is shown: ' + JSON.stringify(look));
    assert.equal(look.skill, '공포판정 : 맛');
    assert.deepEqual(errors, []);
    console.log('narration check card PASS', JSON.stringify(look));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
