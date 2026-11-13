const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// 나레이션 적용 상태(화자가 나레이션 캐릭터)에서도 커맨드(/roll-table 여러 줄, ST, 2D6)는 봉투·나레이션 없이 원문 그대로 1회 전송된다.
// 오리지널 채팅 입력(실제 format-sync) × 전송 버튼 클릭 / Enter.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const TABLE = '/roll-table\n괴담 장면표\n1D3\n1 첫째\n2 둘째\n3 셋째';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif"><div id="root"></div><form id="composer" style="position:fixed;left:20px;bottom:20px;width:420px"><input name="name" value="서술자"><textarea name="text" rows="3" style="width:100%"></textarea><button type="submit">전송</button></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__sent = [];
      document.getElementById('composer').addEventListener('submit', (e) => { e.preventDefault(); window.__sent.push(document.querySelector('#composer textarea').value); });
      localStorage.setItem('ccf-format-narrators-v1:test', JSON.stringify(['서술자'])); // the speaker is a narrator: automatic narration is on
      // the room's cut-ins (CCFOLIA plays one when a message ends with its name)
      const state = { app: { state: { roomId: 'test' } }, entities: { roomEffects: { ids: ['e1'], entities: { e1: { name: '폭발', imageUrl: null, soundUrl: null } } } } };
      document.getElementById('root')['__reactContainer$t'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    });
    await page.addScriptTag({ content: source });
    await page.locator('.ccf-inline-toolbar').first().waitFor({ state: 'attached', timeout: 8000 });
    const setText = (text) => page.evaluate((t) => { const ta = document.querySelector('#composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true })); }, text);
    const envelope = /[​-‏⁠-⁯﻿᠎]/;
    for (const [label, text] of [['multi-line /roll-table', TABLE], ['scene table ST', 'ST'], ['dice 2D6', '2D6'], ['secret dice S2D6>=5 [소각]', 'S2D6>=5 [소각]']]) {
      for (const how of ['click', 'enter']) {
        await page.evaluate(() => { window.__sent.length = 0; });
        await setText(text);
        if (how === 'click') await page.locator('#composer button[type=submit]').dispatchEvent('click');
        else await page.evaluate(() => document.querySelector('#composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
        await page.waitForTimeout(120);
        const sent = await page.evaluate(() => window.__sent.slice());
        const value = await page.evaluate(() => document.querySelector('#composer textarea').value);
        if (how === 'click') { assert.deepEqual(sent, [text], `${label} (${how}): sent as it is, once`); }
        assert.equal(envelope.test(value), false, `${label} (${how}): no invisible envelope in the box (${JSON.stringify(value)})`);
        assert.equal(value, text, `${label} (${how}): the box keeps the raw command`);
      }
    }
    // an envelope already sitting in the box (earlier formatting / narration state / a macro expansion) is taken off: the command still goes out as it is
    const ENV = '⁣⁣⁣' + '​‌‍⁠'.repeat(20) + '⁢⁢⁢';
    for (const [label, text] of [['/roll-table', TABLE], ['ST', 'ST'], ['2D6', '2D6']]) {
      await page.evaluate(() => { window.__sent.length = 0; });
      await setText(text + ENV);
      await page.locator('#composer button[type=submit]').dispatchEvent('click');
      await page.waitForTimeout(120);
      assert.deepEqual(await page.evaluate(() => window.__sent.slice()), [text], label + ' with an envelope in the box: sent without it');
    }
    // a cut-in trigger (the message ends with the cut-in's name) goes out without the narration envelope, so CCFOLIA plays the cut-in; other text keeps the narration
    for (const [label, text, raw] of [['ends with the cut-in name', '쾅! 폭발', true], ['only the cut-in name', '폭발', true], ['name in the middle', '폭발 직전이다', false]]) {
      await page.evaluate(() => { window.__sent.length = 0; });
      await setText(text);
      await page.locator('#composer button[type=submit]').dispatchEvent('click');
      await page.waitForTimeout(150);
      const sent = await page.evaluate(() => window.__sent.slice());
      assert.equal(sent.length, 1, label + ': sent once');
      assert.equal(envelope.test(sent[0]), !raw, `${label}: ${raw ? 'no envelope' : 'narration envelope kept'} (${JSON.stringify(sent[0].slice(0, 20))})`);
    }
    assert.deepEqual(errors, [], 'no page errors');
    console.log('command in narration (original panel) PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
