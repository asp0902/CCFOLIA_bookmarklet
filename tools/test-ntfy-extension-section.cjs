// 스마트폰 알림 설정은 확장 팝업에서만 한다(사용자 결정): 확장 경로(ntfy-page.js)도 북마클릿 경로(legacy ntfy)도 GM 도구 설정 탭에 구역을 등록하지 않는다.
// 다른 구역(핸드아웃·광기 발현)이 없으면 설정 탭도 없다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><header class="MuiAppBar-root"><button class="MuiIconButton-root" aria-label="내 캐릭터 목록">캐</button><button class="MuiIconButton-root" aria-label="[GM] 컷인 목록">컷</button></header><div id="root"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: read('../legacy/ccfolia-toolkit-presence.user.js') });
    await page.addScriptTag({ content: read('../extension/personal/ntfy-page.js') });
    await page.addScriptTag({ content: read('../legacy/ccfolia-ntfy.user.js') });
    await page.waitForTimeout(800);
    const ids = await page.evaluate(() => [...(window.__CCF_TOOLKIT_MENU__?.items?.values?.() || [])].map((i) => i.id));
    assert.deepEqual(ids.filter((id) => id === 'ntfy'), [], 'no ntfy item: ' + JSON.stringify(ids));
    assert.equal(await page.locator('#ccf-gm-tools [data-ccf-settings-section="ntfy"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('ntfy extension section PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
