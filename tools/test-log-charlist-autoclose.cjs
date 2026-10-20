const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
// The capybara log opens CCFOLIA's "my characters" list to read the avatars: the list is closed again only when the log opened it, whichever way that list answers to
// (own close button / the list button as a toggle / the backdrop / Escape), and a list the user left open stays.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-log-package.user.js'), 'utf8');
const functions = ['collectCharacterProfilesFromButton', 'findCharacterListRoot', 'closeCharacterListPopup'].map(name => {
  const start = source.indexOf(`  async function ${name}(`) >= 0 ? source.indexOf(`  async function ${name}(`) : source.indexOf(`  function ${name}(`);
  assert(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}).join('\n');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const results = await page.evaluate(async ({ functions }) => {
      const isVisible = el => el instanceof HTMLElement && el.isConnected && !el.hidden && getComputedStyle(el).display !== 'none';
      const normalizeSpace = v => String(v || '').replace(/\s+/g, ' ').trim();
      const waitForAnimationFrame = () => new Promise(r => requestAnimationFrame(r));
      const scoreCharacterListRoot = root => (root.dataset.list ? 5 : 0);
      const extractCharacterProfilesFromRoot = () => new Map([['a', 'x']]);
      const mergeCharacterProfileMaps = (t, s) => { s.forEach((v, k) => t.set(k, v)); return t; };
      const run = eval(`(() => { ${functions}\n return collectCharacterProfilesFromButton; })()`);
      const out = {};
      // mode: which way closes the fake list
      const scenario = async (mode, preOpen) => {
        document.body.innerHTML = '<button id="b" aria-label="내 캐릭터 목록">내 캐릭터 목록</button>';
        const button = document.getElementById('b');
        const open = () => {
          if (document.getElementById('pop')) return;
          const pop = document.createElement('div');
          pop.id = 'pop'; pop.className = 'MuiModal-root'; pop.dataset.list = '1';
          pop.innerHTML = '<div class="MuiBackdrop-root" style="position:fixed;inset:0"></div><div class="MuiPaper-root"><button aria-label="Close"><svg data-testid="CloseIcon"></svg></button><ul><li>캐릭터</li></ul></div>';
          document.body.append(pop);
          const close = () => pop.remove();
          if (mode === 'closeButton') pop.querySelector('[aria-label=Close]').addEventListener('click', close);
          if (mode === 'backdrop') pop.querySelector('.MuiBackdrop-root').addEventListener('click', close);
          if (mode === 'escape') document.addEventListener('keydown', function h(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', h); } });
          if (mode === 'toggle') { /* the button below closes it */ }
        };
        button.addEventListener('click', () => { const pop = document.getElementById('pop'); if (pop && mode === 'toggle') pop.remove(); else open(); });
        if (preOpen) open();
        const map = await run(button);
        return { found: map.size, stillOpen: !!document.getElementById('pop') };
      };
      for (const mode of ['closeButton', 'toggle', 'backdrop', 'escape']) out[mode] = await scenario(mode, false);
      out.preOpen = await scenario('closeButton', true);
      return out;
    }, { functions });
    for (const mode of ['closeButton', 'toggle', 'backdrop', 'escape']) assert.deepEqual(results[mode], { found: 1, stillOpen: false }, mode);
    assert.deepEqual(results.preOpen, { found: 1, stillOpen: true }, 'a list the user left open stays');
    console.log('log character list auto close PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
