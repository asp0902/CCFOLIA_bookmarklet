// The Roll20 CSS handout macro (docs/roll20-handout-macro.md, fixed text below): the bridge turns it into runs (4 pictures, the red 【사명】, 8 centred /desc lines), format-sync draws it like Roll20
// (pictures at full width, blocks reaching over their neighbours, no strip of the message between the lines), the Roll20 reader rebuilds the macro text from Roll20's message markup and the same
// conversion gives the same result, and the play room draws the envelope with its own renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const read = file => fs.readFileSync(path.join(__dirname, '..', ...file.split('/')), 'utf8');
const bridge = read('legacy/ccfolia-roll20-css-bridge.user.js'), formatSync = read('legacy/ccfolia-format-sync.user.js'), reader = read('extension/personal/roll20-reader.js');
const MACRO = [
  '/desc [.](#" style="display:block; height:0; padding-top:44.54%; margin:-14px -10px -44.54%; background-color:#000; font-size:0; color:transparent;")[x](https://i.imgur.com/aBnOCE4.png)[.](#" style="display:block; height:46px; margin:-8px -10px -38px; background-color:#000; font-size:0; color:transparent;")[x](https://i.imgur.com/8AoANzm.png)',
  '/desc [.](#" style="display:block; height:20px; margin:-14px -10px -8px; padding:6px 0 8px; background-color:#000; font-size:0; color:transparent;")',
  '/desc [PC](#" style="display:block; margin:-14px -10px 0; padding:14px 10px 0; background-color:#000; color:#009688 !important; text-decoration:none; font-style:normal; font-weight:bold; font-size:16px;")[공개 정보](#" style="display:block; margin:0 -10px -8px; padding:5px 10px 8px; background-color:#000; color:#727272 !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:12px;")',
  '/desc [.](#" style="display:block; height:83px; margin:-14px -10px -83px; padding:6px 0 8px; background-color:#000; font-size:0; color:transparent;")[x](https://i.imgur.com/gbGv9gg.png)',
  '/desc [당신은 GMPC와 함께 「나나헬 파크」라는](#" style="display:block; margin:-14px -10px 0; padding:14px 10px 0; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")[묘한 놀이공원에 오게 되었다.](#" style="display:block; margin:0 -10px; padding:0 10px; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")[손님은 우리뿐이고,](#" style="display:block; margin:0 -10px; padding:4px 10px 0; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")[\'7대 죄악\'이 테마라고 하는 이 장소⋯⋯](#" style="display:block; margin:0 -10px; padding:0 10px; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")[기묘하다.](#" style="display:block; margin:0 -10px; padding:0 10px; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")[게다가 손목까지 GMPC와 서로](#" style="display:block; margin:0 -10px; padding:4px 10px 0; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")[수갑에 묶여버리지 않았는가?](#" style="display:block; margin:0 -10px -8px; padding:0 10px 8px; background-color:#000; color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:normal; font-size:14px;")',
  '/desc [.](#" style="display:block; height:20px; margin:-14px -10px -8px; padding:6px 0 8px; background-color:#000; font-size:0; color:transparent;")',
  '/desc [.](#" style="display:block; height:36px; margin:-14px -10px -22px; background-color:#000; font-size:0; color:transparent;")[당신의](#" style="color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:bold; font-size:14px;")[【사명】](#" style="color:#E53935 !important; text-decoration:none; font-style:normal; font-weight:bold; font-size:14px;")[은 \'파크에서 탈출하는 것\'이다.](#" style="color:#FAFAFA !important; text-decoration:none; font-style:normal; font-weight:bold; font-size:14px;")[.](#" style="display:block; height:8px; margin:0 -10px -8px; background-color:#000; font-size:0; color:transparent;")',
  '/desc [.](#" style="display:block; height:20px; margin:-14px -10px -8px; padding:6px 0 8px; background-color:#000; font-size:0; color:transparent;")',
  '/desc [.](#" style="display:block; height:0; padding-top:28.78%; border-top:6px solid #000; margin:-14px -10px -28.78%; padding-bottom:16px; background-color:#000; font-size:0; color:transparent;")[x](https://i.imgur.com/7PBP6ds.png)'
].join('\n');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = value => {
  let bits = '';
  for (const char of Buffer.from(JSON.stringify(value), 'utf8').toString('base64')) bits += char.charCodeAt(0).toString(2).padStart(8, '0');
  let out = '⁣⁣⁣';
  for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)];
  return out + '⁢⁢⁢';
};
// the pictures of the macro (any address of its host): sized like the designer meant (full width pictures, a small sparkle)
const svgFor = url => { const sizes = { aBnOCE4: [1000, 445], '8AoANzm': [1000, 86], gbGv9gg: [200, 83], '7PBP6ds': [1000, 288] }; const key = Object.keys(sizes).find(k => url.includes(k)); const [w, h] = sizes[key] || [10, 10]; return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#555"/><text x="50%" y="55%" fill="#fff" font-size="${Math.round(h / 4)}" text-anchor="middle">${key}</text></svg>`; };

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const open = async () => {
      const page = await browser.newPage({ viewport: { width: 560, height: 1300 } });
      await page.route('**/*', route => /\.png/.test(route.request().url()) ? route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: svgFor(route.request().url()) }) : route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body></body>' }));
      await page.goto('https://ccfolia.com/rooms/test');
      return page;
    };
    // 1. the conversion
    const first = await open();
    await first.addScriptTag({ content: bridge.replace('installDebugApi({ renderMacroHtml })', 'installDebugApi({ renderMacroHtml, preparePayloadForSend, extractEnvelope })') });
    const converted = await first.evaluate(text => { const api = window.__CCF_ROLL20_BRIDGE_DEBUG__; const full = api.macroToText(text); return { full, envelope: api.extractEnvelope(full).envelope }; }, MACRO);
    const envelope = converted.envelope;
    assert.equal(envelope.roll20Macro, true);
    const images = envelope.formatRuns.filter(run => run.style.imageUrl);
    assert.deepEqual(images.map(run => run.style.imageUrl), ['aBnOCE4', '8AoANzm', 'gbGv9gg', '7PBP6ds'].map(id => `https://i.imgur.com/${id}.png`), 'four pictures, in order');
    const lines = envelope.text.split('\n');
    assert.equal(lines.length, 9, 'nine /desc lines');
    assert(lines.every((_, index) => envelope.alignRuns.some(run => run.align === 'center' && run.start <= index && run.end > index)), 'every /desc line is centred');
    const red = envelope.formatRuns.find(run => envelope.text.slice(run.start, run.end) === '【사명】');
    assert.equal(red.style.color.toLowerCase(), 'rgb(229, 57, 53)'); assert(red.style.bold);
    const spacer = envelope.formatRuns.find(run => run.style.extraCss?.paddingTop === '44.54%');
    assert.deepEqual([spacer.style.display, spacer.style.extraCss.marginTop, spacer.style.extraCss.marginBottom, spacer.style.extraCss.height], ['block', '-14px', '-44.54%', '0px'], 'percent padding and negative margins survive');
    const border = envelope.formatRuns.find(run => run.style.extraCss?.borderTop);
    assert.match(border.style.extraCss.borderTop, /^6px solid/);
    assert(!/url\(|position|expression/i.test(JSON.stringify(envelope.formatRuns.map(run => run.style.extraCss || {}))), 'nothing outside the allowed CSS');
    assert(!envelope.text.includes('](http'), 'no raw link text is left in the message');

    // 2. format-sync draws it
    const render = async withBridge => {
      const page = await open();
      await page.setContent('<style>body{margin:0;background:#222;color:#fff;font:14px sans-serif}.MuiDrawer-paper{width:460px;padding:8px 0}li{list-style:none;padding:8px 16px}ul{margin:0;padding:0}</style><div class="MuiDrawer-paper"><div role="log"><ul><li class="MuiListItem-root"><div class="MuiListItemText-root"><p id="p0" class="MuiListItemText-secondary" style="margin:0"></p></div></li></ul></div></div>');
      await page.evaluate(text => { document.getElementById('p0').textContent = text; }, converted.full);
      await page.addScriptTag({ content: formatSync });
      if (withBridge) await page.addScriptTag({ content: bridge });
      await page.waitForFunction(() => document.getElementById('p0').classList.contains('ccf-render-root'), null, { timeout: 8000 });
      await page.waitForTimeout(600);
      const info = await page.evaluate(() => {
        const p = document.getElementById('p0'), box = p.getBoundingClientRect();
        const imgs = [...p.querySelectorAll('img')].map(img => ({ w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) }));
        const lines = [...p.querySelectorAll('.ccf-line')].map(line => ({ flush: line.classList.contains('ccf-line-flush'), bg: line.style.backgroundColor }));
        return { box: [Math.round(box.width), Math.round(box.height)], imgs, lines, flushAttr: p.getAttribute('data-ccf-macro-flush'), visible: p.innerText.includes('](http'), blackRows: (() => { const rows = []; return rows; })() };
      });
      return { page, info };
    };
    for (const [label, withBridge] of [['format-sync', false], ['format-sync + bridge', true]]) {
      const { page, info } = await render(withBridge);
      assert.equal(info.imgs.length, 4, `${label}: four pictures drawn`);
      assert.equal(info.visible, false, `${label}: no raw link text`);
      assert.equal(info.flushAttr, '1', `${label}: the row closes up with its neighbours`);
      assert(info.lines.every(line => line.flush && line.bg === 'rgb(0, 0, 0)'), `${label}: every line sits in the padding Roll20 gives it and is filled black (no strip between lines)`);
      assert(info.imgs[0].w >= info.box[0] - 24, `${label}: the first picture takes the full width (${info.imgs[0].w} of ${info.box[0]})`);
      assert(info.imgs[3].w >= info.box[0] - 24, `${label}: the last picture takes the full width`);
      assert(info.imgs[2].w < info.box[0] / 2, `${label}: the small sparkle keeps its own size`);
      // no light strip between the lines: scan the painted column in the middle of the message
      const strips = await page.evaluate(() => { const p = document.getElementById('p0'), r = p.getBoundingClientRect(); const canvasless = []; for (let y = Math.floor(r.top) + 2; y < r.bottom - 2; y += 4) { const el = document.elementFromPoint(r.left + 6, y); const bg = el ? getComputedStyle(el).backgroundColor : ''; if (!/^rgb\(0, 0, 0\)$/.test(bg)) canvasless.push([y - Math.floor(r.top), el && el.className.toString().slice(0, 30), bg]); } return canvasless; });
      assert.equal(strips.length, 0, `${label}: black all the way down at the left edge (${JSON.stringify(strips.slice(0, 3))})`);
      await page.close();
    }

    // 3. the Roll20 reader rebuilds the macro text from Roll20's markup, and the conversion gives the same result
    const r20 = await browser.newPage();
    await r20.route('https://app.roll20.net/editor/', route => route.fulfill({ contentType: 'text/html', body: '<script>var campaign_id = 22089717;</script><div id="textchat"><div class="content"></div></div>' }));
    await r20.goto('https://app.roll20.net/editor/');
    await r20.evaluate(() => { window.sent = []; window.chrome = { runtime: { id: 'x', sendMessage: async m => { window.sent.push(m); } } }; });
    await r20.evaluate(reader);
    await r20.waitForTimeout(3300);
    const style1 = 'display:block; height:0; padding-top:44.54%; margin:-14px -10px -44.54%; background-color:#000; font-size:0; color:transparent;';
    await r20.evaluate(({ style1 }) => {
      const add = html => document.querySelector('#textchat .content').insertAdjacentHTML('beforeend', html);
      add(`<div class="message desc" data-messageid="d1"><a href="#" style="${style1}">.</a><img src="https://i.imgur.com/aBnOCE4.png"><a href="#" style="color:#E53935 !important; font-weight:bold;">【사명】</a></div>`);
      add('<div class="message desc" data-messageid="d2">그냥 글</div>');
    }, { style1 });
    await r20.waitForTimeout(1300);
    const sent = (await r20.evaluate(() => window.sent)).map(m => m.message);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].macro, `/desc [.](#" style="${style1}")[x](https://i.imgur.com/aBnOCE4.png)[【사명】](#" style="color:#E53935 !important; font-weight:bold;")`, 'the macro text is rebuilt (styled links and the picture)');
    assert.equal(sent[1].macro, undefined, 'plain text stays plain');
    const viaReader = await first.evaluate(text => { const api = window.__CCF_ROLL20_BRIDGE_DEBUG__; return api.extractEnvelope(api.macroToText(text)).envelope; }, sent[0].macro);
    assert.equal(viaReader.formatRuns.filter(run => run.style.imageUrl).length, 1); assert(viaReader.formatRuns.some(run => run.style.extraCss?.paddingTop === '44.54%'));

    // 4. the play room draws the envelope with its own renderer (pictures only from the two hosts its CSP allows)
    const dir = path.join(__dirname, '..', 'prototype', 'public-handout-relay', 'public');
    const room = await browser.newPage({ viewport: { width: 560, height: 1300 } });
    await room.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (/\.png/.test(u.pathname)) return route.fulfill({ contentType: 'image/svg+xml', body: svgFor(u.href) });
      if (u.hostname !== 'relay.test') return route.abort();
      const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f);
      if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await room.goto('http://relay.test/#room=x');
    const drawn = await room.evaluate(env => {
      const box = document.createElement('p'); box.style.cssText = 'width:460px;margin:0;background:#222'; document.body.append(box);
      renderRoll20(box, env.text, env);
      env.formatRuns.push({ start: 0, end: 1, style: { imageUrl: 'https://evil.example/x.png' } });
      return new Promise(resolve => setTimeout(() => resolve({ imgs: [...box.querySelectorAll('img')].map(i => i.src), flush: box.querySelectorAll('.ccr20-line-flush').length, bg: [...box.querySelectorAll('.ccr20-line-flush')].every(l => l.style.backgroundColor === 'rgb(0, 0, 0)'), marginTop: box.querySelector('.ccr20-frag').style.marginTop, boxSizing: [...box.querySelectorAll('.ccr20-frag')].find(f => f.style.height === '46px').style.boxSizing, flushAttr: box.dataset.ccfMacroFlush }), 200));
    }, envelope);
    assert.deepEqual(drawn.imgs, images.map(run => run.style.imageUrl), 'the four pictures');
    assert.equal(drawn.flush, 9); assert.equal(drawn.bg, true); assert.equal(drawn.marginTop, '-14px'); assert.equal(drawn.boxSizing, 'content-box'); assert.equal(drawn.flushAttr, '1');
    const evil = await room.evaluate(env => { const box = document.createElement('p'); document.body.append(box); const copy = JSON.parse(JSON.stringify(env)); copy.formatRuns = [{ start: 0, end: 1, style: { imageUrl: 'https://evil.example/x.png' } }]; renderRoll20(box, copy.text, copy); return box.querySelectorAll('img').length; }, envelope);
    assert.equal(evil, 0, 'a picture from another host is not drawn');
    assert(/img-src https:\/\/storage\.ccfolia-cdn\.net https:\/\/i\.imgur\.com data:/.test(read('prototype/public-handout-relay/cloudflare/worker.mjs')), 'the CSP allows the picture host of the macro');
    console.log('roll20 handout macro PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
