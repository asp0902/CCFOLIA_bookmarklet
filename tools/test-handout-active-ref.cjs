const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// The handout script's init() read a variable `active` that only exists inside createLegacyLifecycle: `if (active) mountIcon()` was a ReferenceError at every delayed mount (since the lifecycle
// moved into a shared factory, db5479d). It asks the lifecycle through isActive() now. Outside the factory a condition on a bare `active` is not allowed unless the same function declares it.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8').replace(/\r\n/g, '\n');
const lines = source.split('\n');
const factoryStart = lines.findIndex((l) => l.includes('function createLegacyLifecycle('));
const factoryEnd = lines.findIndex((l, i) => i > factoryStart && /^  }$/.test(l));
assert(factoryStart > 0 && factoryEnd > factoryStart, 'the factory was found');
const stray = [];
lines.forEach((line, i) => {
  if (i >= factoryStart && i <= factoryEnd) return;
  if (!/\bif \(active\b|\(!active\b|!active\b\)|&& active\b|\|\| active\b/.test(line.replace(/\/\/.*$/, ''))) return;
  if (/\b(?:const|let|var)\s+active\b/.test(lines.slice(Math.max(0, i - 40), i + 1).join('\n'))) return; // a local variable of that function
  stray.push(`${i + 1}: ${line.trim()}`);
});
assert.deepEqual(stray, [], 'no condition on an `active` that is not in scope');
assert.match(source, /setTimeout\(\(\) => \{ if \(isActive\(\)\) mountIcon\(\); \}, ms\);/);
console.log('handout active reference PASS');
