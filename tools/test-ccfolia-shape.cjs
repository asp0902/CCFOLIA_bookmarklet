// Structure check of CCFOLIA's store (relayHealth): the fixture is the key names and types measured on ccfolia.com 1.37.5 (no values).
// A store built from it passes; a missing key or a changed type is reported by name. No access to CCFOLIA here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  const RELAY_SHAPE_SPEC');
const b = source.indexOf('  // 참여자에게 내보내는 모양: GM에게 온 귓속말은 빼고');
assert(a >= 0 && b > a, 'shape code not found');
const { RELAY_SHAPE_SPEC: SPEC, checkRelayShape } = vm.runInNewContext(`${source.slice(a, b)}; ({ RELAY_SHAPE_SPEC, checkRelayShape })`, { Object, Array, JSON });
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ccfolia-shape-1.37.5.json'), 'utf8'));
const sampleFor = types => ({ string: 'x', number: 1, boolean: false, null: null, array: [], object: {} })[types[0]];
const make = shape => Object.fromEntries(Object.entries(shape).map(([key, types]) => [key, sampleFor(types)]));
const state = () => ({ entities: {
  rooms: { entities: { r: make(fixture.room) } },
  roomCharacters: { entities: { c: make(fixture.character) } },
  roomItems: { entities: { i: make(fixture.item) } },
  roomMessages: { entities: { m: make(fixture.message) }, idsGroupBy: { main: ['m'] }, ids: [], addedIds: [] },
  roomMembers: { entities: {} }
} });
const check = s => Array.from(checkRelayShape(s, SPEC));

// the spec only asks for keys that were measured, with types that were measured
for (const [kind, shape] of [['message', SPEC.message], ['character', SPEC.character], ['item', SPEC.item], ['room', SPEC.room]]) {
  for (const [key, types] of Object.entries(shape)) {
    assert(key in fixture[kind], `${kind}.${key} is in the measured fixture`);
    assert(fixture[kind][key].every(type => types.includes(type)), `${kind}.${key}: measured types ${fixture[kind][key]} are allowed`);
  }
}
assert.deepEqual(check(state()), [], 'a store with the measured shape is fine');
// an empty room is fine (no samples, only the containers must exist)
const empty = state(); empty.entities.roomCharacters.entities = {}; empty.entities.roomItems.entities = {}; empty.entities.roomMessages.entities = {};
assert.deepEqual(check(empty), []);
// a removed key is named
const noX = state(); delete noX.entities.roomCharacters.entities.c.x;
assert.deepEqual(check(noX), ['character.x']);
const noMarkers = state(); delete noMarkers.entities.rooms.entities.r.markers;
assert.deepEqual(check(noMarkers), ['room.markers']);
// a changed type is named with the new type
const wrongType = state(); wrongType.entities.roomItems.entities.i.width = '17';
assert.deepEqual(check(wrongType), ['item.width(string)']);
// a missing container is named
const noItems = state(); delete noItems.entities.roomItems;
assert(check(noItems).includes('entities.roomItems'));
const noSlice = state(); noSlice.entities.roomMessages.idsGroupBy = [];
assert(check(noSlice).includes('roomMessages.idsGroupBy'), 'an array where a map is expected');
console.log('ccfolia shape check PASS');
