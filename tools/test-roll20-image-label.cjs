const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source.replace('installDebugApi({ renderMacroHtml })', 'installDebugApi({ renderMacroHtml, preparePayloadForSend, extractEnvelope })') });
    const render = text => page.evaluate(value => window.__CCF_ROLL20_BRIDGE_DEBUG__.renderMacroHtml(value), text);
    const macro = '/desc [인트로 페이즈](https://imgur.com/95RxNez.gif)';
    const original = await render(macro);
    assert(original.includes('<img'), 'baseline is an image');
    for (const suffix of [' @인트로', ' @인트로 페이즈', ' @intro  ']) {
      assert.equal(await render(macro + suffix), original, 'standing label must not affect rendered HTML');
    }
    const email = '/desc [name@example.com](https://example.com/@user/image.gif)';
    const preserved = await render(email);
    assert(preserved.includes('name@example.com'));
    assert(preserved.includes('/@user/image.gif'));
    assert.equal(await render(email + ' @label'), preserved);
    assert.notEqual(await render(macro + ' ordinary text'), original, 'ordinary trailing text is not a standing label');
    assert.equal(await render(macro + ' @인트로\n' + macro + ' @다음'), await render(macro + '\n' + macro));
    const sent = await page.evaluate(value => {
      const editor = document.createElement('textarea');
      document.body.appendChild(editor);
      editor.value = value;
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__;
      api.preparePayloadForSend(editor);
      const once = editor.value;
      api.preparePayloadForSend(editor);
      return { once, twice: editor.value, envelope: api.extractEnvelope(editor.value).envelope };
    }, macro + ' @인트로');
    assert(sent.once.endsWith(' @인트로'), 'native cut-in trigger is transmitted alongside the inline GIF');
    assert.equal(sent.once, sent.twice, 'Enter and click handlers preserve the image payload');
    assert.equal(sent.envelope.text, '인트로 페이즈', 'rendered content excludes the trigger');
    assert.equal(sent.envelope.standingSuffix, '@인트로');
    assert(sent.envelope.formatRuns.some(run => run.style.imageUrl === 'https://imgur.com/95RxNez.gif'), 'inline GIF URL is preserved');
    console.log('PASS: image label rendering parity, multiline labels, preserved link content');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
