// slash-macros 0.1.4: custom commands shared to the room (rooms/{room}/macros, the handout tool's Firebase connection). A stand-in Firebase in the page:
// A shares -> the document (name, body, ownerUid, ownerName, updatedAt, deleted); B's shared command shows in A's manager ('룸 커맨드') and autocomplete as "이름 (공유)";
// A copies it into its own commands; A edits its shared command -> the room copy follows; A stops sharing -> deleted; GM sees a delete button for others' commands;
// no connection / refused rules -> the share button is off with a one-line note.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-slash-macros.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#333;color:#fff"><div id="root"></div><form style="position:fixed;bottom:20px;left:20px;width:400px"><textarea id="chat" style="width:380px;height:40px"></textarea><button aria-label="D4" type="button">D4</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/R1');
    await page.evaluate(() => {
      localStorage.setItem('ccf-slash-macros-v1', JSON.stringify([{ name: '날씨', body: '/roll 1d6 날씨', updatedAt: 1 }]));
      const F = window.__fake = { docs: new Map(), listeners: [], denied: false, gm: false, connected: true };
      const parent = (p) => p.split('/').slice(0, -1).join('/');
      const snap = (col) => { const docs = [...F.docs].filter(([p]) => parent(p) === col).map(([p, v]) => ({ id: p.split('/').pop(), data: () => JSON.parse(JSON.stringify(v)) })); return { forEach: (fn) => docs.forEach(fn) }; };
      F.emit = () => F.listeners.forEach((l) => l.ok(snap(l.col)));
      const fsApi = {
        collection: (db, ...parts) => parts.join('/'), doc: (db, ...parts) => parts.join('/'),
        onSnapshot: (col, ok, bad) => { if (F.denied) { setTimeout(() => bad({ code: 'permission-denied' }), 0); return () => {}; } const l = { col, ok }; F.listeners.push(l); setTimeout(() => ok(snap(col)), 0); return () => { F.listeners = F.listeners.filter((x) => x !== l); }; },
        setDoc: async (p, data) => { F.docs.set(p, JSON.parse(JSON.stringify(data))); F.emit(); },
        deleteDoc: async (p) => { F.docs.delete(p); F.emit(); }
      };
      // B's shared command already in the room
      F.docs.set('rooms/R1/macros/anon-b_x', { name: '장면표', body: '/roll-table 장면표', ownerUid: 'anon-b', ownerName: '밥', updatedAt: 1, deleted: false });
      F.docs.set('rooms/R1/macros/anon-b_y', { name: '지운것', body: 'x', ownerUid: 'anon-b', ownerName: '밥', updatedAt: 1, deleted: true });
      window.__CCF_HANDOUT_FB__ = { state: () => (F.connected ? { db: {}, uid: 'anon-a', modules: { fs: fsApi } } : null), isGm: () => F.gm, roomKey: () => 'R1' };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(400);
    const api = (fn, ...args) => page.evaluate(([fn, args]) => window.__CCF_SLASH_MACROS_DEBUG__[fn](...args), [fn, args]);
    await api('openManager'); await page.waitForTimeout(300);
    const modal = () => page.evaluate(() => { const m = document.getElementById('ccf-slash-macros-modal'); return { mine: [...m.querySelectorAll('[data-role="list"] .ccf-sm-modal-row')].map((r) => [r.getAttribute('data-name'), r.querySelector('[data-action="share"]').textContent.trim(), r.querySelector('[data-action="share"]').disabled]), room: [...m.querySelectorAll('.ccf-sm-room-row')].map((r) => [r.querySelector('strong').textContent.trim(), [...r.querySelectorAll('button')].map((b) => b.textContent.trim())]), note: m.querySelector('.ccf-sm-room-note')?.textContent || '' }; });
    let m = await modal();
    assert.deepEqual(m.mine, [['날씨', '룸 공유', false]]);
    assert.deepEqual(m.room, [['장면표 (공유 · 밥)', ['내 커맨드로 복사']]], 'B\'s command (not the deleted one), no delete button for a player');
    // A shares 날씨
    await page.locator('#ccf-slash-macros-modal [data-name="날씨"] [data-action="share"]').click(); await page.waitForTimeout(200);
    const doc = await page.evaluate(() => [...window.__fake.docs].find(([p, v]) => v.ownerUid === 'anon-a'));
    assert(doc && doc[0].startsWith('rooms/R1/macros/anon-a_'), JSON.stringify(doc));
    assert.deepEqual(Object.keys(doc[1]).sort(), ['body', 'deleted', 'name', 'ownerName', 'ownerUid', 'updatedAt']);
    assert.deepEqual([doc[1].name, doc[1].body, doc[1].deleted], ['날씨', '/roll 1d6 날씨', false]);
    m = await modal(); assert.equal(m.mine[0][1], '공유 중');
    // A edits its shared command: the room copy follows
    await page.fill('#ccf-slash-macros-modal [data-role="name"]', '날씨'); await page.fill('#ccf-slash-macros-modal [data-role="body"]', '/roll 2d6 날씨');
    await page.locator('#ccf-slash-macros-modal [data-role="save"]').click(); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => [...window.__fake.docs.values()].find((v) => v.ownerUid === 'anon-a').body), '/roll 2d6 날씨');
    // copy B's into my own
    await page.locator('#ccf-slash-macros-modal .ccf-sm-room-row [data-action="copy"]').click(); await page.waitForTimeout(150);
    assert.deepEqual((await api('listMacros')).map((x) => x.name), ['날씨', '장면표']);
    // autocomplete: mine + room; a room name that I now also have is mine only
    await page.evaluate(() => { const m = window.__fake; m.docs.set('rooms/R1/macros/anon-b_z', { name: '날짜', body: '/date', ownerUid: 'anon-b', ownerName: '밥', updatedAt: 2, deleted: false }); m.emit(); });
    await page.locator('#ccf-slash-macros-modal .ccf-sm-modal-close').click();
    await page.locator('#chat').click(); await page.keyboard.type('날');
    await page.waitForTimeout(150);
    const items = await page.evaluate(() => [...document.querySelectorAll('#ccf-slash-macros-popup .ccf-sm-popup-name')].map((e) => e.textContent));
    assert.deepEqual(items, ['날씨', '날짜 (공유)'], 'autocomplete: ' + JSON.stringify(items));
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#chat'), '/date', 'a room command expands like mine');
    // stop sharing
    await api('openManager'); await page.waitForTimeout(200);
    await page.locator('#ccf-slash-macros-modal [data-name="날씨"] [data-action="share"]').click(); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => [...window.__fake.docs.values()].find((v) => v.ownerUid === 'anon-a').deleted), true, 'deleted mark');
    // the GM sees a delete button on others' commands and deletes one
    await page.evaluate(() => { window.__fake.gm = true; window.__fake.emit(); }); await page.waitForTimeout(150);
    m = await modal(); assert(m.room.every(([, buttons]) => buttons.includes('삭제')), 'GM delete buttons: ' + JSON.stringify(m.room));
    await page.locator('#ccf-slash-macros-modal .ccf-sm-room-row [data-action="room-delete"]').first().click(); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__fake.docs.has('rooms/R1/macros/anon-b_x')), false, 'GM deleted it');
    // refused rules: share off with a note
    await page.locator('#ccf-slash-macros-modal .ccf-sm-modal-close').click();
    await page.evaluate(() => { window.__fake.connected = false; }); await page.waitForTimeout(3300);
    await api('openManager'); await page.waitForTimeout(150);
    m = await modal();
    assert.deepEqual([m.mine[0][2], /핸드아웃 연결/.test(m.note)], [true, true], 'no connection: ' + JSON.stringify(m));
    await page.locator('#ccf-slash-macros-modal .ccf-sm-modal-close').click();
    await page.evaluate(() => { window.__fake.connected = true; window.__fake.denied = true; }); await page.waitForTimeout(3300);
    await api('openManager'); await page.waitForTimeout(150);
    m = await modal();
    assert.deepEqual([m.mine[0][2], /규칙/.test(m.note)], [true, true], 'refused: ' + JSON.stringify(m));
    assert.deepEqual(errors, []);
    console.log('slash macros room share PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
