const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../legacy/ccfolia-chat-notifier.user.js"), "utf8");
class HTMLInputElement {
  dataset = {};
  value = "0";
  style = { setProperty: (name, value) => { this[name] = value; } };
}
const range = new HTMLInputElement();
const start = source.indexOf("  function updateCcfBgmProgressBar(");
const end = source.indexOf("  function readCcfBgmPlaybackTime(", start);
const sandbox = {
  HTMLInputElement, Date,
  ccfBgmProgressRoot: { attrs: {}, querySelector: selector => selector === ".ccf-bgm-progress-input" ? range : null, getAttribute(n) { return this.attrs[n] ?? null; }, setAttribute(n, v) { this.attrs[n] = String(v); } },
  readCcfBgmPlaybackTime: () => ({ total: 100, now: 40 }),
  ccfBgmLoopNudgeAt: 0, ccfBgmLoopNudgeFromTotal: 0, ccfBgmActiveLoop: false,
  // chat-notifier 0.3.46: a YouTube track playing (state 1)
  ccfBgmActiveSlotKey: "slot", ccfBgmPlayer: { state: 1, getPlayerState() { return this.state; } }, ccfBgmLastNativeMedia: null, ccfBgmLoopArmed: false, ccfBgmStopping: false,
  shouldRestartEndedCcfBgm: (st) => st === 0 && sandbox.ccfBgmLoopArmed
};
vm.runInNewContext(source.slice(start, end), sandbox);
// CCFOLIA plays BGM from pooled `new Audio` elements that are never put in the DOM (1.37.6)
class HTMLMediaElement {}
const audio = (props) => Object.assign(new HTMLMediaElement(), { paused: false, ended: false, loop: false, duration: 120, currentTime: 5, volume: 1, isConnected: false }, props);
const pool = [];
const helper = source.indexOf("  function findPlayingCcfBgmTrackMedia(");
vm.runInNewContext(source.slice(helper, source.indexOf("  function findActiveNativeBgmMedia(", helper)), sandbox);
Object.assign(sandbox, { HTMLMediaElement, BGM_WEB_AUDIO_MIN_DURATION: 8, getCcfNativeMediaCandidates: () => pool, isPotentialNativeBgmMedia: () => true, getNativeMediaScore: (m) => (m === sandbox.ccfBgmLastNativeMedia ? 30 : 0) + (m.paused ? 0 : 100), ccfBgmLastWebAudio: null });
sandbox.updateCcfBgmProgressBar();
assert.equal(range.value, "400");
assert.equal(range["--ccf-bgm-progress"], "40%");
range.dataset.ccfDragging = "1";
range.value = "600";
sandbox.updateCcfBgmProgressBar();
assert.equal(range.value, "600");
// 0.3.46: the progress line shows only while a track is on: playing -> shown; ended / stopped / nothing (an entry sound that ended) -> hidden; a looping restart pending -> shown
const idle = () => sandbox.ccfBgmProgressRoot.attrs["data-ccf-bgm-idle"];
range.dataset.ccfDragging = "";
sandbox.updateCcfBgmProgressBar(); assert.equal(idle(), "0", "playing: shown");
sandbox.ccfBgmPlayer.state = 0; sandbox.updateCcfBgmProgressBar(); assert.equal(idle(), "1", "ended: hidden");
sandbox.ccfBgmLoopArmed = true; sandbox.updateCcfBgmProgressBar(); assert.equal(idle(), "0", "ended but looping: shown"); sandbox.ccfBgmLoopArmed = false;
sandbox.ccfBgmActiveSlotKey = ""; sandbox.ccfBgmPlayer = null; sandbox.ccfBgmLastNativeMedia = { paused: true, ended: true }; sandbox.updateCcfBgmProgressBar(); assert.equal(idle(), "1", "only a finished entry sound: hidden");
const shown = (list, web = null) => { pool.splice(0, pool.length, ...list); sandbox.ccfBgmLastNativeMedia = list[0] || null; sandbox.ccfBgmLastWebAudio = web; sandbox.updateCcfBgmProgressBar(); return idle() === "0"; };
assert.equal(shown([audio()]), true, "file BGM in a detached element: shown");
assert.equal(shown([audio({ volume: 0 })]), true, "volume 0 still plays: shown");
assert.equal(shown([audio({ loop: true, duration: 3 })]), true, "a short looping BGM: shown");
assert.equal(shown([audio({ paused: true }), audio()]), true, "the remembered element is an old one, another plays: shown");
assert.equal(sandbox.ccfBgmLastNativeMedia, pool[1], "time is read from the one playing");
assert.equal(shown([audio({ duration: 2 })]), false, "entry sound alone: hidden");
assert.equal(shown([audio({ paused: true, ended: true })]), false, "ended: hidden");
assert.equal(shown([audio({ paused: true })]), false, "stopped: hidden");
assert.equal(shown([], { stopped: false, loop: true, total: 3 }), true, "WebAudio BGM: shown");
assert.equal(shown([], { stopped: true, loop: true, total: 90 }), false, "WebAudio stopped: hidden");
assert.equal(shown([], { stopped: false, loop: false, total: 2 }), false, "short WebAudio sound: hidden");
assert.match(source, /\.ccf-bgm-progress-root\[data-ccf-bgm-idle="1"\] \{ display: none !important; \}/);
assert.match(source, /div:has\(> \[data-ccf-bgm-panel="1"\]\) \{\s*border-top: 0 !important;/);
console.log("BGM progress styling tests passed");
