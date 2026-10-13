// The page script of the extension hands the GM's commands to the chat panel: every kind the bridge lets through must reach its handler and be answered (an unanswered command made the play room wait for nothing).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'relay-page.js'), 'utf8');
  const posted = [], listeners = [], calls = [];
  const sandbox = { console, URL, Node: { TEXT_NODE: 3 }, setInterval() {}, setTimeout() {}, clearTimeout() {},
    document: { documentElement: { dataset: {} }, title: '', querySelectorAll: () => [], createElement: () => ({ style: {} }) }, location: { pathname: '/rooms/R1', origin: 'https://ccfolia.com' },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); }, postMessage: message => posted.push(message) };
  sandbox.window = sandbox; sandbox.window.top = sandbox;
  sandbox.__CCF_SECOND_CHAT_PANEL__ = {
    relayObject: async command => { calls.push(['object', command.type, command.kind, command.targetId, command.fields]); return 'new-doc'; },
    relaySend: async (...args) => { calls.push(['send', args[1]]); },
    relayMovePiece: async (...args) => { calls.push(['move', args.slice(0, 4)]); },
    relaySetStatus: async (...args) => { calls.push(['status', args]); }
  };
  vm.createContext(sandbox); vm.runInContext(page, sandbox);
  assert.equal(listeners.length, 1);
  const inner = vm.runInContext('window', sandbox);
  const send = async command => { posted.length = 0; await listeners[0]({ source: inner, origin: 'https://ccfolia.com', data: { source: 'capybara-player-room-relay-v1', direction: 'bridge', action: 'command', roomId: 'R1', command } }); return posted.filter(m => m.action === 'commandResult'); };
  // the new object commands reach the chat panel and are answered with the new document's id
  let result = await send({ id: 'c1', type: 'object.create', kind: 'character', fields: { name: '알리스' } });
  assert.equal(JSON.stringify(calls.pop()), JSON.stringify(['object', 'object.create', 'character', '', { name: '알리스' }]));
  assert.equal(JSON.stringify(result.map(m => [m.commandId, m.status, m.objectId])), JSON.stringify([['c1', 'delivered', 'new-doc']]));
  for (const type of ['object.update', 'object.delete', 'object.duplicate', 'object.place']) { result = await send({ id: type, type, kind: 'character', targetId: 'doc1', fields: {} }); assert.equal(calls.pop()[1], type); assert.equal(result[0].status, 'delivered'); }
  result = await send({ id: 'd1', type: 'object.create', kind: 'dice', x: 1, y: 2, faces: 6 }); assert.equal(calls.pop()[2], 'dice'); assert.equal(result[0].objectId, 'new-doc');
  // the older commands still work
  result = await send({ id: 's1', type: 'chat.send', text: '안녕', channel: 'main' }); assert.equal(JSON.stringify(calls.pop()), JSON.stringify(['send', '안녕'])); assert.equal(result[0].status, 'delivered');
  result = await send({ id: 'm1', type: 'piece.move', kind: 'item', pieceId: 'p', x: 1, y: 2 }); assert.equal(calls.pop()[0], 'move');
  result = await send({ id: 't1', type: 'status.set', characterId: 'c', index: 0, value: 3 }); assert.equal(calls.pop()[0], 'status');
  // something that is not a command is ignored (no answer), another room too
  assert.equal((await send({ id: 'x', type: 'object.explode' })).length, 0); assert.equal(calls.length, 0);
  // a failing handler is answered with the reason
  sandbox.__CCF_SECOND_CHAT_PANEL__.relayObject = async () => { throw new Error('이 룸은 참여자가 오브젝트를 만들 수 없습니다.'); };
  result = await send({ id: 'f1', type: 'object.create', kind: 'character', fields: {} });
  assert.equal(JSON.stringify(result.map(m => [m.status, m.error])), JSON.stringify([['failed', '이 룸은 참여자가 오브젝트를 만들 수 없습니다.']]));
  console.log('relay page commands PASS');
})().catch(error => { console.error(error); process.exit(1); });
