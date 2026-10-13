// Participant page: dragging a movable piece sends one pieces/move command in the piece's own unit; locked pieces pan instead.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const sent = [], statusSent = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    if (u.pathname.endsWith('/status/set')) { statusSent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); }
    if (u.pathname.endsWith('/pieces/move')) { sent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' }); }
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const img = 'https://storage.ccfolia-cdn.net/a.png';
  await page.evaluate(img => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [{ id: 'i1', x: 0, y: 0, z: 1, angle: 0, width: 2, height: 2, imageUrl: img }, { id: 'i2', locked: true, x: 5, y: 5, z: 1, angle: 0, width: 2, height: 2, imageUrl: img }],
      characters: [{ id: 'c1', name: 'A', x: 48, y: 24, z: 2, angle: 0, width: 4, height: 4, iconUrl: img, status: [{ label: 'HP', value: 7, max: 10 }] }] });
  }, img);
  const drag = async (sel, dx, dy) => {
    const b = await page.locator(sel).boundingBox();
    const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + dx / 2, sy + dy / 2); await page.mouse.move(sx + dx, sy + dy); await page.mouse.up(); await page.waitForTimeout(200);
  };
  const unit = await page.evaluate(() => view.unit);
  await drag('img[data-id="i1"]', unit * 3, unit * 2);
  await drag('img[data-id="c1"]', unit * 2, 0);
  assert.equal(await page.locator('img[data-id="i2"][data-locked="1"]').count(), 1, 'locked piece is marked and cannot be dragged');
  await page.waitForTimeout(300);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], { kind: 'item', id: 'i1', x: 3, y: 2 });
  assert.deepEqual(sent[1], { kind: 'character', id: 'c1', x: 96, y: 24 }); // characters: px at zoom 1, 24px = 1 cell
  // speaker select lists the character; clicking a status bar sends status.set
  assert.deepEqual(await page.locator('#speaker option').allTextContents(), ['내 이름', 'A']);
  page.on('dialog', d => d.accept('9'));
  await page.locator('#scene-status .st-bar').click();
  await page.waitForTimeout(200);
  assert.deepEqual(statusSent, [{ characterId: 'c1', index: 0, value: 9 }]);
  // the browser never starts its own image drag (it would cut the pointer events short); movable pieces show CCFOLIA's move cursor
  const dragInfo = await page.evaluate(() => { const img = document.querySelector('#scene-field img[data-id]'); const event = new DragEvent('dragstart', { bubbles: true, cancelable: true }); img.dispatchEvent(event); const cs = getComputedStyle(img); return { prevented: event.defaultPrevented, userDrag: cs.webkitUserDrag, cursor: cs.cursor, draggable: img.draggable }; });
  assert.deepEqual(dragInfo, { prevented: true, userDrag: 'none', cursor: 'move', draggable: false });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.stage')).cursor), 'auto', 'the empty map keeps the default cursor (CCFOLIA: auto)');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('img[data-locked]')).cursor), 'default', 'a locked piece does not show a hand or move cursor');
  // a dice symbol the participant made (the relay's ledger) can be dragged like an item; somebody else's cannot
  await page.evaluate(() => { ownedIds = new Set(['d1']); renderScene({ fieldWidth: 40, fieldHeight: 20, items: [], markers: [], characters: [], diceSymbols: [{ id: 'd1', x: 0, y: 0, width: 2, height: 2, faces: 6, value: 3, closed: false }, { id: 'd2', x: 6, y: 0, width: 2, height: 2, faces: 6, value: 5, closed: false }] }); });
  assert.equal(await page.locator('.scene-die.mine').count(), 1, 'only their own die is a drag handle');
  const diceBefore = sent.length;
  await drag('.scene-die[data-id="d1"]', unit * 2, unit);
  await page.waitForTimeout(300);
  assert.deepEqual(sent[diceBefore], { kind: 'dice', id: 'd1', x: 2, y: 1 });
  await drag('.scene-die:not(.mine)', unit, unit); await page.waitForTimeout(200);
  assert.equal(sent.length, diceBefore + 1, "somebody else's die pans the scene instead of moving");
  // layers as CCFOLIA has them (measured): a locked panel as big as the field (z 1) must not cover a token (100 + z) or a die symbol (10000) - the click lands on the piece
  await page.setViewportSize({ width: 629, height: 1270 });
  const cover = await page.evaluate(() => { view.zoom = 0.6; ownedIds = new Set(['dd1']); renderScene({ fieldWidth: 50, fieldHeight: 30, items: [{ id: 'big', locked: true, x: -25, y: -15, z: 1, angle: 0, width: 50, height: 30, imageUrl: 'https://storage.ccfolia.com/x' }].map(i => ({ ...i, imageUrl: 'https://storage.ccfolia-cdn.net/big.png' })), markers: [], characters: [{ id: 'ch1', name: 'A', x: 24, y: 24, z: 0, angle: 0, width: 4, height: 4, iconUrl: 'https://storage.ccfolia-cdn.net/a.png', status: [] }], diceSymbols: [{ id: 'dd1', x: -1, y: -1, width: 2, height: 2, faces: 6, value: 1, closed: false }], decks: [{ id: 'dk', x: 5, y: 5, z: 99, layer: 1, width: 4, height: 6, count: 3, coverUrl: 'https://storage.ccfolia-cdn.net/back.png' }] }); const topOf = sel => { const r = document.querySelector(sel).getBoundingClientRect(); const e = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0]; return e.dataset.id || e.className || e.tagName; }; return { die: topOf('.scene-die[data-id="dd1"]'), token: topOf('img[data-id="ch1"]') }; });
  assert.deepEqual(cover, { die: 'dd1', token: 'ch1' }, 'the die and the token are on top of a big locked panel');
  await page.setViewportSize({ width: 1000, height: 700 });
  // markers and flipped cards are drawn and cannot be moved
  await page.evaluate(img => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill',
    items: [{ id: 'k1', closed: true, locked: true, x: 2, y: 2, z: 1, angle: 0, width: 4, height: 4, imageUrl: img }],
    markers: [{ id: 'mk1', x: 6, y: 2, z: 1, angle: 0, width: 3, height: 3, imageUrl: img }], characters: [] }), img);
  const drawn = await page.evaluate(() => [...document.querySelectorAll('#scene-field img')].map(i => ({ id: i.dataset.id || '', locked: i.dataset.locked || '', w: Math.round(parseFloat(i.style.width)) })));
  assert.equal(drawn.length, 2, 'the marker and the flipped card are both drawn');
  assert(drawn.some(d => d.id === 'k1' && d.locked === '1'), 'a flipped card is locked');
  assert(drawn.some(d => d.id === '' && d.locked === ''), 'a marker has no id and no drag handle');
  const before = sent.length;
  const flippedBox = await page.locator('img[data-id="k1"]').boundingBox();
  await page.mouse.move(flippedBox.x + 10, flippedBox.y + 10); await page.mouse.down(); await page.mouse.move(flippedBox.x + 60, flippedBox.y + 40); await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal(sent.length, before, 'dragging a flipped card sends no move');
  // layers: a character (stored z 0) is above an item and a marker (stored z 1), like in CCFOLIA (character 100 + z, others z)
  await page.evaluate(img => renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill',
    items: [{ id: 'it', x: 0, y: 0, z: 1, angle: 0, width: 4, height: 4, imageUrl: img }],
    markers: [{ id: 'mk', x: 0, y: 0, z: 1, angle: 0, width: 4, height: 4, imageUrl: img }],
    characters: [{ id: 'ch', name: 'A', x: 0, y: 0, z: 0, angle: 0, width: 4, height: 4, iconUrl: img, status: [] }] }), img);
  const order = await page.evaluate(() => [...document.querySelectorAll('#scene-field img')].map(i => ({ id: i.dataset.id || 'marker', z: Number(i.style.zIndex) })).sort((a, b) => a.z - b.z).map(x => x.id));
  assert.deepEqual(order, ['it', 'marker', 'ch'], 'item, then marker, then the character on top');
  // right click: never the browser's menu; a character shows CCFOLIA's player menu (what is not available here is off), a die its own two entries; somebody else's piece is not touched
  await page.evaluate(img => { ownedIds = new Set(['dd1']); renderScene({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], markers: [],
    characters: [{ id: 'cm', name: 'A', x: 0, y: 0, z: 0, angle: 0, width: 4, height: 4, iconUrl: img, status: [], commands: '1d100 판정\n2d6' }],
    diceSymbols: [{ id: 'dd1', x: 8, y: 0, width: 2, height: 2, faces: 6, value: 3, closed: false }, { id: 'dd2', x: 12, y: 0, width: 2, height: 2, faces: 6, value: 3, closed: false }] }); }, img);
  const prevented = await page.evaluate(() => new Promise(resolve => { const node = document.querySelector('img[data-id="cm"]'); const r = node.getBoundingClientRect(); const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 }); node.dispatchEvent(e); resolve(e.defaultPrevented); }));
  assert.equal(prevented, true, "the browser's own image menu is blocked");
  const items = () => page.evaluate(() => [...document.querySelectorAll('.menu-paper .menu-item')].map(b => `${b.firstChild.textContent}${b.disabled ? ' (off)' : ''}`));
  assert.deepEqual(await items(), ['편집', '회전', '집어넣기', '소유 권한 갖기', '복제', '복사 (off)', '채팅 팔레트', '삭제', 'ID 복사(개발자용)'], "somebody else's character: every entry but rotate and copy is on (a native player may use them on any character)");
  assert.equal(await page.evaluate(() => !!document.querySelector('img[data-id="cm"].selected')), true, 'selected: blue outline');
  await page.evaluate(() => { document.querySelector('.menu-paper')?.remove(); ownedIds = new Set(['cm', 'dd1']); renderScene({ fieldWidth: 40, fieldHeight: 20, items: [], markers: [], characters: [{ id: 'cm', name: 'A', x: 0, y: 0, z: 0, angle: 0, width: 4, height: 4, iconUrl: 'https://storage.ccfolia-cdn.net/a.png', status: [] }], diceSymbols: [] }); });
  await page.evaluate(() => { const node = document.querySelector('img[data-id="cm"]'); const r = node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 })); });
  assert.deepEqual(await items(), ['편집', '회전', '집어넣기', '소유 권한 갖기 (off)', '복제', '복사 (off)', '채팅 팔레트 (off)', '삭제', 'ID 복사(개발자용)'], 'their own character: taking ownership is off (it is theirs already)');
  await page.evaluate(() => { document.querySelector('.menu-paper')?.remove(); renderScene({ fieldWidth: 40, fieldHeight: 20, items: [], markers: [], characters: [], diceSymbols: [{ id: 'dd1', x: 8, y: 0, width: 2, height: 2, faces: 6, value: 3, closed: false }, { id: 'dd2', x: 12, y: 0, width: 2, height: 2, faces: 6, value: 3, closed: false }] }); });
  await page.evaluate(() => { const node = document.querySelector('.scene-die.mine'); const r = node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 })); });
  assert.deepEqual(await items(), ['roll a dice', '삭제'], 'their own die');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.dice-menu .dm-select')].map(sel => [...sel.options].map(o => o.textContent).join(','))), ['D4,D6,D8,D10,D12,D20', '1,2,3,4,5,6'], 'kind and value choices of the native die menu');
  await browser.close();
  console.log('participant piece move PASS');
})().catch(error => { console.error(error); process.exit(1); });
