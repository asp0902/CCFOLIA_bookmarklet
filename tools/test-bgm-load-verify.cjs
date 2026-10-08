// The player must really play the requested song: after loadVideoById the loaded video id is checked, a mismatch is recorded and loaded again (twice at most).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-notifier.user.js'), 'utf8');
const a = source.indexOf('  const ccfBgmTrace = [];');
const b = source.indexOf('  const ccfLoopTrace') > a ? source.length : source.indexOf('\n  }', source.indexOf('function verifyCcfBgmLoadedVideo')) + 4;
assert(a >= 0 && b > a, 'verify code not found');
const make = ({ loadedIds }) => {
  const calls = [];
  let n = 0;
  const player = { getVideoData: () => ({ video_id: loadedIds[Math.min(n++, loadedIds.length - 1)] }), loadVideoById: id => calls.push('load:' + id), playVideo: () => calls.push('play') };
  const box = { window: { setTimeout: fn => fn() }, Date, debugLog() {}, ccfBgmPlayer: player, ccfBgmActiveSlotKey: 'BGM01', ccfBgmPlayerVideoId: 'NEW' };
  vm.runInNewContext(`${source.slice(a, b)}; this.verify = verifyCcfBgmLoadedVideo; this.trace = ccfBgmTrace;`, box);
  return { box, calls, player };
};
// the right video is loaded: nothing to do
let t = make({ loadedIds: ['NEW'] }); t.box.verify(t.player, 'NEW');
assert.deepEqual(t.calls, []); assert.equal(t.box.trace.length, 0);
// the old video is still loaded (what the live room showed): recorded, loaded again, then fine
t = make({ loadedIds: ['OLD', 'NEW'] }); t.box.verify(t.player, 'NEW');
assert.deepEqual(t.calls, ['load:NEW', 'play']);
assert.equal(t.box.trace.length, 1); assert.deepEqual([t.box.trace[0].type, t.box.trace[0].wanted, t.box.trace[0].loaded, t.box.trace[0].attempt], ['load-mismatch', 'NEW', 'OLD', 0]);
// it never loops forever
t = make({ loadedIds: ['OLD'] }); t.box.verify(t.player, 'NEW');
assert.equal(t.calls.filter(c => c.startsWith('load')).length, 2, 'two reloads at most'); assert.equal(t.box.trace.length, 3);
// the user picked another song meanwhile, or nothing is active: leave it alone
t = make({ loadedIds: ['OLD'] }); t.box.ccfBgmPlayerVideoId = 'OTHER'; t.box.verify(t.player, 'NEW'); assert.deepEqual(t.calls, []);
t = make({ loadedIds: ['OLD'] }); t.box.ccfBgmActiveSlotKey = ''; t.box.verify(t.player, 'NEW'); assert.deepEqual(t.calls, []);
// the video data is not available yet: no action
t = make({ loadedIds: [''] }); t.box.verify(t.player, 'NEW'); assert.deepEqual(t.calls, []);
// the trace keeps 30
t = make({ loadedIds: ['OLD'] }); for (let i = 0; i < 20; i++) t.box.verify(t.player, 'NEW'); assert.equal(t.box.trace.length, 30);
console.log('bgm load verify PASS');
