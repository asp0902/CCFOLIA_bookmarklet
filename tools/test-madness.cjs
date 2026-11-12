// #121 madness alert: Cthulhu room only; SAN drop of 5+ at once → temporary-madness button, cumulative 1/5 of today's first-seen value → indefinite button; only the owner / the GM see the card;
// the button puts the table command into the chat box and sends it; the day rolls the baseline over; the first sight of a value never alerts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-madness.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const open = async ({ system = 'Cthulhu7th', uid = 'me', owner = 'someone', charOwner = 'me', pre } = {}) => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body style="background:#282828;color:#fff"><div id="root"></div><form id="f"><textarea id="box"></textarea><button type="button" id="send">전송</button></form></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      await page.evaluate(({ system, uid, owner, charOwner, pre }) => {
        if (pre) for (const [k, v] of Object.entries(pre)) localStorage.setItem(k, v);
        const state = { app: { user: { uid }, state: { roomId: 'r1' } }, entities: { rooms: { entities: { r1: { owner, diceBotSystem: system } } }, roomCharacters: { entities: { c1: { name: '탐사자', owner: charOwner, status: [{ label: 'HP', value: 10, max: 10 }, { label: 'SAN', value: 57, max: 99 }] } } } } };
        const listeners = new Set(); window.__state = state; window.__sent = [];
        const store = { getState: () => state, dispatch() {}, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
        window.__setSan = (v) => { state.entities.roomCharacters.entities.c1.status[1].value = v; listeners.forEach((fn) => fn()); };
        document.getElementById('send').addEventListener('click', () => { window.__sent.push(document.getElementById('box').value); document.getElementById('box').value = ''; });
        document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store } } } };
      }, { system, uid, owner, charOwner, pre });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(300);
      return page;
    };
    const card = (page) => page.evaluate(() => { const c = document.querySelector('[data-capybara-toolkit-madness]'); return c ? { text: c.textContent.replace(/\s+/g, ' '), buttons: [...c.querySelectorAll('button[data-cmd]')].map((b) => b.dataset.cmd) } : null; });
    const set = async (page, v) => { await page.evaluate((x) => window.__setSan(x), v); await page.waitForTimeout(150); };
    // pure rule
    {
      const page = await open();
      const rule = await page.evaluate(() => { const e = window.__CCF_MADNESS__.evaluate; const r = (rec, prev, next) => { const o = e(rec, prev, next, 'D1'); return [!!o.alert, o.alert?.temporary, o.alert?.indefinite]; }; return { five: r(null, 57, 52), four: r(null, 57, 53), cumul: r({ day: 'D1', base: 57 }, 46, 45), none: r({ day: 'D1', base: 57 }, 46, 47), newDay: r({ day: 'D0', base: 100 }, 46, 45) }; });
      assert.deepEqual(rule, { five: [true, true, false], four: [false, undefined, undefined], cumul: [true, false, true], none: [false, undefined, undefined], newDay: [false, undefined, undefined] }, 'rules');
      await page.close();
    }
    // the owner: 57 → 50 (−7 at once): temporary; → 49 nothing; → 45 (cumulative 12 ≥ 57/5): indefinite; the buttons send the commands
    {
      const page = await open();
      assert.equal(await card(page), null, 'first sight of a value never alerts');
      await set(page, 50);
      let c = await card(page); assert.deepEqual(c.buttons, ['temporary', 'close']); assert.match(c.text, /탐사자.*SAN 57 → 50.*한 번에 −7/);
      await page.locator('[data-cmd="temporary"]').click();
      assert.deepEqual(await page.evaluate(() => window.__sent), ['TI'], 'the temporary-madness table command is sent by the button, not by itself'); assert.equal(await card(page), null, 'the card closes');
      await set(page, 49); assert.equal(await card(page), null, '−1 is not enough');
      await set(page, 45);
      c = await card(page); assert.deepEqual(c.buttons, ['indefinite', 'close']); assert.match(c.text, /오늘 누적 −12/);
      await page.locator('[data-cmd="indefinite"]').click(); assert.deepEqual(await page.evaluate(() => window.__sent), ['TI', 'II']);
      // after an indefinite alert the base is the new value: −7 more is not enough, −9 (≥ 1/5 of 45) is
      await set(page, 42); assert.equal(await card(page), null); await set(page, 38); assert.equal(await card(page), null, 'cumulative 7 < 9'); await set(page, 36); assert.deepEqual((await card(page)).buttons, ['indefinite', 'close'], 'cumulative 9 >= 45/5, only 2 at once');
      assert.deepEqual(page.__errors, []); await page.close();
    }
    // not a Cthulhu room: nothing; someone else's character and I am neither owner nor GM: nothing; the GM sees it
    { const page = await open({ system: 'Insane' }); await set(page, 40); assert.equal(await card(page), null, 'only Cthulhu rooms'); await page.close(); }
    { const page = await open({ charOwner: 'other' }); await set(page, 40); assert.equal(await card(page), null, 'not mine, not GM'); await page.close(); }
    { const page = await open({ charOwner: 'other', owner: 'me' }); await set(page, 40); assert.deepEqual((await card(page)).buttons, ['temporary', 'indefinite', 'close'], 'the GM sees other people\'s characters'); await page.close(); }
    // a baseline from yesterday is replaced by the first value seen today
    { const page = await open({ pre: { 'ccf-madness-v1:r1': JSON.stringify({ chars: { c1: { day: '2000-01-01', base: 100 } }, commands: {} }) } }); await set(page, 55); assert.equal(await card(page), null, '−2 against today\'s first value 57 (not yesterday\'s 100)'); await page.close(); }
    console.log('madness PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
