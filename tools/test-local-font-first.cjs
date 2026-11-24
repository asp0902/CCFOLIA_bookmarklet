// format-sync 0.1.165 / playroom: the same font installed on the PC is used before the web font (installed fonts draw small text crisper; the user is installing NanumGothic).
// The installed names differ from the web family, so they can stand in front of it; without them installed the web font is used as before (fontId on the wire unchanged).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const fs1 = read('legacy/ccfolia-format-sync.user.js');
const def = fs1.match(/window\.__CCF_FONT_STACK__ = window\.__CCF_FONT_STACK__ \|\| \(.*\);\n/);
assert(def, 'stack helper');
const ctx = vm.createContext({ window: {} }); vm.runInContext(def[0], ctx);
const stack = ctx.window.__CCF_FONT_STACK__;
assert.equal(stack('Nanum Gothic'), '"NanumGothic", "나눔고딕", "Nanum Gothic"');
assert.equal(stack('Nanum Myeongjo'), '"NanumMyeongjo", "나눔명조", "Nanum Myeongjo"');
assert.equal(stack('Noto Sans KR'), '"Noto Sans CJK KR", "Noto Sans KR"');
assert.equal(stack('Jua'), '"Jua"', 'no known installed name: web font only');
// every render path uses it
assert.equal((fs1.match(/el\.style\.fontFamily = `\$\{window\.__CCF_FONT_STACK__\(family\)\}, sans-serif`;/g) || []).length, 2, 'message / speaker font render (both blocks)');
assert.match(read('legacy/ccfolia-theme-switcher.user.js'), /font-family: \$\{\(window\.__CCF_FONT_STACK__ \|\| /, 'theme screen font');
assert.equal((read('legacy/ccfolia-log-package.user.js').match(/\(window\.__CCF_FONT_STACK__ \|\| \(\(f\) => `"\$\{f\}"`\)\)\(family\)/g) || []).length, 2, 'log package');
assert.match(read('legacy/ccfolia-character-sheet.user.js'), /window\.__CCF_FONT_STACK__\(d\.font\)/, 'sheet design font');
const part = read('prototype/public-handout-relay/public/participant.js');
const pdef = part.match(/const fontStack = family => .*;\n/);
const pctx = vm.createContext({}); vm.runInContext(pdef[0] + 'this.fontStack = fontStack;', pctx);
assert.equal(pctx.fontStack('Nanum Gothic'), stack('Nanum Gothic'), 'playroom: same list');
assert.match(part, /span\.style\.fontFamily = `\$\{fontStack\(family\)\}, sans-serif`;/);
assert.match(part, /\{font-family:\$\{fontStack\(font\)\},Roboto,/);
console.log('local font first PASS');
