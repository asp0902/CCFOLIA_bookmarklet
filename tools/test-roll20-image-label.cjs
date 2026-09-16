const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-roll20-css-bridge.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    await page.route('**/*', route => route.request().url().endsWith('.gif')
      ? route.fulfill({ contentType: 'image/gif', headers: { 'access-control-allow-origin': '*' }, body: gif })
      : route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.addScriptTag({ content: source.replace('installDebugApi({ renderMacroHtml })', 'installDebugApi({ renderMacroHtml, preparePayloadForSend, extractEnvelope, createImageFragmentNode, makeGifLoopForever })') });
    const render = text => page.evaluate(value => window.__CCF_ROLL20_BRIDGE_DEBUG__.renderMacroHtml(value), text);
    const macro = '/desc [인트로 페이즈](https://imgur.com/95RxNez.gif)';
    const original = await render(macro);
    assert(original.includes('<img'), 'baseline is an image');
    const background = `/desc [Intro](<#" style="background-image: url('https://i.imgur.com/95RxNez.gif'); background-color: #2A2A2A; background-repeat: no-repeat; background-position: center; background-size: contain; display: block; width: 100%; max-width: 400px; height: 238px; font-size: 0px; cursor: default;>)`;
    const backgroundHtml = await render(background);
    assert(!backgroundHtml.includes('height: 238px; font-size'), 'CSS declarations must not leak into chat text');
    const backgroundStyle = await page.evaluate(html => {
      const box = document.createElement('div');
      box.innerHTML = html;
      const frag = box.querySelector('.ccr20-frag');
      return { text: box.textContent, image: frag.style.backgroundImage, height: frag.style.height, width: frag.style.maxWidth, size: frag.style.backgroundSize };
    }, backgroundHtml);
    assert.deepEqual(backgroundStyle, { text: 'Intro', image: 'url("https://i.imgur.com/95RxNez.gif")', height: '238px', width: '100%', size: 'contain' });
    assert.equal(await render(background.replace(';>)', ';">)')), backgroundHtml, 'closed style attribute also parses');
    const backgroundSent = await page.evaluate(value => {
      const editor = document.createElement('textarea'); document.body.appendChild(editor);
      editor.value = value;
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__;
      api.preparePayloadForSend(editor);
      return api.extractEnvelope(editor.value).envelope;
    }, background);
    assert.equal(backgroundSent.text, 'Intro');
    assert.equal(backgroundSent.formatRuns[0].style.extraCss.height, '238px');
    assert(backgroundSent.formatRuns[0].style.backgroundImage.includes('95RxNez.gif'));
    for (const css of ["background-image: linear-gradient(135deg, rgb(10, 20, 30), #fff); height: 20px;", "background-image: url('https://example.com/a)b.gif'); height: 20px;"]) {
      const html = await render(`/desc [A](#" style="${css})[B](#" style="color: red;)`);
      const result = await page.evaluate(html => {
        const box = document.createElement('div'); box.innerHTML = html;
        return { text: box.textContent, height: box.querySelector('.ccr20-frag').style.height };
      }, html);
      assert.deepEqual(result, { text: 'AB', height: '20px' });
    }
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
    await page.evaluate(() => document.body.appendChild(window.__CCF_ROLL20_BRIDGE_DEBUG__.createImageFragmentNode({ text: 'GIF', style: { imageUrl: 'https://imgur.com/95RxNez.gif' } })));
    await page.waitForFunction(() => { const img = document.querySelector('img.ccr20-image'); return img?.src.startsWith('blob:') && img.complete && img.naturalWidth === 1; });
    const loopCheck = await page.evaluate(async () => {
      const bytes = new Uint8Array(await (await fetch(document.querySelector('img.ccr20-image').src)).arrayBuffer());
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__;
      const index = new TextDecoder('latin1').decode(bytes).indexOf('NETSCAPE2.0');
      const finite = bytes.slice(); finite[index + 13] = 3;
      const repeated = api.makeGifLoopForever(finite);
      let rejectsInvalid = false;
      try { api.makeGifLoopForever(new Uint8Array([1,2,3])); } catch { rejectsInvalid = true; }
      return { count: bytes[index + 13] + 256 * bytes[index + 14], sameSize: api.makeGifLoopForever(bytes).length === bytes.length, finiteReset: repeated[index + 13] === 0, rejectsInvalid };
    });
    assert.deepEqual(loopCheck, { count: 0, sameSize: true, finiteReset: true, rejectsInvalid: true });
    console.log('PASS: CSS background functions and dimensions, image labels, send parity, GIF looping');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
