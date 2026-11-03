const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The time of a log message: whatever form CCFOLIA keeps it in (Firestore Timestamp object, seconds, milliseconds, ISO string) becomes one ISO string when collected, the time the page shows
// ("오늘 14:39") gets its date, and the editor shows YYYY-MM-DD HH:mm:ss (a time without seconds as it is).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-log-package.user.js'), 'utf8').replace(/\r\n/g, '\n');
const editor = fs.readFileSync(path.join(__dirname, '../log editor/index.html'), 'utf8').replace(/\r\n/g, '\n');
const slice = (text, startMarker, endMarker) => { const a = text.indexOf(startMarker), b = text.indexOf(endMarker, a); assert(a >= 0 && b > a, startMarker); return text.slice(a, b); };
const collector = vm.createContext({ Date, Number, String, Math, Element: class {}, Node: class {} });
vm.runInContext(`${slice(source, '  function firstRuntimeTimestamp(', '  function firstRuntimeString(')}\n${slice(source, '  function getRuntimeValueByPath(', '  function isRuntimeObjectLike(')}\n${slice(source, '  function resolveRelativeTimestamp(', '  function splitSenderTimestampMeta(')}\nthis.api = { firstRuntimeTimestamp, normalizeRuntimeTimestamp, resolveRelativeTimestamp };`, collector);
const shown = vm.createContext({ Date, Number, String, Math, Date });
vm.runInContext(`${slice(editor, '  function formatEntryTimestamp(', '  function showEmpty(')}\nthis.api = { formatEntryTimestamp };`, shown);
const { firstRuntimeTimestamp, normalizeRuntimeTimestamp, resolveRelativeTimestamp } = collector.api, { formatEntryTimestamp } = shown.api;

const ms = Date.UTC(2026, 10, 3, 5, 39, 5, 250); // 2026-11-03T05:39:05.250Z
const iso = new Date(ms).toISOString();
const forms = {
  'Timestamp with toMillis': { toMillis: () => ms },
  'Timestamp with toDate': { toDate: () => new Date(ms) },
  'seconds + nanoseconds': { seconds: Math.floor(ms / 1000), nanoseconds: 250 * 1e6 },
  '_seconds + _nanoseconds': { _seconds: Math.floor(ms / 1000), _nanoseconds: 250 * 1e6 },
  'milliseconds': ms,
  'ISO string': iso
};
for (const [label, value] of Object.entries(forms)) assert.equal(normalizeRuntimeTimestamp(value), iso, label);
assert.equal(normalizeRuntimeTimestamp(Math.floor(ms / 1000)), new Date(Math.floor(ms / 1000) * 1000).toISOString(), 'seconds');
assert.equal(normalizeRuntimeTimestamp({}), '', 'an unknown object has no time');
// the first path that holds a time wins, an object counts
assert.equal(firstRuntimeTimestamp({ createdAt: { seconds: Math.floor(ms / 1000), nanoseconds: 0 }, time: 'x' }, [['timestamp'], ['createdAt'], ['time']]), new Date(Math.floor(ms / 1000) * 1000).toISOString());
assert.equal(firstRuntimeTimestamp({ other: 1 }, [['timestamp'], ['createdAt']]), '');
// what the page shows gets a date
const two = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
assert.equal(resolveRelativeTimestamp('오늘 14:39'), `${day(0)} 14:39`);
assert.equal(resolveRelativeTimestamp('어제 09:05:07'), `${day(-1)} 09:05:07`);
assert.equal(resolveRelativeTimestamp('今日 14:39'), `${day(0)} 14:39`);
assert.equal(resolveRelativeTimestamp('today 2:39 PM'), `${day(0)} 14:39`);
assert.equal(resolveRelativeTimestamp('2026-11-03 14:39'), '2026-11-03 14:39', 'a date is left alone');
// the editor shows YYYY-MM-DD HH:mm:ss (local time)
const local = new Date(ms);
const expected = `${local.getFullYear()}-${two(local.getMonth() + 1)}-${two(local.getDate())} ${two(local.getHours())}:${two(local.getMinutes())}:${two(local.getSeconds())}`;
assert.equal(formatEntryTimestamp(iso), expected);
assert.equal(formatEntryTimestamp(ms), expected);
assert.match(formatEntryTimestamp(iso), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
assert.equal(formatEntryTimestamp('2026-11-03 14:39'), '2026-11-03 14:39', 'no invented seconds');
assert.equal(formatEntryTimestamp(''), ''); assert.equal(formatEntryTimestamp(null), '');
// both copies of the editor are the same page
const marker = '  const CAPYBARA_LOG_EDITOR_HTML = ';
const start = source.indexOf(marker) + marker.length;
assert.equal(JSON.parse(source.slice(start, source.indexOf('\n', start)).replace(/;$/, '')), editor, 'the copy inside the log package is the editor');
console.log('log timestamp PASS');
