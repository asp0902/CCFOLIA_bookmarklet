const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// A listener who joins late (reload + bookmarklet) gets the BGM that is playing now: an old "playing" signal is no longer thrown away; a looping song is moved to (elapsed % length),
// a one-shot song only if some of it is left (else it is stopped), and when the browser blocks the sound a "click to play" notice appears and the first click starts it.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(!source.includes('bgm-firestore-playback-stale-ignored'), 'the stale-ignore of a playing signal is gone');
assert.match(source, /ccfBgmAlignJoinedPlayback\(data, ageMs\);\n\s+return;/);
const a = source.indexOf('  let ccfBgmJoinTimer = 0;'), b = source.indexOf('  async function ccfBgmFirestorePollPlayback()', a);
assert(a >= 0 && b > a);
// fake time and a fake page around the real function
let now = 0, timers = [], nextId = 1; const listeners = {}; const seeks = []; let stopped = 0; let played = 0;
const body = { children: [], appendChild(el) { this.children.push(el); el.remove = () => { this.children = this.children.filter((x) => x !== el); }; } };
const document = { body, createElement: () => ({ style: {}, textContent: '' }), addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
const window = { setInterval: (fn, ms) => { const t = { id: nextId++, fn, ms, at: now + ms }; timers.push(t); return t.id; }, clearInterval: (id) => { timers = timers.filter((t) => t.id !== id); } };
const advance = (ms) => { const end = now + ms; for (;;) { const due = timers.filter((t) => t.at <= end).sort((x, y) => x.at - y.at)[0]; if (!due) break; now = due.at; due.at += due.ms; due.fn(); } now = end; };
const state = { value: 1, duration: 100 };
const ctx = vm.createContext({ window, document, Math, Number, debugLog() {}, normalizeCcfBgmSlotKey: (k) => k, chatNotifierLifecycle: { isActive: () => true },
  stopCcfYoutubeBgm: () => { stopped += 1; }, ccfBgmFirestorePlaybackApplying: false, ccfBgmActiveSlotKey: 'BGM01', ccfBgmActiveEntryKey: 'E1',
  ccfBgmPlayer: { getPlayerState: () => state.value, getDuration: () => state.duration, seekTo: (t) => seeks.push(Math.round(t)), playVideo: () => { played += 1; state.value = 1; } } });
vm.runInContext(`${source.slice(a, b)}\nthis.align = ccfBgmAlignJoinedPlayback;`, ctx);
const reset = () => { timers = []; seeks.length = 0; stopped = 0; played = 0; Object.keys(listeners).forEach((k) => delete listeners[k]); body.children.length = 0; state.value = 1; };
// looping song started 35 minutes ago, 100 s long: moved to (2100 % 100 = 0)... use a length that gives an offset
reset(); state.duration = 240; ctx.align({ slotKey: 'BGM01', entryKey: 'E1', loop: true }, 2097146); advance(1000);
assert.deepEqual(seeks, [Math.round((2097146 / 1000) % 240)], 'loop: elapsed % length');
// one-shot song with time left
reset(); state.duration = 300; ctx.align({ slotKey: 'BGM01', entryKey: 'E1', loop: false }, 120000); advance(1000);
assert.deepEqual(seeks, [120], 'one-shot: the elapsed position');
// one-shot song that already ended
reset(); state.duration = 100; ctx.align({ slotKey: 'BGM01', entryKey: 'E1', loop: false }, 600000); advance(1000);
assert.equal(stopped, 1, 'one-shot: already finished -> stopped'); assert.deepEqual(seeks, []);
// a fresh signal does not seek
reset(); ctx.align({ slotKey: 'BGM01', entryKey: 'E1', loop: true }, 1000); advance(1000);
assert.deepEqual(seeks, [], 'fresh: no seek');
// the browser blocks the sound: the player stays unstarted -> notice, then the first click plays and aligns
reset(); state.value = -1; state.duration = 240; ctx.align({ slotKey: 'BGM01', entryKey: 'E1', loop: true }, 600000); advance(5000);
assert.equal(body.children.length, 1, 'click-to-play notice'); assert.match(body.children[0].textContent, /클릭하면 BGM/);
listeners.pointerdown(); advance(1200);
assert.equal(played, 1, 'the first click plays'); assert.equal(body.children.length, 0, 'notice gone'); assert.deepEqual(seeks, [Math.round(600 % 240)], 'aligned after the click');
// another song started meanwhile: give up quietly
reset(); state.value = -1; ctx.align({ slotKey: 'BGM01', entryKey: 'E1', loop: true }, 600000); ctx.ccfBgmActiveEntryKey = 'E2'; advance(5000);
assert.equal(body.children.length, 0, 'no notice for a song that is no longer the active one');
console.log('bgm join playback PASS');
