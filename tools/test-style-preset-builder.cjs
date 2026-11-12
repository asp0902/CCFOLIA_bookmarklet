const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 서식 프리셋 모달: 빌더 줄(B·I·U·S·정렬·글자색·배경색·크기)의 모든 컨트롤이 같은 높이(28px)·외곽선·배경이고, 두 색 칸이 같은 크기(28×28, 안쪽 칩 16×16)이며,
// 프리셋 행의 자동 적용 버튼은 작은 스위치(role=switch, 28×14)다. 테마 끔/켬 모두.
const root = path.join(__dirname, '../legacy/');
const sync = fs.readFileSync(root + 'ccfolia-format-sync.user.js', 'utf8');
const themeSource = fs.readFileSync(root + 'ccfolia-theme-switcher.user.js', 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    for (const theme of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#282828;color:#fff"><div role="log"><ul id="list"></ul></div><form id="composer"><textarea name="text" class="MuiInputBase-input" rows="3"></textarea><button type="submit">전송</button><button type="button" aria-label="D100">D100</button></form></body>' }));
      await page.goto('https://ccfolia.com/rooms/A');
      await page.evaluate(() => { localStorage.setItem('ccf-format-style-presets-v1:A', JSON.stringify([{ name: '굵은서식', style: { bold: true }, auto: true, savedAt: 1 }, { name: '꺼진서식', style: { italic: true }, auto: false, savedAt: 2 }])); });
      await page.addScriptTag({ content: sync });
      if (theme) await page.addScriptTag({ content: themeSource });
      await page.waitForSelector('[data-inline-command="bold"]', { state: 'attached' });
      await page.waitForTimeout(700);
      if (theme) await page.evaluate(() => document.documentElement.setAttribute('data-ccf-theme-active', '1'));
      await page.evaluate(() => { const t = document.querySelector('textarea[name=text]'); t.value = '문장'; t.focus(); });
      await page.locator('[data-inline-command="style-clipboard"]').first().click();
      await page.waitForSelector('.ccf-style-builder-row');
      await page.waitForTimeout(300);
      const label = theme ? 'theme on' : 'theme off';
      const m = await page.evaluate(() => {
        const row = document.querySelector('.ccf-style-builder-row');
        const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; };
        const cs = (el) => getComputedStyle(el);
        const toggles = [...row.querySelectorAll('.ccf-toggle')].map((b) => ({ rect: rect(b), border: cs(b).borderTopWidth, active: b.getAttribute('data-active') === '1', borderColor: cs(b).borderTopColor, bg: cs(b).backgroundColor }));
        const colors = [...row.querySelectorAll('.ccf-style-builder-color')].map((l) => ({ rect: rect(l), border: cs(l).borderTopWidth, borderColor: cs(l).borderTopColor, bg: cs(l).backgroundColor, chip: [cs(l, '::before').width, cs(getComputedStyle(l, '::before') && l).width] }));
        const chips = [...row.querySelectorAll('.ccf-style-builder-color')].map((l) => { const b = getComputedStyle(l, '::before'); return [b.width, b.height]; });
        const size = row.querySelector('[data-style-builder-size]');
        const switches = [...document.querySelectorAll('.ccf-style-preset-auto-dot')].map((d) => ({ rect: rect(d), role: d.getAttribute('role'), checked: d.getAttribute('aria-checked'), on: d.getAttribute('data-on'), title: d.getAttribute('title') }));
        return { toggles, colors, chips, size: { rect: rect(size), border: cs(size).borderTopWidth, borderColor: cs(size).borderTopColor, bg: cs(size).backgroundColor, radius: cs(size).borderRadius, align: cs(size).textAlign }, rowHeight: rect(row)[1], switches, presetRowHeight: rect(document.querySelector('.ccf-style-preset-row'))[1] };
      });
      console.log('preset builder', label, JSON.stringify({ toggles: m.toggles[0], color: m.colors[0].rect, chip: m.chips[0], size: m.size.rect, rowHeight: m.rowHeight, presetRow: m.presetRowHeight, switch: m.switches[0].rect }));
      for (const t of m.toggles) { assert.deepEqual(t.rect, [28, 28], label + ': B/I/U/S/align are 28x28'); assert.equal(t.border, '1px', label + ': they have the outline'); }
      const plainToggles = m.toggles.filter((t) => !t.active);
      assert(plainToggles.every((t) => t.borderColor === plainToggles[0].borderColor && t.bg === plainToggles[0].bg), label + ': same outline and background');
      assert.deepEqual(m.colors.map((c) => c.rect), [[28, 28], [28, 28]], label + ': both colour cells are 28x28');
      assert.deepEqual(m.chips, [['16px', '16px'], ['16px', '16px']], label + ': both inner chips are 16x16');
      const chipPos = await page.locator('.ccf-style-builder-color').evaluateAll((els) => els.map((l) => { const b = getComputedStyle(l, '::before'); return [b.left, b.top]; }));
      assert(chipPos.every(([left, top]) => parseFloat(left) > 5 && parseFloat(top) > 5), label + ': the chips sit in the middle of their cells: ' + JSON.stringify(chipPos));
      assert(m.colors.every((c) => c.border === '1px' && c.borderColor === m.colors[0].borderColor && c.bg === m.colors[0].bg), label + ': colour cells share outline and background');
      assert.equal(m.colors[0].borderColor, plainToggles[0].borderColor, label + ': the colour cells look like the other buttons');
      assert.deepEqual(m.size.rect, [40, 28], label + ': the size field is 40x28'); assert.equal(m.size.border, '1px');
      assert.equal(m.size.borderColor, plainToggles[0].borderColor); assert.equal(m.size.bg, plainToggles[0].bg); assert.equal(m.size.radius, '0px'); assert.equal(m.size.align, 'center');
      assert.equal(m.rowHeight, 28, label + ': the whole builder row is 28px high');
      // the auto-apply switches
      assert.equal(m.switches.length, 2);
      for (const sw of m.switches) { assert.deepEqual(sw.rect, [28, 14], label + ': a 28x14 switch'); assert.equal(sw.role, 'switch'); }
      assert.deepEqual(m.switches.map((s) => [s.checked, s.on]), [['true', '1'], ['false', '0']], label + ': checked follows the saved auto flag');
      assert(m.presetRowHeight <= 30, `${label}: the preset row keeps its height (${m.presetRowHeight}px)`);
      // click and keyboard toggle it, the data stays in step
      const first = page.locator('.ccf-style-preset-auto-dot').first();
      await first.click(); await page.waitForTimeout(150);
      assert.equal(await first.getAttribute('aria-checked'), 'false'); assert.equal(await first.getAttribute('data-on'), '0');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:A'))[0].auto), false);
      await first.focus(); await page.keyboard.press('Space'); await page.waitForTimeout(150);
      assert.equal(await first.getAttribute('aria-checked'), 'true');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ccf-format-style-presets-v1:A'))[0].auto), true);
      const look = await page.locator('.ccf-style-preset-auto-dot').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
      assert.notEqual(look[0], look[1], label + ': on and off look different');
      assert.deepEqual(errors, [], 'no page errors');
      await page.close();
    }
    console.log('style preset builder PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
