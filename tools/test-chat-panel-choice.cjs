const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The extra room chat rolls choice like the native chat: choice[a,b,c] / choice(a,b,c) / choice a b c -> "(CHOICE[a,b,c]) ＞ x"; a secret (S) choice is not rolled here;
// a command the panel cannot roll still gets no format envelope.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-panel.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = source.indexOf('  function evaluateChoiceCommand('), b = source.indexOf('  // 순수 산술 주사위(NdM±K)', a);
assert(a >= 0 && b > a);
const ctx = vm.createContext({ Math, String, DICE_SKIN: {} });
vm.runInContext(`${source.slice(a, b)}\nthis.api = { evaluateChoiceCommand, looksLikeDiceCommand };`, ctx);
const { evaluateChoiceCommand: ev, looksLikeDiceCommand: looks } = ctx.api;
for (const text of ['choice[가,나,다]', 'choice(가,나,다)', 'choice 가 나 다', 'CHOICE[가, 나, 다]']) {
  const r = ev(text); assert(r, text);
  assert.match(r.roll.result, /^\(CHOICE\[가,나,다\]\) ＞ (가|나|다)$/, text);
  assert.equal(r.roll.dices.length, 0);
}
const seen = new Set(); for (let i = 0; i < 200; i += 1) seen.add(ev('choice[가,나,다]').roll.result.split('＞ ')[1]); assert.equal(seen.size, 3, 'every item can come up');
assert.equal(ev('Schoice[가,나]'), null, 'secret is not rolled here'); assert.equal(ev('choice[]'), null); assert.equal(ev('오늘 choice 한다'), null);
for (const t of ['choice[a,b]', 'Schoice[a,b]', 'choice(a,b)', 'choice a b', '2d6', 'S1D100', 'CC<=50', 'SC(1)']) assert.ok(looks(t), t);
for (const t of ['오늘 1D6 정도', '그냥 말', 'dice']) assert.ok(!looks(t), t);
assert.match(source, /!\(!meta && looksLikeDiceCommand\(cleanText\)\)/);
console.log('chat panel choice PASS');
