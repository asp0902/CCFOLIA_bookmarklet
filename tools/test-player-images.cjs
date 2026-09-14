const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function extract(file, names) {
  const source = fs.readFileSync(path.join(__dirname, '../legacy', file), 'utf8');
  return names.map(name => {
    const start = source.indexOf(`  function ${name}(`);
    assert(start >= 0, name);
    return source.slice(start, source.indexOf('\n  }', start) + 4);
  }).join('\n');
}
class HTMLElement {
  constructor(name, image) { this.name = name; this.image = image; }
  querySelector() { return this.image; }
}
const image = src => ({ complete: true, naturalWidth: 32, currentSrc: src });
const context = { HTMLElement, isLikelyChatAuthorItem: () => true, extractChatAuthorName: item => item.name,
  normalizePlNameKey: name => name.trim(), state: { data: { plList: [{ name: 'A', aliases: ['Alias'], image: 'https://old.test/a' }] } },
  findChatAuthorImageByName: () => 'https://new.test/a' };
vm.createContext(context);
vm.runInContext(extract('ccfolia-handout.user.js', ['collectChatAuthorEntries', 'extractChatAuthorImage', 'getPlayerImage']), context);
const entries = context.collectChatAuthorEntries([new HTMLElement('A', null), new HTMLElement('A', image('https://new.test/a')), new HTMLElement('A', { complete: true, naturalWidth: 0, currentSrc: 'https://broken.test/a' })]);
assert.equal(entries.length, 1);
assert.equal(entries[0].image, 'https://new.test/a');
assert.equal(context.getPlayerImage('Alias'), 'https://new.test/a');
context.findChatAuthorImageByName = () => '';
assert.equal(context.getPlayerImage('Alias'), 'https://old.test/a');
context.window = { __CCF_HANDOUT_DEBUG__: { getPlayers: () => [{ name: 'A' }], getPlayerImage: context.getPlayerImage } };
context.cleanText = value => String(value || '');
context.escapeHtml = value => value.replaceAll('"', '&quot;');
vm.runInContext(extract('ccfolia-character-sheet.user.js', ['permissionRows', 'renderPlayerAvatar']), context);
assert.equal(context.permissionRows({ permissions: {} })[1].image, 'https://old.test/a');
assert(context.renderPlayerAvatar('https://old.test/a').includes('<img'));
assert(!context.renderPlayerAvatar('javascript:alert(1)').includes('<img'));
assert(!context.renderPlayerAvatar('').includes('<img'));
console.log('Player image collection, refresh, aliases, shared rows and URL checks passed');
