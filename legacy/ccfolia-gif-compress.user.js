// ==UserScript==
// @name         CCFOLIA GIF Compress by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-gif-compress
// @version      0.1.0
// @description  Re-encodes animated GIFs over 5MB in the browser (keeping the animation) before CCFOLIA's upload handler sees them.
// @description:ko 5MB를 넘는 움직이는 GIF를 업로드하기 전에 브라우저 안에서 움직임을 유지한 채 다시 인코딩해 5MB 아래로 줄입니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/*
 * This file bundles gifenc 1.0.3 (https://github.com/mattdesl/gifenc), a GIF encoder, inside ccfGifencModule() below.
 *
 *   The MIT License (MIT)
 *   Copyright (c) 2017 Matt DesLauriers
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 *   documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 *   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 *   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 *   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 *   ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// ---- gifenc (bundled, MIT) -----------------------------------------------------------------------------------
function ccfGifencModule() {
  const exports = {};
  const module = { exports };
var __defProp = Object.defineProperty;
var __markAsModule = (target) => __defProp(target, "__esModule", {value: true});
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {get: all[name], enumerable: true});
};

// src/index.js
__markAsModule(exports);
__export(exports, {
  GIFEncoder: () => GIFEncoder,
  applyPalette: () => applyPalette,
  default: () => src_default,
  nearestColor: () => nearestColor,
  nearestColorIndex: () => nearestColorIndex,
  nearestColorIndexWithDistance: () => nearestColorIndexWithDistance,
  prequantize: () => prequantize,
  quantize: () => quantize,
  snapColorsToPalette: () => snapColorsToPalette
});

// src/constants.js
var constants_default = {
  signature: "GIF",
  version: "89a",
  trailer: 59,
  extensionIntroducer: 33,
  applicationExtensionLabel: 255,
  graphicControlExtensionLabel: 249,
  imageSeparator: 44,
  signatureSize: 3,
  versionSize: 3,
  globalColorTableFlagMask: 128,
  colorResolutionMask: 112,
  sortFlagMask: 8,
  globalColorTableSizeMask: 7,
  applicationIdentifierSize: 8,
  applicationAuthCodeSize: 3,
  disposalMethodMask: 28,
  userInputFlagMask: 2,
  transparentColorFlagMask: 1,
  localColorTableFlagMask: 128,
  interlaceFlagMask: 64,
  idSortFlagMask: 32,
  localColorTableSizeMask: 7
};

// src/stream.js
function createStream(initialCapacity = 256) {
  let cursor = 0;
  let contents = new Uint8Array(initialCapacity);
  return {
    get buffer() {
      return contents.buffer;
    },
    reset() {
      cursor = 0;
    },
    bytesView() {
      return contents.subarray(0, cursor);
    },
    bytes() {
      return contents.slice(0, cursor);
    },
    writeByte(byte) {
      expand(cursor + 1);
      contents[cursor] = byte;
      cursor++;
    },
    writeBytes(data, offset = 0, byteLength = data.length) {
      expand(cursor + byteLength);
      for (let i = 0; i < byteLength; i++) {
        contents[cursor++] = data[i + offset];
      }
    },
    writeBytesView(data, offset = 0, byteLength = data.byteLength) {
      expand(cursor + byteLength);
      contents.set(data.subarray(offset, offset + byteLength), cursor);
      cursor += byteLength;
    }
  };
  function expand(newCapacity) {
    var prevCapacity = contents.length;
    if (prevCapacity >= newCapacity)
      return;
    var CAPACITY_DOUBLING_MAX = 1024 * 1024;
    newCapacity = Math.max(newCapacity, prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) >>> 0);
    if (prevCapacity != 0)
      newCapacity = Math.max(newCapacity, 256);
    const oldContents = contents;
    contents = new Uint8Array(newCapacity);
    if (cursor > 0)
      contents.set(oldContents.subarray(0, cursor), 0);
  }
}

// src/lzwEncode.js
var BITS = 12;
var DEFAULT_HSIZE = 5003;
var MASKS = [
  0,
  1,
  3,
  7,
  15,
  31,
  63,
  127,
  255,
  511,
  1023,
  2047,
  4095,
  8191,
  16383,
  32767,
  65535
];
function lzwEncode(width, height, pixels, colorDepth, outStream = createStream(512), accum = new Uint8Array(256), htab = new Int32Array(DEFAULT_HSIZE), codetab = new Int32Array(DEFAULT_HSIZE)) {
  const hsize = htab.length;
  const initCodeSize = Math.max(2, colorDepth);
  accum.fill(0);
  codetab.fill(0);
  htab.fill(-1);
  let cur_accum = 0;
  let cur_bits = 0;
  const init_bits = initCodeSize + 1;
  const g_init_bits = init_bits;
  let clear_flg = false;
  let n_bits = g_init_bits;
  let maxcode = (1 << n_bits) - 1;
  const ClearCode = 1 << init_bits - 1;
  const EOFCode = ClearCode + 1;
  let free_ent = ClearCode + 2;
  let a_count = 0;
  let ent = pixels[0];
  let hshift = 0;
  for (let fcode = hsize; fcode < 65536; fcode *= 2) {
    ++hshift;
  }
  hshift = 8 - hshift;
  outStream.writeByte(initCodeSize);
  output(ClearCode);
  const length = pixels.length;
  for (let idx = 1; idx < length; idx++) {
    next_block: {
      const c = pixels[idx];
      const fcode = (c << BITS) + ent;
      let i = c << hshift ^ ent;
      if (htab[i] === fcode) {
        ent = codetab[i];
        break next_block;
      }
      const disp = i === 0 ? 1 : hsize - i;
      while (htab[i] >= 0) {
        i -= disp;
        if (i < 0)
          i += hsize;
        if (htab[i] === fcode) {
          ent = codetab[i];
          break next_block;
        }
      }
      output(ent);
      ent = c;
      if (free_ent < 1 << BITS) {
        codetab[i] = free_ent++;
        htab[i] = fcode;
      } else {
        htab.fill(-1);
        free_ent = ClearCode + 2;
        clear_flg = true;
        output(ClearCode);
      }
    }
  }
  output(ent);
  output(EOFCode);
  outStream.writeByte(0);
  return outStream.bytesView();
  function output(code) {
    cur_accum &= MASKS[cur_bits];
    if (cur_bits > 0)
      cur_accum |= code << cur_bits;
    else
      cur_accum = code;
    cur_bits += n_bits;
    while (cur_bits >= 8) {
      accum[a_count++] = cur_accum & 255;
      if (a_count >= 254) {
        outStream.writeByte(a_count);
        outStream.writeBytesView(accum, 0, a_count);
        a_count = 0;
      }
      cur_accum >>= 8;
      cur_bits -= 8;
    }
    if (free_ent > maxcode || clear_flg) {
      if (clear_flg) {
        n_bits = g_init_bits;
        maxcode = (1 << n_bits) - 1;
        clear_flg = false;
      } else {
        ++n_bits;
        maxcode = n_bits === BITS ? 1 << n_bits : (1 << n_bits) - 1;
      }
    }
    if (code == EOFCode) {
      while (cur_bits > 0) {
        accum[a_count++] = cur_accum & 255;
        if (a_count >= 254) {
          outStream.writeByte(a_count);
          outStream.writeBytesView(accum, 0, a_count);
          a_count = 0;
        }
        cur_accum >>= 8;
        cur_bits -= 8;
      }
      if (a_count > 0) {
        outStream.writeByte(a_count);
        outStream.writeBytesView(accum, 0, a_count);
        a_count = 0;
      }
    }
  }
}
var lzwEncode_default = lzwEncode;

// src/rgb-packing.js
function rgb888_to_rgb565(r, g, b) {
  return r << 8 & 63488 | g << 2 & 992 | b >> 3;
}
function rgba8888_to_rgba4444(r, g, b, a) {
  return r >> 4 | g & 240 | (b & 240) << 4 | (a & 240) << 8;
}
function rgb888_to_rgb444(r, g, b) {
  return r >> 4 << 8 | g & 240 | b >> 4;
}

// src/pnnquant2.js
function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
function sqr(value) {
  return value * value;
}
function find_nn(bins, idx, hasAlpha) {
  var nn = 0;
  var err = 1e100;
  const bin1 = bins[idx];
  const n1 = bin1.cnt;
  const wa = bin1.ac;
  const wr = bin1.rc;
  const wg = bin1.gc;
  const wb = bin1.bc;
  for (var i = bin1.fw; i != 0; i = bins[i].fw) {
    const bin = bins[i];
    const n2 = bin.cnt;
    const nerr2 = n1 * n2 / (n1 + n2);
    if (nerr2 >= err)
      continue;
    var nerr = 0;
    if (hasAlpha) {
      nerr += nerr2 * sqr(bin.ac - wa);
      if (nerr >= err)
        continue;
    }
    nerr += nerr2 * sqr(bin.rc - wr);
    if (nerr >= err)
      continue;
    nerr += nerr2 * sqr(bin.gc - wg);
    if (nerr >= err)
      continue;
    nerr += nerr2 * sqr(bin.bc - wb);
    if (nerr >= err)
      continue;
    err = nerr;
    nn = i;
  }
  bin1.err = err;
  bin1.nn = nn;
}
function create_bin() {
  return {
    ac: 0,
    rc: 0,
    gc: 0,
    bc: 0,
    cnt: 0,
    nn: 0,
    fw: 0,
    bk: 0,
    tm: 0,
    mtm: 0,
    err: 0
  };
}
function create_bin_list(data, format) {
  const bincount = format === "rgb444" ? 4096 : 65536;
  const bins = new Array(bincount);
  const size = data.length;
  if (format === "rgba4444") {
    for (let i = 0; i < size; ++i) {
      const color = data[i];
      const a = color >> 24 & 255;
      const b = color >> 16 & 255;
      const g = color >> 8 & 255;
      const r = color & 255;
      const index = rgba8888_to_rgba4444(r, g, b, a);
      let bin = index in bins ? bins[index] : bins[index] = create_bin();
      bin.rc += r;
      bin.gc += g;
      bin.bc += b;
      bin.ac += a;
      bin.cnt++;
    }
  } else if (format === "rgb444") {
    for (let i = 0; i < size; ++i) {
      const color = data[i];
      const b = color >> 16 & 255;
      const g = color >> 8 & 255;
      const r = color & 255;
      const index = rgb888_to_rgb444(r, g, b);
      let bin = index in bins ? bins[index] : bins[index] = create_bin();
      bin.rc += r;
      bin.gc += g;
      bin.bc += b;
      bin.cnt++;
    }
  } else {
    for (let i = 0; i < size; ++i) {
      const color = data[i];
      const b = color >> 16 & 255;
      const g = color >> 8 & 255;
      const r = color & 255;
      const index = rgb888_to_rgb565(r, g, b);
      let bin = index in bins ? bins[index] : bins[index] = create_bin();
      bin.rc += r;
      bin.gc += g;
      bin.bc += b;
      bin.cnt++;
    }
  }
  return bins;
}
function quantize(rgba, maxColors, opts = {}) {
  const {
    format = "rgb565",
    clearAlpha = true,
    clearAlphaColor = 0,
    clearAlphaThreshold = 0,
    oneBitAlpha = false
  } = opts;
  if (!rgba || !rgba.buffer) {
    throw new Error("quantize() expected RGBA Uint8Array data");
  }
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new Error("quantize() expected RGBA Uint8Array data");
  }
  const data = new Uint32Array(rgba.buffer);
  let useSqrt = opts.useSqrt !== false;
  const hasAlpha = format === "rgba4444";
  const bins = create_bin_list(data, format);
  const bincount = bins.length;
  const bincountMinusOne = bincount - 1;
  const heap = new Uint32Array(bincount + 1);
  var maxbins = 0;
  for (var i = 0; i < bincount; ++i) {
    const bin = bins[i];
    if (bin != null) {
      var d = 1 / bin.cnt;
      if (hasAlpha)
        bin.ac *= d;
      bin.rc *= d;
      bin.gc *= d;
      bin.bc *= d;
      bins[maxbins++] = bin;
    }
  }
  if (sqr(maxColors) / maxbins < 0.022) {
    useSqrt = false;
  }
  var i = 0;
  for (; i < maxbins - 1; ++i) {
    bins[i].fw = i + 1;
    bins[i + 1].bk = i;
    if (useSqrt)
      bins[i].cnt = Math.sqrt(bins[i].cnt);
  }
  if (useSqrt)
    bins[i].cnt = Math.sqrt(bins[i].cnt);
  var h, l, l2;
  for (i = 0; i < maxbins; ++i) {
    find_nn(bins, i, false);
    var err = bins[i].err;
    for (l = ++heap[0]; l > 1; l = l2) {
      l2 = l >> 1;
      if (bins[h = heap[l2]].err <= err)
        break;
      heap[l] = h;
    }
    heap[l] = i;
  }
  var extbins = maxbins - maxColors;
  for (i = 0; i < extbins; ) {
    var tb;
    for (; ; ) {
      var b1 = heap[1];
      tb = bins[b1];
      if (tb.tm >= tb.mtm && bins[tb.nn].mtm <= tb.tm)
        break;
      if (tb.mtm == bincountMinusOne)
        b1 = heap[1] = heap[heap[0]--];
      else {
        find_nn(bins, b1, false);
        tb.tm = i;
      }
      var err = bins[b1].err;
      for (l = 1; (l2 = l + l) <= heap[0]; l = l2) {
        if (l2 < heap[0] && bins[heap[l2]].err > bins[heap[l2 + 1]].err)
          l2++;
        if (err <= bins[h = heap[l2]].err)
          break;
        heap[l] = h;
      }
      heap[l] = b1;
    }
    var nb = bins[tb.nn];
    var n1 = tb.cnt;
    var n2 = nb.cnt;
    var d = 1 / (n1 + n2);
    if (hasAlpha)
      tb.ac = d * (n1 * tb.ac + n2 * nb.ac);
    tb.rc = d * (n1 * tb.rc + n2 * nb.rc);
    tb.gc = d * (n1 * tb.gc + n2 * nb.gc);
    tb.bc = d * (n1 * tb.bc + n2 * nb.bc);
    tb.cnt += nb.cnt;
    tb.mtm = ++i;
    bins[nb.bk].fw = nb.fw;
    bins[nb.fw].bk = nb.bk;
    nb.mtm = bincountMinusOne;
  }
  let palette = [];
  var k = 0;
  for (i = 0; ; ++k) {
    let r = clamp(Math.round(bins[i].rc), 0, 255);
    let g = clamp(Math.round(bins[i].gc), 0, 255);
    let b = clamp(Math.round(bins[i].bc), 0, 255);
    let a = 255;
    if (hasAlpha) {
      a = clamp(Math.round(bins[i].ac), 0, 255);
      if (oneBitAlpha) {
        const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
        a = a <= threshold ? 0 : 255;
      }
      if (clearAlpha && a <= clearAlphaThreshold) {
        r = g = b = clearAlphaColor;
        a = 0;
      }
    }
    const color = hasAlpha ? [r, g, b, a] : [r, g, b];
    const exists = existsInPalette(palette, color);
    if (!exists)
      palette.push(color);
    if ((i = bins[i].fw) == 0)
      break;
  }
  return palette;
}
function existsInPalette(palette, color) {
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    let matchesRGB = p[0] === color[0] && p[1] === color[1] && p[2] === color[2];
    let matchesAlpha = p.length >= 4 && color.length >= 4 ? p[3] === color[3] : true;
    if (matchesRGB && matchesAlpha)
      return true;
  }
  return false;
}

// src/color.js
function euclideanDistanceSquared(a, b) {
  var sum = 0;
  var n;
  for (n = 0; n < a.length; n++) {
    const dx = a[n] - b[n];
    sum += dx * dx;
  }
  return sum;
}

// src/palettize.js
function roundStep(byte, step) {
  return step > 1 ? Math.round(byte / step) * step : byte;
}
function prequantize(rgba, {roundRGB = 5, roundAlpha = 10, oneBitAlpha = null} = {}) {
  const data = new Uint32Array(rgba.buffer);
  for (let i = 0; i < data.length; i++) {
    const color = data[i];
    let a = color >> 24 & 255;
    let b = color >> 16 & 255;
    let g = color >> 8 & 255;
    let r = color & 255;
    a = roundStep(a, roundAlpha);
    if (oneBitAlpha) {
      const threshold = typeof oneBitAlpha === "number" ? oneBitAlpha : 127;
      a = a <= threshold ? 0 : 255;
    }
    r = roundStep(r, roundRGB);
    g = roundStep(g, roundRGB);
    b = roundStep(b, roundRGB);
    data[i] = a << 24 | b << 16 | g << 8 | r << 0;
  }
}
function applyPalette(rgba, palette, format = "rgb565") {
  if (!rgba || !rgba.buffer) {
    throw new Error("quantize() expected RGBA Uint8Array data");
  }
  if (!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray)) {
    throw new Error("quantize() expected RGBA Uint8Array data");
  }
  if (palette.length > 256) {
    throw new Error("applyPalette() only works with 256 colors or less");
  }
  const data = new Uint32Array(rgba.buffer);
  const length = data.length;
  const bincount = format === "rgb444" ? 4096 : 65536;
  const index = new Uint8Array(length);
  const cache = new Array(bincount);
  const hasAlpha = format === "rgba4444";
  if (format === "rgba4444") {
    for (let i = 0; i < length; i++) {
      const color = data[i];
      const a = color >> 24 & 255;
      const b = color >> 16 & 255;
      const g = color >> 8 & 255;
      const r = color & 255;
      const key = rgba8888_to_rgba4444(r, g, b, a);
      const idx = key in cache ? cache[key] : cache[key] = nearestColorIndexRGBA(r, g, b, a, palette);
      index[i] = idx;
    }
  } else {
    const rgb888_to_key = format === "rgb444" ? rgb888_to_rgb444 : rgb888_to_rgb565;
    for (let i = 0; i < length; i++) {
      const color = data[i];
      const b = color >> 16 & 255;
      const g = color >> 8 & 255;
      const r = color & 255;
      const key = rgb888_to_key(r, g, b);
      const idx = key in cache ? cache[key] : cache[key] = nearestColorIndexRGB(r, g, b, palette);
      index[i] = idx;
    }
  }
  return index;
}
function nearestColorIndexRGBA(r, g, b, a, palette) {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < palette.length; i++) {
    const px2 = palette[i];
    const a2 = px2[3];
    let curdist = sqr2(a2 - a);
    if (curdist > mindist)
      continue;
    const r2 = px2[0];
    curdist += sqr2(r2 - r);
    if (curdist > mindist)
      continue;
    const g2 = px2[1];
    curdist += sqr2(g2 - g);
    if (curdist > mindist)
      continue;
    const b2 = px2[2];
    curdist += sqr2(b2 - b);
    if (curdist > mindist)
      continue;
    mindist = curdist;
    k = i;
  }
  return k;
}
function nearestColorIndexRGB(r, g, b, palette) {
  let k = 0;
  let mindist = 1e100;
  for (let i = 0; i < palette.length; i++) {
    const px2 = palette[i];
    const r2 = px2[0];
    let curdist = sqr2(r2 - r);
    if (curdist > mindist)
      continue;
    const g2 = px2[1];
    curdist += sqr2(g2 - g);
    if (curdist > mindist)
      continue;
    const b2 = px2[2];
    curdist += sqr2(b2 - b);
    if (curdist > mindist)
      continue;
    mindist = curdist;
    k = i;
  }
  return k;
}
function snapColorsToPalette(palette, knownColors, threshold = 5) {
  if (!palette.length || !knownColors.length)
    return;
  const paletteRGB = palette.map((p) => p.slice(0, 3));
  const thresholdSq = threshold * threshold;
  const dim = palette[0].length;
  for (let i = 0; i < knownColors.length; i++) {
    let color = knownColors[i];
    if (color.length < dim) {
      color = [color[0], color[1], color[2], 255];
    } else if (color.length > dim) {
      color = color.slice(0, 3);
    } else {
      color = color.slice();
    }
    const r = nearestColorIndexWithDistance(paletteRGB, color.slice(0, 3), euclideanDistanceSquared);
    const idx = r[0];
    const distanceSq = r[1];
    if (distanceSq > 0 && distanceSq <= thresholdSq) {
      palette[idx] = color;
    }
  }
}
function sqr2(a) {
  return a * a;
}
function nearestColorIndex(colors, pixel, distanceFn = euclideanDistanceSquared) {
  let minDist = Infinity;
  let minDistIndex = -1;
  for (let j = 0; j < colors.length; j++) {
    const paletteColor = colors[j];
    const dist = distanceFn(pixel, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      minDistIndex = j;
    }
  }
  return minDistIndex;
}
function nearestColorIndexWithDistance(colors, pixel, distanceFn = euclideanDistanceSquared) {
  let minDist = Infinity;
  let minDistIndex = -1;
  for (let j = 0; j < colors.length; j++) {
    const paletteColor = colors[j];
    const dist = distanceFn(pixel, paletteColor);
    if (dist < minDist) {
      minDist = dist;
      minDistIndex = j;
    }
  }
  return [minDistIndex, minDist];
}
function nearestColor(colors, pixel, distanceFn = euclideanDistanceSquared) {
  return colors[nearestColorIndex(colors, pixel, distanceFn)];
}

// src/index.js
function GIFEncoder(opt = {}) {
  const {initialCapacity = 4096, auto = true} = opt;
  const stream = createStream(initialCapacity);
  const HSIZE = 5003;
  const accum = new Uint8Array(256);
  const htab = new Int32Array(HSIZE);
  const codetab = new Int32Array(HSIZE);
  let hasInit = false;
  return {
    reset() {
      stream.reset();
      hasInit = false;
    },
    finish() {
      stream.writeByte(constants_default.trailer);
    },
    bytes() {
      return stream.bytes();
    },
    bytesView() {
      return stream.bytesView();
    },
    get buffer() {
      return stream.buffer;
    },
    get stream() {
      return stream;
    },
    writeHeader,
    writeFrame(index, width, height, opts = {}) {
      const {
        transparent = false,
        transparentIndex = 0,
        delay = 0,
        palette = null,
        repeat = 0,
        colorDepth = 8,
        dispose = -1
      } = opts;
      let first = false;
      if (auto) {
        if (!hasInit) {
          first = true;
          writeHeader();
          hasInit = true;
        }
      } else {
        first = Boolean(opts.first);
      }
      width = Math.max(0, Math.floor(width));
      height = Math.max(0, Math.floor(height));
      if (first) {
        if (!palette) {
          throw new Error("First frame must include a { palette } option");
        }
        encodeLogicalScreenDescriptor(stream, width, height, palette, colorDepth);
        encodeColorTable(stream, palette);
        if (repeat >= 0) {
          encodeNetscapeExt(stream, repeat);
        }
      }
      const delayTime = Math.round(delay / 10);
      encodeGraphicControlExt(stream, dispose, delayTime, transparent, transparentIndex);
      const useLocalColorTable = Boolean(palette) && !first;
      encodeImageDescriptor(stream, width, height, useLocalColorTable ? palette : null);
      if (useLocalColorTable)
        encodeColorTable(stream, palette);
      encodePixels(stream, index, width, height, colorDepth, accum, htab, codetab);
    }
  };
  function writeHeader() {
    writeUTFBytes(stream, "GIF89a");
  }
}
function encodeGraphicControlExt(stream, dispose, delay, transparent, transparentIndex) {
  stream.writeByte(33);
  stream.writeByte(249);
  stream.writeByte(4);
  if (transparentIndex < 0) {
    transparentIndex = 0;
    transparent = false;
  }
  var transp, disp;
  if (!transparent) {
    transp = 0;
    disp = 0;
  } else {
    transp = 1;
    disp = 2;
  }
  if (dispose >= 0) {
    disp = dispose & 7;
  }
  disp <<= 2;
  const userInput = 0;
  stream.writeByte(0 | disp | userInput | transp);
  writeUInt16(stream, delay);
  stream.writeByte(transparentIndex || 0);
  stream.writeByte(0);
}
function encodeLogicalScreenDescriptor(stream, width, height, palette, colorDepth = 8) {
  const globalColorTableFlag = 1;
  const sortFlag = 0;
  const globalColorTableSize = colorTableSize(palette.length) - 1;
  const fields = globalColorTableFlag << 7 | colorDepth - 1 << 4 | sortFlag << 3 | globalColorTableSize;
  const backgroundColorIndex = 0;
  const pixelAspectRatio = 0;
  writeUInt16(stream, width);
  writeUInt16(stream, height);
  stream.writeBytes([fields, backgroundColorIndex, pixelAspectRatio]);
}
function encodeNetscapeExt(stream, repeat) {
  stream.writeByte(33);
  stream.writeByte(255);
  stream.writeByte(11);
  writeUTFBytes(stream, "NETSCAPE2.0");
  stream.writeByte(3);
  stream.writeByte(1);
  writeUInt16(stream, repeat);
  stream.writeByte(0);
}
function encodeColorTable(stream, palette) {
  const colorTableLength = 1 << colorTableSize(palette.length);
  for (let i = 0; i < colorTableLength; i++) {
    let color = [0, 0, 0];
    if (i < palette.length) {
      color = palette[i];
    }
    stream.writeByte(color[0]);
    stream.writeByte(color[1]);
    stream.writeByte(color[2]);
  }
}
function encodeImageDescriptor(stream, width, height, localPalette) {
  stream.writeByte(44);
  writeUInt16(stream, 0);
  writeUInt16(stream, 0);
  writeUInt16(stream, width);
  writeUInt16(stream, height);
  if (localPalette) {
    const interlace = 0;
    const sorted = 0;
    const palSize = colorTableSize(localPalette.length) - 1;
    stream.writeByte(128 | interlace | sorted | 0 | palSize);
  } else {
    stream.writeByte(0);
  }
}
function encodePixels(stream, index, width, height, colorDepth = 8, accum, htab, codetab) {
  lzwEncode_default(width, height, index, colorDepth, stream, accum, htab, codetab);
}
function writeUInt16(stream, short) {
  stream.writeByte(short & 255);
  stream.writeByte(short >> 8 & 255);
}
function writeUTFBytes(stream, text) {
  for (var i = 0; i < text.length; i++) {
    stream.writeByte(text.charCodeAt(i));
  }
}
function colorTableSize(length) {
  return Math.max(Math.ceil(Math.log2(length)), 1);
}
var src_default = GIFEncoder;
  return exports;
}

// ---- compression core: runs in a Worker (preferred) or on the main thread with yields ----------------------------
// Decodes every frame with ImageDecoder (frames come fully composed), then re-encodes with fewer pixels / frames / colours
// until the file is under the target. Timing (frame durations, total length) and the loop count are kept; transparency is kept.
async function ccfGifCompressCore(buffer, opts, post, cancelled, yieldFn, G) {
  const target = opts.target;
  const decoder = new ImageDecoder({ data: buffer, type: 'image/gif' });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track.frameCount;
  if (!track.animated || frameCount < 2) { decoder.close(); return { skip: 'static' }; }
  const repetition = track.repetitionCount;
  const repeat = repetition === Infinity ? 0 : (repetition > 0 ? repetition : -1);
  // pass 1: the frame durations (ms) and the picture size
  const durations = [];
  let width = 0, height = 0;
  for (let i = 0; i < frameCount; i += 1) {
    if (cancelled()) { decoder.close(); return { cancelled: true }; }
    const { image } = await decoder.decode({ frameIndex: i });
    if (!width) { width = image.displayWidth; height = image.displayHeight; }
    durations.push(Math.max(20, Math.round((image.duration || 100000) / 1000)));
    image.close();
    if (i % 8 === 7) await yieldFn();
  }
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const longSide = Math.max(width, height);
  // first guess: size grows with the pixel count, so scale by the square root of the wanted ratio
  let scale = Math.min(1, Math.sqrt((target * 0.88) / Math.max(1, opts.originalSize)));
  let step = 1;
  let colors = 256;
  const minLongSide = 320;
  let attempt = 0;
  let last = null;
  while (attempt < 9) {
    attempt += 1;
    const w = Math.max(16, Math.round(width * scale)), h = Math.max(16, Math.round(height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    const encoder = G.GIFEncoder();
    let written = 0;
    const groups = Math.ceil(frameCount / step);
    for (let g = 0; g < groups; g += 1) {
      if (cancelled()) { decoder.close(); return { cancelled: true }; }
      const index = g * step;
      const { image } = await decoder.decode({ frameIndex: index });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
      image.close();
      let delay = 0;
      for (let k = index; k < Math.min(frameCount, index + step); k += 1) delay += durations[k];
      const rgba = ctx.getImageData(0, 0, w, h).data;
      const palette = G.quantize(rgba, colors, { format: 'rgba4444', oneBitAlpha: true });
      const pixels = G.applyPalette(rgba, palette, 'rgba4444');
      const transparentIndex = palette.findIndex((c) => c.length > 3 && c[3] === 0);
      encoder.writeFrame(pixels, w, h, {
        palette, delay, repeat,
        transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex),
        dispose: transparentIndex >= 0 ? 2 : -1
      });
      written += 1;
      post({ type: 'progress', frac: Math.min(0.97, (attempt - 1) * 0.25 + 0.25 * ((g + 1) / groups)), attempt, width: w, height: h, step, colors });
      if (g % 2 === 1) await yieldFn();
    }
    encoder.finish();
    const bytes = encoder.bytes();
    last = { bytes: bytes.slice(), width: w, height: h, frames: written, originalFrames: frameCount, step, colors, totalMs, scale };
    if (bytes.length <= target) { decoder.close(); return { ok: true, ...last, size: bytes.length, attempts: attempt }; }
    // still too big: shrink the picture first (size ~ pixels), then drop frames, then colours
    if (Math.max(w, h) > minLongSide && scale > 0.2) {
      scale *= Math.max(0.5, Math.min(0.92, Math.sqrt((target * 0.92) / bytes.length)));
    } else if (step < 3) {
      step += 1;
      scale = Math.min(1, Math.max(scale, 360 / longSide) * 1.0);
    } else if (colors > 64) {
      colors = colors / 2;
    } else break;
  }
  decoder.close();
  return { failed: true, reason: 'too-big', size: last ? last.bytes.length : 0, attempts: attempt };
}

// ---- worker source: gifenc + core, built from the functions above (no CDN, no eval) ----------------------------
function ccfGifWorkerSource() {
  return `
    const G = (${ccfGifencModule.toString()})();
    const core = ${ccfGifCompressCore.toString()};
    let cancelFlag = false;
    self.onmessage = async (event) => {
      const data = event.data;
      if (data.type === 'cancel') { cancelFlag = true; return; }
      if (data.type !== 'start') return;
      try {
        const result = await core(data.buffer, data.opts, (message) => self.postMessage(message), () => cancelFlag, async () => {}, G);
        if (result.bytes) { const buffer = result.bytes.buffer; self.postMessage({ type: 'done', result: { ...result, bytes: buffer } }, [buffer]); }
        else self.postMessage({ type: 'done', result });
      } catch (error) { self.postMessage({ type: 'error', message: String(error && error.message || error) }); }
    };`;
}

(() => {
  "use strict";
  if (window.__CCF_GIF_COMPRESS__) return;
  const LIMIT = 5 * 1024 * 1024;           // CCFOLIA's upload limit
  const TARGET = Math.floor(4.8 * 1024 * 1024);
  const enabled = () => { try { return localStorage.getItem("ccfGifCompress") !== "off"; } catch (_) { return true; } };
  const isGifName = (file) => file.type === "image/gif" || /\.gif$/i.test(file.name || "");
  const needsWork = (file) => file instanceof File && isGifName(file) && file.size > LIMIT;
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

  // ---- progress toast (small, bottom centre; cancel button)
  let toast = null, toastTimer = 0;
  const showToast = (text, { cancel = null, ms = 0, error = false } = {}) => {
    if (!toast) {
      toast = document.createElement("div");
      toast.setAttribute("data-ccf-safe-markup", "1");
      toast.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483600;display:flex;align-items:center;gap:12px;max-width:min(560px,calc(100vw - 32px));padding:10px 16px;border-radius:4px;background:#424242;color:#fff;font:14px/1.4 'Noto Sans KR',Roboto,sans-serif;box-shadow:0 3px 5px -1px rgba(0,0,0,.2),0 6px 10px rgba(0,0,0,.14),0 1px 18px rgba(0,0,0,.12)";
      toast.innerHTML = '<span data-role="text"></span><button type="button" data-role="cancel" style="display:none;border:0;background:transparent;color:#64b5f6;font:inherit;font-weight:500;cursor:pointer;padding:4px 8px">취소</button>';
      document.documentElement.appendChild(toast);
    }
    window.clearTimeout(toastTimer);
    toast.querySelector('[data-role="text"]').textContent = text;
    toast.style.background = error ? "#7f2f2f" : "#424242";
    const button = toast.querySelector('[data-role="cancel"]');
    button.style.display = cancel ? "" : "none";
    button.onclick = cancel;
    if (ms) toastTimer = window.setTimeout(() => { toast?.remove(); toast = null; }, ms);
  };
  const hideToast = () => { window.clearTimeout(toastTimer); toast?.remove(); toast = null; };

  // ---- compress one file: Worker first, main thread (with yields) when a Worker cannot be made
  async function compress(file) {
    if (typeof ImageDecoder !== "function" || typeof OffscreenCanvas !== "function") return { skip: "unsupported" };
    const buffer = await file.arrayBuffer();
    const opts = { target: TARGET, originalSize: file.size };
    let cancelled = false;
    const onProgress = (message) => {
      if (message.type !== "progress") return;
      showToast(`GIF 압축 중… ${Math.round(message.frac * 100)}% (${message.width}×${message.height}${message.step > 1 ? `, 프레임 ${message.step}개 중 1개` : ""}${message.colors < 256 ? `, ${message.colors}색` : ""})`, { cancel: () => { cancelled = true; worker?.postMessage({ type: "cancel" }); } });
    };
    showToast("GIF 압축 준비 중…", { cancel: () => { cancelled = true; worker?.postMessage({ type: "cancel" }); } });
    let worker = null;
    try {
      const url = URL.createObjectURL(new Blob([ccfGifWorkerSource()], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (_) { worker = null; }
    if (worker) {
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = (event) => {
            if (event.data.type === "progress") onProgress(event.data);
            else if (event.data.type === "done") resolve(event.data.result);
            else if (event.data.type === "error") reject(new Error(event.data.message));
          };
          worker.onerror = (event) => reject(new Error(event.message || "worker error"));
          worker.postMessage({ type: "start", buffer, opts }, [buffer]);
        });
      } finally { worker.terminate(); }
    }
    // no Worker (a page policy can block blob workers): same code on the main thread, yielding between frames
    return ccfGifCompressCore(buffer, opts, onProgress, () => cancelled, yieldToMain, ccfGifencModule());
  }

  // The File that replaces the original, or null (keep the original; CCFOLIA shows its own warning).
  async function processFile(file) {
    const started = performance.now();
    try {
      const result = await compress(file);
      if (result.skip === "unsupported") { showToast("이 브라우저는 GIF 압축(ImageDecoder)을 지원하지 않습니다. 원본 그대로 올립니다.", { ms: 6000, error: true }); return null; }
      if (result.skip === "static") { hideToast(); return null; }
      if (result.cancelled) { showToast("GIF 압축을 취소했습니다. 원본 그대로 올립니다.", { ms: 4000 }); return null; }
      if (result.failed) { showToast(`GIF를 5MB 아래로 줄이지 못했습니다(최소 ${mb(result.size)}). 원본 그대로 올립니다.`, { ms: 7000, error: true }); return null; }
      const out = new File([result.bytes], file.name, { type: "image/gif", lastModified: Date.now() });
      showToast(`GIF 압축 완료: ${mb(file.size)} → ${mb(out.size)} (${result.width}×${result.height}, 프레임 ${result.originalFrames}→${result.frames})`, { ms: 6000 });
      window.__CCF_GIF_COMPRESS__.last = { from: file.size, to: out.size, width: result.width, height: result.height, frames: result.frames, originalFrames: result.originalFrames, attempts: result.attempts, ms: Math.round(performance.now() - started) };
      return out;
    } catch (error) {
      showToast(`GIF 압축 실패: ${error.message}. 원본 그대로 올립니다.`, { ms: 7000, error: true });
      return null;
    }
  }

  // ---- interception: the file input's change event and drops, in the capture phase on window (before CCFOLIA's handlers).
  const PASS = "__ccfGifPass";
  async function replaceFiles(files) {
    const out = [];
    for (const file of files) {
      if (needsWork(file)) out.push((await processFile(file)) || file);
      else out.push(file);
    }
    return out;
  }
  window.addEventListener("change", (event) => {
    const input = event.target;
    if (event[PASS] || !(input instanceof HTMLInputElement) || input.type !== "file" || !enabled()) return;
    const files = Array.from(input.files || []);
    if (!files.some(needsWork)) return;
    event.stopImmediatePropagation();
    replaceFiles(files).then((replaced) => {
      const transfer = new DataTransfer();
      replaced.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      const again = new Event("change", { bubbles: true });
      again[PASS] = true;
      input.dispatchEvent(again);
    });
  }, true);
  window.addEventListener("drop", (event) => {
    if (event[PASS] || !enabled()) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.some(needsWork)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const { target, clientX, clientY } = event;
    replaceFiles(files).then((replaced) => {
      const transfer = new DataTransfer();
      replaced.forEach((file) => transfer.items.add(file));
      const again = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY });
      again[PASS] = true;
      target.dispatchEvent(again);
    });
  }, true);

  window.__CCF_GIF_COMPRESS__ = { version: "0.1.0", limit: LIMIT, target: TARGET, enabled, compress, process: processFile, gifenc: ccfGifencModule };
})();
