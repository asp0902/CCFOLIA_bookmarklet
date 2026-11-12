const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 룸 상단 툴바의 펭귄 메뉴: "[GM] 컷인 목록" 버튼 바로 오른쪽(없으면 내 캐릭터 목록 옆)에 버튼 하나, 메뉴 항목은 사이코로픽션(인세인 룸)·핸드아웃, 개별 툴바 아이콘은 없다.
// 스크립트 로드 순서와 무관, 항목이 없으면 버튼 숨김, 유휴 변화 없음.
const legacy = path.join(__dirname, '../legacy/');
const src = (name) => fs.readFileSync(legacy + `ccfolia-${name}.user.js`, 'utf8');
const toolbar = (gm, insane) => `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">
  ${insane ? '<span class="MuiTypography-caption">인세인</span>' : '<span class="MuiTypography-caption">다른 시스템</span>'}
  <header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button>${gm ? '<button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button>' : ''}<button class="MuiIconButton-root" aria-label="설정">설</button></header></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const run = async ({ gm, insane, order }) => {
      const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: toolbar(gm, insane) }));
      await page.goto('https://ccfolia.com/rooms/test');
      for (const name of order) await page.addScriptTag({ content: src(name) });
      await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached', timeout: 8000 });
      await page.waitForTimeout(600);
      return page;
    };
    for (const order of [['handout', 'character-sheet', 'toolkit-presence'], ['toolkit-presence', 'character-sheet', 'handout'], ['character-sheet', 'toolkit-presence', 'handout']]) {
      for (const gm of [true, false]) {
        const page = await run({ gm, insane: true, order });
        const label = `${order.join('>')} ${gm ? 'GM' : 'participant'}`;
        const pos = await page.evaluate(() => { const b = document.querySelector('[data-ccf-toolkit-menu-button]'); const prev = b.previousElementSibling; return { count: document.querySelectorAll('[data-ccf-toolkit-menu-button]').length, prev: prev?.getAttribute('aria-label'), aria: b.getAttribute('aria-label'), svg: !!b.querySelector('svg path'), size: [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)], oldIcons: document.querySelectorAll('[data-ccf-handout-icon], [data-ccf-character-sheet-icon]').length }; });
        assert.equal(pos.count, 1, label + ': one penguin button');
        assert.equal(pos.prev, gm ? '[GM] 컷인 목록' : '내 캐릭터 목록', label + ': right after the cut-in list button (participants: after my characters)');
        assert.equal(pos.aria, '카피바라 도구'); assert(pos.svg); assert.equal(pos.oldIcons, 0, label + ': no separate toolbar icons');
        await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
        assert.deepEqual(await page.locator('[role="menu"] [role="menuitem"]').allTextContents(), ['사이코로픽션', '핸드아웃'], label);
        await page.locator('[data-ccf-menu-item="saikoro"]').click();
        await page.waitForSelector('#ccf-character-sheet-root .ccf-cs-dialog');
        assert.equal(await page.locator('[role="menu"]').count(), 0, label + ': the menu closes after a choice');
        await page.evaluate(() => document.getElementById('ccf-character-sheet-root').remove());
        await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
        await page.locator('[data-ccf-menu-item="handout"]').click();
        await page.waitForSelector('#ccfolia-handout-root', { state: 'attached', timeout: 5000 });
        // Esc closes the menu; idle: nothing keeps changing
        await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[role="menu"]').count(), 0, label + ': Esc closes the menu');
        const changes = await page.evaluate(() => new Promise((resolve) => { let n = 0; const root = document.querySelector('header'); const mo = new MutationObserver((r) => { n += r.length; }); mo.observe(root, { subtree: true, childList: true, attributes: true }); setTimeout(() => { mo.disconnect(); resolve(n); }, 1500); }));
        assert.equal(changes, 0, label + ': the toolbar is quiet while idle');
        assert.deepEqual(page.__errors, [], label + ' page errors');
        await page.close();
      }
    }
    // not an inSANe room: the 사이코로픽션 item is gone, the handout item stays
    const page = await run({ gm: true, insane: false, order: ['character-sheet', 'handout', 'toolkit-presence'] });
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    assert.deepEqual(await page.locator('[role="menu"] [role="menuitem"]').allTextContents(), ['핸드아웃']);
    // the only item gone (the sheet script alone in a non-inSANe room): the button hides itself
    const lonely = await run0();
    async function run0() {
      const p = await browser.newPage();
      await p.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: toolbar(true, false) }));
      await p.goto('https://ccfolia.com/rooms/test');
      for (const name of ['character-sheet', 'toolkit-presence']) await p.addScriptTag({ content: src(name) });
      await p.waitForTimeout(1200);
      return p;
    }
    const visible = await lonely.evaluate(() => { const b = document.querySelector('[data-ccf-toolkit-menu-button]'); return !b || b.hidden; });
    assert.equal(visible, true, 'no visible items: no button');
    console.log('toolkit menu PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
