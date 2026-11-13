const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Pasting a picture in the extra panel uses the same function as the original composer (format-sync's exported handler): the picture goes into the text as {i:address|alt|},
// parseFormatMarkers turns it into a placeholder text with an image run (the same run the original composer sends), plain text pasting is not touched.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const panel = read('legacy/ccfolia-chat-panel.user.js'), sync = read('legacy/ccfolia-format-sync.user.js');
const a = panel.indexOf('const CCF_MD_MARKERS'), b = panel.indexOf('// 크툴루(CoC 7판)');
const ctx = vm.createContext({});
vm.runInContext(`${panel.slice(a, b)}\nthis.parse = parseFormatMarkers;`, ctx);
let r = ctx.parse('앞 {i:ccf-firestore-image://abc123|스크린샷|} 뒤');
assert.equal(r.text, '앞 스크린샷 뒤');
const run = r.runs.find((x) => x.style.imageUrl);
assert.ok(run && run.start === 2 && run.end === 6 && run.style.imageUrl === 'ccf-firestore-image://abc123' && run.style.imageAlt === '스크린샷');
r = ctx.parse('{i:https://example.com/a.png?x=1&y=2||}');
assert.equal(r.text, '이미지', 'no alt -> the default placeholder'); assert.equal(r.runs[0].style.imageUrl, 'https://example.com/a.png?x=1&y=2');
r = ctx.parse('그냥 {중괄호} 글자 **굵게**'); assert.equal(r.runs.filter((x) => x.style.imageUrl).length, 0);
// the exported handler of format-sync and the paste listener of the panel
assert.match(sync, /window\.__CCF_FORMAT_SYNC_IMAGE_PASTE__ = \{ handle: handleImagePasteForTextInput \};/);
assert.match(sync, /function handleImagePasteForTextInput\(event, insert\) \{[\s\S]*?uploadImageFilesToIfh\(\[file\]\)[\s\S]*?maybeOpenIfhHelpPage\(error\)/);
assert.match(sync, /return false;\n  \}\n  window\.__CCF_FORMAT_SYNC_IMAGE_PASTE__/, 'a plain text paste is left alone (false)');
assert.match(panel, /inputEl\.addEventListener\("paste", \(e\) => \{[\s\S]{0,800}?const api = window\.__CCF_FORMAT_SYNC_IMAGE_PASTE__;/);
assert.match(panel, /token: `\{i:\$\{url\}\|/); // 0.5.36: the token is kept aside, the box shows a 🖼 marker (tools/test-chat-panel-image-marker.cjs)
console.log('chat panel image paste PASS');
