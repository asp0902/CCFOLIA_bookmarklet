const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The log editor: in a merged run of one speaker, an entry sent with the divider toggle (blockStyle.breakBefore) gets a line above it inside the run; the collector already carries
// the envelope's blockStyle; the copy of the editor inside the log package is the editor.
const editor = fs.readFileSync(path.join(__dirname, '../log editor/index.html'), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-log-package.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = editor.indexOf('  function mergeConsecutiveSpeakerEntries('), b = editor.indexOf('  function renderSelectedTabEntries(', a);
assert(a >= 0 && b > a);
const ctx = vm.createContext({ Array, String, Boolean });
vm.runInContext('const getHtmlEdgeType = () => "";\n' + editor.slice(a, b) + '\nthis.merge = mergeConsecutiveSpeakerEntries;', ctx);
const entry = (text, extra = {}) => ({ sender: '눈깅이', tabId: 'main', text, visibleText: text, packageHtml: `<p>${text}</p>`, ...extra });
let out = ctx.merge([entry('하나'), entry('둘'), entry('셋', { blockStyle: { breakBefore: true } })]);
assert.equal(out.length, 1, 'still one run');
const html = out[0].packageHtml;
assert.ok(html.includes('<p>하나</p><br><p>둘</p>'), 'a normal join keeps the break tag');
assert.ok(html.includes('<p>둘</p><div class="ccf-break-divider" style="border-top:1px solid rgba(128,128,128,.45);margin:8px 0"></div><p>셋</p>'), 'the divider sits between the lines');
assert.equal((html.match(/ccf-break-divider/g) || []).length, 1, 'only before the marked line');
out = ctx.merge([entry('하나', { blockStyle: { breakBefore: true } }), entry('둘')]);
assert.ok(!out[0].packageHtml.includes('ccf-break-divider'), 'a marked first line of a run needs no line');
// the collector keeps the envelope's blockStyle as it is
assert.match(source, /const effectiveBlockStyle = extracted\?\.envelope\?\.blockStyle \|\| blockStyle \|\| \{\};/);
// the editor copy inside the log package is the editor
const marker = '  const CAPYBARA_LOG_EDITOR_HTML = ';
const start = source.indexOf(marker) + marker.length;
assert.equal(JSON.parse(source.slice(start, source.indexOf('\n', start)).replace(/;$/, '')), editor, 'the copy inside the log package is the editor');
console.log('log break divider PASS');
