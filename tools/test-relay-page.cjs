const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'extension/personal/relay-page.js'), 'utf8');
const SOURCE = 'capybara-player-room-relay-v1';

function createPage({ api } = {}) {
  const state = { posted: [], intervals: [], timeouts: [], listeners: [] };
  const sandbox = {
    console, URL, Node: { TEXT_NODE: 3 }, Date,
    setInterval: fn => { state.intervals.push(fn); return state.intervals.length; },
    setTimeout: fn => { state.timeouts.push(fn); return state.timeouts.length; },
    document: { documentElement: { dataset: {} }, title: 'CCFOLIA 1.0 - tool', querySelectorAll: () => [] },
    location: { pathname: '/rooms/R1', origin: 'https://ccfolia.com' },
    addEventListener: (type, fn) => state.listeners.push([type, fn]),
    postMessage: message => state.posted.push(message),
    __CCF_SECOND_CHAT_PANEL__: api,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('window.top = window;', sandbox);
  vm.runInContext(source, sandbox);
  const snapshots = () => state.posted.filter(message => message.source === SOURCE && message.action === 'snapshot');
  return { state, sandbox, snapshots };
}
const panel = (messages, subscribers) => ({
  relayMessages: () => messages.map(message => ({ ...message })),
  relaySubscribe: callback => { subscribers.push(callback); return () => {}; },
});

// Subscribes to the store, re-reads the chat on change (debounced), and polls only as a slow safety net.
{
  const subscribers = [];
  const messages = [{ id: 'a', name: 'GM', text: '첫 글', at: 1 }];
  const page = createPage({ api: panel(messages, subscribers) });
  assert.equal(subscribers.length, 1, 'subscribed immediately when the panel API is available');
  assert.equal(page.snapshots().length, 1, 'initial snapshot');
  messages.push({ id: 'b', name: 'GM', text: '새 글', at: 2 });
  subscribers[0](); subscribers[0](); subscribers[0]();
  assert.equal(page.state.timeouts.length, 1, 'bursts of store changes are debounced into one snapshot');
  page.state.timeouts[0]();
  const latest = page.snapshots().at(-1);
  assert.equal(latest.messages.length, 2);
  assert.equal(latest.messages[1].text, '새 글');
  // After a snapshot a new burst can schedule again.
  subscribers[0]();
  assert.equal(page.state.timeouts.length, 2);
  // Safety net: only every 5th tick snapshots when subscribed.
  const before = page.snapshots().length;
  for (let tick = 0; tick < 5; tick++) page.state.intervals[0]();
  assert.equal(page.snapshots().length, before + 1, 'slow safety-net polling while subscribed');
}

// The panel can appear later (loader still starting): subscribe on a later tick, poll fast until then.
{
  const subscribers = [];
  const page = createPage();
  assert.equal(subscribers.length, 0);
  const before = page.snapshots().length;
  page.state.intervals[0]();
  page.state.intervals[0]();
  assert.equal(page.snapshots().length, before, 'no panel API -> nothing to snapshot');
  page.sandbox.__CCF_SECOND_CHAT_PANEL__ = panel([{ id: 'x', name: 'GM', text: 't', at: 1 }], subscribers);
  page.state.intervals[0]();
  assert.equal(subscribers.length, 1, 'subscribed once the panel appears');
  page.state.intervals[0]();
  page.state.intervals[0]();
  assert.equal(subscribers.length, 1, 'never subscribes twice');
}

// An older panel script without relaySubscribe keeps working by polling every tick.
{
  const page = createPage({ api: { relayMessages: () => [{ id: 'o', name: 'GM', text: 'old', at: 1 }] } });
  const before = page.snapshots().length;
  page.state.intervals[0](); page.state.intervals[0]();
  assert.equal(page.snapshots().length, before + 2, 'polls each tick without subscription support');
}

// A throwing subscribe must not break the page script.
{
  const page = createPage({ api: { relayMessages: () => [], relaySubscribe: () => { throw new Error('no store yet'); } } });
  page.state.intervals[0]();
  assert.equal(page.sandbox.document.documentElement.dataset.capybaraPlayerRelay, '1');
}
console.log('relay-page: store-driven snapshots (debounced), late subscription, polling fallback passed');
