// handout 0.1.118: an image pasted / dropped into a handout body was inserted as its storage token (<img src="ccf-ho-image://room/id">), which a browser cannot draw:
// the editor showed a broken-image icon. The editor now resolves it at once (the token is kept on the image), and the saved body still carries the token, not the temporary address.
// The real functions (resolveHandoutImagesIn, getFieldValue) in a page; the token resolver is a stand-in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8');
const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a + 1); assert(a >= 0 && b > a, 'code not found: ' + from); return source.slice(a, b); };
const code = [
  slice('  function resolveHandoutImagesIn(root) {', '  // HTML 안의 <img src="data:image/..."> 를'),
  slice('  function renderEditorMacro(editor) {', '  // 원문과 커서를 유지한 채'),
  slice('  function getFieldValue(name) {', '  async function saveHandoutFromForm() {')
].join('\n');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="host"></div>');
    const out = await page.evaluate(async ({ code, PIXEL }) => {
      const host = document.getElementById('host');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div class="rich-editor" contenteditable="true" data-field="description">앞 글 <img src="ccf-ho-image://room/img1"> 뒷 글</div>';
      const run = new Function('state', 'HANDOUT_IMAGE_TOKEN_PREFIX', 'resolveHandoutImageToken', `${code}; return { resolveHandoutImagesIn, getFieldValue };`);
      const api = run({ shadow }, 'ccf-ho-image://', async () => PIXEL);
      const editor = shadow.querySelector('.rich-editor');
      api.resolveHandoutImagesIn(editor);
      await new Promise((r) => setTimeout(r, 50));
      const img = editor.querySelector('img');
      await new Promise((r) => (img.complete ? r() : (img.onload = r)));
      return { shown: img.getAttribute('src') === PIXEL, width: img.naturalWidth, saved: api.getFieldValue('description'), editorStill: editor.querySelector('img').getAttribute('src') === PIXEL };
    }, { code, PIXEL });
    assert.equal(out.shown, true, 'the editor shows the real image'); assert.equal(out.width, 1, 'and it loads');
    assert.match(out.saved, /<img src="ccf-ho-image:\/\/room\/img1">/, 'the saved body keeps the token: ' + out.saved);
    assert(!/data:image|blob:|data-ccf-ho/.test(out.saved), 'no temporary address or helper attribute in the saved body');
    assert.equal(out.editorStill, true, 'saving does not touch what the editor shows');
    // the paste handler resolves right after inserting the uploaded token (and drop uses the same path)
    assert.match(slice('  function insertEditorImageFile(editor, file) {', '  function onShadowDrop(event) {'), /execEditor\(editor, "insertImage", url\);\s*resolveHandoutImagesIn\(editor\);/);
    assert.match(source, /shadow\.addEventListener\("drop", onShadowDrop\)/, 'drop is handled');
    console.log('handout editor image PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
