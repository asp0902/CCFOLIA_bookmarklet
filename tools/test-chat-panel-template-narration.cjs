// chat-panel 0.5.32: the extra panel copies one native row as the model of its rows. If the newest native row is a narration row that format-sync forced by inline styles
// (avatar / name display:none, centred full-width text) but whose narration markers are not on the row (a recycled virtual-list row, a race with the guardian), every panel row
// came out like narration: no avatar, no name / time, centred (user capture docs/img/extra-panel-no-avatar.png). Such a row is not a model any more, and the forced styles are cleared from the copy.
// Also: the panel body is opaque by default (the original's rgba 0.87 let the BGM bar and the my-characters window show through).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sourcePath = process.env.PANEL_SOURCE || path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const NATIVE = `<style>#nat{position:fixed;top:0;right:0;width:340px;height:640px;background:rgba(44,44,44,.87)}#sc{height:600px;overflow-y:auto}.MuiListItem-root{display:flex;padding:8px 16px;border-bottom:1px solid #444}h6{margin:0;height:20px}p{margin:0}.MuiTabs-root{height:34px;background:#222}</style>
  <div id="nat" class="MuiDrawer-paper"><div id="sc"><div class="MuiList-root" id="nlist"></div></div><div class="MuiTabs-root"><div class="MuiTabs-flexContainer" role="tablist"><button role="tab">메인</button><button role="tab">정보</button><button role="tab">잡담</button></div></div></div><div id="root"></div>`;
const IMG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: NATIVE }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate((IMG) => {
      const list = document.getElementById('nlist');
      const add = (name, text) => { const row = document.createElement('div'); row.className = 'MuiListItem-root'; row.innerHTML = `<div class="MuiListItemAvatar-root"><img src="${IMG}" width="40" height="40"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}<span> - 今日 16:02</span></h6><p class="MuiListItemText-secondary">${text}</p></div>`; list.append(row); return row; };
      add('에르네스토', '와'); add('에르네스토', '야후~~');
      // the newest native row: narration styles forced inline by format-sync, the narration attribute not (yet / any more) on the row
      const nar = add('에르네스토', '제가 열심히');
      for (const sel of ['.MuiListItemAvatar-root', '.MuiListItemText-primary']) { const el = nar.querySelector(sel); el.dataset.ccfNarrationForceHidden = '1'; el.style.setProperty('display', 'none', 'important'); }
      const text = nar.querySelector('.MuiListItemText-root'); text.dataset.ccfNarrationForceCenter = '1'; text.style.setProperty('text-align', 'center', 'important'); text.style.setProperty('width', '100%', 'important');
      const entities = {}, ids = [];
      ['와', '짱이에요', '야후~~'].forEach((t, i) => { entities['m' + i] = { name: i === 2 ? '드와이프' : '에르네스토', text: t, channel: 'main', createdAt: { seconds: 1700000000 + i, nanoseconds: 0 } }; ids.push('m' + i); });
      const state = { entities: { roomMessages: { entities, ids, idsGroupBy: { main: ids } }, roomCharacters: { entities: {} }, rooms: { entities: {} } } };
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    }, IMG);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(2500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#ccf-second-chat-panel [data-ccf-msg-id]')].map((li) => {
      const av = li.querySelector('.MuiListItemAvatar-root'), h = li.querySelector('h6.MuiListItemText-primary'), t = li.querySelector('.MuiListItemText-root');
      return { cont: li.getAttribute('data-ccf-prose-cont') === '1', avatar: !!av && getComputedStyle(av).display !== 'none', head: !!h && getComputedStyle(h).display !== 'none' ? h.textContent.trim() : '', align: t ? getComputedStyle(t).textAlign : '' };
    }));
    assert.equal(rows.length, 3, JSON.stringify(rows));
    // a speaker's first row has avatar, name and time, left aligned; the follow-up row of the same speaker is the bridge's business (cont)
    assert.deepEqual([rows[0].avatar, /에르네스토 - /.test(rows[0].head), rows[0].align !== 'center'], [true, true, true], 'first row of 에르네스토: avatar, name, time, not centred ' + JSON.stringify(rows[0]));
    assert.equal(rows[1].cont, true, 'same speaker -> follow-up row');
    assert.deepEqual([rows[2].avatar, /드와이프 - /.test(rows[2].head), rows[2].align !== 'center'], [true, true, true], 'another speaker: avatar, name, time ' + JSON.stringify(rows[2]));
    // opaque panel body
    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('ccf-second-chat-panel')).getPropertyValue('--scp-bg').trim());
    assert(!/rgba\([^)]*,\s*0?\.\d+\)/.test(bg), 'the panel background is opaque: ' + bg);
    assert.deepEqual(errors, []);
    console.log('chat panel template narration PASS', JSON.stringify(rows));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
