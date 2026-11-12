const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 5MB 넘는 움직이는 GIF는 업로드 직전에 브라우저 안에서 움직임을 유지한 채 5MB 아래로 다시 인코딩된다(input change · 드롭 모두).
// 작은 GIF·정지 GIF·PNG·끄기(ccfGifCompress=off)는 그대로 통과한다. 실제 gif-compress 스크립트 + 복제 "업로드 처리기"(루트의 change/drop 리스너)로 확인한다.
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-gif-compress.user.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body><div id="root"><div id="zone" style="width:300px;height:100px;background:#444">drop</div><input id="file" type="file" accept="image/*" multiple></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__got = [];
      // the replica "upload handler" (what CCFOLIA's React root does): it records the files it receives
      const root = document.getElementById('root');
      root.addEventListener('change', (e) => { if (e.target.type === 'file') window.__got.push([...e.target.files].map((f) => ({ name: f.name, size: f.size, type: f.type }))); });
      root.addEventListener('drop', (e) => { e.preventDefault(); window.__got.push([...e.dataTransfer.files].map((f) => ({ name: f.name, size: f.size, type: f.type, drop: true }))); });
      window.__longtasks = []; new PerformanceObserver((l) => l.getEntries().forEach((x) => window.__longtasks.push(Math.round(x.duration)))).observe({ entryTypes: ['longtask'] });
    });
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => !!window.__CCF_GIF_COMPRESS__);
    // synthetic GIFs made with the bundled encoder: random-index noise frames (nearly incompressible), a transparent corner
    await page.evaluate(() => {
      const G = window.__CCF_GIF_COMPRESS__.gifenc();
      window.__makeGif = (w, h, frames, delay, transparentCorner) => {
        const encoder = G.GIFEncoder();
        const palette = Array.from({ length: 255 }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255]); palette.push([0, 0, 0, 0]);
        for (let f = 0; f < frames; f += 1) {
          const pixels = new Uint8Array(w * h);
          for (let i = 0; i < pixels.length; i += 1) pixels[i] = (Math.random() * 255) | 0;
          if (transparentCorner) for (let y = 0; y < 40; y += 1) for (let x = 0; x < 40; x += 1) pixels[y * w + x] = 255;
          encoder.writeFrame(pixels, w, h, { palette, delay, repeat: 0, transparent: true, transparentIndex: 255, dispose: 2 });
        }
        encoder.finish();
        return encoder.bytes();
      };
      window.__fileOf = (bytes, name, type) => new File([bytes], name, { type });
      window.__pick = (file) => { const input = document.getElementById('file'); const t = new DataTransfer(); t.items.add(file); input.files = t.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
    });
    const got = async (n, timeout = 120000) => { await page.waitForFunction((count) => window.__got.length >= count, n, { timeout }); return page.evaluate(() => window.__got[window.__got.length - 1]); };

    // 1) a big animated GIF through the file input
    const big = await page.evaluate(() => { const bytes = window.__makeGif(320, 320, 70, 60, true); window.__bigFile = window.__fileOf(bytes, 'cutin.gif', 'image/gif'); return bytes.length; });
    assert(big > 5 * 1024 * 1024, `test GIF is over 5MB (${(big / 1048576).toFixed(1)}MB)`);
    await page.evaluate(() => { window.__longtasks.length = 0; window.__pick(window.__bigFile); });
    // the toast shows progress while it works
    await page.waitForFunction(() => /GIF 압축/.test(document.documentElement.innerText), null, { timeout: 20000 });
    const first = await got(1);
    assert.equal(first.length, 1); assert.equal(first[0].name, 'cutin.gif'); assert.equal(first[0].type, 'image/gif');
    assert(first[0].size < 5 * 1024 * 1024, `compressed under 5MB: ${(first[0].size / 1048576).toFixed(2)}MB`);
    assert(first[0].size > 1024 * 1024, 'and not needlessly tiny');
    const info = await page.evaluate(() => window.__CCF_GIF_COMPRESS__.last);
    console.log('gif compress', JSON.stringify(info), 'longtasks', JSON.stringify(await page.evaluate(() => window.__longtasks)));
    assert(info.frames >= 2 && info.to < 5 * 1024 * 1024);
    await page.waitForFunction(() => /GIF 압축 완료/.test(document.documentElement.innerText));
    // the result still moves, keeps its loop and roughly its length, and keeps the transparent corner
    const inspect = await page.evaluate(async () => {
      const file = document.getElementById('file').files[0];
      const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      let total = 0;
      for (let i = 0; i < track.frameCount; i += 1) { const { image } = await decoder.decode({ frameIndex: i }); total += (image.duration || 0) / 1000; image.close(); }
      const { image } = await decoder.decode({ frameIndex: 0 });
      const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const corner = ctx.getImageData(2, 2, 1, 1).data[3], center = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3];
      return { frames: track.frameCount, repetition: String(track.repetitionCount), total, corner, center, width: image.displayWidth, height: image.displayHeight };
    });
    assert(inspect.frames >= 2, 'still animated'); assert.equal(inspect.repetition, 'Infinity', 'loop forever kept');
    assert(Math.abs(inspect.total - 70 * 60) <= 70 * 60 * 0.15, `total play time roughly kept (${inspect.total}ms vs 4200ms)`);
    assert.equal(inspect.corner, 0, 'transparent corner kept'); assert.equal(inspect.center, 255);
    assert((await page.evaluate(() => window.__longtasks)).every((ms) => ms < 400), 'the main thread is not blocked for long (worker)');

    // 2) the same through a drop
    await page.evaluate(() => { const t = new DataTransfer(); t.items.add(window.__bigFile); document.getElementById('zone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: t })); });
    const dropped = await got(2);
    assert.equal(dropped[0].drop, true); assert(dropped[0].size < 5 * 1024 * 1024, 'drop: compressed too');

    // 3) untouched cases: small animated GIF, big still GIF, big PNG, and the off switch
    await page.evaluate(() => window.__pick(window.__fileOf(window.__makeGif(120, 120, 20, 50, false), 'small.gif', 'image/gif')));
    const small = await got(3); assert(small[0].size < 5 * 1024 * 1024 && small[0].name === 'small.gif');
    assert.equal(await page.evaluate(() => window.__CCF_GIF_COMPRESS__.last.from), big, 'small GIF was not processed');
    const still = await page.evaluate(() => { const bytes = window.__makeGif(2600, 2600, 1, 50, false); window.__stillSize = bytes.length; window.__pick(window.__fileOf(bytes, 'still.gif', 'image/gif')); return bytes.length; });
    assert(still > 5 * 1024 * 1024, `still test GIF is over 5MB (${(still / 1048576).toFixed(1)}MB)`);
    const stillGot = await got(4); assert.equal(stillGot[0].size, still, 'a still GIF goes through unchanged (CCFOLIA handles it)');
    await page.evaluate(() => window.__pick(window.__fileOf(new Uint8Array(6 * 1024 * 1024), 'big.png', 'image/png')));
    const png = await got(5); assert.equal(png[0].size, 6 * 1024 * 1024, 'PNG untouched');
    await page.evaluate(() => { localStorage.setItem('ccfGifCompress', 'off'); window.__pick(window.__bigFile); });
    const off = await got(6); assert.equal(off[0].size, big, 'off switch: the original goes through');
    await page.evaluate(() => localStorage.removeItem('ccfGifCompress'));

    // 4) cancel: the original goes on to CCFOLIA's own handling
    await page.evaluate(() => window.__pick(window.__bigFile));
    await page.waitForSelector('[data-role="cancel"]', { state: 'visible', timeout: 20000 });
    await page.locator('[data-role="cancel"]').click();
    const cancelled = await got(7); assert.equal(cancelled[0].size, big, 'cancel: the original file is handed over');
    // 5) a page that blocks Workers (CSP): the same code runs on the main thread with yields between frames
    await page.evaluate(() => { window.__RealWorker = window.Worker; window.Worker = function () { throw new Error('blocked by policy'); }; window.__longtasks.length = 0; window.__pick(window.__bigFile); });
    const noWorker = await got(8); assert(noWorker[0].size < 5 * 1024 * 1024, 'main-thread fallback also compresses');
    console.log('main-thread fallback longtasks', JSON.stringify(await page.evaluate(() => window.__longtasks)));
    assert.deepEqual(errors, [], 'no page errors');
    console.log('gif compress PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
