// v2 (GM theme): 'GM 테마(기본)' is first and chosen until the participant picks another kind; it follows the GM's room theme (state / live 'theme');
// an earlier personal choice (v1 key) goes back to the GM theme once; a picked kind is kept and a GM change no longer overrides it.
// Playroom theme palette (first stage): the toolkit's place and icon in the bottom line; kind (default, light, 6 presets, custom), six colours + accent, the 38 fonts;
// kept in this browser; the export file has the toolkit's format and is read back; the theme also reaches the mirrored CCFOLIA parts (shared sheet).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await page.addInitScript(() => { if (!crypto.randomUUID) crypto.randomUUID = () => 'id-' + Math.random().toString(16).slice(2); });
    const load = async () => { await page.goto('about:blank'); await page.goto('http://relay.test/#room=x'); await page.evaluate(() => { document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none'; renderState({ roomTitle: 'r', gmOnline: true, channels: [{ id: 'main', label: '메인' }], messages: [{ id: 'm', author: 'A', text: '말', channel: 'main', createdAt: Date.now() }] }); }); await page.waitForSelector('#theme-open'); };
    await load();
    const place = await page.evaluate(() => { const b = document.getElementById('theme-open').getBoundingClientRect(), f = document.querySelector('.dice-footer').getBoundingClientRect(); return { right: Math.round(f.right - b.right), size: [Math.round(b.width), Math.round(b.height)], centre: Math.abs((b.top + b.bottom) / 2 - (f.top + f.bottom) / 2) <= 1 }; });
    assert.deepEqual(place, { right: 8, size: [24, 24], centre: true }, 'the toolkit palette place');
    const bg = (sel) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).backgroundColor);
    const before = await bg('#chat-form');
    // the GM's room theme arrives (with the state, then live): applied as the default
    const GM = { bg: '#101010', appbar: '#202020', paper: '#303030', border: '#404040', text: '#eeeeee', inputBg: '#050505', accent: '#ff0000', alpha: 100, blur: 0 };
    await page.evaluate((GM) => renderState({ roomTitle: 'r', gmOnline: true, channels: [{ id: 'main', label: '메인' }], messages: [], theme: { theme: GM, sheet: '' } }), GM);
    assert.equal(await bg('#chat-form'), 'rgb(48, 48, 48)', 'GM theme panel colour');
    await page.evaluate(() => window.__prSetGmTheme({ theme: { bg: '#101010', appbar: '#202020', paper: '#123123', border: '#404040', text: '#eeeeee', inputBg: '#050505', accent: '' } }));
    assert.equal(await bg('#chat-form'), 'rgb(18, 49, 35)', 'a live GM change');
    await page.evaluate(() => window.__prSetGmTheme({ theme: null, sheet: '' }));
    assert.equal(await bg('#chat-form'), before, "the GM's default look = the normal look");
    await page.click('#theme-open');
    assert.equal(await page.inputValue('#pr-theme [data-kind]'), 'gm', 'GM 테마 chosen by default');
    assert.deepEqual(await page.locator('#pr-theme [data-kind] option').allTextContents(), ['GM 테마(기본)', '기본값', '라이트', '심해', '벚꽃', '숲', '밤', '양피지', '다크', '커스텀']);
    assert.equal(await page.locator('#pr-theme [data-font] option').count(), 39, '기본 + 38');
    assert.equal(await page.locator('#pr-theme input[type=color]').count(), 7, 'six colours + accent');
    await page.selectOption('#pr-theme [data-kind]', 'preset:0');
    assert.equal(await bg('#chat-form'), 'rgb(17, 42, 59)', '심해 panel colour');
    assert.equal(await page.evaluate(() => document.adoptedStyleSheets.some((s) => [...s.cssRules].some((r) => r.cssText.includes('rgb(17, 42, 59)') || r.cssText.includes('#112a3b')))), true);
    // a mirrored part (shadow root) gets the same sheet
    assert.equal(await page.evaluate(() => { const { root } = cmMirror.shadow('theme-test-host', (n) => document.body.append(n)); root.innerHTML = '<div class="MuiPaper-root" id="p"></div>'; return getComputedStyle(root.getElementById('p')).backgroundColor; }), 'rgb(17, 42, 59)', 'mirrored parts follow');
    await page.selectOption('#pr-theme [data-font]', 'Nanum Myeongjo');
    assert.match(await page.locator('#chat-input').evaluate((n) => getComputedStyle(n).fontFamily), /^NanumMyeongjo, 나눔명조, "Nanum Myeongjo"/); // the installed copy first, then the web font (#690)
    // a picked kind is not overridden by a GM change
    await page.evaluate((GM) => window.__prSetGmTheme({ theme: GM, sheet: '' }), GM);
    assert.equal(await bg('#chat-form'), 'rgb(17, 42, 59)', 'own choice kept over the GM theme');
    // kept across a reload
    await load();
    assert.equal(await bg('#chat-form'), 'rgb(17, 42, 59)', 'kept');
    await page.click('#theme-open');
    assert.equal(await page.inputValue('#pr-theme [data-kind]'), 'preset:0');
    // a colour edit makes it custom; export -> default -> import brings it back
    await page.fill('#pr-theme input[type=text][data-key="paper"]', '#123456');
    assert.equal(await page.inputValue('#pr-theme [data-kind]'), 'custom'); assert.equal(await bg('#chat-form'), 'rgb(18, 52, 86)');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#pr-theme .prt-actions button:has-text("내보내기")')]);
    const file = await download.path(), data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.match(download.suggestedFilename(), /\.ccf-theme\.json$/);
    assert.equal(data.type, 'ccf-theme-switcher-theme'); assert.equal(data.version, 1); assert.equal(data.theme.paper, '#123456');
    assert.deepEqual(Object.keys(data.theme).sort(), ['accent', 'alpha', 'appbar', 'bg', 'blur', 'border', 'inputBg', 'paper', 'scrollbar', 'text', 'uiText'].sort(), 'the toolkit theme fields');
    await page.selectOption('#pr-theme [data-kind]', 'default'); await page.selectOption('#pr-theme [data-font]', '');
    assert.equal(await bg('#chat-form'), before, 'default = the normal look');
    await page.setInputFiles('#pr-theme input[type=file]', { name: 't.ccf-theme.json', mimeType: 'application/json', buffer: fs.readFileSync(file) });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('chat-form')).backgroundColor === 'rgb(18, 52, 86)');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#pr-theme').count(), 0, 'Esc closes');
    // an earlier personal choice under the old key only: back to the GM theme once
    await page.evaluate(() => { localStorage.removeItem('capybara-playroom-theme-v2'); localStorage.setItem('capybara-playroom-theme-v1', JSON.stringify({ mode: 'preset:0', custom: {}, font: '' })); });
    await load();
    await page.click('#theme-open');
    assert.equal(await page.inputValue('#pr-theme [data-kind]'), 'gm', 'old personal choice → GM theme once');
    assert.deepEqual(errors, []);
    console.log('participant theme PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
