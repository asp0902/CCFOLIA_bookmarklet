// Diagnostic snippets that wait (await) before copying: Chrome's console copy() works only while the command line is being evaluated,
// so after an await it failed silently and the clipboard kept the snippet itself. They grab copy first, keep the result in
// window.__CCF_DIAG_RESULT__ and print how to copy it (like handout-gm-check-snippet's __HO_CHECK__).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'docs');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const firstAwait = s.indexOf('await '), lastCopy = s.lastIndexOf('copy(');
  if (firstAwait < 0 || lastCopy < firstAwait || f === 'handout-gm-check-snippet.js') continue;
  assert.match(s, /const _copy = typeof copy === "function" \? copy : null;/, `${f}: copy grabbed before waiting`);
  assert.match(s, /window\.__CCF_DIAG_RESULT__ = _t; try \{ _copy\?\.\(_t\); \} catch \(_\) \{\}/, `${f}: result kept + copied with the grabbed copy`);
  assert.doesNotMatch(s.slice(firstAwait), /[^_]copy\(JSON|[^_\w]copy\(text\)/, `${f}: no bare copy() after await`);
}
console.log('snippet copy PASS');
