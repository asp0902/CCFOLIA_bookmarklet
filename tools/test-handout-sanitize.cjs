// What a participant is shown of a handout: allow-listed tags, safe styles, https links, images only as small data URIs or from CCFOLIA's CDN; nothing that runs.
(async () => {
  const assert = require('node:assert/strict');
  const m = await import('../prototype/public-handout-relay/public/handout-sanitize.mjs');
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const html = m.cleanHandoutHtml(`<p class="a b" onclick="x()" style="color:red;background:url(http://evil/x.png);position:fixed;font-size:14px">hi <b>b</b> <script>alert(1)</script><iframe src="http://x"></iframe></p><a href="javascript:x()">bad</a><a href="https://example.com/a?b=1">ok</a><img src="http://evil/i.png"><img src="${png}" alt="a" onerror="x()"><img src="https://storage.ccfolia-cdn.net/a/b.png"><svg><circle/></svg><form><input></form><table><tr><td colspan="2">c</td></tr></table><h2>t</h2><x-custom>y</x-custom>& < ok`);
  assert(!/onclick|onerror|script|iframe|javascript|evil|position|svg|form|input|<x-custom/.test(html), html);
  assert(html.includes('style="color:red;font-size:14px"') && html.includes('class="a b"'), 'safe style kept, unsafe dropped');
  assert(html.includes('<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">ok</a>'), 'https link, new tab');
  assert(/<a>bad<\/a>/.test(html), 'a javascript: link keeps its text only');
  assert.equal((html.match(/<img /g) || []).length, 2, 'data URI and CCFOLIA CDN images stay');
  assert(html.includes('<span class="handout-missing-image">[이미지]</span>'), 'other images become a marker');
  assert(html.includes('<td colspan="2">c</td>') && html.includes('<h2>t</h2>') && html.includes('&amp; &lt; ok'));
  // unclosed tags are closed, stray text is escaped
  assert.equal(m.cleanHandoutHtml('<p><b>x'), '<p><b>x</b></p>');
  // items: an id is required, secret part separate, bounded
  assert.equal(m.cleanHandoutItem({ title: 'no id' }), null);
  const item = m.cleanHandoutItem({ id: 'h-1', title: 't'.repeat(500), html: '<p>a</p>', secretHtml: '<p>s</p><script>x</script>', folder: '폴더', order: 2.4, updatedAt: '2026-10-13T00:00:00Z' });
  assert.deepEqual([item.id, item.title.length, item.html, item.secretHtml, item.folder, item.order], ['h-1', 200, '<p>a</p>', '<p>s</p>', '폴더', 2]);
  const list = m.cleanHandoutList(Array.from({ length: 100 }, (_, i) => ({ id: 'h' + i, html: '<p>x</p>' })));
  assert.equal(list.length, m.HANDOUT_LIMITS.itemsPerPerson);
  const big = m.cleanHandoutList([{ id: 'a', html: '<p>' + 'x'.repeat(590000) + '</p>' }, { id: 'b', html: '<p>' + 'x'.repeat(590000) + '</p>' }, { id: 'c', html: '<p>' + 'x'.repeat(590000) + '</p>' }, { id: 'e', html: '<p>' + 'x'.repeat(590000) + '</p>' }, { id: 'd', html: '<p>small</p>' }]);
  assert.deepEqual(big.map(i => i.id), ['a', 'b', 'c', 'd'], 'the total budget skips what does not fit and keeps the order');
  assert(big.reduce((sum, i) => sum + i.html.length, 0) <= m.HANDOUT_LIMITS.totalPerPerson);
  console.log('handout sanitize PASS');
})().catch(error => { console.error(error); process.exit(1); });
