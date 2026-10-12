// Participant message rows: a message from the same speaker as the one above is merged (no avatar/header), an edited message ends with [편집 완료], time is #757575.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'relay.test') return route.abort();
    const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('http://relay.test/#room=x');
  await page.evaluate(() => {
    document.getElementById('room').inert = false; document.getElementById('gate').style.display = 'none';
    renderState({ roomTitle: 't', gmOnline: true, channels: [{ id: 'main', label: '메인' }], messages: [
      { id: '1', author: 'A', text: '첫', channel: 'main', createdAt: '2026-10-08T01:00:00Z' },
      { id: '2', author: 'A', text: '같은 화자', channel: 'main', createdAt: '2026-10-08T03:00:00Z', edited: true },
      { id: '3', author: 'B', text: '다른 화자', channel: 'main', createdAt: '2026-10-08T03:01:00Z' },
      { id: '4', author: 'A', text: '다시 A', channel: 'main', createdAt: '2026-10-08T03:02:00Z' }] });
  });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#messages li')].map(li => ({ merged: li.classList.contains('merged'), head: getComputedStyle(li.querySelector('h6')).display, edited: li.querySelector('.msg-edited')?.textContent || '' })));
  assert.deepEqual(rows.map(r => r.merged), [false, true, false, false], 'only a run of the same speaker is merged');
  assert.equal(rows[1].head, 'none'); assert.equal(rows[0].head, 'block');
  assert.equal(rows[1].edited, ' [편집 완료]'); assert.equal(rows[0].edited, '');
  const color = await page.evaluate(() => getComputedStyle(document.querySelector('#messages .msg-time')).color + '|' + getComputedStyle(document.querySelector('.msg-edited')).color);
  assert.equal(color, 'rgb(117, 117, 117)|rgb(117, 117, 117)');
  // time like CCFOLIA (date-fns formatRelative, Japanese): today / yesterday / weekday of the last days / date only
  const times = await page.evaluate(() => { const now = new Date(2026, 9, 12, 12, 0); const at = (day, h, m) => new Date(2026, 9, day, h, m).toISOString(); return [messageTime(at(12, 9, 5), now), messageTime(at(11, 23, 10), now), messageTime(at(7, 20, 14), now), messageTime(at(6, 20, 14), now), messageTime(at(5, 20, 14), now), messageTime(at(2, 11, 34), now)]; });
  assert.deepEqual(times, ['今日 9:05', '昨日 23:10', '先週 水曜日 20:14', '先週 火曜日 20:14', '2026/10/05', '2026/10/02']);
  // an envelope may stand before the visible text (Roll20 header rows); a stale envelope (edited text) shows the visible text plain
  const START = '⁣⁣⁣', END = '⁢⁢⁢', MAP = ['​', '‌', '‍', '⁠'];
  const encode = obj => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = START; for (let i = 0; i < bits.length; i += 2) out += MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + END; };
  const env = encode({ v: 1, text: '내용', formatRuns: [{ start: 0, end: 2, style: { bold: true, backgroundColor: 'rgb(155, 207, 196)' } }], alignRuns: [], blockStyle: {} });
  const decoded = await page.evaluate(([front, stale]) => { const a = document.createElement('p'), b = document.createElement('p'); renderRich(a, front); renderRich(b, stale); return { frontBg: a.querySelector('span')?.style.backgroundColor, frontText: a.textContent, staleText: b.textContent, staleSpan: !!b.querySelector('span') }; }, [env + '내용', '바뀐 글' + env]);
  assert.equal(decoded.frontText, '내용'); assert.equal(decoded.frontBg, 'rgb(155, 207, 196)', 'envelope in front of the text still formats it');
  assert.equal(decoded.staleText, '바뀐 글'); assert.equal(decoded.staleSpan, false, 'an envelope that no longer matches the text is not applied');
  // dice result colours as CCFOLIA's chat row does (from its code): success primary, failure and secret dice secondary, no flag dimmer; Japanese words decide when there are no flags
  const colours = await page.evaluate(() => [{ result: 'r', success: true }, { result: 'r', failure: true }, { result: '(1D100) ＞ 3' }, { result: '判定 成功' }, { result: '判定 失敗' }, { result: 'x', secret: true }].map(roll => rollResultSpan(roll).style.color || 'default'));
  assert.deepEqual(colours, ['rgb(33, 150, 243)', 'rgb(220, 0, 78)', 'default', 'rgb(33, 150, 243)', 'rgb(220, 0, 78)', 'rgb(220, 0, 78)']);
  // toolkit mode: the same classes and attributes the toolkit scripts use, so the toolkit's CSS from mirror.css lays narration / macro rows out
  const narr = encode({ v: 1, text: '내용', formatRuns: [], alignRuns: [], blockStyle: { narration: true } });
  const dom = await page.evaluate(full => { const p = document.createElement('p'); const info = renderRich(p, full, true); return { info, cls: p.className, narration: p.dataset.ccfNarration, rendered: p.dataset.ccfRendered, overlay: !!p.querySelector(':scope > .ccf-render-overlay > .ccf-line'), italic: p.querySelector('.ccf-line').style.fontStyle || '', center: p.querySelector('.ccf-line').style.textAlign || '' }; }, '내용' + narr);
  assert.equal(dom.info.narration, true); assert.equal(dom.cls, 'ccf-render-root'); assert.equal(dom.narration, '1'); assert.equal(dom.rendered, '1'); assert.equal(dom.overlay, true);
  assert.equal(dom.italic, '', 'the look comes from the toolkit CSS, not from inline styles'); assert.equal(dom.center, '');
  const plain = await page.evaluate(full => { const p = document.createElement('p'); renderRich(p, full, true); return { cls: p.className, text: p.textContent }; }, '그냥' + encode({ v: 1, text: '그냥', formatRuns: [], alignRuns: [], blockStyle: {} }));
  assert.deepEqual(plain, { cls: '', text: '그냥' }, 'a formatting-free envelope is plain text');
  // a Roll20 macro band (envelope roll20Macro + narration block): drawn with the roll20-css-bridge's names and band centring so its CSS makes it a full-width bar without avatar
  const band = encode({ v: 1, source: 'ccr20-roll20-desc', text: '내용', formatRuns: [{ start: 0, end: 2, style: { bold: true, color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(155, 207, 196)', display: 'block', padding: '2px', textAlign: 'center', extraCss: { boxShadow: 'rgb(155, 207, 196) 0px 8px 0px 15px' } } }], alignRuns: [{ start: 0, end: 1, align: 'center' }], blockStyle: { narration: true }, roll20Macro: true, roll20Background: 'transparent' });
  const bandDom = await page.evaluate(full => { const p = document.createElement('p'); const info = renderRich(p, full, true); const frag = p.querySelector('.ccr20-frag'); return { info, cls: p.className, bg: p.dataset.ccr20MacroBackground, narration: p.dataset.ccfNarration, line: p.querySelector('.ccr20-line').style.textAlign, band: frag.getAttribute('data-ccr20-band'), shadow: frag.style.boxShadow, clip: frag.style.clipPath, margin: frag.style.marginTop + '|' + frag.style.marginBottom, display: frag.style.display, width: frag.style.width, overflow: frag.style.overflow }; }, '내용' + band);
  assert.equal(bandDom.info.bubble, true); assert.equal(bandDom.info.narration, true);
  assert(bandDom.cls.includes('ccr20-render-root') && bandDom.cls.includes('ccr20-roll20-bubble') && bandDom.cls.includes('ccf-render-root'));
  assert.equal(bandDom.bg, 'transparent'); assert.equal(bandDom.narration, '1'); assert.equal(bandDom.line, 'center'); assert.equal(bandDom.band, '1');
  assert.equal(bandDom.shadow, 'rgb(155, 207, 196) 0px 0px 0px 15px'); assert.equal(bandDom.clip, 'inset(-7.5px -15px)'); assert.equal(bandDom.margin, '7.5px|7.5px'); assert.equal(bandDom.display, 'block'); assert.equal(bandDom.width, 'auto'); assert.equal(bandDom.overflow, 'hidden');
  // prose mode grouping like the toolkit: same displayed name as the row above = continued; narration rows are a separate group
  const groups = await page.evaluate(() => {
    const make = (name, narration) => { const w = document.createElement('div'); w.innerHTML = `<div class="MuiListItem-root"${narration ? ' data-ccf-narration="1"' : ''}><h6 data-cm-slot="name"></h6></div>`; w.querySelector('h6').append(document.createTextNode(name)); return w; };
    const rows = [make('A'), make('A'), make('A'), make('B'), make('A', true), make('A', true)];
    markSpeakerRuns(rows);
    return rows.map(w => ['data-ccf-prose-cont', 'data-ccf-prose-cont-leader', 'data-ccf-prose-cont-last'].map(a => (w.firstElementChild.hasAttribute(a) ? 1 : 0)).join('') + '/' + (w.hasAttribute('data-ccf-prose-cont-wrap') ? 1 : 0));
  });
  assert.deepEqual(groups, ['010/0', '100/1', '101/1', '000/0', '010/0', '101/1'], 'A A A | B | narration A A');
  await browser.close();
  console.log('participant message rows PASS');
})().catch(error => { console.error(error); process.exit(1); });
