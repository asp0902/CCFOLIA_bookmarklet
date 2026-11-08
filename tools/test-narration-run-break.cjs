const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// A narration line and a plain line of the same speaker are not one run (the name and avatar come back after a narration line, and the other way round): decided from the message data
// (the envelope on the raw text), not from a render mark that may come late or from the neighbours; the log editor follows the same rule.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const bridge = read('legacy/ccfolia-roll20-css-bridge.user.js'), editor = read('log editor/index.html'), logPackage = read('legacy/ccfolia-log-package.user.js');
const a = bridge.indexOf('  const narrationByText = new WeakMap();'), b = bridge.indexOf('  function processList(', a);
assert(a >= 0 && b > a);
const START = '\u2063\u2063\u2063';
const ctx = vm.createContext({ WeakMap, INVIS_START: START, extractEnvelope: (t) => { const m = t.match(/\u2063\u2063\u2063(.*)$/s); return m ? { envelope: JSON.parse(m[1]) } : null; } });
vm.runInContext(`${bridge.slice(a, b)}\nthis.isNarr = rowIsNarration;`, ctx);
const li = (text, marked = false) => ({ getAttribute: () => (marked ? '1' : null), querySelector: (sel) => (sel === 'p.MuiListItemText-secondary' ? { textContent: text } : null) });
assert.equal(ctx.isNarr(li('바라바라' + START + JSON.stringify({ blockStyle: { narration: true } }))), true, 'narration found in the envelope without any render mark');
assert.equal(ctx.isNarr(li('그냥 말' + START + JSON.stringify({ blockStyle: {} }))), false);
assert.equal(ctx.isNarr(li('봉투 없음')), false);
assert.equal(ctx.isNarr(li('x', true)), true, 'the render mark still counts');
assert.ok(bridge.includes('return rowIsNarration(li) ? author + "\\\\u0000nr" : author;'), 'the group key uses the data based check');
// the log editor
const m1 = editor.indexOf('  function mergeConsecutiveSpeakerEntries('), m2 = editor.indexOf('  function renderSelectedTabEntries(', m1);
const ectx = vm.createContext({ Array, String, Boolean });
vm.runInContext(`const getHtmlEdgeType = () => "";\n${editor.slice(m1, m2)}\nthis.merge = mergeConsecutiveSpeakerEntries;`, ectx);
const e = (text, narration) => ({ sender: '눈깅이', tabId: 'main', text, visibleText: text, packageHtml: `<p>${text}</p>`, blockStyle: narration ? { narration: true } : {} });
let out = ectx.merge([e('말1'), e('말2'), e('바라바라', true), e('바라2', true), e('다시 말')]);
assert.equal(out.length, 3, 'plain run / narration run / plain run');
assert.equal(out[0].__mergedEntries.length, 2); assert.equal(out[1].__mergedEntries.length, 2); assert.equal(out[2].__mergedEntries.length, 1);
const marker = '  const CAPYBARA_LOG_EDITOR_HTML = ';
const start = logPackage.indexOf(marker) + marker.length;
assert.equal(JSON.parse(logPackage.slice(start, logPackage.indexOf('\n', start)).replace(/;$/, '')), editor, 'the copy inside the log package is the editor');
console.log('narration run break PASS');
