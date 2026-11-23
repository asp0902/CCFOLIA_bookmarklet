// 2026-11-22 (chat-panel 0.5.51): a panel row clones an original row as its template; the original row carries the toolkit hover buttons (eye / break, always on since #556).
// They must not be cloned: after opening/closing the panel several times every panel row and every original row has exactly one eye and one break button.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await context.route('https://ccfolia.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<body style="background:#222;color:#fff"><div id="root"></div></body>' }));
    await context.route('https://firestore.googleapis.com/**', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.goto('https://ccfolia.test/rooms/test');
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      const entities = { m1: { name: '나', text: '내 말', from: 'me', channel: 'main', createdAt: { seconds: now - 20, nanoseconds: 0 } }, m2: { name: '남', text: '남의 말', from: 'other', channel: 'main', createdAt: { seconds: now - 10, nanoseconds: 0 } } };
      const state = { app: { state: { roomId: 'r1' }, user: { uid: 'me' } }, entities: { roomMessages: { entities, ids: ['m1', 'm2'], idsGroupBy: { main: ['m1', 'm2'] } }, roomCharacters: { entities: {} }, rooms: { entities: { r1: { owner: 'me' } } } } };
      const root = document.getElementById('root');
      root['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
      const row = (id, name, text) => `<li class="MuiListItem-root" id="${id}" style="position:relative;padding:12px 16px;list-style:none"><div class="MuiListItemAvatar-root"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40"></div><div class="MuiListItemText-root"><h6 class="MuiTypography-root MuiListItemText-primary">${name}<span class="MuiTypography-caption"> - 오늘</span></h6><p class="MuiListItemText-secondary">${text}</p></div></li>`; // CCFOLIA draws its hover buttons only while hovered (React state), so the template has none
      const ul = document.createElement('ul'); ul.innerHTML = row('own', '나', '내 말') + row('theirs', '남', '남의 말');
      root.appendChild(ul);
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(300);
    const api = () => page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__);
    await api();
    for (let i = 0; i < 3; i += 1) {
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
      await page.waitForTimeout(2300);
      await page.locator('#own').hover(); await page.waitForTimeout(150); // the eye moves into the original hover group
      await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.close());
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => window.__CCF_SECOND_CHAT_PANEL__.open());
    await page.waitForTimeout(2300);
    const counts = await page.evaluate(() => ({
      native: ['own', 'theirs'].map((id) => { const li = document.getElementById(id); return [li.querySelectorAll('.ccf-hide-btn').length, li.querySelectorAll('.ccf-break-btn').length]; }),
      panel: [...document.querySelectorAll('.ccf-scp-panel .MuiListItem-root, .ccf-scp-panel .ccf-scp-row')].filter((li) => li.querySelector('.MuiListItemText-secondary, .ccf-scp-text')).map((li) => [li.querySelectorAll('.ccf-hide-btn').length, li.querySelectorAll('.ccf-break-btn').length])
    }));
    assert.deepEqual(counts.native, [[1, 1], [1, 1]], 'original rows: one eye, one break');
    assert(counts.panel.length >= 2, 'panel rows drawn: ' + JSON.stringify(counts));
    for (const c of counts.panel) assert(c[0] <= 1 && c[1] <= 1, 'panel row: at most one toolkit button set ' + JSON.stringify(counts.panel));
    assert(counts.panel.some((c) => c[0] === 1), 'panel rows have their own eye');
    // 0.5.52: in a panel row the eye / divider sit at the right end of the row (16px like the original rows), not where the native buttons would be; also after resizing the panel
    const gaps = async () => { const row = page.locator('.ccf-scp-panel .ccf-hide-host').first(); await row.hover(); await page.waitForTimeout(150); return row.evaluate((li) => { const r = li.getBoundingClientRect(), eye = li.querySelector('.ccf-hide-btn').getBoundingClientRect(), brk = li.querySelector('.ccf-break-btn').getBoundingClientRect(), cap = li.querySelector('.MuiTypography-caption')?.getBoundingClientRect(); return { eye: Math.round(r.right - eye.right), brk: Math.round(eye.left - brk.right), clear: !cap || brk.left >= cap.right }; }); };
    for (const width of [null, 380]) {
      if (width) await page.evaluate((w) => { const p = document.querySelector('.ccf-scp-panel'); p.style.width = w + 'px'; }, width);
      const g = await gaps();
      assert(Math.abs(g.eye - 16) <= 2, 'eye at the right end (16px): ' + JSON.stringify(g));
      assert(g.brk >= -1 && g.brk <= 2, 'divider just left of the eye: ' + JSON.stringify(g));
      assert(g.clear, 'not over the time text: ' + JSON.stringify(g));
    }
    // 0.5.54 hover shading: the row background changes a little, the icon group gets a rounded backing, dimmed icons get clear; the row height does not change
    await page.mouse.move(5, 5); await page.waitForTimeout(200);
    await page.evaluate(() => { const li = document.querySelector('#root #theirs'); const g = document.createElement('div'); g.style.cssText = 'position:absolute;right:16px;top:4px'; g.innerHTML = '<button class="MuiButtonBase-root MuiIconButton-root" style="opacity:.35">↩</button>'; li.appendChild(g); });
    const look = (sel) => page.evaluate((sel) => { const li = document.querySelector(sel); const g = li.querySelector(':scope > div:has(> button.MuiIconButton-root)'); return { bg: getComputedStyle(li).backgroundColor, h: li.getBoundingClientRect().height, group: g ? getComputedStyle(g).backgroundColor : null, icon: g ? getComputedStyle(g.querySelector('button.MuiIconButton-root')).opacity : null }; }, sel);
    const before = await look('#root #theirs');
    await page.locator('#root #theirs').hover(); await page.waitForTimeout(250);
    const after = await look('#root #theirs');
    assert.equal(before.bg, 'rgba(0, 0, 0, 0)', 'no shade before');
    assert.notEqual(after.bg, before.bg, 'row shaded on hover ' + JSON.stringify(after));
    assert.notEqual(after.group, 'rgba(0, 0, 0, 0)', 'icon group backing ' + JSON.stringify(after));
    assert.equal(before.icon, '0.35'); assert.equal(after.icon, '0.9', 'icons clear on hover');
    assert.equal(after.h, before.h, 'row height unchanged');
    const prow = '.ccf-scp-panel [data-ccf-msg-id]';
    const pBefore = await page.evaluate((s) => { const li = document.querySelector(s); return [getComputedStyle(li).backgroundColor, li.getBoundingClientRect().height]; }, prow);
    await page.locator(prow).first().hover(); await page.waitForTimeout(250);
    const pAfter = await page.evaluate((s) => { const li = document.querySelector(s); return [getComputedStyle(li).backgroundColor, li.getBoundingClientRect().height]; }, prow);
    assert(/\/ 0\.04\)$/.test(pAfter[0]) && /\/ 0\.04\)$/.test(after.bg), 'panel row: the same 4% shade of its text colour as the original row ' + JSON.stringify([pBefore, pAfter, after.bg]));
    assert.equal(pAfter[1], pBefore[1], 'panel row height unchanged');
    if (process.env.SCREENSHOT_DIR) await page.locator('#root #theirs').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'chat-hover-shade.png') });
    // 0.5.56 a native list in a popup (sound list: row + secondary action icon) keeps its look: no row shade, no backing behind the icon, the icon's own hover only
    for (const [wrap, primary] of [['MuiDialog-root', 'h6'], ['plain-list', 'span']]) {
      await page.evaluate(([wrap, primary]) => { document.getElementById('native-list')?.remove(); const d = document.createElement('div'); d.id = 'native-list'; d.className = wrap; d.style.cssText = 'position:fixed;left:20px;top:20px;width:300px;z-index:99999;background:#333;color:#fff'; d.innerHTML = `<div class="MuiListItem-root" style="position:relative;height:60px"><div class="MuiListItemText-root"><${primary} class="MuiListItemText-primary">효과음.mp3</${primary}><p class="MuiListItemText-secondary">설명</p></div><div id="native-action" style="position:absolute;right:8px;top:8px"><button class="MuiIconButton-root" style="opacity:.8;background:transparent;width:40px;height:40px">✎</button></div></div>`; document.body.appendChild(d); }, [wrap, primary]);
      await page.locator('#native-list .MuiListItem-root').hover({ position: { x: 20, y: 20 } }); await page.waitForTimeout(200);
      const n = await page.evaluate(() => { const li = document.querySelector('#native-list .MuiListItem-root'), g = document.getElementById('native-action'), b = g.querySelector('button'); return [getComputedStyle(li).backgroundColor, getComputedStyle(g).backgroundColor, getComputedStyle(g).borderTopLeftRadius, getComputedStyle(b).opacity]; });
      assert.deepEqual(n, ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', '0px', '0.8'], wrap + ': native row hover');
      await page.locator('#native-action button').hover(); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#native-action button')).backgroundColor), 'rgba(0, 0, 0, 0)', wrap + ': no toolkit shade on the icon');
    }
    await page.evaluate(() => document.getElementById('native-list').remove());
    // 0.5.55 one vertical line between the panels: no inner bright line on the panel (the original's left border is the only one)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ccf-scp-panel'), '::after').content), 'none', 'no panel ::after line');
    assert.deepEqual(errors, []);
    console.log('chat panel single hover set PASS');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
