// #239: the progress-bar loop backup only restarts a song that is playing; a stopped song at its end is never restarted just because loop became ON.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-notifier.user.js'), 'utf8');
const a = source.indexOf('  function isCcfYoutubeBgmPlayingNow()');
const b = source.indexOf('  function readCcfBgmPlaybackTime()');
assert(a >= 0 && b > a, 'nudge code not found');
const run = ({ state, loop = true, slot = 'BGM01', now = 285.4, total = 285.5 }) => {
  const calls = [];
  const box = {
    HTMLInputElement: class {}, Date, Math, Number, String, Object,
    ccfBgmProgressRoot: { querySelector: () => null },
    ccfBgmPlayer: { getPlayerState: () => state, seekTo: (t) => calls.push(`seekTo(${t})`), playVideo: () => calls.push('play') },
    ccfBgmActiveSlotKey: slot, ccfBgmActiveLoop: loop, readCcfBgmPlaybackTime: () => ({ now, total }), debugLog() {}, serializeError: String, formatCcfBgmTime: String
  };
  vm.runInNewContext(`${source.slice(a, b)}; this.tick = updateCcfBgmProgressBar; this.playing = isCcfYoutubeBgmPlayingNow;`, box);
  box.tick();
  return { calls, box };
};
// playing near the end with loop on: back to the start (the backup that makes the loop work)
for (const state of [1, 3]) assert.deepEqual(run({ state }).calls, ['seekTo(0)', 'play'], `state ${state}`);
// stopped at the end (ended / paused / cued / unstarted) with loop switched on: nothing is started
for (const state of [0, 2, 5, -1]) assert.deepEqual(run({ state }).calls, [], `state ${state}: no restart`);
// no active song: nothing
assert.deepEqual(run({ state: 1, slot: '' }).calls, []);
// loop off: nothing
assert.deepEqual(run({ state: 1, loop: false }).calls, []);
// not near the end: nothing
assert.deepEqual(run({ state: 1, now: 100 }).calls, []);
// the helper
assert.equal(run({ state: 1 }).box.playing(), true); assert.equal(run({ state: 0 }).box.playing(), false); assert.equal(run({ state: 1, slot: '' }).box.playing(), false);
console.log('bgm loop nudge PASS');
