import { inflateSync } from "node:zlib";
import { terrarium } from "./maps-net.mjs";

const M_LAT = 111194.93; // meters per degree on the mean sphere

export function createProjection(lat0, lon0) {
  const mLon = M_LAT * Math.cos((lat0 * Math.PI) / 180);
  return {
    xz: (lat, lon) => [(lon - lon0) * mLon, -(lat - lat0) * M_LAT],
    ll: (x, z) => [lat0 - z / M_LAT, lon0 + x / mLon],
  };
}

export function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8) throw new Error("png depth"); }
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error("png color type " + ct);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? out[o + i - bpp] : 0, b = y ? out[o + i - stride] : 0, c = y && i >= bpp ? out[o + i - stride - bpp] : 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[o + i] = v & 255;
    }
  }
  return { w, h, bpp, data: out };
}

// Terrarium DEM at one zoom. load() fetches the tiles for a lat/lon box, at() samples bilinear.
export function createDem(zoom) {
  const n = 2 ** zoom, tiles = new Map();
  const px = (lat, lon) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * n * 256, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256];
  };
  const raw = (gx, gy) => {
    const t = tiles.get(((gx >> 8) * n + (gy >> 8)));
    if (!t) throw new Error(`dem tile missing ${gx >> 8},${gy >> 8}`);
    const o = ((gy & 255) * 256 + (gx & 255)) * t.bpp, d = t.data;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  return {
    async load(s, w, nn, e) {
      const [x0, y0] = px(nn, w), [x1, y1] = px(s, e);
      for (let tx = Math.floor(x0 / 256) - 0; tx <= Math.floor(x1 / 256); tx++)
        for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++)
          if (!tiles.has(tx * n + ty)) tiles.set(tx * n + ty, decodePng(await terrarium(zoom, tx, ty)));
    },
    at(lat, lon) {
      const [x, y] = px(lat, lon), fx = x - 0.5, fy = y - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
      return (raw(ix, iy) * (1 - u) + raw(ix + 1, iy) * u) * (1 - v) + (raw(ix, iy + 1) * (1 - u) + raw(ix + 1, iy + 1) * u) * v;
    },
  };
}

export function areaOf(pts) { // signed, in x,z. Negative = counterclockwise seen from above (north up).
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

export function simplify(pts, tol, closed) {
  if (pts.length < 4) return pts;
  if (closed) {
    let far = 1, d = 0;
    for (let i = 1; i < pts.length; i++) { const q = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (q > d) { d = q; far = i; } }
    const a = simplify(pts.slice(0, far + 1), tol, false), b = simplify([...pts.slice(far), pts[0]], tol, false);
    return [...a.slice(0, -1), ...b.slice(0, -1)];
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, az] = pts[i], [bx, bz] = pts[j], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    let k = -1, m = tol;
    for (let q = i + 1; q < j; q++) {
      const d = Math.abs((pts[q][0] - ax) * dz - (pts[q][1] - az) * dx) / L;
      if (d > m) { m = d; k = q; }
    }
    if (k > 0) { keep[k] = 1; stack.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function clipRect(pts, x0, z0, x1, z1) {
  const edges = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]], [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]], [(p) => p[1] >= z0, (a, b) => [a[0] + ((b[0] - a[0]) * (z0 - a[1])) / (b[1] - a[1]), z0]], [(p) => p[1] <= z1, (a, b) => [a[0] + ((b[0] - a[0]) * (z1 - a[1])) / (b[1] - a[1]), z1]]];
  let out = pts;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

// Closed rings (lat/lon arrays) of an Overpass way or multipolygon relation (outer members joined end to end).
export function ringsOf(el) {
  const g = (geo) => geo.map((p) => [p.lat, p.lon]);
  if (el.type === "way") return el.geometry && el.geometry.length > 3 ? [g(el.geometry)] : [];
  const parts = (el.members || []).filter((m) => m.type === "way" && m.role !== "inner" && m.geometry?.length > 1).map((m) => g(m.geometry));
  const rings = [], same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (parts.length) {
    let r = parts.shift();
    for (let grew = true; grew && !same(r[0], r.at(-1)); ) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i];
        if (same(r.at(-1), q[0])) r = [...r, ...q.slice(1)];
        else if (same(r.at(-1), q.at(-1))) r = [...r, ...q.slice(0, -1).reverse()];
        else continue;
        parts.splice(i, 1); grew = true; break;
      }
    }
    if (r.length > 3) rings.push(r);
  }
  return rings;
}

// Points binned in a uniform grid for nearest distance queries.
export function createPointGrid(xs, zs, cell) {
  const m = new Map(), key = (i, j) => i * 100003 + j;
  for (let k = 0; k < xs.length; k++) {
    const kk = key(Math.floor(xs[k] / cell), Math.floor(zs[k] / cell));
    (m.get(kk) || m.set(kk, []).get(kk)).push(k);
  }
  return {
    nearest(x, z, maxR) {
      const ci = Math.floor(x / cell), cj = Math.floor(z / cell), r = Math.ceil(maxR / cell);
      let best = -1, bd = maxR * maxR;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (const k of m.get(key(i, j)) || []) {
        const d = (xs[k] - x) ** 2 + (zs[k] - z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      return { i: best, d: Math.sqrt(bd) };
    },
  };
}
