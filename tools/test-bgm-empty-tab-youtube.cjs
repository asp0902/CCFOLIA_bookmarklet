// chat-notifier 0.3.43: a YouTube URL put into the sound library's "외부 파일 URL" field shows up in the list at once, also on a tab with no native sound yet
// (the default BGM01 tab of a fresh library, a second BGM tab, a tab the user added with "+"). Measured in the test room: the field's nearest container is a small Paper
// without a list and the drawer text has "BGM01" (no \bBGM\b), so the rows had nowhere to go until a native file was added. An mp3 URL is left to CCFOLIA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8');
// the sound library drawer as measured (MuiDrawer-modal > Drawer paper > tabs, list with the empty hint, a Paper with the URL form)
// (data-ccf-bgm-dialog-root="1": measured on the real page - the notifier marks the drawer when it is opened from the BGM button)
const drawer = (tabs) => `<div class="MuiDrawer-root MuiDrawer-modal MuiModal-root" role="presentation" data-ccf-bgm-dialog-root="1" style="position:fixed;inset:0">
  <div class="MuiPaper-root MuiPaper-elevation16 MuiDrawer-paper" style="position:absolute;left:100px;top:40px;width:700px;height:600px;background:#333;color:#fff;display:flex;flex-direction:column">
    <div><button class="MuiButton-root">업로드</button><button class="MuiButton-root">라이브러리</button></div>
    <div class="MuiTabs-root"><div role="tablist">${tabs.map((t, i) => `<button class="MuiTab-root" role="tab" aria-selected="${i === tabs.sel}">${t}</button>`).join('')}<button aria-label="add">+</button></div></div>
    <ul class="MuiList-root MuiList-padding" style="flex:1;min-height:116px"><li class="MuiListItem-root">드래그 앤 드롭으로 파일을 추가 할 수 있습니다.</li></ul>
    <div class="MuiPaper-root MuiPaper-elevation6"><form id="urlform" autocomplete="off"><div class="MuiFormControl-root MuiTextField-root"><label class="MuiFormLabel-root">외부 파일 URL</label><div class="MuiInputBase-root"><input id="url" type="text" placeholder="https://..."></div></div><button type="submit" aria-label="外部ファイルを追加">+</button></form><p>지정한 URL의 파일에 직접 연결합니다</p></div>
  </div></div>`;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const run = async (label, tabs, sel) => {
      tabs.sel = sel;
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset=utf-8><body style="background:#222"><header style="position:fixed;top:0;left:0;z-index:2000"><button id="player1" class="MuiButton-root">BGM01</button></header><div id="root"></div>${drawer(tabs)}</body>` }));
      await page.route(/youtube|ytimg|noembed/, (r) => r.fulfill({ status: 404, body: '' }));
      await page.goto('https://ccfolia.com/rooms/test');
      // CCFOLIA's own handler of the form (adds an external file): counted, and it clears the field like the real one
      await page.evaluate(() => { window.__native = []; document.getElementById('urlform').addEventListener('submit', (e) => { e.preventDefault(); window.__native.push(document.getElementById('url').value); document.getElementById('url').value = ''; }); });
      await page.addScriptTag({ content: source });
      await page.waitForTimeout(800);
      // the library is opened from the room's BGM player button (BGM01): that is what tells the notifier which player the YouTube entry belongs to
      await page.locator('#player1').click(); await page.waitForTimeout(200);
      const add = async (url) => { await page.locator('#url').click(); await page.locator('#url').fill(url); await page.keyboard.press('Enter'); await page.waitForTimeout(700); };
      await add('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const rows = await page.evaluate(() => [...document.querySelectorAll('.ccf-youtube-bgm-row-wrap')].map((r) => ({ inList: !!r.closest('.MuiDrawer-paper > .MuiList-root'), h: Math.round(r.getBoundingClientRect().height) })));
      assert.equal(rows.length, 1, `${label}: one YouTube row right away (${JSON.stringify(rows)})`);
      assert(rows[0].inList && rows[0].h > 0, `${label}: drawn in the library list`);
      assert.deepEqual(await page.evaluate(() => window.__native), [], `${label}: CCFOLIA did not also add it as an external file`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.MuiDrawer-paper > .MuiList-root > .MuiListItem-root:not(.ccf-youtube-bgm-row-wrap *)')).display), 'none', `${label}: the empty-library hint is hidden`);
      // the same video again on the same tab: still one row
      await add('https://youtu.be/dQw4w9WgXcQ');
      assert.equal(await page.locator('.ccf-youtube-bgm-row-wrap').count(), 1, `${label}: the same video twice stays one row`);
      // an mp3 URL is CCFOLIA's: passed through, no row of ours
      await add('https://example.test/music.mp3');
      assert.deepEqual(await page.evaluate(() => window.__native), ['https://example.test/music.mp3'], `${label}: mp3 goes to CCFOLIA`);
      assert.equal(await page.locator('.ccf-youtube-bgm-row-wrap').count(), 1, `${label}: still one row`);
      assert.deepEqual(errors, [], `${label}: no page errors`);
      await page.close();
    };
    await run('default BGM01 tab of a fresh library', ['BGM01', 'BGM02', 'SE01', 'ETC'], 0);
    await run('second BGM tab', ['효과음', 'BGM', 'BGM', 'MURDER FEED'], 2);
    await run('tab added with +', ['효과음', 'BGM', 'BGM', 'MURDER FEED'], 3);
    console.log('bgm empty tab youtube PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
