// #119: the colour sent from the extra chat panel is the character's current colour, and without a speaker it is the native default, not a stale template colour.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  const NATIVE_DEFAULT_NAME_COLOR');
const end = source.indexOf('\n  }', source.indexOf('function refreshSelectedChar()')) + 4;
assert(a >= 0 && end > a, 'colour code not found');
let characters = [{ id: 'c1', name: '알리스', icon: 'i1', color: '#112233', commands: '1d6' }];
const box = { selectedChar: null, readCharacters: () => characters };
vm.runInNewContext(`${source.slice(a, end)}; this.sendColor = sendColor; this.refresh = refreshSelectedChar; this.NATIVE = NATIVE_DEFAULT_NAME_COLOR;`, box);
// the character was picked with its colour at that time, then changed in CCFOLIA
box.selectedChar = { ...characters[0] };
characters = [{ id: 'c1', name: '알리스', icon: 'i1', color: '#ff00aa', commands: '1d6' }];
assert.equal(box.refresh(), true, 'a changed colour is noticed');
assert.equal(box.selectedChar.color, '#ff00aa');
assert.equal(box.sendColor(box.selectedChar, null, ''), '#ff00aa', 'the new colour is what is sent');
assert.equal(box.refresh(), false, 'nothing changed -> no redraw');
// name, icon and palette follow too; a deleted character keeps the old snapshot
characters = [{ id: 'c1', name: '이름 바뀜', icon: 'i2', color: '#ff00aa', commands: '2d6' }];
assert.equal(box.refresh(), true); assert.deepEqual([box.selectedChar.name, box.selectedChar.icon, box.selectedChar.commands], ['이름 바뀜', 'i2', '2d6']);
characters = [];
assert.equal(box.refresh(), false); assert.equal(box.selectedChar.name, '이름 바뀜');
// the colour button override wins for the panel's own speaker, never for a relayed speaker
assert.equal(box.sendColor({ color: '#112233' }, null, '#abcdef'), '#abcdef');
assert.equal(box.sendColor({ color: '#112233' }, { name: 'x' }, '#abcdef'), '#112233');
assert.equal(box.sendColor({ color: '' }, null, ''), '#888888', 'a character without a colour: the native value');
// no speaker: never the template colour, the measured native default (or the override)
assert.equal(box.sendColor(null, null, ''), '#cce5df');
assert.equal(box.NATIVE, '#cce5df');
assert.equal(box.sendColor(null, null, '#abcdef'), '#abcdef');
console.log('chat panel character colour PASS');
