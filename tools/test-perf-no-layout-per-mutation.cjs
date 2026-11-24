// Typing delay with the extra panel open (user: closing the panel makes typing fast). CCFOLIA changes the DOM while typing (the typing line under the box);
// two MutationObservers then read layout synchronously on every change: roll20 bridge's chat-macro-menu check (every textarea, every menu) and chat-panel's
// menu-item insertion (every [role=menu]). With the panel open (twice the elements) that was ~20 ms of script per DOM change in a 300-row mock (CPU profile),
// ~4 ms after. Now: no menu candidates -> no layout reads; both run at most once per frame; the panel's own menus are skipped before reading layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const bridge = read('legacy/ccfolia-roll20-css-bridge.user.js');
assert.match(bridge, /function hasVisibleChatMacroMenu\(\) \{\n(\s*\/\/.*\n)*\s*if \(!document\.querySelector\(CHAT_MACRO_MENU_SELECTOR\)\) return false;/);
assert.match(bridge, /function scheduleChatMacroMenuSync\(\) \{\n\s*if \(chatMacroMenuSyncQueued\) return;/);
assert.doesNotMatch(bridge.slice(bridge.indexOf('function observeUiDom'), bridge.indexOf('function bindGlobalEvents')), /\n\s*syncChatMacroMenuButtonVisibility\(\);/, 'observers schedule, they do not run it inline');
const panel = read('legacy/ccfolia-chat-panel.user.js');
assert.match(panel, /const observer = new MutationObserver\(\(\) => \{ if \(!active \|\| menuItemQueued\) return; menuItemQueued = true; requestAnimationFrame\(/);
assert.match(panel, /menu\.closest\("\.ccf-scp-panel, \[data-capybara-toolkit-chat-panel\]"\) \|\| !isVisible\(menu\)/);
console.log('perf no layout per mutation PASS');
