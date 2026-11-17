// log-package 0.0.52: the exported log keeps the message font (style.fontId from format-sync 0.1.124, allow list only), draws it in both renderers
// and links the used Google fonts in the exported HTML head (an unknown id is dropped).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const log = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-log-package.user.js'), 'utf8');
const pick = (name) => { const at = log.indexOf(`  function ${name}(`); return log.slice(at, log.indexOf('\n  }', at) + 4); };
const ctx = vm.createContext({ window: {} });
vm.runInContext(['logMessageFonts', 'logFontsUsed', 'logFontLinksHtml'].map(pick).join('\n') + '\nlogFontsUsed().add(logMessageFonts()["nanum-myeongjo"]); this.out = logFontLinksHtml(); this.bad = Object.prototype.hasOwnProperty.call(logMessageFonts(), "http://evil/x");', ctx);
assert.equal(ctx.out, '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo&display=swap">');
assert.equal(ctx.bad, false, 'unknown ids are not in the list');
assert(log.includes('if (typeof style.fontId === "string" && Object.prototype.hasOwnProperty.call(logMessageFonts(), style.fontId)) out.fontId = style.fontId;'), 'cleanupStyle keeps a known font id');
assert.equal(log.split('if (style.fontId) { const family = logMessageFonts()[style.fontId];').length - 1, 2, 'both log renderers draw it');
assert(/- CCF Log Package<\/title>\s*\$\{logFontLinksHtml\(\)\}/.test(log), 'the head links the used fonts');
console.log('log message font PASS');
