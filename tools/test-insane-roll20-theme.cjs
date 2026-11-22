const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
const key = 'ccf-theme-switcher-settings-v1';

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <!doctype html><html><head><style>
      body { background:#444;font:14px sans-serif;color:white;margin:24px }
      .MuiDialog-paper,.ccf-cs-dialog { background:rgb(40,40,40);padding:16px;margin:16px 0 }
      .MuiAppBar-root,header { padding:12px;background:#333 }
      #ccf-character-sheet-root .ccf-cs-dialog>header { background:#212121!important }
      input,button { font:inherit;padding:8px }
      .ccf-cs-skill.is-selected { background:#777 }
      </style></head><body>
      <section class="MuiDialog-paper"><header class="MuiAppBar-root">Character</header>
      <div class="MuiDialogContent-root"><p class="MuiTypography-root">Native dialog</p>
      <div class="MuiInputBase-root"><input class="MuiInputBase-input" value="Name"></div>
      <button class="MuiButton-textPrimary">Apply</button></div></section>
      <div id="ccf-character-sheet-root"><section class="ccf-cs-dialog is-editor">
      <header>inSANe</header><main><div class="ccf-cs-section-head"><h3>Skills</h3></div>
      <div class="ccf-cs-skill is-selected is-fear"><input type="checkbox" checked><button>Fear</button></div>
      </main></section></div><div id="unrelated">Unrelated content</div>
      <div class="MuiListItem-root"><div class="MuiListItemText-root">
      <h6 class="MuiListItemText-primary">브릿지<span class="MuiTypography-caption"> - 오늘 14:44</span></h6>
      <p id="emotion" class="MuiTypography-body2">FT<span> 감정표(4) ＞ 충성（플러스）／모멸（마이너스）</span></p>
      <p id="ordinary" class="MuiTypography-body2">일반 메시지</p>
      </div></div></body></html>` }));
    const load = async () => {
      await page.goto('https://ccfolia.com/rooms/theme-test');
      await page.addScriptTag({ content: source });
      await page.waitForSelector('#ccf-theme-switcher-sheet-theme-select-panel', { state: 'attached' });
    };
    const selected = () => page.locator('html').getAttribute('data-ccf-dicebot');
    const color = (selector, property = 'backgroundColor') => page.locator(selector).evaluate((el, prop) => getComputedStyle(el)[prop], property);
    const select = id => page.locator('#ccf-theme-switcher-sheet-theme-select-panel').selectOption(id, { force: true });
    await load();
    assert.equal(await selected(), null);
    assert.equal(await page.locator('option[value="insane-roll20"]').textContent(), '인세인', 'the sheet theme is shown as 인세인 (id and behaviour unchanged)');
    assert.equal(await page.locator('#ccf-theme-switcher-panel .ccf-theme-title strong, .ccf-theme-title strong').first().textContent(), '테마', 'the card title is 테마, not CCF Theme');
    const before = await color('.MuiDialog-paper');
    const beforeCs = await color('.ccf-cs-dialog');
    const beforeHeader = await color('.ccf-cs-dialog > header');
    const beforeSkill = await color('.ccf-cs-skill button', 'color');
    const unrelated = await color('#unrelated', 'color');
    await select('insane-roll20');
    assert.equal(await selected(), 'insane-roll20');
    assert.equal(await page.locator('#emotion .ccf-roll20-emotion-card').textContent(), '브릿지충성(플러스) / 모멸(마이너스)');
    assert.equal(await page.locator('#ordinary .ccf-roll20-emotion-card').count(), 0);
    assert.equal(await color('.ccf-roll20-emotion-card'), 'rgb(255, 255, 255)');
    assert.equal(await color('.MuiDialog-paper'), before, 'colours stay native');
    assert.equal(await color('.ccf-cs-dialog'), beforeCs);
    assert.equal(await color('.ccf-cs-dialog > header'), beforeHeader);
    assert.equal(await color('.ccf-cs-skill button', 'color'), beforeSkill);
    assert.equal(await color('#unrelated', 'color'), unrelated);
    assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).selectedSheetTheme, key), 'insane-roll20');
    await load();
    assert.equal(await selected(), 'insane-roll20', 'selection survives reload');
    await page.locator('#ccf-theme-switcher-unsung-duet-toggle').dispatchEvent('click');
    assert.equal(await selected(), null, 'master switch disables theme');
    assert.equal(await page.locator('.ccf-roll20-emotion-card').count(), 0);
    assert.equal(await page.locator('#emotion').textContent(), 'FT 감정표(4) ＞ 충성（플러스）／모멸（마이너스）');
    assert.equal(await color('.MuiDialog-paper'), before);
    await page.locator('#ccf-theme-switcher-unsung-duet-toggle').dispatchEvent('click');
    assert.equal(await selected(), 'insane-roll20');
    for (const id of ['unsung-duet', 'cree-grrr', 'none']) {
      await select(id);
      assert.equal(await selected(), id === 'none' ? null : id);
    }
    assert.equal(await color('.MuiDialog-paper'), before, 'default restores native appearance');
    await select('insane-roll20');
    await page.evaluate(() => {
      document.querySelector('#emotion > span:not(.ccf-roll20-emotion-card)').firstChild.data = ' 감정표(1) > 공감(플러스) / 불신(마이너스)';
    });
    await page.waitForFunction(() => document.querySelector('.ccf-roll20-emotion-card')?.textContent.includes('공감'));
    assert.equal(await page.locator('.ccf-roll20-emotion-card').count(), 1, 'message edits update without duplicate cards');
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await color('.MuiDialog-paper'), before, 'colours stay native');
      assert.equal(await color('.ccf-roll20-emotion-card', 'fontSize'), '15px');
      assert.equal(await color('.ccf-roll20-emotion-card > small', 'fontSize'), '11px');
      assert.equal(await color('.ccf-roll20-emotion-card > small', 'marginBottom'), '5px');
      assert.equal(await color('.ccf-roll20-emotion-card', 'paddingTop'), '21px');
      assert.equal(await color('.ccf-roll20-emotion-card', 'paddingBottom'), '21px');
      assert(await page.locator('.ccf-roll20-emotion-card').evaluate(el => el.scrollWidth <= el.clientWidth));
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `insane-theme-${viewport.width}.png`) });
    }
    await page.evaluate(() => { document.querySelector('#emotion').firstChild.data = '일반 메시지'; document.querySelector('#emotion > span:not(.ccf-roll20-emotion-card)').remove(); });
    await page.waitForFunction(() => !document.querySelector('.ccf-roll20-emotion-card'));
    const checkText = '2D6>=5 시간 (2D6>=5) ＞ 10[4,6] ＞ 10 ＞ 성공';
    const setCheck = text => page.evaluate(text => {
      let host = document.querySelector('#check');
      if (!host) { host = document.createElement('p'); host.id = 'check'; host.className = 'MuiTypography-body2'; document.querySelector('#emotion').parentElement.appendChild(host); }
      if (host.firstChild) host.firstChild.textContent = text;
      else host.appendChild(document.createTextNode(text));
    }, text);
    await setCheck(checkText);
    await page.waitForSelector('.ccf-roll20-check-card');
    assert.equal(await page.locator('.ccf-roll20-check-skill').textContent(), '시간');
    assert.equal(await page.locator('.ccf-roll20-die b').allTextContents().then(x => x.join(',')), '10,4,6');
    assert.equal(await page.locator('.ccf-roll20-check-target').textContent(), '목표치 5');
    assert.deepEqual(await page.locator('.ccf-roll20-check-dice > span:last-child .ccf-roll20-die').evaluateAll((d) => d.map((e) => e.className.replace('ccf-roll20-die', '').trim())), ['', 'is-six'], 'a face of 6 is gold (is-six), 1 red (is-one)');
    assert.equal(await page.locator('.ccf-roll20-check-target b').textContent(), '5', 'only the target number bold');
    assert.equal(await page.locator('.ccf-roll20-check-card > small').textContent(), '브릿지');
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.locator('#check').evaluate(el => { el.style.maxWidth = '320px'; });
      assert(await page.locator('.ccf-roll20-check-card').evaluate(el => el.scrollWidth <= el.clientWidth));
      if (process.env.SCREENSHOT_DIR) await page.locator('.ccf-roll20-check-card').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `insane-check-${viewport.width}.png`) });
    }
    for (const result of ['실패', '스페셜', '펌블']) {
      await setCheck(`2D6+1>=7 긴 특기 이름 (2D6+1>=7) > 4[2,2]+1 > 5 > ${result}`);
      await page.waitForFunction(result => document.querySelector('.ccf-roll20-check-result')?.textContent === result, result);
      assert.equal(await page.locator('.ccf-roll20-check-card').count(), 1);
      assert.equal(await page.locator('.ccf-roll20-die.is-total').textContent(), '5');
    }
    // theme-switcher 0.2.49: the real BCDice Insane:Korean output (bcdice.onlinesession.app, 2026-11-22) - fumble / special carry a note in parentheses
    for (const [text, result, note, dice] of [
      ['2D6>=6 [제육감] (2D6>=6) ＞ 2[1,1] ＞ 2 ＞ 펌블(판정실패。 덱에서 【광기】를 1장 획득)', '펌블', '판정실패。 덱에서 【광기】를 1장 획득', ['1', '1']],
      ['2D6>=6 [제육감] (2D6>=6) ＞ 12[6,6] ＞ 12 ＞ 스페셜(판정성공。 【생명력】 1점이나 【이성치】 1점 회복)', '스페셜', '판정성공。 【생명력】 1점이나 【이성치】 1점 회복', ['6', '6']],
      ['2D6>=6 [제육감] (2D6>=6) ＞ 4[1,3] ＞ 4 ＞ 실패', '실패', '', ['1', '3']],
      ['2D6>=6 [제육감] (2D6>=6) ＞ 8[3,5] ＞ 8 ＞ 성공', '성공', '', ['3', '5']]
    ]) {
      await setCheck(text);
      await page.waitForFunction(([result, dice]) => document.querySelector('.ccf-roll20-check-result')?.textContent === result && [...document.querySelectorAll('.ccf-roll20-die:not(.is-total) b')].map((b) => b.textContent).join() === dice.join(), [result, dice]);
      assert.equal(await page.locator('.ccf-roll20-check-card').count(), 1, text);
      assert.deepEqual(await page.locator('.ccf-roll20-die:not(.is-total) b').allTextContents(), dice);
      assert.equal(await page.locator('.ccf-roll20-check-note').count(), note ? 1 : 0);
      if (note) assert.equal(await page.locator('.ccf-roll20-check-note').textContent(), note, 'the note is kept under the card');
      if (result === '펌블') {
        assert.equal(await page.locator('.ccf-roll20-check-card').getAttribute('data-result'), 'fumble');
        assert.equal(await page.locator('.ccf-roll20-die.is-one').count(), 2, 'both 1s red');
        if (process.env.SCREENSHOT_DIR) await page.locator('.ccf-roll20-check-card').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'insane-fumble-card.png') });
      }
    }
    // theme-switcher 0.2.51: ability use card (Roll20 insane sheet look): name / type / ability name, rule, the check part, rule, the description centred
    const INVIS_MAP = ['​', '‌', '‍', '⁠'];
    const enc = (v) => { const b64 = Buffer.from(JSON.stringify(v), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
    const desc = '목표 1명을 선택해서 명중판정을 한다.\n명중판정이 성공하고, 목표가 회피판정에\n실패하면 1D6점 대미지.';
    await setCheck('2D6>=5 [기본공격/웃음] ' + enc({ v: 1, text: '2D6>=5 [기본공격/웃음]', formatRuns: [], alignRuns: [], blockStyle: {}, command: true, ability: { type: '공격', name: '기본공격', text: desc } }) + ' (2D6>=5) ＞ 10[4,6] ＞ 10 ＞ 성공');
    await page.waitForSelector('.ccf-roll20-ability-card .ccf-roll20-check-body');
    const ab = await page.evaluate(() => { const c = document.querySelector('.ccf-roll20-ability-card'); return { label: c.querySelector('.ccf-roll20-item-label')?.textContent, name: c.querySelector('.ccf-roll20-item-name')?.textContent, rules: c.querySelectorAll('.ccf-roll20-ability-rule').length, skill: c.querySelector('.ccf-roll20-check-skill')?.textContent, result: c.querySelector('.ccf-roll20-check-result')?.textContent, text: c.querySelector('.ccf-roll20-ability-text')?.textContent, align: getComputedStyle(c.querySelector('.ccf-roll20-ability-text')).textAlign, lines: Math.round(c.querySelector('.ccf-roll20-ability-text').getBoundingClientRect().height / parseFloat(getComputedStyle(c.querySelector('.ccf-roll20-ability-text')).lineHeight)) }; });
    assert.deepEqual([ab.label, ab.name, ab.rules, ab.skill, ab.result, ab.align], ['공격', '기본공격', 2, '웃음', '성공', 'center'], 'three parts with a check ' + JSON.stringify(ab));
    assert(ab.lines >= 3, 'the description keeps its lines ' + JSON.stringify(ab));
    if (process.env.SCREENSHOT_DIR) await page.locator('.ccf-roll20-ability-card').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'insane-ability-card.png') });
    // an ability without a check: the top and the description only
    await setCheck('[어빌리티:서포트] 응급처치\n아군 1명의 생명력을 1점 회복한다.');
    await page.waitForFunction(() => document.querySelector('.ccf-roll20-ability-card .ccf-roll20-item-name')?.textContent === '응급처치');
    const ab2 = await page.evaluate(() => { const c = document.querySelector('.ccf-roll20-ability-card'); return { label: c.querySelector('.ccf-roll20-item-label')?.textContent, check: !!c.querySelector('.ccf-roll20-check-body'), rules: c.querySelectorAll('.ccf-roll20-ability-rule').length, text: c.querySelector('.ccf-roll20-ability-text')?.textContent }; });
    assert.deepEqual(ab2, { label: '서포트', check: false, rules: 1, text: '아군 1명의 생명력을 1점 회복한다.' }, 'two parts without a check');
    if (process.env.SCREENSHOT_DIR) await page.locator('.ccf-roll20-ability-card').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'insane-ability-card-nocheck.png') });
    await setCheck('2D6+1>=7 긴 특기 이름 (2D6+1>=7) > 4[2,2]+1 > 5 > 펌블'); // back to the text the next step expects
    await page.waitForFunction(() => [...document.querySelectorAll('.ccf-roll20-die:not(.is-total) b')].map((b) => b.textContent).join() === '2,2');
    await select('none');
    assert.equal(await page.locator('.ccf-roll20-check-card').count(), 0);
    assert((await page.locator('#check').textContent()).includes('4[2,2]+1 > 5 > 펌블'));
    await select('insane-roll20');
    await page.waitForSelector('.ccf-roll20-check-card');
    await setCheck('2D6>=5 시간 (2D6>=5) > 10[9,1] > 10 > 성공');
    await page.waitForFunction(() => !document.querySelector('.ccf-roll20-check-card'));
    // 0.2.36: a check the format bar drew (a command sent with a kept format: hidden original with the envelope + an overlay copy) still becomes the right card;
    // the skill shows without its [brackets]
    await page.evaluate(() => {
      const host = document.querySelector('#check'); host.textContent = '';
      const env = '⁣⁣⁣' + '​‌‍⁠'.repeat(8) + '⁢⁢⁢';
      const hidden = document.createElement('span'); hidden.className = 'ccf-original-hidden'; hidden.textContent = '2D6-2>=10 [우주/공포심] ' + env + ' (2D6-2>=10) ＞ 5[2,3]-2 ＞ 3 ＞ 실패';
      const overlay = document.createElement('span'); overlay.className = 'ccf-render-overlay'; overlay.style.fontStyle = 'italic'; overlay.textContent = '2D6-2>=10 [우주/공포심] (2D6-2>=10) ＞ 5[2,3]-2 ＞ 3 ＞ 실패';
      host.append(hidden, overlay);
    });
    await page.waitForFunction(() => document.querySelector('.ccf-roll20-check-skill')?.textContent === '공포판정 : 우주', null, { timeout: 4000 }); // 0.2.37: a fear check reads like Roll20
    // 0.2.40: a skill check gets no field / skill table card (only the check card); 1px smaller texts (skill 17, result 14, target 13)
    assert.deepEqual(await page.locator('#check > .ccf-roll20-emotion-card').evaluateAll((cards) => cards.map((c) => c.className.includes('ccf-roll20-table-card') ? 'table' : 'check')), ['check'], 'no table card on a skill check');
    assert.deepEqual(await page.evaluate(() => ['.ccf-roll20-check-skill', '.ccf-roll20-check-result', '.ccf-roll20-check-target'].map((q) => getComputedStyle(document.querySelector(q)).fontSize)), ['17px', '14px', '13px']);
    assert.deepEqual(await page.locator('.ccf-roll20-die b').allTextContents(), ['3', '2', '3'], 'dice of the formatted check');
    assert.equal(await page.locator('.ccf-roll20-check-target').textContent(), '목표치 10');
    assert.equal(await page.locator('.ccf-roll20-check-card').getAttribute('data-result'), 'failure');
    // 0.2.40: a skill-table roll (RTT / TPT …, BCDice Insane:Korean text) becomes the field / skill card
    for (const [text, want] of [['RTT 랜덤 특기 결정표(1,6) ＞ 《파괴／폭력6》', '1 1.폭력 파괴 6'], ['TPT 지정특기(지각)표(12) ＞ 《그늘／지각12》', '3 3.지각 그늘 12']]) {
      await page.evaluate((t) => { document.querySelector('#check').textContent = t; }, text);
      await page.waitForFunction((w) => document.querySelector('#check > .ccf-roll20-table-card')?.innerText.split(String.fromCharCode(10)).join(' ').trim() === w, want, { timeout: 4000 });
      assert.equal(await page.locator('#check > .ccf-roll20-emotion-card').count(), 1, 'only the table card');
    }
    // 0.2.39: an item use from the sheet becomes an item card
    await page.evaluate(() => { document.querySelector('#check').textContent = '[아이템] 부적\n자신 이외의 누군가가 주사위를 굴렸을 때 사용할 수 있다.'; });
    await page.waitForSelector('#check > .ccf-roll20-item-card');
    const itemCard = await page.evaluate(() => {
      const c = document.querySelector('#check > .ccf-roll20-item-card'); const q = (sel) => c.querySelector(sel)?.textContent || null;
      return { label: q('.ccf-roll20-item-label'), name: q('.ccf-roll20-item-name'), text: q('.ccf-roll20-item-text'), labelColor: getComputedStyle(c.querySelector('.ccf-roll20-item-label')).color, align: getComputedStyle(c).textAlign };
    });
    assert.deepEqual(itemCard, { label: '아이템', name: '부적', text: '자신 이외의 누군가가 주사위를 굴렸을 때 사용할 수 있다.', labelColor: 'rgb(255, 77, 85)', align: 'center' });
    if (process.env.SCREENSHOT_DIR) await page.locator('#check > .ccf-roll20-item-card').screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'insane-item.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: theme selection, persistence, toggle, restoration, native/custom styles and responsive viewports');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
