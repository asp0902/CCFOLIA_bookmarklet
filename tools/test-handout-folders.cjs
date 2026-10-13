// Handout folders are the same for everyone in the room: the GM writes the list, the others follow it (collapsed state stays local), a GM with folders of their own is not overwritten.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  const folderList = ');
const b = source.indexOf('  let unsubFolders = null;');
assert(a >= 0 && b > a, 'folder code not found');
const box = { state: { data: { folders: [] } }, isAdminMode: () => false, initFirebase: async () => null, getCurrentRoomKey: () => 'r', console, Array, String, JSON };
vm.createContext(box);
vm.runInContext(`${source.slice(a, b)}\n;this.api = { folderList, adoptRemoteFolders };`, box);
const { folderList, adoptRemoteFolders } = box.api;
const names = () => JSON.parse(JSON.stringify(box.state.data.folders));
// a player follows the GM's list; their own collapsed state is kept
box.state.data.folders = [{ id: 'f1', name: '예전', collapsed: true }];
assert.equal(adoptRemoteFolders([{ id: 'f1', name: '1막' }, { id: 'f2', name: '2막' }, { id: 5 }, null]), true);
assert.deepEqual(names(), [{ id: 'f1', name: '1막', collapsed: true }, { id: 'f2', name: '2막', collapsed: false }]);
assert.equal(adoptRemoteFolders([{ id: 'f1', name: '1막' }, { id: 'f2', name: '2막' }]), false, 'same list: nothing to do');
assert.equal(adoptRemoteFolders([]), true); assert.deepEqual(names(), [], 'the GM removed all folders');
// the GM's own folders are not replaced by the room's list; a GM on a new browser (nothing local) takes it
box.isAdminMode = () => true;
box.state.data.folders = [{ id: 'g1', name: '내 폴더', collapsed: false }];
assert.equal(adoptRemoteFolders([{ id: 'x', name: '다른' }]), false); assert.deepEqual(names().map(f => f.id), ['g1']);
box.state.data.folders = [];
assert.equal(adoptRemoteFolders([{ id: 'x', name: '다른' }]), true); assert.deepEqual(names().map(f => f.id), ['x']);
// what is written: id and a bounded name only (no collapsed state)
box.state.data.folders = [{ id: 'f9', name: 'n'.repeat(200), collapsed: true }];
assert.deepEqual(JSON.parse(JSON.stringify(folderList())), [{ id: 'f9', name: 'n'.repeat(80) }]);
console.log('handout folders PASS');
