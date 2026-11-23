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
      <span class="MuiSwitch-switchBase Mui-checked">sw</span><p class="MuiListItemText-secondary">2D6 <span class="MuiTypography-body2" id="dice" style="color:rgb(33,150,243)">＞ 8</span></p></div></body></html>` }));
    const load = async () => { await page.goto('https://ccfolia.com/rooms/theme-test'); await page.addScriptTag({ content: source }); await page.waitForSelector('#ccf-theme-switcher-mode option[value="preset:0"]', { state: 'attached' }); };
    await load();
    const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
    // 0.2.64 compact window: no note under the title, 34px rows, 1px less between them, the two button rows 8px apart, a close button without its own colour
    assert.equal(await page.locator('#ccf-theme-switcher-panel .ccf-theme-title span').count(), 0);
    assert.deepEqual([await css('#ccf-theme-switcher-mode', 'height'), await css('#ccf-theme-switcher-panel .ccf-theme-color-code', 'height'), await css('#ccf-theme-switcher-panel .ccf-theme-card', 'rowGap'), await css('#ccf-theme-switcher-panel .ccf-theme-grid', 'rowGap'), await css('#ccf-theme-switcher-panel .ccf-theme-actions + .ccf-theme-actions', 'marginTop'), await css('#ccf-theme-switcher-panel .ccf-theme-close', 'backgroundColor')], ['34px', '34px', '13px', '9px', '-5px', 'rgba(0, 0, 0, 0)']);
    const attrs = () => page.evaluate(() => ['active', 'accent', 'uitext', 'scrollbar', 'blur'].map((n) => document.documentElement.getAttribute('data-ccf-theme-' + n)));
    // presets: 7 of ours, one click = custom theme with that accent
    // 0.2.62: the seven colours are options of the '종류' dropdown (one 라이트: the existing mode); no preset buttons
    const kind = (v) => page.locator('#ccf-theme-switcher-mode').selectOption(v);
    assert.equal(await page.locator('[data-action="color-preset"]').count(), 0, 'no preset buttons');
    assert.equal(await page.locator('#ccf-theme-switcher-panel .ccf-theme-row > span').first().textContent(), '종류');
    assert.deepEqual((await page.locator('#ccf-theme-switcher-mode option').allTextContents()).filter((n) => !['커스텀'].includes(n)), ['기본값', '라이트', '심해', '벚꽃', '숲', '밤', '양피지', '다크']);
    await kind('preset:0');
    assert.equal(await page.locator('#ccf-theme-switcher-mode').inputValue(), 'preset:0', 'the dropdown shows the chosen colour');
    assert.deepEqual(await attrs(), ['1', '1', null, null, null], 'accent on, the rest auto');
    assert.equal(await css('.MuiTabs-indicator', 'backgroundColor'), 'rgb(79, 195, 247)', 'tab underline = accent');
    assert.equal(await css('.MuiSwitch-switchBase', 'color'), 'rgb(79, 195, 247)', 'switch = accent');
    assert.equal(await css('#dice', 'color'), 'rgb(79, 195, 247)', '0.2.48: the dice result text = accent');
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
    await kind('preset:3');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ccf-theme-scheme')), 'dark', '밤 = dark');
    await kind('preset:1');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ccf-theme-scheme')), 'light', '벚꽃 = light');
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(read('legacy/ccfolia-character-sheet.user.js'), /html\[data-ccf-theme-scheme="dark"\] #\$\{ROOT_ID\} \.ccf-cs-dialog \{ background:var\(--ccf-theme-paper\)!important \}/);
    assert.match(read('legacy/ccfolia-toolkit-presence.user.js'), /html\[data-ccf-theme-scheme="dark"\] #ccf-gm-tools \.ccf-gt-window\{background:var\(--ccf-theme-paper\)!important/);
    assert.equal((read('legacy/ccfolia-handout.user.js').match(/:host-context\(html\[data-ccf-theme-scheme="dark"\]\)/g) || []).length, 2, 'handout list + view windows');
    // 0.2.43: 글꼴 section (my screen only): family / scale / spacing / weight, kept after a reload, 글꼴 기본값 resets
    await page.evaluate(() => { const p = document.createElement('p'); p.className = 'MuiTypography-root'; p.id = 'typo'; p.textContent = '글자'; document.body.appendChild(p); window.__fontsAsked = []; window.__CCF_ENSURE_GOOGLE_FONTS__ = (f) => window.__fontsAsked.push(f); });
    const sf = (key, v) => page.locator(`#ccf-theme-switcher-panel [data-screen-font="${key}"]`).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, v);
    // 0.2.62: the screen font is a dropdown of the 38 message fonts with Korean names; the sheet row is 시트 + dropdown + ON/OFF on one line
    { const names = await page.locator('[data-screen-font-pick] option').allTextContents(); const fonts = names.slice(1, -1); assert.equal(names[0], '기본'); assert.equal(fonts.length, 38); assert.equal(await page.locator('[data-screen-font-pick] optgroup').count(), 0, 'one list'); const ko = fonts.filter((n) => /^[가-힣]/.test(n)), en = fonts.filter((n) => !/^[가-힣]/.test(n)); assert.deepEqual(fonts, [...[...ko].sort((a, b) => a.localeCompare(b, 'ko')), ...[...en].sort((a, b) => a.localeCompare(b, 'ko'))], 'Korean names in order, then Latin'); }
    assert.equal(await page.locator('[data-screen-font-pick] option[value="Nanum Myeongjo"]').textContent(), '나눔명조');
    { const row = await page.evaluate(() => { const r = document.querySelector('.ccf-theme-sheet-row'), top = (e) => { const b = e.getBoundingClientRect(); return Math.round(b.top + b.height / 2); }; const s = r.querySelector('select'), b = r.querySelector('button'); return { label: r.querySelector('span').textContent, order: [...r.children].map((c) => c.tagName), text: b.textContent, oneLine: Math.abs(top(s) - top(b)) <= 1 }; }); assert.deepEqual(row, { label: '시트', order: ['SPAN', 'SELECT', 'BUTTON'], text: 'ON', oneLine: true }); }
    await page.locator('[data-screen-font-pick]').selectOption('Nanum Myeongjo'); assert.equal(await page.locator('[data-screen-font="family"]').inputValue(), 'Nanum Myeongjo'); assert.equal(await page.locator('[data-screen-font-custom]').isVisible(), false);
    await page.locator('[data-screen-font-pick]').selectOption('__custom'); assert.equal(await page.locator('[data-screen-font-custom]').evaluate((n) => n.hidden), false, 'direct input opens');
    await page.locator('[data-screen-font-pick]').selectOption('');
    await sf('family', 'Nanum Myeongjo'); await sf('spacing', '1'); await sf('weight', '700');
    const typo = () => page.locator('#typo').evaluate((e) => { const c = getComputedStyle(e); return [c.fontFamily.split(',')[0].replace(/"/g, ''), c.letterSpacing]; });
    assert.deepEqual(await typo(), ['Nanum Myeongjo', '1px']);
    assert((await page.evaluate(() => window.__fontsAsked)).includes('Nanum Myeongjo'), 'the font is loaded');
    await load();
    await page.evaluate(() => { const p = document.createElement('p'); p.className = 'MuiTypography-root'; p.id = 'typo'; p.textContent = '글자'; document.body.appendChild(p); });
    assert.deepEqual(await typo(), ['Nanum Myeongjo', '1px'], 'kept after a reload');
    await page.locator('#ccf-theme-switcher-panel [data-action="screen-font-reset"]').dispatchEvent('click');
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-ccf-screen-font')), null, 'reset = the current look');
    assert.deepEqual(errors, []);
    console.log('theme extras PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
