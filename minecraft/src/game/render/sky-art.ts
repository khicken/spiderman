export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function put(px: Uint8Array, w: number, x: number, y: number, r: number, g: number, b: number, a = 255) {
  const i = (y * w + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// 32x32 like sun.png: a hard square core with a soft yellow rim. Drawn additively, so black is clear.
export function paintSun(): { data: Uint8Array; size: number } {
  const n = 32, px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
      if (d < 6) put(px, n, x, y, 255, 255, 230);
      else if (d < 8) put(px, n, x, y, 255, 247, 160);
      else if (d < 10) put(px, n, x, y, 230, 200, 70);
      else if (d < 12) put(px, n, x, y, 120, 95, 25);
      else put(px, n, x, y, 0, 0, 0);
    }
  return { data: px, size: n };
}

export function paintMoonPhases(): { data: Uint8Array; width: number; height: number } {
  const w = 128, h = 64, px = new Uint8Array(w * h * 4);
  const rand = rng(77);
  const craters: number[] = [];
  for (let i = 0; i < 16 * 16; i++) craters.push(rand());
  for (let p = 0; p < 8; p++) {
    const ox = (p % 4) * 32, oy = Math.floor(p / 4) * 32;
    const k = Math.cos((p / 8) * Math.PI * 2);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const lx = x - 8, ly = y - 8;
        if (lx < 0 || ly < 0 || lx > 15 || ly > 15) { put(px, w, ox + x, oy + y, 0, 0, 0); continue; }
        const u = (lx + 0.5) / 8 - 1;
        const lit = p === 0 || (p < 4 ? u < k : p > 4 ? u > -k : false);
        if (!lit) { put(px, w, ox + x, oy + y, 0, 0, 0); continue; }
        const c = craters[ly * 16 + lx];
        const edge = lx === 0 || ly === 0 || lx === 15 || ly === 15;
        const v = edge ? 150 : c < 0.18 ? 160 : c < 0.3 ? 185 : 215;
        put(px, w, ox + x, oy + y, v, v, v + 10);
      }
  }
  return { data: px, width: w, height: h };
}

export function paintEndSky(): { data: Uint8Array; size: number } {
  const n = 128, px = new Uint8Array(n * n * 4);
  const rand = rng(1234);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = rand();
      const v = r > 0.985 ? 78 : 34 + Math.floor(rand() * 22);
      put(px, n, x, y, v, Math.round(v * 0.86), Math.round(v * 1.12));
    }
  return { data: px, size: n };
}

function hash2(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Lattice values per octave are precomputed: the map wraps, so each octave has only period^2 of them.
export function paintCloudMap(): Uint8Array {
  const n = 256, out = new Uint8Array(n * n);
  const grids = [24, 48, 96].map((p, o) => {
    const g = new Float64Array(p * p);
    for (let y = 0; y < p; y++) for (let x = 0; x < p; x++) g[y * p + x] = hash2(x, y, 31 + o);
    return g;
  });
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0, amp = 0.55, total = 0;
      for (let o = 0, p = 24; o < 3; o++, p *= 2) {
        const g = grids[o];
        const gx = (x / n) * p, gy = (y / n) * p;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const x1 = (x0 + 1) % p, r0 = y0 * p, r1 = ((y0 + 1) % p) * p;
        const a = g[r0 + x0], b = g[r0 + x1], c = g[r1 + x0], d = g[r1 + x1];
        v += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
        total += amp;
        amp *= 0.5;
      }
      out[y * n + x] = v / total > 0.56 ? 1 : 0;
    }
  return out;
}

export function buildStars(): { positions: Float32Array; index: Uint16Array } {
  const rand = rng(10842);
  const pos: number[] = [];
  for (let i = 0; i < 1500; i++) {
    let x = rand() * 2 - 1, y = rand() * 2 - 1, z = rand() * 2 - 1;
    const size = 0.15 + rand() * 0.1;
    const roll = rand() * Math.PI * 2;
    let len = x * x + y * y + z * z;
    if (len >= 1 || len <= 0.01) continue;
    len = 1 / Math.sqrt(len);
    x *= len; y *= len; z *= len;
    const cx = x * 100, cy = y * 100, cz = z * 100;
    const yaw = Math.atan2(x, z), sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw);
    const pitch = Math.atan2(Math.sqrt(x * x + z * z), y), sinP = Math.sin(pitch), cosP = Math.cos(pitch);
    const sinR = Math.sin(roll), cosR = Math.cos(roll);
    for (let v = 0; v < 4; v++) {
      const a = ((v & 2) - 1) * size, b = (((v + 1) & 2) - 1) * size;
      const ra = a * cosR - b * sinR, rb = b * cosR + a * sinR;
      const ry = ra * sinP, rr = -ra * cosP;
      pos.push(cx + rr * sinYaw - rb * cosYaw, cy + ry, cz + rb * sinYaw + rr * cosYaw);
    }
  }
  const quads = pos.length / 12;
  const index = new Uint16Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const b = q * 4;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
  }
  return { positions: new Float32Array(pos), index };
}
