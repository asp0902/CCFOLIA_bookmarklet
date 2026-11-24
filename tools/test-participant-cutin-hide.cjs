// A cut-in whose name starts with @: its name is not shown in the playroom's chat, with or without a picture (the longest name wins); a name-alone message keeps an empty line. Only played cut-ins' names are relayed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.join(__dirname, '..'), dir = path.join(root, 'prototype', 'public-handout-relay', 'public');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert(i >= 0 && j > i, a); return s.slice(i, j); };
const panel = fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const names = vm.runInNewContext(`${between(panel, '  function relayCutinNames', '  // 컷인(entities.roomEffects)')}; relayCutinNames`);
const num = (v) => Number(v) || 0;
assert.deepEqual([...names({ a: { name: '@버튼', createdAt: 1000, playTime: 9000 }, b: { name: '@비밀', createdAt: 1000, playTime: 1000 }, c: { name: '성공', createdAt: 1000, playTime: 9000 } }, num)], ['@버튼'], 'played @ names only: an unplayed name could be a spoiler');
const worker = fs.readFileSync(path.join(root, 'prototype/public-handout-relay/cloudflare/worker.mjs'), 'utf8').replace(/\r\n/g, '\n');
const clean = vm.runInNewContext(`${between(worker, 'const cleanCutinNames', 'export class')}; cleanCutinNames`);
assert.deepEqual([...clean(['@a', 'b', 7, `@${'x'.repeat(200)}`])], ['@a']);
const pictures = vm.runInNewContext(`${between(panel, '  function relayCutinPictures', '  // 컷인(entities.roomEffects)')}; relayCutinPictures`);
assert.deepEqual(JSON.parse(JSON.stringify(pictures({ a: { name: '번개', imageUrl: 'p', createdAt: 1000, playTime: 9000 }, b: { name: '비밀', imageUrl: 'q', createdAt: 1000, playTime: 1000 }, c: { name: '소리', imageUrl: '', createdAt: 1000, playTime: 9000 } }, (v) => v, num))), [{ name: '번개', url: 'p' }], 'played cut-ins with a picture only');
const cleanPictures = vm.runInNewContext(`${between(worker, 'const cleanCutinPictures', 'export class')}; cleanCutinPictures`);
assert.equal(cleanPictures([{ name: 'a', url: 'https://storage.ccfolia-cdn.net/a.png' }, { name: 'b', url: 'https://evil.test/a.png' }]).length, 1, 'CDN only');
const envelope = (data) => { const bytes = Buffer.from(Buffer.from(JSON.stringify(data), 'utf8').toString('base64'), 'latin1'), map = ['​', '‌', '‍', '⁠']; let out = '⁣⁣⁣'; for (const b of bytes) for (const shift of [6, 4, 2, 0]) out += map[(b >> shift) & 3]; return out + '⁢⁢⁢'; };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname === 'storage.ccfolia-cdn.net') return /broken/.test(u.pathname) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>' }); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    const cases = [['@버튼', ' '], ['본문 @버튼', '본문'], ['아주 @긴 버튼', '아주'], ['성공', '성공'], ['@없는이름', '@없는이름'], [`${envelope({ v: 1, text: '@버튼' })}@버튼`, ' '], [`글 ${envelope({ v: 1, text: '글 ' })}@버튼`, '글']];
    const out = await page.evaluate((list) => { sceneData = { cutinNames: ['@버튼', '@긴 버튼', '성공은아님'] }; return list.map(([text]) => { const p = document.createElement('p'); renderRich(p, text, true); return p.textContent.trim() || p.textContent; }); }, cases);
    assert.deepEqual(out, cases.map(([, shown]) => shown));
    const CDN = 'https://storage.ccfolia-cdn.net/';
    const rows = await page.evaluate(async ([CDN, alone, body]) => {
      sceneData = { cutinNames: ['@그림'], cutinPictures: [{ name: '@그림', url: `${CDN}a.png` }, { name: '큰 @그림', url: `${CDN}b.png` }, { name: '깨짐', url: `${CDN}broken.png` }] };
      const draw = async (text) => { const p = document.createElement('p'); document.body.append(p); renderRich(p, text, true); addCutinPicture(p, text); await new Promise((r) => setTimeout(r, 150)); const img = p.querySelector('.ccf-cutin-chat-image img'); const out = { text: p.textContent.trim(), src: img ? img.src.split('/').pop() : null, h: img ? getComputedStyle(img).maxHeight : null, radius: img ? getComputedStyle(img).borderRadius : null }; p.remove(); return out; };
      const out = {}; for (const [key, text] of [['alone', '@그림'], ['body', '본문 @그림'], ['longest', '아주 큰 @그림'], ['plain', '평범'], ['broken', '깨짐'], ['envAlone', alone], ['envBody', body]]) out[key] = await draw(text); return out; }, [CDN, `${envelope({ v: 1, text: '@그림' })}@그림`, `글 ${envelope({ v: 1, text: '글 ' })}@그림`]);
    const pic = (text, src) => ({ text, src, h: '200px', radius: '4px' });
    assert.deepEqual(rows, { alone: pic('', 'a.png'), body: pic('본문', 'a.png'), longest: pic('아주 큰', 'b.png'), plain: { text: '평범', src: null, h: null, radius: null }, broken: { text: '깨짐', src: null, h: null, radius: null }, envAlone: pic('', 'a.png'), envBody: pic('글', 'a.png') });
    assert.deepEqual(errors.filter((e) => !/404/.test(e)), []);
    console.log('participant cutin hide PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
