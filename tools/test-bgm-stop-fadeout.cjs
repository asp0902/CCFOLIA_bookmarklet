const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Stop button: the YouTube BGM goes down to 0 in 1.5s (50ms steps, same as the crossfade), then stops, and the volume is put back; playing again during the fade cancels it.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  function cancelCcfBgmStopFade('), b = source.indexOf('  function stopCcfYoutubeBgm(', a);
assert(a >= 0 && b > a);
let timers = [], now = 0, nextId = 1;
const window = { setInterval: (fn, ms) => { const t = { id: nextId++, fn, ms, at: now + ms }; timers.push(t); return t.id; }, clearInterval: (id) => { timers = timers.filter((t) => t.id !== id); }, setTimeout: () => 0 };
const advance = (ms) => { const end = now + ms; while (true) { const due = timers.filter((t) => t.at <= end).sort((x, y) => x.at - y.at)[0]; if (!due) break; now = due.at; due.at += due.ms; due.fn(); } now = end; };
const ctx = vm.createContext({ window, Math, Number, debugLog() {}, serializeError: (e) => String(e), CCF_BGM_XFADE_MS: 1500, CCF_BGM_XFADE_STEP_MS: 50 });
vm.runInContext(`let ccfBgmStopFadeEnabled = true, ccfBgmStopFadeTimer = 0, ccfBgmStopFadeRestore = null, ccfBgmStopping = false;\n${source.slice(a, b)}\nthis.api = { fade: fadeOutAndStopCcfYoutubePlayer, cancel: cancelCcfBgmStopFade, state: () => ({ timer: ccfBgmStopFadeTimer, stopping: ccfBgmStopping }), disable() { ccfBgmStopFadeEnabled = false; } };`, ctx);
const { fade, cancel, state, disable } = ctx.api;
const player = (vol, st = 1) => { const p = { vol, st, stopped: false, log: [], getPlayerState: () => p.st, getVolume: () => p.vol, setVolume(v) { p.vol = v; p.log.push(v); }, stopVideo() { p.stopped = true; } }; return p; };
// fade down in 30 steps, stop at the end, volume restored
let p = player(80); assert.equal(fade(p), true);
advance(700); assert.ok(p.vol < 80 && p.vol > 0 && !p.stopped, 'mid fade'); assert.ok(state().timer);
advance(900); assert.equal(p.stopped, true, 'stopped after 1.5s'); assert.equal(p.vol, 80, 'volume restored for the next play'); assert.equal(state().timer, 0);
assert.ok(p.log.slice(0, 30).every((v, i, arr) => i === 0 || v <= arr[i - 1]), 'steps only go down');
// playing again during the fade cancels it and puts the volume back
p = player(60); fade(p); advance(600); assert.ok(p.vol < 60); cancel(); assert.equal(p.vol, 60); advance(2000); assert.equal(p.stopped, false, 'not stopped after cancel');
// nothing playing / silent -> no fade (the caller stops at once)
assert.equal(fade(player(80, 2)), false); assert.equal(fade(player(0)), false);
// the off switch
disable(); assert.equal(fade(player(80)), false);
// wiring: manual stops and remote stops fade, the sweep waits, a new play cancels
assert.match(source, /MANUAL_STOP_REASONS\.has\(reason\) \|\| reason === "remote-stop"\) && fadeOutAndStopCcfYoutubePlayer/);
assert.match(source, /if \(ccfBgmStopFadeTimer\) return;/);
assert.match(source, /ccfBgmLastWebAudio = null;\n    cancelCcfBgmStopFade\(\);/);
assert.match(source, /setStopFade\(on\)/);
console.log('bgm stop fadeout PASS');
