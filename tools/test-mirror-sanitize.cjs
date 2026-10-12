// Native mirroring: what may pass from the GM's CCFOLIA page to the participant page (CSS and DOM templates).
(async () => {
  const assert = require('node:assert/strict');
  const m = await import('../prototype/public-handout-relay/public/mirror-sanitize.mjs');
  // CSS: no import, no script-ish values, url() only to allowed places
  const css = m.cleanCss('@import url(x.css); .a{background:url("https://evil.com/a.png")} .b{background:url(data:image/png;base64,AA)} .c{width:expression(alert(1))} .d{x:javascript:1} @font-face{src:url(https://fonts.gstatic.com/s/a.woff2)} .e{background:url(/static/media/x.svg)}');
  assert(!/@import|evil|expression\(|javascript:/i.test(css), css);
  assert(css.includes('url(data:image/png;base64,AA)') && css.includes('url(https://fonts.gstatic.com/s/a.woff2)'));
  assert(css.includes('.e{background:none}'), 'relative and unknown urls become none');
  // templates: tags/attributes allow list, text escaped, slots kept
  const html = m.cleanTemplateHtml('<div class="a b" onclick="x()" id="q" data-x="1" style="color:red;background:url(http://evil/x.png)" data-cm-slot="name"><script>alert(1)</script><iframe src="http://x"></iframe><svg viewBox="0 0 24 24"><path d="M0 0"/><path d="M1 1"/></svg><img src="http://x" alt="a"><a href="javascript:x()">t</a><b>x<i>y</div><p>&lt;&amp; < ok</p>');
  assert(!/onclick|id=|data-x|script|iframe|src=|href=|alert|evil/.test(html), html);
  assert(html.includes('data-cm-slot="name"') && html.includes('class="a b"') && html.includes('color:red'));
  assert(html.includes('<path d="M0 0"/><path d="M1 1"/>'), 'svg shapes are closed so siblings are not nested');
  assert(html.includes('&lt;') && !html.includes('< ok'), 'stray < is text');
  // limits and fonts
  assert.equal(m.validateMirror({ css: 'x'.repeat(m.MIRROR_LIMITS.css + 1) }).error, 'css too large');
  assert.equal(m.validateMirror({ templates: { 'bad name': '<div></div>' } }).error, 'bad template name');
  assert.equal(m.validateMirror({ templates: { a: 'x'.repeat(m.MIRROR_LIMITS.tplEach + 1) } }).error, 'template too large');
  assert.equal(m.validateMirror({ templates: Object.fromEntries(Array.from({ length: 61 }, (_, i) => ['t' + i, '<div></div>'])) }).error, 'too many templates');
  const ok = m.validateMirror({ css: 'a{}', templates: { row: '<div>x</div>' }, fontLinks: ['https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap', 'https://evil.com/x.css'] });
  assert.deepEqual(ok.fontLinks, ['https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap']);
  assert.equal(m.validateMirror({ templates: null }).templates, null);
  assert.equal(m.mirrorHash('abc'), m.mirrorHash('abc')); assert.notEqual(m.mirrorHash('abc'), m.mirrorHash('abd'));
  console.log('mirror sanitize PASS');
})().catch(e => { console.error(e); process.exit(1); });
