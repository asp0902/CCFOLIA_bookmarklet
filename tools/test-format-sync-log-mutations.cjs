const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 채팅 목록([role=log], 추가 패널)의 줄 변화는 format-sync 의 ensureUi(문서 전체 훑기)를 부르지 않는다. 입력칸 쪽 변화는 그대로 부른다.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div role="log"><ul id="list"><li class="MuiListItem-root"><p>a</p></li></ul></div><div class="ccf-scp-panel" id="pn"><ul id="pl"></ul></div><form id="composer"><textarea name="text"></textarea><button type="submit">전송</button><button type="button">D100</button></form><div id="other"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__q = 0; const orig = Document.prototype.querySelectorAll; Document.prototype.querySelectorAll = function (...a) { if (String(a[0]).startsWith('textarea, input')) window.__q += 1; return orig.apply(this, a); }; });
    const queries = async (code) => { await page.evaluate(() => { window.__q = 0; }); await page.evaluate(code); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return page.evaluate(() => window.__q); };
    assert.equal(await queries("const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.textContent = 'new'; document.getElementById('list').append(li);"), 0, 'a new chat row does not trigger the UI sweep');
    assert.equal(await queries("document.querySelector('#list li').setAttribute('data-x', '1');"), 0, 'a row attribute change neither');
    assert.equal(await queries("document.getElementById('pl').append(document.createElement('li'));"), 0, 'nor a row of the extra panel');
    assert((await queries("document.getElementById('other').append(document.createElement('div'));")) > 0, 'a change next to the composer still triggers it');
    console.log('format-sync log mutations PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
