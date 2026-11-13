// Handout list: search (title or public body, never the secret body; empty = all) and copy (new id, "(사본)", permissions / folder / image kept by value, no owner, not shared, ends up last).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-handout.user.js'), 'utf8');
const a = source.indexOf('  // ---- handout list helpers ----'), b = source.indexOf('  // ---- end handout list helpers ----');
assert(a >= 0 && b > a, 'helpers not found');
const box = { JSON, String };
vm.createContext(box);
vm.runInContext(`${source.slice(a, b)}\n;this.api = { matchesHandoutSearch, makeHandoutCopy };`, box);
const { matchesHandoutSearch: m, makeHandoutCopy: copy } = box.api;
const h = { id: 'a', title: 'Blood Moon 의식', description: '<p>밤 12시에&nbsp;열린다</p>', gmNotes: '<p>범인은 집사</p>' };
assert.equal(m(h, ''), true); assert.equal(m(h, '   '), true, 'blank = everything');
assert.equal(m(h, 'blood'), true, 'title, case-insensitive'); assert.equal(m(h, '열린다'), true, 'public body'); assert.equal(m(h, '<p>'), false, 'tags are not text');
assert.equal(m(h, '집사'), false, 'secret body is not searched'); assert.equal(m(h, '없는말'), false);
const src = { id: 'a', title: '의식', image: 'img1', description: 'd', gmNotes: 's', permissions: { 하나: { view: true, secret: false, edit: false } }, folderId: 'f1', tags: ['t'], ownerUid: 'u', ownerName: 'n', _remote: true, _canSecret: true, order: 10, createdAt: 'old', updatedAt: 'old' };
const c = JSON.parse(JSON.stringify(copy(src, 'new1', 30, 'NOW')));
assert.deepEqual(c, { id: 'new1', title: '의식 (사본)', image: 'img1', description: 'd', gmNotes: 's', permissions: { 하나: { view: true, secret: false, edit: false } }, folderId: 'f1', tags: ['t'], _remote: false, order: 30, createdAt: 'NOW', updatedAt: 'NOW' });
src.permissions.하나.view = false; assert.equal(c.permissions.하나.view, true, 'permissions are a copy, not shared with the original');
assert.equal(copy({ id: 'x' }, 'n', 1, 'N').title, '(제목 없음) (사본)');
console.log('handout search copy PASS');
// the list: the search box filters live and keeps its focus / caret, folders with no result drop out (collapsed ones open), copy appears as a card; the player list has search but no copy
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
function extract(name) { const start = source.search(new RegExp(`  (?:async )?function ${name}[(]`)); assert(start >= 0, name); return source.slice(start, source.indexOf('\n  }', start) + 4); }
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    await page.route('https://ccfolia.com/**', r => r.fulfill({ body: '<html><body></body></html>', contentType: 'text/html' }));
    await page.goto('https://ccfolia.com/rooms/test');
    const funcs = ['renderList', 'listSearchHtml', 'onShadowInput', 'closeListSearch', 'duplicateHandout', 'findHandout'].map(extract).join('\n');
    const helpers = source.slice(a, b);
    const out = await page.evaluate(async ([funcs, helpers]) => {
      const mk = (id, title, description, folderId, order) => ({ id, title, description, gmNotes: '', permissions: {}, folderId, order });
      const state = { search: '', plPreview: false, data: { myCharacter: 'GM', folders: [{ id: 'f1', name: '1막', collapsed: true }, { id: 'f2', name: '2막', collapsed: false }], handouts: [mk('a', '의식', '밤에 열린다', 'f1', 1), mk('b', '지도', '마을 약도', 'f2', 2), mk('c', '편지', '의식 초대장', '', 3)] }, shadow: document.body };
      let admin = true; const isAdminMode = () => admin;
      const escapeHtml = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'); const escapeAttr = escapeHtml;
      const ensurePermissions = h => h, canManageHandout = () => true, hasPlayerRelay = () => false, canViewSecret = () => false, getPermissionCharacterName = () => 'GM', identityKeys = () => [];
      const compareByOrder = (x, y) => x.order - y.order, ALL_KEY = '*';
      const ICON_SEARCH = '', ICON_COPY = '', ICON_DRAG_HANDLE = '', ICON_PENCIL = '', ICON_X_SMALL = '', WEB_SHARE_ICON = '', WEB_STOP_ICON = '';
      const toast = () => {}, saveAll = async () => {}, pushHandoutToFirestore = async () => {}, noteFirebaseIssue = () => {}, scheduleWebSync = () => {};
      let n = 0; const uuid = () => 'copy' + (++n), getNextOrder = () => 99;
      return await eval(`(async () => { ${helpers}\n${funcs}
        const render = () => { const list = renderList(); if (/data-list-search|search-open/.test(list)) throw new Error("the search is drawn in the list body (it belongs to the tab row)"); document.body.innerHTML = '<div class="tabs"><span class="tabs-search">' + (state.listSearchHtml || "") + '</span></div>' + list; }; // 0.1.119: the search sits at the right end of the tab row
        const titles = () => [...document.querySelectorAll('.card .card-title-btn')].map(e => e.textContent);
        const folders = () => [...document.querySelectorAll('.folder-section .folder-name')].map(e => e.textContent);
        const res = {};
        render(); res.all = titles(); res.allFolders = folders();
        const input = () => document.querySelector('input[data-list-search]');
        res.closedHasInput = !!input(); res.iconBtn = !!document.querySelector('button[data-action="search-open"]'); state.searchOpen = true; render(); // the search icon opens the one-line field
        res.openHasInput = !!input() && !!document.querySelector('button[data-action="search-close"]');
        const type = (v) => { const i = input(); i.focus(); i.value = v; i.setSelectionRange(v.length, v.length); onShadowInput({ target: i, isComposing: false }); };
        type('의식'); res.q1 = titles(); res.q1Folders = folders(); res.focused = document.activeElement === input() && input().value === '의식' && input().selectionStart === 2;
        type('없음'); res.q2 = titles(); res.none = !!document.querySelector('.list-no-result');
        type(''); res.back = titles(); closeListSearch(); res.afterClose = [!!input(), state.search, state.searchOpen];
        await duplicateHandout('c'); res.afterCopy = titles(); res.copy = state.data.handouts.find(h => h.id === 'copy1');
        admin = false; render(); res.plCopyBtn = document.querySelectorAll('[data-action="duplicate-handout"]').length; res.plSearch = !!document.querySelector('button[data-action="search-open"]');
        return res; })()`);
    }, [funcs, helpers]);
    assert.deepEqual(out.all, ['지도', '편지'], 'the collapsed folder hides its card'); assert.deepEqual(out.allFolders, ['1막', '2막']);
    assert.deepEqual([out.closedHasInput, out.iconBtn, out.openHasInput, out.afterClose], [false, true, true, [false, '', false]], 'search icon (no box) -> opens the one-line field with a clear/close X -> closing clears the filter');
    assert.deepEqual(out.q1, ['의식', '편지'], 'title or public body'); assert.deepEqual(out.q1Folders, ['1막'], 'only folders with a result, collapsed ones open');
    assert.equal(out.focused, true, 'focus and caret kept'); assert.deepEqual(out.q2, []); assert.equal(out.none, true);
    assert.equal(out.back.length, 2, 'empty = all again'); assert.equal(out.afterCopy.length, 3); assert.equal(out.afterCopy.filter(t => t === '편지 (사본)').length, 1);
    assert.equal(out.copy.order, 99); assert.equal(out.plCopyBtn, 0, 'no copy button for a player'); assert.equal(out.plSearch, true);
    console.log('handout list search/copy UI PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
