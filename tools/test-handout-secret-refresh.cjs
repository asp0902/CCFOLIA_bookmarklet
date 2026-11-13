// handout 0.1.123: a copy changed by the GM (secret right on / off, view right removed) redraws the player's open show window at once: the secret body appears, disappears,
// and the window closes when the copy is removed. The real ingestRemoteHandout / showHandoutModal / refreshOpenShows / ingestRemoteRemove run in a page with small stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-handout.user.js'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert(a > 0 && b > a, 'code not found: ' + from); return source.slice(a, b); };
const code = cut('  function ingestRemoteHandout(data, changeType) {', '  // ===== 수신자별 사본(inbox) =====') + cut('  function showBodyHtml(handout, hasSecret) {', '  function initFirebase() {');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8><body></body>');
    await page.evaluate((code) => {
      const ALL_KEY = '__all__';
      const stubs = `
        const ALL_KEY = '${ALL_KEY}'; const fbState = { uid: 'anon-p' }; const inboxActive = true; const ingestSkipLog = new Map();
        const state = { data: { myCharacter: '눈깅', handouts: [] }, isOpen: false };
        const permFor = (h, name, extra, col) => !!(h.permissions && h.permissions[ALL_KEY] && h.permissions[ALL_KEY][col]);
        const canView = (h, n, e) => permFor(h, n, e, 'view'), canViewSecret = (h, n, e) => permFor(h, n, e, 'secret');
        const noteIngestSkip = () => {}, identityKeys = () => [], isAdminMode = () => false, getNextOrder = () => 0, toast = () => {}, saveAll = async () => {}, render = () => {};
        const escapeHtml = (v) => String(v || '').replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';'), escapeAttr = escapeHtml, renderHandoutBody = (v) => escapeHtml(v);
        const canManageHandout = () => false, openPanel = async () => {}, setTab = () => {}, resolveHandoutImagesIn = () => {}, registerTeardown = () => {};
      `;
      window.__t = new Function(`${stubs}\n${code}\n;return { ingestRemoteHandout, ingestRemoteRemove, showHandoutModal, state };`)();
    }, code);
    const ingest = (secret, gmNotes, type) => page.evaluate(([secret, gmNotes, type]) => window.__t.ingestRemoteHandout({ id: 'h1', title: '바깥', description: '공개 본문', gmNotes, ownerUid: 'anon-gm', permissions: { __all__: { view: true, secret } }, _viaInbox: true }, type), [secret, gmNotes, type]);
    const look = () => page.evaluate(() => { const hosts = [...document.querySelectorAll('[data-ccf-handout-show="1"]')]; return hosts.map((h) => ({ id: h.dataset.handoutId, secret: h.shadowRoot.querySelector('.secret-block')?.textContent.includes('비밀 본문') || false, pub: h.shadowRoot.querySelector('.show-body .rendered')?.textContent })); });
    // view only: the copy has no secret body
    await ingest(false, '', 'added');
    await page.evaluate(() => window.__t.showHandoutModal(window.__t.state.data.handouts[0], 'GM'));
    assert.deepEqual(await look(), [{ id: 'h1', secret: false, pub: '공개 본문' }]);
    // the GM turns the secret right on and saves: the copy is modified -> the open window shows the secret body
    await ingest(true, '비밀 본문', 'modified');
    assert.deepEqual(await look(), [{ id: 'h1', secret: true, pub: '공개 본문' }], 'secret appears in the open window');
    // the secret right off again: it disappears
    await ingest(false, '', 'modified');
    assert.deepEqual(await look(), [{ id: 'h1', secret: false, pub: '공개 본문' }], 'secret disappears');
    // the view right removed: the copy is deleted -> the window closes
    await page.evaluate(() => window.__t.ingestRemoteRemove('h1'));
    assert.deepEqual(await look(), [], 'window closed');
    assert.deepEqual(errors, []);
    // diagnostics are in place
    assert.match(source, /copyHasSecretText: !!copy\?\.gmNotes, signature:/);
    assert.match(source, /copies: state\.data\.handouts\.filter\(\(h\) => h\._remote\)\.map/);
    console.log('handout secret refresh PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
