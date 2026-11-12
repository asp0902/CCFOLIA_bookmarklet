const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 북마클릿 경로 스모크: 확장 없이 bookmarklet.js 만 실행한다. GitHub Pages 주소는 이 저장소의 로컬 파일로 연결해, 로더가 기능 스크립트를 실제로 받아 돌린다.
// 확인: 모든 항상-켜짐 기능이 로드되고(chrome.* 없이), 펭귄 메뉴에 사이코로픽션·핸드아웃·스마트폰 알림이 있고, 스마트폰 알림이 페이지 fetch 로 ntfy 에 가고, 홈 즐겨찾기가 localStorage 에 기록하고, GIF 압축 Worker 가 만들어진다.
const repo = path.join(__dirname, '..');
const bookmarklet = fs.readFileSync(path.join(repo, 'bookmarklet.js'), 'utf8').replace(/^javascript:/, '');
const PAGES = 'https://asp0902.github.io/CCFOLIA_bookmarklet/';
const roomHtml = `<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff;font:14px sans-serif">
  <span class="MuiTypography-caption">인세인</span>
  <header class="MuiAppBar-root" style="display:flex;gap:4px;padding:8px;align-items:center"><h6 class="MuiTypography-root MuiTypography-subtitle2">테스트룸<span class="MuiTypography-caption">인세인</span></h6><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button><button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button></header>
  <div role="log"><ul id="list"></ul></div>
  <form id="composer"><textarea name="text" class="MuiInputBase-input" rows="2"></textarea><input name="name" value="나"><button type="submit">전송</button><button type="button" aria-label="D100">D100</button></form></body>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await context.route(PAGES + '**', (route) => {
      const url = new URL(route.request().url());
      const file = path.join(repo, decodeURIComponent(url.pathname.replace('/CCFOLIA_bookmarklet/', '')));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      route.fulfill({ contentType: 'text/javascript; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
    });
    await context.route('https://firestore.googleapis.com/**', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    const ntfy = [];
    await context.route('https://ntfy.sh/**', (route) => {
      const request = route.request();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT, POST, PATCH, DELETE' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' });
      ntfy.push(JSON.parse(request.postData() || '{}'));
      route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"id":"x"}' });
    });
    await context.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: roomHtml }));
    await page.goto('https://ccfolia.com/rooms/test');
    assert.equal(await page.evaluate(() => typeof window.chrome?.runtime?.id), 'undefined', 'no extension in this page');
    await page.evaluate((code) => { new Function(code)(); }, bookmarklet);
    await page.waitForFunction(() => window.__CCF_NTFY_HOOK__ && window.__CCF_GIF_COMPRESS__ && window.__CCF_CHARACTER_SHEET_DEBUG__ && window.__CAPYBARA_HOME_BOOKMARKS__, null, { timeout: 40000 });
    await page.waitForSelector('[data-ccf-toolkit-menu-button]', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(1500);

    // every always-on feature is up (format-sync/handout are panel-toggled features, not always-on)
    const ready = await page.evaluate(() => ({
      chatPanel: typeof window.__CCF_SECOND_CHAT_PANEL__?.open === 'function', presence: !!window.__CAPYBARA_TOOLKIT_PRESENCE__,
      sheet: !!window.__CCF_CHARACTER_SHEET_DEBUG__, gif: !!window.__CCF_GIF_COMPRESS__, ntfy: !!window.__CCF_NTFY_HOOK__,
      menuItems: [...window.__CCF_TOOLKIT_MENU__.items.keys()].sort(), penguin: document.querySelector('[data-ccf-toolkit-menu-button]')?.previousElementSibling?.getAttribute('aria-label'),
      homeBookmarks: !!window.__CAPYBARA_HOME_BOOKMARKS__, versions: !!window.__CCF_TOOLKIT_VERSIONS__
    }));
    assert.deepEqual({ ...ready, versions: undefined }, { chatPanel: true, presence: true, sheet: true, gif: true, ntfy: true, menuItems: ['gm-settings', 'madness-settings', 'ntfy', 'saikoro'], penguin: '[GM] 컷인 목록', homeBookmarks: true, versions: undefined });

    // the home bookmarks script stores the visited room in localStorage (no chrome.storage)
    const rooms = await page.evaluate(() => JSON.parse(localStorage.getItem('capybaraRooms') || '{}'));
    assert.equal(rooms.test?.name, '테스트룸', 'the visited room is remembered in localStorage');

    // GIF compression can start its Worker from a blob (the page has no CSP)
    assert.equal(await page.evaluate(() => new Promise((resolve) => { try { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }))); w.onmessage = () => resolve('ok'); w.onerror = () => resolve('error'); setTimeout(() => resolve('timeout'), 3000); } catch (e) { resolve('blocked: ' + e.message); } })), 'ok', 'blob Worker works in the page');

    // phone push through the page: settings from the penguin menu, then a direct fetch to ntfy
    await page.locator('[data-ccf-toolkit-menu-button]').dispatchEvent('click');
    await page.locator('[data-ccf-toolkit-menu]:not([data-closing]) [role="menuitem"]', { hasText: '설정' }).dispatchEvent('click'); // the penguin opens a menu; the shared settings tab holds the ntfy settings
    await page.waitForSelector('#ccf-ntfy-dialog form');
    await page.locator('#ccf-ntfy-dialog [data-a="new"]').click();
    await page.locator('#ccf-ntfy-dialog [name="enabled"]').check();
    await page.locator('#ccf-ntfy-dialog [data-a="test"]').click();
    await page.waitForFunction(() => /테스트 알림을 보냈습니다/.test(document.querySelector('#ccf-ntfy-dialog [data-role="note"]')?.textContent || ''), null, { timeout: 8000 });
    assert.equal(ntfy.length, 1); assert.match(ntfy[0].topic, /^capy-[a-z2-7]{24}$/); assert.equal(ntfy[0].title, '카피바라 테스트 알림');
    await page.locator('#ccf-gm-tools .ccf-gt-close').click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-ntfy-v1')).enabled), true, 'the settings live in localStorage');
    // the notifier hook: only while away; own messages and the room in front are skipped
    await page.evaluate(() => { document.hasFocus = () => true; window.__CCF_NTFY_STATE__.lastInputAt = Date.now(); });
    assert.equal(await page.evaluate(() => window.__CCF_NTFY_HOOK__({ name: '하나', text: '안녕' })), false, 'looking at the room: no push');
    await page.evaluate(() => { document.hasFocus = () => false; });
    assert.equal(await page.evaluate(() => window.__CCF_NTFY_HOOK__({ name: '나', text: '내 글' })), false, 'own message: no push');
    assert.equal(await page.evaluate(() => window.__CCF_NTFY_HOOK__({ name: '하나', text: '비밀 내용' })), true);
    // the push is batched for BATCH_MS (10s) before it goes out
    for (let i = 0; i < 200 && ntfy.length < 2; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(300);
    assert.equal(ntfy.length, 2);
    assert.deepEqual({ title: ntfy[1].title, message: ntfy[1].message, click: ntfy[1].click, keys: Object.keys(ntfy[1]).sort() }, { title: '하나님 메시지 · 테스트룸', message: '새 메시지가 도착했습니다.', click: 'https://ccfolia.com/rooms/test', keys: ['click', 'message', 'tags', 'title', 'topic'] }, 'only title, short text and the room address go out');
    assert.deepEqual(errors, [], 'no page errors on the bookmarklet path');
    console.log('bookmarklet smoke PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
