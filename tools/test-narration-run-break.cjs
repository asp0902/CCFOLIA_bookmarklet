const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// A narration line and a plain line of the same speaker are not one run (the name and avatar come back after a narration line, and the other way round): decided from the message data
// (the envelope on the raw text), not from a render mark that may come late or from the neighbours; the log editor follows the same rule.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const bridge = read('legacy/ccfolia-roll20-css-bridge.user.js'), editor = read('log editor/index.html'), logPackage = read('legacy/ccfolia-log-package.user.js');
// the bridge part (a real page with the second IIFE of the script, no stubs) is tools/test-bridge-group-runs.cjs; here only the wiring
assert.ok(bridge.includes('return rowIsNarration(li) ? author + "\\\\u0000nr" : author;'), 'the group key uses the data based check');
// the helper lives in the second IIFE (where processList is): it must not use names of the first IIFE (INVIS_START, extractEnvelope)
const second = bridge.slice(bridge.indexOf('// ===== Prose Mode'));
const helper = second.slice(second.indexOf('const narrationByText'), second.indexOf('function processList('));
const helperCode = helper.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n"); // without the comment lines
assert.ok(helper.length > 200 && !/\bINVIS_START\b|\bextractEnvelope\b/.test(helperCode), 'self contained helper');
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
