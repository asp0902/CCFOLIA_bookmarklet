// play room (web share) parity 2026-11-18: a message ending with a cut-in name (text + envelope + name) keeps its formatting/narration and the name is not shown;
// the message font id (allow list) becomes the Google font (a link is added once); an unknown id is ignored.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '../prototype/public-handout-relay/public/participant.js'), 'utf8').replace(/\r\n/g, '\n');
const take = (start, endMarker) => { const a = src.indexOf(start); const b = src.indexOf(endMarker, a); return src.slice(a, b); };
const code = [
  src.split('\n').find((l) => l.startsWith('const INVIS_START')),
  take('function decodeEnvelope(full) {', '\n}\n') + '\n}',
  take('const MESSAGE_FONTS = ', 'function styleSegment(')
].join('\n');
const links = [];
const ctx = vm.createContext({ atob, escape, decodeURIComponent, document: { createElement: () => ({}), head: { append: (l) => links.push(l.href) } } });
vm.runInContext(code + '\nthis.decodeEnvelope = decodeEnvelope; this.messageFont = messageFont;', ctx);
const INVIS_MAP = ['​', '‌', '‍', '⁠'];
const enc = (v) => { const b64 = Buffer.from(JSON.stringify(v), 'utf8').toString('base64'); let bits = ''; for (const ch of b64) bits += ch.charCodeAt(0).toString(2).padStart(8, '0'); let out = '⁣⁣⁣'; for (let i = 0; i < bits.length; i += 2) out += INVIS_MAP[parseInt(bits.slice(i, i + 2).padEnd(2, '0'), 2)]; return out + '⁢⁢⁢'; };
// cut-in: text + envelope + name
let d = ctx.decodeEnvelope('글 ' + enc({ v: 1, text: '글 ', formatRuns: [], alignRuns: [], blockStyle: { narration: true } }) + '@컷인');
assert.equal(d.text, '글 '); assert.equal(d.env?.blockStyle?.narration, true, 'narration kept'); assert(!/@컷인/.test(d.visible), 'the cut-in name is not shown');
// an ordinary envelope at the end still works; an edited message (text differs) is plain
d = ctx.decodeEnvelope('굵게' + enc({ v: 1, text: '굵게', formatRuns: [{ start: 0, end: 2, style: { bold: true } }] }));
assert.equal(d.env?.formatRuns?.length, 1);
d = ctx.decodeEnvelope('고친 글' + enc({ v: 1, text: '원래 글', formatRuns: [] }));
assert.equal(d.env, null, 'edited afterwards: plain');
// message font
assert.equal(ctx.messageFont('nanum-myeongjo'), 'Nanum Myeongjo');
assert.equal(ctx.messageFont('nanum-myeongjo'), 'Nanum Myeongjo');
assert.deepEqual(links, ['https://fonts.googleapis.com/css2?family=Nanum+Myeongjo&display=swap'], 'the font link once');
assert.equal(ctx.messageFont('http://evil/x'), '', 'unknown id ignored');
// the same allow list as the toolkit
const fsync = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const ids = (text) => [...text.matchAll(/"([a-z-]+)": "([A-Z][^"]+)"/g)].map((m) => m[1]).filter((id) => /-|jua|gaegu|dongle/.test(id));
const toolkitList = fsync.slice(fsync.indexOf('window.__CCF_MESSAGE_FONTS__ = window.__CCF_MESSAGE_FONTS__ ||'), fsync.indexOf('});', fsync.indexOf('window.__CCF_MESSAGE_FONTS__ = window.__CCF_MESSAGE_FONTS__ ||')));
assert.deepEqual(ids(take('const MESSAGE_FONTS = ', '\n')), ids(toolkitList), 'same font list as format-sync');
assert(/const icon = wrapper\.querySelector\('\[data-cm-slot="icon"\]'\)\?\.getAttribute\("src"\)/.test(src), 'speaker runs split by the standing picture');
assert(src.includes('const pic = active.find(r => typeof r.style.imageUrl === "string"'), 'pasted pictures drawn (allowed hosts only)');
console.log('participant parity PASS');
