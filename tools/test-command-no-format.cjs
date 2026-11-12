const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 채팅 커맨드(/roll-table …)와 다이스 명령은 저장 서식(자동 서식 프리셋)·봉투 없이 원문 그대로 한 번 전송되고, 입력창 미리보기에 서식이 비치지 않는다.
// 일반 글은 기존대로 저장 서식이 적용된다. 실제 format-sync + 복제 컴포저.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS = /[\u2062\u2063\u200b\u200c\u200d\u2060]/;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div role="log"><ul id="list"></ul></div><form id="composer"><textarea name="text" class="MuiInputBase-input" rows="4"></textarea><button type="submit">전송</button><button type="button" aria-label="D100">D100</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      // a saved word format: the word 붉은단어 is turned red on its own when a message is sent
      localStorage.setItem('ccf-format-style-presets-v1', JSON.stringify([{ name: '붉은단어', style: { color: '#ff0000', bold: true }, auto: true, savedAt: 1 }]));
      window.__sends = []; window.__inputs = 0;
      const form = document.getElementById('composer'); const ta = form.querySelector('textarea');
      ta.addEventListener('input', () => { window.__inputs += 1; });
      const send = () => { const v = ta.value; if (!v.trim()) return; window.__sends.push(v); ta.value = ''; };
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.defaultPrevented) { e.preventDefault(); send(); } });
      form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(800);
    const ta = page.locator('textarea[name=text]');
    const overlayShown = () => page.evaluate(() => [...document.querySelectorAll('.ccf-editor-preview-layer')].some((o) => getComputedStyle(o).display !== 'none' && o.textContent.trim()));
    const send = async (text) => {
      await page.evaluate(() => { window.__sends.length = 0; });
      await ta.click(); await ta.fill(text);
      await page.waitForTimeout(250);
      const shownWhileTyping = await overlayShown();
      await page.evaluate(() => { window.__inputs = 0; });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__sends.length >= 1, null, { timeout: 4000 });
      await page.waitForTimeout(700);
      return { sent: await page.evaluate(() => window.__sends.slice()), inputsAfterEnter: await page.evaluate(() => window.__inputs), shownWhileTyping };
    };
    // /roll-table with the saved-format word in the body
    const table = '/roll-table\nMURDER FEED 장면표\n1D5\n1: 밖에서 붉은단어 소리가 울린다.\n2: 조용하다.';
    const a = await send(table);
    assert.deepEqual(a.sent, [table], 'sent once, exactly as typed');
    assert(!INVIS.test(a.sent[0]), 'no envelope characters');
    assert.equal(a.inputsAfterEnter, 0, 'the field was not rewritten at Enter (no setEditorText, so no flash of the formatted text)');
    assert.equal(a.shownWhileTyping, false, 'no styled preview overlay for a command');
    // other chat commands and dice commands
    for (const text of ['/roll 2d6 붉은단어', '/cc 붉은단어', 'ST', '2D6>=5 붉은단어 판정', 'CCB<=60 붉은단어']) {
      const r = await send(text);
      assert.deepEqual(r.sent, [text], `${text}: sent as typed`); assert(!INVIS.test(r.sent[0])); assert.equal(r.shownWhileTyping, false);
    }
    // an ordinary message still gets the saved word format (envelope + preview)
    const normal = await send('붉은단어가 있는 평범한 글');
    assert(INVIS.test(normal.sent[0]), 'an ordinary message carries the saved format as before');
    // the toolkit's own /desc conversion is not blocked by this rule (the bridge/format-sync handle it)
    assert.deepEqual(errors, [], 'no page errors');
    console.log('command no format PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
