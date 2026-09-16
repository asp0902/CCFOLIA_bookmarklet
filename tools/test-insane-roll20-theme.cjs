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
    assert.equal(await page.locator('option[value="insane-roll20"]').textContent(), 'Roll20');
    const before = await color('.MuiDialog-paper');
    const unrelated = await color('#unrelated', 'color');
    await select('insane-roll20');
    assert.equal(await selected(), 'insane-roll20');
    assert.equal(await page.locator('#emotion .ccf-roll20-emotion-card').textContent(), '브릿지충성(플러스) / 모멸(마이너스)');
    assert.equal(await page.locator('#ordinary .ccf-roll20-emotion-card').count(), 0);
    assert.equal(await color('.ccf-roll20-emotion-card'), 'rgb(255, 255, 255)');
    assert.equal(await color('.MuiDialog-paper'), 'rgb(31, 31, 31)');
    assert.equal(await color('.ccf-cs-dialog'), 'rgb(31, 31, 31)');
    assert.equal(await color('.ccf-cs-dialog > header'), 'rgb(33, 33, 40)');
    assert.equal(await color('.ccf-cs-skill button', 'color'), 'rgb(255, 97, 104)');
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
      assert.equal(await color('.MuiDialog-paper'), 'rgb(31, 31, 31)');
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
    await select('none');
    assert.equal(await page.locator('.ccf-roll20-check-card').count(), 0);
    assert((await page.locator('#check').textContent()).includes('4[2,2]+1 > 5 > 펌블'));
    await select('insane-roll20');
    await page.waitForSelector('.ccf-roll20-check-card');
    await setCheck('2D6>=5 시간 (2D6>=5) > 10[9,1] > 10 > 성공');
    await page.waitForFunction(() => !document.querySelector('.ccf-roll20-check-card'));
    assert.deepEqual(errors, []);
    console.log('PASS: theme selection, persistence, toggle, restoration, native/custom styles and responsive viewports');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
