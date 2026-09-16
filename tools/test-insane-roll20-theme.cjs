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
      </main></section></div><div id="unrelated">Unrelated content</div></body></html>` }));
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
    assert.equal(await page.locator('option[value="insane-roll20"]').textContent(), '인세인(Roll20)');
    const before = await color('.MuiDialog-paper');
    const unrelated = await color('#unrelated', 'color');
    await select('insane-roll20');
    assert.equal(await selected(), 'insane-roll20');
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
    assert.equal(await color('.MuiDialog-paper'), before);
    await page.locator('#ccf-theme-switcher-unsung-duet-toggle').dispatchEvent('click');
    assert.equal(await selected(), 'insane-roll20');
    for (const id of ['unsung-duet', 'cree-grrr', 'none']) {
      await select(id);
      assert.equal(await selected(), id === 'none' ? null : id);
    }
    assert.equal(await color('.MuiDialog-paper'), before, 'default restores native appearance');
    await select('insane-roll20');
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await color('.MuiDialog-paper'), 'rgb(31, 31, 31)');
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `insane-theme-${viewport.width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: theme selection, persistence, toggle, restoration, native/custom styles and responsive viewports');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
