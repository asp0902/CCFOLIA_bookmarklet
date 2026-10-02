const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Runs the real legacy/ccfolia-format-sync.user.js in a replica CCFOLIA chat and covers:
//   #105 a rendered <p> that React reuses for another message (tab switch) must never keep a stale overlay,
//   #107 tooltips are shown on hover without being clipped and without growing any scrollable area,
//   #106 rendering does not write the scroll position when nothing moved.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const INVIS_START = '⁣⁣⁣', INVIS_END = '⁢⁢⁢', INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = value => {
  const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  let bits = '';
  for (const char of base64) bits += char.charCodeAt(0).toString(2).padStart(8, '0');
  let out = INVIS_START;
  for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)];
  return out + INVIS_END;
};
const message = (text, formatRuns = [], extra = {}) => text + encode({ text, formatRuns, alignRuns: [], blockStyle: {}, ...extra });
const tooltipMessage = (text, tooltipText) => message(text, [{ start: 0, end: text.length, style: { tooltipText } }]);

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    // Every scenario gets a fresh page: setContent() drops the document's listeners and the script refuses to start twice.
    let page = null;
    let pageUsed = false;
    const openPage = async () => {
      if (page) await page.close();
      page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
    };
    await openPage();
    const item = (index, text) => `<li class="MuiListItem-root" data-index="${index}"><div class="MuiListItemText-root"><p id="p${index}" class="MuiListItemText-secondary">${text}</p></div></li>`;
    const build = async ({ clip = false, tooltips = [] } = {}) => { if (pageUsed) await openPage(); pageUsed = true; return page.setContent(`<style>
      html,body{margin:0;height:100%}body{background:#282828;color:#fff;font:16px sans-serif}
      #app{height:100%;display:flex;overflow:hidden}#main{flex:1}
      .MuiDrawer-paper{width:320px;height:100%;display:flex;flex-direction:column;background:#1b1b1b}
      #list{flex:1;overflow-y:auto;margin:0;padding:0;list-style:none}
      .MuiListItem-root{padding:8px 16px;display:flex}.MuiListItemText-root{margin:6px 0}
      .MuiListItemText-secondary{margin:0;line-height:24px;${clip ? 'overflow:hidden;' : ''}}</style>
      <div id="app"><div id="main"></div><div class="MuiDrawer-paper"><header class="MuiAppBar-root">룸 채팅</header><div role="log"><ul id="list">
      ${Array.from({ length: 24 }, (_, i) => item(i, `메시지 ${i}`)).join('')}${tooltips.join('')}</ul></div></div></div>`); };
    const setNode = (id, value) => page.evaluate(([target, text]) => {
      const p = document.getElementById(target);
      // React updates the text node it owns; before the first render that is the <p>'s child, afterwards it sits in the hidden wrapper.
      const node = p.querySelector(':scope > .ccf-original-hidden')?.firstChild || p.firstChild;
      node.nodeValue = text;
    }, [id, value]);
    const state = id => page.evaluate(target => {
      const p = document.getElementById(target);
      return { overlays: p.querySelectorAll('.ccf-render-overlay').length, root: p.classList.contains('ccf-render-root'), shown: p.innerText.replace(/\s+/g, ' ').trim() };
    }, id);

    // ---- #105 ---------------------------------------------------------------------------------
    await build({ tooltips: [] });
    await page.evaluate(text => { document.getElementById('p0').textContent = text; }, message('굵은 글씨 보통', [{ start: 0, end: 3, style: { bold: true } }]));
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => document.getElementById('p0').classList.contains('ccf-render-root'), null, { timeout: 5000 });
    assert.equal((await state('p0')).shown, '굵은 글씨 보통');

    const sequence = [
      ['다른 탭의 스타일 메시지', message('다른 탭의 스타일 메시지', [{ start: 0, end: 2, style: { italic: true } }])],
      ['그냥 일반 메시지', '그냥 일반 메시지'],
      ['다시 스타일 메시지', message('다시 스타일 메시지', [{ start: 0, end: 2, style: { bold: true } }])],
      ['또 일반 메시지', '또 일반 메시지'],
      ['일반 → 일반', '일반 → 일반'],
      ['마지막 스타일', message('마지막 스타일', [{ start: 0, end: 3, style: { bold: true } }], { blockStyle: { narration: true } })],
    ];
    for (let round = 0; round < 3; round++) {
      for (const [expected, raw] of sequence) {
        await setNode('p0', raw);
        await page.waitForFunction(([target, text]) => document.getElementById(target).innerText.replace(/\s+/g, ' ').trim() === text, ['p0', expected], { timeout: 3000 }).catch(() => {});
        const now = await state('p0');
        assert.equal(now.shown, expected, `round ${round}: "${expected}" is what the element shows (no stale overlay)`);
        assert(now.overlays <= 1, `round ${round}: overlays do not accumulate (${now.overlays})`);
        assert.equal(now.root, raw.includes(INVIS_START), `round ${round}: render root only while the message is encoded`);
      }
    }
    // A plain message must be back to a normal element: nothing hidden left behind.
    await setNode('p0', '끝내는 일반 메시지');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.getElementById('p0').querySelectorAll('.ccf-original-hidden, .ccf-render-overlay').length), 0);

    // ---- #107 ---------------------------------------------------------------------------------
    for (const clip of [false, true]) {
      await build({ clip, tooltips: [
        item(24, 'x'), item(25, 'x'), item(26, 'x'),
      ] });
      await page.evaluate(([a, b, c]) => {
        document.getElementById('p24').textContent = a;
        document.getElementById('p25').textContent = b;
        document.getElementById('p26').textContent = c;
      }, [tooltipMessage('짧은', '짧은 툴팁'), tooltipMessage('긴 툴팁', '매우 긴 툴팁 내용입니다 '.repeat(14)), tooltipMessage('여러 줄', '첫째 줄\n둘째 줄\n셋째 줄')]);
      await page.addScriptTag({ content: source });
      await page.waitForFunction(() => document.querySelectorAll('.ccf-tooltip-frag').length >= 3, null, { timeout: 5000 });
      await page.evaluate(() => { const list = document.getElementById('list'); list.scrollTop = list.scrollHeight; });
      const before = await page.evaluate(() => { const list = document.getElementById('list'); const doc = document.documentElement; return { listW: list.scrollWidth, listH: list.scrollHeight, docW: doc.scrollWidth, docH: doc.scrollHeight, clientH: doc.clientHeight }; });
      for (const [index, expected] of [[0, '짧은 툴팁'], [1, '매우 긴 툴팁 내용입니다'], [2, '첫째 줄\n둘째 줄\n셋째 줄']]) {
        const frag = page.locator('.ccf-tooltip-frag').nth(index);
        await frag.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150); // scroll events land a frame later and (by design) hide an open tooltip
        const box = await frag.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForSelector('.ccf-tooltip-layer[data-open="1"]', { timeout: 2000, state: 'attached' }).catch(async error => { throw new Error(`clip=${clip} tooltip ${index}: layer did not open (frag at ${JSON.stringify(box)}, layer=${await page.evaluate(() => document.querySelector('.ccf-tooltip-layer')?.outerHTML || 'none')})`); });
        const tip = await page.evaluate(() => { const layer = document.querySelector('.ccf-tooltip-layer'); const rect = layer.getBoundingClientRect(); return { text: layer.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, vw: innerWidth, vh: innerHeight, topElement: (() => { const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2; const hit = document.elementFromPoint(x, y); return hit === layer || layer.contains(hit) || hit === null; })() }; });
        assert(tip.text.startsWith(expected.slice(0, 5)), `clip=${clip}: tooltip ${index} shows its own text`);
        assert(tip.left >= 0 && tip.right <= tip.vw && tip.top >= 0 && tip.bottom <= tip.vh, `clip=${clip}: tooltip ${index} stays inside the viewport`);
        // The old ::after layout collapsed multi-line / long tooltips to a 40px column; now the width follows the text.
        assert(tip.width > 45, `clip=${clip}: tooltip ${index} is not squeezed into a narrow column (${tip.width}px)`);
        if (index === 1) assert(tip.width >= 300, `clip=${clip}: a long tooltip uses the available width (${tip.width}px)`);
        await page.mouse.move(5, 5);
        await page.waitForFunction(() => !document.querySelector('.ccf-tooltip-layer[data-open="1"]'), null, { timeout: 2000 });
      }
      const after = await page.evaluate(() => { const list = document.getElementById('list'); const doc = document.documentElement; return { listW: list.scrollWidth, listH: list.scrollHeight, docW: doc.scrollWidth, docH: doc.scrollHeight, clientH: doc.clientHeight }; });
      assert.deepEqual(after, before, `clip=${clip}: hovering tooltips does not change any scrollable area`);
      assert.equal(after.docH, after.clientH, `clip=${clip}: no page-level vertical scrollbar`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ccf-tooltip-frag'), '::after').content), 'none', 'no pseudo-element tooltip is left to inflate layouts');
    }

    // ---- #106 ---------------------------------------------------------------------------------
    await build({ tooltips: [] });
    await page.evaluate(() => {
      const list = document.getElementById('list');
      window.__scrollWrites = 0;
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      Object.defineProperty(list, 'scrollTop', { get() { return descriptor.get.call(this); }, set(value) { window.__scrollWrites++; descriptor.set.call(this, value); }, configurable: true });
      const original = list.scrollTo.bind(list);
      list.scrollTo = (...args) => { window.__scrollWrites++; return original(...args); };
      list.scrollTop = list.scrollHeight; // setup write, not counted below
      window.__scrollWrites = 0;
    });
    await page.evaluate(text => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.dataset.index = '99'; li.innerHTML = `<div class="MuiListItemText-root"><p id="p99" class="MuiListItemText-secondary"></p></div>`; document.getElementById('list').appendChild(li); document.getElementById('p99').textContent = text; }, message('이미 바닥에 있고 높이가 안 바뀜', [{ start: 0, end: 2, style: { bold: true } }]));
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => document.getElementById('p99').classList.contains('ccf-render-root'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const writes = await page.evaluate(() => window.__scrollWrites);
    assert.equal(writes, 0, `a render that does not move the bottom writes no scroll position (wrote ${writes} times)`);
    assert.equal(await page.evaluate(() => { const list = document.getElementById('list'); return Math.abs(list.scrollHeight - list.scrollTop - list.clientHeight) <= 1; }), true, 'still pinned to the bottom');
    assert.equal(await page.evaluate(() => document.getElementById('list').style.scrollBehavior), '', 'the scroller style is left untouched');

    console.log('format-sync lifecycle: stale overlay removed on element reuse (3 rounds), tooltips visible/unclipped/no scroll growth, no needless scroll writes PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
