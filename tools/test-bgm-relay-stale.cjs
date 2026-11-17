// The play room kept the last "playing" YouTube BGM on the relay server: the GM sent "stopped" only for a manual stop and sent nothing on (re)connect without a
// signal, so a track stopped another way (native BGM, room change, deleted track) or long gone autoplayed for every participant who joined later.
// chat-notifier 0.3.45: every stop of the YouTube BGM tells the relay; relay-bridge (extension 1.52.16): a (re)connect without a signal sets the room to stopped.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notifier = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '../extension/personal/relay-bridge.js'), 'utf8');
const stopBody = notifier.slice(notifier.indexOf('  function stopCcfYoutubeBgm(reason = "manual") {'), notifier.indexOf('const MANUAL_STOP_REASONS', notifier.indexOf('  function stopCcfYoutubeBgm(')));
assert.match(stopBody, /dispatchEvent\(new CustomEvent\("capybara-bgm-signal", \{ detail: \{ state: "stopped"/, 'every stop reason tells the relay, before the manual-only Firestore emit');
assert.match(bridge, /post\(`\/api\/admin\/rooms\/\$\{encodeURIComponent\(id\)\}\/bgm`, lastBgm \|\| \{ state: "stopped" \}\)/, 'a connect without a signal sets the room to stopped');
console.log('bgm relay stale PASS');
