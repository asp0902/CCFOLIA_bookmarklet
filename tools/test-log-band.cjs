const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// The log editor / Tistory export must show a Roll20 colour-band macro (box-shadow: 0 8px 0 15px) like CCFOLIA: the band is not
// clipped by the bubble and the text sits in its centre.
const read = file => fs.readFileSync(path.join(__dirname, '..', ...file), 'utf8');
const bridge = read(['legacy', 'ccfolia-roll20-css-bridge.user.js']);
const logPackage = read(['legacy', 'ccfolia-log-package.user.js']);
const editor = read(['log editor', 'index.html']).replace(/\r\n/g, '\n');
const MACRO = `[내용](#" style="color: #ffffff; background-color:#9BCFC4; font-weight:bold; text-align:center; display:block; padding:2px; box-shadow: 0px 8px 0px 15px #9BCFC4;)`;

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const open = async () => {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      return page;
    };
    const first = await open();
    await first.addScriptTag({ content: bridge.replace('installDebugApi({ renderMacroHtml })', 'installDebugApi({ renderMacroHtml, preparePayloadForSend, extractEnvelope })') });
    const envelope = await first.evaluate(text => {
      const box = document.createElement('textarea'); document.body.append(box); box.value = text;
      const api = window.__CCF_ROLL20_BRIDGE_DEBUG__; api.preparePayloadForSend(box);
      return api.extractEnvelope(box.value).envelope;
    }, MACRO);
    const start = logPackage.indexOf('  function buildRenderedMessageHtml(');
    const end = logPackage.indexOf('  function findLogMessageElements(');
    assert(start >= 0 && end > start, 'log renderer not found');
    // the two CSS rules that matter for the bubble, taken from the real editor stylesheet (editor list and Tistory export)
    const bubbleRules = [...editor.matchAll(/[^{}]*\.ccf-render-root\.ccf-roll20-bubble \{[^}]*\}/g)].map(m => m[0]);
    assert.equal(bubbleRules.length, 2, 'editor and Tistory bubble rules');
    for (const rule of bubbleRules) assert(!/overflow:\s*hidden/.test(rule.replace(/\/\*[\s\S]*?\*\//g, '')), 'bubble rule must not clip with overflow: hidden');
    const page = await open();
    const result = await page.evaluate(({ code, envelope, css }) => {
      const build = new Function(`${code}; return buildRenderedMessageHtml;`)();
      document.head.append(Object.assign(document.createElement('style'), { textContent: `body{margin:0;background:#fafafa}.wrap{padding:30px 24px}${css}.ccf-line{display:block}` }));
      document.body.innerHTML = `<div class="wrap" id="wrap">${build({ text: envelope.text, formatRuns: envelope.formatRuns, alignRuns: envelope.alignRuns, blockStyle: {}, baseColor: '', roll20Macro: true, roll20Background: 'transparent' })}</div>`;
      const frag = document.querySelector('.ccf-frag'), rect = frag.getBoundingClientRect(), wrap = document.getElementById('wrap').getBoundingClientRect();
      const bubble = getComputedStyle(document.querySelector('.ccf-roll20-bubble'));
      return { overflowY: bubble.overflowY, overflowX: bubble.overflowX, shadow: getComputedStyle(frag).boxShadow, bandTop: rect.top - 15 - (wrap.top + 30), bandBottom: rect.bottom + 15 - (wrap.top + 30), box: rect.height, flow: wrap.height - 60, centred: (rect.top + rect.bottom) / 2 === (rect.top - 15 + rect.bottom + 15) / 2 };
    }, { code: logPackage.slice(start, end), envelope, css: bubbleRules.join('\n') });
    assert.equal(result.overflowY, 'visible');
    assert.match(result.shadow, /0px 0px 0px 15px$/, 'y offset moved out of the shadow');
    assert.equal(result.bandTop, -7, 'band top unchanged');
    assert.equal(result.bandBottom, result.box + 23, 'band bottom unchanged');
    assert.equal(result.flow, result.box, 'following content is not pushed');
    assert(result.centred, 'text centred in band');
    console.log('log editor: colour band shown like CCFOLIA (not clipped, text centred) PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
