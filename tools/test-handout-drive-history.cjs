// handout 0.1.140: Drive 변경 이력 - the card menu / editor 'change history' lists the Drive versions (newest first), shows one,
// restores it (confirm; local updated, saved) and keeps it (keepForever). Answers come from a mock bridge.
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
      window.__driveCalls = [];
      window.addEventListener('message', (e) => { const d = e.data; if (!d || d.source !== 'capybara-drive' || d.direction !== 'page') return; window.__driveCalls.push({ op: d.op, ids: (d.handouts || []).map((h) => h.id), deleted: d.deletedIds || [], remoteSent: (d.handouts || []).some((h) => h._remote) });
        const versions = [{ id: 'r1', at: '2026-11-17T10:00:00Z', kept: false }, { id: 'r2', at: '2026-11-17T11:00:00Z', kept: true }];
        const old = { id: 'h1', title: '옛 지도', description: '<div>옛 본문</div>', gmNotes: '', permissions: {}, order: 1, updatedAt: '2026-11-18T09:00:00Z' };
        const result = d.op === 'download' ? { handouts: d.handouts, added: [], updated: [], conflicts: [] } : d.op === 'history' ? { versions } : d.op === 'read' ? { handout: d.revId === 'r1' ? old : { ...old, title: '지도' } } : d.op === 'restore' ? { handout: old } : {};
        window.__driveCalls.push({ op: d.op, rev: d.revId, on: d.on });
        window.postMessage({ source: 'capybara-drive', direction: 'bridge', id: d.id, ok: true, result }, location.origin); });
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', folders: [], plList: [], handouts: [{ id: 'h1', title: '지도', description: '', gmNotes: '', permissions: {}, order: 1 }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async () => {} } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    const s = (js) => page.evaluate((js) => new Function('s', js)(document.querySelector('#ccfolia-handout-root').shadowRoot), js);
    await page.waitForTimeout(800);
    page.on('dialog', (d) => d.accept());
    await s(`s.querySelector('.card[data-id="h1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 60, clientY: 80 }));`);
    assert.deepEqual(await s(`return [...s.querySelectorAll('.card-menu [role=menuitem]')].map((b) => b.textContent);`), ['편집', '복제', '변경 이력', '삭제'], 'menu has 변경 이력 with Drive connected');
    await s(`s.querySelector('.card-menu [data-action="drive-history"]').click();`); await page.waitForTimeout(300);
    const items = await s(`return [...s.querySelectorAll('.drive-history-item')].map((b) => b.textContent);`);
    assert.equal(items.length, 2); assert.match(items[0], /지금 · 보관됨$/, 'newest first, kept marked: ' + items); 
    await s(`s.querySelectorAll('.drive-history-item')[1].click();`); await page.waitForTimeout(300);
    assert.match(await s(`return s.querySelector('.drive-history-view').textContent;`), /옛 지도[\s\S]*옛 본문/, 'preview of that version');
    await s(`s.querySelector('[data-action="drive-keep"]').click();`); await page.waitForTimeout(300);
    await s(`s.querySelectorAll('.drive-history-item')[1].click();`); await page.waitForTimeout(300);
    await s(`s.querySelector('[data-action="drive-restore"]').click();`); await page.waitForTimeout(500);
    const calls = await page.evaluate(() => window.__driveCalls.map((c) => `${c.op}:${c.rev || ''}`));
    assert(calls.includes('keep:r1') && calls.includes('restore:r1'), JSON.stringify(calls));
    assert.equal(await s(`return s.querySelectorAll('.drive-history').length;`), 0, 'closed after restoring');
    assert.equal(await s(`return s.querySelector('.card[data-id="h1"] .card-title-btn').textContent;`), '옛 지도', 'the local handout is the restored one');
    assert.deepEqual(errors, []);
    console.log('handout drive history PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
