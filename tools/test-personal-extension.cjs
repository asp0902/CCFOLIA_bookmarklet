const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension/personal');
const bootstrap = fs.readFileSync(path.join(extension, 'bootstrap.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.host_permissions, ['https://ccfolia.com/*', 'http://127.0.0.1:8787/*', 'https://capybara-iv.for-trpg.workers.dev/*']);
assert.deepEqual(manifest.permissions, ['scripting', 'storage']);
// Pinned key: the extension id (and so chrome.storage) must not depend on the folder path.
const derivedId = [...require('node:crypto').createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
assert.equal(derivedId, 'dhogfdgmikpinakhcofcddmcmoaenpjc');
assert.equal(manifest.content_scripts[0].world, 'MAIN');
assert.equal(manifest.content_scripts[0].all_frames, false);
assert.deepEqual(manifest.content_scripts[0].js, ['bootstrap.js', 'relay-page.js']);
assert.equal(manifest.content_scripts[1].world, 'ISOLATED');
assert.deepEqual(manifest.content_scripts[1].js, ['relay-bridge.js']);
assert.equal(manifest.options_page, undefined, 'settings live in the icon modal, not an options page');
assert(fs.existsSync(path.join(extension, 'share-modal.js')));

async function checkAction() {
  let clicked, messaged;
  const calls = [];
  const record = name => async value => { calls.push([name, value]); };
  const sandbox = {
    URL, console: { error() {} },
    chrome: {
      action: { onClicked: { addListener: fn => { clicked = fn; } }, setBadgeText: record('badge'), setBadgeBackgroundColor: record('color'), setTitle: record('title') },
      runtime: { onMessage: { addListener: fn => { messaged = fn; } } },
      scripting: { executeScript: async args => { calls.push(['inject', args]); return [{ result: true }]; } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), sandbox);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  // Icon click: the share modal is injected (isolated world) on room tabs only.
  await clicked({ id: 1, url: 'https://example.org/' });
  assert.equal(calls.filter(([name]) => name === 'inject').length, 0);
  assert(calls.some(([name, value]) => name === 'badge' && value.text === '!'));
  calls.length = 0;
  await clicked({ id: 2, url: 'https://ccfolia.com/rooms/test' });
  const injects = calls.filter(([name]) => name === 'inject').map(([, args]) => args);
  assert.equal(injects.length, 1);
  assert.equal(JSON.stringify(injects[0]), JSON.stringify({ target: { tabId: 2 }, files: ['share-modal.js'] }));
  assert(calls.some(([name, value]) => name === 'badge' && value.text === ''));
  // "툴킷 열기" in the modal: only a message from a room tab opens the panel (MAIN world).
  calls.length = 0;
  messaged({ type: 'capybara-open-toolkit' }, { tab: { id: 3, url: 'https://example.org/' } });
  messaged({ type: 'other' }, { tab: { id: 3, url: 'https://ccfolia.com/rooms/x' } });
  await flush();
  assert.equal(calls.filter(([name]) => name === 'inject').length, 0);
  messaged({ type: 'capybara-open-toolkit' }, { tab: { id: 3, url: 'https://ccfolia.com/rooms/x' } });
  await flush();
  const opened = calls.filter(([name]) => name === 'inject').map(([, args]) => args);
  assert.equal(opened.length, 2);
  assert(opened.every(args => args.world === 'MAIN' && args.target.tabId === 3));
  sandbox.chrome.scripting.executeScript = async () => [{ result: false }];
  calls.length = 0;
  messaged({ type: 'capybara-open-toolkit' }, { tab: { id: 3, url: 'https://ccfolia.com/rooms/x' } });
  await flush();
  assert(calls.some(([name, value]) => name === 'badge' && value.text === '!'));
}

(async () => {
  await checkAction();
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: process.env.HEADED !== '1',
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  try {
    let requests = 0, failNext = false, realLoader = false;
    const loaderPath = '/CCFOLIA_bookmarklet/src/capybara-toolkit-loader.js';
    const mockLoader = 'window.__CAPYBARA_TOOLKIT__={openPanel(){document.body.dataset.opened="1";},closePanel(){}};';
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'asp0902.github.io' && url.pathname === loaderPath) {
        requests++;
        if (failNext) { failNext = false; return route.abort(); }
        await new Promise(resolve => setTimeout(resolve, 50));
        return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: realLoader ? fs.readFileSync(path.join(root, 'src/capybara-toolkit-loader.js'), 'utf8') : mockLoader });
      }
      if (realLoader && url.hostname === 'asp0902.github.io' && /^\/CCFOLIA_bookmarklet\/legacy\/[\w-]+\.user\.js$/.test(url.pathname)) {
        return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync(path.join(root, url.pathname.replace('/CCFOLIA_bookmarklet/', '')), 'utf8') });
      }
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><main>Extension test room</main></body></html>' });
      return route.fulfill({ status: 404, body: '' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(new URL(worker.url()).hostname, derivedId, 'Chrome uses the pinned extension id');
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Browser page error:', error.message));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.waitForFunction(() => !!window.__CAPYBARA_TOOLKIT__);
    assert.equal(requests, 1, 'automatic MAIN-world injection');
    assert.equal(await page.evaluate(bootstrap), true);
    assert.equal(requests, 1, 'already running toolkit is not reloaded');
    const injection = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://ccfolia.com/*' });
      const target = { tabId: tabs[0].id };
      const result = await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['bootstrap.js'] });
      await chrome.scripting.executeScript({ target, world: 'MAIN', func: () => window.__CAPYBARA_TOOLKIT__.openPanel() });
      return result[0].result;
    });
    assert.equal(injection, true);
    assert.equal(await page.locator('body').getAttribute('data-opened'), '1');
    // Icon modal (isolated world): injecting once opens it, again closes it; the real chrome.storage backs the form.
    const toggleModal = () => worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://ccfolia.com/*' });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['share-modal.js'] });
    });
    await toggleModal();
    await page.waitForFunction(() => !!document.getElementById('capybara-share-modal-host'));
    assert.equal(await page.locator('#capybara-share-modal-host #title').textContent(), '웹 공유');
    await page.locator('#capybara-share-modal-host #url').fill('https://relay.example.test');
    await page.locator('#capybara-share-modal-host #token').fill('tok');
    await page.locator('#capybara-share-modal-host #enabled').evaluate(input => { input.checked = true; });
    await page.locator('#capybara-share-modal-host #save').click();
    await page.waitForFunction(() => document.getElementById('capybara-share-modal-host').shadowRoot.getElementById('toast').textContent.includes('저장'));
    const saved = await worker.evaluate(() => chrome.storage.local.get(['relayEnabled', 'relayUrl', 'relayGmToken']));
    assert.deepEqual(saved, { relayEnabled: true, relayUrl: 'https://relay.example.test', relayGmToken: 'tok' });
    await toggleModal();
    await page.waitForFunction(() => !document.getElementById('capybara-share-modal-host'));
    await worker.evaluate(() => chrome.storage.local.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.__CAPYBARA_TOOLKIT__);
    assert.equal(requests, 2, 'reload auto-start');
    failNext = true;
    const failed = page.waitForEvent('console', message => message.type() === 'error' && message.text().includes('Capybara personal extension'));
    await page.goto('https://ccfolia.com/rooms/failure');
    await failed;
    assert.equal(await page.evaluate(() => !!window.__CAPYBARA_PERSONAL_EXTENSION_START__), false);
    const retryCount = requests;
    assert.deepEqual(await Promise.all([page.evaluate(bootstrap), page.evaluate(bootstrap)]), [true, true]);
    assert.equal(requests, retryCount + 1, 'concurrent retry uses one loader');
    const beforeForeign = requests;
    await page.goto('https://example.org/');
    assert.equal(await page.evaluate(bootstrap), false);
    assert.equal(requests, beforeForeign, 'other origins untouched');
    realLoader = true;
    await page.goto('https://ccfolia.com/home');
    await page.waitForFunction(() => !!window.__CAPYBARA_TOOLKIT__);
    assert.equal(await page.locator('#capybara-toolkit-root').count(), 1);
    await page.evaluate(() => { localStorage.setItem('extension-preservation-test', 'keep'); window.originalToolkit = window.__CAPYBARA_TOOLKIT__; });
    await page.evaluate(fs.readFileSync(path.join(root, 'bookmarklet.js'), 'utf8').replace(/^javascript:/, ''));
    await page.waitForFunction(() => !document.getElementById('capybara-toolkit-bookmarklet-status'));
    assert.equal(await page.evaluate(() => window.originalToolkit === window.__CAPYBARA_TOOLKIT__), true);
    assert.equal(await page.locator('#capybara-toolkit-root').count(), 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('extension-preservation-test')), 'keep');
    await page.evaluate(() => history.pushState({}, '', '/rooms/test-route'));
    await page.waitForFunction(() => !!window.__CCF_CHARACTER_SHEET_DEBUG__).catch(async error => {
      console.error(await page.evaluate(() => ({ scripts: Array.from(document.scripts).map(s => s.src), body: document.getElementById('capybara-toolkit-root')?.shadowRoot?.textContent?.slice(-4000) })));
      throw error;
    });
    console.log('Personal extension: manifest, real extension injection, action, retries, origin scope, bookmarklet coexistence and SPA route passed');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
