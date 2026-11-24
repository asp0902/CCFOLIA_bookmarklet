// format-sync 0.1.157: the narrator window lists the room's characters from the store (all of them, named), not names scraped from the page and kept forever:
// a deleted character leaves the list, a renamed one shows its new name, a new one appears, also while the window is open; a saved name that is gone stays as an orphan.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;top:200px;width:520px"><input name="name" value="나"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      // stale names from before: cached "my characters" and a scraped selection list with a deleted / old name
      localStorage.setItem('ccf-log-package:my-character-names:v1', JSON.stringify({ test: ['지운 캐릭터', '옛 이름'] }));
      localStorage.setItem('ccf-format-narrators-v1:test', JSON.stringify(['나레이터', '없는 사람']));
      const listeners = new Set();
      let state = { entities: { roomEffects: { ids: [], entities: {} }, roomCharacters: { ids: ['a', 'b', 'c', 'd'], entities: { a: { name: '나레이터' }, b: { name: '새 이름' }, c: { name: '' }, d: { name: '다른 사람 캐릭터', owner: 'x' } } } } };
      window.__setChars = (entities) => { state = { ...state, entities: { ...state.entities, roomCharacters: { ids: Object.keys(entities), entities } } }; listeners.forEach((fn) => fn()); };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    await page.evaluate(() => document.querySelector('[data-inline-command="narration"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    const pop = page.locator('.ccf-inline-narrator-popover.open');
    await pop.waitFor({ state: 'attached', timeout: 5000 });
    const names = async () => { await page.waitForTimeout(250); return pop.locator('.ccf-narrator-item').evaluateAll((l) => l.map((n) => n.getAttribute('data-inline-narrator-name'))); };
    const first = await names();
    for (const name of ['나레이터', '새 이름', '다른 사람 캐릭터']) assert(first.includes(name), `${name} listed: ${first}`);
    for (const name of ['지운 캐릭터', '옛 이름']) assert(!first.includes(name), `${name} not listed (stale cache): ${first}`);
    assert(first.includes('없는 사람'), 'a saved name that is gone stays listed (to be unticked)');
    // while open: rename, delete, add
    await page.evaluate(() => window.__setChars({ a: { name: '나레이터' }, b: { name: '바뀐 이름' }, e: { name: '추가된 캐릭터' } }));
    const second = await names();
    assert(second.includes('바뀐 이름') && second.includes('추가된 캐릭터') && !second.includes('새 이름') && !second.includes('다른 사람 캐릭터'), JSON.stringify(second));
    // the refresh icon reads the store again too
    await pop.locator('[data-inline-narrator-action="refresh"]').click();
    assert.deepEqual((await names()).filter((n) => n !== '없는 사람').sort(), ['나레이터', '바뀐 이름', '추가된 캐릭터'].sort());
    assert.deepEqual(errors, []);
    console.log('narrator room characters PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
