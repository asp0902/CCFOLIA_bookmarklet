// An @cut-in sent alone. CCFOLIA (1.37.6, bundle Ne) drops a trailing "@word" from every message before storing it and stores nothing if nothing is left.
// With a picture, the toolkit keeps a row: the stored message is an invisible envelope that names the cut-in (no letters, also for people without the toolkit),
// and the picture is drawn from the room's cut-in. Without a picture: no row. Text + @picture: the name rides in the envelope (cutin), since CCFOLIA cuts it off.
// Extra panel / playroom sends (chat-panel writes to Firestore directly) follow the same rule; the playroom draws the picture of such a row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const encode = (obj) => { const b64 = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };

// chat-panel: the same rule on its direct write
const panel = fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = panel.indexOf('  function cutinAtTail('), b = panel.indexOf('\n  }\n', panel.indexOf('  function cutinHasPicture(')) + 4;
assert(a >= 0 && b > a, 'cutinAtTail / cutinHasPicture helpers');
const vm = require('node:vm');
const effects = { e1: { name: '@그림', imageUrl: 'https://storage.ccfolia-cdn.net/p.png' }, e2: { name: '@소리', soundUrl: 'https://x/s.mp3' } };
const ctx = vm.createContext({ findStore: () => ({ getState: () => ({ entities: { roomEffects: { entities: effects } } }) }) });
vm.runInContext(panel.slice(a, b) + '\nthis.api = { cutinAtTail, cutinHasPicture };', ctx);
assert.equal(ctx.api.cutinAtTail('@그림'), '@그림'); assert.equal(ctx.api.cutinAtTail('본문 @소리'), '@소리'); assert.equal(ctx.api.cutinAtTail('메일@주소'), '', 'not a cut-in: untouched');
assert.equal(ctx.api.cutinHasPicture('@그림'), true); assert.equal(ctx.api.cutinHasPicture('@소리'), false);
assert.match(panel, /else if \(!plainRest\.trim\(\)\) \{ triggerRoomEffects\(ctx, cutinTail\); return; \}/, 'no picture, nothing left: no message, the cut-in still plays');
assert.match(panel, /if \(isCommand \|\| cutinTail\) triggerRoomEffects\(ctx, cutinTail \|\| cleanText\);/);
// 0.5.70: text + @cut-in from the panel is body text (narration / format kept), not a command; the name is cut off, the picture name rides as cutin
assert.match(panel, /const isCommand = !meta && !cutinInBody && \(/, 'a body ending with a cut-in is not a command');
assert.match(panel, /\.\.\.\(cutinInBody && cutinHasPicture\(cutinInBody\) \? \{ cutin: cutinInBody \} : \{\}\),/);
assert.match(panel, /const cutinTail = meta\?\.source \? "" : \(cutinInBody \|\| cutinAtTail\(outText\)\);/);

// playroom: the envelope-only row shows no letters and the picture of the played cut-in; text + envelope(cutin) keeps the text and adds the picture
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(root, 'prototype', 'public-handout-relay', 'public');
const GIF = 'data:image/gif;base64,R0lGODlhAgABAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAEAAAIChFEAOw==';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.protocol === 'data:') return route.continue(); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    const rows = await page.evaluate(([gif, alone, withBody, notPlayed]) => {
      sceneData = { ...(sceneData || {}), cutinNames: ['@그림'], cutinPictures: [{ name: '@그림', url: gif }] };
      const draw = (full) => { const body = document.createElement('p'); document.body.append(body); body.textContent = withoutCutinName(decodeEnvelope(full).visible); addCutinPicture(body, full); return body; };
      return Promise.all([draw(alone), draw(withBody), draw(notPlayed)].map((p) => new Promise((r) => setTimeout(() => r({ text: p.textContent.trim(), img: !!p.querySelector('.ccf-cutin-chat-image img') }), 300))));
    }, [GIF, encode({ v: 1, text: '@그림', formatRuns: [], alignRuns: [], blockStyle: {} }), '본문 ' + encode({ v: 1, text: '본문 ', formatRuns: [], alignRuns: [], blockStyle: {}, cutin: '@그림' }), encode({ v: 1, text: '@안본컷인', formatRuns: [], alignRuns: [], blockStyle: {} })]);
    const [alone, withBody, notPlayed] = await Promise.all(rows);
    assert.deepEqual(alone, { text: '', img: true }, 'alone: picture, no letters');
    assert.deepEqual(withBody, { text: '본문', img: true }, 'text kept, picture added');
    assert.deepEqual(notPlayed, { text: '', img: false }, 'a cut-in not played (not relayed): nothing');
    assert.deepEqual(errors, []);
    console.log('cutin at alone PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
