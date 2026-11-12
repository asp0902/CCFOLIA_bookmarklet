const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 채팅 커맨드 모달의 '내 매크로' 버튼(.ccf-sm-toolbar-btn)은 평소 바탕색이 없고(투명), 올리면 옅게만 칠해진다. 관리 모달 헤더의 같은 클래스 버튼도 같은 모양.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-slash-macros.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#333;color:#fff"><div id="host" style="padding:20px"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('host').innerHTML = '<button id="a" class="ccf-sm-toolbar-btn" type="button">내 매크로</button><div id="ccf-sm-modal-fake"><div class="ccf-sm-modal-head"><button id="b" class="ccf-sm-toolbar-btn" type="button">관리</button></div></div>'; });
    const bg = (id) => page.locator(`#${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(await bg('a'), 'rgba(0, 0, 0, 0)', 'no fill at rest');
    assert.equal(await bg('b'), 'rgba(0, 0, 0, 0)', 'the management modal header button looks the same');
    assert.equal(await page.locator('#a').evaluate((el) => getComputedStyle(el).color), 'rgb(255, 255, 255)', 'text colour inherited');
    await page.locator('#a').hover();
    assert.equal(await bg('a'), 'rgba(255, 255, 255, 0.08)', 'a faint fill on hover');
    // the wording: the button injected into the chat-commands dialog, its title, the management modal and its empty list all say 커스텀 커맨드
    await page.evaluate(() => { document.getElementById('host').innerHTML = '<div class="MuiDialog-root" role="dialog"><div class="MuiDialogTitle-root"><h2>채팅 커맨드에 대해</h2></div><div class="MuiDialogContent-root">/roll /desc /cc roll-table</div></div>'; });
    await page.waitForSelector('.MuiDialog-root .ccf-sm-toolbar-btn', { timeout: 5000 });
    assert.equal(await page.locator('.MuiDialog-root .ccf-sm-toolbar-btn').textContent(), '커스텀 커맨드');
    assert.equal(await page.locator('.MuiDialog-root .ccf-sm-toolbar-btn').getAttribute('title'), '커스텀 커맨드 관리');
    await page.locator('.MuiDialog-root .ccf-sm-toolbar-btn').click();
    await page.waitForSelector('.ccf-sm-modal-head strong');
    assert.equal(await page.locator('.ccf-sm-modal-head strong').first().textContent(), '커스텀 커맨드');
    assert.match(await page.locator('.ccf-sm-modal-empty').first().textContent(), /저장된 커스텀 커맨드가 없습니다/);
    const visible = await page.evaluate(() => document.documentElement.innerText);
    assert(!/내 매크로|슬래시 매크로/.test(visible), 'no old name left on screen');
    console.log('slash macro button PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
