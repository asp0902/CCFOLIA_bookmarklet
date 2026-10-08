// #239: the progress-bar loop backup only restarts a song that is playing; a stopped song at its end is never restarted just because loop became ON.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-notifier.user.js'), 'utf8');
const a = source.indexOf('  function shouldRestartEndedCcfBgm(');
const b = source.indexOf('  function readCcfBgmPlaybackTime()');
assert(a >= 0 && b > a, 'nudge code not found');
const run = ({ state, loop = true, slot = 'BGM01', now = 285.4, total = 285.5, armed = false, stopping = false, ticks = 1 }) => {
  const calls = [];
  const box = {
    HTMLInputElement: class {}, Date, Math, Number, String, Object,
    ccfBgmProgressRoot: { querySelector: () => null },
    ccfBgmPlayer: { getPlayerState: () => state, seekTo: (t) => calls.push(`seekTo(${t})`), playVideo: () => calls.push('play') },
    ccfBgmActiveSlotKey: slot, ccfBgmActiveLoop: loop, ccfBgmLoopArmed: armed, ccfBgmStopping: stopping, readCcfBgmPlaybackTime: () => ({ now, total }), debugLog() {}, serializeError: String, formatCcfBgmTime: String
  };
  vm.runInNewContext(`${source.slice(a, b)}; this.tick = updateCcfBgmProgressBar; this.playing = isCcfYoutubeBgmPlayingNow;`, box);
  for (let i = 0; i < ticks; i++) box.tick();
  return { calls, box };
};
// playing near the end with loop on: back to the start (the backup that makes the loop work)
for (const state of [1, 3]) assert.deepEqual(run({ state }).calls, ['seekTo(0)', 'play'], `state ${state}`);
// stopped at the end (ended / paused / cued / unstarted) with loop switched on and no armed loop: nothing is started
for (const state of [0, 2, 5, -1]) assert.deepEqual(run({ state }).calls, [], `state ${state}: no restart`);
// #239 stays fixed: a song that ended while loop was OFF is not armed; turning loop on afterwards does not restart it
let r = run({ state: 1, loop: false });
assert.equal(r.box.ccfBgmLoopArmed, false, 'playing with loop off: not armed');
r.box.ccfBgmActiveLoop = true; // the old behaviour copied the toggled setting into the active loop flag of a stopped song
r.box.ccfBgmPlayer.getPlayerState = () => 0;
r.box.tick(); assert.deepEqual(r.calls, [], 'ended + loop switched on later: no restart');
// #116: playing with loop ON arms it; if the progress check then misses the last 0.25 s and the song ends (state 0), it starts again
r = run({ state: 1, now: 100 });
assert.equal(r.box.ccfBgmLoopArmed, true, 'playing with loop on: armed');
r.box.ccfBgmPlayer.getPlayerState = () => 0;
r.box.tick(); assert.deepEqual(r.calls, ['seekTo(0)', 'play'], 'ended while armed: restarted by the progress check');
// the user stopped it: not armed any more (stopCcfYoutubeBgm clears it) and stopping blocks a restart
r.box.ccfBgmLoopArmed = false; r.calls.length = 0; r.box.tick(); assert.deepEqual(r.calls, [], 'after stop: no restart');
assert.deepEqual(run({ state: 0, armed: true, stopping: true }).calls, [], 'stopping: no restart');
assert.deepEqual(run({ state: 0, armed: true, slot: '' }).calls, [], 'no active song: no restart');
assert(/ccfBgmStopping = true;\s*ccfBgmLoopArmed = false;/.test(source), 'stopCcfYoutubeBgm clears the armed flag');
// no active song: nothing
assert.deepEqual(run({ state: 1, slot: '' }).calls, []);
// loop off: nothing
assert.deepEqual(run({ state: 1, loop: false }).calls, []);
// not near the end: nothing
assert.deepEqual(run({ state: 1, now: 100 }).calls, []);
// the helper
assert.equal(run({ state: 1 }).box.playing(), true); assert.equal(run({ state: 0 }).box.playing(), false); assert.equal(run({ state: 1, slot: '' }).box.playing(), false);
console.log('bgm loop nudge PASS');
