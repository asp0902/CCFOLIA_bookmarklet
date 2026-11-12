const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 룸 상단 툴바의 펭귄 버튼("GM 도구"): "[GM] 컷인 목록" 버튼 바로 오른쪽(없으면 내 캐릭터 목록 옆), 클릭하면 "GM 도구" 창이 열리고 탭 = 사이코로픽션(인세인 룸)·핸드아웃(·스마트폰 알림 등록 시).
// 각 기능은 mount(container)/unmount() 로 탭 본문에 그려지고, 탭을 바꾸면 이전 탭은 정리된다. 마지막 탭 기억, 탭이 하나면 탭 줄 없음, 스크립트 로드 순서와 무관, 항목이 없으면 버튼 숨김, 유휴 변화 없음.
const legacy = path.join(__dirname, '../legacy/');
const src = (name) => fs.readFileSync(legacy + `ccfolia-${name}.user.js`, 'utf8');
const toolbar = (gm, insane) => `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">
  ${insane ? '<span class="MuiTypography-caption">인세인</span>' : '<span class="MuiTypography-caption">다른 시스템</span>'}
  <header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button>${gm ? '<button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button>' : ''}<button class="MuiIconButton-root" aria-label="기타">기</button></header>
  <div id="root"></div></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const run = async ({ gm, insane, order }) => {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.__errors = errors;
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: toolbar(gm, insane) }));
      await page.goto('https://ccfolia.com/rooms/test');
      for (const name of order) await page.addScriptTag({ content: src(name) });
      await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached', timeout: 8000 });
      await page.waitForTimeout(600);
      return page;
    };
    const tabs = (page) => page.locator('#ccf-gm-tools .ccf-gt-tab').allTextContents();
    for (const order of [['handout', 'character-sheet', 'toolkit-presence'], ['toolkit-presence', 'character-sheet', 'handout'], ['character-sheet', 'toolkit-presence', 'handout']]) {
      for (const gm of [true, false]) {
        const page = await run({ gm, insane: true, order });
        const label = `${order.join('>')} ${gm ? 'GM' : 'participant'}`;
        const pos = await page.evaluate(() => { const b = document.querySelector('[data-ccf-toolkit-menu-button]'); const prev = b.previousElementSibling; return { count: document.querySelectorAll('[data-ccf-toolkit-menu-button]').length, prev: prev?.getAttribute('aria-label'), aria: b.getAttribute('aria-label'), title: b.title, svg: !!b.querySelector('svg path'), oldIcons: document.querySelectorAll('[data-ccf-character-sheet-icon], [data-ccf-handout-icon]').length }; });
        assert.equal(pos.count, 1, label + ': one penguin button');
        assert.equal(pos.prev, gm ? '[GM] 컷인 목록' : '내 캐릭터 목록', label + ': right after the cut-in list button (participants: after my characters)');
        assert.deepEqual([pos.aria, pos.title], ['GM 도구', 'GM 도구'], label + ': tooltip'); assert(pos.svg); assert.equal(pos.oldIcons, 0, label + ': no separate toolbar icons');
        // click → one window titled GM 도구 with two tabs; the last tab (default: the first) is shown
        await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
        await page.waitForSelector('#ccf-gm-tools .ccf-gt-window');
        assert.equal(await page.locator('#ccf-gm-tools .ccf-gt-window > header > h2').textContent(), 'GM 도구'); assert.equal(await page.locator('[role="menu"]').count(), 0, label + ': no menu any more');
        assert.deepEqual(await tabs(page), ['사이코로픽션', '핸드아웃'], label);
        await page.waitForSelector('#ccf-gm-tools .ccf-gt-body #ccf-character-sheet-root .ccf-cs-dialog');
        assert.equal(await page.evaluate(() => document.querySelector('#ccf-gm-tools .ccf-gt-tab[aria-selected="true"]').textContent), '사이코로픽션', label + ': first tab');
        const look = await page.evaluate(() => { const w = document.querySelector('#ccf-gm-tools .ccf-gt-window'), c = getComputedStyle(w), t = getComputedStyle(w.querySelector(':scope > header > h2')), tab = document.querySelector('#ccf-gm-tools .ccf-gt-tab[aria-selected="true"]'); return { bg: c.backgroundColor, radius: c.borderTopLeftRadius, title: [t.fontSize, t.fontWeight], backdrop: !!document.querySelector('#ccf-gm-tools .ccf-gt-backdrop'), indicator: getComputedStyle(tab, '::after').backgroundColor, sheetInside: !!w.querySelector('.ccf-gt-body > #ccf-character-sheet-root'), standalone: document.querySelectorAll('body > #ccf-character-sheet-root').length }; });
        assert.deepEqual(look, { bg: 'rgba(44, 44, 44, 0.87)', radius: '4px', title: ['20px', '700'], backdrop: false, indicator: 'rgb(33, 150, 243)', sheetInside: true, standalone: 0 }, label + ': CCFOLIA dialog look, blue tab underline, the sheet is inside the window');
        // switching tabs: the sheet is taken away (unmount), the handout appears inside the window
        await page.locator('#ccf-gm-tools .ccf-gt-tab', { hasText: '핸드아웃' }).dispatchEvent('click');
        await page.waitForSelector('#ccf-gm-tools .ccf-gt-body #ccfolia-handout-root', { state: 'attached', timeout: 5000 });
        assert.equal(await page.locator('#ccf-character-sheet-root').count(), 0, label + ': the sheet tab was cleaned up');
        assert.equal(await page.evaluate(() => { const panel = document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('.panel'); const body = document.querySelector('#ccf-gm-tools .ccf-gt-body').getBoundingClientRect(), r = panel.getBoundingClientRect(); return Math.abs(r.width - body.width) < 2 && Math.abs(r.height - body.height) < 2; }), true, label + ': the handout panel fills the tab body');
        await page.locator('#ccf-gm-tools .ccf-gt-tab', { hasText: '사이코로픽션' }).dispatchEvent('click');
        await page.waitForSelector('#ccf-gm-tools .ccf-gt-body #ccf-character-sheet-root .ccf-cs-dialog');
        assert.equal(await page.locator('#ccfolia-handout-root').count(), 0, label + ': the handout tab was cleaned up');
        // the last tab is remembered, Esc and ✕ close the window
        await page.locator('#ccf-gm-tools .ccf-gt-tab', { hasText: '핸드아웃' }).dispatchEvent('click');
        await page.waitForSelector('#ccf-gm-tools #ccfolia-handout-root', { state: 'attached' });
        await page.locator('#ccf-gm-tools .ccf-gt-close').dispatchEvent('click');
        assert.equal(await page.locator('#ccf-gm-tools').count(), 0, label + ': ✕ closes the window'); assert.equal(await page.locator('#ccfolia-handout-root').count(), 0);
        await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
        await page.waitForSelector('#ccf-gm-tools #ccfolia-handout-root', { state: 'attached' });
        assert.equal(await page.evaluate(() => document.querySelector('#ccf-gm-tools .ccf-gt-tab[aria-selected="true"]').textContent), '핸드아웃', label + ': reopens on the last tab');
        await page.locator('#ccf-gm-tools .ccf-gt-window').focus().catch(() => {});
        await page.evaluate(() => document.querySelector('#ccf-gm-tools .ccf-gt-window').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
        assert.equal(await page.locator('#ccf-gm-tools').count(), 0, label + ': Esc closes the window');
        // code paths that opened the sheet on its own open the window's sheet tab: the registry API
        await page.evaluate(() => window.__CCF_TOOLKIT_MENU__.openTool('saikoro'));
        await page.waitForSelector('#ccf-gm-tools .ccf-gt-body #ccf-character-sheet-root .ccf-cs-dialog');
        await page.evaluate(() => window.__CCF_TOOLKIT_MENU__.closeTool());
        assert.equal(await page.locator('#ccf-gm-tools').count(), 0);
        const changes = await page.evaluate(() => new Promise((resolve) => { let n = 0; const root = document.querySelector('header'); const mo = new MutationObserver((r) => { n += r.length; }); mo.observe(root, { subtree: true, childList: true, attributes: true, characterData: true }); setTimeout(() => { mo.disconnect(); resolve(n); }, 1500); }));
        assert.equal(changes, 0, label + ': the toolbar is quiet while idle');
        assert.deepEqual(page.__errors, [], label + ' page errors');
        await page.close();
      }
    }
    // not an inSANe room: no 사이코로픽션 tab; one tab left → no tab strip, just the handout
    const page = await run({ gm: true, insane: false, order: ['character-sheet', 'handout', 'toolkit-presence'] });
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    await page.waitForSelector('#ccf-gm-tools #ccfolia-handout-root', { state: 'attached', timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelector('#ccf-gm-tools .ccf-gt-tabs').hidden), true, 'one visible tab: no tab strip');
    // the bookmarklet's 스마트폰 알림 item is a tab too (its settings are drawn into the tab body)
    await page.addScriptTag({ content: src('ntfy') });
    await page.waitForFunction(() => [...document.querySelectorAll('#ccf-gm-tools .ccf-gt-tab')].length === 2, null, { timeout: 4000 });
    await page.locator('#ccf-gm-tools .ccf-gt-tab', { hasText: '스마트폰 알림' }).dispatchEvent('click');
    await page.waitForSelector('#ccf-gm-tools .ccf-gt-body #ccf-ntfy-dialog form');
    assert.equal(await page.locator('#ccfolia-handout-root').count(), 0, 'the handout tab was cleaned up');
    await page.locator('#ccf-gm-tools .ccf-gt-close').dispatchEvent('click');
    assert.equal(await page.locator('#ccf-ntfy-dialog').count(), 0, 'closing the window removes the ntfy settings');
    // the other ways to open a sheet (the edit dialog's button) open the window's sheet tab too, for that character
    const edit = await run({ gm: true, insane: true, order: ['character-sheet', 'handout', 'toolkit-presence'] });
    await edit.evaluate(() => {
      window.__nativeClosed = 0;
      const dialog = document.createElement('div'); dialog.className = 'MuiDialog-root'; dialog.setAttribute('role', 'dialog'); dialog.style.cssText = 'position:fixed;left:20px;top:200px;width:560px;background:#333';
      dialog.innerHTML = '<div class="MuiAppBar-root"><div class="MuiToolbar-root" style="display:flex"><h6 class="MuiTypography-root MuiTypography-h6">캐릭터 편집</h6><div style="flex:1"></div><button class="MuiIconButton-root" id="native-close" aria-label="닫기">X</button></div></div><div><input name="name" value="연갈"><textarea name="memo">메모</textarea></div>';
      document.body.append(dialog);
      document.getElementById('native-close').addEventListener('click', () => { window.__nativeClosed++; });
    });
    await edit.waitForSelector('[data-ccf-character-sheet-dialog-button]', { state: 'attached', timeout: 8000 });
    await edit.locator('[data-ccf-character-sheet-dialog-button]').dispatchEvent('click');
    await edit.waitForSelector('#ccf-gm-tools .ccf-gt-body #ccf-character-sheet-root .ccf-cs-dialog.is-editor', { timeout: 5000 });
    assert.equal(await edit.locator('#ccf-gm-tools #ccf-cs-title').textContent(), '연갈', 'the edit dialog button shows that character\'s sheet in the GM tools window');
    assert.equal(await edit.locator('body > #ccf-character-sheet-root').count(), 0, 'no separate sheet window');
    await edit.waitForFunction(() => window.__nativeClosed === 1, null, { timeout: 4000 });
    assert.equal(await edit.locator('#ccf-gm-tools .ccf-gt-window').count(), 1, 'the window stays after the native edit dialog is closed');
    assert.equal(await edit.locator('#ccf-gm-tools [data-action="close"]').evaluate((b) => getComputedStyle(b).display), 'none', 'the sheet has no close button of its own inside the window');
    // the only item gone (the sheet script alone in a non-inSANe room): the button hides itself
    const lonely = await (async () => {
      const p = await browser.newPage();
      await p.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: toolbar(true, false) }));
      await p.goto('https://ccfolia.com/rooms/test');
      for (const name of ['character-sheet', 'toolkit-presence']) await p.addScriptTag({ content: src(name) });
      await p.waitForTimeout(1200);
      return p;
    })();
    const hidden = await lonely.evaluate(() => { const b = document.querySelector('[data-ccf-toolkit-menu-button]'); return !b || b.hidden; });
    assert.equal(hidden, true, 'no visible items: no button');
    console.log('toolkit menu PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
