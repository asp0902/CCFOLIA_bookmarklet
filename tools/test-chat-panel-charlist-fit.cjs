const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The speaker list of the extra room chat stays inside the window: pushed up from the bottom edge (16px margin), its own height capped with a vertical scroll.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const css = source.match(/\.ccf-scp-charlist \{[^}]*\}/)[0];
assert.match(css, /overflow-y: auto/); assert.match(css, /max-height: calc\(100vh - 32px\)/); assert.match(css, /overflow-x: hidden/);
const a = source.indexOf('    const fitCharList = () => {'), b = source.indexOf('    window.addEventListener("resize", fitCharList);', a);
assert(a >= 0 && b > a);
const run = (top, height, innerHeight) => {
  const charList = { hidden: false, isConnected: true, style: { top: '' }, getBoundingClientRect() { const t = parseFloat(this.style.top) || 0; return { top: top + t, bottom: top + t + height }; } };
  const ctx = vm.createContext({ charList, window: { innerHeight, removeEventListener() {} } });
  vm.runInContext(`${source.slice(a, b)}\nthis.fit = fitCharList;`, ctx);
  ctx.fit();
  const t = parseFloat(charList.style.top) || 0;
  return { top: top + t, bottom: top + t + height, shift: t };
};
let r = run(100, 300, 900); assert.equal(r.shift, 0, 'fits: left alone');
r = run(700, 300, 900); assert.equal(r.bottom, 884, 'pushed up to 16px above the bottom'); assert.equal(r.top, 584);
r = run(700, 1200, 900); assert.equal(r.top, 16, 'taller than the window: top at 16 (the list scrolls)');
console.log('chat panel charlist fit PASS');
