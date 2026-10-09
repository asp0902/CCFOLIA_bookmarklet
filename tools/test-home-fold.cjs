// Home page sections: two <details>, no star in the favourites title, the folded state is saved and restored on a redraw.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'home-bookmarks.js'), 'utf8');
assert(!source.includes('"★ 즐겨찾기"'), 'no star in the favourites title');
const a = source.indexOf('  const FOLD_KEY'), b = source.indexOf('  const renderHome');
assert(a > 0 && b > a);
const makeNode = tag => ({ tag, children: [], listeners: {}, open: true, append(...k) { this.children.push(...k); }, addEventListener(t, fn) { this.listeners[t] = fn; } });
const store = {};
const box = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
  el: (tag, props = {}, ...kids) => { const n = Object.assign(makeNode(tag), props); n.append(...kids); return n; }, makeCard: () => makeNode('card'), JSON };
const template = { parentElement: { parentElement: { cloneNode: () => Object.assign(makeNode('grid'), { style: {} }) } } };
vm.runInNewContext(`${source.slice(a, b)}; this.section = section;`, box);
let d = box.section(template, 'favorites', '즐겨찾기', [{ id: 1 }], 'x');
assert.equal(d.tag, 'details'); assert.equal(d.open, true, 'open by default');
assert.equal(d.children[0].tag, 'summary'); assert.equal(d.children[0].children[0].textContent, '즐겨찾기');
d.open = false; d.listeners.toggle();
assert.deepEqual(JSON.parse(store['capybara-home-fold']), { favorites: false });
d = box.section(template, 'favorites', '즐겨찾기', [], 'x'); assert.equal(d.open, false, 'folded state is restored on a redraw');
const r = box.section(template, 'recent', '최근 방문한 룸', [], 'x'); assert.equal(r.open, true, 'the other section is unaffected');
console.log('home fold PASS');
