// character-sheet 0.5.41 + theme-switcher 0.2.39: a dice button by each sheet item (outside the item's label, so the label does not send) sends "[아이템] 이름" (+ the known
// text, 부적); the count is not changed. The Insane Roll20 theme draws it as an item card (speaker grey / 아이템 rgb(255,77,85) / name bold / text centred).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sheet = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-character-sheet.user.js'), 'utf8');
assert.match(sheet, /<span class="ccf-cs-item-cell"><label>\$\{escapeHtml\(label\)\}<input[^`]*<\/label><button type="button" class="ccf-cs-item-use/, 'the button is outside the label');
assert.match(sheet, /if \(button\.dataset\.itemUse\) \{ const name = button\.dataset\.itemUse; const text = ITEM_TEXTS\[name\]; return writeChat\(`\[아이템\] \$\{name\}/, 'it sends "[아이템] 이름"');
assert.doesNotMatch(sheet.slice(sheet.indexOf('if (button.dataset.itemUse)'), sheet.indexOf('if (button.dataset.itemUse)') + 300), /items\[|data-item="/, 'the count is not touched');
console.log('item card (sheet) PASS');
