const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The picture in the BGM area belongs to the player that makes the sound. The crossfade moves the sound to the second player; both iframes sit in the same one-square dock that shows only
// the first of them, so the old song's picture stayed. Now the iframe of the player that is not the active one is marked standby and hidden by the notifier's CSS.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');
// 1) the marking function, with fake players
const a = source.indexOf('  function markCcfBgmActiveFrame() {'), b = source.indexOf('  function syncCcfYoutubeBgmPlayerDockVisibility() {', a);
assert(a >= 0 && b > a);
class HTMLElement { constructor() { this.attrs = {}; } setAttribute(k, v) { this.attrs[k] = v; } }
const frameA = new HTMLElement(), frameB = new HTMLElement();
const ctx = vm.createContext({ HTMLElement, Set });
const playerA = { getIframe: () => frameA }, playerB = { getIframe: () => frameB };
vm.runInContext(`let ccfBgmPlayer = null, ccfBgmPlayerB = null; const ccfBgmPlayerPair = [];\n${source.slice(a, b)}\nthis.api = { mark: markCcfBgmActiveFrame, set(p, pb, pair) { ccfBgmPlayer = p; ccfBgmPlayerB = pb; ccfBgmPlayerPair.length = 0; ccfBgmPlayerPair.push(...pair); } };`, ctx);
ctx.api.set(playerA, playerB, [playerA, playerB]); ctx.api.mark();
assert.equal(frameA.attrs['data-ccf-bgm-standby'], '0'); assert.equal(frameB.attrs['data-ccf-bgm-standby'], '1');
ctx.api.set(playerB, playerB, [playerA, playerB]); ctx.api.mark(); // the crossfade handed the sound to the second player
assert.equal(frameB.attrs['data-ccf-bgm-standby'], '0', 'the new song\'s picture is the one shown'); assert.equal(frameA.attrs['data-ccf-bgm-standby'], '1', 'the old one is hidden');
// 2) the wiring: marked when the crossfade starts, when it gives up, and with every dock visibility sync
assert.match(source, /ccfBgmPlayer = incoming;\n\s+markCcfBgmActiveFrame\(\);/);
assert.match(source, /ccfBgmPlayer = outgoing;\n\s+markCcfBgmActiveFrame\(\);/);
assert.match(source, /function syncCcfYoutubeBgmPlayerDockVisibility\(\) \{\n\s+markCcfBgmActiveFrame\(\);/);
// 3) the CSS in a real page: a standby iframe in the dock is not displayed, the active one is
const cssStart = source.indexOf('.ccf-youtube-bgm-player-dock iframe[data-ccf-bgm-standby="1"]');
assert(cssStart >= 0);
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const rules = source.slice(cssStart - 10, source.indexOf('}', cssStart) + 1);
    await page.setContent(`<style>.ccf-youtube-bgm-player-dock{width:200px;height:200px;overflow:hidden}.ccf-youtube-bgm-player-dock iframe{display:block;width:200px;height:200px}${rules.replace(/^[^.]*/, '')}</style>
      <div class="ccf-youtube-bgm-player-dock"><iframe id="a" data-ccf-bgm-standby="1"></iframe><iframe id="b" data-ccf-bgm-standby="0"></iframe></div>`);
    const shown = await page.evaluate(() => ({ a: getComputedStyle(document.getElementById('a')).display, b: getComputedStyle(document.getElementById('b')).display, bTop: document.getElementById('b').getBoundingClientRect().top - document.querySelector('.ccf-youtube-bgm-player-dock').getBoundingClientRect().top }));
    assert.equal(shown.a, 'none'); assert.notEqual(shown.b, 'none'); assert.equal(shown.bTop, 0, 'the active iframe is the one that fills the dock');
    console.log('bgm active frame PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
