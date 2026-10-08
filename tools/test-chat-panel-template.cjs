// Sending into a room with no messages: fetchTemplateFields falls back to the measured default template; with messages it still copies a real one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  const DEFAULT_MESSAGE_TEMPLATE');
const b = source.indexOf('  function makeTimestampLike(');
assert(a >= 0 && b > a, 'template code not found');
let rows = [];
const sandbox = { FIRESTORE_BASE: 'https://fs.test', fetch: async () => ({ ok: true, json: async () => rows }), Object, Array, Error, encodeURIComponent };
vm.runInNewContext(`${source.slice(a, b)}; this.fetchTemplateFields = fetchTemplateFields; this.DEFAULT = DEFAULT_MESSAGE_TEMPLATE;`, sandbox);
const ctx = { roomId: 'R', token: 't', uid: 'me' };
const plain = x => JSON.parse(JSON.stringify(x));
(async () => {
  const empty = plain(await sandbox.fetchTemplateFields(ctx));
  // names and types as measured on a native message document
  assert.deepEqual(Object.keys(empty).sort(), ['channel', 'channelName', 'color', 'createdAt', 'edited', 'extend', 'from', 'iconUrl', 'imageUrl', 'name', 'text', 'to', 'toName', 'type', 'updatedAt']);
  const types = Object.fromEntries(Object.entries(empty).map(([k, v]) => [k, Object.keys(v)[0]]));
  assert.deepEqual(types, { channel: 'stringValue', channelName: 'stringValue', color: 'stringValue', createdAt: 'timestampValue', edited: 'booleanValue', extend: 'mapValue', from: 'stringValue', iconUrl: 'stringValue', imageUrl: 'nullValue', name: 'stringValue', text: 'stringValue', to: 'nullValue', toName: 'stringValue', type: 'stringValue', updatedAt: 'timestampValue' });
  assert.equal(empty.type.stringValue, 'text');
  // the shared default is not handed out by reference
  (await sandbox.fetchTemplateFields(ctx)).text = { stringValue: 'changed' };
  assert.equal(sandbox.DEFAULT.text.stringValue, '');
  // with messages: a real one is copied (mine first)
  rows = [{ document: { fields: { text: { stringValue: 'a' }, from: { stringValue: 'other' }, extra: { stringValue: 'x' } } } }, { document: { fields: { text: { stringValue: 'b' }, from: { stringValue: 'me' }, own: { stringValue: 'y' } } } }];
  const copied = plain(await sandbox.fetchTemplateFields(ctx));
  assert.equal(copied.own.stringValue, 'y', 'copies my latest real message');
  assert.equal('extra' in copied, false);
  console.log('chat panel template PASS');
})().catch(error => { console.error(error); process.exit(1); });
