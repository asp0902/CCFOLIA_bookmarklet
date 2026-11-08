const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The color the user really sees under the native input area: translucent layers on the ancestor chain are composited down to the first opaque layer
// (rgba(0,0,0,.1) over rgb(18,18,18) is not rgb(29,29,29) as if it lay over the page).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  function toOpaqueColor('), b = source.indexOf('  // 네이티브 채팅 패널의 헤더 막대와 제목을 찾는다.', a);
assert(a >= 0 && b > a);
class Element { constructor(bg, parent, img) { this.bg = bg; this.img = img || 'none'; this.parentElement = parent || null; } }
const ctx = vm.createContext({ Element, getComputedStyle: (e) => ({ backgroundColor: e.bg, backgroundImage: e.img }), String, Number, Math });
vm.runInContext(`${source.slice(a, b)}\nthis.visible = visibleBackgroundOf; this.solid = solidGradientColorOf;`, ctx);
const root = new Element('rgb(18, 18, 18)'), mid = new Element('rgba(0, 0, 0, 0.1)', root), leaf = new Element('rgba(0, 0, 0, 0)', mid);
assert.equal(ctx.visible(leaf, 'rgb(24, 24, 26)'), 'rgb(16, 16, 16)', 'translucent black over rgb(18) -> 16, not over the page color');
assert.equal(ctx.visible(new Element('rgb(33, 33, 33)', root), 'rgb(0, 0, 0)'), 'rgb(33, 33, 33)', 'an opaque layer wins');
assert.equal(ctx.visible(new Element('rgba(0, 0, 0, 0)', null), 'rgb(5, 5, 5)'), 'rgb(5, 5, 5)', 'nothing painted -> page color');
const top = new Element('rgba(44, 44, 44, 0.87)', null), under = new Element('rgba(0, 0, 0, 0.1)', top);
assert.equal(ctx.visible(under, 'rgb(0, 0, 0)'), 'rgb(34, 34, 34)', 'two translucent layers over the page color stack');
// MUI dark elevation overlay: a gradient with two equal stops is a solid layer over the element's own color
const overlay = 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))';
assert.equal(ctx.solid(overlay), 'rgba(255, 255, 255, 0.05)'); assert.equal(ctx.solid('linear-gradient(red, blue)'), null); assert.equal(ctx.solid('none'), null);
assert.equal(ctx.visible(new Element('rgb(18, 18, 18)', null, overlay), 'rgb(0, 0, 0)'), 'rgb(30, 30, 30)', 'elevation overlay lightens the paper');
assert.equal(ctx.visible(new Element('rgba(0, 0, 0, 0)', new Element('rgb(18, 18, 18)', null, overlay)), 'rgb(0, 0, 0)'), 'rgb(30, 30, 30)', 'seen through a transparent child');
// the measured case: rgb(18) paper with an overlay of about .09 looks like rgb(40) (the input well on top of it makes 31 in the original)
const measured = ctx.visible(new Element('rgb(18, 18, 18)', null, 'linear-gradient(rgba(255, 255, 255, 0.092), rgba(255, 255, 255, 0.092))'), 'rgb(0, 0, 0)');
assert.equal(measured, 'rgb(40, 40, 40)');
// the compose color is read from the paper that holds both the tab bar and the input, not from the input well
assert.match(source, /while \(paper && !paper\.contains\(nativeTabBar\)\) paper = paper\.parentElement;/);
assert.match(source, /set\("--scp-bottom-bg", visibleBackgroundOf\(paper, pageBg\)\)/);
console.log('chat panel visible bg PASS');
