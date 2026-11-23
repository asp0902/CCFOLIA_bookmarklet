// gif-compress 0.1.1: an animated WEBP over 5MB becomes a moving GIF under 5MB before CCFOLIA's handler sees it; a still or small WEBP goes through untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-gif-compress.user.js'), 'utf8');
const LIMIT = 5 * 1024 * 1024;
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body><div id="root"><input id="file" type="file" accept="image/*"></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(() => {
      window.__got = [];
      document.getElementById('root').addEventListener('change', (e) => window.__got.push([...e.target.files].map((f) => ({ name: f.name, size: f.size, type: f.type }))));
      window.__pick = (file) => { const input = document.getElementById('file'), t = new DataTransfer(); t.items.add(file); input.files = t.files; input.dispatchEvent(new Event('change', { bubbles: true })); };
      // a still WEBP of noise from the canvas
      window.__still = async (w, h, quality) => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { alpha: false }), d = x.createImageData(w, h); const n = new Uint32Array(d.data.buffer); const part = new Uint32Array(16384); for (let i = 0; i < n.length; i += 16384) { crypto.getRandomValues(part); n.set(part.subarray(0, Math.min(16384, n.length - i)), i); } for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255; x.putImageData(d, 0, 0); return new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality })).arrayBuffer()); };
      // an animated WEBP: the still frames' image chunks wrapped in ANMF chunks (RIFF container)
      window.__animated = async (w, h, frames, ms) => {
        const u24 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255], tag = (s) => [...s].map((c) => c.charCodeAt(0));
        const parts = [new Uint8Array([...tag('VP8X'), ...u32(10), 2, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]), new Uint8Array([...tag('ANIM'), ...u32(6), 0, 0, 0, 0, 0, 0])];
        for (let f = 0; f < frames; f += 1) {
          const still = await window.__still(w, h, 0.95), view = new DataView(still.buffer), kept = []; for (let at = 12; at + 8 <= still.length;) { const name = String.fromCharCode(...still.subarray(at, at + 4)), size = view.getUint32(at + 4, true), end = at + 8 + size + (size & 1); if (['ALPH', 'VP8 ', 'VP8L'].includes(name)) kept.push(still.subarray(at, Math.min(end, still.length))); at = end; } const image = new Uint8Array(await new Blob(kept).arrayBuffer()), even = image.length + (image.length & 1);
          parts.push(new Uint8Array([...tag('ANMF'), ...u32(16 + even), 0, 0, 0, 0, 0, 0, ...u24(w - 1), ...u24(h - 1), ...u24(ms), 2]), image); if (image.length & 1) parts.push(new Uint8Array(1));
        }
        const size = 4 + parts.reduce((a, p) => a + p.length, 0);
        return new Blob([new Uint8Array([...tag('RIFF'), ...u32(size), ...tag('WEBP')]), ...parts], { type: 'image/webp' });
      };
    });
    await page.addScriptTag({ content: source });
    await page.waitForFunction(() => !!window.__CCF_GIF_COMPRESS__);
    const got = async (n) => { await page.waitForFunction((count) => window.__got.length >= count, n, { timeout: 200000 }); return page.evaluate(() => window.__got.at(-1)[0]); };
    const big = await page.evaluate(async () => { const blob = await window.__animated(1000, 700, 8, 120); window.__big = new File([blob], '움짤.webp', { type: 'image/webp' }); const d = new ImageDecoder({ data: await blob.arrayBuffer(), type: 'image/webp' }); await d.tracks.ready; await d.completed; const out = [blob.size, d.tracks.selectedTrack.frameCount]; d.close(); return out; });
    assert(big[0] > LIMIT, `sample over 5MB: ${big[0]}`); assert.equal(big[1], 8, 'the sample is animated');
    await page.evaluate(() => window.__pick(window.__big));
    await page.waitForFunction(() => /WEBP→GIF 변환/.test(document.documentElement.innerText), null, { timeout: 20000 });
    const out = await got(1);
    assert.equal(out.name, '움짤.gif'); assert.equal(out.type, 'image/gif'); assert(out.size < LIMIT, `under 5MB: ${out.size}`);
    await page.waitForFunction(() => /WEBP→GIF 변환 완료: .*MB → .*MB \(GIF/.test(document.documentElement.innerText));
    const made = await page.evaluate(async () => { const f = document.getElementById('file').files[0], d = new ImageDecoder({ data: await f.arrayBuffer(), type: 'image/gif' }); await d.tracks.ready; await d.completed; const t = d.tracks.selectedTrack; let total = 0; for (let i = 0; i < t.frameCount; i += 1) { const { image } = await d.decode({ frameIndex: i }); total += image.duration / 1000; image.close(); } const r = [t.frameCount, total]; d.close(); return r; });
    assert(made[0] >= 2, 'still moves'); assert(Math.abs(made[1] - 960) <= 150, `play time kept: ${made[1]}`);
    // a still WEBP over 5MB and a small animated one go through unchanged
    const still = await page.evaluate(async () => { const bytes = await window.__still(3000, 3000, 1); window.__pick(new File([bytes], 'still.webp', { type: 'image/webp' })); return bytes.length; });
    assert(still > LIMIT, `still sample over 5MB: ${still}`);
    const s = await got(2); assert.deepEqual([s.name, s.size, s.type], ['still.webp', still, 'image/webp']);
    const small = await page.evaluate(async () => { const blob = await window.__animated(64, 64, 3, 100); window.__pick(new File([blob], 'small.webp', { type: 'image/webp' })); return blob.size; });
    const m = await got(3); assert.deepEqual([m.name, m.size], ['small.webp', small]);
    assert.deepEqual(errors, []);
    console.log('webp compress PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
