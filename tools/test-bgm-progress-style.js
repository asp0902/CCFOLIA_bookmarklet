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
sandbox.ccfBgmLastNativeMedia = { paused: false, ended: false }; sandbox.updateCcfBgmProgressBar(); assert.equal(idle(), "0", "native audio playing: shown");
assert.match(source, /\.ccf-bgm-progress-root\[data-ccf-bgm-idle="1"\] \{ display: none !important; \}/);
assert.match(source, /div:has\(> \[data-ccf-bgm-panel="1"\]\) \{\s*border-top: 0 !important;/);
console.log("BGM progress styling tests passed");
