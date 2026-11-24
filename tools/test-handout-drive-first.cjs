// handout 0.1.146: before the direction dialog the token is checked ('ensure'); without one, the reason + [다시 연결] instead of the choice;
// [다시 연결] ('connect') → the choice; a failed first sync is not recorded as done and the status line offers [다시 연결]. New wording (동기화 / PC → 드라이브 / 드라이브 → PC).
// handout 0.1.141: Drive first connection in this browser asks the direction (merge default / push / pull) and backs up the room first;
// '전체' downloads the other rooms listed in the Drive index into their local storage; the settings tab shows a Drive status line.
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
      document.documentElement.dataset.capybaraPlayerRelay = '1';
      document.documentElement.dataset.capybaraDrive = '1';
      window.__driveCalls = []; window.__driveFail = {};
      window.addEventListener('message', (e) => { const d = e.data; if (!d || d.source !== 'capybara-drive' || d.direction !== 'page') return;
        const fail = window.__driveFail[d.op]; if (fail) { delete window.__driveFail[d.op]; window.__driveCalls.push({ op: d.op, failed: true }); window.postMessage({ source: 'capybara-drive', direction: 'bridge', id: d.id, ok: false, ...fail }, location.origin); return; }
        window.__driveCalls.push({ op: d.op, ids: (d.handouts || []).map((h) => h.id), deleted: d.deletedIds || [], remoteSent: (d.handouts || []).some((h) => h._remote) });
        const result = d.op === 'download' ? (d.room === 'R2' ? { handouts: [{ id: 'z1', title: '다른 PC 룸 것', description: '', gmNotes: '', permissions: {}, order: 1, updatedAt: '2026-11-18T01:00:00Z' }], added: ['z1'], updated: [], conflicts: [] } : { handouts: [...d.handouts, { id: 'd1', title: 'Drive 것', description: '', gmNotes: '', permissions: {}, order: 5, updatedAt: '2026-11-17T10:00:00Z' }], added: ['d1'], updated: [], conflicts: [] }) : d.op === 'rooms' ? { rooms: [{ room: 'test', title: '여기' }, { room: 'R2', title: '다른 PC 룸' }] } : { changed: 1 };
        window.postMessage({ source: 'capybara-drive', direction: 'bridge', id: d.id, ok: true, result }, location.origin); });
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }] };
      window.__driveFail.ensure = { error: 'Google 로그인이 만료되었습니다 — [다시 연결]을 눌러 주세요', needsConnect: true, code: 'login-expired' };
      window.__rooms = {}; window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async (f, k) => ({ value: k === 'test' ? value : (window.__rooms[k] || null) }), setRoomData: async (f, k, v) => { if (k !== 'test') window.__rooms[k] = JSON.parse(JSON.stringify(v)); }, listRoomData: async () => Object.entries(window.__rooms).map(([roomKey, v]) => ({ featureId: 'ccf-handout', roomKey, value: v, updatedAt: '2026-11-18T00:00:00Z' })).concat([{ featureId: 'ccf-handout', roomKey: 'test', value, updatedAt: '2026-11-18T00:00:00Z' }]) } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const s = (js) => page.evaluate((js) => new Function('s', js)(document.querySelector('#ccfolia-handout-root').shadowRoot), js);
    await page.waitForTimeout(800);
    // no token (the browser was restarted and the silent re-issue failed): the reason + [다시 연결], no direction to choose
    assert.equal(await s(`return s.querySelectorAll('[data-action="drive-first"]').length;`), 0, 'no direction while not connected');
    assert.match(await s(`return s.querySelector('.drive-first p')?.textContent || '';`), /Google 로그인이 만료되었습니다/);
    await s(`s.querySelector('.drive-first [data-action="drive-connect"]').click();`); await page.waitForTimeout(500);
    // reconnected: now the direction dialog, with the new wording
    assert.deepEqual(await s(`return [...s.querySelectorAll('[data-action="drive-first"]')].map((b) => b.dataset.dir + ':' + b.textContent);`), ['merge:동기화', 'push:PC → 드라이브', 'pull:드라이브 → PC']);
    assert.equal(await s(`return s.querySelector('.drive-first p').innerHTML;`), '이 브라우저에서 처음 Google Drive와 연동합니다.<br>동기화 전까지 이 룸의 핸드아웃은 브라우저에 백업됩니다.');
    const gaps = await s(`const v = s.querySelector('.drive-first .drive-history-view'), p = v.querySelector('p'), a = v.querySelector('.drive-history-actions'); const r = (e) => e.getBoundingClientRect(); return [Math.round(r(p).top - r(v).top), Math.round(r(a).top - r(p).bottom), Math.round(r(v).bottom - r(a).bottom)];`);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, 'text and buttons: the same space above / between / below ' + gaps);
    assert.deepEqual((await page.evaluate(() => window.__driveCalls)).map((c) => c.op), ['ensure', 'connect', 'ensure'], 'waits for the choice');
    // a failed sync (token expired again): not recorded as done, the status line offers [다시 연결]
    await page.evaluate(() => { window.__driveFail.download = { error: 'Google 로그인이 만료되었습니다 — [다시 연결]을 눌러 주세요', needsConnect: true, code: 'http-401' }; });
    await s(`s.querySelector('[data-action="drive-first"][data-dir="merge"]').click();`); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => localStorage.getItem('ccf-handout:drive-first-done')), null, 'a failed first sync is not recorded');
    await s(`s.querySelector('.tab[data-tab="settings"]').click();`); await page.waitForTimeout(300);
    assert.match(await s(`return s.querySelector('[data-drive-line]')?.textContent || '';`), /^드라이브: 오류 .*Google 로그인이 만료/);
    assert.equal(await s(`return s.querySelectorAll('[data-drive-line] + [data-action="drive-connect"]').length;`), 1, '[다시 연결] next to the status line');
    await s(`s.querySelector('[data-drive-line] + [data-action="drive-connect"]').click();`); await page.waitForTimeout(500);
    await s(`s.querySelector('.tab[data-tab="list"]')?.click();`); await page.waitForTimeout(300);
    await s(`s.querySelector('[data-action="drive-first"][data-dir="merge"]').click();`); await page.waitForTimeout(500);
    assert.deepEqual(await s(`return [...s.querySelectorAll('.card[data-id]')].map((x) => x.dataset.id).sort();`), ['d1', 'h1'], 'merged');
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-handout:drive-backup:test')).handouts.length === 1), 'the room was backed up first');
    assert.equal(await page.evaluate(() => localStorage.getItem('ccf-handout:drive-first-done')), '1', 'asked once');
    // '전체': the other room from the Drive index comes into this browser
    await s(`s.querySelector('.scope-btn[data-scope="all"]').click();`); await page.waitForTimeout(800);
    assert(await page.evaluate(() => window.__rooms.R2 && window.__rooms.R2.handouts.some((h) => h.id === 'z1')), 'the other room saved locally');
    await s(`s.querySelector('.scope-btn[data-scope="all"]').click();`); await page.waitForTimeout(500);
    assert(await s(`return [...s.querySelectorAll('.room-group')].some((g) => g.dataset.room === 'R2');`), 'listed in 전체 룸');
    // the settings tab: the Drive status line
    await s(`s.querySelector('.tab[data-tab="settings"]').click();`); await page.waitForTimeout(300);
    assert.match(await s(`return s.querySelector('[data-drive-line]')?.textContent || '';`), /^드라이브: 마지막 동기화 /);
    assert.deepEqual(errors, []);
    console.log('handout drive first connection / all rooms / status PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
