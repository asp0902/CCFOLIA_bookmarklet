const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Diagnostics only: the WebAudio source -> node chain is recorded (connect is patched but the original is always called), shown in __ccfBgmCounts().
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  const ccfAudioNodeIds = new WeakMap();'), b = source.indexOf('  window.__ccfBgmCounts = () => {', a);
assert(a >= 0 && b > a);
const ctx = vm.createContext({ WeakMap, Math });
vm.runInContext(`${source.slice(a, b)}\nthis.api = { idOf: ccfAudioIdOf, chainOf: ccfAudioChainOf, edges: ccfAudioEdges };`, ctx);
const { idOf, chainOf, edges } = ctx.api;
class GainNode { constructor(v) { this.gain = { value: v }; } } class Destination {}
const src = {}, g1 = new GainNode(0.5), g2 = new GainNode(1), dest = new Destination();
edges.set(src, [g1]); edges.set(g1, [g2]); edges.set(g2, [dest]);
const chain = chainOf(src);
assert.equal(JSON.stringify(chain.map((n) => n.type)), JSON.stringify(['GainNode', 'GainNode', 'Destination']));
assert.equal(chain[0].gain, 0.5); assert.equal(chain[1].gain, 1); assert.equal(chain[0].id, idOf(g1)); assert.notEqual(idOf(g1), idOf(g2));
// the patched connect calls the original and the stop/start records exist
assert.match(source, /return originalConnect\.apply\(this, arguments\);/);
assert.match(source, /webAudioGraph: \{ sources: ccfAudioSourceLog\.slice\(-20\), gainUsedBySourceCount: gainUse \}/);
assert.match(source, /record\.stopMs = /);
console.log('bgm audio graph diag PASS');
