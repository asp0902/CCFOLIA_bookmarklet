// docs/img/penguin-ref.png (사용자 제공) 의 윤곽을 따라 24x24 단색 SVG 패스를 만든다: 몸 전체 실루엣 + 배·눈 흰자는 evenodd 구멍 + 눈동자 섬.
// 사용: node tools/gen-penguin-svg.cjs  → 패스 문자열을 stdout 으로. (toolkit-presence 의 PENGUIN_SVG 에 넣는다)
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const png = fs.readFileSync(path.join(__dirname, '../docs/img/penguin-ref.png'));
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage();
    const options = JSON.parse(process.env.PENGUIN_OPTS || '{}');
    const d = await page.evaluate(async ({ dataUrl, options }) => {
      const img = new Image(); img.src = dataUrl; await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;
      const black = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) black[i] = px[i * 4] < 110 ? 1 : 0;
      // square morphology (separable): dilate / erode by r
      const morph = (src, r, dilate) => {
        const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x < W; x++) { /* horizontal */ let hit = dilate ? 0 : 1; for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) { const v = src[y * W + k]; if (dilate ? v : !v) { hit = dilate ? 1 : 0; break; } } tmp[y * W + x] = hit; } }
        for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let hit = dilate ? 0 : 1; for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) { const v = tmp[k * W + x]; if (dilate ? v : !v) { hit = dilate ? 1 : 0; break; } } out[y * W + x] = hit; }
        return out;
      };
      const closeR = options.close ?? 12;
      const closed = morph(morph(black, closeR, true), closeR, false);
      // outside = white reachable from the border of the closed mask
      const outside = new Uint8Array(W * H); const stack = [];
      const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = y * W + x; if (outside[i] || closed[i]) return; outside[i] = 1; stack.push(i); };
      for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); } for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
      while (stack.length) { const i = stack.pop(), x = i % W, y = (i / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
      const sil = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) sil[i] = outside[i] ? 0 : 1;
      // holes = white pixels inside the silhouette; label components
      const hole0 = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) hole0[i] = sil[i] && !black[i] ? 1 : 0;
      const label = new Int32Array(W * H); const comps = [];
      for (let s = 0; s < W * H; s++) { if (!hole0[s] || label[s]) continue; const id = comps.length + 1; const st = [s]; label[s] = id; let area = 0, sx = 0, sy = 0, minx = W, maxx = 0, miny = H, maxy = 0; while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; area++; sx += x; sy += y; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; for (const j of [i + 1, i - 1, i + W, i - W]) if (j >= 0 && j < W * H && hole0[j] && !label[j]) { label[j] = id; st.push(j); } } comps.push({ id, area, cx: sx / area, cy: sy / area, minx, maxx, miny, maxy }); }
      comps.sort((a, b) => b.area - a.area);
      const belly = comps[0];
      // eye = the component near the head that is small and sits in the upper right of the silhouette
      let sMinY = H, sMaxY = 0, sMinX = W, sMaxX = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sil[y * W + x]) { if (y < sMinY) sMinY = y; if (y > sMaxY) sMaxY = y; if (x < sMinX) sMinX = x; if (x > sMaxX) sMaxX = x; }
      const eye = comps.slice(1).filter((c) => c.cy < sMinY + (sMaxY - sMinY) * 0.2 && c.area > 200).sort((a, b) => b.area - a.area)[0];
      const bellyMask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) bellyMask[i] = label[i] === belly.id ? 1 : 0;
      const bellyHole = morph(bellyMask, options.bellyShrink ?? 13, false);
      const eyeMask = new Uint8Array(W * H); if (eye) for (let i = 0; i < W * H; i++) eyeMask[i] = label[i] === eye.id ? 1 : 0;
      const eyeHole = eye ? morph(eyeMask, options.eyeShrink ?? 0, false) : eyeMask;
      // pupil: a black blob inside the eye's bounding box
      let pupil = null;
      if (eye) { let sx = 0, sy = 0, n = 0; for (let y = eye.miny; y <= eye.maxy; y++) for (let x = eye.minx + (eye.maxx - eye.minx) * 0.25; x <= eye.maxx - (eye.maxx - eye.minx) * 0.25; x++) { if (black[y * W + (x | 0)]) { sx += x; sy += y; n++; } } if (n) pupil = { cx: sx / n, cy: sy / n, r: Math.max(options.pupilMin ?? 11, Math.sqrt(n / Math.PI)) }; }
      // marching squares → ordered polygon(s)
      const contours = (mask) => {
        const segs = new Map(); const key = (x, y) => x + ',' + y; const add = (a, b) => { if (!segs.has(key(...a))) segs.set(key(...a), []); segs.get(key(...a)).push(b); };
        const m = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
        for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
          const c = (m(x, y) ? 1 : 0) | (m(x + 1, y) ? 2 : 0) | (m(x + 1, y + 1) ? 4 : 0) | (m(x, y + 1) ? 8 : 0);
          const T = [x + 0.5, y], R = [x + 1, y + 0.5], B = [x + 0.5, y + 1], L = [x, y + 0.5];
          switch (c) { case 1: add(T, L); break; case 2: add(R, T); break; case 3: add(R, L); break; case 4: add(B, R); break; case 5: add(B, L); add(T, R); break; case 6: add(B, T); break; case 7: add(B, L); break; case 8: add(L, B); break; case 9: add(T, B); break; case 10: add(L, T); add(R, B); break; case 11: add(R, B); break; case 12: add(L, R); break; case 13: add(T, R); break; case 14: add(L, T); break; }
        }
        const polys = [];
        for (const [k] of segs) { while (segs.get(k)?.length) { const poly = []; let cur = k.split(',').map(Number); const startKey = k; let guard = 0; for (;;) { poly.push(cur); const list = segs.get(key(...cur)); if (!list || !list.length) break; const next = list.pop(); cur = next; if (key(...cur) === startKey) break; if (++guard > 400000) break; } if (poly.length > 8) polys.push(poly); } }
        return polys;
      };
      const rdp = (pts, eps) => { if (pts.length < 3) return pts; const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); let max = 0, idx = -1; const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1; for (let i = a + 1; i < b; i++) { const dist = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (dist > max) { max = dist; idx = i; } } if (max > eps && idx > 0) { keep[idx] = 1; st.push([a, idx], [idx, b]); } } return pts.filter((_, i) => keep[i]); };
      const biggest = (polys) => polys.sort((a, b) => b.length - a.length);
      const silPoly = biggest(contours(sil))[0];
      const bellyPolys = biggest(contours(bellyHole)).slice(0, 1);
      const eyePolys = eye ? biggest(contours(eyeHole)).slice(0, 1) : [];
      const eps = options.eps ?? 3.2;
      const scale = (options.height ?? 22) / (sMaxY - sMinY); const ox = 12 - ((sMinX + sMaxX) / 2) * scale, oy = 1 + (options.top ?? 1) - sMinY * scale;
      const f = (v) => String(Math.round(v * 100) / 100);
      const toPath = (poly) => { const p = rdp(poly, eps).map(([x, y]) => [x * scale + ox, y * scale + oy]); return 'M' + p.map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z'; };
      const circle = (c) => { const r = c.r * scale, x = c.cx * scale + ox, y = c.cy * scale + oy; return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`; };
      // 눈: 흰자(구멍)는 동공을 같은 중심에서 확대한 원(반지름 eyeScale 배, 기본 1.9), 동공은 그대로
      const eyeRing = pupil ? circle({ cx: pupil.cx, cy: pupil.cy, r: pupil.r * (options.eyeScale ?? 1.9) }) : '';
      return { d: [silPoly, ...bellyPolys].filter(Boolean).map(toPath).join('') + eyeRing + (pupil ? circle(pupil) : ''), sil: [sMinX, sMinY, sMaxX, sMaxY], belly: belly.area, eye: eye ? eye.area : 0, pupil };
    }, { dataUrl: 'data:image/png;base64,' + png.toString('base64'), options });
    if (process.env.PENGUIN_DEBUG) console.error(JSON.stringify({ sil: d.sil, belly: d.belly, eye: d.eye, pupil: d.pupil, bytes: d.d.length }));
    process.stdout.write(d.d);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
