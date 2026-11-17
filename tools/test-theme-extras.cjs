const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// theme-switcher 0.2.41: extra theme colors (accent / UI text / scrollbar, empty = auto = the current look), bar/panel opacity + back blur, one-click color presets;
// they are part of the custom theme (saved with it, kept across reloads; an old theme without them gets the defaults).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-theme-switcher.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body>
      <header class="MuiAppBar-root">bar <button class="MuiIconButton-root">i</button></header>
      <div class="MuiDrawer-paper" style="width:200px;height:100px">drawer <span class="MuiTabs-indicator" style="display:block;height:2px"></span>
      <span class="MuiSwitch-switchBase Mui-checked">sw</span></div></body></html>` }));
    const load = async () => { await page.goto('https://ccfolia.com/rooms/theme-test'); await page.addScriptTag({ content: source }); await page.waitForSelector('#ccf-theme-switcher-panel [data-action="color-preset"]', { state: 'attached' }); };
    await load();
    const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
    const attrs = () => page.evaluate(() => ['active', 'accent', 'uitext', 'scrollbar', 'blur'].map((n) => document.documentElement.getAttribute('data-ccf-theme-' + n)));
    // presets: 7 of ours, one click = custom theme with that accent
    assert.deepEqual(await page.locator('[data-action="color-preset"]').allTextContents(), ['심해', '벚꽃', '숲', '밤', '양피지', '다크', '라이트']);
    await page.locator('[data-action="color-preset"][data-preset="0"]').dispatchEvent('click');
    assert.deepEqual(await attrs(), ['1', '1', null, null, null], 'accent on, the rest auto');
    assert.equal(await css('.MuiTabs-indicator', 'backgroundColor'), 'rgb(79, 195, 247)', 'tab underline = accent');
    assert.equal(await css('.MuiSwitch-switchBase', 'color'), 'rgb(79, 195, 247)', 'switch = accent');
    assert.equal(await css('.MuiDrawer-paper', 'backgroundColor'), 'rgb(17, 42, 59)', 'panel opaque by default');
    // opacity + blur
    const setRange = (key, v) => page.locator(`#ccf-theme-switcher-panel input[data-extra="${key}"]`).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await setRange('alpha', '50'); await setRange('blur', '6');
    assert.equal(await css('.MuiDrawer-paper', 'backgroundColor'), 'rgba(17, 42, 59, 0.5)');
    assert.equal(await css('.MuiDrawer-paper', 'backdropFilter'), 'blur(6px)');
    // UI text color via its code box; emptying it = auto again
    const code = (key, v) => page.locator(`#ccf-theme-switcher-panel input[data-role="extra-code"][data-extra="${key}"]`).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await code('uiText', '#ff0000');
    assert.equal(await css('.MuiIconButton-root', 'color'), 'rgb(255, 0, 0)');
    await code('scrollbar', '#00ff00');
    assert.deepEqual(await attrs(), ['1', '1', '1', '1', '1']);
    await code('uiText', '');
    assert.equal((await attrs())[2], null, 'emptied = auto');
    // saved with the custom theme, kept after a reload
    const saved = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /theme/i.test(x) && /customTheme/.test(localStorage.getItem(x))); return JSON.parse(localStorage.getItem(k)).customTheme; });
    assert.deepEqual({ accent: saved.accent, uiText: saved.uiText, scrollbar: saved.scrollbar, alpha: saved.alpha, blur: saved.blur }, { accent: '#4fc3f7', uiText: '', scrollbar: '#00ff00', alpha: 50, blur: 6 });
    await load();
    assert.equal(await css('.MuiDrawer-paper', 'backgroundColor'), 'rgba(17, 42, 59, 0.5)', 'kept after reload');
    assert.equal(await page.locator('#ccf-theme-switcher-panel input[data-extra="alpha"]').inputValue(), '50', 'the panel shows the saved value');
    // an old custom theme (no extra fields) = the current look
    await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /customTheme/.test(localStorage.getItem(x))); const d = JSON.parse(localStorage.getItem(k)); d.customTheme = { bg: '#151414', appbar: '#22201f', paper: '#1d1c1e', border: '#413d3a', text: '#f4f0eb', inputBg: '#1a191b' }; localStorage.setItem(k, JSON.stringify(d)); });
    await load();
    assert.deepEqual((await attrs()).slice(1), [null, null, null, null], 'no extras');
    assert.equal(await css('.MuiTabs-indicator', 'backgroundColor'), 'rgb(244, 240, 235)', 'accent untouched: the theme own rule (text color) as before 0.2.41');
    assert.equal(await css('.MuiDrawer-paper', 'backgroundColor').then((c) => /rgba\(.*0\.\d+\)/.test(c)), false, 'opaque');
    // 0.2.42: the colour scheme attribute (toolkit windows follow a dark theme's paper / text)
    await page.locator('[data-action="color-preset"][data-preset="3"]').dispatchEvent('click');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ccf-theme-scheme')), 'dark', '밤 = dark');
    await page.locator('[data-action="color-preset"][data-preset="1"]').dispatchEvent('click');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ccf-theme-scheme')), 'light', '벚꽃 = light');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(read('legacy/ccfolia-character-sheet.user.js'), /html\[data-ccf-theme-scheme="dark"\] #\$\{ROOT_ID\} \.ccf-cs-dialog \{ background:var\(--ccf-theme-paper\)!important \}/);
    assert.match(read('legacy/ccfolia-toolkit-presence.user.js'), /html\[data-ccf-theme-scheme="dark"\] #ccf-gm-tools \.ccf-gt-window\{background:var\(--ccf-theme-paper\)!important/);
    assert.equal((read('legacy/ccfolia-handout.user.js').match(/:host-context\(html\[data-ccf-theme-scheme="dark"\]\)/g) || []).length, 2, 'handout list + view windows');
    assert.deepEqual(errors, []);
    console.log('theme extras PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
