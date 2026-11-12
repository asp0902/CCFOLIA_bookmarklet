const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 시트 테마 인세인: 장면표 명령의 결과 메시지를 Roll20식 카드(장식 + "장면을 열겠습니다" + 구분선, 꺾쇠 상자: 이름 / 표 이름 / 결과)로 보여 준다.
// 다른 테마·꺼짐이면 원래 글 그대로, 감정표 카드는 그대로. SCREENSHOT_DIR 이 있으면 카드 그림을 저장한다.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const rows = [
  ['st', '연갈', 'ST', '장면표(8) ＞ 구석에 놓인 낡은 인형이 이쪽을 보고 있다.'],
  ['hjst', '연갈', 'HJST', '사실은 무서운 현대 일본 장면표(2) ＞ 지하철이 멈추고 불이 꺼진다.'],
  ['mtst', '연갈', 'MTST', '광란의 20년대 장면표(11) ＞ 재즈 클럽의 무대 위, 연주자들이 일제히 이쪽을 돌아본다.'],
  ['dvst', '연갈', 'DVST', '빅토리아의 어둠 장면표(5) ＞ 안개 속에서 가스등이 하나씩 꺼진다.'],
  ['owt', '연갈', 'OWT', '야근 장면표(7) ＞ 복사기가 혼자 돌아간다.'],
  ['ja', '연갈', '', 'シーン表(6) ＞ 雨音の向こうで、誰かが名前を呼んでいる。'],
  ['plain', '연갈', '', '장면표 이야기를 나누는 평범한 메시지'],
  ['emotion', '브릿지', 'FT', '감정표(4) ＞ 충성（플러스）／모멸（마이너스）'],
];
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><style>body{background:#2b2b2b;font:14px sans-serif;color:#fff;margin:12px;width:380px}.MuiListItem-root{margin:0 0 8px}</style></head><body>${rows.map(([id, speaker, prefix, text]) => `<div class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">${speaker}<span class="MuiTypography-caption"> - 오늘 14:44</span></h6><p id="${id}" class="MuiTypography-body2">${prefix ? prefix + ' ' : ''}${text}</p></div></div>`).join('')}</body></html>` }));
    await page.goto('https://ccfolia.com/rooms/theme-test');
    await page.addScriptTag({ content: source });
    await page.waitForSelector('#ccf-theme-switcher-sheet-theme-select-panel', { state: 'attached' });
    const select = (id) => page.locator('#ccf-theme-switcher-sheet-theme-select-panel').selectOption(id, { force: true });
    const original = {}; for (const [id] of rows) original[id] = await page.locator(`#${id}`).textContent();
    // not the 인세인 theme yet: nothing is touched
    assert.equal(await page.locator('.ccf-roll20-scene-card').count(), 0);
    await select('insane-roll20');
    await page.waitForSelector('.ccf-roll20-scene-card');
    const card = async (id) => page.locator(`#${id} .ccf-roll20-scene-card`).evaluate((el) => ({
      label: el.querySelector('small')?.textContent, name: el.querySelector('.ccf-roll20-scene-name')?.textContent, text: el.querySelector('.ccf-roll20-scene-text')?.textContent,
      title: el.querySelector('.ccf-roll20-scene-title')?.textContent, svg: !!el.querySelector('.ccf-roll20-scene-orn svg path'), rule: !!el.querySelector('.ccf-roll20-scene-rule'), table: el.dataset.sceneTable, bg: getComputedStyle(el).backgroundColor }));
    const expected = {
      st: ['장면표', '구석에 놓인 낡은 인형이 이쪽을 보고 있다.'], hjst: ['사실은 무서운 현대 일본 장면표', '지하철이 멈추고 불이 꺼진다.'],
      mtst: ['광란의 20년대 장면표', '재즈 클럽의 무대 위, 연주자들이 일제히 이쪽을 돌아본다.'], dvst: ['빅토리아의 어둠 장면표', '안개 속에서 가스등이 하나씩 꺼진다.'],
      owt: ['야근 장면표', '복사기가 혼자 돌아간다.'], ja: ['シーン表', '雨音の向こうで、誰かが名前を呼んでいる。'],
    };
    for (const [id, [name, text]] of Object.entries(expected)) {
      const c = await card(id);
      assert.equal(c.name, name, `${id}: table name`); assert.equal(c.text, text, `${id}: result sentence`);
      assert.equal(c.label, '연갈', `${id}: sender label (the command prefix is not used as a name)`);
      assert.equal(c.title, '장면을 열겠습니다'); assert(c.svg, 'ornament drawn as SVG'); assert(c.rule, 'divider under the title'); assert.equal(c.bg, 'rgb(255, 255, 255)');
      assert.equal(await page.locator(`#${id} .ccf-roll20-scene-card`).count(), 1, 'one card per message');
      assert.doesNotMatch(c.text, /\(\d+\)/, 'the dice value is not shown');
    }
    // the original text is only hidden (React-safe): still there, the card is appended last
    assert.equal(await page.locator('#st').evaluate((p) => p.firstChild.nodeType === 3 && p.lastElementChild.classList.contains('ccf-roll20-scene-card')), true);
    assert.equal(await page.locator('#st').evaluate((p) => getComputedStyle(p.firstChild.parentElement).fontSize), '0px');
    // ordinary text and the emotion table card are unaffected
    assert.equal(await page.locator('#plain .ccf-roll20-emotion-card').count(), 0);
    assert.equal(await page.locator('#emotion .ccf-roll20-emotion-card').textContent(), '브릿지충성(플러스) / 모멸(마이너스)');
    assert.equal(await page.locator('#emotion .ccf-roll20-scene-card').count(), 0);
    // the card has the four corner brackets (same technique as the emotion card)
    const brackets = await page.locator('#st .ccf-roll20-scene-box').evaluate((el) => [getComputedStyle(el, '::before').backgroundImage.split('linear-gradient').length - 1, getComputedStyle(el, '::after').backgroundSize]);
    assert.equal(brackets[0], 4); assert.equal(brackets[1].split(',').length, 4);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'insane-scene-card.png'), fullPage: true });
    // a changed message is redrawn once, not duplicated
    await page.locator('#st').evaluate((p) => { p.firstChild.nodeValue = 'ST 장면표(3) ＞ 새 결과'; });
    await page.waitForFunction(() => document.querySelector('#st .ccf-roll20-scene-text')?.textContent === '새 결과');
    assert.equal(await page.locator('#st .ccf-roll20-scene-card').count(), 1);
    // other theme / off: the original text is back and no card is left
    await select('cree-grrr');
    await page.waitForFunction(() => !document.querySelector('.ccf-roll20-scene-card'));
    assert.equal(await page.locator('#hjst').textContent(), original.hjst);
    await select('insane-roll20');
    await page.waitForSelector('#hjst .ccf-roll20-scene-card');
    await page.locator('#ccf-theme-switcher-unsung-duet-toggle').dispatchEvent('click');
    await page.waitForFunction(() => !document.querySelector('.ccf-roll20-scene-card'));
    assert.equal(await page.locator('#mtst').textContent(), original.mtst);
    assert.deepEqual(errors, [], 'no page errors');
    console.log('insane scene card PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
