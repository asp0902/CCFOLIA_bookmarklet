// Participant page: messages with a toolkit format envelope render bold/colour/size/alignment/narration; plain messages stay plain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const START = '\u2063\u2063\u2063', END = '\u2062\u2062\u2062', MAP = ['\u200B', '\u200C', '\u200D', '\u2060'];
function encode(obj) {
  const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0');
  let out = START; for (let i = 0; i < bits.length; i += 2) out += MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)];
  return out + END;
}
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  const text = '굵게 빨강\n가운데';
  const envelope = encode({ v: 1, text, formatRuns: [{ start: 0, end: 2, style: { bold: true } }, { start: 3, end: 5, style: { color: '#ff0000', fontSize: 22 } }], alignRuns: [{ start: 1, end: 2, align: 'center' }], blockStyle: {} });
  const result = await page.evaluate(({ full, plain }) => {
    const a = document.createElement('p'); renderRich(a, full);
    const b = document.createElement('p'); renderRich(b, plain);
    const nar = document.createElement('p');
    return { html: a.outerHTML, lines: [...a.children].map(l => l.textContent), bold: a.querySelector('span')?.style.fontWeight, red: [...a.querySelectorAll('span')].find(s => s.style.color)?.style.color, size: [...a.querySelectorAll('span')].find(s => s.style.fontSize)?.style.fontSize, align: a.children[1].style.textAlign, plain: b.textContent, plainChildren: b.children.length, nar: nar.children.length };
  }, { full: text + envelope, plain: '그냥 글' });
  assert.deepEqual(result.lines, ['굵게 빨강', '가운데']);
  assert.equal(result.bold, '700');
  assert.equal(result.red, 'rgb(255, 0, 0)');
  assert.equal(result.size, '22px');
  assert.equal(result.align, 'center');
  assert.equal(result.plain, '그냥 글');
  assert.equal(result.plainChildren, 0);
  const css = await page.evaluate(({ plain }) => {
    const mk = extraCss => { const el = document.createElement('p'); const env = null; const span = document.createElement('span'); styleSegment(span, { extraCss }); return span.style; };
    const good = mk({ boxShadow: '0 8px 0 15px #c33', fontFamily: 'Georgia', position: 'fixed' });
    const bad = mk({ boxShadow: 'url(javascript:alert(1))', fontFamily: 'a\\b', display: 'flex' });
    return { shadow: good.boxShadow, family: good.fontFamily, position: good.position, badShadow: bad.boxShadow, badFamily: bad.fontFamily, badDisplay: bad.display };
  }, { plain: '' });
  assert.ok(css.shadow.includes('15px'));
  assert.equal(css.family, 'Georgia');
  assert.equal(css.position, '');
  assert.equal(css.badShadow, '');
  assert.equal(css.badFamily, '');
  assert.equal(css.badDisplay, '');
  await browser.close();
  console.log('participant rich text (envelope: bold, colour, size, align, extraCss) PASS');
})().catch(error => { console.error(error); process.exit(1); });
