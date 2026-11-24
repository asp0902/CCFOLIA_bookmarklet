// roll20 bridge 0.3.119 (scroll jitter, option A): a chat row's height depends only on itself and the row before it, never on the row after.
// - a new message does not change the height of rows already on screen (the virtual list measured them once);
// - the space a group kept under its last row now sits above the next group's first row (same distance between groups as before), the divider is
//   drawn where it was (moved, not resized), and the list end gets that space as list padding;
// - the row a new message will get is styled at its final shape before it is drawn (index CSS from the store), so its first measurement is the final one.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const css = `<style>body{background:#282828;color:#fff;font:16px/24px sans-serif;margin:0}ul{list-style:none;margin:0;padding:0;width:400px}
    .MuiListItem-root{display:flex;padding:8px 16px;box-sizing:border-box}.MuiListItemAvatar-root{width:40px;min-width:40px}
    .MuiListItemText-root{margin:6px 0;flex:1}h6{margin:0}p{margin:0}hr{margin:0 16px;border:0;border-bottom:1px solid #555;height:0}</style>`;
  const row = (i, name, text) => `<div data-index="${i}"><div class="MuiListItem-root"><div class="MuiListItemAvatar-root"><img src="/blank.gif"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${name}</h6><p class="MuiListItemText-secondary">${text}</p></div></div><hr class="MuiDivider-root MuiDivider-middle"></div>`;
  const html = (rows) => `${css}<div id="root"></div><ul role="log"><div id="box">${rows.map((r, i) => row(i, r[0], r[1])).join('')}</div></ul>`;
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    // native (no script): the distance from one speaker's text to the next speaker's text, and from the last text to the divider
    await page.setContent(html([['가', 'a'], ['나', 'b']]));
    const nativeSep = await page.evaluate(() => { const ps = [...document.querySelectorAll('ul[role=log] p')].map((p) => p.getBoundingClientRect()); return ps[1].top - ps[0].bottom; });
    const nativeHr = await page.evaluate(() => document.querySelectorAll('hr')[0].getBoundingClientRect().top - document.querySelectorAll('p')[0].getBoundingClientRect().bottom);
    const nativeEnd = await page.evaluate(() => { const ul = document.querySelector('ul[role=log]'); return ul.getBoundingClientRect().bottom - [...ul.querySelectorAll('p')].pop().getBoundingClientRect().bottom; });

    await page.setContent(html([['가', 'a'], ['가', 'b'], ['나', 'c']]));
    await page.evaluate(() => {
      // the store like ccfolia's: the rows of the shown tab are idsGroupBy[app.state.roomChatTab] in order (row index = position)
      const first = [['m1', '가', 'a'], ['m2', '가', 'b'], ['m3', '나', 'c']].map(([_id, name, text]) => ({ _id, name, text, iconUrl: null, channel: 'main' }));
      const state = { app: { state: { roomChatTab: 'main' } }, entities: { roomMessages: { ids: first.map((m) => m._id), idsGroupBy: { main: first.map((m) => m._id) }, entities: Object.fromEntries(first.map((m) => [m._id, m])) } } };
      const listeners = [];
      window.__store = { getState: () => state, dispatch() {}, subscribe: (f) => { listeners.push(f); return () => {}; } };
      window.__notify = () => listeners.forEach((f) => f());
      window.__add = (msg) => { const r = state.entities.roomMessages; state.entities = { roomMessages: { ids: [...r.ids, msg._id], idsGroupBy: { main: [...r.idsGroupBy.main, msg._id] }, entities: { ...r.entities, [msg._id]: msg } } }; listeners.forEach((f) => f()); };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: window.__store } } } };
    });
    await page.addScriptTag({ path: path.join(__dirname, '..', 'legacy', 'ccfolia-roll20-css-bridge.user.js') });
    await page.waitForTimeout(300);
    const heights = () => page.evaluate(() => [...document.querySelectorAll('[data-index]')].map((w) => w.getBoundingClientRect().height));
    const ps = () => page.evaluate(() => [...document.querySelectorAll('ul[role=log] p')].map((p) => { const r = p.getBoundingClientRect(); return [r.top, r.bottom]; }));
    let p = await ps();
    assert.equal(p[1][0] - p[0][1], 6, 'inside a group 5px + the 1px divider');
    assert.equal(p[2][0] - p[1][1], nativeSep, `between groups ${p[2][0] - p[1][1]} = native ${nativeSep}`);
    const hrGap = await page.evaluate(() => { const hr = document.querySelectorAll('hr')[1]; return hr.getBoundingClientRect().top - document.querySelectorAll('p')[1].getBoundingClientRect().bottom; });
    assert.equal(hrGap, nativeHr, `divider after a group drawn where it was (${hrGap} vs ${nativeHr})`);

    // a new message by the same speaker as the last row: no row on screen changes height, and the new row is final at its first measurement
    const before = await heights();
    const first = await page.evaluate(() => {
      window.__add({ _id: 'm4', name: '나', text: 'd', iconUrl: null, channel: 'main' });
      const box = document.getElementById('box'); const t = document.createElement('template');
      t.innerHTML = '<div data-index="3"><div class="MuiListItem-root"><div class="MuiListItemAvatar-root"><img src="/blank.gif"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">나</h6><p class="MuiListItemText-secondary">d</p></div></div><hr class="MuiDivider-root MuiDivider-middle"></div>';
      box.append(t.content.firstChild);
      return box.lastElementChild.getBoundingClientRect().height; // measured like the virtual list does: in the same task, before any observer ran
    });
    await page.waitForTimeout(200);
    const after = await heights();
    assert.deepEqual(after.slice(0, 3), before, `rows on screen keep their height (${before} → ${after.slice(0, 3)})`);
    assert.equal(first, after[3], `new row: first measurement ${first} = final ${after[3]}`);
    p = await ps();
    assert.equal(p[3][0] - p[2][1], 6, 'the new row joined the group');
    // a new speaker after that: same checks
    const before2 = await heights();
    const first2 = await page.evaluate(() => {
      window.__add({ _id: 'm5', name: '다', text: 'e', iconUrl: null, channel: 'main' });
      const box = document.getElementById('box'); const t = document.createElement('template');
      t.innerHTML = '<div data-index="4"><div class="MuiListItem-root"><div class="MuiListItemAvatar-root"><img src="/blank.gif"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">다</h6><p class="MuiListItemText-secondary">e</p></div></div><hr class="MuiDivider-root MuiDivider-middle"></div>';
      box.append(t.content.firstChild);
      return box.lastElementChild.getBoundingClientRect().height;
    });
    await page.waitForTimeout(200);
    const after2 = await heights();
    assert.deepEqual(after2.slice(0, 4), before2, 'rows on screen keep their height');
    assert.equal(first2, after2[4], `new speaker row: first measurement ${first2} = final ${after2[4]}`);
    p = await ps();
    assert.equal(p[4][0] - p[3][1], nativeSep, 'new speaker: native distance');
    // the list end keeps the space the last row no longer has
    const end = await page.evaluate(() => { const ul = document.querySelector('ul[role=log]'); return ul.getBoundingClientRect().bottom - [...ul.querySelectorAll('p')].pop().getBoundingClientRect().bottom; });
    // the list end keeps only the inner 5px + the 1px divider space (accepted: filling it with list padding moved the bottom once more after the native scroll)
    assert.equal(end, 6, `list end space ${end} (native ${nativeEnd})`);
    assert.equal(await page.evaluate(() => getComputedStyle([...document.querySelectorAll('ul[role=log] hr')].pop()).visibility), 'hidden', 'the last row line is hidden');
    assert.equal(await page.evaluate(() => getComputedStyle([...document.querySelectorAll('ul[role=log] hr')].pop()).transform), 'none', 'the last row line is not moved (no overflow below the list)');
    // 0.3.120 tab switch: the store switches the tab first, then the list draws that tab's rows (index 0..). Every row is final at its first measurement.
    const firstTab = await page.evaluate(() => {
      const msgs = [['o1', '라', 'x'], ['o2', '라', 'y'], ['o3', '마', 'z']].map(([_id, name, text]) => ({ _id, name, text, iconUrl: null, channel: 'other' }));
      const s = window.__store.getState(), r = s.entities.roomMessages;
      s.entities = { roomMessages: { ...r, ids: [...r.ids, ...msgs.map((m) => m._id)], idsGroupBy: { ...r.idsGroupBy, other: msgs.map((m) => m._id) }, entities: { ...r.entities, ...Object.fromEntries(msgs.map((m) => [m._id, m])) } } };
      s.app = { state: { roomChatTab: 'other' } };
      return msgs;
    });
    const tabHeights = await page.evaluate((msgs) => {
      window.__notify(); // the store tells its subscribers (the tab changed) before the list draws the tab
      const box = document.getElementById('box'); box.textContent = '';
      for (const [i, m] of msgs.entries()) { const t = document.createElement('template'); t.innerHTML = `<div data-index="${i}"><div class="MuiListItem-root"><div class="MuiListItemAvatar-root"><img src="/blank.gif"></div><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${m.name}</h6><p class="MuiListItemText-secondary">${m.text}</p></div></div><hr class="MuiDivider-root MuiDivider-middle"></div>`; box.append(t.content.firstChild); }
      return [...box.children].map((w) => w.getBoundingClientRect().height);
    }, firstTab);
    await page.waitForTimeout(200);
    assert.deepEqual(await heights(), tabHeights, `tab switch: first measurements ${tabHeights} = final`);
    assert.deepEqual(await page.evaluate(() => window.__CCF_PROSE_MODE_DEBUG__.prediction().misses), 0, 'no wrong prediction');
    assert.deepEqual(errors, []);
    console.log(`prose stable heights PASS (between groups ${nativeSep}, list end ${end})`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
