// BGM crossfade. GM page (chat-notifier): switching YouTube tracks lowers the old one step by step and raises the new one once it really plays,
// also when the switch comes from another screen (a receiver used to stop the old track first, so the switch was a hard cut).
// Playroom: the same for YouTube (1.5 s, like the GM page) and, for CCFOLIA's own files, the room's crossfade setting (enableCrossfade / crossfadeDuration, measured on 1.37.6).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-notifier.user.js'), 'utf8').replace(/\r\n/g, '\n');

// 1) chat-notifier crossfadeCcfYoutubeBgm, with fake players and timers
{
  const a = source.indexOf('  function crossfadeCcfYoutubeBgm('), b = source.indexOf('  function enforceCcfYoutubeIdleSilence(', a);
  assert(a >= 0 && b > a);
  let timers = [], now = 0, nextId = 1;
  const window = { setInterval: (fn, ms) => { const t = { id: nextId++, fn, ms, at: now + ms }; timers.push(t); return t.id; }, clearInterval: (id) => { timers = timers.filter((t) => t.id !== id); } };
  const advance = (ms) => { const end = now + ms; while (true) { const due = timers.filter((t) => t.at <= end).sort((x, y) => x.at - y.at)[0]; if (!due) break; now = due.at; due.at += due.ms; due.fn(); } now = end; };
  const player = (st) => { const p = { st, vol: 100, log: [], getPlayerState: () => p.st, setVolume(v) { p.vol = v; p.log.push(v); }, loadVideoById(id) { p.id = id; }, playVideo() {}, mute() {}, unMute() {}, pauseVideo() {}, stopVideo() { p.stopped = true; } }; return p; };
  const oldP = player(1), newP = player(-1);
  const ctx = vm.createContext({ window, Math, Number, debugLog() {}, serializeError: String, CCF_BGM_XFADE_MS: 1500, CCF_BGM_XFADE_STEP_MS: 50, oldP, newP });
  vm.runInContext(`let ccfBgmCrossfadeEnabled = true, ccfBgmPlayer = oldP, ccfBgmPlayerReady = true, ccfBgmPlayerVideoId = "old", ccfBgmXfadeTimer = 0;
    function ensureCcfBgmSecondPlayer() {} function getCcfBgmStandbyPlayer() { return newP; } function cancelCcfBgmCrossfade() {} function markCcfBgmActiveFrame() {}
    ${source.slice(a, b)}
    this.api = { run: (id) => crossfadeCcfYoutubeBgm(id, { volume: 100 }), active: () => ccfBgmPlayer };`, ctx);
  assert.equal(ctx.api.run('new'), true, 'crossfade starts');
  advance(300); assert.equal(oldP.vol, 100, 'old one untouched until the new one plays');
  newP.st = 1; advance(750);
  assert.ok(oldP.vol > 0 && oldP.vol < 100 && newP.vol > 0 && newP.vol < 100, `mid fade ${oldP.vol}/${newP.vol}`);
  advance(1000);
  assert.equal(newP.vol, 100); assert.equal(oldP.vol, 0); assert.equal(oldP.stopped, true); assert.equal(ctx.api.active(), newP);
  assert.ok(oldP.log.every((v, i, l) => i === 0 || v <= l[i - 1]), 'old only goes down');
  assert.ok(newP.log.slice(1).every((v, i, l) => i === 0 || v >= l[i - 1]), 'new only goes up');
}
// 2) a switch from another screen keeps the old track playing so the crossfade can run (stopping first made getPlayerState() !== 1 -> hard cut)
assert.doesNotMatch(source, /stopCcfYoutubeBgm\("remote-switch"\)/, 'remote switch must not stop the old track first');

// 3) playroom
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = path.join(root, 'prototype', 'public-handout-relay', 'public');
const sc0 = { fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], sound: null, effects: [], crossfade: 0 };
const scene = (media, crossfade = 0) => ({ fieldWidth: 40, fieldHeight: 20, fieldObjectFit: 'fill', items: [], characters: [], media, sound: null, effects: [], crossfade });
const file = (name) => ({ url: `https://storage.ccfolia-cdn.net/${name}.mp3`, name, volume: 1, repeat: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__audios = []; window.Audio = class { constructor() { window.__audios.push(this); this.paused = true; this.ended = false; this.duration = NaN; this.currentTime = 0; this.volume = 1; } play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } removeAttribute() {} };
      window.__yts = []; window.YT = { Player: class { constructor(host, opts) { this.opts = opts; this.vol = 100; this.st = -1; this.destroyed = false; window.__yts.push(this); setTimeout(() => opts.events?.onReady?.({ target: this }), 0); } setVolume(v) { this.vol = v; } getPlayerState() { return this.st; } playVideo() {} mute() {} unMute() {} destroy() { this.destroyed = true; } getCurrentTime() { return 0; } getDuration() { return 0; } } };
      window.WebSocket = class { constructor() { setTimeout(() => this.onclose?.({}), 0); } close() {} send() {} addEventListener() {} }; if (!crypto.randomUUID) crypto.randomUUID = () => 'x';
    });
    await page.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname !== 'relay.test') return route.abort(); const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1), fp = path.join(dir, f); if (fs.existsSync(fp)) return route.fulfill({ body: fs.readFileSync(fp), contentType: f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); return route.fulfill({ contentType: 'application/json', body: '{}' }); });
    await page.goto('http://relay.test/#room=x');
    const yt = () => page.evaluate(() => window.__yts.map((p) => ({ vol: p.vol, destroyed: p.destroyed })));
    // YouTube: first track, then a switch
    await page.evaluate(() => { playBgm({ state: 'playing', videoId: 'aaaaaaaaaaa', startedAt: 1, title: 'A' }); window.onYouTubeIframeAPIReady(); });
    await page.waitForTimeout(50);
    await page.evaluate(() => { window.__yts[0].st = 1; playBgm({ state: 'playing', videoId: 'bbbbbbbbbbb', startedAt: 2, title: 'B' }); });
    await page.waitForTimeout(50);
    let s = await yt();
    assert.equal(s.length, 2); assert.equal(s[0].destroyed, false, 'old player kept during the switch'); assert.equal(s[0].vol, 100); assert.equal(s[1].vol, 0, 'new one starts silent');
    await page.evaluate(() => { const p = window.__yts[1]; p.st = 1; p.opts.events.onStateChange({ target: p, data: 1 }); });
    await page.waitForTimeout(750);
    s = await yt(); assert.ok(s[0].vol > 0 && s[0].vol < 100 && s[1].vol > 0 && s[1].vol < 100, `YouTube mid fade ${JSON.stringify(s)}`);
    await page.waitForTimeout(1000);
    s = await yt(); assert.equal(s[0].destroyed, true, 'old player gone after the fade'); assert.equal(s[1].vol, 100);
    // a stop from the GM fades out too
    await page.evaluate(() => playBgm({ state: 'stopped' }));
    await page.waitForTimeout(700);
    s = await yt(); assert.ok(!s[1].destroyed && s[1].vol < 100 && s[1].vol > 0, `stop fades ${JSON.stringify(s[1])}`);
    await page.waitForTimeout(1100);
    assert.equal((await yt())[1].destroyed, true);
    // files: the room's crossfade setting
    await page.evaluate((sc) => syncRoomAudio(sc), scene(file('a'), 1));
    await page.evaluate((sc) => { window.__first = roomAudio.media.el; syncRoomAudio(sc); }, scene(file('b'), 1));
    await page.waitForTimeout(500);
    let f = await page.evaluate(() => ({ same: window.__first === roomAudio.media.el, oldPaused: window.__first.paused, oldVol: window.__first.volume, newVol: roomAudio.media.el.volume, newSrc: roomAudio.media.el.src }));
    assert.equal(f.same, false, 'a second element for the new file'); assert.equal(f.oldPaused, false); assert.ok(f.oldVol > 0 && f.oldVol < 1 && f.newVol > 0 && f.newVol < 1, JSON.stringify(f)); assert.match(f.newSrc, /b\.mp3$/);
    await page.waitForTimeout(700);
    f = await page.evaluate(() => ({ oldPaused: window.__first.paused, newVol: roomAudio.media.el.volume }));
    assert.equal(f.oldPaused, true); assert.equal(f.newVol, 1);
    // stop with crossfade: fades, then pauses
    await page.evaluate((sc) => { window.__last = roomAudio.media.el; syncRoomAudio(sc); }, scene(null, 1));
    await page.waitForTimeout(400);
    f = await page.evaluate(() => ({ paused: window.__last.paused, vol: window.__last.volume }));
    assert.ok(!f.paused && f.vol < 1, `file stop fades ${JSON.stringify(f)}`);
    await page.waitForTimeout(800);
    assert.equal(await page.evaluate(() => window.__last.paused), true);
    // crossfade off in the room: an immediate switch on the same element
    await page.evaluate((sc) => syncRoomAudio(sc), scene(file('c'), 0));
    await page.evaluate((sc) => { window.__first = roomAudio.media.el; syncRoomAudio(sc); }, scene(file('d'), 0));
    assert.equal(await page.evaluate(() => window.__first === roomAudio.media.el && /d\.mp3$/.test(roomAudio.media.el.src) && roomAudio.media.el.volume === 1), true, 'no crossfade: same element, switched at once');
    // YouTube -> file (crossfade off in the room too): the YouTube fades out (stop), the new file rises from 0 instead of starting at full volume
    await page.evaluate((sc) => syncRoomAudio(sc), { ...sc0, media: null });
    await page.evaluate(() => { playBgm({ state: 'playing', videoId: 'ccccccccccc', startedAt: 9, title: 'C' }); });
    await page.waitForTimeout(50);
    await page.evaluate(() => { const p = window.__yts[window.__yts.length - 1]; p.st = 1; playBgm({ state: 'stopped' }); });
    await page.evaluate((sc) => syncRoomAudio(sc), { ...sc0, media: { url: 'https://storage.ccfolia-cdn.net/e.mp3', name: 'e', volume: 1, repeat: true } });
    await page.waitForTimeout(600);
    const rising = await page.evaluate(() => roomAudio.media.el.volume);
    assert.ok(rising > 0 && rising < 1, `file rises after YouTube ${rising}`);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => roomAudio.media.el.volume), 1);
    // the GM page sends the room's setting; the Worker keeps it
    assert.match(fs.readFileSync(path.join(root, 'legacy/ccfolia-chat-panel.user.js'), 'utf8'), /crossfade: room\.enableCrossfade === true \? Math\.max\(0\.1, Math\.min\(10, num\(room\.crossfadeDuration, 1\)\)\) : 0/);
    assert.match(fs.readFileSync(path.join(root, 'prototype/public-handout-relay/cloudflare/worker.mjs'), 'utf8'), /crossfade: Math\.max\(0, Math\.min\(10, num\(body\.crossfade\)\)\)/);
    assert.deepEqual(errors, []);
    console.log('bgm crossfade PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
