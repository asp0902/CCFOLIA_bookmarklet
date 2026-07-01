const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "capybara-toolkit-loader.js"), "utf8");

function loadRuntimeFactory() {
  const hook = {};
  const sandbox = {
    window: { __CAPYBARA_TOOLKIT_TEST_HOOK__: hook },
    console,
    URL,
    Date,
    Math,
    Set,
    Map,
    Promise,
    Object,
    Array,
    String,
    Number,
    Error,
    RegExp
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "capybara-toolkit-loader.js" });
  assert.strictEqual(typeof hook.createFeatureRuntime, "function");
  return hook;
}

function makeEnv(overrides = {}) {
  const stores = new Map();
  const scripts = new Set();
  const styles = new Set();
  const calls = [];
  const env = {
    isCcfoliaHost: () => true,
    isRoomPage: () => true,
    urlFor: (p) => `https://cdn.example/${p}`,
    storeGet: async (store, key) => stores.get(`${store}:${key}`) || null,
    storePut: async (store, value) => { stores.set(`${store}:${value.key}`, value); },
    renderPanel: async () => { calls.push(["renderPanel"]); },
    reportError: (error) => { calls.push(["reportError", error && error.message ? error.message : String(error)]); },
    primeChatNotifierSound: async () => true,
    nowIso: () => "2026-06-16T00:00:00.000Z",
    nowMs: () => 12345,
    fetchText: async (url) => `source:${url}`,
    callLegacyDisable: () => false,
    setLegacyScriptEnabled: (scriptId, enabled) => { calls.push(["setLegacyScriptEnabled", scriptId, enabled]); },
    dispatchLegacyRequest: (targetId) => { calls.push(["dispatchLegacyRequest", targetId]); },
    hasStyleMarker: (path) => styles.has(path),
    addStyle: (path, url) => { styles.add(path); calls.push(["addStyle", path, url]); },
    removeStyle: (path) => { styles.delete(path); calls.push(["removeStyle", path]); },
    hasScriptMarker: (marker) => scripts.has(marker),
    addScript: async (url, marker) => { scripts.add(marker); calls.push(["addScript", url, marker]); },
    removeScript: (marker) => { scripts.delete(marker); calls.push(["removeScript", marker]); },
    runSource: (code, sourceUrl) => { calls.push(["runSource", code, sourceUrl]); },
    stores,
    scripts,
    styles,
    calls
  };
  return Object.assign(env, overrides);
}

async function testLoadCachesAndInjects() {
  const { createFeatureRuntime, constants } = loadRuntimeFactory();
  const catalog = [{ id: "alpha", title: "Alpha", summary: "A", scripts: ["alpha.js"], styles: ["alpha.css"] }];
  const env = makeEnv();
  const runtime = createFeatureRuntime({ catalog, getOrderedFeatures: () => catalog, env });

  await runtime.load("alpha");

  assert.strictEqual(env.styles.has("alpha.css"), true);
  assert.strictEqual(env.scripts.has("alpha:alpha.js"), true);
  assert.strictEqual(env.stores.get(`${constants.STORE_FEATURES}:feature:alpha`).enabled, true);
  assert.strictEqual(env.stores.get(`${constants.STORE_BUNDLES}:bundle:script:alpha.js`).source.includes("alpha.js"), true);
  assert.deepStrictEqual(env.calls.filter(([name]) => name === "dispatchLegacyRequest"), [["dispatchLegacyRequest", "alpha"]]);
}

async function testFallbackRunsCachedSource() {
  const { createFeatureRuntime, constants } = loadRuntimeFactory();
  const catalog = [{ id: "alpha", title: "Alpha", summary: "A", scripts: ["alpha.js"] }];
  const env = makeEnv({
    fetchText: async () => { throw new Error("offline"); },
    addScript: async () => { throw new Error("blocked"); }
  });
  env.stores.set(`${constants.STORE_BUNDLES}:bundle:script:alpha.js`, {
    key: "bundle:script:alpha.js",
    source: "cached-source"
  });
  const runtime = createFeatureRuntime({ catalog, getOrderedFeatures: () => catalog, env });

  await runtime.load("alpha");

  assert.deepStrictEqual(env.calls.filter(([name]) => name === "runSource"), [["runSource", "cached-source", "https://cdn.example/alpha.js"]]);
}

async function testDisableUsesTeardownAndRemovesMarkers() {
  const { createFeatureRuntime } = loadRuntimeFactory();
  const catalog = [{ id: "ccf-chat-notifier", debugKey: "__CCF_CHAT_NOTIFIER_DEBUG__", title: "Chat", summary: "C", scripts: ["chat.js"], styles: ["chat.css"] }];
  const env = makeEnv({ callLegacyDisable: () => true });
  env.scripts.add("ccf-chat-notifier:chat.js");
  env.styles.add("chat.css");
  const runtime = createFeatureRuntime({ catalog, getOrderedFeatures: () => catalog, env });

  await runtime.disable("ccf-chat-notifier");

  assert.strictEqual(env.scripts.has("ccf-chat-notifier:chat.js"), false);
  assert.strictEqual(env.styles.has("chat.css"), false);
  assert.deepStrictEqual(env.calls.filter(([name]) => name === "setLegacyScriptEnabled"), [["setLegacyScriptEnabled", "ccf-chat-notifier", false]]);
}

async function testListPanelItemsPageRules() {
  const { createFeatureRuntime } = loadRuntimeFactory();
  const catalog = [{ id: "room", title: "Room", summary: "R", roomOnly: true }];
  const env = makeEnv({ isRoomPage: () => false });
  const runtime = createFeatureRuntime({ catalog, getOrderedFeatures: () => catalog, env });

  const items = await runtime.listPanelItems();

  assert.strictEqual(items[0].disabled, true);
  assert.strictEqual(items[0].notice, "이 기능은 코코포리아 룸 안에서 켜는 편이 안전합니다.");
}

(async () => {
  await testLoadCachesAndInjects();
  await testFallbackRunsCachedSource();
  await testDisableUsesTeardownAndRemovesMarkers();
  await testListPanelItemsPageRules();
  console.log("feature runtime tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
