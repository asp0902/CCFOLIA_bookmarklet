// The version a script reports to the toolkit registry (and the console) must be the one in its @version header:
// chat-panel's literal stayed at 0.5.36 for many releases, so the registry showed an old version while the code was current.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '../legacy');
const bad = [];
for (const name of fs.readdirSync(dir).filter((n) => /^ccfolia-[a-z0-9-]+\.user\.js$/.test(n))) {
  const src = fs.readFileSync(path.join(dir, name), 'utf8');
  const header = (src.match(/@version\s+(\d+\.\d+\.\d+)/) || [])[1];
  const literal = (src.match(/(?:const VERSION|[A-Z_]*VERSION) = "(\d+\.\d+\.\d+)"|getUserscriptVersion\("(\d+\.\d+\.\d+)"\)|^\s*version: "(\d+\.\d+\.\d+)",/m) || []).slice(1).find(Boolean);
  if (/FALLBACK_TOOLKIT_VERSION/.test(src.match(/[A-Z_]*VERSION = "\d+\.\d+\.\d+"/)?.[0] || '')) continue;
  if (header && literal && header !== literal) bad.push(`${name}: header ${header}, reported ${literal}`);
}
assert.deepEqual(bad, [], 'reported version = @version header');
console.log('version literals PASS');
