const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-log-package.user.js'), 'utf8');
const functions = ['ensureCharacterListSortables', 'clearCharacterSortableDecoration'].map(name => {
  const start = source.indexOf(`  function ${name}(`);
  assert(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}).join('\n');
const constants = source.split('\n').filter(line => /^  const CHARACTER_(LIST|SELECTION_LIST|ITEM|ITEM_ID|ITEM_BOUND|DRAGGING|DROP)_ATTR =/.test(line)).join('\n');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const checks = await page.evaluate(({ functions, constants }) => {
      let applied = 0, decorated = 0, legacyEvents = 0, nativeEvents = 0;
      const isVisible = () => true, getCharacterSelectionItems = () => [], getMyCharacterListItems = list => [...list.children];
      const applyStoredCharacterListOrder = () => applied++;
      const decorateCharacterListItem = () => decorated++;
      const migrateStoredCharacterListOrderToLabels = () => {}, persistCharacterListNames = () => {};
      const handleCharacterItemDragStart = () => legacyEvents++;
      const handleCharacterItemDragOver = () => {}, handleCharacterItemDrop = () => {}, handleCharacterItemDragEnd = () => {}, suppressCharacterItemClickAfterDrag = () => {};
      return eval(`(() => { ${constants}\n${functions}
        document.body.innerHTML = '<ul class="MuiList-root"><div><div aria-roledescription="sortable" role="button" tabindex="0">A</div><div aria-roledescription="sortable" role="button" tabindex="0">B</div></div></ul>';
        const list = document.querySelector('ul'), wrapper = list.firstElementChild;
        list.setAttribute(CHARACTER_LIST_ATTR, '1');
        wrapper.setAttribute(CHARACTER_ITEM_ATTR, '1');
        wrapper.setAttribute(CHARACTER_DRAGGING_ATTR, '1');
        wrapper.setAttribute('draggable', 'true');
        wrapper.addEventListener('dragstart', handleCharacterItemDragStart);
        wrapper.firstElementChild.addEventListener('pointerdown', () => nativeEvents++);
        ensureCharacterListSortables();
        ensureCharacterListSortables();
        wrapper.dispatchEvent(new Event('dragstart'));
        wrapper.firstElementChild.dispatchEvent(new Event('pointerdown'));
        const results = [!list.hasAttribute(CHARACTER_LIST_ATTR), !wrapper.hasAttribute(CHARACTER_ITEM_ATTR), !wrapper.hasAttribute(CHARACTER_DRAGGING_ATTR), !wrapper.hasAttribute('draggable'), applied === 0, decorated === 0, legacyEvents === 0, nativeEvents === 1, list.textContent === 'AB', wrapper.firstElementChild.tabIndex === 0];
        document.body.innerHTML = '<ul class="MuiList-root"><li>A</li><li>B</li></ul>';
        ensureCharacterListSortables();
        results.push(decorated === 2, applied === 1);
        return results;
      })()`);
    }, { functions, constants });
    checks.forEach((pass, i) => assert(pass, `check ${i + 1}`));
    console.log(`Character list sorter: ${checks.length} checks passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
