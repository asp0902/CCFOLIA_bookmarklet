// A slot changed from a YouTube track to an uploaded file: coming back to the room plays the file only, the remembered YouTube track is not restored and the relay is told it stopped.
// CCFOLIA's players are read from its own class, so a track that started before the toolkit loaded is still found.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert(i >= 0 && j > i, a); return source.slice(i, j); };
const events = [], persisted = [];
let room = null;
const window = { dispatchEvent: (event) => events.push(event.detail) };
const sandbox = {
  window, debugLog() {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  normalizeCcfBgmSlotKey: (v) => String(v), scanExistingNativeBgmMedia() {}, findCcfBgmButtonBySlot: () => null, findPlayingCcfNativeBgmMediaForRestore: () => null,
  ccfBgmNativeLoadedSlots: new Set(), updateCcfBgmPersistedState: (s) => persisted.push(s), startCcfBgmProgressLoop() {}, updateCcfBgmProgressBar() {}, markCcfYoutubeBgmSlotButtons() {},
  getNativeMediaSource: () => '', serializeError: String, extractCcfYoutubeUrl: (u) => (/youtu/.test(u) ? u : ''), ccfBgmRoomNow: () => room,
};
vm.runInNewContext(`${between('  function ccfBgmRoomSlotHasFile(', '  function ccfBgmRoomNow(')}\n${between('  function shouldSkipCcfYoutubeRestoreForNativeBgm(', '  function findPlayingCcfNativeBgmMediaForRestore(')}`, sandbox);
assert.equal(sandbox.ccfBgmRoomSlotHasFile('BGM01'), null, 'the room has not loaded yet');
room = { mediaUrl: 'https://storage.ccfolia-cdn.net/a.mp3', soundUrl: null };
assert.equal(sandbox.shouldSkipCcfYoutubeRestoreForNativeBgm('BGM01'), true, 'BGM01 now holds a file: no restore');
assert.deepEqual(persisted, ['stopped']); assert.equal(events.at(-1).state, 'stopped', 'the relay is told');
assert.equal(sandbox.shouldSkipCcfYoutubeRestoreForNativeBgm('BGM02'), false, 'BGM02 is still free');
room = { mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk', soundUrl: 'https://storage.ccfolia-cdn.net/b.mp3' };
assert.equal(sandbox.shouldSkipCcfYoutubeRestoreForNativeBgm('BGM01'), false, 'a YouTube address is not a file');
assert.equal(sandbox.shouldSkipCcfYoutubeRestoreForNativeBgm('BGM02'), true, 'BGM02 is the sound field');
// the two restore paths wait for the room instead of guessing
assert.match(between('  function primeAutoplayFastPath(', '  function initCcfBgmEnhancer('), /ccfBgmRoomSlotHasFile\(persisted\.slotKey\) === null\) return;/);
assert.match(between('  function prepareCcfYoutubeBgmPlayerFromEntries(', '  function cueCcfYoutubeBgmSlot('), /ccfBgmRoomSlotHasFile\(targetSlotKey\) === null\) \{\n\s*if \(ccfBgmRestoreWaits < 100\)/);
// CCFOLIA's own players are candidates, found once through its module table
const player = { audioElement: { id: 'detached' } };
const factory = function () { return 'audioSourceNodePool'; };
let pushes = 0;
const page = { webpackChunkccfolia: { push: ([, , run]) => { pushes += 1; const req = () => ({ z: Object.assign(function P() {}, { unlockAudio() {}, players: [player] }) }); req.m = { 1: function other() {}, 2: factory }; run(req); } } };
const boxed = { window: page, Function, Object, Symbol };
vm.runInNewContext(`${between('  function ccfBgmCcfoliaPlayers(', '  function ccfBgmRoomSlotHasFile(')}`, boxed);
assert.equal(boxed.ccfBgmCcfoliaPlayers()[0], player); boxed.ccfBgmCcfoliaPlayers(); assert.equal(pushes, 1, 'looked up once');
assert.match(between('  function getCcfNativeMediaCandidates(', '  function isUsableNativeBgmMedia('), /ccfBgmCcfoliaPlayers\(\)/);
assert.match(between('  function scanExistingNativeBgmMedia(', '  function shouldSkipCcfYoutubeRestoreForNativeBgm('), /const allMedia = getCcfNativeMediaCandidates\(\);/);
console.log('bgm restore file PASS');
// 0.3.52: YouTube -> file in the same slot (user case: after a reload both played). The GM's switch now records "stopped" for the other screens,
// and a "playing" record that started before this page opened (= a reload) is not followed while the slot holds a file / CCFOLIA audio plays;
// without room data yet it waits for the next poll instead of playing.
assert.match(source, /const shouldEmit = MANUAL_STOP_REASONS\.has\(reason\) \|\| reason === "native-library-selected";/);
assert.match(source, /if \(\(Number\(data\.startedAt\) \|\| 0\) < ccfBgmPageOpenedAt\) \{\n\s*const hasFile = ccfBgmRoomSlotHasFile\(normalizeCcfBgmSlotKey\(data\.slotKey\)\);\n\s*if \(hasFile === null\) \{ ccfBgmFirestoreLastPlaybackSignature = ""; return; \}\n\s*if \(shouldSkipCcfYoutubeRestoreForNativeBgm\(data\.slotKey, "remote-restore"\)\) return;\n\s*\}/);
assert.match(source, /const ccfBgmPageOpenedAt = Math\.round\(\(typeof performance !== "undefined" && performance\.timeOrigin\) \|\| Date\.now\(\)\);/);
console.log('bgm restore file (remote) PASS');
// 0.3.54: GM's own reload (local record): no restore while the room data is unknown (waits up to 30 s, then only cues — it used to restore after 3 s)
assert.match(source, /if \(persisted\?\.state === "playing" && ccfBgmRoomSlotHasFile\(targetSlotKey\) === null\) \{\n\s*if \(ccfBgmRestoreWaits < 100\) \{/);
assert.match(source, /ccfBgmRestoreConsumed = true;\n\s*cueCcfYoutubeBgmSlot\(targetSlotKey, hit\[1\], hit\[0\]\);\n\s*return;\n\s*\}\n\n\s*if \(persisted\?\.state === "playing"\) \{/);
console.log('bgm restore file (local wait) PASS');
