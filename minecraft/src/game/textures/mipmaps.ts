export interface MipLevel {
  data: Uint8Array;
  width: number;
  height: number;
}

const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const toSrgb8 = (l: number) => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));

// Cutout layers (alpha only 0 or 255) keep their base coverage at every level, so leaves and plants do not fade out.
export function buildMipmaps(base: Uint8Array, size: number, layers: number, levels: number): MipLevel[] {
  const out: MipLevel[] = [{ data: base, width: size, height: size }];
  const cutout = new Uint8Array(layers);
  const coverage = new Float32Array(layers);
  const px = size * size;
  for (let l = 0; l < layers; l++) {
    let binary = true, opaque = 0;
    for (let i = 0; i < px; i++) {
      const a = base[(l * px + i) * 4 + 3];
      if (a !== 0 && a !== 255) binary = false;
      if (a >= 128) opaque++;
    }
    cutout[l] = binary && opaque < px ? 1 : 0;
    coverage[l] = opaque / px;
  }
  let srcA = new Float32Array(layers * px);
  for (let i = 0; i < srcA.length; i++) srcA[i] = base[i * 4 + 3];
  let src = base, s = size;
  const sorted = new Float32Array(px);
  for (let lv = 1; lv < levels && s > 1; lv++) {
    const d = s >> 1, dpx = d * d, spx = s * s;
    const dst = new Uint8Array(layers * dpx * 4);
    const dstA = new Float32Array(layers * dpx);
    for (let l = 0; l < layers; l++) {
      for (let y = 0; y < d; y++)
        for (let x = 0; x < d; x++) {
          let r = 0, g = 0, b = 0, w = 0, ur = 0, ug = 0, ub = 0;
          for (let k = 0; k < 4; k++) {
            const si = l * spx + (y * 2 + (k >> 1)) * s + x * 2 + (k & 1);
            const a = srcA[si];
            const lr = TO_LIN[src[si * 4]], lg = TO_LIN[src[si * 4 + 1]], lb = TO_LIN[src[si * 4 + 2]];
            r += lr * a; g += lg * a; b += lb * a; w += a;
            ur += lr; ug += lg; ub += lb;
          }
          const di = l * dpx + y * d + x;
          if (w > 0) { r /= w; g /= w; b /= w; } else { r = ur / 4; g = ug / 4; b = ub / 4; }
          dst[di * 4] = toSrgb8(r);
          dst[di * 4 + 1] = toSrgb8(g);
          dst[di * 4 + 2] = toSrgb8(b);
          dstA[di] = w / 4;
        }
      let scale = 1;
      if (cutout[l]) {
        const off = l * dpx;
        for (let i = 0; i < dpx; i++) sorted[i] = dstA[off + i];
        const view = sorted.subarray(0, dpx).sort().reverse();
        const k = Math.round(coverage[l] * dpx);
        let j = k - 1;
        while (j > 0 && view[j] === 0) j--;
        if (k > 0 && view[j] > 0) {
          let hi = j, lo = j;
          while (hi + 1 < dpx && view[hi + 1] === view[j]) hi++;
          while (lo > 0 && view[lo - 1] === view[j]) lo--;
          scale = lo > 0 && k - lo < hi + 1 - k ? 128 / view[lo - 1] : 128 / view[j];
        } else if (view[0] > 0) scale = Math.min(1, 127 / view[0]);
      }
      for (let i = l * dpx; i < (l + 1) * dpx; i++) dst[i * 4 + 3] = Math.min(255, Math.round(dstA[i] * scale));
    }
    out.push({ data: dst, width: d, height: d });
    src = dst; srcA = dstA; s = d;
  }
  return out;
}
