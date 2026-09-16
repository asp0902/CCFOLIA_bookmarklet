const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension/personal');
const bootstrap = fs.readFileSync(path.join(extension, 'bootstrap.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.host_permissions, ['https://ccfolia.com/*']);
assert.deepEqual(manifest.permissions, ['scripting']);
assert.equal(manifest.content_scripts[0].world, 'MAIN');
assert.equal(manifest.content_scripts[0].all_frames, false);

async function checkAction() {
  let listener;
  const calls = [];
  const record = name => async value => { calls.push([name, value]); };
  const sandbox = {
    URL, console: { error() {} },
    chrome: {
      action: { onClicked: { addListener: fn => { listener = fn; } }, setBadgeText: record('badge'), setBadgeBackgroundColor: record('color'), setTitle: record('title') },
      scripting: { executeScript: async args => { calls.push(['inject', args]); return [{ result: true }]; } }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), sandbox);
  await listener({ id: 1, url: 'https://example.org/' });
  assert.equal(calls.filter(([name]) => name === 'inject').length, 0);
  assert(calls.some(([name, value]) => name === 'badge' && value.text === '!'));
  calls.length = 0;
  await listener({ id: 2, url: 'https://ccfolia.com/rooms/test' });
  assert.equal(calls.filter(([name]) => name === 'inject').length, 2);
  assert(calls.some(([name, value]) => name === 'badge' && value.text === ''));
  sandbox.chrome.scripting.executeScript = async () => [{ result: false }];
  calls.length = 0;
  await listener({ id: 2, url: 'https://ccfolia.com/rooms/test' });
  assert(calls.some(([name, value]) => name === 'badge' && value.text === '!'));
}

(async () => {
  await checkAction();
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
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
