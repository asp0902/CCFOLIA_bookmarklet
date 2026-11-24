// Typing delay / idle work (measured on the real test room, dpr 1.5, 100 rows):
// - chat-panel re-read every character and queued a redraw on ANY store change; typing changes only the app state, so each key cost ~7 ms more
//   (CCFOLIA alone 5.5 ms per input event, + chat-panel 12.5 ms). It now reacts only when entities change.
// - the BGM bar, the theme's top-bar marks and the Roll20 button re-wrote the same values every tick (244 DOM changes in 8 idle seconds),
//   waking every script's MutationObserver. They now write only what changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const panel = read('legacy/ccfolia-chat-panel.user.js');
assert.match(panel, /if \(lastSlices && slices\.every\(\(slice, i\) => slice === lastSlices\[i\]\)\) return; lastSlices = slices; if \(refreshSelectedChar\(\)\) renderSpeakerHook\?\.\(\); queueRender\(\);/);
// behaviour of that guard: app-state-only changes do nothing, an entities change redraws
{
  const m = panel.match(/let lastSlices = null;\n\s*unsubscribe = scpHost\.subscribe\(store, \(\) => \{ (.*?) \}\);/);
  assert(m, 'guarded subscriber');
  let renders = 0; let state = { entities: { a: 1 }, app: { state: { text: '' } } };
  const fn = new Function('store', 'refreshSelectedChar', 'renderSpeakerHook', 'queueRender', `let lastSlices = null; return () => { ${m[1]} };`)({ getState: () => state }, () => false, null, () => { renders += 1; });
  fn(); assert.equal(renders, 1);
  for (let i = 0; i < 5; i++) { state = { ...state, app: { state: { text: 'x'.repeat(i) } } }; fn(); }
  assert.equal(renders, 1, 'typing (app state only): no redraw');
  state = { ...state, entities: { ...state.entities, roomMessages: { ids: [1] } } }; fn(); assert.equal(renders, 2, 'a new message: redraw');
}
const notifier = read('legacy/ccfolia-chat-notifier.user.js');
assert.match(notifier, /function setCcfAttrIfChanged\(el, name, value\) \{ if \(el\.getAttribute\(name\) !== value\) el\.setAttribute\(name, value\); \}/);
assert.match(notifier, /if \(current && current\.textContent !== nowText\) current\.textContent = nowText;/);
assert.match(notifier, /if \(button\.dataset\.folded !== String\(folded\)\) \{/);
assert.match(read('legacy/ccfolia-theme-switcher.user.js'), /if \(anchor\.getAttribute\(APPBAR_ATTR\) !== "1"\) anchor\.setAttribute\(APPBAR_ATTR, "1"\);/);
const bridge = read('legacy/ccfolia-roll20-css-bridge.user.js');
assert.match(bridge, /if \(btn\.hidden !== hideBtn\) btn\.hidden = hideBtn;/);
assert.match(bridge, /if \(!btn\.classList\.contains\("is-footer"\)\) btn\.classList\.add\("is-footer"\);/);
console.log('perf typing idle PASS');
