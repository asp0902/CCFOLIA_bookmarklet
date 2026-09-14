const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'legacy/ccfolia-handout.user.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert(start >= 0, name);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://ccfolia.com/**', route => route.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ path: path.join(root, 'legacy/ccfolia-roll20-css-bridge.user.js') });
    const css = source.split('const STYLE_CSS = `')[1].split('`;')[0];
    await page.addStyleTag({ content: css });
    const funcs = ['renderEdit', 'renderEditorMacro', 'onShadowInput', 'getFieldValue', 'saveHandoutFromForm'].map(extract).join('\n');
    const result = await page.evaluate(async (funcs) => {
      const state = { editingId: 'new', data: { handouts: [], folders: [{ id: 'f1', name: 'Folder' }] }, formPermissions: {}, shadow: document.body };
      const ICON_TRASH = '';
      const findHandout = id => state.data.handouts.find(h => h.id === id);
      const canManageHandout = () => true, isAdminMode = () => true;
      const ensurePermissions = h => h, permissionRowKeys = () => [];
      const escapeHtml = s => String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
      const escapeAttr = escapeHtml, renderHandoutBody = s => s || '';
      const renderFormatToolbar = () => '<div class="handout-format-toolbar"></div>';
      const toast = () => {}, setTab = () => {}, saveAll = async () => {}, pushHandoutToFirestore = async () => {};
      const uuid = () => 'new-id', getNextOrder = () => 1;
      return await eval(`(async () => { ${funcs}
        document.body.innerHTML = renderEdit();
        const select = document.querySelector('[data-field="folderId"]');
        const checks = [select.value === '', select.nextElementSibling.dataset.field === 'title'];
        const bounds = selector => document.querySelector(selector).getBoundingClientRect();
        checks.push(bounds('.handout-edit-cols').top - bounds('.handout-format-toolbar').bottom === bounds('.perm-section').top - bounds('.handout-edit-cols').bottom);
        select.value = 'f1';
        document.querySelector('[data-field="title"]').value = 'Test';
        const macro = '/desc [Hello](<#" style="color: red; font-weight: bold; border-radius: 99px;>)';
        for (const field of ['description', 'gmNotes']) {
          const editor = document.querySelector('[data-field="' + field + '"]');
          editor.innerText = macro;
          onShadowInput({ target: editor });
          const preview = document.querySelector('[data-preview="' + field + '"]');
          checks.push(!preview.hidden, preview.textContent === 'Hello', preview.querySelector('.ccr20-frag').style.borderRadius === '99px', editor.innerText === macro);
        }
        await saveHandoutFromForm();
        checks.push(state.data.handouts[0].folderId === 'f1', !state.data.handouts[0].description.includes('/desc'));
        state.editingId = 'new-id';
        document.body.innerHTML = renderEdit();
        checks.push(document.querySelector('[data-field="folderId"]').value === 'f1');
        document.querySelector('[data-field="folderId"]').value = '';
        await saveHandoutFromForm();
        checks.push(state.data.handouts[0].folderId === '');
        const editor = document.querySelector('[data-field="description"]');
        editor.innerText = 'Plain text';
        onShadowInput({ target: editor });
        checks.push(document.querySelector('[data-preview="description"]').hidden, getFieldValue('description') === 'Plain text');
        return checks;
      })()`);
    }, funcs);
    result.forEach((pass, i) => assert(pass, `check ${i + 1}`));
    console.log(`Handout editor: ${result.length} checks passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
