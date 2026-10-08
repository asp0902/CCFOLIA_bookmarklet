// YouTube BGM loop (#116): a song that ends on the active player with a slot and loop on starts again; the standby player's ENDED never revives it; stopping and loop off do not loop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-notifier.user.js'), 'utf8');
const h0 = source.indexOf('  function shouldRestartEndedCcfBgm(');
const h1 = source.indexOf('\n  }', h0) + 4;
const a = source.indexOf('  function handleCcfBgmPlayerStateChange(');
const b = source.indexOf('  function stopCcfYoutubeBgm(');
assert(h0 >= 0 && h1 > h0 && a >= 0 && b > a, 'handler not found');
const make = () => {
  const calls = [];
  const box = {
    window: { YT: { PlayerState: { ENDED: 0, PLAYING: 1 } } }, Date, ccfLoopTrace: [], debugLog() {},
    ccfBgmActiveSlotKey: 'BGM01', ccfBgmActiveEntryKey: 'e', ccfBgmActiveLoop: true, ccfBgmLoopArmed: true, ccfBgmStopping: false, ccfBgmPlayerVisible: true, ccfBgmPlayer: null,
    updateCcfBgmPersistedState: s => calls.push('persist:' + s), syncCcfYoutubeBgmPlayerDockVisibility() {}, markCcfYoutubeBgmSlotButtons() {}, startCcfBgmProgressLoop() {},
    syncCcfActiveBgmState() {}, enforceCcfYoutubeIdleSilence() {}, reinforceCcfYoutubeBgmAudio() {}, ccfBgmSlotMap: new Map(), findCcfReadyYoutubeEntryForSlot: () => null, readCcfYoutubeBgmPlaybackState: () => ({}), findCcfBgmButtonBySlot: () => null
  };
  const player = name => ({ seekTo: (t) => calls.push(`${name}.seekTo(${t})`), playVideo: () => calls.push(`${name}.play`) });
  const active = player('active'), standby = player('standby');
  box.ccfBgmPlayer = active;
  vm.runInNewContext(`${source.slice(h0, h1)}${source.slice(a, b)}; this.onState = handleCcfBgmPlayerStateChange;`, box);
  return { box, calls, active, standby };
};
// the active player ended, loop on -> from the start again
let t = make(); t.box.onState({ data: 0, target: t.active });
assert.deepEqual(t.calls, ['active.seekTo(0)', 'active.play']);
assert.equal(t.box.ccfLoopTrace.length, 1); assert.deepEqual([t.box.ccfLoopTrace[0].slot, t.box.ccfLoopTrace[0].loop, t.box.ccfLoopTrace[0].activePlayer], ['BGM01', true, true], 'the ENDED moment is recorded');
// the standby player ended (our own stopVideo on it): it is never started again
t = make(); t.box.onState({ data: 0, target: t.standby });
assert.deepEqual(t.calls, [], 'a standby ENDED does nothing');
assert.equal(t.box.ccfLoopTrace[0].activePlayer, false);
assert.equal(t.box.ccfBgmActiveSlotKey, 'BGM01', 'and does not clear the active slot');
// stopping by the user: no revival
t = make(); t.box.ccfBgmStopping = true; t.box.onState({ data: 0, target: t.active });
assert.deepEqual(t.calls.filter(c => c.includes('seekTo')), []);
// loop off: the song ends and the state goes to stopped
t = make(); t.box.ccfBgmActiveLoop = false; t.box.ccfBgmLoopArmed = false; t.box.onState({ data: 0, target: t.active });
assert.deepEqual(t.calls, ['persist:stopped']); assert.equal(t.box.ccfBgmActiveSlotKey, '');
// no active song: nothing is revived
t = make(); t.box.ccfBgmActiveSlotKey = ''; t.box.onState({ data: 0, target: t.active });
assert.deepEqual(t.calls, []);
// the trace keeps the latest 20 only
t = make(); for (let i = 0; i < 25; i++) t.box.onState({ data: 0, target: t.active });
assert.equal(t.box.ccfLoopTrace.length, 20);
console.log('bgm loop PASS');
