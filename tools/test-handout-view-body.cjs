// handout 0.1.125: what is typed in the editor (lines, empty lines) is what the view window shows, and the GM's view window always shows the secret part ('🔒 비밀 내용').
// The whole script, as the GM: type into the public / secret boxes with the keyboard, save, open the view window from the card.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#222"><div id="root"></div><form style="position:fixed;bottom:0;left:0"><input name="name" value="드와이프"><textarea name="text"></textarea></form></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      localStorage.setItem('ccf-handout:greeted-skip-day', '2999-01-01');
      const value = { myCharacter: '드와이프', handouts: [], folders: [], plDeleted: {}, plDeletedMigrated: true, plList: [{ name: '눈깅', id: '', role: 'player', aliases: [], image: '' }] };
      window.__CAPYBARA_TOOLKIT__ = { storage: { getRoomData: async () => ({ value }), setRoomData: async (f, k, v) => { window.__saved = JSON.parse(JSON.stringify(v)); } } };
    });
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1200);
    const sh = (sel) => page.locator('#ccfolia-handout-root').locator(sel);
    await page.evaluate(() => window.__CCF_HANDOUT_DEBUG__.open()); await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="new-handout"]').click()); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#ccfolia-handout-root').shadowRoot.querySelector('[data-action="add-handout-choice"]').click()); await page.waitForTimeout(300);
    await sh('[data-field="title"]').fill('바깥 상황');
    const typeLines = async (field, lines) => { await sh(`.rich-editor[data-field="${field}"]`).click(); for (let i = 0; i < lines.length; i += 1) { if (i) await page.keyboard.press('Enter'); if (lines[i]) await page.keyboard.type(lines[i]); } };
    await typeLines('description', ['첫 줄', '둘째 줄', '', '빈 줄 다음']);
    await typeLines('gmNotes', ['비밀 하나', '', '비밀 셋']);
    const editorLines = await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; return ['description', 'gmNotes'].map((f) => s.querySelector(`.rich-editor[data-field="${f}"]`).innerText.split('\n').length); });
    await sh('[data-action="save-handout"]').click(); await page.waitForTimeout(500);
    const saved = await page.evaluate(() => window.__saved?.handouts?.[0]);
    assert(saved && saved.title === '바깥 상황', 'saved: ' + JSON.stringify(saved));
    // the GM opens the view window from the list
    await page.evaluate(() => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector('.tab[data-tab="list"]')?.click(); });
    await page.waitForTimeout(200);
    await page.evaluate((id) => { const s = document.querySelector('#ccfolia-handout-root').shadowRoot; s.querySelector(`[data-action="view-handout"][data-id="${id}"]`).click(); }, saved.id);
    await page.waitForTimeout(300);
    const view = await page.evaluate(() => { const h = document.querySelector('[data-ccf-handout-show="1"]'); const r = h.shadowRoot; const parts = [...r.querySelectorAll('.rendered')]; return { head: r.querySelector('.secret-head')?.textContent.trim() || null, lines: parts.map((p) => p.innerText.split('\n').length), text: parts.map((p) => p.innerText) }; });
    assert.equal(view.head, '🔒 비밀 내용', 'the GM sees the secret part: ' + JSON.stringify(view));
    assert.deepEqual(view.lines, editorLines, 'same lines as the editor: ' + JSON.stringify({ view, editorLines, saved: [saved.description, saved.gmNotes] }));
    // text whose lines are line-break characters inside the HTML (pasted / older saves): the editor (pre-wrap) shows 4 lines, so does the view window (it showed one line)
    await page.evaluate(() => document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((h) => h.remove()));
    const nlLines = await page.evaluate(async (id) => {
      const s = document.querySelector('#ccfolia-handout-root').shadowRoot;
      s.querySelector(`[data-action="edit-handout"][data-id="${id}"]`)?.click();
      await new Promise((r) => setTimeout(r, 300));
      const ed = s.querySelector('.rich-editor[data-field="description"]'); ed.innerHTML = '<span>가\n나\n\n다</span>';
      const editorLines = ed.innerText.split('\n').length;
      s.querySelector('[data-action="save-handout"]').click();
      await new Promise((r) => setTimeout(r, 400));
      s.querySelector('.tab[data-tab="list"]')?.click(); await new Promise((r) => setTimeout(r, 200));
      s.querySelector(`[data-action="view-handout"][data-id="${id}"]`).click(); await new Promise((r) => setTimeout(r, 300));
      const r = document.querySelector('[data-ccf-handout-show="1"]').shadowRoot;
      return { editorLines, view: r.querySelector('.rendered').innerText.split('\n').length };
    }, saved.id);
    assert.deepEqual([nlLines.view, nlLines.editorLines], [4, 4], 'line-break characters show as lines: ' + JSON.stringify(nlLines));
    // the GM row popup: a preview on the GM screen as that row's checks say (public only, then with the secret part)
    const gmPreview = await page.evaluate(async (id) => {
      const s = document.querySelector('#ccfolia-handout-root').shadowRoot;
      document.querySelectorAll('[data-ccf-handout-show="1"]').forEach((h) => h.remove());
      s.querySelector('.tab[data-tab="list"]')?.click(); await new Promise((r) => setTimeout(r, 100));
      s.querySelector(`[data-action="edit-handout"][data-id="${id}"]`).click(); await new Promise((r) => setTimeout(r, 300));
      const out = [];
      for (const cols of [['view'], ['view', 'secret']]) {
        for (const c of cols) { const box = s.querySelector(`input[data-perm-key="드와이프"][data-perm-col="${c}"]`); if (!box.checked) box.click(); }
        s.querySelector('[data-action="row-popup"][data-self="1"]').click(); await new Promise((r) => setTimeout(r, 200));
        const hosts = [...document.querySelectorAll('[data-ccf-handout-show="1"]')]; const r = hosts.at(-1).shadowRoot;
        out.push({ preview: hosts.at(-1).dataset.preview, pub: !!r.querySelector('.rendered')?.textContent.includes('가'), secret: r.querySelector('.secret-head')?.textContent.trim() || null });
        hosts.forEach((h) => h.remove());
      }
      return out;
    }, saved.id);
    assert.deepEqual(gmPreview, [{ preview: '1', pub: true, secret: null }, { preview: '1', pub: true, secret: '🔒 비밀 내용' }], 'GM row preview follows the checks: ' + JSON.stringify(gmPreview));
    assert.deepEqual(errors, []);
    console.log('handout view body PASS', JSON.stringify(view.lines));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
