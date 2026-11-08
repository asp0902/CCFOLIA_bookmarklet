const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The color the user really sees under the native input area: translucent layers on the ancestor chain are composited down to the first opaque layer
// (rgba(0,0,0,.1) over rgb(18,18,18) is not rgb(29,29,29) as if it lay over the page).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  function toOpaqueColor('), b = source.indexOf('  // 네이티브 채팅 패널의 헤더 막대와 제목을 찾는다.', a);
assert(a >= 0 && b > a);
class Element { constructor(bg, parent) { this.bg = bg; this.parentElement = parent || null; } }
const ctx = vm.createContext({ Element, getComputedStyle: (e) => ({ backgroundColor: e.bg }), String, Number, Math });
vm.runInContext(`${source.slice(a, b)}\nthis.visible = visibleBackgroundOf;`, ctx);
const root = new Element('rgb(18, 18, 18)'), mid = new Element('rgba(0, 0, 0, 0.1)', root), leaf = new Element('rgba(0, 0, 0, 0)', mid);
assert.equal(ctx.visible(leaf, 'rgb(24, 24, 26)'), 'rgb(16, 16, 16)', 'translucent black over rgb(18) -> 16, not over the page color');
assert.equal(ctx.visible(new Element('rgb(33, 33, 33)', root), 'rgb(0, 0, 0)'), 'rgb(33, 33, 33)', 'an opaque layer wins');
assert.equal(ctx.visible(new Element('rgba(0, 0, 0, 0)', null), 'rgb(5, 5, 5)'), 'rgb(5, 5, 5)', 'nothing painted -> page color');
const top = new Element('rgba(44, 44, 44, 0.87)', null), under = new Element('rgba(0, 0, 0, 0.1)', top);
assert.equal(ctx.visible(under, 'rgb(0, 0, 0)'), 'rgb(34, 34, 34)', 'two translucent layers over the page color stack');
console.log('chat panel visible bg PASS');
