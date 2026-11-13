// others-characters 0.1.6: the chat speaker (character) menu of the GM also lists the room's characters owned by other people (e.g. a character the GM made and a player took over),
// after the GM's own ones: lighter background, a small person icon with the owner's name, title "소유자: 이름"; a character without a name is shown as NONAME and cannot be chosen
// (CCFOLIA picks the speaker by name). Choosing one calls CCFOLIA's own onSelect(name, id) of the menu (read from the menu items' React props), exactly like a native item.
// Not for a non-GM; follows a change of ownership. Replica menu with the measured structure (Popover > List > MenuItem, props { characterId, onSelect, isActive }).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-others-characters.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async (uid) => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222;color:#fff"><div id="root"></div></body>' }));
      await page.goto('https://ccfolia.com/rooms/r1');
      await page.evaluate((uid) => {
        const characters = { c1: { name: '연갈', owner: 'gm', iconUrl: 'https://example.test/a.png' }, c2: { name: '드와이프', owner: 'gm', iconUrl: '' }, o1: { name: '에르네스토', owner: 'p1', iconUrl: 'https://example.test/e.png', order: 1 }, o2: { name: '', owner: 'p2', iconUrl: '' } };
        const listeners = new Set();
        const state = { app: { user: { uid }, state: { roomId: 'r1' }, room: { members: { entities: { p1: { displayName: '시크릿' }, p2: { displayName: '밥' } } } } }, entities: { rooms: { entities: { r1: { owner: 'gm' } } }, roomCharacters: { entities: characters } } };
        window.__state = state; window.__notify = () => listeners.forEach((fn) => fn());
        document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } } } } };
        window.__selected = [];
        const onSelect = (name, id) => { window.__selected.push([name, id]); document.querySelector('.MuiPopover-root')?.remove(); };
        // the menu (opened by the speaker icon): the GM's own characters
        const pop = document.createElement('div'); pop.className = 'MuiPopover-root MuiModal-root'; pop.setAttribute('role', 'presentation');
        pop.innerHTML = '<div class="MuiPaper-root MuiPopover-paper" style="position:fixed;left:20px;top:20px;width:260px;background:#333"><ul class="MuiList-root MuiList-padding"></ul></div>';
        const ul = pop.querySelector('ul');
        for (const id of ['c1', 'c2']) {
          const li = document.createElement('li'); li.className = 'MuiButtonBase-root MuiMenuItem-root MuiMenuItem-dense'; li.setAttribute('role', 'menuitem'); li.tabIndex = 0;
          li.innerHTML = `<div class="MuiListItemAvatar-root"><div class="MuiAvatar-root"><img class="MuiAvatar-img" src="${characters[id].iconUrl || '/ccfolia.png'}"></div></div><div class="MuiListItemText-root"><span class="MuiListItemText-primary">${characters[id].name}</span><p class="MuiListItemText-secondary">활성 상태</p></div>`;
          li['__reactFiber$t'] = { memoizedProps: { dense: true, onClick: () => {} }, return: { memoizedProps: { characterId: id, onSelect, isActive: true } } };
          li.addEventListener('click', () => onSelect(characters[id].name, id));
          ul.append(li);
        }
        document.body.append(pop);
      }, uid);
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(400);
      return page;
    };
    const rows = (page) => page.evaluate(() => [...document.querySelectorAll('.MuiPopover-root li')].map((li) => ({ id: li.getAttribute('data-ccf-others-speaker') || '', name: li.querySelector('.MuiListItemText-primary')?.textContent, title: li.title || '', owner: li.querySelector('.MuiListItemText-secondary')?.textContent.trim(), icon: !!li.querySelector('.MuiListItemText-secondary svg'), disabled: getComputedStyle(li).pointerEvents === 'none' })));
    // GM
    const page = await open('gm');
    let list = await rows(page);
    assert.deepEqual(list.map((r) => r.id || r.name), ['연갈', '드와이프', 'o2', 'o1'], 'the other people\'s characters after the own ones (ordered by owner name, as in the my-characters window): ' + JSON.stringify(list));
    assert.deepEqual([list[3].name, list[3].title, list[3].owner, list[3].icon, list[3].disabled], ['에르네스토', '소유자: 시크릿', '시크릿', true, false]);
    assert.deepEqual([list[2].name, list[2].disabled], ['NONAME', true], 'a character without a name: NONAME, not selectable');
    // choose -> CCFOLIA's onSelect with the character's own name and id (the menu closes like a native choice)
    await page.locator('[data-ccf-others-speaker="o1"]').click();
    assert.deepEqual(await page.evaluate(() => window.__selected), [['에르네스토', 'o1']]);
    // ownership change: o1 becomes the GM's own -> not listed as someone else's any more (menu reopened)
    const page2 = await open('gm');
    await page2.evaluate(() => { window.__state.entities.roomCharacters.entities.o1.owner = 'gm'; window.__notify(); });
    await page2.waitForTimeout(300);
    assert.deepEqual((await rows(page2)).map((r) => r.id || r.name), ['연갈', '드와이프', 'o2'], 'follows the ownership');
    const d = await page2.evaluate(() => window.__CCF_OTHERS_CHARS__.diag().speaker);
    assert.match(d.reason, /정상: 1명/, JSON.stringify(d));
    // not the GM
    const player = await open('p1');
    assert.equal((await rows(player)).filter((r) => r.id).length, 0, 'nothing for a non-GM');
    for (const pg of [page, page2, player]) assert.deepEqual(pg.__errors, []);
    console.log('others speaker menu PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
